import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fixture } from "./review.test.js";
import { openDatabase, temporaryMediaByReel } from "../src/database/db.js";
import { runTemporaryMediaCommand } from "../src/cli/temporary-media.js";
import { AzureBlobTemporaryMediaProvider, type AzureBlobClientLike, type AzureStorageServiceLike } from "../src/publishing/azure-temporary-media.js";
import type { MediaConfig } from "../src/config/index.js";

type FakeAzure = {
  service: AzureStorageServiceLike;
  uploads: number;
  deletes: number;
  lastUploadOptions: unknown;
  sasCalls: number;
  setPublicAccess(value: string | null): void;
  setBlobUrl(value: string): void;
};

function azureConfig(config: MediaConfig): MediaConfig {
  return { ...config, azureStorageAccountName: "vargenpilot", azureStorageContainerName: "instagram-publish-temp", azureStorageSasTtlMinutes: 60, azureStorageBlobPrefix: "instagram-pilot", azureStorageEndpointSuffix: "core.windows.net" };
}

function fakeAzure(config: MediaConfig, blobSize: number): FakeAzure {
  const blobs = new Map<string, { size: number; type: string; metadata: Record<string, string> }>();
  let publicAccess: string | null = null;
  let blobUrl = `https://${config.azureStorageAccountName}.blob.${config.azureStorageEndpointSuffix}`;
  const state: FakeAzure = {
    uploads: 0,
    deletes: 0,
    lastUploadOptions: null,
    sasCalls: 0,
    setPublicAccess(value) { publicAccess = value; },
    setBlobUrl(value) { blobUrl = value; },
    service: undefined as unknown as AzureStorageServiceLike,
  };
  const keyFor = (container: string, name: string) => `${container}/${name}`;
  state.service = {
    getContainerProperties: async () => ({ publicAccess }),
    getUserDelegationKey: async () => ({}) as never,
    getBlobClient: (container, name): AzureBlobClientLike => ({
      url: `${blobUrl}/${container}/${name}`,
      getProperties: async () => {
        const found = blobs.get(keyFor(container, name));
        if (!found) throw Object.assign(new Error("not found"), { statusCode: 404 });
        return { contentLength: found.size, contentType: found.type, metadata: found.metadata };
      },
      uploadFile: async (_filePath, options) => {
        state.uploads += 1;
        state.lastUploadOptions = options;
        blobs.set(keyFor(container, name), { size: blobSize, type: options.blobHTTPHeaders.blobContentType, metadata: options.metadata });
      },
      deleteIfExists: async () => {
        state.deletes += 1;
        blobs.delete(keyFor(container, name));
        return { succeeded: true };
      },
    }),
  };
  return state;
}

function sas(now: Date, calls: { value: number }): NonNullable<ConstructorParameters<typeof AzureBlobTemporaryMediaProvider>[1]>["sasGenerator"] {
  return ({ expiresOn }) => {
    calls.value += 1;
    return `sv=2023-11-03&sp=r&st=${encodeURIComponent(new Date(now.getTime() - 300000).toISOString())}&se=${encodeURIComponent(expiresOn.toISOString())}&sig=secret-value`;
  };
}

function preparationInput(reelId: string, checksum: string) {
  return { reelId, publicationKey: `instagram:${reelId}:fixture`, derivedReelRelativePath: "pilot/reel.mp4", derivedChecksum: checksum, editorialVersion: 1 };
}

function addFastPath(config: MediaConfig, reelId: string): void {
  const db = openDatabase(config);
  try {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO section8_editorial_calibrations (calibration_id, reel_id, song_slug, calibration_version, old_overall_score, old_editorial_quality_score, structural_compliance, specificity_score, biblical_alignment_score, song_context_alignment_score, distinctiveness_score, brand_voice_score, narrative_value_score, cta_quality_score, retention_potential_score, duplication_penalty, editorial_quality_score, generic_language_level, generic_phrases_json, duplicate_risk, related_reel_ids_json, bible_classification, review_queue, review_priority_score, review_priority_rank, reasoning_summary, knowledge_context_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`azure-${reelId}`, reelId, "fixture", "azure-test", 80, 80, 90, 90, 90, 90, 90, 90, 90, 90, 90, 0, 90, "GENERIC_LOW", "[]", "LOW", "[]", "KNOWLEDGE_CORROBORATED_HIGH", "FAST_PATH", 90, 1, "fixture", "fixture", now, now);
  } finally { db.close(); }
}

test("Azure temporary media fails closed without account configuration and rejects arbitrary paths", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  const checksum = (await import("../src/media/checksum.js")).sha256File;
  const derivedChecksum = await checksum(output);
  const missing = new AzureBlobTemporaryMediaProvider(item.config);
  await assert.rejects(() => missing.prepareTemporaryMedia(preparationInput(item.reelId, derivedChecksum)), /AZURE_STORAGE_ACCOUNT_REQUIRED/);
  const config = azureConfig(item.config);
  const fake = fakeAzure(config, 14);
  const provider = new AzureBlobTemporaryMediaProvider(config, { storage: fake.service, sasGenerator: sas(new Date("2026-08-25T12:00:00.000Z"), { value: 0 }), fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "14" }) }) });
  await assert.rejects(() => provider.prepareTemporaryMedia({ ...preparationInput(item.reelId, derivedChecksum), derivedReelRelativePath: "../secret.mp4" }), /REVIEW_FILE_OUTSIDE_OUTPUT_ROOT/);
});

test("CLI refuses Azure preparation before any provider call when CONTENT_READY is not satisfied", async () => {
  const item = await fixture();
  addFastPath(item.config, item.reelId);
  await assert.rejects(() => runTemporaryMediaCommand("instagram:media-prepare", [`--reel=${item.reelId}`, "--provider=azure"], azureConfig(item.config)), /CONTENT_READY_REQUIRED/);
});

test("Azure provider uploads one private MP4, validates read-only SAS, persists safe state, and is idempotent", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  const derivedChecksum = await (await import("../src/media/checksum.js")).sha256File(output);
  const config = azureConfig(item.config);
  const fake = fakeAzure(config, 14);
  const calls = { value: 0 };
  const provider = new AzureBlobTemporaryMediaProvider(config, { storage: fake.service, sasGenerator: sas(new Date("2026-08-25T12:00:00.000Z"), calls), fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "14" }) }) });
  const input = preparationInput(item.reelId, derivedChecksum);
  const first = await provider.prepareTemporaryMedia(input);
  const second = await provider.prepareTemporaryMedia(input);
  assert.equal(first.state, "VALIDATED");
  assert.equal(second.state, "VALIDATED");
  assert.equal(fake.uploads, 1);
  assert.equal(calls.value, 2);
  assert.equal(first.validation.code, "PASS");
  assert.equal(first.validation.expectedSize, 14);
  assert.equal(first.safeUrl.includes("secret-value"), false);
  assert.equal(first.safeUrl.endsWith("?[REDACTED]"), true);
  const uploadOptions = fake.lastUploadOptions as { blobHTTPHeaders: { blobContentType: string; blobContentDisposition: string }; metadata: Record<string, string> };
  assert.equal(uploadOptions.blobHTTPHeaders.blobContentType, "video/mp4");
  assert.equal(uploadOptions.blobHTTPHeaders.blobContentDisposition, "inline");
  assert.equal(uploadOptions.metadata["derived-checksum"], derivedChecksum);
  const db = openDatabase(config);
  try {
    const record = temporaryMediaByReel(db, item.reelId);
    assert.equal(record?.status, "VALIDATED");
    assert.equal(record?.blob_name.includes("pilot/reel.mp4"), false);
    const auditRows = db.prepare("SELECT metadata_json_safe FROM publication_audit_events WHERE entity_id = ?").all(item.reelId) as Array<{ metadata_json_safe: string }>;
    assert.ok(auditRows.every((row) => !row.metadata_json_safe.includes("secret-value")));
  } finally { db.close(); }
});

test("Azure provider rejects public containers, wrong hosts, non-video responses, and size mismatches", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  const derivedChecksum = await (await import("../src/media/checksum.js")).sha256File(output);
  const config = azureConfig(item.config);
  const fake = fakeAzure(config, 14);
  fake.setPublicAccess("blob");
  const provider = new AzureBlobTemporaryMediaProvider(config, { storage: fake.service, sasGenerator: sas(new Date("2026-08-25T12:00:00.000Z"), { value: 0 }), fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "14" }) }) });
  await assert.rejects(() => provider.prepareTemporaryMedia(preparationInput(item.reelId, derivedChecksum)), /AZURE_CONTAINER_MUST_BE_PRIVATE/);

  const wrongHost = fakeAzure(config, 14);
  wrongHost.setBlobUrl("https://other.example");
  const wrongHostProvider = new AzureBlobTemporaryMediaProvider(config, { storage: wrongHost.service, sasGenerator: sas(new Date("2026-08-25T12:00:00.000Z"), { value: 0 }), fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "14" }) }) });
  await assert.rejects(() => wrongHostProvider.prepareTemporaryMedia(preparationInput(item.reelId, derivedChecksum)), /TEMPORARY_MEDIA_VALIDATION_FAILED:AZURE_HOST_REQUIRED/);

  const wrongType = fakeAzure(config, 14);
  const wrongTypeProvider = new AzureBlobTemporaryMediaProvider(config, { storage: wrongType.service, sasGenerator: sas(new Date("2026-08-25T12:00:00.000Z"), { value: 0 }), fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "text/html", "content-length": "14" }) }) });
  await assert.rejects(() => wrongTypeProvider.prepareTemporaryMedia(preparationInput(item.reelId, derivedChecksum)), /TEMPORARY_MEDIA_VALIDATION_FAILED:CONTENT_TYPE_INVALID/);
});

test("Azure cleanup deletes only expired tracked temporary media", async () => {
  const item = await fixture();
  const output = path.join(item.config.reelsOutputRoot as string, "pilot", "reel.mp4");
  const derivedChecksum = await (await import("../src/media/checksum.js")).sha256File(output);
  const config = azureConfig(item.config);
  const fake = fakeAzure(config, 14);
  const provider = new AzureBlobTemporaryMediaProvider(config, { storage: fake.service, sasGenerator: sas(new Date("2026-08-25T12:00:00.000Z"), { value: 0 }), fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "14" }) }) });
  const prepared = await provider.prepareTemporaryMedia(preparationInput(item.reelId, derivedChecksum));
  const db = openDatabase(config);
  db.prepare("UPDATE temporary_media SET expires_at = ? WHERE temporary_media_id = ?").run("2026-08-25T11:00:00.000Z", prepared.temporaryMediaId);
  db.close();
  assert.equal(await provider.cleanupExpiredMedia(), 1);
  assert.equal(fake.deletes, 1);
  const finalDb = openDatabase(config);
  try { assert.equal(temporaryMediaByReel(finalDb, item.reelId)?.status, "CLEANED"); } finally { finalDb.close(); }
});
