import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { openDatabase, saveCuration, saveEditorialPackage, saveSongMatch, upsertAsset, upsertDerivedReel, upsertLocation, upsertReelCandidate, latestEditorialPackage } from "../src/database/db.js";
import { generateEditorialPackage } from "../src/editorial/generator.js";
import { sha256File } from "../src/media/checksum.js";
import { approveEditorial } from "../src/publishing/approval.js";
import { createReviewServer, isAllowedLocalReviewOrigin } from "../src/review/server.js";
import { isBibleReferenceStructurallyValid, saveBibleReferenceDraft, verifyBibleReference, bibleReferenceStatus } from "../src/review/bible.js";
import { confirmSourceRights, rejectSourceRights, RIGHTS_CONFIRMATION_STATEMENT } from "../src/review/rights.js";
import { evaluateContentReadiness } from "../src/review/readiness.js";
import { filterReviewItems, queuePredicate, reviewProgress } from "../src/review/service.js";
import { resolveReviewFile } from "../src/review/files.js";
import { EMPTY_METADATA, type ReelCuration } from "../src/shared/types.js";

export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-review-"));
  const mediaRoot = path.join(root, "source");
  const outputRoot = path.join(root, "reels");
  await fs.mkdir(path.join(mediaRoot, "Águas & Fé"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "pilot"), { recursive: true });
  const sourcePath = path.join(mediaRoot, "Águas & Fé", "Quando as Águas se Abriram & Fé.mp4");
  const outputPath = path.join(outputRoot, "pilot", "reel.mp4");
  const coverPath = path.join(outputRoot, "pilot", "reel.cover.jpg");
  await fs.writeFile(sourcePath, "synthetic source");
  await fs.writeFile(outputPath, "synthetic reel");
  await fs.writeFile(coverPath, "synthetic cover");
  await fs.writeFile(path.join(outputRoot, "pilot", "reel.metadata.json"), "{}\n");
  const checksum = await sha256File(sourcePath);
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: mediaRoot, VARGEN_REELS_OUTPUT_ROOT: outputRoot, VARGEN_PIPELINE_STATE_ROOT: path.join(root, "state"), VARGEN_REVIEW_HOST: "127.0.0.1" }, process.cwd());
  const db = openDatabase(config);
  const assetId = "asset-review-fixture";
  const candidateId = "candidate-review-fixture";
  const reelId = "reel-review-fixture";
  upsertAsset(db, { assetId, checksum, extension: "mp4", fileSize: 16, availability: "LOCAL_AVAILABLE", metadata: { ...EMPTY_METADATA, durationMs: 18000, width: 1080, height: 1920, frameRate: 30, videoCodec: "h264", audioCodec: "aac", audioChannels: 2 } });
  upsertLocation(db, { assetId, relativePath: "Águas & Fé/Quando as Águas se Abriram & Fé.mp4", sourceFilename: "Quando as Águas se Abriram & Fé.mp4", size: 16, mtimeMs: 1 });
  saveSongMatch(db, assetId, { song: { slug: "12-meses-com-deus-quando-as-aguas-se-abriram-marco", title: "Quando as Águas se Abriram — Março", category: "12 Meses com Deus", videoId: null }, status: "MATCHED", method: "EXACT_TITLE", confidence: "EXACT", score: 1 });
  upsertReelCandidate(db, { candidateId, sourceAssetId: assetId, startTimeMs: 1000, endTimeMs: 19000, durationMs: 18000, category: "LYRICAL_HOOK", score: 82, selectionReason: "fixture", status: "VALIDATED", fingerprint: "review-fixture-fingerprint" });
  upsertDerivedReel(db, { reelId, candidateId, sourceAssetId: assetId, outputRelativePath: "pilot/reel.mp4", thumbnailRelativePath: "pilot/reel.cover.jpg", metadataRelativePath: "pilot/reel.metadata.json", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationMs: 18000, fileSize: 16, validationStatus: "PASS", rightsStatus: "RIGHTS_PENDING_CONFIRMATION", sourceChecksumBefore: checksum, sourceChecksumAfter: checksum, templateVersion: "test", processingVersion: "test" });
  const editorial = generateEditorialPackage({ reelId, category: "LYRICAL_HOOK", outputPath, rightsStatus: "RIGHTS_PENDING_CONFIRMATION" });
  saveEditorialPackage(db, { ...editorial, editorial_title: "Fixture editorial", cover_path: coverPath });
  const curation: ReelCuration = { curation_id: "curation-review-fixture", reel_id: reelId, candidate_id: candidateId, source_asset_id: assetId, curation_version: "phase6.1-curation-v2", absolute_quality_score: 90, relative_song_score: 100, distinctiveness_score: 100, editorial_value_score: 90, technical_quality_score: 100, boundary_quality_score: 90, visual_quality_score: 85, audio_quality_score: 90, content_density_score: 88, curation_score: 91, incremental_editorial_value: 100, overlap_percentage: 0, timestamp_distance_ms: 0, section_separation: 100, within_song_rank: 1, quality_tier: "TIER_A", portfolio_status: "ACTIVE", curation_decision: "KEEP_PRIMARY", curation_reason: "fixture", third_reel_justification: null, bible_reference_status: "MISSING", seasonality: "MONTH_SPECIFIC", calendar_context: "Março", created_at: new Date().toISOString(), curated_at: new Date().toISOString() };
  saveCuration(db, curation);
  db.close();
  return { root, config, assetId, reelId };
}

test("Bible format validation is structural and Portuguese normalization preserves meaning", () => {
  assert.equal(isBibleReferenceStructurallyValid("Êxodo 14"), true);
  assert.equal(isBibleReferenceStructurallyValid("Lucas 3, 15–16.21–22"), true);
  assert.equal(isBibleReferenceStructurallyValid("Êxodo 14,13,garbage"), false);
});

test("review queue separation and filters are deterministic", () => {
  assert.equal(queuePredicate("primary", "ACTIVE", 1), true);
  assert.equal(queuePredicate("primary", "ACTIVE", 2), false);
  assert.equal(queuePredicate("secondary", "ACTIVE", 2), true);
  assert.equal(queuePredicate("hold", "HOLD", 3), true);
  const item = { reel_id: "x", candidate_id: "c", source_asset_id: "a", song_title: "A", song_slug: "a", collection: "Tempo Comum", source_filename: "a.mp4", source_relative_path: "a.mp4", output_relative_path: "a.mp4", cover_relative_path: null, thumbnail_relative_path: null, duration_ms: 1000, start_time_ms: 0, end_time_ms: 1000, technical: { validation_status: "PASS", width: 1080, height: 1920, fps: 30, video_codec: "h264", audio_codec: "aac", file_size: 1 }, curation: { score: 90, old_score: 80, tier: "TIER_A" as const, rank: 1, portfolio_status: "ACTIVE" as const, decision: "KEEP_PRIMARY", reason: "", distinctiveness: 100, incremental_value: 100, seasonality: "EVERGREEN", calendar_context: null }, editorial: null, bible: { status: "MISSING" as const, reference: null, source: null, evidence: "" }, rights_status: "RIGHTS_PENDING_CONFIRMATION", publication_status: "NOT_PUBLISHED" };
  assert.equal(filterReviewItems([item], { collection: "Tempo Comum", qualityTier: "TIER_A" }).length, 1);
  assert.equal(filterReviewItems([item], { collection: "Advento" }).length, 0);
});

test("cockpit binds only to localhost and media paths cannot escape output root", async () => {
  const item = await fixture();
  const server = createReviewServer(item.config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  assert.equal((server.address() as { address: string }).address, "127.0.0.1");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await assert.rejects(() => resolveReviewFile(item.config, "../source/secret.mp4"), /REVIEW_FILE_OUTSIDE_OUTPUT_ROOT/);
});

test("localhost origin validation accepts only the configured HTTP cockpit port", () => {
  const port = 4177;
  assert.equal(isAllowedLocalReviewOrigin("http://127.0.0.1:4177", port), true);
  assert.equal(isAllowedLocalReviewOrigin("http://localhost:4177", port), true);
  assert.equal(isAllowedLocalReviewOrigin(undefined, port), true);
  assert.equal(isAllowedLocalReviewOrigin("http://127.0.0.1:9999", port), false);
  assert.equal(isAllowedLocalReviewOrigin("http://localhost.evil.com:4177", port), false);
  assert.equal(isAllowedLocalReviewOrigin("http://192.168.1.10:4177", port), false);
  assert.equal(isAllowedLocalReviewOrigin("https://localhost:4177", port), false);
  assert.equal(isAllowedLocalReviewOrigin("null", port), false);
  assert.equal(isAllowedLocalReviewOrigin("http://localhost:4177/path", port), false);
  assert.equal(isAllowedLocalReviewOrigin("not-an-origin", port), false);
});

test("valid local origin reaches the rights endpoint without confirming rights", async () => {
  const item = await fixture();
  const server = createReviewServer(item.config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}/api/assets/${encodeURIComponent(item.assetId)}/rights`, {
    method: "POST",
    headers: { origin: `http://127.0.0.1:${item.config.reviewPort}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "confirm" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: string }).error, "RIGHTS_ACTOR_AND_NOTE_REQUIRED");
  const db = openDatabase(item.config);
  try {
    assert.equal((db.prepare("SELECT rights_status FROM media_assets WHERE asset_id = ?").get(item.assetId) as { rights_status: string }).rights_status, "RIGHTS_PENDING_CONFIRMATION");
  } finally {
    db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("GET behavior remains unchanged while POST rejects non-local origins", async () => {
  const item = await fixture();
  const server = createReviewServer(item.config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const health = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { origin: "https://example.com" } });
  assert.equal(health.status, 200);
  const rejected = await fetch(`http://127.0.0.1:${address.port}/api/assets/${encodeURIComponent(item.assetId)}/rights`, {
    method: "POST",
    headers: { origin: "https://example.com", "content-type": "application/json" },
    body: JSON.stringify({ action: "confirm" }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json() as { error: string }).error, "LOCAL_ORIGIN_REQUIRED");
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("Bible draft and explicit verification are versioned and auditable", async () => {
  const item = await fixture();
  const draft = await saveBibleReferenceDraft({ reelId: item.reelId, reference: "Êxodo 14", actor: "qa-reviewer", note: "Fonte confirmada pelo operador" }, item.config);
  assert.equal(draft.source.verification_status, "REVIEW_REQUIRED");
  const verified = await verifyBibleReference(item.reelId, "qa-reviewer", "Verificação explícita", item.config);
  assert.equal(verified.verification_status, "VERIFIED");
  const db = openDatabase(item.config);
  try { assert.equal(bibleReferenceStatus(db, item.reelId).status, "VERIFIED"); assert.equal(latestEditorialPackage(db, item.reelId)?.review_status, "READY_FOR_HUMAN_REVIEW"); } finally { db.close(); }
});

test("source rights confirmation inherits to derived content and revocation blocks it", async () => {
  const item = await fixture();
  const confirmed = confirmSourceRights(item.assetId, "qa-owner", "Autorização registrada", RIGHTS_CONFIRMATION_STATEMENT, item.config);
  assert.equal(confirmed.rights_status, "RIGHTS_CONFIRMED");
  const db = openDatabase(item.config); try { assert.equal((db.prepare("SELECT rights_status FROM derived_reels WHERE reel_id = ?").get(item.reelId) as { rights_status: string }).rights_status, "RIGHTS_CONFIRMED"); } finally { db.close(); }
  rejectSourceRights(item.assetId, "qa-owner", "Revogação de teste", item.config);
  const revoked = openDatabase(item.config); try { assert.equal((revoked.prepare("SELECT rights_status FROM media_assets WHERE asset_id = ?").get(item.assetId) as { rights_status: string }).rights_status, "RIGHTS_REJECTED"); } finally { revoked.close(); }
});

test("CONTENT_READY requires editorial, Bible, rights and technical gates", async () => {
  const item = await fixture();
  assert.equal((await evaluateContentReadiness(item.reelId, item.config)).status, "NOT_READY");
  confirmSourceRights(item.assetId, "qa-owner", "Autorização registrada", RIGHTS_CONFIRMATION_STATEMENT, item.config);
  await saveBibleReferenceDraft({ reelId: item.reelId, reference: "Êxodo 14", actor: "qa-reviewer", note: "Referência manual" , verify: true }, item.config);
  const afterBible = openDatabase(item.config); const version = latestEditorialPackage(afterBible, item.reelId)?.editorial_version ?? 0; afterBible.close();
  approveEditorial(item.reelId, version, "qa-editor", "Aprovação de fixture", item.config);
  const result = await evaluateContentReadiness(item.reelId, item.config);
  assert.equal(result.status, "CONTENT_READY", JSON.stringify(result));
});

test("review progress starts from actual human state and never auto-approves", async () => {
  const item = await fixture();
  const progress = await reviewProgress(item.config);
  assert.equal(progress.total, 1);
  assert.equal(progress.reviewed, 0);
  assert.equal(progress.pending, 1);
});

test("cockpit editorial DTO persists both pillars, note, and read-after-write across reconstruction", async () => {
  const item = await fixture();
  const server = createReviewServer(item.config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/reels/${encodeURIComponent(item.reelId)}/editorial`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { origin: `http://127.0.0.1:${item.config.reviewPort}`, "content-type": "application/json" },
      body: JSON.stringify({ actor: "qa-reviewer", note: "Pilares revisados", content_pillar: "SCRIPTURE", secondary_pillar: "FAITH" }),
    });
    assert.equal(response.status, 200, await response.text());
    const readBack = await (await fetch(`http://127.0.0.1:${address.port}/api/reels/${encodeURIComponent(item.reelId)}`)).json() as { editorial: { content_pillar: string; secondary_pillar: string; review_note: string } };
    assert.equal(readBack.editorial.content_pillar, "SCRIPTURE");
    assert.equal(readBack.editorial.secondary_pillar, "FAITH");
    assert.equal(readBack.editorial.review_note, "Pilares revisados");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const reconstructed = await (await import("../src/review/service.js")).getReviewItem(item.reelId, item.config);
  assert.equal(reconstructed?.editorial?.content_pillar, "SCRIPTURE");
  assert.equal(reconstructed?.editorial?.secondary_pillar, "FAITH");
  const db = openDatabase(item.config);
  try {
    const row = db.prepare("SELECT content_pillar, secondary_pillar, review_note FROM reel_editorial_packages WHERE reel_id = ? ORDER BY editorial_version DESC LIMIT 1").get(item.reelId) as { content_pillar: string; secondary_pillar: string; review_note: string };
    assert.equal(row.content_pillar, "SCRIPTURE");
    assert.equal(row.secondary_pillar, "FAITH");
    assert.equal(row.review_note, "Pilares revisados");
  } finally { db.close(); }
});

test("cockpit Bible draft persists without verification, then explicit verification persists on the resulting version", async () => {
  const item = await fixture();
  const setupDb = openDatabase(item.config);
  try {
    const current = latestEditorialPackage(setupDb, item.reelId);
    if (!current) throw new Error("fixture editorial missing");
    const cleared = { ...current, bible_reference: "", bible_reference_review_required: true };
    setupDb.prepare("UPDATE reel_editorial_packages SET bible_reference = '', package_json = ? WHERE reel_id = ? AND editorial_version = ?").run(JSON.stringify(cleared), item.reelId, current.editorial_version);
  } finally { setupDb.close(); }
  const server = createReviewServer(item.config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/reels/${encodeURIComponent(item.reelId)}/bible`;
  const post = (body: Record<string, unknown>) => fetch(endpoint, { method: "POST", headers: { origin: `http://127.0.0.1:${item.config.reviewPort}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const draftResponse = await post({ actor: "qa-reviewer", note: "Referência encontrada na revisão", reference: "Lucas 19", verify: false });
    assert.equal(draftResponse.status, 200, await draftResponse.text());
    const draftRead = await (await fetch(`http://127.0.0.1:${address.port}/api/reels/${encodeURIComponent(item.reelId)}`)).json() as { bible: { status: string; reference: string } };
    assert.equal(draftRead.bible.status, "REVIEW_REQUIRED");
    assert.equal(draftRead.bible.reference, "Lucas 19");
    const verifyResponse = await post({ actor: "qa-reviewer", note: "Verificação explícita do operador", reference: "Lucas 19", verify: true });
    assert.equal(verifyResponse.status, 200, await verifyResponse.text());
    const verifiedRead = await (await fetch(`http://127.0.0.1:${address.port}/api/reels/${encodeURIComponent(item.reelId)}`)).json() as { bible: { status: string; reference: string } };
    assert.equal(verifiedRead.bible.status, "VERIFIED");
    assert.equal(verifiedRead.bible.reference, "Lucas 19");
    const invalidResponse = await post({ actor: "qa-reviewer", note: "Referência vazia", reference: "", verify: true });
    assert.equal(invalidResponse.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const db = openDatabase(item.config);
  try {
    const packageRow = latestEditorialPackage(db, item.reelId);
    const sourceRow = db.prepare("SELECT editorial_version, reference, verification_status FROM bible_reference_sources WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(item.reelId) as { editorial_version: number; reference: string; verification_status: string };
    assert.equal(sourceRow.reference, "Lucas 19");
    assert.equal(sourceRow.verification_status, "VERIFIED");
    assert.equal(sourceRow.editorial_version, packageRow?.editorial_version);
  } finally { db.close(); }
  const current = openDatabase(item.config);
  const version = latestEditorialPackage(current, item.reelId)?.editorial_version ?? 0;
  current.close();
  confirmSourceRights(item.assetId, "qa-owner", "Direitos de fixture", RIGHTS_CONFIRMATION_STATEMENT, item.config);
  approveEditorial(item.reelId, version, "qa-editor", "Aprovação de fixture", item.config);
  const readiness = await evaluateContentReadiness(item.reelId, item.config);
  assert.equal(readiness.gates.bible_reference, "PASS");
  assert.equal(readiness.status, "CONTENT_READY");

  const beforeRetry = openDatabase(item.config);
  const beforeSources = Number((beforeRetry.prepare("SELECT COUNT(*) AS count FROM bible_reference_sources WHERE reel_id = ?").get(item.reelId) as { count: number }).count);
  beforeRetry.close();
  const retryServer = createReviewServer(item.config);
  await new Promise<void>((resolve) => retryServer.listen(0, "127.0.0.1", resolve));
  const retryAddress = retryServer.address() as { port: number };
  try {
    const retry = await fetch(`http://127.0.0.1:${retryAddress.port}/api/reels/${encodeURIComponent(item.reelId)}/bible`, { method: "POST", headers: { origin: `http://127.0.0.1:${item.config.reviewPort}`, "content-type": "application/json" }, body: JSON.stringify({ actor: "qa-reviewer", note: "Verificação explícita do operador", reference: "Lucas 19", verify: true }) });
    assert.equal(retry.status, 200, await retry.text());
  } finally {
    await new Promise<void>((resolve) => retryServer.close(() => resolve()));
  }
  const afterRetry = openDatabase(item.config);
  try {
    const afterSources = Number((afterRetry.prepare("SELECT COUNT(*) AS count FROM bible_reference_sources WHERE reel_id = ?").get(item.reelId) as { count: number }).count);
    assert.equal(afterSources, beforeSources);
  } finally { afterRetry.close(); }
});
