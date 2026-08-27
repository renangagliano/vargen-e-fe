import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./review.test.js";
import { latestEditorialPackage, openDatabase, saveEditorialPackage } from "../src/database/db.js";
import { applyEditorialSuggestion } from "../src/ai/apply.js";
import { aiReviewForReel, runAiReview } from "../src/ai/engine.js";
import { DeterministicLocalProvider, validateScore } from "../src/ai/provider.js";

test("AI scores are normalized and deterministic Bible fallback is fail-closed", async () => {
  assert.equal(validateScore(0), true);
  assert.equal(validateScore(100), true);
  assert.equal(validateScore(101), false);
  const item = await fixture();
  const result = await runAiReview({ mode: "reel", reelId: item.reelId }, item.config);
  assert.equal(result.results.length, 1);
  assert.ok(result.results[0].overall_ai_score >= 0 && result.results[0].overall_ai_score <= 100);
  assert.ok(["INSUFFICIENT_EVIDENCE", "HUMAN_VERIFIED"].includes(result.bible[0].status));
  assert.ok(result.bible[0].status !== "AI_SUGGESTED");
});

test("AI persistence is idempotent and isolated from human rights/review state", async () => {
  const item = await fixture();
  await runAiReview({ mode: "reel", reelId: item.reelId }, item.config);
  await runAiReview({ mode: "reel", reelId: item.reelId }, item.config);
  const db = openDatabase(item.config);
  try {
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM ai_reel_reviews WHERE reel_id = ?").get(item.reelId) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT rights_status FROM derived_reels WHERE reel_id = ?").get(item.reelId) as { rights_status: string }).rights_status, "RIGHTS_PENDING_CONFIRMATION");
    assert.equal(latestEditorialPackage(db, item.reelId)?.review_status, "READY_FOR_HUMAN_REVIEW");
  } finally { db.close(); }
});

test("applying an AI suggestion is explicit, versioned and invalidates approval", async () => {
  const item = await fixture();
  const db = openDatabase(item.config);
  const current = latestEditorialPackage(db, item.reelId);
  if (!current) throw new Error("FIXTURE_EDITORIAL_MISSING");
  saveEditorialPackage(db, { ...current, selected_hook: "Este hook determinístico é deliberadamente longo para que o pre-review sugira uma versão mais curta e legível no celular.", review_status: "APPROVED" });
  db.close();
  await runAiReview({ mode: "reel", reelId: item.reelId }, item.config);
  const before = openDatabase(item.config); const beforeVersion = latestEditorialPackage(before, item.reelId)?.editorial_version ?? 0; before.close();
  const stored = await applyEditorialSuggestion(item.reelId, ["selected_hook"], "qa-ai-operator", "Aplicação manual de sugestão", item.config);
  assert.ok(stored.editorial_version > beforeVersion);
  assert.equal(stored.review_status, "READY_FOR_HUMAN_REVIEW");
});

test("local provider does not require an external model", () => {
  assert.equal(new DeterministicLocalProvider().name, "DeterministicLocalProvider");
});
