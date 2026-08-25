import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixture } from "./review.test.js";
import { openDatabase, temporaryMediaByReel } from "../src/database/db.js";
import { OneDrivePersonalTemporaryMediaProvider, createOneDrivePersonalGraphClient, validateOneDriveAnonymousDownload, type OneDriveDriveItem, type OneDrivePersonalGraphClient } from "../src/publishing/onedrive-personal-temporary-media.js";
import { sha256File } from "../src/media/checksum.js";
import type { MediaConfig } from "../src/config/index.js";

function input(reelId: string, checksum: string) {
  return { reelId, publicationKey: `instagram:${reelId}:fixture`, derivedReelRelativePath: "pilot/reel.mp4", derivedChecksum: checksum, editorialVersion: 1 };
}

function validMp4(): Buffer { return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("fixture-video")]); }

function fakeGraph(): { graph: OneDrivePersonalGraphClient; uploads: number; deletes: number } {
  const items = new Map<string, OneDriveDriveItem>();
  let uploads = 0;
  let deletes = 0;
  const graph: OneDrivePersonalGraphClient = {
    async getDrive() { return { id: "personal-drive-1", driveType: "personal", owner: { user: { id: "personal-user-1" } } }; },
    async getItemByPath(itemPath) { return items.get(itemPath) ?? null; },
    async ensureFolder() { return { id: "folder-1", name: "InstagramTemp" }; },
    async uploadSmallFile(itemPath) {
      uploads += 1;
      const item: OneDriveDriveItem = { id: "item-1", name: path.basename(itemPath), size: validMp4().byteLength, file: { mimeType: "video/mp4" }, "@microsoft.graph.downloadUrl": "https://public.dm.files.1drv.com/file" };
      items.set(itemPath, item);
      return item;
    },
    async getItemById() { return [...items.values()][0]; },
    async createAnonymousViewLink() { return { permissionId: "permission-1", webUrl: "https://1drv.ms/u/s!fixture" }; },
    async deleteItem() { deletes += 1; items.clear(); },
    async deletePermission() { return; },
  };
  return { graph, get uploads() { return uploads; }, get deletes() { return deletes; } };
}

function fetcherFor(body: Buffer, contentType = "video/mp4") {
  return async (url: string, options?: { range?: string }) => ({
    status: options?.range ? 206 : 200,
    headers: new Headers({ "content-type": contentType, "content-length": String(options?.range ? Math.min(1024, body.byteLength) : body.byteLength), ...(options?.range ? { "content-range": `bytes 0-${Math.min(1023, body.byteLength - 1)}/${body.byteLength}`, "accept-ranges": "bytes" } : {}) }),
    url,
    body: new Uint8Array(options?.range ? body.subarray(0, 1024) : body),
  });
}

test("OneDrive provider requires an explicitly supplied personal Microsoft auth client", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  const checksum = await sha256File(output);
  const provider = new OneDrivePersonalTemporaryMediaProvider(item.config);
  await assert.rejects(() => provider.prepareTemporaryMedia(input(item.reelId, checksum)), /PERSONAL_MICROSOFT_ACCOUNT_REQUIRED/);
});

test("OneDrive provider rejects a business/corporate drive before mutation", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  const checksum = await sha256File(output);
  const graph = { ...fakeGraph().graph, getDrive: async () => ({ id: "business-drive", driveType: "business", owner: { user: { id: "corporate-user" } } }) };
  const provider = new OneDrivePersonalTemporaryMediaProvider(item.config, { graph });
  await assert.rejects(() => provider.prepareTemporaryMedia(input(item.reelId, checksum)), /CORPORATE_MICROSOFT_IDENTITY_REJECTED/);
});

test("OneDrive provider uploads exactly one deterministic MP4, validates anonymously, and reuses an identical item", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  await fs.writeFile(output, validMp4());
  const checksum = await sha256File(output);
  const fake = fakeGraph();
  const provider = new OneDrivePersonalTemporaryMediaProvider(item.config, { graph: fake.graph, fetcher: fetcherFor(validMp4()) });
  const first = await provider.prepareTemporaryMedia(input(item.reelId, checksum));
  const second = await provider.prepareTemporaryMedia(input(item.reelId, checksum));
  assert.equal(fake.uploads, 1);
  assert.equal(first.state, "VALIDATED");
  assert.equal(second.validation.code, "PASS");
  assert.equal(first.provider, "onedrive-personal");
  assert.equal(first.safeUrl, "https://public.dm.files.1drv.com/file");
  assert.equal(first.url.includes("?"), false);
  assert.equal(first.validation.rangeSupport, "SUPPORTED");
  const db = openDatabase(item.config);
  try {
    const record = temporaryMediaByReel(db, item.reelId);
    assert.equal(record?.provider, "onedrive-personal");
    assert.equal(record?.blob_container, "personal-drive-1");
    assert.equal(record?.blob_name.includes(item.reelId), true);
    assert.equal(record?.drive_id, "personal-drive-1");
    assert.equal(record?.item_id, "item-1");
    assert.equal(record?.item_path, record?.blob_name);
    const auditRows = db.prepare("SELECT metadata_json_safe FROM publication_audit_events WHERE entity_id = ?").all(item.reelId) as Array<{ metadata_json_safe: string }>;
    assert.ok(auditRows.every((row) => !row.metadata_json_safe.includes("public.example.invalid/file?")));
    db.prepare("UPDATE temporary_media SET expires_at = ? WHERE reel_id = ?").run("2026-08-25T11:00:00.000Z", item.reelId);
  } finally { db.close(); }
  assert.equal(await provider.cleanupExpiredMedia(), 1);
  assert.equal(fake.deletes, 1);
});

test("anonymous OneDrive validation rejects HTML, wrong MIME, checksum mismatch, and untrusted redirects", async () => {
  const body = validMp4();
  const checksum = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(body).digest("hex"));
  const base = { url: "https://public.dm.files.1drv.com/file", expectedSize: body.byteLength, expectedChecksum: checksum, expectedMimeType: "video/mp4", expectedFileName: "pilot.mp4", now: new Date("2026-08-25T12:00:00.000Z"), expiresAt: "2026-08-25T13:00:00.000Z" };
  const html = await validateOneDriveAnonymousDownload({ ...base, fetcher: fetcherFor(Buffer.from("<html>login</html>"), "text/html") });
  assert.equal(html.code, "ONEDRIVE_DOWNLOAD_HTML_RESPONSE");
  const wrongType = await validateOneDriveAnonymousDownload({ ...base, fetcher: fetcherFor(body, "application/octet-stream") });
  assert.equal(wrongType.code, "PASS");
  const invalidType = await validateOneDriveAnonymousDownload({ ...base, fetcher: fetcherFor(body, "text/plain") });
  assert.equal(invalidType.code, "CONTENT_TYPE_INVALID");
  const mismatch = await validateOneDriveAnonymousDownload({ ...base, expectedChecksum: "0".repeat(64), fetcher: fetcherFor(body) });
  assert.equal(mismatch.code, "ONEDRIVE_DOWNLOAD_CHECKSUM_MISMATCH");
  const redirect = await validateOneDriveAnonymousDownload({ ...base, fetcher: async (url) => ({ status: 302, headers: new Headers({ location: "https://evil.example/file" }), url, location: "https://evil.example/file" }) });
  assert.equal(redirect.code, "ONEDRIVE_DOWNLOAD_REDIRECT_UNTRUSTED");
});

test("anonymous validation follows trusted Microsoft redirects and never sends authorization", async () => {
  const body = validMp4();
  const checksum = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(body).digest("hex"));
  const calls: Array<{ url: string; range?: string }> = [];
  const fetcher = async (url: string, options?: { range?: string }) => {
    calls.push({ url, range: options?.range });
    if (url === "https://public.dm.files.1drv.com/file") return { status: 302, headers: new Headers({ location: "https://download.files.1drv.com/pilot" }), url, location: "https://download.files.1drv.com/pilot" };
    return fetcherFor(body)(url, options);
  };
  const result = await validateOneDriveAnonymousDownload({ url: "https://public.dm.files.1drv.com/file", expectedSize: body.byteLength, expectedChecksum: checksum, expectedMimeType: "video/mp4", expectedFileName: "pilot.mp4", now: new Date(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), fetcher });
  assert.equal(result.code, "PASS");
  assert.equal(result.diagnostics?.initialMethod, "GET");
  assert.equal(result.diagnostics?.authorizationHeaderSent, false);
  assert.deepEqual(result.diagnostics?.redirectStatuses, [302, 302]);
  assert.deepEqual(result.diagnostics?.redirectHosts, ["public.dm.files.1drv.com", "download.files.1drv.com", "public.dm.files.1drv.com", "download.files.1drv.com"]);
  assert.equal(result.safeUrl, "https://public.dm.files.1drv.com/file");
  assert.equal(calls.every((call) => !call.url.includes("?")), true);
});

test("range validation accepts a server that ignores Range and returns 200", async () => {
  const body = validMp4();
  const checksum = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(body).digest("hex"));
  const result = await validateOneDriveAnonymousDownload({ url: "https://public.dm.files.1drv.com/file", expectedSize: body.byteLength, expectedChecksum: checksum, expectedMimeType: "video/mp4", expectedFileName: "pilot.mp4", now: new Date(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), fetcher: async (url, options) => ({ ...await fetcherFor(body)(url), headers: new Headers({ "content-type": "video/mp4", "content-length": String(body.byteLength), ...(options?.range ? { "accept-ranges": "none" } : {}) }) }) });
  assert.equal(result.code, "PASS");
  assert.equal(result.rangeSupport, "NOT_SUPPORTED");
  assert.equal(result.contentLength, body.byteLength);
});

test("range Content-Length is treated as partial while Content-Range supplies total size", async () => {
  const body = validMp4();
  const checksum = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(body).digest("hex"));
  const result = await validateOneDriveAnonymousDownload({ url: "https://public.dm.files.1drv.com/file", expectedSize: body.byteLength, expectedChecksum: checksum, expectedMimeType: "video/mp4", expectedFileName: "pilot.mp4", now: new Date(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), fetcher: fetcherFor(body) });
  assert.equal(result.code, "PASS");
  assert.equal(result.rangeSupport, "SUPPORTED");
  assert.equal(result.diagnostics?.contentLength, body.byteLength);
  assert.equal(result.diagnostics?.contentRange, null);
});

test("expired download URLs produce an actionable result without retrying upload", async () => {
  const body = validMp4();
  const checksum = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(body).digest("hex"));
  const calls: string[] = [];
  const result = await validateOneDriveAnonymousDownload({ url: "https://public.dm.files.1drv.com/file", expectedSize: body.byteLength, expectedChecksum: checksum, expectedMimeType: "video/mp4", expectedFileName: "pilot.mp4", now: new Date(), expiresAt: new Date(Date.now() - 1_000).toISOString(), fetcher: async (url) => { calls.push(url); return { status: 403, headers: new Headers({ "content-type": "text/html" }), url }; } });
  assert.equal(result.code, "ONEDRIVE_DOWNLOAD_URL_EXPIRED");
  assert.equal(calls.length, 2);
});

test("Graph metadata selects the documented downloadUrl annotation", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    return new Response(JSON.stringify({ id: "item-1", name: "pilot.mp4", size: 12, file: { mimeType: "video/mp4" }, "@microsoft.graph.downloadUrl": "https://public.dm.files.1drv.com/file?token=redacted" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const graph = createOneDrivePersonalGraphClient({ getAccessToken: async () => "x".repeat(32) });
    const item = await graph.getItemById("item-1");
    assert.equal(typeof item["@microsoft.graph.downloadUrl"], "string");
    assert.equal(requests[0].includes("?select=id,name,size,file,parentReference,webUrl,@microsoft.graph.downloadUrl"), true);
    assert.equal(requests[0].includes("?$select="), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
