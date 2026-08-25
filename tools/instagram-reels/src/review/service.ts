import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { curationRows, derivedReelById, inspectAsset, latestCuration, latestEditorialPackage, openDatabase } from "../database/db.js";
import { loadSongCatalog } from "../matching/catalog.js";
import { approveEditorial, rejectEditorial, requestEditorialChanges } from "../publishing/approval.js";
import { editEditorialPackage, type EditorialEdit } from "../publishing/editorial-edit.js";
import type { AiBibleSuggestion, AiEditorialSuggestion, AiReviewResult, BiblicalResolutionEvidence, CurationQualityTier, EditorialCalibration, EditorialPackage, EditorialReviewStatus, PortfolioStatus, KnowledgeBibleResolution, KnowledgeEditorialSuggestion, Section8EditorialCalibration, KnowledgeEditorialContext } from "../shared/types.js";
import { loadKnowledgeBase, knowledgeContext } from "../intelligence/knowledge-base.js";
import { bibleReferenceStatus } from "./bible.js";
import { evaluateContentReadiness } from "./readiness.js";

export type ReviewQueue = "primary" | "secondary" | "hold" | "fast-path" | "evidence-needed";
export type ReviewFilters = {
  collection?: string;
  qualityTier?: CurationQualityTier;
  reviewStatus?: EditorialReviewStatus;
  bibleStatus?: string;
  rightsStatus?: string;
  contentPillar?: string;
  seasonality?: string;
  calendarContext?: string;
  fastPath?: string;
  evidenceNeeded?: string;
};

export type ReviewItem = {
  reel_id: string;
  candidate_id: string;
  source_asset_id: string;
  song_title: string;
  song_slug: string;
  collection: string;
  source_filename: string;
  source_relative_path: string;
  output_relative_path: string;
  cover_relative_path: string | null;
  thumbnail_relative_path: string | null;
  duration_ms: number;
  start_time_ms: number;
  end_time_ms: number;
  technical: { validation_status: string; width: number | null; height: number | null; fps: number | null; video_codec: string | null; audio_codec: string | null; file_size: number | null };
  curation: { score: number; old_score: number; tier: CurationQualityTier; rank: number; portfolio_status: PortfolioStatus; decision: string; reason: string; distinctiveness: number; incremental_value: number; seasonality: string; calendar_context: string | null };
  editorial: EditorialPackage | null;
  bible: ReturnType<typeof bibleReferenceStatus>;
  rights_status: string;
  publication_status: string;
  ai_review?: AiReviewResult | null;
  ai_bible_suggestion?: AiBibleSuggestion | null;
  ai_editorial_suggestion?: AiEditorialSuggestion | null;
  editorial_calibration?: EditorialCalibration | null;
  bible_resolution?: BiblicalResolutionEvidence | null;
  knowledge_context?: KnowledgeEditorialContext | null;
  knowledge_bible_resolution?: KnowledgeBibleResolution | null;
  knowledge_editorial_suggestion?: KnowledgeEditorialSuggestion | null;
  section8_calibration?: Section8EditorialCalibration | null;
};

type Row = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0): number { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function stringValue(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function latestCurations(db: ReturnType<typeof openDatabase>): Map<string, ReturnType<typeof latestCuration>> {
  const map = new Map<string, ReturnType<typeof latestCuration>>();
  for (const row of curationRows(db)) if (!map.has(row.reel_id)) map.set(row.reel_id, row);
  return map;
}

function latestAi(db: ReturnType<typeof openDatabase>, reelId: string): { review: AiReviewResult | null; bible: AiBibleSuggestion | null; editorial: AiEditorialSuggestion | null; calibration: EditorialCalibration | null; bibleResolution: BiblicalResolutionEvidence | null } {
  const row = db.prepare("SELECT * FROM ai_reel_reviews WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const bibleRow = db.prepare("SELECT * FROM ai_bible_suggestions WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const editorialRow = db.prepare("SELECT * FROM ai_editorial_suggestions WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const calibrationRow = db.prepare("SELECT * FROM editorial_calibrations WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const resolutionRow = db.prepare("SELECT * FROM biblical_resolution_suggestions WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const stringValue = (value: unknown, fallback = "") => value === null || value === undefined ? fallback : String(value);
  const numberValue = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  const review: AiReviewResult | null = row ? {
    reel_id: stringValue(row.reel_id), ai_review_version: stringValue(row.ai_review_version), provider: stringValue(row.provider), ai_reviewed_at: stringValue(row.ai_reviewed_at), editorial_quality_score: numberValue(row.editorial_quality_score), hook_score: numberValue(row.hook_score), caption_score: numberValue(row.caption_score), cta_score: numberValue(row.cta_score), hashtag_score: numberValue(row.hashtag_score), title_score: numberValue(row.title_score), pillar_consistency_score: numberValue(row.pillar_consistency_score), collection_consistency_score: numberValue(row.collection_consistency_score), biblical_consistency_score: numberValue(row.biblical_consistency_score), theological_risk: numberValue(row.theological_risk), duplicate_risk: stringValue(row.duplicate_risk) as AiReviewResult["duplicate_risk"], retention_score: numberValue(row.retention_score), clarity_score: numberValue(row.clarity_score), emotional_impact_score: numberValue(row.emotional_impact_score), authenticity_score: numberValue(row.authenticity_score), clickbait_risk: numberValue(row.clickbait_risk), overall_ai_score: numberValue(row.overall_ai_score), ai_recommendation: stringValue(row.ai_recommendation) as AiReviewResult["ai_recommendation"], ai_reasoning_summary: stringValue(row.ai_reasoning_summary), related_reel_ids: JSON.parse(stringValue(row.related_reel_ids_json, "[]")) as string[], review_priority_score: row.review_priority_score === null || row.review_priority_score === undefined ? null : numberValue(row.review_priority_score), review_priority_rank: row.review_priority_rank === null || row.review_priority_rank === undefined ? null : numberValue(row.review_priority_rank), engine_version: stringValue(row.engine_version),
  } : null;
  const bible: AiBibleSuggestion | null = bibleRow ? { suggestion_id: stringValue(bibleRow.suggestion_id), reel_id: stringValue(bibleRow.reel_id), ai_review_version: stringValue(bibleRow.ai_review_version), reference: bibleRow.reference ? stringValue(bibleRow.reference) : null, book: bibleRow.book ? stringValue(bibleRow.book) : null, chapter: bibleRow.chapter === null || bibleRow.chapter === undefined ? null : numberValue(bibleRow.chapter), verse_range: bibleRow.verse_range ? stringValue(bibleRow.verse_range) : null, confidence: stringValue(bibleRow.confidence) as AiBibleSuggestion["confidence"], evidence_sources: JSON.parse(stringValue(bibleRow.evidence_sources_json, "[]")) as string[], reasoning_summary: stringValue(bibleRow.reasoning_summary), status: stringValue(bibleRow.status) as AiBibleSuggestion["status"], engine_version: stringValue(bibleRow.engine_version) } : null;
  const editorial: AiEditorialSuggestion | null = editorialRow ? { suggestion_id: stringValue(editorialRow.suggestion_id), reel_id: stringValue(editorialRow.reel_id), ai_review_version: stringValue(editorialRow.ai_review_version), base_editorial_version: numberValue(editorialRow.base_editorial_version), suggested_package: JSON.parse(stringValue(editorialRow.suggested_package_json, "{}")), changed_fields: JSON.parse(stringValue(editorialRow.changed_fields_json, "[]")) as string[], reasoning_summary: stringValue(editorialRow.reasoning_summary), status: stringValue(editorialRow.status) as AiEditorialSuggestion["status"], engine_version: stringValue(editorialRow.engine_version) } : null;
  const calibration: EditorialCalibration | null = calibrationRow ? { reel_id: stringValue(calibrationRow.reel_id), song_slug: stringValue(calibrationRow.song_slug), calibration_version: stringValue(calibrationRow.calibration_version), structural_scores: JSON.parse(stringValue(calibrationRow.structural_scores_json, "{}")), quality_scores: JSON.parse(stringValue(calibrationRow.quality_scores_json, "{}")), generic_language_level: stringValue(calibrationRow.generic_language_level) as EditorialCalibration["generic_language_level"], generic_phrases: JSON.parse(stringValue(calibrationRow.generic_phrases_json, "[]")), cross_catalog_similarity: JSON.parse(stringValue(calibrationRow.cross_catalog_similarity_json, "{}")), editorial_quality_score: numberValue(calibrationRow.editorial_quality_score), distinctiveness_score: numberValue(calibrationRow.distinctiveness_score), retention_score: numberValue(calibrationRow.retention_score), overall_score: numberValue(calibrationRow.overall_score), duplicate_risk: stringValue(calibrationRow.duplicate_risk) as EditorialCalibration["duplicate_risk"], related_reel_ids: JSON.parse(stringValue(calibrationRow.related_reel_ids_json, "[]")), biblical_evidence_status: stringValue(calibrationRow.biblical_evidence_status), recommendation: stringValue(calibrationRow.recommendation) as EditorialCalibration["recommendation"], fast_path_status: stringValue(calibrationRow.fast_path_status) as EditorialCalibration["fast_path_status"], evidence_needed_status: stringValue(calibrationRow.evidence_needed_status) as EditorialCalibration["evidence_needed_status"], review_priority_score: numberValue(calibrationRow.review_priority_score), review_priority_rank: calibrationRow.review_priority_rank === null || calibrationRow.review_priority_rank === undefined ? null : numberValue(calibrationRow.review_priority_rank), suggested_package: JSON.parse(stringValue(calibrationRow.suggested_package_json, "{}")), reasoning_summary: stringValue(calibrationRow.reasoning_summary), engine_version: stringValue(calibrationRow.engine_version) } : null;
  let bibleResolution: BiblicalResolutionEvidence | null = null;
  if (resolutionRow) {
    const ids = JSON.parse(stringValue(resolutionRow.evidence_source_record_ids_json, "[]")) as string[];
    const sourceRows = ids.length ? db.prepare(`SELECT source_record_id, source_type, source_location, is_authoritative, source_title FROM song_source_registry WHERE source_record_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[] : [];
    bibleResolution = { resolution_id: stringValue(resolutionRow.resolution_id), song_slug: stringValue(resolutionRow.song_slug), reel_id: stringValue(resolutionRow.reel_id), suggested_reference: resolutionRow.suggested_reference ? stringValue(resolutionRow.suggested_reference) : null, resolution_type: stringValue(resolutionRow.resolution_type) as BiblicalResolutionEvidence["resolution_type"], confidence: stringValue(resolutionRow.confidence) as BiblicalResolutionEvidence["confidence"], evidence_source_record_ids: ids, evidence_excerpt_safe: stringValue(resolutionRow.evidence_excerpt_safe), reasoning_summary: stringValue(resolutionRow.reasoning_summary), status: stringValue(resolutionRow.status) as BiblicalResolutionEvidence["status"], sources: sourceRows.map((source) => ({ source_record_id: stringValue(source.source_record_id), source_type: stringValue(source.source_type), source_location: stringValue(source.source_location), is_authoritative: Boolean(source.is_authoritative), source_title: source.source_title ? stringValue(source.source_title) : null })) };
  }
  return { review, bible, editorial, calibration, bibleResolution };
}

function latestSection8(db: ReturnType<typeof openDatabase>, reelId: string): { bible: KnowledgeBibleResolution | null; editorial: KnowledgeEditorialSuggestion | null; calibration: Section8EditorialCalibration | null } {
  const stringValue = (value: unknown, fallback = "") => value === null || value === undefined ? fallback : String(value);
  const numberValue = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  const bibleRow = db.prepare("SELECT * FROM knowledge_bible_resolutions WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const editorialRow = db.prepare("SELECT * FROM knowledge_editorial_suggestions WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const calibrationRow = db.prepare("SELECT * FROM section8_editorial_calibrations WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as Row | undefined;
  const parseJson = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(stringValue(value)) as T; } catch { return fallback; } };
  const bible: KnowledgeBibleResolution | null = bibleRow ? { resolution_id: stringValue(bibleRow.resolution_id), reel_id: stringValue(bibleRow.reel_id), song_slug: stringValue(bibleRow.song_slug), resolver_version: stringValue(bibleRow.resolver_version), suggested_reference: bibleRow.suggested_reference ? stringValue(bibleRow.suggested_reference) : null, book: bibleRow.book ? stringValue(bibleRow.book) : null, chapter: bibleRow.chapter === null || bibleRow.chapter === undefined ? null : numberValue(bibleRow.chapter), verse_start: bibleRow.verse_start === null || bibleRow.verse_start === undefined ? null : numberValue(bibleRow.verse_start), verse_end: bibleRow.verse_end === null || bibleRow.verse_end === undefined ? null : numberValue(bibleRow.verse_end), classification: stringValue(bibleRow.classification) as KnowledgeBibleResolution["classification"], confidence_level: stringValue(bibleRow.confidence_level) as KnowledgeBibleResolution["confidence_level"], confidence_score: numberValue(bibleRow.confidence_score), evidence_level: stringValue(bibleRow.evidence_level), knowledge_confidence: stringValue(bibleRow.knowledge_confidence), verification_status: stringValue(bibleRow.verification_status), biblical_story: stringValue(bibleRow.biblical_story), core_message: stringValue(bibleRow.core_message), provenance: parseJson(bibleRow.provenance_json, {}), evidence_sources: parseJson(bibleRow.evidence_sources_json, []), legacy_reference: bibleRow.legacy_reference ? stringValue(bibleRow.legacy_reference) : null, human_verified_reference: bibleRow.human_verified_reference ? stringValue(bibleRow.human_verified_reference) : null, conflict_reason: bibleRow.conflict_reason ? stringValue(bibleRow.conflict_reason) : null, reasoning_summary: stringValue(bibleRow.reasoning_summary) } : null;
  const editorial: KnowledgeEditorialSuggestion | null = editorialRow ? { suggestion_id: stringValue(editorialRow.suggestion_id), reel_id: stringValue(editorialRow.reel_id), song_slug: stringValue(editorialRow.song_slug), suggestion_version: stringValue(editorialRow.suggestion_version), base_editorial_version: numberValue(editorialRow.base_editorial_version), suggested_package: parseJson(editorialRow.package_json, {}), changed_fields: parseJson(editorialRow.changed_fields_json, []), source_context: parseJson(editorialRow.source_context_json, {}), reasoning_summary: stringValue(editorialRow.reasoning_summary), status: stringValue(editorialRow.status) as KnowledgeEditorialSuggestion["status"] } : null;
  const calibration: Section8EditorialCalibration | null = calibrationRow ? { reel_id: stringValue(calibrationRow.reel_id), song_slug: stringValue(calibrationRow.song_slug), calibration_version: stringValue(calibrationRow.calibration_version), old_overall_score: calibrationRow.old_overall_score === null || calibrationRow.old_overall_score === undefined ? null : numberValue(calibrationRow.old_overall_score), old_editorial_quality_score: calibrationRow.old_editorial_quality_score === null || calibrationRow.old_editorial_quality_score === undefined ? null : numberValue(calibrationRow.old_editorial_quality_score), structural_compliance: numberValue(calibrationRow.structural_compliance), specificity_score: numberValue(calibrationRow.specificity_score), biblical_alignment_score: numberValue(calibrationRow.biblical_alignment_score), song_context_alignment_score: numberValue(calibrationRow.song_context_alignment_score), distinctiveness_score: numberValue(calibrationRow.distinctiveness_score), brand_voice_score: numberValue(calibrationRow.brand_voice_score), narrative_value_score: numberValue(calibrationRow.narrative_value_score), cta_quality_score: numberValue(calibrationRow.cta_quality_score), retention_potential_score: numberValue(calibrationRow.retention_potential_score), duplication_penalty: numberValue(calibrationRow.duplication_penalty), editorial_quality_score: numberValue(calibrationRow.editorial_quality_score), generic_language_level: stringValue(calibrationRow.generic_language_level) as Section8EditorialCalibration["generic_language_level"], generic_phrases: parseJson(calibrationRow.generic_phrases_json, []), duplicate_risk: stringValue(calibrationRow.duplicate_risk) as Section8EditorialCalibration["duplicate_risk"], related_reel_ids: parseJson(calibrationRow.related_reel_ids_json, []), bible_classification: stringValue(calibrationRow.bible_classification) as Section8EditorialCalibration["bible_classification"], review_queue: stringValue(calibrationRow.review_queue) as Section8EditorialCalibration["review_queue"], review_priority_score: numberValue(calibrationRow.review_priority_score), review_priority_rank: calibrationRow.review_priority_rank === null || calibrationRow.review_priority_rank === undefined ? null : numberValue(calibrationRow.review_priority_rank), reasoning_summary: stringValue(calibrationRow.reasoning_summary), knowledge_context_hash: stringValue(calibrationRow.knowledge_context_hash) } : null;
  return { bible, editorial, calibration };
}

export function queuePredicate(queue: ReviewQueue, portfolioStatus: PortfolioStatus, rank: number): boolean {
  if (queue === "primary") return portfolioStatus === "ACTIVE" && rank === 1;
  if (queue === "secondary") return portfolioStatus === "ACTIVE" && rank === 2;
  return portfolioStatus === "HOLD";
}

export function filterReviewItems(items: ReviewItem[], filters: ReviewFilters = {}): ReviewItem[] {
  return items.filter((item) =>
    (!filters.collection || item.collection === filters.collection) &&
    (!filters.qualityTier || item.curation.tier === filters.qualityTier) &&
    (!filters.reviewStatus || item.editorial?.review_status === filters.reviewStatus) &&
    (!filters.bibleStatus || item.bible.status === filters.bibleStatus) &&
    (!filters.rightsStatus || item.rights_status === filters.rightsStatus) &&
    (!filters.contentPillar || item.editorial?.content_pillar === filters.contentPillar) &&
    (!filters.seasonality || item.curation.seasonality === filters.seasonality) &&
    (!filters.calendarContext || item.curation.calendar_context === filters.calendarContext) &&
    (!filters.fastPath || item.editorial_calibration?.fast_path_status === filters.fastPath) &&
    (!filters.evidenceNeeded || item.editorial_calibration?.evidence_needed_status === filters.evidenceNeeded),
  );
}

function generatedRelative(root: string | null, value: string | null | undefined): string | null {
  if (!root || !value) return null;
  const absolute = path.resolve(value);
  const relative = path.relative(path.resolve(root), absolute);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) return relative.split(path.sep).join("/");
  if (!path.isAbsolute(value)) {
    const normalized = value.split(path.sep).join("/");
    if (!normalized.startsWith("../") && normalized !== "..") return normalized;
  }
  return null;
}

export async function listReviewItems(queue: ReviewQueue = "primary", filters: ReviewFilters = {}, config: MediaConfig): Promise<ReviewItem[]> {
  const catalog = await loadSongCatalog(config.repoRoot);
  const knowledge = await loadKnowledgeBase(config);
  const catalogBySlug = new Map(catalog.map((song) => [song.slug, song]));
  const db = openDatabase(config);
  try {
    const curations = latestCurations(db);
    const items: ReviewItem[] = [];
    for (const curation of curations.values()) {
      const baseQueue: ReviewQueue = queue === "fast-path" || queue === "evidence-needed" ? "primary" : queue;
      if (!curation || !queuePredicate(baseQueue, curation.portfolio_status, curation.within_song_rank)) continue;
      const reel = derivedReelById(db, curation.reel_id);
      const asset = inspectAsset(db, curation.source_asset_id);
      const editorial = latestEditorialPackage(db, curation.reel_id) ?? null;
      if (!reel || !asset) continue;
      const song = catalogBySlug.get(stringValue(asset.song_slug));
      const bible = bibleReferenceStatus(db, curation.reel_id);
      const candidate = db.prepare("SELECT start_time_ms, end_time_ms, score FROM reel_candidates WHERE candidate_id = ?").get(curation.candidate_id) as Row | undefined;
      const ai = latestAi(db, curation.reel_id);
      const section8 = latestSection8(db, curation.reel_id);
      if (queue === "fast-path" && ai.calibration?.fast_path_status !== "FAST_PATH") continue;
      if (queue === "evidence-needed" && ai.calibration?.evidence_needed_status !== "EVIDENCE_NEEDED") continue;
      const item: ReviewItem = {
        reel_id: curation.reel_id,
        candidate_id: curation.candidate_id,
        source_asset_id: curation.source_asset_id,
        song_title: song?.title ?? stringValue(asset.song_slug, "Música sem correspondência"),
        song_slug: song?.slug ?? stringValue(asset.song_slug),
        collection: song?.category ?? "REVIEW_REQUIRED",
        source_filename: stringValue(asset.source_filename),
        source_relative_path: stringValue(asset.relative_path),
        output_relative_path: stringValue(reel.output_relative_path),
        cover_relative_path: generatedRelative(config.reelsOutputRoot, editorial?.cover_path),
        thumbnail_relative_path: generatedRelative(config.reelsOutputRoot, reel.thumbnail_relative_path ? stringValue(reel.thumbnail_relative_path) : null),
        duration_ms: numberValue(reel.duration_ms, numberValue(candidate?.end_time_ms) - numberValue(candidate?.start_time_ms)),
        start_time_ms: numberValue(candidate?.start_time_ms),
        end_time_ms: numberValue(candidate?.end_time_ms),
        technical: { validation_status: stringValue(reel.validation_status), width: reel.width === null ? null : numberValue(reel.width), height: reel.height === null ? null : numberValue(reel.height), fps: reel.fps === null ? null : numberValue(reel.fps), video_codec: reel.video_codec ? stringValue(reel.video_codec) : null, audio_codec: reel.audio_codec ? stringValue(reel.audio_codec) : null, file_size: reel.file_size === null ? null : numberValue(reel.file_size) },
        curation: { score: numberValue(curation.curation_score), old_score: numberValue(candidate?.score), tier: curation.quality_tier, rank: numberValue(curation.within_song_rank), portfolio_status: curation.portfolio_status, decision: curation.curation_decision, reason: curation.curation_reason, distinctiveness: numberValue(curation.distinctiveness_score), incremental_value: numberValue(curation.incremental_editorial_value), seasonality: curation.seasonality, calendar_context: curation.calendar_context },
        editorial,
        bible,
        rights_status: stringValue(reel.rights_status),
        publication_status: stringValue(reel.publication_status),
        ai_review: ai.review,
        ai_bible_suggestion: ai.bible,
        ai_editorial_suggestion: ai.editorial,
        editorial_calibration: ai.calibration,
        bible_resolution: ai.bibleResolution,
        knowledge_context: knowledgeContext(knowledge.bySlug.get(song?.slug ?? stringValue(asset.song_slug))) as KnowledgeEditorialContext | null,
        knowledge_bible_resolution: section8.bible,
        knowledge_editorial_suggestion: section8.editorial,
        section8_calibration: section8.calibration,
      };
      items.push(item);
    }
    items.sort((a, b) => (a.editorial_calibration?.review_priority_rank ?? a.ai_review?.review_priority_rank ?? 9999) - (b.editorial_calibration?.review_priority_rank ?? b.ai_review?.review_priority_rank ?? 9999) || a.collection.localeCompare(b.collection, "pt-BR") || a.song_title.localeCompare(b.song_title, "pt-BR") || a.curation.rank - b.curation.rank);
    return filterReviewItems(items, filters);
  } finally { db.close(); }
}

export async function getReviewItem(reelId: string, config: MediaConfig): Promise<ReviewItem | undefined> {
  for (const queue of ["primary", "secondary", "hold"] as const) {
    const found = (await listReviewItems(queue, {}, config)).find((item) => item.reel_id === reelId);
    if (found) return found;
  }
  return undefined;
}

export async function reviewProgress(config: MediaConfig): Promise<Record<string, unknown>> {
  const items = await listReviewItems("primary", {}, config);
  const reviewed = items.filter((item) => item.editorial?.review_status && item.editorial.review_status !== "READY_FOR_HUMAN_REVIEW");
  const countBy = (predicate: (item: ReviewItem) => boolean) => items.filter(predicate).length;
  return {
    queue: "PRIMARY",
    total: items.length,
    reviewed: reviewed.length,
    pending: items.length - reviewed.length,
    approved: countBy((item) => item.editorial?.review_status === "APPROVED"),
    rejected: countBy((item) => item.editorial?.review_status === "REJECTED"),
    needs_changes: countBy((item) => item.editorial?.review_status === "NEEDS_CHANGES"),
    bible_verified: countBy((item) => item.bible.status === "VERIFIED"),
    bible_missing_or_review: countBy((item) => item.bible.status !== "VERIFIED"),
    rights_confirmed: countBy((item) => item.rights_status === "RIGHTS_CONFIRMED"),
    rights_pending: countBy((item) => item.rights_status === "RIGHTS_PENDING_CONFIRMATION"),
    secondary_total: (await listReviewItems("secondary", {}, config)).length,
    hold_total: (await listReviewItems("hold", {}, config)).length,
    ai_reviewed: countBy((item) => Boolean(item.ai_review)),
    ai_not_reviewed: countBy((item) => !item.ai_review),
    ai_recommend_approve: countBy((item) => item.ai_review?.ai_recommendation === "RECOMMEND_APPROVE"),
    ai_recommend_changes: countBy((item) => item.ai_review?.ai_recommendation === "RECOMMEND_CHANGES"),
    ai_recommend_reject: countBy((item) => item.ai_review?.ai_recommendation === "RECOMMEND_REJECT"),
    ai_human_review_required: countBy((item) => item.ai_review?.ai_recommendation === "HUMAN_REVIEW_REQUIRED"),
    ai_average_score: (() => { const values = items.map((item) => item.ai_review?.overall_ai_score).filter((value): value is number => typeof value === "number"); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null; })(),
    ai_bible_high: countBy((item) => item.ai_bible_suggestion?.confidence === "HIGH"),
    ai_bible_medium: countBy((item) => item.ai_bible_suggestion?.confidence === "MEDIUM"),
    ai_bible_low: countBy((item) => item.ai_bible_suggestion?.confidence === "LOW"),
    ai_bible_insufficient: countBy((item) => item.ai_bible_suggestion?.status === "INSUFFICIENT_EVIDENCE"),
    calibration_fast_path: countBy((item) => item.editorial_calibration?.fast_path_status === "FAST_PATH"),
    calibration_evidence_needed: countBy((item) => item.editorial_calibration?.evidence_needed_status === "EVIDENCE_NEEDED"),
    calibration_average_score: (() => { const values = items.map((item) => item.editorial_calibration?.overall_score).filter((value): value is number => typeof value === "number"); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null; })(),
    section8_processed: countBy((item) => Boolean(item.section8_calibration)),
    section8_fast_path: countBy((item) => item.section8_calibration?.review_queue === "FAST_PATH"),
    section8_standard_review: countBy((item) => item.section8_calibration?.review_queue === "STANDARD_REVIEW"),
    section8_editorial_changes_required: countBy((item) => item.section8_calibration?.review_queue === "EDITORIAL_CHANGES_REQUIRED"),
    section8_bible_verification_required: countBy((item) => item.section8_calibration?.review_queue === "BIBLE_VERIFICATION_REQUIRED"),
    section8_conflict_review: countBy((item) => item.section8_calibration?.review_queue === "CONFLICT_REVIEW"),
    section8_generic_low: countBy((item) => item.section8_calibration?.generic_language_level === "GENERIC_LOW"),
    section8_generic_medium: countBy((item) => item.section8_calibration?.generic_language_level === "GENERIC_MEDIUM"),
    section8_generic_high: countBy((item) => item.section8_calibration?.generic_language_level === "GENERIC_HIGH"),
    section8_average_quality: (() => { const values = items.map((item) => item.section8_calibration?.editorial_quality_score).filter((value): value is number => typeof value === "number"); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null; })(),
  };
}

export async function reviewEditorialAction(reelId: string, action: "APPROVED" | "REJECTED" | "NEEDS_CHANGES", actor: string, note: string, version: number, config: MediaConfig): Promise<void> {
  if (!["APPROVED", "REJECTED", "NEEDS_CHANGES"].includes(action)) throw new Error("REVIEW_ACTION_INVALID");
  if (action === "APPROVED") approveEditorial(reelId, version, actor, note, config);
  else if (action === "REJECTED") rejectEditorial(reelId, version, actor, note, config);
  else requestEditorialChanges(reelId, version, actor, note, config);
}

export async function editReviewEditorial(reelId: string, actor: string, changes: EditorialEdit, config: MediaConfig): Promise<EditorialPackage> {
  return editEditorialPackage(reelId, actor, changes, config);
}

export async function writePrimaryReviewReport(config: MediaConfig): Promise<{ jsonPath: string; htmlPath: string }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const items = await listReviewItems("primary", {}, config);
  const progress = await reviewProgress(config);
  const report = { generated_at: new Date().toISOString(), queue: "PRIMARY_REVIEW_QUEUE", progress, items };
  const jsonPath = path.join(config.reelsOutputRoot, "primary-review-report.json");
  const htmlPath = path.join(config.reelsOutputRoot, "primary-review-report.html");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  const rows = items.map((item) => `<article><img src="${escape(item.cover_relative_path ?? item.thumbnail_relative_path ?? "")}" alt=""><div><h2>${escape(item.song_title)}</h2><p>${escape(item.collection)} · ${escape(item.curation.tier)} · ${item.curation.score}</p><p>Revisão: ${escape(item.editorial?.review_status)} · Bíblia: ${escape(item.bible.status)} · Direitos: ${escape(item.rights_status)}</p><p>${escape(item.editorial?.selected_hook)}</p></div></article>`).join("\n");
  await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Vargen & Fé — Primary Review</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1200px;margin:24px auto;padding:0 16px}article{display:grid;grid-template-columns:160px 1fr;gap:16px;padding:12px;margin:12px 0;border:1px solid #444;border-radius:8px}img{width:160px;height:284px;object-fit:cover;background:#000}@media(max-width:600px){article{grid-template-columns:1fr}img{width:100%;height:auto}}</style><h1>Fila primária — ${progress.reviewed}/${progress.total} revisados</h1><p>Relatório local. Não publica conteúdo.</p>${rows}`, "utf8");
  return { jsonPath, htmlPath };
}
