CREATE TABLE IF NOT EXISTS media_assets (
  asset_id TEXT PRIMARY KEY,
  checksum_sha256 TEXT UNIQUE,
  extension TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  display_aspect_ratio TEXT,
  sample_aspect_ratio TEXT,
  frame_rate REAL,
  video_codec TEXT,
  pixel_format TEXT,
  audio_codec TEXT,
  audio_channels INTEGER,
  audio_sample_rate INTEGER,
  bitrate INTEGER,
  container TEXT,
  availability_status TEXT NOT NULL,
  rights_status TEXT NOT NULL DEFAULT 'RIGHTS_PENDING_CONFIRMATION',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_locations (
  location_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  source_filename TEXT NOT NULL,
  source_size INTEGER NOT NULL,
  source_mtime_ms REAL NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  exists_now INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS media_scan_runs (
  scan_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  root TEXT NOT NULL,
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_indexed INTEGER NOT NULL DEFAULT 0,
  files_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS song_media_matches (
  match_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  song_slug TEXT,
  match_status TEXT NOT NULL,
  match_method TEXT,
  confidence TEXT,
  score REAL,
  matched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_assets_checksum ON media_assets(checksum_sha256);
CREATE INDEX IF NOT EXISTS idx_media_locations_asset ON media_locations(asset_id);
CREATE INDEX IF NOT EXISTS idx_media_locations_exists ON media_locations(exists_now);
CREATE INDEX IF NOT EXISTS idx_song_matches_asset ON song_media_matches(asset_id);
CREATE INDEX IF NOT EXISTS idx_song_matches_status ON song_media_matches(match_status);

CREATE TABLE IF NOT EXISTS reel_candidates (
  candidate_id TEXT PRIMARY KEY,
  source_asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  category TEXT NOT NULL,
  score REAL NOT NULL,
  selection_reason TEXT NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  candidate_confidence REAL,
  score_breakdown_json TEXT,
  analysis_version TEXT,
  configuration_version TEXT,
  decision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS derived_reels (
  reel_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE REFERENCES reel_candidates(candidate_id) ON DELETE CASCADE,
  source_asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  output_relative_path TEXT NOT NULL UNIQUE,
  thumbnail_relative_path TEXT,
  metadata_relative_path TEXT,
  video_codec TEXT,
  audio_codec TEXT,
  width INTEGER,
  height INTEGER,
  fps REAL,
  duration_ms INTEGER,
  file_size INTEGER,
  validation_status TEXT NOT NULL,
  rights_status TEXT NOT NULL,
  rights_confirmed_by TEXT,
  rights_confirmed_at TEXT,
  rights_confirmation_note TEXT,
  publication_status TEXT NOT NULL DEFAULT 'NOT_PUBLISHED',
  source_checksum_before TEXT,
  source_checksum_after TEXT,
  template_version TEXT NOT NULL,
  processing_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reel_candidates_asset ON reel_candidates(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_reel_candidates_status ON reel_candidates(status);
CREATE INDEX IF NOT EXISTS idx_derived_reels_asset ON derived_reels(source_asset_id);

CREATE TABLE IF NOT EXISTS media_analysis_cache (
  analysis_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  source_checksum TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(asset_id, source_checksum, analysis_version)
);

CREATE INDEX IF NOT EXISTS idx_media_analysis_asset ON media_analysis_cache(asset_id, analysis_version);

CREATE TABLE IF NOT EXISTS catalog_runs (
  run_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  total_assets INTEGER NOT NULL DEFAULT 0,
  processed_assets INTEGER NOT NULL DEFAULT 0,
  selected_candidates INTEGER NOT NULL DEFAULT 0,
  generated_reels INTEGER NOT NULL DEFAULT 0,
  failed_assets INTEGER NOT NULL DEFAULT 0,
  no_qualified_assets INTEGER NOT NULL DEFAULT 0,
  configuration_version TEXT NOT NULL,
  error_summary_json TEXT
);

CREATE TABLE IF NOT EXISTS catalog_asset_runs (
  run_id TEXT NOT NULL REFERENCES catalog_runs(run_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  source_checksum TEXT,
  analysis_version TEXT,
  render_version TEXT,
  status TEXT NOT NULL,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  candidates_selected INTEGER NOT NULL DEFAULT 0,
  generated_reels INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  failure_message_safe TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_asset_runs_asset ON catalog_asset_runs(asset_id, status);

CREATE TABLE IF NOT EXISTS reel_editorial_packages (
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  editorial_version INTEGER NOT NULL,
  editorial_title TEXT NOT NULL,
  selected_hook TEXT NOT NULL,
  caption TEXT NOT NULL,
  bible_reference TEXT NOT NULL,
  cta TEXT NOT NULL,
  hashtags_json TEXT NOT NULL,
  content_pillar TEXT NOT NULL,
  secondary_pillar TEXT,
  editorial_intent TEXT NOT NULL,
  cover_relative_path TEXT NOT NULL,
  cover_text TEXT NOT NULL,
  review_status TEXT NOT NULL,
  publication_status TEXT NOT NULL,
  publication_priority TEXT NOT NULL,
  suggested_context TEXT NOT NULL,
  suggested_spacing TEXT NOT NULL,
  rights_status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  package_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (reel_id, editorial_version)
);

CREATE INDEX IF NOT EXISTS idx_editorial_packages_reel ON reel_editorial_packages(reel_id);

CREATE TABLE IF NOT EXISTS publication_jobs (
  publication_job_id TEXT PRIMARY KEY,
  publication_key TEXT NOT NULL UNIQUE,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  editorial_version INTEGER NOT NULL,
  publisher TEXT NOT NULL,
  mode TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  published_at TEXT,
  remote_container_id TEXT,
  remote_media_id TEXT,
  error_code TEXT,
  error_message_safe TEXT,
  failure_class TEXT,
  locked_by TEXT,
  locked_until TEXT,
  payload_json_safe TEXT
);

CREATE INDEX IF NOT EXISTS idx_publication_jobs_due ON publication_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_reel ON publication_jobs(reel_id);

CREATE TABLE IF NOT EXISTS publication_audit_events (
  event_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata_json_safe TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publication_audit_entity ON publication_audit_events(entity_type, entity_id, timestamp);
