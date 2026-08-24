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
