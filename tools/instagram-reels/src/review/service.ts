import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { curationRows, derivedReelById, inspectAsset, latestCuration, latestEditorialPackage, openDatabase } from "../database/db.js";
import { loadSongCatalog } from "../matching/catalog.js";
import { approveEditorial, rejectEditorial, requestEditorialChanges } from "../publishing/approval.js";
import { editEditorialPackage, type EditorialEdit } from "../publishing/editorial-edit.js";
import type { CurationQualityTier, EditorialPackage, EditorialReviewStatus, PortfolioStatus } from "../shared/types.js";
import { bibleReferenceStatus } from "./bible.js";
import { evaluateContentReadiness } from "./readiness.js";

export type ReviewQueue = "primary" | "secondary" | "hold";
export type ReviewFilters = {
  collection?: string;
  qualityTier?: CurationQualityTier;
  reviewStatus?: EditorialReviewStatus;
  bibleStatus?: string;
  rightsStatus?: string;
  contentPillar?: string;
  seasonality?: string;
  calendarContext?: string;
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
};

type Row = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0): number { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function stringValue(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function latestCurations(db: ReturnType<typeof openDatabase>): Map<string, ReturnType<typeof latestCuration>> {
  const map = new Map<string, ReturnType<typeof latestCuration>>();
  for (const row of curationRows(db)) if (!map.has(row.reel_id)) map.set(row.reel_id, row);
  return map;
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
    (!filters.calendarContext || item.curation.calendar_context === filters.calendarContext),
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
  const catalogBySlug = new Map(catalog.map((song) => [song.slug, song]));
  const db = openDatabase(config);
  try {
    const curations = latestCurations(db);
    const items: ReviewItem[] = [];
    for (const curation of curations.values()) {
      if (!curation || !queuePredicate(queue, curation.portfolio_status, curation.within_song_rank)) continue;
      const reel = derivedReelById(db, curation.reel_id);
      const asset = inspectAsset(db, curation.source_asset_id);
      const editorial = latestEditorialPackage(db, curation.reel_id) ?? null;
      if (!reel || !asset) continue;
      const song = catalogBySlug.get(stringValue(asset.song_slug));
      const bible = bibleReferenceStatus(db, curation.reel_id);
      const candidate = db.prepare("SELECT start_time_ms, end_time_ms, score FROM reel_candidates WHERE candidate_id = ?").get(curation.candidate_id) as Row | undefined;
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
      };
      items.push(item);
    }
    items.sort((a, b) => a.collection.localeCompare(b.collection, "pt-BR") || a.song_title.localeCompare(b.song_title, "pt-BR") || a.curation.rank - b.curation.rank);
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
