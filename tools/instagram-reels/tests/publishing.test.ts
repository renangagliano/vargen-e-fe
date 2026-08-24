import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { confirmRights } from "../src/publishing/rights.js";
import { approveEditorial } from "../src/publishing/approval.js";
import { editEditorialPackage } from "../src/publishing/editorial-edit.js";
import { evaluateEligibility } from "../src/publishing/eligibility.js";
import { DryRunInstagramPublisher, MetaInstagramPublisher, MockInstagramPublisher } from "../src/publishing/publishers.js";
import { cancelPublication, publicationKey, schedulePublication } from "../src/publishing/jobs.js";
import { createPublicationJob, lockPublicationJob, openDatabase, saveEditorialPackage, saveSongMatch, upsertAsset, upsertDerivedReel, upsertLocation, upsertReelCandidate } from "../src/database/db.js";
import { generateEditorialPackage } from "../src/editorial/generator.js";
import { sha256File, stableAssetId } from "../src/media/checksum.js";
import { EMPTY_METADATA } from "../src/shared/types.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-publishing-"));
  const mediaRoot = path.join(root, "source");
  const outputRoot = path.join(root, "reels");
  await fs.mkdir(path.join(mediaRoot, "Águas & Fé"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "pilot"), { recursive: true });
  const sourcePath = path.join(mediaRoot, "Águas & Fé", "Quando as Águas se Abriram.mp4");
  const outputPath = path.join(outputRoot, "pilot", "reel.mp4");
  const coverPath = path.join(outputRoot, "pilot", "reel.cover.jpg");
  await fs.writeFile(sourcePath, "synthetic source");
  await fs.writeFile(outputPath, "synthetic derived");
  await fs.writeFile(coverPath, "synthetic cover");
  await fs.writeFile(path.join(outputRoot, "pilot", "reel.metadata.json"), "{}\n");
  const checksum = await sha256File(sourcePath);
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: mediaRoot, VARGEN_REELS_OUTPUT_ROOT: outputRoot, VARGEN_PIPELINE_STATE_ROOT: path.join(root, "state") }, process.cwd());
  const db = openDatabase(config);
  const assetId = stableAssetId(checksum);
  const candidateId = "candidate-publishing-fixture";
  const reelId = "reel-publishing-fixture";
  upsertAsset(db, { assetId, checksum, extension: "mp4", fileSize: 16, availability: "LOCAL_AVAILABLE", metadata: { ...EMPTY_METADATA, durationMs: 18000, width: 1080, height: 1920, frameRate: 30, videoCodec: "h264", audioCodec: "aac", audioChannels: 2 } });
  upsertLocation(db, { assetId, relativePath: "Águas & Fé/Quando as Águas se Abriram.mp4", sourceFilename: "Quando as Águas se Abriram.mp4", size: 16, mtimeMs: 1 });
  saveSongMatch(db, assetId, { song: { slug: "fixture-song", title: "Quando as Águas se Abriram", category: "12 Meses com Deus", videoId: null }, status: "MATCHED", method: "EXACT_TITLE", confidence: "EXACT", score: 1 });
  upsertReelCandidate(db, { candidateId, sourceAssetId: assetId, startTimeMs: 0, endTimeMs: 18000, durationMs: 18000, category: "LYRICAL_HOOK", score: 80, selectionReason: "fixture", status: "VALIDATED", fingerprint: "publishing-fixture-fingerprint" });
  upsertDerivedReel(db, { reelId, candidateId, sourceAssetId: assetId, outputRelativePath: "pilot/reel.mp4", thumbnailRelativePath: "pilot/reel.cover.jpg", metadataRelativePath: "pilot/reel.metadata.json", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationMs: 18000, fileSize: 16, validationStatus: "PASS", rightsStatus: "RIGHTS_PENDING_CONFIRMATION", sourceChecksumBefore: checksum, sourceChecksumAfter: checksum, templateVersion: "test", processingVersion: "test" });
  const editorial = generateEditorialPackage({ reelId, category: "LYRICAL_HOOK", outputPath, rightsStatus: "RIGHTS_PENDING_CONFIRMATION" });
  saveEditorialPackage(db, { ...editorial, cover_path: coverPath });
  db.close();
  return { root, config, reelId, outputPath };
}

test("rights and approval gates block pending pilot and unlock only deliberate transitions", async () => {
  const item = await fixture();
  assert.equal((await evaluateEligibility(item.reelId, {}, item.config)).status, "BLOCKED");
  confirmRights(item.reelId, "qa-operator", "Rights evidence reviewed", item.config);
  approveEditorial(item.reelId, 1, "qa-editor", "Editorial package reviewed", item.config);
  const result = await evaluateEligibility(item.reelId, {}, item.config);
  assert.equal(result.gates.rights_status, "PASS");
  assert.equal(result.gates.editorial_review, "PASS");
  assert.equal(result.status, "READY_FOR_PUBLISHING");
});

test("editorial material changes create a new version and invalidate approval", async () => {
  const item = await fixture();
  confirmRights(item.reelId, "qa-operator", "Rights evidence reviewed", item.config);
  approveEditorial(item.reelId, 1, "qa-editor", "Approved", item.config);
  const updated = await editEditorialPackage(item.reelId, "qa-editor", { cta: "Salve para revisitar esta mensagem." }, item.config);
  assert.equal(updated.editorial_version, 2);
  assert.equal(updated.review_status, "READY_FOR_HUMAN_REVIEW");
  assert.equal((await evaluateEligibility(item.reelId, {}, item.config)).status, "BLOCKED");
});

test("publication keys are stable and dry-run never returns a real publication", async () => {
  assert.equal(publicationKey("reel", 1, "account", "scheduled:x"), publicationKey("reel", 1, "account", "scheduled:x"));
  assert.notEqual(publicationKey("reel", 1, "account", "scheduled:x"), publicationKey("reel", 1, "account", "scheduled:y"));
  const publisher = new DryRunInstagramPublisher();
  const payload = await publisher.preparePublication({ reelId: "reel", editorialVersion: 1, caption: "caption", coverPath: "cover", targetAccount: "dry-run-account" });
  const result = await publisher.publish({ jobId: "job", payload, mode: "dry-run" });
  assert.equal(result.status, "DRY_RUN_VALIDATED");
  assert.equal(result.remoteMediaId, undefined);
});

test("mock publisher exposes safe success and failure scenarios", async () => {
  const payload = await new MockInstagramPublisher().preparePublication({ reelId: "reel", editorialVersion: 1, caption: "caption", coverPath: "cover", targetAccount: "account" });
  assert.equal((await new MockInstagramPublisher("success").publish({ jobId: "job", payload, mode: "approval" })).status, "PUBLISHED");
  assert.equal((await new MockInstagramPublisher("transient-failure").publish({ jobId: "job", payload, mode: "approval" })).failureClass, "TRANSIENT");
  assert.equal((await new MockInstagramPublisher("permanent-failure").publish({ jobId: "job", payload, mode: "approval" })).failureClass, "PERMANENT");
});

test("Meta publisher fails closed while production eligibility is false", async () => {
  const previous = process.env.META_PRODUCTION_ELIGIBLE;
  process.env.META_PRODUCTION_ELIGIBLE = "false";
  try {
    const publisher = new MetaInstagramPublisher();
    assert.equal(publisher.validateConfiguration().ok, false);
    const payload = await publisher.preparePublication({ reelId: "reel", editorialVersion: 1, caption: "caption", coverPath: "cover", targetAccount: "account" });
    const result = await publisher.publish({ jobId: "job", payload, mode: "approval" });
    assert.equal(result.status, "BLOCKED_EXTERNAL");
    assert.equal(result.errorCode, "META_BUSINESS_VERIFICATION_REQUIRED");
    assert.ok(!JSON.stringify(result).includes("access_token"));
  } finally {
    if (previous === undefined) delete process.env.META_PRODUCTION_ELIGIBLE;
    else process.env.META_PRODUCTION_ELIGIBLE = previous;
  }
});

test("SQLite publication job can be durably locked once", async () => {
  const item = await fixture();
  const db = openDatabase(item.config);
  try {
    const key = publicationKey(item.reelId, 1, "account", "lock-test");
    createPublicationJob(db, { jobId: "job-lock-test", publicationKey: key, reelId: item.reelId, editorialVersion: 1, publisher: "mock", mode: "approval", scheduledAt: new Date(Date.now() - 1000).toISOString(), timezone: "America/Sao_Paulo", status: "SCHEDULED", maxAttempts: 3, payloadJsonSafe: "{}" });
    lockPublicationJob(db, "job-lock-test", "qa-worker", new Date(Date.now() + 60000).toISOString());
    const row = db.prepare("SELECT status, locked_by, attempt_count FROM publication_jobs WHERE publication_job_id = ?").get("job-lock-test") as { status: string; locked_by: string; attempt_count: number };
    assert.equal(row.status, "PUBLISHING");
    assert.equal(row.locked_by, "qa-worker");
    assert.equal(row.attempt_count, 1);
  } finally { db.close(); }
});

test("dry-run schedule can be cancelled without a publisher call", async () => {
  const item = await fixture();
  const scheduled = await schedulePublication(item.reelId, "2030-01-01T18:00:00-03:00", "qa-operator", item.config);
  assert.equal(scheduled.job.status, "SCHEDULED");
  const cancelled = cancelPublication(scheduled.job.publication_job_id, "qa-operator", item.config);
  assert.equal(cancelled.status, "CANCELLED");
});
