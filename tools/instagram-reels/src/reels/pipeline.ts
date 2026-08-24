import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { analyzeMedia } from "../analysis/audio.js";
import { selectCandidates } from "../analysis/candidates.js";
import { candidatesForAsset, inspectAsset, openDatabase, setCandidateStatus, upsertDerivedReel, upsertReelCandidate } from "../database/db.js";
import { detectMediaTools } from "../ffmpeg/detection.js";
import { sha256File } from "../media/checksum.js";
import { assertFileInsideRoot, assertPathInside } from "../security/paths.js";
import { loadSongCatalog } from "../matching/catalog.js";
import type { DerivedReelMetadata, ReelCandidate, RightsStatus } from "../shared/types.js";
import { makeThumbnail, outputFilename, renderReel, TEMPLATE_VERSION } from "./factory.js";
import { validateReel, type ReelValidation } from "./validation.js";
import { reelId, PROCESSING_VERSION } from "../analysis/candidates.js";

type AssetContext = {
  assetId: string;
  sourcePath: string;
  sourceRelativePath: string;
  sourceFilename: string;
  checksum: string;
  durationMs: number;
  rightsStatus: string;
  songTitle: string | null;
  collection: string | null;
};

function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function collectionDirectory(collection: string | null): string {
  if (collection === "12 Meses com Deus") return "12-Meses-com-Deus";
  if (collection === "7 Dias com Deus  Fé, Força e Superação") return "7-Dias-com-Deus";
  if (collection === "Advento" || collection === "Anunciação" || collection === "Domingo da Páscoa" || collection === "Quaresma" || collection === "Solenidades" || collection === "Tempo do Natal") return "Ano-Liturgico-C";
  return "Outros";
}

function songDirectory(songTitle: string | null): string {
  const value = slugify(songTitle ?? "asset");
  return value.replace(/-(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/, "") || "asset";
}

async function assetContext(config: MediaConfig, db: DatabaseSync, assetId: string): Promise<AssetContext> {
  if (!config.mediaRoot) throw new Error("MEDIA_ROOT_NOT_CONFIGURED");
  const row = inspectAsset(db, assetId);
  if (!row) throw new Error(`ASSET_NOT_FOUND: ${assetId}`);
  if (row.match_status !== "MATCHED" || !row.confidence || !["EXACT", "HIGH"].includes(String(row.confidence))) throw new Error("ASSET_MATCH_NOT_CONFIDENT_FOR_PILOT");
  if (row.availability_status !== "LOCAL_AVAILABLE") throw new Error("ASSET_NOT_LOCALLY_AVAILABLE");
  if (!row.relative_path || !row.source_filename || !row.duration_ms || !row.checksum_sha256) throw new Error("ASSET_METADATA_INCOMPLETE");
  const sourcePath = path.resolve(config.mediaRoot, String(row.relative_path));
  await assertFileInsideRoot(config.mediaRoot, sourcePath);
  const catalog = await loadSongCatalog(config.repoRoot);
  const song = catalog.find((entry) => entry.slug === String(row.song_slug));
  return {
    assetId,
    sourcePath,
    sourceRelativePath: String(row.relative_path),
    sourceFilename: String(row.source_filename),
    checksum: String(row.checksum_sha256),
    durationMs: Number(row.duration_ms),
    rightsStatus: String(row.rights_status),
    songTitle: song?.title ?? null,
    collection: song?.category ?? null,
  };
}

export async function analyzeAsset(assetId: string, config: MediaConfig = loadConfig()): Promise<{ context: AssetContext; candidates: ReelCandidate[]; sceneChangeCount: number; audioSampleCount: number }> {
  const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
  if (!tools.ffmpeg.installed || !tools.ffmpeg.executablePath) throw new Error("FFMPEG_NOT_AVAILABLE");
  const db = openDatabase(config);
  try {
    const context = await assetContext(config, db, assetId);
    const report = await analyzeMedia(tools.ffmpeg.executablePath, context.sourcePath, context.assetId, context.durationMs);
    const candidates = selectCandidates(report);
    for (const candidate of candidates) {
      upsertReelCandidate(db, { ...candidate, status: "SELECTED" });
    }
    return { context, candidates, sceneChangeCount: report.sceneChangeCount, audioSampleCount: report.audioSampleCount };
  } finally {
    db.close();
  }
}

function metadataFor(input: {
  context: AssetContext;
  candidate: ReelCandidate;
  reelId: string;
  outputPath: string;
  validation: ReelValidation;
  generatedAt: string;
  checksumBefore: string;
  checksumAfter: string;
}): DerivedReelMetadata {
  return {
    reel_id: input.reelId,
    source_asset_id: input.context.assetId,
    source_filename: input.context.sourceFilename,
    source_relative_path: input.context.sourceRelativePath,
    song_title: input.context.songTitle,
    collection: input.context.collection,
    start_time_ms: input.candidate.startTimeMs,
    end_time_ms: input.candidate.endTimeMs,
    duration_ms: input.validation.metadata?.durationMs ?? null,
    candidate_category: input.candidate.category,
    selection_reason: input.candidate.selectionReason,
    clip_score: input.candidate.score,
    output_filename: path.basename(input.outputPath),
    output_path: input.outputPath,
    resolution: input.validation.metadata?.width && input.validation.metadata?.height ? `${input.validation.metadata.width}x${input.validation.metadata.height}` : null,
    fps: input.validation.metadata?.frameRate ?? null,
    video_codec: input.validation.metadata?.videoCodec ?? null,
    audio_codec: input.validation.metadata?.audioCodec ?? null,
    file_size: input.validation.fileSize,
    template_version: TEMPLATE_VERSION,
    processing_version: PROCESSING_VERSION,
    rights_status: input.context.rightsStatus as DerivedReelMetadata["rights_status"],
    generation_timestamp: input.generatedAt,
    validation_status: input.validation.status,
    subtitle_status: "NOT_GENERATED_NO_RELIABLE_SYNC",
    source_checksum_before: input.checksumBefore,
    source_checksum_after: input.checksumAfter,
  };
}

export type GeneratedPilotReel = {
  reelId: string;
  candidate: ReelCandidate;
  outputPath: string;
  thumbnailPath: string;
  metadataPath: string;
  validation: ReelValidation;
  metadata: DerivedReelMetadata;
};

export async function generatePilot(assetId: string, config: MediaConfig = loadConfig()): Promise<{ context: AssetContext; generated: GeneratedPilotReel[]; reviewManifestPath: string }> {
  if (!config.mediaRoot || !config.reelsOutputRoot) throw new Error("MEDIA_OR_OUTPUT_ROOT_NOT_CONFIGURED");
  const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
  if (!tools.ffmpeg.installed || !tools.ffmpeg.executablePath) throw new Error("FFMPEG_NOT_AVAILABLE");
  if (!tools.ffprobe.installed || !tools.ffprobe.executablePath) throw new Error("FFPROBE_NOT_AVAILABLE");
  const db = openDatabase(config);
  try {
    const context = await assetContext(config, db, assetId);
    const report = await analyzeMedia(tools.ffmpeg.executablePath, context.sourcePath, context.assetId, context.durationMs);
    const candidates = selectCandidates(report);
    for (const candidate of candidates) upsertReelCandidate(db, { ...candidate, status: "SELECTED" });
    const checksumBefore = await sha256File(context.sourcePath);
    if (checksumBefore !== context.checksum) throw new Error("SOURCE_CHECKSUM_CHANGED_BEFORE_PROCESSING");
    const outputDirectory = path.join(config.reelsOutputRoot, collectionDirectory(context.collection), songDirectory(context.songTitle));
    await assertPathInside(config.reelsOutputRoot, outputDirectory, true);
    await fs.mkdir(outputDirectory, { recursive: true });
    const logoPath = path.join(config.repoRoot, "public", "brand", "logo-mark.png");
    const usableLogo = await fs.stat(logoPath).then(() => logoPath).catch(() => null);
    const generated: GeneratedPilotReel[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const baseName = outputFilename(index + 1, candidate.category);
      const outputPath = path.join(outputDirectory, `${baseName}.mp4`);
      const thumbnailPath = path.join(outputDirectory, `${baseName}.jpg`);
      const metadataPath = path.join(outputDirectory, `${baseName}.metadata.json`);
      await assertPathInside(config.reelsOutputRoot, outputPath, true);
      // Re-running the same deterministic candidate updates derived artifacts
      // only; the immutable source is never touched.
      await fs.rm(outputPath, { force: true });
      await fs.rm(thumbnailPath, { force: true });
      await fs.rm(metadataPath, { force: true });
      await renderReel({ ffmpegPath: tools.ffmpeg.executablePath, sourcePath: context.sourcePath, logoPath: usableLogo, candidate, outputPath, safeZoneTopPx: config.reelSafeZoneTopPx });
      const validation = await validateReel({ config, ffprobePath: tools.ffprobe.executablePath, sourcePath: context.sourcePath, outputPath, candidate });
      if (validation.status !== "PASS") {
        setCandidateStatus(db, candidate.candidateId, "VALIDATION_FAILED");
        await fs.rm(outputPath, { force: true });
        throw new Error(`REEL_VALIDATION_FAILED: ${baseName}: ${validation.reasons.join(",")}`);
      }
      await makeThumbnail(tools.ffmpeg.executablePath, outputPath, thumbnailPath, validation.metadata?.durationMs ?? candidate.durationMs);
      generated.push({ reelId: reelId(candidate), candidate, outputPath, thumbnailPath, metadataPath, validation, metadata: {} as DerivedReelMetadata });
    }
    const checksumAfter = await sha256File(context.sourcePath);
    if (checksumAfter !== checksumBefore) throw new Error("CRITICAL_SOURCE_CHECKSUM_CHANGED_AFTER_PROCESSING");
    for (const item of generated) {
      const generatedAt = new Date().toISOString();
      item.metadata = metadataFor({ context, candidate: item.candidate, reelId: item.reelId, outputPath: item.outputPath, validation: item.validation, generatedAt, checksumBefore, checksumAfter });
      await fs.writeFile(item.metadataPath, `${JSON.stringify(item.metadata, null, 2)}\n`, "utf8");
      const outputRelativePath = path.relative(config.reelsOutputRoot, item.outputPath).split(path.sep).join("/");
      const thumbnailRelativePath = path.relative(config.reelsOutputRoot, item.thumbnailPath).split(path.sep).join("/");
      const metadataRelativePath = path.relative(config.reelsOutputRoot, item.metadataPath).split(path.sep).join("/");
      upsertDerivedReel(db, {
        reelId: item.reelId, candidateId: item.candidate.candidateId, sourceAssetId: context.assetId,
        outputRelativePath, thumbnailRelativePath, metadataRelativePath,
        videoCodec: item.validation.metadata?.videoCodec ?? null, audioCodec: item.validation.metadata?.audioCodec ?? null,
        width: item.validation.metadata?.width ?? null, height: item.validation.metadata?.height ?? null,
        fps: item.validation.metadata?.frameRate ?? null, durationMs: item.validation.metadata?.durationMs ?? null,
        fileSize: item.validation.fileSize, validationStatus: "PASS", rightsStatus: context.rightsStatus as RightsStatus,
        sourceChecksumBefore: checksumBefore, sourceChecksumAfter: checksumAfter,
        templateVersion: TEMPLATE_VERSION, processingVersion: PROCESSING_VERSION,
      });
      setCandidateStatus(db, item.candidate.candidateId, "VALIDATED");
    }
    const reviewManifestPath = path.join(outputDirectory, "review.json");
    const reviewManifest = {
      phase: "PHASE 3 — MEDIA INTELLIGENCE & REEL FACTORY PILOT",
      generated_at: new Date().toISOString(),
      source: { asset_id: context.assetId, filename: context.sourceFilename, relative_path: context.sourceRelativePath, song_title: context.songTitle, collection: context.collection, rights_status: context.rightsStatus, checksum_sha256: checksumAfter },
      subtitle_status: "NOT_GENERATED_NO_RELIABLE_SYNC",
      candidates: generated.map((item) => item.metadata),
      publication_status: "NOT_PUBLISHED",
    };
    await fs.writeFile(reviewManifestPath, `${JSON.stringify(reviewManifest, null, 2)}\n`, "utf8");
    return { context, generated, reviewManifestPath };
  } finally {
    db.close();
  }
}

export async function listStoredCandidates(assetId: string, config: MediaConfig = loadConfig()): Promise<unknown[]> {
  const db = openDatabase(config);
  try { return candidatesForAsset(db, assetId); } finally { db.close(); }
}
