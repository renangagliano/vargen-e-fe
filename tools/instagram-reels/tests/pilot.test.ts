import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./review.test.js";
import { openDatabase, latestEditorialPackage } from "../src/database/db.js";
import { confirmSourceRights, RIGHTS_CONFIRMATION_STATEMENT } from "../src/review/rights.js";
import { saveBibleReferenceDraft } from "../src/review/bible.js";
import { approveEditorial } from "../src/publishing/approval.js";
import { runPilotDryRun } from "../src/publishing/pilot.js";
import { MetaPilotApi } from "../src/publishing/meta-pilot-api.js";
import { sanitizeMediaUrl, validateMediaUrlShape, validateTemporaryMediaUrl } from "../src/publishing/temporary-media.js";

function section8FastPath(config: Parameters<typeof openDatabase>[0], reelId: string): void {
  const db = openDatabase(config);
  try {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO section8_editorial_calibrations (calibration_id, reel_id, song_slug, calibration_version, old_overall_score, old_editorial_quality_score, structural_compliance, specificity_score, biblical_alignment_score, song_context_alignment_score, distinctiveness_score, brand_voice_score, narrative_value_score, cta_quality_score, retention_potential_score, duplication_penalty, editorial_quality_score, generic_language_level, generic_phrases_json, duplicate_risk, related_reel_ids_json, bible_classification, review_queue, review_priority_score, review_priority_rank, reasoning_summary, knowledge_context_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`pilot-${reelId}`, reelId, "12-meses-com-deus-quando-as-aguas-se-abriram-marco", "pilot-test", 80, 80, 90, 90, 90, 90, 90, 90, 90, 90, 90, 0, 90, "GENERIC_LOW", "[]", "LOW", "[]", "KNOWLEDGE_CORROBORATED_HIGH", "FAST_PATH", 90, 1, "fixture", "fixture", now, now);
  } finally { db.close(); }
}

test("temporary media validation is public HTTPS-only and sanitizes signed URLs", async () => {
  assert.equal(validateMediaUrlShape("http://example.com/reel.mp4").code, "HTTPS_REQUIRED");
  assert.equal(validateMediaUrlShape("https://127.0.0.1/reel.mp4?secret=not-logged").code, "PUBLIC_URL_REQUIRED");
  assert.equal(sanitizeMediaUrl("https://cdn.example/reel.mp4?signature=secret"), "https://cdn.example/reel.mp4");
  const result = await validateTemporaryMediaUrl("https://cdn.example/reel.mp4?signature=secret", async () => ({ status: 200, headers: new Headers({ "content-type": "video/mp4", "content-length": "42" }) }));
  assert.equal(result.ok, true);
  assert.equal(result.contentLength, 42);
  assert.equal(result.safeUrl.includes("secret"), false);
});

test("Meta pilot API uses official endpoints and mocked traffic only", async () => {
  const requests: Array<{ url: string; method: string; authorization: string }> = [];
  const api = new MetaPilotApi({ accessToken: "raw-test-token", accountId: "account-1", graphApiVersion: "v22.0", fetcher: async (input, init) => {
    const url = String(input);
    requests.push({ url, method: String(init?.method ?? "GET"), authorization: String((init?.headers as Record<string, string>)?.Authorization ?? "") });
    if (url.endsWith("/account-1/media")) return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    if (url.includes("container-1")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    if (url.endsWith("/account-1/media_publish")) return new Response(JSON.stringify({ id: "media-1" }), { status: 200 });
    return new Response(JSON.stringify({ id: "media-1", media_type: "REELS", permalink: "https://instagram.example/p/1", timestamp: "2026-01-01T00:00:00Z" }), { status: 200 });
  } });
  assert.equal((await api.createReelContainer({ videoUrl: "https://cdn.example/reel.mp4?signature=x", caption: "caption" })).containerId, "container-1");
  assert.equal((await api.getContainerStatus("container-1")).status, "FINISHED");
  assert.equal((await api.publishContainer("container-1")).mediaId, "media-1");
  assert.equal((await api.readPublication("media-1")).permalink, "https://instagram.example/p/1");
  assert.equal(requests.filter((request) => request.method === "POST").length, 2);
  assert.ok(requests.every((request) => request.authorization === "Bearer raw-test-token"));
  assert.ok(requests.every((request) => request.url.startsWith("https://graph.instagram.com/v22.0/")));
  assert.ok(requests.every((request) => !request.url.includes("signature=x")));
});

test("pilot dry-run requires CONTENT_READY and cannot create or publish", async () => {
  const item = await fixture();
  section8FastPath(item.config, item.reelId);
  confirmSourceRights(item.assetId, "qa-owner", "Fixture rights", RIGHTS_CONFIRMATION_STATEMENT, item.config);
  await saveBibleReferenceDraft({ reelId: item.reelId, reference: "Êxodo 14", actor: "qa-reviewer", note: "Fixture reference", verify: true }, item.config);
  const db = openDatabase(item.config);
  const version = latestEditorialPackage(db, item.reelId)?.editorial_version ?? 0;
  db.close();
  approveEditorial(item.reelId, version, "qa-editor", "Fixture approval", item.config);
  const outcome = await runPilotDryRun(item.reelId, "qa-pilot", item.config);
  assert.equal(outcome.selection.status, "SELECTED");
  assert.equal(outcome.result?.status, "DRY_RUN_VALIDATED");
  assert.equal(outcome.result?.media_url?.code, "DRY_RUN_ONLY");
  assert.equal(outcome.result?.media_container_created, false);
  assert.equal(outcome.result?.media_publish_called, false);
  assert.equal(outcome.result?.content_published, false);
  assert.equal(outcome.result?.publishing_proven, false);
  const state = openDatabase(item.config);
  try {
    assert.equal((state.prepare("SELECT COUNT(*) AS count FROM pilot_publications").get() as { count: number }).count, 0);
    assert.equal((state.prepare("SELECT COUNT(*) AS count FROM publication_jobs WHERE status = 'PUBLISHED'").get() as { count: number }).count, 0);
  } finally { state.close(); }
});
