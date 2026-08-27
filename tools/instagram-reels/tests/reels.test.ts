import assert from "node:assert/strict";
import test from "node:test";
import { candidateFingerprint, candidateOverlapRatio, selectCandidates } from "../src/analysis/candidates.js";
import { buildVerticalFilter, outputFilename } from "../src/reels/factory.js";
import type { MediaAnalysisReport } from "../src/shared/types.js";

function syntheticReport(): MediaAnalysisReport {
  const samples = Array.from({ length: 300 }, (_, index) => {
    const timeMs = index * 500;
    const normalizedEnergy = timeMs > 30000 && timeMs < 60000 ? 0.95 : timeMs > 80000 && timeMs < 125000 ? 0.82 : timeMs > 150000 && timeMs < 205000 ? 0.9 : 0.2;
    return { timeMs, rmsDb: -60 + normalizedEnergy * 35, normalizedEnergy };
  });
  return { sourceAssetId: "asset-test", durationMs: 150000, audioSampleCount: samples.length, audioEnergyMinDb: -60, audioEnergyMaxDb: -25, silenceSampleCount: 0, sceneChangeCount: 2, lyricsSynchronized: false, samples };
}

test("selects three distinct duration candidates with bounded overlap", () => {
  const candidates = selectCandidates(syntheticReport());
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((candidate) => candidate.durationMs), [18000, 30000, 52000]);
  assert.ok(candidateOverlapRatio(candidates[0], candidates[1]) <= 0.5);
  assert.ok(candidateOverlapRatio(candidates[0], candidates[2]) <= 0.5);
  assert.ok(candidateOverlapRatio(candidates[1], candidates[2]) <= 0.5);
  assert.equal(candidateFingerprint("asset-test", 0, 18000), "asset-test:0:18000:phase3-heuristic-v1");
});

test("builds a non-distorting 1080x1920 composition with safe brand overlay", () => {
  const filter = buildVerticalFilter(true);
  assert.match(filter, /scale=1080:1920:force_original_aspect_ratio=increase/);
  assert.match(filter, /scale=1080:-2/);
  assert.match(filter, /overlay=\(W-w\)\/2:120/);
  assert.match(filter, /format=yuv420p/);
});

test("uses explicit, human-readable pilot output names", () => {
  assert.equal(outputFilename(1, "LYRICAL_HOOK"), "reel-01-hook");
  assert.equal(outputFilename(2, "MAIN_CHORUS"), "reel-02-main-chorus");
  assert.equal(outputFilename(3, "STORY_BUILD"), "reel-03-story-build");
});
