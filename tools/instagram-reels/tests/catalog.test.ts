import assert from "node:assert/strict";
import test from "node:test";
import { catalogCandidateFingerprint, candidateOverlapRatio, selectCatalogCandidates } from "../src/analysis/candidates.js";
import { generateCatalogEditorialPackage, validateCatalogEditorialPackage } from "../src/editorial/catalog.js";
import type { MediaAnalysisReport, ReelCandidate } from "../src/shared/types.js";

function report(durationMs = 180000): MediaAnalysisReport {
  const samples = Array.from({ length: Math.floor(durationMs / 500) }, (_, index) => {
    const timeMs = index * 500;
    const normalizedEnergy = timeMs > 20000 && timeMs < 65000 ? 0.95 : timeMs > 80000 && timeMs < 135000 ? 0.82 : timeMs > 145000 ? 0.9 : 0.2;
    return { timeMs, rmsDb: -60 + normalizedEnergy * 35, normalizedEnergy };
  });
  return { sourceAssetId: "asset-catalog-test", durationMs, audioSampleCount: samples.length, audioEnergyMinDb: -60, audioEnergyMaxDb: -25, silenceSampleCount: 0, sceneChangeCount: 1, lyricsSynchronized: false, samples };
}

const selector = { minScore: 65, minConfidence: 0.65, maxCandidates: 3, maxOverlapPercent: 50, analysisVersion: "analysis-v1", configurationVersion: "render-v1" };

test("catalog selector supports zero qualified candidates without throwing", () => {
  assert.deepEqual(selectCatalogCandidates(report(120000), { ...selector, minScore: 101 }), []);
  assert.deepEqual(selectCatalogCandidates(report(10000), selector), []);
});

test("catalog selector returns at most three deterministic, distinct candidates", () => {
  const first = selectCatalogCandidates(report(), selector);
  const second = selectCatalogCandidates(report(), selector);
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((item) => item.fingerprint), second.map((item) => item.fingerprint));
  assert.equal(new Set(first.map((item) => item.candidateId)).size, first.length);
  assert.ok(first.every((item) => (item.confidence ?? 0) >= selector.minConfidence));
  for (let left = 0; left < first.length; left += 1) for (let right = left + 1; right < first.length; right += 1) assert.ok(candidateOverlapRatio(first[left], first[right]) <= 0.5);
  assert.equal(catalogCandidateFingerprint("asset", 100, 200, "a", "b"), catalogCandidateFingerprint("asset", 100, 200, "a", "b"));
  assert.notEqual(catalogCandidateFingerprint("asset", 100, 200, "a", "b"), catalogCandidateFingerprint("asset", 100, 200, "a", "c"));
});

test("catalog editorial package flags unsupported Bible reference for review", () => {
  const packageValue = generateCatalogEditorialPackage({ reelId: "reel-catalog-test", songTitle: "Canção de Teste", collection: "Tempo Comum", category: "MAIN_CHORUS", outputPath: "C:/Reels/cancao/reel-01-main-chorus.mp4", rightsStatus: "RIGHTS_PENDING_CONFIRMATION" });
  assert.equal(packageValue.review_status, "READY_FOR_HUMAN_REVIEW");
  assert.equal(packageValue.bible_reference, "");
  assert.equal(packageValue.bible_reference_review_required, true);
  assert.deepEqual(validateCatalogEditorialPackage(packageValue), []);
});

test("catalog candidate metadata retains score breakdown", () => {
  const candidate = selectCatalogCandidates(report(), selector)[0] as ReelCandidate;
  assert.ok(candidate.scoreBreakdown?.audio_energy_score !== undefined);
  assert.equal(candidate.analysisVersion, "analysis-v1");
  assert.equal(candidate.configurationVersion, "render-v1");
});
