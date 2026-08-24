import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MediaConfig } from "../config/index.js";
import type { MediaMetadata, AvailabilityStatus, RightsStatus, SongMatch } from "../shared/types.js";
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNKNOWN', ?, ?, ?)
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
