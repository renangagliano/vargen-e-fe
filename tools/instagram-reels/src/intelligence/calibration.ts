import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";
import { textSimilarity } from "../curation/engine.js";
import { listReviewItems, type ReviewItem } from "../review/service.js";
import type { AiRecommendation, AiDuplicateRisk, EditorialCalibration, EditorialPackage } from "../shared/types.js";
import { buildSourceRegistry } from "./registry.js";
import { resolvePrimaryBibleEvidence, BIBLICAL_RESOLVER_VERSION } from "./biblical.js";

export const EDITORIAL_CALIBRATION_VERSION = "phase7.2-editorial-calibration-v1";
export const EDITORIAL_INTELLIGENCE_ENGINE_VERSION = "deterministic-local-editorial-intelligence-v2";
type Row = Record<string, unknown>;

const GENERIC_PATTERNS = [
  "uma palavra para continuar",
  "uma mensagem para hoje",
  "este trecho nos lembra",
  "uma canção para",
  "salve para ouvir novamente",
  "compartilhe com alguém",
  "qual trecho falou com você",
];
const CLICKBAIT_PATTERNS = [/garante/i, /milagre certo/i, /vai ficar rico/i, /dinheiro/i, /receba(?:r)? uma bênção/i, /comente.{0,20}(amen|glória)/i, /se você não/i];
const STOP_WORDS = new Set("a o os as um uma de do da dos das para por com em no na nos que e é eu você seu sua este esta isso como quando Deus fé com alguém trecho música canção".normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/u));

function now(): string { return new Date().toISOString(); }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function num(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function str(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function stableId(value: string): string { return `calibration-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`; }
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
function words(value: string): string[] { return normalize(value).split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word)); }
function uniqueWords(value: string): string[] { return [...new Set(words(value))]; }
function overlap(a: string[], b: string[]): number { const bSet = new Set(b); return a.length ? a.filter((word) => bSet.has(word)).length / a.length : 0; }
function scoreFromCount(count: number, step: number, base = 30): number { return clamp(base + Math.min(60, count * step)); }
function maxSimilarity(item: ReviewItem, corpus: ReviewItem[], field: (editorial: EditorialPackage) => string): { score: number; ids: string[] } {
  const current = item.editorial;
  if (!current) return { score: 0, ids: [] };
  const rows = corpus.filter((other) => other.reel_id !== item.reel_id && other.editorial).map((other) => ({ id: other.reel_id, score: textSimilarity(field(current), field(other.editorial as EditorialPackage)) * 100 })).sort((a, b) => b.score - a.score);
  return { score: rows[0]?.score ?? 0, ids: rows.filter((row) => row.score >= 55).slice(0, 5).map((row) => row.id) };
}
function genericHits(editorial: EditorialPackage | null): string[] { if (!editorial) return []; const haystack = normalize(`${editorial.selected_hook} ${editorial.caption} ${editorial.cta} ${editorial.cover_text}`); return GENERIC_PATTERNS.filter((pattern) => haystack.includes(normalize(pattern))); }
function genericLevel(hits: string[], frequency: number): "GENERIC_LOW" | "GENERIC_MEDIUM" | "GENERIC_HIGH" { const score = hits.length * 2 + Math.max(0, frequency - 1); return score >= 5 ? "GENERIC_HIGH" : score >= 2 ? "GENERIC_MEDIUM" : "GENERIC_LOW"; }
function contextTokens(item: ReviewItem): string[] { return uniqueWords(`${item.song_title} ${item.collection} ${item.editorial?.content_pillar ?? ""} ${item.curation.calendar_context ?? ""}`); }
function structureScores(editorial: EditorialPackage | null): Record<string, number> {
  if (!editorial) return { hook_structure_score: 0, caption_structure_score: 0, cta_structure_score: 0, hashtag_structure_score: 0 };
  const hookLength = editorial.selected_hook.trim().length;
  const paragraphs = editorial.caption.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean).length;
  return {
    hook_structure_score: hookLength >= 20 && hookLength <= 110 ? 100 : hookLength > 0 ? 55 : 0,
    caption_structure_score: paragraphs >= 2 && paragraphs <= 7 && editorial.caption.length <= 1500 ? 100 : editorial.caption.length > 0 ? 65 : 0,
    cta_structure_score: editorial.cta.trim().length >= 12 && editorial.cta.trim().length <= 110 ? 100 : editorial.cta.trim().length > 0 ? 55 : 0,
    hashtag_structure_score: editorial.hashtags.length >= 4 && editorial.hashtags.length <= 10 && editorial.hashtags.some((tag) => normalize(tag).includes("vargen")) ? 100 : editorial.hashtags.length > 0 ? 55 : 0,
  };
}
export function calculateStructuralCompliance(editorial: EditorialPackage | null): Record<string, number> { return structureScores(editorial); }
export function classifyGenericLanguage(editorial: EditorialPackage | null, corpus: ReviewItem[]): "GENERIC_LOW" | "GENERIC_MEDIUM" | "GENERIC_HIGH" {
  const hits = genericHits(editorial);
  const frequency = corpus.filter((item) => hits.some((phrase) => normalize(`${item.editorial?.selected_hook ?? ""} ${item.editorial?.caption ?? ""} ${item.editorial?.cta ?? ""}`).includes(normalize(phrase)))).length;
  return genericLevel(hits, frequency);
}
function technicalScore(item: ReviewItem): number { return item.technical.validation_status === "PASS" && item.technical.width === 1080 && item.technical.height === 1920 && Boolean(item.technical.audio_codec) ? 100 : 25; }
function bibleScore(status: string): number { return status === "HUMAN_VERIFIED" ? 100 : status === "SUGGESTED_EXPLICIT" || status === "SUGGESTED_CORROBORATED" ? 85 : status === "SUGGESTED_NARRATIVE" ? 65 : status === "CONFLICT" ? 10 : 35; }
function riskScore(value: string): number { return CLICKBAIT_PATTERNS.reduce((total, pattern) => total + (pattern.test(value) ? 22 : 0), 0) > 0 ? 80 : 5; }
function riskLevel(score: number): AiDuplicateRisk { return score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW"; }

export function selectPhase72CalibrationSample(items: ReviewItem[], limit = 10): ReviewItem[] {
  const selected: ReviewItem[] = [];
  const add = (predicate: (item: ReviewItem) => boolean) => { const found = items.find((item) => !selected.includes(item) && predicate(item)); if (found && selected.length < limit) selected.push(found); };
  add((item) => normalize(item.song_title).includes("quando as aguas se abriram"));
  add((item) => item.collection === "12 Meses com Deus");
  add((item) => item.collection.startsWith("7 Dias com Deus"));
  add((item) => item.collection === "Tempo Comum");
  add((item) => item.collection === "Tempo Comum" && item.curation.rank === 1);
  add((item) => ["Advento", "Quaresma", "Solenidades"].includes(item.collection));
  add((item) => item.collection === "Domingo da Páscoa");
  add((item) => item.collection === "Tempo do Natal");
  add((item) => item.collection === "Anunciação");
  for (const item of [...items].sort((a, b) => a.collection.localeCompare(b.collection, "pt-BR") || a.song_title.localeCompare(b.song_title, "pt-BR"))) if (selected.length < limit && !selected.includes(item)) selected.push(item);
  return selected.slice(0, limit);
}

function suggestionFor(item: ReviewItem, quality: Record<string, number>, generic: string[], duplicateRisk: AiDuplicateRisk): { package: Partial<EditorialPackage>; changed: string[]; reason: string } {
  const editorial = item.editorial;
  if (!editorial) return { package: {}, changed: [], reason: "Pacote editorial ausente." };
  const suggested: Partial<EditorialPackage> = {};
  if (quality.hook_specificity_score < 62 || generic.length > 0 || duplicateRisk === "HIGH") suggested.selected_hook = `O que ${item.song_title} desperta em nós quando a fé precisa avançar?`;
  if (quality.caption_specificity_score < 62 || quality.caption_story_value_score < 62) suggested.caption = `${suggested.selected_hook ?? editorial.selected_hook}\n\n${item.song_title} encontra ${item.collection.toLocaleLowerCase("pt-BR")} e transforma a caminhada em oração. Que esta canção acompanhe o seu próximo passo.\n\nVargen & Fé\nA Bíblia transformada em música.`;
  if (quality.cta_context_score < 55) suggested.cta = "Qual palavra desta canção você levaria para a sua semana?";
  if (quality.hashtag_context_score < 55) suggested.hashtags = [...new Set(["#VargenEFé", "#MusicaCrista", `#${item.collection.replace(/[^\p{L}\p{N}]+/gu, "")}`, "#Fe", "#Biblia"])].slice(0, 7);
  const changed = Object.keys(suggested).filter((field) => JSON.stringify((editorial as unknown as Record<string, unknown>)[field]) !== JSON.stringify((suggested as unknown as Record<string, unknown>)[field]));
  return { package: suggested, changed, reason: changed.length ? "Sugestão determinística baseada em contexto do catálogo, especificidade e repetição; aplicação exige edição humana." : "O pacote atual não acionou uma sugestão determinística de melhoria." };
}

type InternalEvaluation = { calibration: EditorialCalibration; old: { overall: number | null; editorial: number | null }; oldReview: Row | undefined; bible: Row | undefined };

function evaluate(item: ReviewItem, corpus: ReviewItem[], bibleRow: Row | undefined, oldReview: Row | undefined): InternalEvaluation {
  const editorial = item.editorial;
  const structure = structureScores(editorial);
  const currentText = editorial ? `${editorial.selected_hook} ${editorial.caption} ${editorial.cta} ${editorial.cover_text}` : "";
  const context = contextTokens(item);
  const hookWords = uniqueWords(editorial?.selected_hook ?? "");
  const captionWords = uniqueWords(editorial?.caption ?? "");
  const generic = genericHits(editorial);
  const genericFrequency = corpus.filter((other) => generic.some((phrase) => normalize(`${other.editorial?.selected_hook ?? ""} ${other.editorial?.caption ?? ""} ${other.editorial?.cta ?? ""}`).includes(normalize(phrase)))).length;
  const hookSimilarity = maxSimilarity(item, corpus, (value) => value.selected_hook);
  const captionSimilarity = maxSimilarity(item, corpus, (value) => value.caption.split(/\n\s*\n/)[0] ?? value.caption);
  const coverSimilarity = maxSimilarity(item, corpus, (value) => value.cover_text);
  const ctaSimilarity = maxSimilarity(item, corpus, (value) => value.cta);
  const maxDup = clamp(hookSimilarity.score * 0.45 + captionSimilarity.score * 0.25 + coverSimilarity.score * 0.15 + ctaSimilarity.score * 0.15);
  const duplicateRisk = riskLevel(maxDup);
  const related = [...new Set([...hookSimilarity.ids, ...captionSimilarity.ids, ...coverSimilarity.ids, ...ctaSimilarity.ids])].slice(0, 5);
  const structural = structure;
  const quality = {
    hook_specificity_score: clamp(scoreFromCount(hookWords.filter((word) => word.length >= 5).length, 7, 25) + overlap(hookWords, context) * 20 - generic.length * 14),
    hook_distinctiveness_score: clamp(100 - hookSimilarity.score * 0.9),
    caption_specificity_score: clamp(scoreFromCount(captionWords.filter((word) => word.length >= 5).length, 3.5, 24) + overlap(captionWords, context) * 24 - generic.length * 10),
    caption_story_value_score: clamp((editorial?.caption.split(/\n\s*\n/).filter(Boolean).length ?? 0) * 12 + overlap(captionWords, context) * 35 + (editorial?.caption.includes("?") ? 8 : 0)),
    cta_context_score: clamp(scoreFromCount(uniqueWords(editorial?.cta ?? "").length, 8, 22) + overlap(uniqueWords(editorial?.cta ?? ""), context) * 35 - (ctaSimilarity.score > 70 ? 25 : 0)),
    hashtag_context_score: clamp((editorial?.hashtags.length ?? 0) * 7 + (editorial?.hashtags.some((tag) => normalize(tag).includes("vargen")) ? 15 : 0) + (editorial?.hashtags.some((tag) => normalize(tag).includes(normalize(item.collection.split(" ")[0]))) ? 18 : 0) - (editorial?.hashtags.length ?? 0) * 1.5),
    brand_voice_score: clamp((/vargen|biblia|fe|oracao|esperanca|graca|deus/iu.test(currentText) ? 48 : 22) + (editorial?.caption.includes("A Bíblia transformada em música.") ? 35 : 0) + (editorial?.content_pillar ? 12 : 0)),
    collection_context_score: clamp(25 + overlap(uniqueWords(currentText), context) * 70),
  };
  const genericLanguageLevel = genericLevel(generic, genericFrequency);
  const editorialQuality = clamp(quality.hook_specificity_score * 0.16 + quality.hook_distinctiveness_score * 0.16 + quality.caption_specificity_score * 0.15 + quality.caption_story_value_score * 0.14 + quality.cta_context_score * 0.1 + quality.hashtag_context_score * 0.07 + quality.brand_voice_score * 0.12 + quality.collection_context_score * 0.1);
  const distinctiveness = clamp(quality.hook_distinctiveness_score * 0.45 + (100 - maxDup) * 0.35 + (item.curation.distinctiveness || 0) * 0.2);
  const duration = item.duration_ms / 1000;
  const retention = clamp(quality.hook_specificity_score * 0.28 + quality.hook_distinctiveness_score * 0.17 + distinctiveness * 0.18 + item.curation.distinctiveness * 0.15 + item.curation.incremental_value * 0.12 + (duration >= 15 && duration <= 60 ? 10 : 0));
  const bibleStatus = str(bibleRow?.resolution_type, "INSUFFICIENT");
  const bible = bibleScore(bibleStatus);
  const theology = riskScore(currentText);
  const overall = clamp(editorialQuality * 0.47 + retention * 0.18 + distinctiveness * 0.13 + num(item.curation.score) * 0.12 + bible * 0.1 - theology * 0.12 - maxDup * 0.1);
  const recommendation: AiRecommendation = theology >= 70 || overall < 45 ? "RECOMMEND_REJECT" : overall >= 82 && bible >= 85 && duplicateRisk === "LOW" ? "RECOMMEND_APPROVE" : overall < 65 || duplicateRisk === "HIGH" ? "RECOMMEND_CHANGES" : "HUMAN_REVIEW_REQUIRED";
  const fastPath = editorialQuality >= 78 && (bibleStatus === "HUMAN_VERIFIED" || bibleStatus === "SUGGESTED_EXPLICIT" || bibleStatus === "SUGGESTED_CORROBORATED") && duplicateRisk === "LOW" ? "FAST_PATH" : "NOT_ELIGIBLE";
  const evidenceNeeded = bibleStatus === "INSUFFICIENT" ? "EVIDENCE_NEEDED" : "NOT_NEEDED";
  const suggestion = suggestionFor(item, quality, generic, duplicateRisk);
  const calibration: EditorialCalibration = { reel_id: item.reel_id, song_slug: item.song_slug, calibration_version: EDITORIAL_CALIBRATION_VERSION, structural_scores: structural, quality_scores: { ...quality, generic_language_penalty: clamp(generic.length * 15 + Math.max(0, genericFrequency - 1) * 4), semantic_duplication_penalty: clamp(maxDup) }, generic_language_level: genericLanguageLevel, generic_phrases: generic, cross_catalog_similarity: { hook: hookSimilarity.score, caption_opening: captionSimilarity.score, cover: coverSimilarity.score, cta: ctaSimilarity.score }, editorial_quality_score: editorialQuality, distinctiveness_score: distinctiveness, retention_score: retention, overall_score: overall, duplicate_risk: duplicateRisk, related_reel_ids: related, biblical_evidence_status: bibleStatus, recommendation, fast_path_status: fastPath, evidence_needed_status: evidenceNeeded, review_priority_score: clamp(overall + (fastPath === "FAST_PATH" ? 9 : 0) + (bibleStatus === "INSUFFICIENT" ? -5 : 0) + (duplicateRisk === "LOW" ? 4 : duplicateRisk === "HIGH" ? -9 : 0)), review_priority_rank: null, suggested_package: suggestion.package, reasoning_summary: `Calibração local: estrutural separado da qualidade; editorial ${editorialQuality.toFixed(1)}, distinção ${distinctiveness.toFixed(1)}, retenção ${retention.toFixed(1)}, Bíblia ${bibleStatus}, duplicação ${duplicateRisk}. ${suggestion.reason}`, engine_version: EDITORIAL_INTELLIGENCE_ENGINE_VERSION };
  return { calibration, old: { overall: oldReview ? num(oldReview.overall_ai_score, null as unknown as number) : null, editorial: oldReview ? num(oldReview.editorial_quality_score, null as unknown as number) : null }, oldReview, bible: bibleRow };
}

function persist(db: ReturnType<typeof openDatabase>, result: InternalEvaluation, actor: string): void {
  const c = result.calibration;
  const timestamp = now();
  db.prepare(`INSERT INTO editorial_calibrations (calibration_id, reel_id, song_slug, calibration_version, old_overall_score, old_editorial_quality_score, structural_scores_json, quality_scores_json, generic_language_level, generic_phrases_json, cross_catalog_similarity_json, editorial_quality_score, distinctiveness_score, retention_score, overall_score, duplicate_risk, related_reel_ids_json, biblical_evidence_status, recommendation, fast_path_status, evidence_needed_status, review_priority_score, review_priority_rank, suggested_package_json, reasoning_summary, engine_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reel_id, calibration_version) DO UPDATE SET old_overall_score=excluded.old_overall_score, old_editorial_quality_score=excluded.old_editorial_quality_score, structural_scores_json=excluded.structural_scores_json, quality_scores_json=excluded.quality_scores_json, generic_language_level=excluded.generic_language_level, generic_phrases_json=excluded.generic_phrases_json, cross_catalog_similarity_json=excluded.cross_catalog_similarity_json, editorial_quality_score=excluded.editorial_quality_score, distinctiveness_score=excluded.distinctiveness_score, retention_score=excluded.retention_score, overall_score=excluded.overall_score, duplicate_risk=excluded.duplicate_risk, related_reel_ids_json=excluded.related_reel_ids_json, biblical_evidence_status=excluded.biblical_evidence_status, recommendation=excluded.recommendation, fast_path_status=excluded.fast_path_status, evidence_needed_status=excluded.evidence_needed_status, review_priority_score=excluded.review_priority_score, review_priority_rank=excluded.review_priority_rank, suggested_package_json=excluded.suggested_package_json, reasoning_summary=excluded.reasoning_summary, engine_version=excluded.engine_version, updated_at=excluded.updated_at`).run(
    stableId(`${c.reel_id}:${EDITORIAL_CALIBRATION_VERSION}`), c.reel_id, c.song_slug, c.calibration_version, result.old.overall, result.old.editorial, JSON.stringify(c.structural_scores), JSON.stringify(c.quality_scores), c.generic_language_level, JSON.stringify(c.generic_phrases), JSON.stringify(c.cross_catalog_similarity), c.editorial_quality_score, c.distinctiveness_score, c.retention_score, c.overall_score, c.duplicate_risk, JSON.stringify(c.related_reel_ids), c.biblical_evidence_status, c.recommendation, c.fast_path_status, c.evidence_needed_status, c.review_priority_score, c.review_priority_rank, JSON.stringify(c.suggested_package), c.reasoning_summary, c.engine_version, timestamp, timestamp,
  );
  const event = c.recommendation === "RECOMMEND_APPROVE" ? "AI_RECOMMENDATION_CHANGED" : "AI_REVIEW_UPDATED";
  db.prepare("INSERT INTO publication_audit_events (event_id, entity_type, entity_id, event_type, actor, timestamp, metadata_json_safe) VALUES (?, ?, ?, ?, ?, ?, ?)").run(stableId(`${event}:${c.reel_id}:${timestamp}`), "REEL", c.reel_id, event, actor, timestamp, JSON.stringify({ calibration_version: c.calibration_version, engine_version: c.engine_version, recommendation: c.recommendation, overall_score: c.overall_score }));
  if (c.suggested_package && Object.keys(c.suggested_package).length) db.prepare("INSERT INTO publication_audit_events (event_id, entity_type, entity_id, event_type, actor, timestamp, metadata_json_safe) VALUES (?, ?, ?, ?, ?, ?, ?)").run(stableId(`editorial-suggestion:${c.reel_id}:${timestamp}`), "REEL", c.reel_id, "AI_EDITORIAL_SUGGESTION_CREATED", actor, timestamp, JSON.stringify({ calibration_version: c.calibration_version, changed_fields: Object.keys(c.suggested_package) }));
}

function rowToCalibration(row: Row): EditorialCalibration {
  return { reel_id: str(row.reel_id), song_slug: str(row.song_slug), calibration_version: str(row.calibration_version), structural_scores: JSON.parse(str(row.structural_scores_json, "{}")), quality_scores: JSON.parse(str(row.quality_scores_json, "{}")), generic_language_level: str(row.generic_language_level) as EditorialCalibration["generic_language_level"], generic_phrases: JSON.parse(str(row.generic_phrases_json, "[]")), cross_catalog_similarity: JSON.parse(str(row.cross_catalog_similarity_json, "{}")), editorial_quality_score: num(row.editorial_quality_score), distinctiveness_score: num(row.distinctiveness_score), retention_score: num(row.retention_score), overall_score: num(row.overall_score), duplicate_risk: str(row.duplicate_risk) as AiDuplicateRisk, related_reel_ids: JSON.parse(str(row.related_reel_ids_json, "[]")), biblical_evidence_status: str(row.biblical_evidence_status), recommendation: str(row.recommendation) as AiRecommendation, fast_path_status: str(row.fast_path_status) as EditorialCalibration["fast_path_status"], evidence_needed_status: str(row.evidence_needed_status) as EditorialCalibration["evidence_needed_status"], review_priority_score: num(row.review_priority_score), review_priority_rank: row.review_priority_rank === null ? null : num(row.review_priority_rank), suggested_package: JSON.parse(str(row.suggested_package_json, "{}")), reasoning_summary: str(row.reasoning_summary), engine_version: str(row.engine_version) };
}

export async function runEditorialCalibration(options: { mode?: "calibration" | "full"; limit?: number } = {}, config: MediaConfig = loadConfig()): Promise<{ mode: string; candidates: number; sample: boolean; discriminative: boolean; results: EditorialCalibration[]; report: Record<string, unknown> }> {
  await buildSourceRegistry(config);
  const bible = await resolvePrimaryBibleEvidence(config);
  const items = await listReviewItems("primary", {}, config);
  const targets = options.mode === "full" ? items.slice(0, options.limit ?? items.length) : selectPhase72CalibrationSample(items, options.limit ?? 10);
  const corpus = [...items, ...(await listReviewItems("secondary", {}, config))];
  const db = openDatabase(config);
  const results: EditorialCalibration[] = [];
  try {
    const bibleByReel = new Map(bible.resolutions.map((row) => [row.reel_id, row]));
    for (const item of targets) {
      const oldReview = db.prepare("SELECT * FROM ai_reel_reviews WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(item.reel_id) as Row | undefined;
      const bibleRow = bibleByReel.get(item.reel_id) as unknown as Row | undefined;
      const evaluation = evaluate(item, corpus, bibleRow, oldReview);
      persist(db, evaluation, "phase7.2-local-engine");
      results.push(evaluation.calibration);
    }
    const priorityRows = db.prepare("SELECT * FROM editorial_calibrations WHERE calibration_version = ?").all(EDITORIAL_CALIBRATION_VERSION) as Row[];
    const ranked = priorityRows.sort((a, b) => num(b.review_priority_score) - num(a.review_priority_score));
    const update = db.prepare("UPDATE editorial_calibrations SET review_priority_rank = ?, updated_at = ? WHERE reel_id = ? AND calibration_version = ?");
    ranked.forEach((row, index) => update.run(index + 1, now(), str(row.reel_id), EDITORIAL_CALIBRATION_VERSION));
    for (const result of results) result.review_priority_rank = ranked.findIndex((row) => String(row.reel_id) === result.reel_id) + 1 || null;
    const scoreSpread = results.length ? Math.max(...results.map((row) => row.overall_score)) - Math.min(...results.map((row) => row.overall_score)) : 0;
    const recommendationCount = new Set(results.map((row) => row.recommendation)).size;
    const tierCount = results.filter((row) => row.recommendation === "RECOMMEND_APPROVE").length;
    const report = { generated_at: now(), phase: "PHASE 7.2", provider: "DeterministicLocalProvider", engine_version: EDITORIAL_INTELLIGENCE_ENGINE_VERSION, biblical_resolver_version: BIBLICAL_RESOLVER_VERSION, mode: options.mode ?? "calibration", sample: options.mode !== "full", candidates: results.length, discriminative: scoreSpread >= 10 || recommendationCount > 1 || results.some((row) => row.evidence_needed_status === "EVIDENCE_NEEDED"), score_spread: scoreSpread, recommendation_distribution: Object.fromEntries([...new Set(results.map((row) => row.recommendation))].map((key) => [key, results.filter((row) => row.recommendation === key).length])), fast_path: results.filter((row) => row.fast_path_status === "FAST_PATH").length, evidence_needed: results.filter((row) => row.evidence_needed_status === "EVIDENCE_NEEDED").length, average_scores: { old_overall: average(results.map((row) => { const match = db.prepare("SELECT old_overall_score FROM editorial_calibrations WHERE reel_id = ? AND calibration_version = ?").get(row.reel_id, EDITORIAL_CALIBRATION_VERSION) as Row | undefined; return match?.old_overall_score; })), new_overall: average(results.map((row) => row.overall_score)), editorial_quality: average(results.map((row) => row.editorial_quality_score)), distinctiveness: average(results.map((row) => row.distinctiveness_score)), retention: average(results.map((row) => row.retention_score)) }, results };
    return { mode: options.mode ?? "calibration", candidates: results.length, sample: options.mode !== "full", discriminative: Boolean(report.discriminative), results, report };
  } finally { db.close(); }
}

function average(values: unknown[]): number | null { const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value)); return numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length * 100) / 100 : null; }

export async function writeEditorialCalibrationReport(config: MediaConfig = loadConfig(), sample = false): Promise<{ jsonPath: string; htmlPath: string; candidates: number }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const items = await listReviewItems("primary", {}, config);
  const db = openDatabase(config);
  try {
    const rows = sample
      ? db.prepare("SELECT * FROM editorial_calibrations WHERE calibration_version = ? ORDER BY created_at DESC LIMIT 10").all(EDITORIAL_CALIBRATION_VERSION) as Row[]
      : db.prepare("SELECT * FROM editorial_calibrations WHERE calibration_version = ? ORDER BY review_priority_rank").all(EDITORIAL_CALIBRATION_VERSION) as Row[];
    const records = rows.map(rowToCalibration);
    const report = { generated_at: now(), phase: "PHASE 7.2", sample, candidates: records.length, records, old_score_distribution: { overall: rows.map((row) => num(row.old_overall_score)).filter((value) => value > 0), editorial_quality: rows.map((row) => num(row.old_editorial_quality_score)).filter((value) => value > 0) }, new_score_distribution: { overall: records.map((row) => row.overall_score), editorial_quality: records.map((row) => row.editorial_quality_score), distinctiveness: records.map((row) => row.distinctiveness_score) } };
    const jsonPath = path.join(config.reelsOutputRoot, "editorial-calibration-report.json");
    const htmlPath = path.join(config.reelsOutputRoot, "editorial-calibration-report.html");
    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
    const htmlRows = records.map((row) => `<article><h2>${escape(row.song_slug)}</h2><p>Overall ${row.overall_score} · editorial ${row.editorial_quality_score} · distinção ${row.distinctiveness_score} · ${escape(row.recommendation)}</p><p>FAST_PATH: ${row.fast_path_status} · evidência: ${row.evidence_needed_status} · duplicação: ${row.duplicate_risk} · genérico: ${row.generic_language_level}</p><p>${escape(row.reasoning_summary)}</p></article>`).join("\n");
    await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Vargen & Fé — Calibração editorial</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1100px;margin:24px auto;padding:0 16px}article{border:1px solid #444;border-radius:8px;padding:14px;margin:12px 0}</style><h1>Calibração editorial v2 — ${sample ? "amostra" : "primários"}</h1><p>Provider local determinístico; nenhuma recomendação altera governança humana.</p>${htmlRows}`, "utf8");
    return { jsonPath, htmlPath, candidates: records.length };
  } finally { db.close(); }
}

export function calibrationFromRow(row: Row): EditorialCalibration { return rowToCalibration(row); }
