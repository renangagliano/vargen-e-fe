import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { openDatabase } from "../src/database/db.js";
import { generateCatalogEditorialPackage } from "../src/editorial/catalog.js";
import { resolveBibleReference, normalizeBibleReference } from "../src/curation/bible.js";
import { calculateOverlapPercentage, qualityTierForScore, textSimilarity } from "../src/curation/engine.js";

test("curation quality tiers expose calibrated score bands", () => {
  assert.equal(qualityTierForScore(92), "TIER_A");
  assert.equal(qualityTierForScore(79), "TIER_B");
  assert.equal(qualityTierForScore(64), "TIER_C");
  assert.equal(qualityTierForScore(45), "TIER_D");
  assert.equal(qualityTierForScore(20), "TIER_REJECT");
});

test("curation measures temporal and editorial distinctiveness", () => {
  assert.equal(calculateOverlapPercentage({ startTimeMs: 0, endTimeMs: 1000 }, { startTimeMs: 500, endTimeMs: 1500 }), 50);
  assert.equal(calculateOverlapPercentage({ startTimeMs: 0, endTimeMs: 1000 }, { startTimeMs: 2000, endTimeMs: 3000 }), 0);
  assert.equal(textSimilarity("fé para avançar", "fé para avançar"), 1);
  assert.ok(textSimilarity("fé para avançar", "guitarra e estrada") < 0.5);
});

test("Bible resolver preserves only authoritative references and flags conflicts", () => {
  const missing = generateCatalogEditorialPackage({ reelId: "reel-bible-test", songTitle: "Canção", collection: "Tempo Comum", category: "MAIN_CHORUS", outputPath: "C:/Reels/cancao.mp4", rightsStatus: "RIGHTS_PENDING_CONFIRMATION" });
  assert.equal(resolveBibleReference(missing).status, "MISSING");
  assert.equal(resolveBibleReference(missing, "Êxodo 14").status, "VERIFIED");
  assert.equal(normalizeBibleReference(" Lucas 3, 15–16 "), "Lucas 3,15-16");
  const conflict = { ...missing, bible_reference: "João 14,27", bible_reference_review_required: false };
  assert.equal(resolveBibleReference(conflict, "Êxodo 14").status, "CONFLICT");
});

test("curation migration is durable and isolated in SQLite state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-curation-db-"));
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: root, VARGEN_REELS_OUTPUT_ROOT: path.join(root, "output"), VARGEN_PIPELINE_STATE_ROOT: path.join(root, "state") }, process.cwd());
  const db = openDatabase(config);
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reel_curations'").get() as { name?: string } | undefined;
    assert.equal(row?.name, "reel_curations");
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_reel_curations_asset'").get() as { name?: string } | undefined;
    assert.equal(index?.name, "idx_reel_curations_asset");
  } finally {
    db.close();
  }
});
