import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { inspectAsset, latestEditorialPackage, openDatabase, saveEditorialPackage, saveSongMatch, upsertAsset, upsertDerivedReel, upsertLocation, upsertReelCandidate } from "../src/database/db.js";
import { generateEditorialPackage } from "../src/editorial/generator.js";
import { stableAssetId } from "../src/media/checksum.js";
import { EMPTY_METADATA } from "../src/shared/types.js";

test("creates SQLite schema and persists asset, location and match", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-db-"));
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: root, VARGEN_REELS_OUTPUT_ROOT: path.join(root, "output"), VARGEN_PIPELINE_STATE_ROOT: path.join(root, "state") }, process.cwd());
  const db = openDatabase(config);
  try {
    const checksum = "a".repeat(64);
    const assetId = stableAssetId(checksum);
    upsertAsset(db, { assetId, checksum, extension: "mp4", fileSize: 100, availability: "LOCAL_AVAILABLE", metadata: EMPTY_METADATA });
    upsertLocation(db, { assetId, relativePath: "Coleção Águas/A Estrela e o Rei.mp4", sourceFilename: "A Estrela e o Rei.mp4", size: 100, mtimeMs: 1 });
    saveSongMatch(db, assetId, { song: { slug: "slug", title: "A Estrela e o Rei", category: "Natal", videoId: null }, status: "MATCHED", method: "EXACT_TITLE", confidence: "EXACT", score: 1 });
    const row = inspectAsset(db, assetId);
    assert.equal(row?.asset_id, assetId);
    assert.equal(row?.relative_path, "Coleção Águas/A Estrela e o Rei.mp4");
    assert.equal(row?.match_status, "MATCHED");
  } finally {
    db.close();
  }
});

test("preserves editorial package versions instead of overwriting history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-editorial-db-"));
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: root, VARGEN_REELS_OUTPUT_ROOT: path.join(root, "output"), VARGEN_PIPELINE_STATE_ROOT: path.join(root, "state") }, process.cwd());
  const db = openDatabase(config);
  try {
    const checksum = "b".repeat(64);
    const assetId = stableAssetId(checksum);
    const candidateId = "candidate-editorial-test";
    const reelId = "reel-editorial-test";
    upsertAsset(db, { assetId, checksum, extension: "mp4", fileSize: 100, availability: "LOCAL_AVAILABLE", metadata: EMPTY_METADATA });
    upsertLocation(db, { assetId, relativePath: "pilot/test.mp4", sourceFilename: "test.mp4", size: 100, mtimeMs: 1 });
    upsertReelCandidate(db, { candidateId, sourceAssetId: assetId, startTimeMs: 0, endTimeMs: 18000, durationMs: 18000, category: "LYRICAL_HOOK", score: 80, selectionReason: "test", status: "VALIDATED", fingerprint: "editorial-test-fingerprint" });
    upsertDerivedReel(db, { reelId, candidateId, sourceAssetId: assetId, outputRelativePath: "pilot/test.mp4", thumbnailRelativePath: "pilot/test.jpg", metadataRelativePath: "pilot/test.metadata.json", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationMs: 18000, fileSize: 100, validationStatus: "PASS", rightsStatus: "RIGHTS_PENDING_CONFIRMATION", sourceChecksumBefore: checksum, sourceChecksumAfter: checksum, templateVersion: "test", processingVersion: "test" });
    const editorial = generateEditorialPackage({ reelId, category: "LYRICAL_HOOK", outputPath: path.join(root, "output", "pilot", "test.mp4"), rightsStatus: "RIGHTS_PENDING_CONFIRMATION" });
    assert.equal(saveEditorialPackage(db, editorial).editorial_version, 1);
    assert.equal(saveEditorialPackage(db, { ...editorial, editorial_title: "Versão editorial revisada" }).editorial_version, 2);
    assert.equal(latestEditorialPackage(db, reelId)?.editorial_version, 2);
  } finally { db.close(); }
});
