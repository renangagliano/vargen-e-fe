import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { inspectAsset, openDatabase, saveSongMatch, upsertAsset, upsertLocation } from "../src/database/db.js";
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
