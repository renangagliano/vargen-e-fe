import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { appendAuditEvent, openDatabase } from "../database/db.js";
import { listReviewItems, type ReviewItem } from "../review/service.js";
import { audit } from "../publishing/audit.js";
import type { AiBibleSuggestion, AiEditorialSuggestion, AiRecommendation, AiReviewResult } from "../shared/types.js";
import { AI_ENGINE_VERSION, AI_REVIEW_VERSION, createContentIntelligenceProvider, type AiCorpusItem } from "./provider.js";

export type AiRunMode = "calibration" | "full" | "reel";
export type AiRunOptions = { mode?: AiRunMode; reelId?: string; limit?: number };
type Row = Record<string, unknown>;

function stableId(prefix: string, value: string): string { return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`; }
function numberValue(value: unknown, fallback = 0): number { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function stringValue(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }

function calibrationSample(items: ReviewItem[], limit = 10): ReviewItem[] {
  const grouped = new Map<string, ReviewItem[]>();
  for (const item of [...items].sort((a, b) => a.collection.localeCompare(b.collection, "pt-BR") || a.song_title.localeCompare(b.song_title, "pt-BR"))) {
    const rows = grouped.get(item.collection) ?? [];
    rows.push(item);
    grouped.set(item.collection, rows);
  }
  const output: ReviewItem[] = [];
  while (output.length < limit && grouped.size > 0) {
    for (const [collection, rows] of grouped) {
      const item = rows.shift();
      if (item) output.push(item);
      if (rows.length === 0) grouped.delete(collection);
      if (output.length >= limit) break;
    }
  }
  return output;
}

export function selectCalibrationSample(items: ReviewItem[], limit = 10): ReviewItem[] { return calibrationSample(items, limit); }

function latestRows(db: ReturnType<typeof openDatabase>, table: string, reelIds?: string[]): Row[] {
  const where = reelIds?.length ? `WHERE reel_id IN (${reelIds.map(() => "?").join(",")})` : "";
  const rows = db.prepare(`SELECT * FROM ${table} ${where} ORDER BY updated_at DESC`).all(...(reelIds ?? [])) as Row[];
  const seen = new Set<string>();
  return rows.filter((row) => { const reelId = stringValue(row.reel_id); if (seen.has(reelId)) return false; seen.add(reelId); return true; });
}

function reviewFromRow(row: Row): AiReviewResult {
  return {
    reel_id: stringValue(row.reel_id), ai_review_version: stringValue(row.ai_review_version), provider: stringValue(row.provider), ai_reviewed_at: stringValue(row.ai_reviewed_at),
    editorial_quality_score: numberValue(row.editorial_quality_score), hook_score: numberValue(row.hook_score), caption_score: numberValue(row.caption_score), cta_score: numberValue(row.cta_score), hashtag_score: numberValue(row.hashtag_score), title_score: numberValue(row.title_score), pillar_consistency_score: numberValue(row.pillar_consistency_score), collection_consistency_score: numberValue(row.collection_consistency_score), biblical_consistency_score: numberValue(row.biblical_consistency_score), theological_risk: numberValue(row.theological_risk), duplicate_risk: stringValue(row.duplicate_risk) as AiReviewResult["duplicate_risk"], retention_score: numberValue(row.retention_score), clarity_score: numberValue(row.clarity_score), emotional_impact_score: numberValue(row.emotional_impact_score), authenticity_score: numberValue(row.authenticity_score), clickbait_risk: numberValue(row.clickbait_risk), overall_ai_score: numberValue(row.overall_ai_score), ai_recommendation: stringValue(row.ai_recommendation) as AiRecommendation, ai_reasoning_summary: stringValue(row.ai_reasoning_summary), related_reel_ids: JSON.parse(stringValue(row.related_reel_ids_json, "[]")) as string[], review_priority_score: row.review_priority_score === null || row.review_priority_score === undefined ? null : numberValue(row.review_priority_score), review_priority_rank: row.review_priority_rank === null || row.review_priority_rank === undefined ? null : numberValue(row.review_priority_rank), engine_version: stringValue(row.engine_version),
  };
}

function bibleFromRow(row: Row | undefined): AiBibleSuggestion | null {
  if (!row) return null;
  return { suggestion_id: stringValue(row.suggestion_id), reel_id: stringValue(row.reel_id), ai_review_version: stringValue(row.ai_review_version), reference: row.reference ? stringValue(row.reference) : null, book: row.book ? stringValue(row.book) : null, chapter: row.chapter === null || row.chapter === undefined ? null : numberValue(row.chapter), verse_range: row.verse_range ? stringValue(row.verse_range) : null, confidence: stringValue(row.confidence) as AiBibleSuggestion["confidence"], evidence_sources: JSON.parse(stringValue(row.evidence_sources_json, "[]")) as string[], reasoning_summary: stringValue(row.reasoning_summary), status: stringValue(row.status) as AiBibleSuggestion["status"], engine_version: stringValue(row.engine_version) };
}

function editorialFromRow(row: Row | undefined): AiEditorialSuggestion | null {
  if (!row) return null;
  return { suggestion_id: stringValue(row.suggestion_id), reel_id: stringValue(row.reel_id), ai_review_version: stringValue(row.ai_review_version), base_editorial_version: numberValue(row.base_editorial_version), suggested_package: JSON.parse(stringValue(row.suggested_package_json, "{}")), changed_fields: JSON.parse(stringValue(row.changed_fields_json, "[]")) as string[], reasoning_summary: stringValue(row.reasoning_summary), status: stringValue(row.status) as AiEditorialSuggestion["status"], engine_version: stringValue(row.engine_version) };
}

function persistEvaluation(db: ReturnType<typeof openDatabase>, item: ReviewItem, evaluation: ReturnType<ReturnType<typeof createContentIntelligenceProvider>["evaluate"]>, actor: string): void {
  const now = new Date().toISOString();
  const r = evaluation.review;
  const aiReviewId = stableId("ai-review", `${item.reel_id}:${AI_REVIEW_VERSION}`);
  const previous = db.prepare("SELECT ai_recommendation FROM ai_reel_reviews WHERE reel_id = ? AND ai_review_version = ?").get(item.reel_id, AI_REVIEW_VERSION) as { ai_recommendation?: string } | undefined;
  db.prepare(`INSERT INTO ai_reel_reviews (ai_review_id, reel_id, ai_review_version, provider, ai_reviewed_at, editorial_quality_score, hook_score, caption_score, cta_score, hashtag_score, title_score, pillar_consistency_score, collection_consistency_score, biblical_consistency_score, theological_risk, duplicate_risk, retention_score, clarity_score, emotional_impact_score, authenticity_score, clickbait_risk, overall_ai_score, ai_recommendation, ai_reasoning_summary, related_reel_ids_json, engine_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(reel_id, ai_review_version) DO UPDATE SET provider=excluded.provider, ai_reviewed_at=excluded.ai_reviewed_at, editorial_quality_score=excluded.editorial_quality_score, hook_score=excluded.hook_score, caption_score=excluded.caption_score, cta_score=excluded.cta_score, hashtag_score=excluded.hashtag_score, title_score=excluded.title_score, pillar_consistency_score=excluded.pillar_consistency_score, collection_consistency_score=excluded.collection_consistency_score, biblical_consistency_score=excluded.biblical_consistency_score, theological_risk=excluded.theological_risk, duplicate_risk=excluded.duplicate_risk, retention_score=excluded.retention_score, clarity_score=excluded.clarity_score, emotional_impact_score=excluded.emotional_impact_score, authenticity_score=excluded.authenticity_score, clickbait_risk=excluded.clickbait_risk, overall_ai_score=excluded.overall_ai_score, ai_recommendation=excluded.ai_recommendation, ai_reasoning_summary=excluded.ai_reasoning_summary, related_reel_ids_json=excluded.related_reel_ids_json, engine_version=excluded.engine_version, updated_at=excluded.updated_at`).run(aiReviewId, item.reel_id, AI_REVIEW_VERSION, r.provider, r.ai_reviewed_at, r.editorial_quality_score, r.hook_score, r.caption_score, r.cta_score, r.hashtag_score, r.title_score, r.pillar_consistency_score, r.collection_consistency_score, r.biblical_consistency_score, r.theological_risk, r.duplicate_risk, r.retention_score, r.clarity_score, r.emotional_impact_score, r.authenticity_score, r.clickbait_risk, r.overall_ai_score, r.ai_recommendation, r.ai_reasoning_summary, JSON.stringify(r.related_reel_ids), AI_ENGINE_VERSION, now, now);
  const b = evaluation.bible;
  db.prepare(`INSERT INTO ai_bible_suggestions (suggestion_id, reel_id, ai_review_version, reference, book, chapter, verse_range, confidence, evidence_sources_json, reasoning_summary, status, engine_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(reel_id, ai_review_version) DO UPDATE SET reference=excluded.reference, book=excluded.book, chapter=excluded.chapter, verse_range=excluded.verse_range, confidence=excluded.confidence, evidence_sources_json=excluded.evidence_sources_json, reasoning_summary=excluded.reasoning_summary, status=excluded.status, engine_version=excluded.engine_version, updated_at=excluded.updated_at`).run(stableId("ai-bible", `${item.reel_id}:${AI_REVIEW_VERSION}`), item.reel_id, AI_REVIEW_VERSION, b.reference, b.book, b.chapter, b.verse_range, b.confidence, JSON.stringify(b.evidence_sources), b.reasoning_summary, b.status, AI_ENGINE_VERSION, now, now);
  const e = evaluation.editorial;
  db.prepare(`INSERT INTO ai_editorial_suggestions (suggestion_id, reel_id, ai_review_version, base_editorial_version, suggested_package_json, changed_fields_json, reasoning_summary, status, engine_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(reel_id, ai_review_version) DO UPDATE SET base_editorial_version=excluded.base_editorial_version, suggested_package_json=excluded.suggested_package_json, changed_fields_json=excluded.changed_fields_json, reasoning_summary=excluded.reasoning_summary, engine_version=excluded.engine_version, updated_at=excluded.updated_at`).run(stableId("ai-editorial", `${item.reel_id}:${AI_REVIEW_VERSION}`), item.reel_id, AI_REVIEW_VERSION, e.base_editorial_version, JSON.stringify(e.suggested_package), JSON.stringify(e.changed_fields), e.reasoning_summary, e.status, AI_ENGINE_VERSION, now, now);
  audit(db, { entityType: "REEL", entityId: item.reel_id, eventType: previous ? "AI_REVIEW_UPDATED" : "AI_REVIEW_CREATED", actor, metadata: { ai_review_version: AI_REVIEW_VERSION, provider: r.provider, overall_ai_score: r.overall_ai_score, recommendation: r.ai_recommendation } });
  if (previous && previous.ai_recommendation !== r.ai_recommendation) audit(db, { entityType: "REEL", entityId: item.reel_id, eventType: "AI_RECOMMENDATION_CHANGED", actor, metadata: { ai_review_version: AI_REVIEW_VERSION, previous: previous.ai_recommendation, current: r.ai_recommendation } });
  audit(db, { entityType: "REEL", entityId: item.reel_id, eventType: "AI_BIBLE_SUGGESTION_CREATED", actor, metadata: { status: b.status, confidence: b.confidence, has_reference: Boolean(b.reference) } });
  audit(db, { entityType: "REEL", entityId: item.reel_id, eventType: "AI_EDITORIAL_SUGGESTION_CREATED", actor, metadata: { changed_fields: e.changed_fields } });
}

function updatePriorities(db: ReturnType<typeof openDatabase>, items: ReviewItem[], actor: string): void {
  const rows = latestRows(db, "ai_reel_reviews", items.map((item) => item.reel_id));
  const itemById = new Map(items.map((item) => [item.reel_id, item]));
  const ranked = rows.map((row) => {
    const bible = latestRows(db, "ai_bible_suggestions", [stringValue(row.reel_id)])[0];
    const base = numberValue(row.overall_ai_score);
    const score = Math.max(0, Math.min(100, base + (stringValue(bible?.confidence) === "HIGH" ? 8 : stringValue(bible?.confidence) === "MEDIUM" ? 3 : 0) + (stringValue(row.theological_risk) === "0" ? 6 : 0) + (stringValue(row.duplicate_risk) === "LOW" ? 4 : stringValue(row.duplicate_risk) === "HIGH" ? -8 : 0)));
    return { row, score, item: itemById.get(stringValue(row.reel_id)) };
  }).sort((a, b) => b.score - a.score || (a.item?.collection ?? "").localeCompare(b.item?.collection ?? "", "pt-BR"));
  const update = db.prepare("UPDATE ai_reel_reviews SET review_priority_score = ?, review_priority_rank = ?, updated_at = ? WHERE reel_id = ? AND ai_review_version = ?");
  ranked.forEach((entry, index) => update.run(Math.round(entry.score * 100) / 100, index + 1, new Date().toISOString(), stringValue(entry.row.reel_id), AI_REVIEW_VERSION));
}

export async function runAiReview(options: AiRunOptions = {}, config: MediaConfig = loadConfig()): Promise<{ mode: AiRunMode; provider: string; engineVersion: string; candidates: number; results: AiReviewResult[]; bible: AiBibleSuggestion[]; editorial: AiEditorialSuggestion[]; discriminative: boolean }> {
  const allPrimary = await listReviewItems("primary", {}, config);
  let targets = options.mode === "reel" ? allPrimary.filter((item) => item.reel_id === options.reelId) : options.mode === "full" ? allPrimary : calibrationSample(allPrimary, options.limit ?? 10);
  if (options.limit && options.mode === "full") targets = targets.slice(0, options.limit);
  if (!targets.length) throw new Error("AI_REVIEW_TARGET_NOT_FOUND");
  const secondary = await listReviewItems("secondary", {}, config);
  const corpus: AiCorpusItem[] = [...allPrimary, ...secondary];
  const provider = createContentIntelligenceProvider();
  const db = openDatabase(config);
  try {
    for (const item of targets) persistEvaluation(db, item, provider.evaluate(item, corpus), "ai-local-engine");
    updatePriorities(db, targets, "ai-local-engine");
    const reviews = latestRows(db, "ai_reel_reviews", targets.map((item) => item.reel_id)).map(reviewFromRow);
    const bible = latestRows(db, "ai_bible_suggestions", targets.map((item) => item.reel_id)).map(bibleFromRow).filter((value): value is AiBibleSuggestion => Boolean(value));
    const editorial = latestRows(db, "ai_editorial_suggestions", targets.map((item) => item.reel_id)).map(editorialFromRow).filter((value): value is AiEditorialSuggestion => Boolean(value));
    const recommendations = new Set(reviews.map((review) => review.ai_recommendation));
    const scoreSpread = reviews.length ? Math.max(...reviews.map((review) => review.overall_ai_score)) - Math.min(...reviews.map((review) => review.overall_ai_score)) : 0;
    return { mode: options.mode ?? "calibration", provider: provider.name, engineVersion: AI_ENGINE_VERSION, candidates: targets.length, results: reviews, bible, editorial, discriminative: recommendations.size > 1 || scoreSpread >= 10 };
  } finally { db.close(); }
}

export async function aiReviewForReel(reelId: string, config = loadConfig()): Promise<AiReviewResult | null> { const result = await runAiReview({ mode: "reel", reelId }, config); return result.results[0] ?? null; }

export async function aiReviewStatus(config = loadConfig()): Promise<Record<string, unknown>> {
  const db = openDatabase(config);
  try {
    const rows = latestRows(db, "ai_reel_reviews");
    const bibleRows = latestRows(db, "ai_bible_suggestions");
    const count = (predicate: (row: Row) => boolean) => rows.filter(predicate).length;
    const bibleCount = (predicate: (row: Row) => boolean) => bibleRows.filter(predicate).length;
    const scores = rows.map((row) => numberValue(row.overall_ai_score));
    const primaryTotal = (await listReviewItems("primary", {}, config)).length;
    return { engine_version: AI_ENGINE_VERSION, provider: "DeterministicLocalProvider", primary_total: primaryTotal, ai_reviewed: rows.length, not_ai_reviewed: Math.max(0, primaryTotal - rows.length), recommendations: { RECOMMEND_APPROVE: count((row) => row.ai_recommendation === "RECOMMEND_APPROVE"), RECOMMEND_CHANGES: count((row) => row.ai_recommendation === "RECOMMEND_CHANGES"), RECOMMEND_REJECT: count((row) => row.ai_recommendation === "RECOMMEND_REJECT"), HUMAN_REVIEW_REQUIRED: count((row) => row.ai_recommendation === "HUMAN_REVIEW_REQUIRED") }, bible_confidence: { HIGH: bibleCount((row) => row.confidence === "HIGH"), MEDIUM: bibleCount((row) => row.confidence === "MEDIUM"), LOW: bibleCount((row) => row.confidence === "LOW"), INSUFFICIENT_EVIDENCE: bibleCount((row) => row.status === "INSUFFICIENT_EVIDENCE") }, average_ai_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : null };
  } finally { db.close(); }
}

export async function writeAiReviewReport(config = loadConfig(), sample = false): Promise<{ jsonPath: string; htmlPath: string; candidates: number }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const items = await listReviewItems("primary", {}, config);
  const ids = sample ? calibrationSample(items, 10).map((item) => item.reel_id) : items.map((item) => item.reel_id);
  const db = openDatabase(config);
  try {
    const reviews = latestRows(db, "ai_reel_reviews", ids).map(reviewFromRow);
    const bibleRows = latestRows(db, "ai_bible_suggestions", ids).map(bibleFromRow).filter((value): value is AiBibleSuggestion => Boolean(value));
    const editorialRows = latestRows(db, "ai_editorial_suggestions", ids).map(editorialFromRow).filter((value): value is AiEditorialSuggestion => Boolean(value));
    const itemById = new Map(items.map((item) => [item.reel_id, item]));
    const report = { generated_at: new Date().toISOString(), phase: "PHASE 7.1", provider: "DeterministicLocalProvider", engine_version: AI_ENGINE_VERSION, sample, candidates: ids.length, reviews, bible_suggestions: bibleRows, editorial_suggestions: editorialRows, items: ids.map((id) => itemById.get(id)).filter(Boolean) };
    const jsonPath = path.join(config.reelsOutputRoot, sample ? "ai-review-calibration.json" : "ai-review-primary.json");
    const htmlPath = path.join(config.reelsOutputRoot, sample ? "ai-review-calibration.html" : "ai-review-primary.html");
    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
    const rows = reviews.map((review) => { const item = itemById.get(review.reel_id); return `<article><img src="${escape(item?.cover_relative_path ?? item?.thumbnail_relative_path ?? "")}" alt=""><div><h2>${escape(item?.song_title)}</h2><p>${escape(item?.collection)} · AI ${review.overall_ai_score} · ${escape(review.ai_recommendation)}</p><p>Bíblia: ${escape(bibleRows.find((value) => value.reel_id === review.reel_id)?.status)} · Duplicação: ${escape(review.duplicate_risk)} · Teologia: ${review.theological_risk}</p><p>${escape(review.ai_reasoning_summary)}</p></div></article>`; }).join("\n");
    await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Vargen & Fé — AI Pre-review</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1200px;margin:24px auto;padding:0 16px}article{display:grid;grid-template-columns:160px 1fr;gap:16px;padding:12px;margin:12px 0;border:1px solid #444;border-radius:8px}img{width:160px;height:284px;object-fit:cover;background:#000}@media(max-width:600px){article{grid-template-columns:1fr}img{width:100%;height:auto}}</style><h1>AI Pre-review ${sample ? "— calibração" : "— primários"}</h1><p>Provider local determinístico. Sugestões não aprovam, não verificam Bíblia, não confirmam direitos e não publicam.</p>${rows}`, "utf8");
    return { jsonPath, htmlPath, candidates: ids.length };
  } finally { db.close(); }
}
