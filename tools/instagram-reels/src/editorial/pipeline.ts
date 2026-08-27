import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { candidateById, derivedReelById, derivedReelsForAsset, inspectAsset, latestEditorialPackage, openDatabase, saveEditorialPackage } from "../database/db.js";
import { detectMediaTools } from "../ffmpeg/detection.js";
import { loadSongCatalog } from "../matching/catalog.js";
import { assertPathInside } from "../security/paths.js";
import type { CandidateCategory, EditorialPackage, RightsStatus } from "../shared/types.js";
import { generateCover } from "./cover.js";
import { generateEditorialPackage, PILOT_COLLECTION, PILOT_SONG_TITLE, validateEditorialBatch, validateEditorialPackage } from "./generator.js";
import { writeLocalReviewPage } from "./review.js";

type EditorialResult = EditorialPackage & { video_filename: string; technical: Record<string, unknown> };

function jsonPathFor(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, ".editorial.json");
}

async function fontPath(): Promise<string | null> {
  const candidates = process.platform === "win32" ? ["C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\segoeui.ttf"] : [];
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}

function outputPath(config: MediaConfig, relativePath: string): string {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  return path.resolve(config.reelsOutputRoot, relativePath);
}

async function pilotContext(config: MediaConfig, assetId: string, db: ReturnType<typeof openDatabase>): Promise<{ rows: Record<string, unknown>[]; songTitle: string; collection: string }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const asset = inspectAsset(db, assetId);
  if (!asset) throw new Error(`ASSET_NOT_FOUND: ${assetId}`);
  const catalog = await loadSongCatalog(config.repoRoot);
  const song = catalog.find((entry) => entry.slug === String(asset.song_slug));
  if (song?.title !== PILOT_SONG_TITLE || song.category !== PILOT_COLLECTION) throw new Error("PHASE4_BATCH_ONLY_PILOT_SONG");
  const rows = derivedReelsForAsset(db, assetId) as Record<string, unknown>[];
  if (rows.length !== 3) throw new Error(`PHASE4_EXPECTS_THREE_PILOT_REELS: found ${rows.length}`);
  if (rows.some((row) => String(row.validation_status) !== "PASS")) throw new Error("PHASE4_REQUIRES_VALIDATED_REELS");
  return { rows, songTitle: song.title, collection: song.category };
}

async function writeEditorialManifest(config: MediaConfig, outputDirectory: string, packages: EditorialResult[]): Promise<string> {
  const manifestPath = path.join(outputDirectory, "review.json");
  const existing = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { candidates?: Array<Record<string, unknown>>; [key: string]: unknown };
  const byReel = new Map(packages.map((item) => [item.reel_id, item]));
  existing.review_status = "READY_FOR_HUMAN_REVIEW";
  existing.publication_status = "NOT_PUBLISHED";
  existing.candidates = (existing.candidates ?? []).map((candidate) => {
    const editorial = byReel.get(String(candidate.reel_id));
    return editorial ? { ...candidate, editorial_package: editorial, cover_filename: editorial.cover_filename, cover_path: editorial.cover_path, review_status: editorial.review_status } : candidate;
  });
  await fs.writeFile(manifestPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  return manifestPath;
}

export async function generateEditorialForReel(reelId: string, config: MediaConfig = loadConfig()): Promise<EditorialResult> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
  if (!tools.ffmpeg.installed || !tools.ffmpeg.executablePath) throw new Error("FFMPEG_NOT_AVAILABLE");
  if (!tools.ffprobe.installed || !tools.ffprobe.executablePath) throw new Error("FFPROBE_NOT_AVAILABLE");
  const db = openDatabase(config);
  try {
    const derived = derivedReelById(db, reelId);
    if (!derived || String(derived.validation_status) !== "PASS") throw new Error("REEL_NOT_VALIDATED");
    const candidate = candidateById(db, String(derived.candidate_id));
    if (!candidate) throw new Error("REEL_CANDIDATE_NOT_FOUND");
    const asset = inspectAsset(db, String(derived.source_asset_id));
    if (!asset) throw new Error("REEL_SOURCE_ASSET_NOT_FOUND");
    const catalog = await loadSongCatalog(config.repoRoot);
    const song = catalog.find((entry) => entry.slug === String(asset.song_slug));
    if (song?.title !== PILOT_SONG_TITLE || song.category !== PILOT_COLLECTION) throw new Error("PHASE4_ONLY_SUPPORTS_APPROVED_PILOT");
    const sourceOutputPath = outputPath(config, String(derived.output_relative_path));
    await assertPathInside(config.reelsOutputRoot, sourceOutputPath);
    const coverPath = sourceOutputPath.replace(/\.mp4$/i, ".cover.jpg");
    await assertPathInside(config.reelsOutputRoot, coverPath, true);
    const packageDraft = generateEditorialPackage({ reelId, category: String(candidate.category) as CandidateCategory, outputPath: sourceOutputPath, rightsStatus: String(derived.rights_status) as RightsStatus });
    const errors = validateEditorialPackage(packageDraft);
    if (errors.length) throw new Error(`EDITORIAL_VALIDATION_FAILED: ${errors.join(",")}`);
    await generateCover({
      ffmpegPath: tools.ffmpeg.executablePath, ffprobePath: tools.ffprobe.executablePath,
      sourceReelPath: sourceOutputPath, outputPath: coverPath, coverText: packageDraft.cover_text,
      durationMs: Number(derived.duration_ms), fontPath: await fontPath(),
      safeZoneTopPx: config.reelSafeZoneTopPx, safeZoneBottomPx: config.reelSafeZoneBottomPx, safeZoneSidePx: config.reelSafeZoneSidePx,
    });
    const stored = saveEditorialPackage(db, packageDraft);
    const editorialPath = jsonPathFor(sourceOutputPath);
    await fs.writeFile(editorialPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    if (derived.metadata_relative_path) {
      const technicalMetadataPath = outputPath(config, String(derived.metadata_relative_path));
      await assertPathInside(config.reelsOutputRoot, technicalMetadataPath);
      const technical = JSON.parse(await fs.readFile(technicalMetadataPath, "utf8")) as Record<string, unknown>;
      technical.editorial_package = stored;
      await fs.writeFile(technicalMetadataPath, `${JSON.stringify(technical, null, 2)}\n`, "utf8");
    }
    return { ...stored, video_filename: path.basename(sourceOutputPath), technical: { duration_ms: derived.duration_ms, width: derived.width, height: derived.height, fps: derived.fps, video_codec: derived.video_codec, audio_codec: derived.audio_codec, validation_status: derived.validation_status } };
  } finally { db.close(); }
}

export async function generateEditorialBatch(assetId: string, config: MediaConfig = loadConfig()): Promise<{ packages: EditorialResult[]; manifestPath: string; reviewHtmlPath: string }> {
  const db = openDatabase(config);
  let context: { rows: Record<string, unknown>[]; songTitle: string; collection: string };
  try {
    context = await pilotContext(config, assetId, db);
  } finally { db.close(); }
  const packages: EditorialResult[] = [];
  for (const row of context.rows) packages.push(await generateEditorialForReel(String(row.reel_id), config));
  const errors = validateEditorialBatch(packages);
  if (errors.length) throw new Error(`EDITORIAL_BATCH_VALIDATION_FAILED: ${errors.join(",")}`);
  const firstOutput = outputPath(config, String(context.rows[0].output_relative_path));
  const outputDirectory = path.dirname(firstOutput);
  const manifestPath = await writeEditorialManifest(config, outputDirectory, packages);
  const reviewHtmlPath = await writeLocalReviewPage({ outputDirectory, packages });
  return { packages, manifestPath, reviewHtmlPath };
}

export async function writeReviewForAsset(assetId: string, config: MediaConfig = loadConfig()): Promise<{ manifestPath: string; reviewHtmlPath: string }> {
  const db = openDatabase(config);
  try {
    const rows = derivedReelsForAsset(db, assetId);
    const packages = rows.map((row) => latestEditorialPackage(db, String(row.reel_id))).filter((value): value is EditorialPackage => Boolean(value));
    if (packages.length !== 3) throw new Error("REVIEW_REQUIRES_THREE_EDITORIAL_PACKAGES");
    const outputDirectory = path.dirname(outputPath(config, String(rows[0].output_relative_path)));
    const enriched = packages.map((item) => {
      const row = rows.find((candidate) => String(candidate.reel_id) === item.reel_id);
      if (!row) throw new Error(`REEL_NOT_FOUND_FOR_EDITORIAL: ${item.reel_id}`);
      return { ...item, video_filename: path.basename(outputPath(config, String(row.output_relative_path))), technical: {} };
    });
    const manifestPath = await writeEditorialManifest(config, outputDirectory, enriched);
    const reviewHtmlPath = await writeLocalReviewPage({ outputDirectory, packages: enriched });
    return { manifestPath, reviewHtmlPath };
  } finally { db.close(); }
}
