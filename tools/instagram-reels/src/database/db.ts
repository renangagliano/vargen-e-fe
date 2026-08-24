import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MediaConfig } from "../config/index.js";
import type { MediaMetadata, AvailabilityStatus, RightsStatus, SongMatch, ReelCandidate, CandidateStatus } from "../shared/types.js";
import { databasePath } from "../config/index.js";

type SqlRow = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${cryptoRandom()}`;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function openDatabase(config: MediaConfig): DatabaseSync {
  fs.mkdirSync(config.pipelineStateRoot, { recursive: true });
  const db = new DatabaseSync(databasePath(config));
  db.exec("PRAGMA foreign_keys = ON;");
  const migrationPath = path.join(config.toolRoot, "migrations", "001_initial.sql");
  db.exec(fs.readFileSync(migrationPath, "utf8"));
  db.prepare("UPDATE media_assets SET rights_status = 'RIGHTS_PENDING_CONFIRMATION' WHERE rights_status = 'UNKNOWN'").run();
  return db;
}

export function createScanRun(db: DatabaseSync): string {
  const scanId = id("scan");
  db.prepare("INSERT INTO media_scan_runs (scan_id, started_at, root, status) VALUES (?, ?, ?, ?)").run(scanId, now(), "[VARGEN_MEDIA_ROOT]", "RUNNING");
  return scanId;
}

export function completeScanRun(db: DatabaseSync, scanId: string, filesSeen: number, filesIndexed: number, filesFailed: number, status: string): void {
  db.prepare("UPDATE media_scan_runs SET completed_at = ?, files_seen = ?, files_indexed = ?, files_failed = ?, status = ? WHERE scan_id = ?").run(now(), filesSeen, filesIndexed, filesFailed, status, scanId);
}

export function markLocationsAbsent(db: DatabaseSync): void {
  db.prepare("UPDATE media_locations SET exists_now = 0").run();
}

export function existingLocation(db: DatabaseSync, relativePath: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM media_locations WHERE relative_path = ?").get(relativePath) as SqlRow | undefined;
}

export function assetById(db: DatabaseSync, assetId: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM media_assets WHERE asset_id = ?").get(assetId) as SqlRow | undefined;
}

export function setLocationExists(db: DatabaseSync, relativePath: string, existsNow: boolean): void {
  db.prepare("UPDATE media_locations SET exists_now = ?, last_seen_at = ? WHERE relative_path = ?").run(existsNow ? 1 : 0, now(), relativePath);
}

export function upsertAsset(
  db: DatabaseSync,
  input: { assetId: string; checksum: string; extension: string; fileSize: number; availability: AvailabilityStatus; metadata: MediaMetadata },
): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO media_assets (
      asset_id, checksum_sha256, extension, file_size, duration_ms, width, height,
      display_aspect_ratio, sample_aspect_ratio, frame_rate, video_codec, pixel_format,
      audio_codec, audio_channels, audio_sample_rate, bitrate, container,
      availability_status, rights_status, created_at, updated_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RIGHTS_PENDING_CONFIRMATION', ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      extension = excluded.extension,
      file_size = excluded.file_size,
      duration_ms = excluded.duration_ms,
      width = excluded.width,
      height = excluded.height,
      display_aspect_ratio = excluded.display_aspect_ratio,
      sample_aspect_ratio = excluded.sample_aspect_ratio,
      frame_rate = excluded.frame_rate,
      video_codec = excluded.video_codec,
      pixel_format = excluded.pixel_format,
      audio_codec = excluded.audio_codec,
      audio_channels = excluded.audio_channels,
      audio_sample_rate = excluded.audio_sample_rate,
      bitrate = excluded.bitrate,
      container = excluded.container,
      availability_status = excluded.availability_status,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
    `).run(
    input.assetId, input.checksum, input.extension, input.fileSize,
    input.metadata.durationMs, input.metadata.width, input.metadata.height,
    input.metadata.displayAspectRatio, input.metadata.sampleAspectRatio, input.metadata.frameRate,
    input.metadata.videoCodec, input.metadata.pixelFormat, input.metadata.audioCodec,
    input.metadata.audioChannels, input.metadata.audioSampleRate, input.metadata.bitrate,
    input.metadata.container, input.availability, timestamp, timestamp, timestamp,
  );
}

export function upsertLocation(db: DatabaseSync, input: { assetId: string; relativePath: string; sourceFilename: string; size: number; mtimeMs: number }): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO media_locations (location_id, asset_id, relative_path, source_filename, source_size, source_mtime_ms, first_seen_at, last_seen_at, exists_now)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(relative_path) DO UPDATE SET
      asset_id = excluded.asset_id,
      source_filename = excluded.source_filename,
      source_size = excluded.source_size,
      source_mtime_ms = excluded.source_mtime_ms,
      last_seen_at = excluded.last_seen_at,
      exists_now = 1
  `).run(id("loc"), input.assetId, input.relativePath, input.sourceFilename, input.size, input.mtimeMs, timestamp, timestamp);
}

export function saveSongMatch(db: DatabaseSync, assetId: string, match: SongMatch): void {
  db.prepare("DELETE FROM song_media_matches WHERE asset_id = ?").run(assetId);
  db.prepare(`
    INSERT INTO song_media_matches (match_id, asset_id, song_slug, match_status, match_method, confidence, score, matched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id("match"), assetId, match.song?.slug ?? null, match.status, match.method, match.confidence, match.score, now());
}

export function listAssets(db: DatabaseSync, filter?: string): SqlRow[] {
  const conditions = ["1 = 1"];
  const params: string[] = [];
  if (filter === "available") conditions.push("a.availability_status = 'LOCAL_AVAILABLE'");
  if (filter === "unavailable") conditions.push("a.availability_status <> 'LOCAL_AVAILABLE'");
  if (["matched", "unmatched", "ambiguous", "review_required"].includes(filter ?? "")) {
    conditions.push("LOWER(COALESCE(m.match_status, 'UNMATCHED')) = ?");
    params.push(String(filter).toLowerCase());
  }
  return db.prepare(`
    SELECT a.*, l.relative_path, l.source_filename,
      COALESCE(m.match_status, 'UNMATCHED') AS match_status,
      m.song_slug, m.match_method, m.confidence, m.score
    FROM media_assets a
    LEFT JOIN media_locations l ON l.asset_id = a.asset_id AND l.exists_now = 1
    LEFT JOIN song_media_matches m ON m.asset_id = a.asset_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY a.created_at, a.asset_id
  `).all(...params) as SqlRow[];
}

export function inspectAsset(db: DatabaseSync, assetId: string): SqlRow | undefined {
  return db.prepare(`
    SELECT a.*, l.relative_path, l.source_filename, l.first_seen_at, l.last_seen_at, l.exists_now,
      m.song_slug, m.match_status, m.match_method, m.confidence, m.score
    FROM media_assets a
    LEFT JOIN media_locations l ON l.asset_id = a.asset_id
    LEFT JOIN song_media_matches m ON m.asset_id = a.asset_id
    WHERE a.asset_id = ?
    ORDER BY l.exists_now DESC
    LIMIT 1
  `).get(assetId) as SqlRow | undefined;
}

export function allLocations(db: DatabaseSync): SqlRow[] {
  return db.prepare("SELECT * FROM media_locations ORDER BY relative_path").all() as SqlRow[];
}

export function duplicateChecksums(db: DatabaseSync): SqlRow[] {
  return db.prepare(`
    SELECT checksum_sha256, COUNT(*) AS location_count, GROUP_CONCAT(relative_path, ' | ') AS locations
    FROM media_assets a JOIN media_locations l ON l.asset_id = a.asset_id
    WHERE l.exists_now = 1
    GROUP BY checksum_sha256 HAVING COUNT(*) > 1
  `).all() as SqlRow[];
}

export function catalogCounts(db: DatabaseSync): Record<string, number> {
  const rows = db.prepare("SELECT COALESCE(m.match_status, 'UNMATCHED') AS status, COUNT(DISTINCT a.asset_id) AS count FROM media_assets a LEFT JOIN song_media_matches m ON m.asset_id = a.asset_id GROUP BY status").all() as Array<{ status: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

export function upsertReelCandidate(db: DatabaseSync, candidate: ReelCandidate): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO reel_candidates (
      candidate_id, source_asset_id, start_time_ms, end_time_ms, duration_ms,
      category, score, selection_reason, status, fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      start_time_ms = excluded.start_time_ms,
      end_time_ms = excluded.end_time_ms,
      duration_ms = excluded.duration_ms,
      category = excluded.category,
      score = excluded.score,
      selection_reason = excluded.selection_reason,
      status = excluded.status,
      fingerprint = excluded.fingerprint,
      updated_at = excluded.updated_at
  `).run(
    candidate.candidateId, candidate.sourceAssetId, candidate.startTimeMs, candidate.endTimeMs,
    candidate.durationMs, candidate.category, candidate.score, candidate.selectionReason,
    candidate.status, candidate.fingerprint, timestamp, timestamp,
  );
}

export function candidateById(db: DatabaseSync, candidateId: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM reel_candidates WHERE candidate_id = ?").get(candidateId) as SqlRow | undefined;
}

export function candidatesForAsset(db: DatabaseSync, assetId: string): SqlRow[] {
  return db.prepare("SELECT * FROM reel_candidates WHERE source_asset_id = ? ORDER BY start_time_ms").all(assetId) as SqlRow[];
}

export function setCandidateStatus(db: DatabaseSync, candidateId: string, status: CandidateStatus): void {
  db.prepare("UPDATE reel_candidates SET status = ?, updated_at = ? WHERE candidate_id = ?").run(status, now(), candidateId);
}

export function upsertDerivedReel(db: DatabaseSync, input: {
  reelId: string;
  candidateId: string;
  sourceAssetId: string;
  outputRelativePath: string;
  thumbnailRelativePath: string;
  metadataRelativePath: string;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationMs: number | null;
  fileSize: number | null;
  validationStatus: "PASS" | "FAIL";
  rightsStatus: RightsStatus;
  sourceChecksumBefore: string | null;
  sourceChecksumAfter: string | null;
  templateVersion: string;
  processingVersion: string;
}): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO derived_reels (
      reel_id, candidate_id, source_asset_id, output_relative_path,
      thumbnail_relative_path, metadata_relative_path, video_codec, audio_codec,
      width, height, fps, duration_ms, file_size, validation_status, rights_status,
      source_checksum_before, source_checksum_after, template_version,
      processing_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reel_id) DO UPDATE SET
      output_relative_path = excluded.output_relative_path,
      thumbnail_relative_path = excluded.thumbnail_relative_path,
      metadata_relative_path = excluded.metadata_relative_path,
      video_codec = excluded.video_codec,
      audio_codec = excluded.audio_codec,
      width = excluded.width,
      height = excluded.height,
      fps = excluded.fps,
      duration_ms = excluded.duration_ms,
      file_size = excluded.file_size,
      validation_status = excluded.validation_status,
      rights_status = excluded.rights_status,
      source_checksum_before = excluded.source_checksum_before,
      source_checksum_after = excluded.source_checksum_after,
      template_version = excluded.template_version,
      processing_version = excluded.processing_version,
      updated_at = excluded.updated_at
  `).run(
    input.reelId, input.candidateId, input.sourceAssetId, input.outputRelativePath,
    input.thumbnailRelativePath, input.metadataRelativePath, input.videoCodec,
    input.audioCodec, input.width, input.height, input.fps, input.durationMs,
    input.fileSize, input.validationStatus, input.rightsStatus,
    input.sourceChecksumBefore, input.sourceChecksumAfter, input.templateVersion,
    input.processingVersion, timestamp, timestamp,
  );
}

export function derivedReelById(db: DatabaseSync, reelId: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM derived_reels WHERE reel_id = ?").get(reelId) as SqlRow | undefined;
}
