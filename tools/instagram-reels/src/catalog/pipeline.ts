import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { analyzeMedia } from "../analysis/audio.js";
import { selectCatalogCandidates } from "../analysis/candidates.js";
import { loadSongCatalog } from "../matching/catalog.js";
import { detectMediaTools } from "../ffmpeg/detection.js";
import { makeThumbnail, outputFilename, renderReel, TEMPLATE_VERSION } from "../reels/factory.js";
import { validateReel, type ReelValidation } from "../reels/validation.js";
import { generateCover } from "../editorial/cover.js";
import { generateCatalogEditorialPackage, validateCatalogEditorialPackage } from "../editorial/catalog.js";
import { assertFileInsideRoot, assertPathInside } from "../security/paths.js";
import { sha256File } from "../media/checksum.js";
import { ensureReelsStructure } from "../media/reels-structure.js";
import {
  beginCatalogRun, catalogAssetRunRows, catalogRunById, candidatesForAsset, derivedReelById, derivedReelsForAsset,
  inspectAsset, latestCompletedCatalogAssetRun, latestEditorialPackage, mediaAnalysisByKey, openDatabase,
  saveEditorialPackage, saveMediaAnalysis, setCandidateStatus, upsertDerivedReel, upsertReelCandidate,
  updateCatalogRun, upsertCatalogAssetRun, listAssets,
} from "../database/db.js";
import { reelId } from "../analysis/candidates.js";
import type { CandidateCategory, EditorialPackage, MediaAnalysisReport, ReelCandidate } from "../shared/types.js";

export type CatalogOperation = "analyze" | "generate" | "validate" | "editorial";

export type CatalogOptions = {
  operation: CatalogOperation;
  limit?: number;
  collection?: string;
  song?: string;
  assetIds?: string[];
  resume?: boolean;
  dryRun?: boolean;
};

type AssetRow = Record<string, unknown>;

async function availableFont(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  for (const candidate of ["C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\segoeui.ttf"]) {
    if (await fs.stat(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}

type CatalogAssetContext = {
  assetId: string;
  sourcePath: string;
  sourceRelativePath: string;
  sourceFilename: string;
  checksum: string;
  durationMs: number;
  rightsStatus: string;
  songTitle: string;
  collection: string;
};

export type CatalogRunResult = {
  runId: string;
  operation: CatalogOperation;
  totalAssets: number;
  processedAssets: number;
  selectedCandidates: number;
  generatedReels: number;
  failedAssets: number;
  noQualifiedAssets: number;
  candidateDistribution: { zero: number; one: number; two: number; three: number };
  failures: Array<{ assetId: string; song: string; code: string; message: string }>;
  elapsedMs: number;
};

function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
}

function collectionDirectory(collection: string): string {
  if (collection === "12 Meses com Deus") return "12-Meses-com-Deus";
  if (collection === "7 Dias com Deus  Fé, Força e Superação") return "7-Dias-com-Deus";
  if (["Advento", "Anunciação", "Domingo da Páscoa", "Domingo de Ramos e da Paixão", "Quaresma", "Solenidades", "Tempo do Natal", "Tempo Comum"].includes(collection)) return "Ano-Liturgico-C";
  return "Outros";
}

function sourceSong(row: AssetRow, catalog: Awaited<ReturnType<typeof loadSongCatalog>>): { title: string; collection: string } | null {
  const song = catalog.find((entry) => entry.slug === String(row.song_slug));
  return song ? { title: song.title, collection: song.category } : null;
}

async function contextFor(config: MediaConfig, row: AssetRow, catalog: Awaited<ReturnType<typeof loadSongCatalog>>): Promise<CatalogAssetContext> {
  if (!config.mediaRoot) throw new Error("MEDIA_ROOT_NOT_CONFIGURED");
  if (row.match_status !== "MATCHED" || row.confidence !== "EXACT") throw new Error("ASSET_MATCH_NOT_EXACT");
  if (row.availability_status !== "LOCAL_AVAILABLE") throw new Error("SOURCE_UNAVAILABLE");
  const song = sourceSong(row, catalog);
  if (!song) throw new Error("SONG_CATALOG_MATCH_NOT_FOUND");
  if (!row.relative_path || !row.checksum_sha256 || !row.duration_ms) throw new Error("ASSET_METADATA_INCOMPLETE");
  const sourcePath = path.resolve(config.mediaRoot, String(row.relative_path));
  await assertFileInsideRoot(config.mediaRoot, sourcePath);
  return {
    assetId: String(row.asset_id), sourcePath, sourceRelativePath: String(row.relative_path), sourceFilename: String(row.source_filename),
    checksum: String(row.checksum_sha256), durationMs: Number(row.duration_ms), rightsStatus: String(row.rights_status), songTitle: song.title, collection: song.collection,
  };
}

function candidateFromRow(row: AssetRow): ReelCandidate {
  return {
    candidateId: String(row.candidate_id), sourceAssetId: String(row.source_asset_id), startTimeMs: Number(row.start_time_ms), endTimeMs: Number(row.end_time_ms), durationMs: Number(row.duration_ms),
    category: String(row.category) as CandidateCategory, score: Number(row.score), selectionReason: String(row.selection_reason), status: String(row.status) as ReelCandidate["status"], fingerprint: String(row.fingerprint),
    confidence: row.candidate_confidence === null || row.candidate_confidence === undefined ? undefined : Number(row.candidate_confidence),
    scoreBreakdown: row.score_breakdown_json ? JSON.parse(String(row.score_breakdown_json)) as Record<string, number> : undefined,
    analysisVersion: row.analysis_version ? String(row.analysis_version) : undefined, configurationVersion: row.configuration_version ? String(row.configuration_version) : undefined,
    decision: row.decision ? String(row.decision) as ReelCandidate["decision"] : undefined,
  };
}

async function sourceChecksum(context: CatalogAssetContext): Promise<string> {
  const checksum = await sha256File(context.sourcePath);
  if (checksum !== context.checksum) throw new Error("CHECKSUM_MISMATCH");
  return checksum;
}

async function analysisFor(config: MediaConfig, db: ReturnType<typeof openDatabase>, context: CatalogAssetContext, ffmpegPath: string): Promise<{ report: MediaAnalysisReport; cached: boolean }> {
  const cached = mediaAnalysisByKey(db, context.assetId, context.checksum, config.analysisVersion);
  if (cached) return { report: cached, cached: true };
  const report = await analyzeMedia(ffmpegPath, context.sourcePath, context.assetId, context.durationMs);
  saveMediaAnalysis(db, context.assetId, context.checksum, config.analysisVersion, report);
  return { report, cached: false };
}

function candidateOutputDirectory(config: MediaConfig, context: CatalogAssetContext): string {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  return path.join(config.reelsOutputRoot, collectionDirectory(context.collection), slugify(context.songTitle));
}

function metadataFor(config: MediaConfig, context: CatalogAssetContext, candidate: ReelCandidate, outputPath: string, validation: ReelValidation, generatedAt: string, checksum: string): Record<string, unknown> {
  return {
    reel_id: reelId(candidate), source_asset_id: context.assetId, source_filename: context.sourceFilename, source_relative_path: context.sourceRelativePath,
    song_title: context.songTitle, collection: context.collection, start_time_ms: candidate.startTimeMs, end_time_ms: candidate.endTimeMs,
    duration_ms: validation.metadata?.durationMs ?? null, candidate_category: candidate.category, selection_reason: candidate.selectionReason,
    clip_score: candidate.score, candidate_confidence: candidate.confidence ?? null, score_breakdown: candidate.scoreBreakdown ?? null,
    output_filename: path.basename(outputPath), output_path: outputPath, resolution: validation.metadata?.width && validation.metadata?.height ? `${validation.metadata.width}x${validation.metadata.height}` : null,
    fps: validation.metadata?.frameRate ?? null, video_codec: validation.metadata?.videoCodec ?? null, audio_codec: validation.metadata?.audioCodec ?? null,
    file_size: validation.fileSize, template_version: TEMPLATE_VERSION, processing_version: config.catalogRenderVersion, rights_status: context.rightsStatus,
    generation_timestamp: generatedAt, validation_status: validation.status, subtitle_status: "NOT_GENERATED_NO_RELIABLE_SYNC", source_checksum_before: checksum, source_checksum_after: checksum,
  };
}

async function filesHealthy(config: MediaConfig, row: AssetRow, context: CatalogAssetContext, requireRenderVersion = true): Promise<boolean> {
  const output = config.reelsOutputRoot ? path.resolve(config.reelsOutputRoot, String(row.output_relative_path)) : "";
  if (!config.reelsOutputRoot || String(row.source_checksum_before) !== context.checksum || String(row.source_checksum_after) !== context.checksum || String(row.validation_status) !== "PASS" || (requireRenderVersion && String(row.processing_version) !== config.catalogRenderVersion)) return false;
  await assertPathInside(config.reelsOutputRoot, output);
  const cover = output.replace(/\.mp4$/i, ".cover.jpg");
  const metadata = output.replace(/\.mp4$/i, ".metadata.json");
  return (await Promise.all([output, cover, metadata].map(async (item) => (await fs.stat(item).catch(() => null))?.size ?? 0))).every((size) => size > 0);
}

async function existingAssetComplete(config: MediaConfig, db: ReturnType<typeof openDatabase>, context: CatalogAssetContext, requireRenderVersion = true): Promise<{ candidates: number; reels: number } | null> {
  const rows = derivedReelsForAsset(db, context.assetId);
  if (!rows.length) return null;
  const healthy = await Promise.all(rows.map((row) => filesHealthy(config, row, context, requireRenderVersion)));
  return healthy.every(Boolean) ? { candidates: rows.length, reels: rows.length } : null;
}

async function renderCandidates(config: MediaConfig, db: ReturnType<typeof openDatabase>, context: CatalogAssetContext, candidates: ReelCandidate[], tools: { ffmpegPath: string; ffprobePath: string }): Promise<number> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const directory = candidateOutputDirectory(config, context);
  await assertPathInside(config.reelsOutputRoot, directory, true);
  await fs.mkdir(directory, { recursive: true });
  const logoPath = path.join(config.repoRoot, "public", "brand", "logo-mark.png");
  const usableLogo = await fs.stat(logoPath).then(() => logoPath).catch(() => null);
  const fontPath = await availableFont();
  let generated = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const base = outputFilename(index + 1, candidate.category);
    const outputPath = path.join(directory, `${base}.mp4`);
    const thumbnailPath = path.join(directory, `${base}.jpg`);
    const coverPath = path.join(directory, `${base}.cover.jpg`);
    const metadataPath = path.join(directory, `${base}.metadata.json`);
    await assertPathInside(config.reelsOutputRoot, outputPath, true);
    const existing = derivedReelById(db, reelId(candidate));
    const currentFiles = existing && await filesHealthy(config, existing, context);
    if (currentFiles) { generated += 1; continue; }
    await renderReel({ ffmpegPath: tools.ffmpegPath, sourcePath: context.sourcePath, logoPath: usableLogo, candidate, outputPath, safeZoneTopPx: config.reelSafeZoneTopPx, fastSeek: true });
    const validation = await validateReel({ config, ffprobePath: tools.ffprobePath, sourcePath: context.sourcePath, outputPath, candidate });
    if (validation.status !== "PASS") {
      setCandidateStatus(db, candidate.candidateId, "VALIDATION_FAILED");
      await fs.rm(outputPath, { force: true });
      throw new Error(`VALIDATION_FAILED:${validation.reasons.join(",")}`);
    }
    await makeThumbnail(tools.ffmpegPath, outputPath, thumbnailPath, validation.metadata?.durationMs ?? candidate.durationMs);
    const editorial = generateCatalogEditorialPackage({ reelId: reelId(candidate), songTitle: context.songTitle, collection: context.collection, category: candidate.category, outputPath, rightsStatus: context.rightsStatus as never });
    await generateCover({ ffmpegPath: tools.ffmpegPath, ffprobePath: tools.ffprobePath, sourceReelPath: outputPath, outputPath: coverPath, coverText: editorial.cover_text, durationMs: validation.metadata?.durationMs ?? candidate.durationMs, fontPath, safeZoneTopPx: config.reelSafeZoneTopPx, safeZoneBottomPx: config.reelSafeZoneBottomPx, safeZoneSidePx: config.reelSafeZoneSidePx });
    const metadata = metadataFor(config, context, candidate, outputPath, validation, new Date().toISOString(), context.checksum);
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    upsertDerivedReel(db, { reelId: reelId(candidate), candidateId: candidate.candidateId, sourceAssetId: context.assetId, outputRelativePath: path.relative(config.reelsOutputRoot, outputPath).split(path.sep).join("/"), thumbnailRelativePath: path.relative(config.reelsOutputRoot, thumbnailPath).split(path.sep).join("/"), metadataRelativePath: path.relative(config.reelsOutputRoot, metadataPath).split(path.sep).join("/"), videoCodec: validation.metadata?.videoCodec ?? null, audioCodec: validation.metadata?.audioCodec ?? null, width: validation.metadata?.width ?? null, height: validation.metadata?.height ?? null, fps: validation.metadata?.frameRate ?? null, durationMs: validation.metadata?.durationMs ?? null, fileSize: validation.fileSize, validationStatus: "PASS", rightsStatus: context.rightsStatus as never, sourceChecksumBefore: context.checksum, sourceChecksumAfter: context.checksum, templateVersion: TEMPLATE_VERSION, processingVersion: config.catalogRenderVersion });
    setCandidateStatus(db, candidate.candidateId, "VALIDATED");
    generated += 1;
  }
  return generated;
}

async function editorialForAsset(config: MediaConfig, db: ReturnType<typeof openDatabase>, context: CatalogAssetContext, tools: { ffmpegPath: string; ffprobePath: string }): Promise<number> {
  const rows = derivedReelsForAsset(db, context.assetId).filter((row) => String(row.validation_status) === "PASS");
  let count = 0;
  const fontPath = await availableFont();
  const directory = rows[0]
    ? path.dirname(path.resolve(config.reelsOutputRoot as string, String(rows[0].output_relative_path)))
    : candidateOutputDirectory(config, context);
  for (const row of rows) {
    const candidateRow = db.prepare("SELECT * FROM reel_candidates WHERE candidate_id = ?").get(String(row.candidate_id)) as AssetRow | undefined;
    if (!candidateRow) continue;
    const outputPath = path.resolve(config.reelsOutputRoot as string, String(row.output_relative_path));
    const current = latestEditorialPackage(db, String(row.reel_id));
    const packageValue = current && current.bible_reference ? current : generateCatalogEditorialPackage({ reelId: String(row.reel_id), songTitle: context.songTitle, collection: context.collection, category: String(candidateRow.category) as CandidateCategory, outputPath, rightsStatus: context.rightsStatus as never });
    const errors = current?.bible_reference ? [] : validateCatalogEditorialPackage(packageValue);
    if (errors.length) throw new Error(`EDITORIAL_FAILED:${errors.join(",")}`);
    const stored = saveEditorialPackage(db, packageValue);
    await fs.writeFile(outputPath.replace(/\.mp4$/i, ".editorial.json"), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    const metadataPath = path.resolve(config.reelsOutputRoot as string, String(row.metadata_relative_path));
    const technical = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
    technical.editorial_package = stored;
    await fs.writeFile(metadataPath, `${JSON.stringify(technical, null, 2)}\n`, "utf8");
    const coverPath = outputPath.replace(/\.mp4$/i, ".cover.jpg");
    if (!(await fs.stat(coverPath).catch(() => null))) await generateCover({ ffmpegPath: tools.ffmpegPath, ffprobePath: tools.ffprobePath, sourceReelPath: outputPath, outputPath: coverPath, coverText: stored.cover_text, durationMs: Number(row.duration_ms), fontPath, safeZoneTopPx: config.reelSafeZoneTopPx, safeZoneBottomPx: config.reelSafeZoneBottomPx, safeZoneSidePx: config.reelSafeZoneSidePx });
    count += 1;
  }
  await writeSongManifest(config, db, context, directory);
  return count;
}

async function writeSongManifest(config: MediaConfig, db: ReturnType<typeof openDatabase>, context: CatalogAssetContext, directory: string): Promise<void> {
  const rows = derivedReelsForAsset(db, context.assetId);
  const candidates = rows.map((row) => ({ reel_id: row.reel_id, output_path: path.resolve(config.reelsOutputRoot as string, String(row.output_relative_path)), validation_status: row.validation_status, rights_status: row.rights_status, editorial: latestEditorialPackage(db, String(row.reel_id)) }));
  await fs.writeFile(path.join(directory, "review.json"), `${JSON.stringify({ phase: "PHASE 6 — CATALOG REEL FACTORY", generated_at: new Date().toISOString(), source: { asset_id: context.assetId, song: context.songTitle, collection: context.collection, relative_path: context.sourceRelativePath, checksum_sha256: context.checksum, rights_status: context.rightsStatus }, candidates, review_status: "READY_FOR_HUMAN_REVIEW", publication_status: "NOT_PUBLISHED" }, null, 2)}\n`, "utf8");
}

async function validateAsset(config: MediaConfig, db: ReturnType<typeof openDatabase>, context: CatalogAssetContext, ffprobePath: string): Promise<number> {
  let passed = 0;
  for (const row of derivedReelsForAsset(db, context.assetId)) {
    const candidateRow = db.prepare("SELECT * FROM reel_candidates WHERE candidate_id = ?").get(String(row.candidate_id)) as AssetRow | undefined;
    if (!candidateRow) continue;
    const outputPath = path.resolve(config.reelsOutputRoot as string, String(row.output_relative_path));
    const result = await validateReel({ config, ffprobePath, sourcePath: context.sourcePath, outputPath, candidate: candidateFromRow(candidateRow) });
    if (result.status !== "PASS") { setCandidateStatus(db, String(candidateRow.candidate_id), "VALIDATION_FAILED"); throw new Error(`VALIDATION_FAILED:${result.reasons.join(",")}`); }
    passed += 1;
  }
  return passed;
}

async function storageEstimate(config: MediaConfig, db: ReturnType<typeof openDatabase>, expectedAssets: number): Promise<{ freeBytes: number | null; estimatedBytes: number; safe: boolean }> {
  const rows = db.prepare("SELECT file_size, duration_ms FROM derived_reels WHERE validation_status = 'PASS' AND processing_version = ? AND file_size IS NOT NULL AND duration_ms IS NOT NULL").all(config.catalogRenderVersion) as Array<{ file_size?: number; duration_ms?: number }>;
  const bytesPerMs = rows.length ? rows.reduce((sum, row) => sum + Number(row.file_size ?? 0) / Math.max(1, Number(row.duration_ms ?? 1)), 0) / rows.length : 0.15;
  const estimatedBytes = Math.ceil(expectedAssets * config.maxReelsPerSource * bytesPerMs * 45000 * 1.2);
  const stats = await fs.statfs(config.reelsOutputRoot as string).catch(() => null) as { bavail?: number; bsize?: number } | null;
  const freeBytes = stats?.bavail !== undefined && stats.bsize !== undefined ? stats.bavail * stats.bsize : null;
  return { freeBytes, estimatedBytes, safe: freeBytes === null || freeBytes > estimatedBytes };
}

export async function estimateCatalogStorage(expectedAssets: number, config: MediaConfig = loadConfig()): Promise<{ freeBytes: number | null; estimatedBytes: number; safe: boolean }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const db = openDatabase(config);
  try { return await storageEstimate(config, db, expectedAssets); } finally { db.close(); }
}

function selectedAssets(config: MediaConfig, db: ReturnType<typeof openDatabase>, catalog: Awaited<ReturnType<typeof loadSongCatalog>>, options: CatalogOptions): AssetRow[] {
  let rows = listAssets(db).filter((row) => row.availability_status === "LOCAL_AVAILABLE" && row.match_status === "MATCHED" && row.confidence === "EXACT");
  if (options.collection) rows = rows.filter((row) => sourceSong(row, catalog)?.collection === options.collection);
  if (options.song) rows = rows.filter((row) => sourceSong(row, catalog)?.title === options.song || row.asset_id === options.song || row.song_slug === options.song);
  if (options.assetIds?.length) rows = rows.filter((row) => options.assetIds?.includes(String(row.asset_id)));
  return options.limit && options.limit > 0 ? rows.slice(0, options.limit) : rows;
}

export async function runCatalog(options: CatalogOptions, config: MediaConfig = loadConfig()): Promise<CatalogRunResult> {
  if (!config.mediaRoot || !config.reelsOutputRoot) throw new Error("MEDIA_OR_OUTPUT_ROOT_NOT_CONFIGURED");
  await ensureReelsStructure(config);
  const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
  if (!tools.ffmpeg.executablePath || !tools.ffprobe.executablePath) throw new Error("FFMPEG_OR_FFPROBE_NOT_AVAILABLE");
  const db = openDatabase(config);
  const started = Date.now();
  const failures: Array<{ assetId: string; song: string; code: string; message: string }> = [];
  let runId = "";
  try {
    const catalog = await loadSongCatalog(config.repoRoot);
    const assets = selectedAssets(config, db, catalog, options);
    if (options.operation === "generate" && !options.limit && !options.collection && !options.song && !options.assetIds?.length) {
      const estimate = await storageEstimate(config, db, assets.length);
      if (!estimate.safe) throw new Error(`INSUFFICIENT_STORAGE:${estimate.estimatedBytes}:${estimate.freeBytes ?? "unknown"}`);
    }
    runId = beginCatalogRun(db, { operation: options.operation, totalAssets: assets.length, configurationVersion: `${config.analysisVersion}:${config.catalogRenderVersion}:${config.editorialVersion}` });
    let processed = 0; let selected = 0; let generated = 0; let noQualified = 0;
    for (const row of assets) {
      const song = sourceSong(row, catalog)?.title ?? String(row.source_filename);
      try {
        const context = await contextFor(config, row, catalog);
        const before = await sourceChecksum(context);
        if (options.resume !== false && options.operation === "generate") {
          const complete = latestCompletedCatalogAssetRun(db, context.assetId, before, config.analysisVersion, config.catalogRenderVersion);
          const existing = await existingAssetComplete(config, db, context, !complete);
          if ((complete || existing) && existing) {
            upsertCatalogAssetRun(db, { runId, assetId: context.assetId, sourceChecksum: before, analysisVersion: config.analysisVersion, renderVersion: config.catalogRenderVersion, status: "COMPLETED", candidatesFound: existing.candidates, candidatesSelected: existing.candidates, generatedReels: existing.reels, completed: true });
            processed += 1; selected += existing.candidates; generated += existing.reels;
            console.log(`[catalog] ${processed}/${assets.length} ${song} · reutilizado · ${existing.reels} Reel(s)`);
            continue;
          }
        }
        const analysis = await analysisFor(config, db, context, tools.ffmpeg.executablePath);
        const candidates = selectCatalogCandidates(analysis.report, { minScore: config.minReelCandidateScore, minConfidence: config.minReelConfidence, maxCandidates: config.maxReelsPerSource, maxOverlapPercent: config.maxCandidateOverlapPercent, analysisVersion: config.analysisVersion, configurationVersion: config.catalogRenderVersion });
        for (const candidate of candidates) upsertReelCandidate(db, candidate);
        if (options.operation === "analyze" || options.dryRun) {
          upsertCatalogAssetRun(db, { runId, assetId: context.assetId, sourceChecksum: before, analysisVersion: config.analysisVersion, renderVersion: config.catalogRenderVersion, status: candidates.length ? "ANALYZED" : "NO_QUALIFIED_REEL", candidatesFound: candidates.length, candidatesSelected: candidates.length, generatedReels: 0, completed: true });
        } else if (options.operation === "generate") {
          const made = await renderCandidates(config, db, context, candidates, { ffmpegPath: tools.ffmpeg.executablePath, ffprobePath: tools.ffprobe.executablePath });
          const after = await sourceChecksum(context);
          if (after !== before) throw new Error("CRITICAL_SOURCE_CHECKSUM_CHANGED_AFTER_PROCESSING");
          upsertCatalogAssetRun(db, { runId, assetId: context.assetId, sourceChecksum: before, analysisVersion: config.analysisVersion, renderVersion: config.catalogRenderVersion, status: candidates.length ? "COMPLETED" : "NO_QUALIFIED_REEL", candidatesFound: candidates.length, candidatesSelected: candidates.length, generatedReels: made, completed: true });
          generated += made;
        } else if (options.operation === "editorial") {
          const count = await editorialForAsset(config, db, context, { ffmpegPath: tools.ffmpeg.executablePath, ffprobePath: tools.ffprobe.executablePath });
          upsertCatalogAssetRun(db, { runId, assetId: context.assetId, sourceChecksum: before, analysisVersion: config.analysisVersion, renderVersion: config.catalogRenderVersion, status: "COMPLETED", candidatesFound: candidates.length, candidatesSelected: candidates.length, generatedReels: count, completed: true });
          generated += count;
        } else {
          const count = await validateAsset(config, db, context, tools.ffprobe.executablePath);
          upsertCatalogAssetRun(db, { runId, assetId: context.assetId, sourceChecksum: before, analysisVersion: config.analysisVersion, renderVersion: config.catalogRenderVersion, status: "COMPLETED", candidatesFound: candidates.length, candidatesSelected: candidates.length, generatedReels: count, completed: true });
          generated += count;
        }
        processed += 1; selected += candidates.length; if (!candidates.length) noQualified += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.split(":")[0] || "ASSET_FAILED";
        failures.push({ assetId: String(row.asset_id), song, code, message });
        upsertCatalogAssetRun(db, { runId, assetId: String(row.asset_id), sourceChecksum: row.checksum_sha256 ? String(row.checksum_sha256) : null, analysisVersion: config.analysisVersion, renderVersion: config.catalogRenderVersion, status: "FAILED", candidatesFound: 0, candidatesSelected: 0, generatedReels: 0, failureCode: code, failureMessageSafe: message.slice(0, 500), completed: true });
        if (code.startsWith("CHECKSUM") || code.startsWith("CRITICAL") || code.startsWith("DATABASE") || code.startsWith("REELS_ROOT")) throw error;
        processed += 1;
        console.log(`[catalog] ${processed}/${assets.length} ${song} · FALHA ${code}`);
      }
      updateCatalogRun(db, runId, { processedAssets: processed, selectedCandidates: selected, generatedReels: generated, failedAssets: failures.length, noQualifiedAssets: noQualified });
      if (failures.length === 0 || failures.at(-1)?.assetId !== String(row.asset_id)) console.log(`[catalog] ${processed}/${assets.length} ${song} · candidatos ${selected} acumulado · Reels ${generated} acumulado`);
    }
    updateCatalogRun(db, runId, { status: failures.length ? "COMPLETED_WITH_WARNINGS" : "COMPLETED", processedAssets: processed, selectedCandidates: selected, generatedReels: generated, failedAssets: failures.length, noQualifiedAssets: noQualified, errorSummary: Object.fromEntries(failures.reduce((map, item) => map.set(item.code, (map.get(item.code) ?? 0) + 1), new Map<string, number>())), completed: true });
    const distribution = { zero: 0, one: 0, two: 0, three: 0 };
    for (const row of catalogAssetRunRows(db, runId)) { const count = Math.min(3, Number(row.candidates_selected ?? 0)); if (count === 0) distribution.zero += 1; else if (count === 1) distribution.one += 1; else if (count === 2) distribution.two += 1; else distribution.three += 1; }
    return { runId, operation: options.operation, totalAssets: assets.length, processedAssets: processed, selectedCandidates: selected, generatedReels: generated, failedAssets: failures.length, noQualifiedAssets: noQualified, candidateDistribution: distribution, failures, elapsedMs: Date.now() - started };
  } catch (error) {
    if (runId) updateCatalogRun(db, runId, { status: "FAILED", failedAssets: failures.length + 1, errorSummary: Object.fromEntries(failures.map((item) => [item.code, 1])), completed: true });
    throw error;
  } finally { db.close(); }
}

export async function writeCatalogManifest(config: MediaConfig = loadConfig()): Promise<{ jsonPath: string; htmlPath: string }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const db = openDatabase(config);
  try {
    const catalog = await loadSongCatalog(config.repoRoot);
    const rows = listAssets(db).filter((row) => row.match_status === "MATCHED" && row.availability_status === "LOCAL_AVAILABLE");
    const songs = rows.map((row) => {
      const source = sourceSong(row, catalog);
      const reels = derivedReelsForAsset(db, String(row.asset_id)).filter((reel) => String(reel.validation_status) === "PASS");
      return { asset_id: row.asset_id, song: source?.title ?? row.source_filename, source_filename: row.source_filename, collection: source?.collection ?? null, output_collection: source ? collectionDirectory(source.collection) : "Outros", source_status: row.availability_status, candidate_count: candidatesForAsset(db, String(row.asset_id)).length, selected_count: reels.length, reels: reels.map((reel) => ({ reel_id: reel.reel_id, output_relative_path: reel.output_relative_path, validation_status: reel.validation_status, rights_status: reel.rights_status, editorial: latestEditorialPackage(db, String(reel.reel_id)) })), rights_status: row.rights_status, review_status: reels.length ? "READY_FOR_HUMAN_REVIEW" : "NO_QUALIFIED_REEL" };
    });
    const manifest = { phase: "PHASE 6 — CATALOG REEL FACTORY", generated_at: new Date().toISOString(), total_songs: songs.length, songs };
    const jsonPath = path.join(config.reelsOutputRoot, "catalog-review.json");
    const htmlPath = path.join(config.reelsOutputRoot, "catalog-review.html");
    await fs.writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const cards = songs.map((song) => `<article><h2>${escape(String(song.song))}</h2><p>${escape(String(song.collection ?? ""))} · ${song.selected_count} Reel(s) · ${escape(String(song.rights_status))}</p><ul>${song.reels.map((reel) => `<li><a href="./${String(reel.output_relative_path).replace(/\\/g, "/")}">${escape(String(reel.reel_id))}</a> — ${escape(String(reel.editorial?.selected_hook ?? "sem pacote editorial"))} · ${escape(String(reel.editorial?.review_status ?? ""))}</li>`).join("")}</ul></article>`).join("\n");
    await fs.writeFile(htmlPath, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vargen &amp; Fé — Catálogo de Reels</title><style>body{font:16px system-ui;background:#151311;color:#f5efe5;max-width:1200px;margin:auto;padding:24px}article{border:1px solid #66543d;border-radius:10px;margin:12px 0;padding:16px}a{color:#e3b86a}</style></head><body><h1>Vargen &amp; Fé — Catálogo de Reels</h1><p>Revisão humana obrigatória · publicação desativada</p>${cards}</body></html>`, "utf8");
    return { jsonPath, htmlPath };
  } finally { db.close(); }
}

export async function catalogStatus(config: MediaConfig = loadConfig()): Promise<Record<string, unknown>> {
  const db = openDatabase(config);
  try {
    const assets = listAssets(db).filter((row) => row.match_status === "MATCHED" && row.availability_status === "LOCAL_AVAILABLE");
    const reels = db.prepare("SELECT COUNT(*) AS count FROM derived_reels WHERE validation_status = 'PASS'").get() as { count?: number };
    const editorial = db.prepare("SELECT COUNT(*) AS count FROM reel_editorial_packages WHERE review_status = 'READY_FOR_HUMAN_REVIEW'").get() as { count?: number };
    const latestRun = db.prepare("SELECT * FROM catalog_runs ORDER BY started_at DESC LIMIT 1").get() as AssetRow | undefined;
    return { assets: assets.length, generated_reels: Number(reels.count ?? 0), review_pending_packages: Number(editorial.count ?? 0), latest_run: latestRun ?? null };
  } finally { db.close(); }
}
