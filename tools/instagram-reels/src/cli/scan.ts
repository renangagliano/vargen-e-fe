import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MediaConfig } from "../config/index.js";
import { loadConfig } from "../config/index.js";
import { assetById, completeScanRun, createScanRun, existingLocation, markLocationsAbsent, openDatabase, saveSongMatch, upsertAsset, upsertLocation, duplicateChecksums, catalogCounts } from "../database/db.js";
import { detectMediaTools } from "../ffmpeg/detection.js";
import { probeMedia } from "../ffmpeg/ffprobe.js";
import { checkLocalAvailability } from "../media/availability.js";
import { sha256File, stableAssetId } from "../media/checksum.js";
import { discoverMedia } from "../media/discovery.js";
import { assertDirectoryOutside } from "../security/paths.js";
import { ensureReelsStructure } from "../media/reels-structure.js";
import { EMPTY_METADATA, type MediaMetadata, type ScanSummary } from "../shared/types.js";
import { loadSongCatalog } from "../matching/catalog.js";
import { matchMediaToSong } from "../matching/match.js";

function emptySummary(): ScanSummary {
  return { directoriesVisited: 0, supportedFilesFound: 0, mp4Files: 0, movFiles: 0, m4vFiles: 0, webmFiles: 0, locallyAvailable: 0, unavailable: 0, accessErrors: 0, indexedAssets: 0, checksumFailures: 0, ffprobeSuccesses: 0, ffprobeFailures: 0, duplicateChecksums: 0, matched: 0, unmatched: 0, ambiguous: 0, reviewRequired: 0 };
}

function metadataFromRow(row: Record<string, unknown>): MediaMetadata {
  return {
    durationMs: row.duration_ms as number | null,
    width: row.width as number | null,
    height: row.height as number | null,
    displayAspectRatio: row.display_aspect_ratio as string | null,
    sampleAspectRatio: row.sample_aspect_ratio as string | null,
    frameRate: row.frame_rate as number | null,
    videoCodec: row.video_codec as string | null,
    pixelFormat: row.pixel_format as string | null,
    audioCodec: row.audio_codec as string | null,
    audioChannels: row.audio_channels as number | null,
    audioSampleRate: row.audio_sample_rate as number | null,
    bitrate: row.bitrate as number | null,
    container: row.container as string | null,
  };
}

export async function runScan(config: MediaConfig = loadConfig()): Promise<ScanSummary> {
  if (!config.mediaRoot) throw new Error("MEDIA_ROOT_NOT_CONFIGURED: set VARGEN_MEDIA_ROOT to the local OneDrive folder.");
  const sourceStats = await fs.stat(config.mediaRoot);
  if (!sourceStats.isDirectory()) throw new Error("MEDIA_ROOT_NOT_DIRECTORY");
  await fs.mkdir(config.pipelineStateRoot, { recursive: true });
  await ensureReelsStructure(config);
  await assertDirectoryOutside(config.mediaRoot, config.pipelineStateRoot);

  const db = openDatabase(config);
  const scanId = createScanRun(db);
  markLocationsAbsent(db);
  const summary = emptySummary();
  const tools = await detectMediaTools();
  const catalog = await loadSongCatalog(config.repoRoot);
  const discovery = await discoverMedia(config.mediaRoot);
  summary.directoriesVisited = discovery.directoriesVisited;
  summary.supportedFilesFound = discovery.files.length;
  summary.mp4Files = discovery.files.filter((file) => file.extension === "mp4").length;
  summary.movFiles = discovery.files.filter((file) => file.extension === "mov").length;
  summary.m4vFiles = discovery.files.filter((file) => file.extension === "m4v").length;
  summary.webmFiles = discovery.files.filter((file) => file.extension === "webm").length;

  try {
    for (const file of discovery.files) {
      const availability = await checkLocalAvailability(file.absolutePath);
      if (availability === "NOT_LOCALLY_AVAILABLE") { summary.unavailable += 1; continue; }
      if (availability === "ACCESS_ERROR") { summary.accessErrors += 1; continue; }
      summary.locallyAvailable += 1;

      const previousLocation = existingLocation(db, file.relativePath);
      const previousAsset = previousLocation && Number(previousLocation.source_size) === file.size && Number(previousLocation.source_mtime_ms) === file.mtimeMs
        ? assetById(db, String(previousLocation.asset_id))
        : undefined;
      let checksum: string;
      try {
        checksum = previousAsset?.checksum_sha256 ? String(previousAsset.checksum_sha256) : await sha256File(file.absolutePath);
      } catch {
        summary.checksumFailures += 1;
        continue;
      }

      const assetId = stableAssetId(checksum);
      let metadata = previousAsset ? metadataFromRow(previousAsset) : EMPTY_METADATA;
      if (!previousAsset) {
        if (tools.ffprobe.installed && tools.ffprobe.executablePath) {
          try { metadata = await probeMedia(tools.ffprobe.executablePath, file.absolutePath); summary.ffprobeSuccesses += 1; }
          catch { summary.ffprobeFailures += 1; }
        } else summary.ffprobeFailures += 1;
      }

      upsertAsset(db, { assetId, checksum, extension: file.extension, fileSize: file.size, availability, metadata });
      upsertLocation(db, { assetId, relativePath: file.relativePath, sourceFilename: file.sourceFilename, size: file.size, mtimeMs: file.mtimeMs });
      const match = matchMediaToSong(file, catalog);
      saveSongMatch(db, assetId, match);
      summary.indexedAssets += 1;
      if (match.status === "MATCHED") summary.matched += 1;
      if (match.status === "UNMATCHED") summary.unmatched += 1;
      if (match.status === "AMBIGUOUS") summary.ambiguous += 1;
      if (match.status === "REVIEW_REQUIRED") summary.reviewRequired += 1;
    }
    summary.duplicateChecksums = duplicateChecksums(db).length;
    completeScanRun(db, scanId, summary.supportedFilesFound, summary.indexedAssets, summary.checksumFailures + summary.accessErrors, "COMPLETED");
  } catch (error) {
    completeScanRun(db, scanId, summary.supportedFilesFound, summary.indexedAssets, summary.checksumFailures + summary.accessErrors, "FAILED");
    throw error;
  } finally {
    db.close();
  }

  return summary;
}

export function printScanSummary(summary: ScanSummary): void {
  console.log(JSON.stringify(summary, null, 2));
}
