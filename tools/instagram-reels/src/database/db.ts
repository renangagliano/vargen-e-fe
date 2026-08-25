import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MediaConfig } from "../config/index.js";
import type { MediaMetadata, AvailabilityStatus, RightsStatus, SongMatch, ReelCandidate, CandidateStatus, EditorialPackage, EditorialReviewStatus, PublicationJob, PublicationMode, PublicationStatus, FailureClass, MediaAnalysisReport, ReelCuration } from "../shared/types.js";
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
  db.exec("PRAGMA busy_timeout = 5000;");
  const migrationRoot = path.join(config.toolRoot, "migrations");
  for (const migrationName of fs.readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(migrationRoot, migrationName), "utf8"));
  }
  ensureColumn(db, "derived_reels", "rights_confirmed_by", "TEXT");
  ensureColumn(db, "derived_reels", "rights_confirmed_at", "TEXT");
  ensureColumn(db, "derived_reels", "rights_confirmation_note", "TEXT");
  ensureColumn(db, "derived_reels", "publication_status", "TEXT NOT NULL DEFAULT 'NOT_PUBLISHED'");
  ensureColumn(db, "reel_editorial_packages", "reviewed_by", "TEXT");
  ensureColumn(db, "reel_editorial_packages", "reviewed_at", "TEXT");
  ensureColumn(db, "reel_editorial_packages", "review_note", "TEXT");
  ensureColumn(db, "reel_candidates", "candidate_confidence", "REAL");
  ensureColumn(db, "reel_candidates", "score_breakdown_json", "TEXT");
  ensureColumn(db, "reel_candidates", "analysis_version", "TEXT");
  ensureColumn(db, "reel_candidates", "configuration_version", "TEXT");
  ensureColumn(db, "reel_candidates", "decision", "TEXT");
  ensureColumn(db, "temporary_media", "drive_id", "TEXT");
  ensureColumn(db, "temporary_media", "item_id", "TEXT");
  ensureColumn(db, "temporary_media", "item_path", "TEXT");
  ensureColumn(db, "temporary_media", "permission_id", "TEXT");
  db.prepare("UPDATE media_assets SET rights_status = 'RIGHTS_PENDING_CONFIRMATION' WHERE rights_status = 'UNKNOWN'").run();
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
      category, score, selection_reason, status, fingerprint, candidate_confidence,
      score_breakdown_json, analysis_version, configuration_version, decision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      start_time_ms = excluded.start_time_ms,
      end_time_ms = excluded.end_time_ms,
      duration_ms = excluded.duration_ms,
      category = excluded.category,
      score = excluded.score,
      selection_reason = excluded.selection_reason,
      status = excluded.status,
      fingerprint = excluded.fingerprint,
      candidate_confidence = excluded.candidate_confidence,
      score_breakdown_json = excluded.score_breakdown_json,
      analysis_version = excluded.analysis_version,
      configuration_version = excluded.configuration_version,
      decision = excluded.decision,
      updated_at = excluded.updated_at
  `).run(
    candidate.candidateId, candidate.sourceAssetId, candidate.startTimeMs, candidate.endTimeMs,
    candidate.durationMs, candidate.category, candidate.score, candidate.selectionReason,
    candidate.status, candidate.fingerprint, candidate.confidence ?? null,
    candidate.scoreBreakdown ? JSON.stringify(candidate.scoreBreakdown) : null,
    candidate.analysisVersion ?? null, candidate.configurationVersion ?? null,
    candidate.decision ?? (candidate.status === "SELECTED" || candidate.status === "VALIDATED" ? "SELECTED" : null), timestamp, timestamp,
  );
}

export function candidateById(db: DatabaseSync, candidateId: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM reel_candidates WHERE candidate_id = ?").get(candidateId) as SqlRow | undefined;
}

export function candidatesForAsset(db: DatabaseSync, assetId: string): SqlRow[] {
  return db.prepare("SELECT * FROM reel_candidates WHERE source_asset_id = ? ORDER BY start_time_ms").all(assetId) as SqlRow[];
}

export function mediaAnalysisByKey(db: DatabaseSync, assetId: string, checksum: string, analysisVersion: string): MediaAnalysisReport | undefined {
  const row = db.prepare("SELECT report_json FROM media_analysis_cache WHERE asset_id = ? AND source_checksum = ? AND analysis_version = ?").get(assetId, checksum, analysisVersion) as { report_json?: string } | undefined;
  return row?.report_json ? JSON.parse(row.report_json) as MediaAnalysisReport : undefined;
}

export function saveMediaAnalysis(db: DatabaseSync, assetId: string, checksum: string, analysisVersion: string, report: MediaAnalysisReport): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO media_analysis_cache (analysis_id, asset_id, source_checksum, analysis_version, report_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, source_checksum, analysis_version) DO UPDATE SET report_json = excluded.report_json, updated_at = excluded.updated_at
  `).run(id("analysis"), assetId, checksum, analysisVersion, JSON.stringify(report), timestamp, timestamp);
}

export function beginCatalogRun(db: DatabaseSync, input: { operation: string; totalAssets: number; configurationVersion: string }): string {
  const runId = id("catalog");
  db.prepare("INSERT INTO catalog_runs (run_id, operation, started_at, status, total_assets, configuration_version) VALUES (?, ?, ?, 'RUNNING', ?, ?)").run(runId, input.operation, now(), input.totalAssets, input.configurationVersion);
  return runId;
}

export function updateCatalogRun(db: DatabaseSync, runId: string, input: { status?: string; processedAssets?: number; selectedCandidates?: number; generatedReels?: number; failedAssets?: number; noQualifiedAssets?: number; errorSummary?: Record<string, number>; completed?: boolean }): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  if (input.status !== undefined) assign("status", input.status);
  if (input.processedAssets !== undefined) assign("processed_assets", input.processedAssets);
  if (input.selectedCandidates !== undefined) assign("selected_candidates", input.selectedCandidates);
  if (input.generatedReels !== undefined) assign("generated_reels", input.generatedReels);
  if (input.failedAssets !== undefined) assign("failed_assets", input.failedAssets);
  if (input.noQualifiedAssets !== undefined) assign("no_qualified_assets", input.noQualifiedAssets);
  if (input.errorSummary !== undefined) assign("error_summary_json", JSON.stringify(input.errorSummary));
  if (input.completed) assign("completed_at", now());
  if (sets.length === 0) return;
  values.push(runId);
  db.prepare(`UPDATE catalog_runs SET ${sets.join(", ")} WHERE run_id = ?`).run(...values as Array<string | number | null>);
}

export function catalogRunById(db: DatabaseSync, runId: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM catalog_runs WHERE run_id = ?").get(runId) as SqlRow | undefined;
}

export function upsertCatalogAssetRun(db: DatabaseSync, input: { runId: string; assetId: string; sourceChecksum: string | null; analysisVersion: string; renderVersion: string; status: string; candidatesFound: number; candidatesSelected: number; generatedReels: number; failureCode?: string | null; failureMessageSafe?: string | null; completed?: boolean }): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO catalog_asset_runs (run_id, asset_id, source_checksum, analysis_version, render_version, status, candidates_found, candidates_selected, generated_reels, failure_code, failure_message_safe, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, asset_id) DO UPDATE SET status = excluded.status, candidates_found = excluded.candidates_found, candidates_selected = excluded.candidates_selected, generated_reels = excluded.generated_reels, failure_code = excluded.failure_code, failure_message_safe = excluded.failure_message_safe, completed_at = excluded.completed_at
  `).run(input.runId, input.assetId, input.sourceChecksum, input.analysisVersion, input.renderVersion, input.status, input.candidatesFound, input.candidatesSelected, input.generatedReels, input.failureCode ?? null, input.failureMessageSafe ?? null, timestamp, input.completed ? timestamp : null);
}

export function latestCompletedCatalogAssetRun(db: DatabaseSync, assetId: string, sourceChecksum: string, analysisVersion: string, renderVersion: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM catalog_asset_runs WHERE asset_id = ? AND source_checksum = ? AND analysis_version = ? AND render_version = ? AND status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 1").get(assetId, sourceChecksum, analysisVersion, renderVersion) as SqlRow | undefined;
}

export function catalogAssetRunRows(db: DatabaseSync, runId: string): SqlRow[] {
  return db.prepare("SELECT * FROM catalog_asset_runs WHERE run_id = ? ORDER BY asset_id").all(runId) as SqlRow[];
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

export function derivedReelsForAsset(db: DatabaseSync, assetId: string): SqlRow[] {
  return db.prepare("SELECT * FROM derived_reels WHERE source_asset_id = ? ORDER BY output_relative_path").all(assetId) as SqlRow[];
}

export function saveCuration(db: DatabaseSync, curation: ReelCuration): ReelCuration {
  db.prepare(`
    INSERT INTO reel_curations (
      curation_id, reel_id, candidate_id, source_asset_id, curation_version,
      absolute_quality_score, relative_song_score, distinctiveness_score,
      editorial_value_score, technical_quality_score, boundary_quality_score,
      visual_quality_score, audio_quality_score, content_density_score,
      curation_score, incremental_editorial_value, overlap_percentage,
      timestamp_distance_ms, section_separation, within_song_rank, quality_tier,
      portfolio_status, curation_decision, curation_reason,
      third_reel_justification, bible_reference_status, seasonality,
      calendar_context, created_at, curated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reel_id, curation_version) DO UPDATE SET
      candidate_id = excluded.candidate_id,
      source_asset_id = excluded.source_asset_id,
      absolute_quality_score = excluded.absolute_quality_score,
      relative_song_score = excluded.relative_song_score,
      distinctiveness_score = excluded.distinctiveness_score,
      editorial_value_score = excluded.editorial_value_score,
      technical_quality_score = excluded.technical_quality_score,
      boundary_quality_score = excluded.boundary_quality_score,
      visual_quality_score = excluded.visual_quality_score,
      audio_quality_score = excluded.audio_quality_score,
      content_density_score = excluded.content_density_score,
      curation_score = excluded.curation_score,
      incremental_editorial_value = excluded.incremental_editorial_value,
      overlap_percentage = excluded.overlap_percentage,
      timestamp_distance_ms = excluded.timestamp_distance_ms,
      section_separation = excluded.section_separation,
      within_song_rank = excluded.within_song_rank,
      quality_tier = excluded.quality_tier,
      portfolio_status = excluded.portfolio_status,
      curation_decision = excluded.curation_decision,
      curation_reason = excluded.curation_reason,
      third_reel_justification = excluded.third_reel_justification,
      bible_reference_status = excluded.bible_reference_status,
      seasonality = excluded.seasonality,
      calendar_context = excluded.calendar_context,
      curated_at = excluded.curated_at
  `).run(
    curation.curation_id, curation.reel_id, curation.candidate_id, curation.source_asset_id, curation.curation_version,
    curation.absolute_quality_score, curation.relative_song_score, curation.distinctiveness_score,
    curation.editorial_value_score, curation.technical_quality_score, curation.boundary_quality_score,
    curation.visual_quality_score, curation.audio_quality_score, curation.content_density_score,
    curation.curation_score, curation.incremental_editorial_value, curation.overlap_percentage,
    curation.timestamp_distance_ms, curation.section_separation, curation.within_song_rank,
    curation.quality_tier, curation.portfolio_status, curation.curation_decision, curation.curation_reason,
    curation.third_reel_justification, curation.bible_reference_status, curation.seasonality,
    curation.calendar_context, curation.created_at, curation.curated_at,
  );
  return curation;
}

export function latestCuration(db: DatabaseSync, reelId: string): ReelCuration | undefined {
  return db.prepare("SELECT * FROM reel_curations WHERE reel_id = ? ORDER BY curated_at DESC, curation_version DESC LIMIT 1").get(reelId) as ReelCuration | undefined;
}

export function curationsForAsset(db: DatabaseSync, assetId: string, version?: string): ReelCuration[] {
  if (version) return db.prepare("SELECT * FROM reel_curations WHERE source_asset_id = ? AND curation_version = ? ORDER BY within_song_rank, reel_id").all(assetId, version) as ReelCuration[];
  return db.prepare("SELECT * FROM reel_curations WHERE source_asset_id = ? ORDER BY curated_at DESC, within_song_rank, reel_id").all(assetId) as ReelCuration[];
}

export function curationRows(db: DatabaseSync, version?: string): ReelCuration[] {
  if (version) return db.prepare("SELECT * FROM reel_curations WHERE curation_version = ? ORDER BY source_asset_id, within_song_rank, reel_id").all(version) as ReelCuration[];
  return db.prepare("SELECT * FROM reel_curations ORDER BY curated_at DESC, source_asset_id, within_song_rank, reel_id").all() as ReelCuration[];
}

export function saveEditorialPackage(db: DatabaseSync, editorial: EditorialPackage): EditorialPackage {
  const timestamp = now();
  const current = db.prepare("SELECT editorial_version, package_json FROM reel_editorial_packages WHERE reel_id = ? ORDER BY editorial_version DESC LIMIT 1").get(editorial.reel_id) as { editorial_version?: number | null; package_json?: string } | undefined;
  if (current?.package_json) {
    const previous = JSON.parse(current.package_json) as EditorialPackage;
    const comparable = (value: EditorialPackage) => JSON.stringify({ ...value, editorial_version: 0, generated_at: "" });
    if (comparable(previous) === comparable(editorial)) return previous;
  }
  const nextVersion = current?.editorial_version ? Number(current.editorial_version) + 1 : editorial.editorial_version;
  const packageToStore = { ...editorial, editorial_version: nextVersion };
  db.prepare(`
    INSERT INTO reel_editorial_packages (
      reel_id, editorial_version, editorial_title, selected_hook, caption,
      bible_reference, cta, hashtags_json, content_pillar, secondary_pillar,
      editorial_intent, cover_relative_path, cover_text, review_status,
      publication_status, publication_priority, suggested_context,
      suggested_spacing, rights_status, package_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    packageToStore.reel_id, packageToStore.editorial_version, packageToStore.editorial_title,
    packageToStore.selected_hook, packageToStore.caption, packageToStore.bible_reference,
    packageToStore.cta, JSON.stringify(packageToStore.hashtags), packageToStore.content_pillar,
    packageToStore.secondary_pillar, packageToStore.editorial_intent,
    packageToStore.cover_filename, packageToStore.cover_text, packageToStore.review_status,
    packageToStore.publication_status, packageToStore.publication_priority,
    packageToStore.suggested_context, packageToStore.suggested_spacing,
    packageToStore.rights_status, JSON.stringify(packageToStore), timestamp, timestamp,
  );
  return packageToStore;
}

export function latestEditorialPackage(db: DatabaseSync, reelId: string): EditorialPackage | undefined {
  const row = db.prepare("SELECT package_json FROM reel_editorial_packages WHERE reel_id = ? ORDER BY editorial_version DESC LIMIT 1").get(reelId) as { package_json?: string } | undefined;
  if (!row?.package_json) return undefined;
  return JSON.parse(row.package_json) as EditorialPackage;
}

export function latestEditorialPackagesForAsset(db: DatabaseSync, assetId: string): EditorialPackage[] {
  return derivedReelsForAsset(db, assetId).map((row) => latestEditorialPackage(db, String(row.reel_id))).filter((value): value is EditorialPackage => Boolean(value));
}

export function updateRightsStatus(db: DatabaseSync, reelId: string, status: RightsStatus, actor: string, note: string): void {
  const timestamp = now();
  db.prepare("UPDATE derived_reels SET rights_status = ?, rights_confirmed_by = ?, rights_confirmed_at = ?, rights_confirmation_note = ?, updated_at = ? WHERE reel_id = ?").run(status, status === "RIGHTS_CONFIRMED" ? actor : null, status === "RIGHTS_CONFIRMED" ? timestamp : null, note, timestamp, reelId);
  db.prepare("UPDATE reel_editorial_packages SET rights_status = ?, package_json = json_set(package_json, '$.rights_status', ?), updated_at = ? WHERE reel_id = ?").run(status, status, timestamp, reelId);
}

export function updateEditorialReview(db: DatabaseSync, reelId: string, version: number, status: EditorialReviewStatus, actor: string, note: string): EditorialPackage {
  const row = db.prepare("SELECT package_json FROM reel_editorial_packages WHERE reel_id = ? AND editorial_version = ?").get(reelId, version) as { package_json?: string } | undefined;
  if (!row?.package_json) throw new Error("EDITORIAL_VERSION_NOT_FOUND");
  const packageValue = { ...(JSON.parse(row.package_json) as EditorialPackage), review_status: status, reviewed_by: actor, reviewed_at: now(), review_note: note };
  db.prepare("UPDATE reel_editorial_packages SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, package_json = ?, updated_at = ? WHERE reel_id = ? AND editorial_version = ?").run(status, actor, packageValue.reviewed_at, note, JSON.stringify(packageValue), packageValue.reviewed_at, reelId, version);
  return packageValue;
}

export function setPublicationStatus(db: DatabaseSync, reelId: string, status: PublicationStatus): void {
  db.prepare("UPDATE derived_reels SET publication_status = ?, updated_at = ? WHERE reel_id = ?").run(status, now(), reelId);
}

export function createPublicationJob(db: DatabaseSync, input: {
  jobId: string; publicationKey: string; reelId: string; editorialVersion: number; publisher: string; mode: PublicationMode; scheduledAt: string; timezone: string; status: PublicationStatus; maxAttempts: number; payloadJsonSafe: string;
}): void {
  const timestamp = now();
  db.prepare(`
    INSERT INTO publication_jobs (
      publication_job_id, publication_key, reel_id, editorial_version, publisher,
      mode, scheduled_at, timezone, status, attempt_count, max_attempts,
      created_at, updated_at, payload_json_safe
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(input.jobId, input.publicationKey, input.reelId, input.editorialVersion, input.publisher, input.mode, input.scheduledAt, input.timezone, input.status, input.maxAttempts, timestamp, timestamp, input.payloadJsonSafe);
}

export function publicationJobById(db: DatabaseSync, jobId: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM publication_jobs WHERE publication_job_id = ?").get(jobId) as SqlRow | undefined;
}

export function publicationJobByKey(db: DatabaseSync, key: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM publication_jobs WHERE publication_key = ?").get(key) as SqlRow | undefined;
}

export function successfulPublicationExists(db: DatabaseSync, key: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM publication_jobs WHERE publication_key = ? AND status = 'PUBLISHED' LIMIT 1").get(key) as { found?: number } | undefined;
  return Boolean(row?.found);
}

export function duePublicationJob(db: DatabaseSync, nowIso: string): SqlRow | undefined {
  return db.prepare("SELECT * FROM publication_jobs WHERE status IN ('SCHEDULED', 'QUEUED') AND scheduled_at <= ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) AND (locked_until IS NULL OR locked_until < ?) ORDER BY scheduled_at LIMIT 1").get(nowIso, nowIso, nowIso) as SqlRow | undefined;
}

export function lockPublicationJob(db: DatabaseSync, jobId: string, workerId: string, lockUntil: string): void {
  db.prepare("UPDATE publication_jobs SET status = 'PUBLISHING', attempt_count = attempt_count + 1, last_attempt_at = ?, locked_by = ?, locked_until = ?, updated_at = ? WHERE publication_job_id = ?").run(now(), workerId, lockUntil, now(), jobId);
}

export function updatePublicationJob(db: DatabaseSync, jobId: string, input: { status: PublicationStatus; errorCode?: string | null; errorMessageSafe?: string | null; failureClass?: FailureClass | null; nextAttemptAt?: string | null; remoteContainerId?: string | null; remoteMediaId?: string | null; publishedAt?: string | null }): void {
  db.prepare("UPDATE publication_jobs SET status = ?, error_code = ?, error_message_safe = ?, failure_class = ?, next_attempt_at = ?, remote_container_id = COALESCE(?, remote_container_id), remote_media_id = COALESCE(?, remote_media_id), published_at = COALESCE(?, published_at), locked_by = NULL, locked_until = NULL, updated_at = ? WHERE publication_job_id = ?").run(input.status, input.errorCode ?? null, input.errorMessageSafe ?? null, input.failureClass ?? null, input.nextAttemptAt ?? null, input.remoteContainerId ?? null, input.remoteMediaId ?? null, input.publishedAt ?? null, now(), jobId);
}

export function appendAuditEvent(db: DatabaseSync, input: { eventId: string; entityType: string; entityId: string; eventType: string; actor: string; metadataJsonSafe: string }): void {
  db.prepare("INSERT OR IGNORE INTO publication_audit_events (event_id, entity_type, entity_id, event_type, actor, timestamp, metadata_json_safe) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.eventId, input.entityType, input.entityId, input.eventType, input.actor, now(), input.metadataJsonSafe);
}

export type TemporaryMediaRecord = {
  temporary_media_id: string;
  reel_id: string;
  publication_key: string;
  provider: string;
  blob_container: string;
  blob_name: string;
  blob_size: number;
  derived_checksum: string;
  prepared_at: string;
  expires_at: string;
  status: string;
  cleanup_status: string;
  last_error_safe: string | null;
  created_at: string;
  updated_at: string;
  drive_id?: string | null;
  item_id?: string | null;
  item_path?: string | null;
  permission_id?: string | null;
};

export function temporaryMediaByReel(db: DatabaseSync, reelId: string): TemporaryMediaRecord | undefined {
  return db.prepare("SELECT * FROM temporary_media WHERE reel_id = ? ORDER BY updated_at DESC LIMIT 1").get(reelId) as TemporaryMediaRecord | undefined;
}

export function temporaryMediaByIdentity(db: DatabaseSync, provider: string, publicationKey: string, checksum: string): TemporaryMediaRecord | undefined {
  return db.prepare("SELECT * FROM temporary_media WHERE provider = ? AND publication_key = ? AND derived_checksum = ? LIMIT 1").get(provider, publicationKey, checksum) as TemporaryMediaRecord | undefined;
}

export function upsertTemporaryMedia(db: DatabaseSync, input: Omit<TemporaryMediaRecord, "created_at" | "updated_at">): TemporaryMediaRecord {
  const timestamp = now();
  db.prepare(`
    INSERT INTO temporary_media (
      temporary_media_id, reel_id, publication_key, provider, blob_container,
      blob_name, blob_size, derived_checksum, prepared_at, expires_at, status,
      cleanup_status, last_error_safe, created_at, updated_at, drive_id, item_id,
      item_path, permission_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, publication_key, derived_checksum) DO UPDATE SET
      reel_id = excluded.reel_id,
      blob_container = excluded.blob_container,
      blob_name = excluded.blob_name,
      blob_size = excluded.blob_size,
      prepared_at = excluded.prepared_at,
      expires_at = excluded.expires_at,
      status = excluded.status,
      cleanup_status = excluded.cleanup_status,
      last_error_safe = excluded.last_error_safe,
      drive_id = excluded.drive_id,
      item_id = excluded.item_id,
      item_path = excluded.item_path,
      permission_id = excluded.permission_id,
      updated_at = excluded.updated_at
  `).run(
    input.temporary_media_id, input.reel_id, input.publication_key, input.provider,
    input.blob_container, input.blob_name, input.blob_size, input.derived_checksum,
    input.prepared_at, input.expires_at, input.status, input.cleanup_status,
    input.last_error_safe, timestamp, timestamp, input.drive_id ?? null, input.item_id ?? null,
    input.item_path ?? null, input.permission_id ?? null,
  );
  return db.prepare("SELECT * FROM temporary_media WHERE provider = ? AND publication_key = ? AND derived_checksum = ? LIMIT 1").get(input.provider, input.publication_key, input.derived_checksum) as TemporaryMediaRecord;
}

export function updateTemporaryMediaStatus(db: DatabaseSync, temporaryMediaId: string, status: string, cleanupStatus: string, errorSafe: string | null = null): void {
  db.prepare("UPDATE temporary_media SET status = ?, cleanup_status = ?, last_error_safe = ?, updated_at = ? WHERE temporary_media_id = ?").run(status, cleanupStatus, errorSafe, now(), temporaryMediaId);
}

export function expiredTemporaryMedia(db: DatabaseSync, provider: string, prefix: string, nowIso: string): TemporaryMediaRecord[] {
  return db.prepare("SELECT * FROM temporary_media WHERE provider = ? AND blob_name LIKE ? AND status IN ('VALIDATED', 'SAS_CREATED', 'UPLOADED_PRIVATE', 'EXPIRED') AND expires_at <= ? ORDER BY expires_at").all(provider, `${prefix}/%`, nowIso) as TemporaryMediaRecord[];
}

export function auditEvents(db: DatabaseSync, entityId?: string): SqlRow[] {
  return entityId ? db.prepare("SELECT * FROM publication_audit_events WHERE entity_id = ? ORDER BY timestamp").all(entityId) as SqlRow[] : db.prepare("SELECT * FROM publication_audit_events ORDER BY timestamp").all() as SqlRow[];
}
