import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fixture } from "./review.test.js";
import { openDatabase, latestEditorialPackage } from "../src/database/db.js";
import { approveEditorial } from "../src/publishing/approval.js";
import { saveBibleReferenceDraft } from "../src/review/bible.js";
import { confirmSourceRights, RIGHTS_CONFIRMATION_STATEMENT, rejectSourceRights } from "../src/review/rights.js";
import { evaluateContentReadiness } from "../src/review/readiness.js";
import { endReviewSession, getReviewSession, getReviewSessionProgress, nextReviewItem, selectNextPendingItem, startReviewSession, writeContentReadyManifest, writeSection9ReviewProgressReport } from "../src/review/session.js";
import { createReviewServer } from "../src/review/server.js";
import type { ReviewItem } from "../src/review/service.js";
import type { MediaConfig } from "../src/config/index.js";

function addSection8Queue(config: MediaConfig, reelId: string, queue: "FAST_PATH" | "STANDARD_REVIEW"): void {
  const db = openDatabase(config);
  try {
    db.prepare(`INSERT INTO section8_editorial_calibrations (calibration_id, reel_id, song_slug, calibration_version, old_overall_score, old_editorial_quality_score, structural_compliance, specificity_score, biblical_alignment_score, song_context_alignment_score, distinctiveness_score, brand_voice_score, narrative_value_score, cta_quality_score, retention_potential_score, duplication_penalty, editorial_quality_score, generic_language_level, generic_phrases_json, duplicate_risk, related_reel_ids_json, bible_classification, review_queue, review_priority_score, review_priority_rank, reasoning_summary, knowledge_context_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `s8-${reelId}`, reelId, "fixture", "phase8-test", 80, 80, 90, 90, 90, 90, 90, 90, 90, 90, 90, 0, 90, "GENERIC_LOW", "[]", "LOW", "[]", "KNOWLEDGE_CORROBORATED_HIGH", queue, 90, 1, "fixture", "hash", new Date().toISOString(), new Date().toISOString(),
    );
  } finally { db.close(); }
}

test("review sessions persist, resume and use Section 8 queue semantics", async () => {
  const item = await fixture();
  addSection8Queue(item.config, item.reelId, "FAST_PATH");
  const session = startReviewSession("FAST_PATH", "qa-session", {}, item.config);
  const before = await getReviewSessionProgress(session.session_id, item.config);
  assert.equal(before.total, 1);
  assert.equal(before.pending, 1);
  assert.equal(before.next_reel_id, item.reelId);
  const next = await nextReviewItem(session.session_id, item.config);
  assert.equal(next.item?.reel_id, item.reelId);
  assert.equal(getReviewSession(session.session_id, item.config)?.current_reel_id, item.reelId);
  const resumed = await getReviewSessionProgress(session.session_id, item.config);
  assert.equal(resumed.current_reel_id, item.reelId);
  const ended = endReviewSession(session.session_id, "qa-session", item.config);
  assert.ok(ended.ended_at);
  const db = openDatabase(item.config);
  try { assert.equal((db.prepare("SELECT COUNT(*) AS count FROM publication_audit_events WHERE entity_id = ? AND event_type IN ('REVIEW_SESSION_STARTED','REVIEW_SESSION_ENDED')").get(session.session_id) as { count: number }).count, 2); } finally { db.close(); }
});

test("next pending selection respects queue and human review status", () => {
  const base = { reel_id: "one", editorial: { review_status: "READY_FOR_HUMAN_REVIEW" } } as unknown as ReviewItem;
  const standard = { ...base, reel_id: "two", section8_calibration: { review_queue: "STANDARD_REVIEW" } } as unknown as ReviewItem;
  const fast = { ...base, section8_calibration: { review_queue: "FAST_PATH" } } as unknown as ReviewItem;
  assert.equal(selectNextPendingItem([standard, fast], "FAST_PATH")?.reel_id, "one");
  assert.equal(selectNextPendingItem([standard, fast], "STANDARD_REVIEW")?.reel_id, "two");
  assert.equal(selectNextPendingItem([{ ...fast, editorial: { review_status: "APPROVED" } } as unknown as ReviewItem], "FAST_PATH"), null);
});

test("CONTENT_READY inventory is exclusive and revocation removes stale entries", async () => {
  const item = await fixture();
  confirmSourceRights(item.assetId, "qa-owner", "Fixture rights", RIGHTS_CONFIRMATION_STATEMENT, item.config);
  await saveBibleReferenceDraft({ reelId: item.reelId, reference: "Êxodo 14", actor: "qa-reviewer", note: "Fixture Bible", verify: true }, item.config);
  const db = openDatabase(item.config); const version = latestEditorialPackage(db, item.reelId)?.editorial_version ?? 0; db.close();
  approveEditorial(item.reelId, version, "qa-editor", "Fixture approval", item.config);
  assert.equal((await evaluateContentReadiness(item.reelId, item.config)).status, "CONTENT_READY");
  const manifest = await writeContentReadyManifest(item.config);
  assert.equal(manifest.count, 1);
  const parsed = JSON.parse(await fs.readFile(manifest.jsonPath, "utf8")) as { items: Array<{ reel_id: string }> };
  assert.equal(parsed.items[0]?.reel_id, item.reelId);
  rejectSourceRights(item.assetId, "qa-owner", "Fixture revocation", item.config);
  assert.equal((await writeContentReadyManifest(item.config)).count, 0);
});

test("Section 9 reports progress without changing human state", async () => {
  const item = await fixture();
  const report = await writeSection9ReviewProgressReport(item.config);
  const parsed = JSON.parse(await fs.readFile(report.jsonPath, "utf8")) as { primary_total: number; human_reviewed: number; content_ready: number };
  assert.equal(parsed.primary_total, 1);
  assert.equal(parsed.human_reviewed, 0);
  assert.equal(parsed.content_ready, 0);
});

test("Section 9 cockpit exposes session routes and remains localhost-only", async () => {
  const item = await fixture();
  const server = createReviewServer(item.config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number; address: string };
  assert.equal(address.address, "127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/review/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewer: "qa-cockpit", queue: "FAST_PATH" }) });
  assert.equal(response.status, 201);
  const body = await response.json() as { session_id: string; queue: string };
  assert.equal(body.queue, "FAST_PATH");
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
