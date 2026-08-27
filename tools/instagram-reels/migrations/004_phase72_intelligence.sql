CREATE TABLE IF NOT EXISTS song_source_registry (
  source_record_id TEXT PRIMARY KEY,
  song_slug TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_location TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_title TEXT,
  source_version TEXT,
  is_authoritative INTEGER NOT NULL DEFAULT 0,
  discovered_at TEXT NOT NULL,
  metadata_json_safe TEXT NOT NULL,
  UNIQUE(song_slug, source_type, source_location, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_song_source_registry_song ON song_source_registry(song_slug, source_type);
CREATE INDEX IF NOT EXISTS idx_song_source_registry_authority ON song_source_registry(is_authoritative, source_type);

CREATE TABLE IF NOT EXISTS biblical_resolution_suggestions (
  resolution_id TEXT PRIMARY KEY,
  song_slug TEXT NOT NULL,
  reel_id TEXT NOT NULL DEFAULT '',
  suggested_reference TEXT,
  book TEXT,
  chapter INTEGER,
  verse_start INTEGER,
  verse_end INTEGER,
  display_reference TEXT,
  resolution_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_source_record_ids_json TEXT NOT NULL,
  evidence_excerpt_safe TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  status TEXT NOT NULL,
  resolver_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(song_slug, reel_id, resolver_version)
);

CREATE INDEX IF NOT EXISTS idx_biblical_resolution_song ON biblical_resolution_suggestions(song_slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_biblical_resolution_status ON biblical_resolution_suggestions(status, confidence);

CREATE TABLE IF NOT EXISTS editorial_calibrations (
  calibration_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  song_slug TEXT NOT NULL,
  calibration_version TEXT NOT NULL,
  old_overall_score REAL,
  old_editorial_quality_score REAL,
  structural_scores_json TEXT NOT NULL,
  quality_scores_json TEXT NOT NULL,
  generic_language_level TEXT NOT NULL,
  generic_phrases_json TEXT NOT NULL,
  cross_catalog_similarity_json TEXT NOT NULL,
  editorial_quality_score REAL NOT NULL,
  distinctiveness_score REAL NOT NULL,
  retention_score REAL NOT NULL,
  overall_score REAL NOT NULL,
  duplicate_risk TEXT NOT NULL,
  related_reel_ids_json TEXT NOT NULL,
  biblical_evidence_status TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  fast_path_status TEXT NOT NULL,
  evidence_needed_status TEXT NOT NULL,
  review_priority_score REAL NOT NULL,
  review_priority_rank INTEGER,
  suggested_package_json TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, calibration_version)
);

CREATE INDEX IF NOT EXISTS idx_editorial_calibrations_reel ON editorial_calibrations(reel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_calibrations_queue ON editorial_calibrations(fast_path_status, evidence_needed_status);
