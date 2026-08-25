import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixture } from "./review.test.js";
import { openDatabase, temporaryMediaByReel } from "../src/database/db.js";
import { OneDrivePersonalTemporaryMediaProvider, validateOneDriveAnonymousDownload, type OneDriveDriveItem, type OneDrivePersonalGraphClient } from "../src/publishing/onedrive-personal-temporary-media.js";
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
    headers: new Headers({ "content-type": contentType, "content-length": String(body.byteLength) }),
    url,
    body: new Uint8Array(body),
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
  await assert.rejects(() => provider.prepareTemporaryMedia(input(item.reelId, checksum)), /PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED/);
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
  const base = { url: "https://public.dm.files.1drv.com/file", expectedSize: body.byteLength, expectedChecksum: checksum, now: new Date("2026-08-25T12:00:00.000Z"), expiresAt: "2026-08-25T13:00:00.000Z" };
  const html = await validateOneDriveAnonymousDownload({ ...base, fetcher: fetcherFor(Buffer.from("<html>login</html>"), "text/html") });
  assert.equal(html.code, "LOGIN_PAGE_REJECTED");
  const wrongType = await validateOneDriveAnonymousDownload({ ...base, fetcher: fetcherFor(body, "application/octet-stream") });
  assert.equal(wrongType.code, "CONTENT_TYPE_INVALID");
  const mismatch = await validateOneDriveAnonymousDownload({ ...base, expectedChecksum: "0".repeat(64), fetcher: fetcherFor(body) });
  assert.equal(mismatch.code, "CHECKSUM_MISMATCH");
  const redirect = await validateOneDriveAnonymousDownload({ ...base, fetcher: async (url) => ({ status: 302, headers: new Headers({ location: "https://evil.example/file" }), url, location: "https://evil.example/file" }) });
  assert.equal(redirect.code, "UNTRUSTED_REDIRECT");
});
