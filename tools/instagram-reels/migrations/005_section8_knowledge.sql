CREATE TABLE IF NOT EXISTS knowledge_bible_resolutions (
  resolution_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  song_slug TEXT NOT NULL,
  resolver_version TEXT NOT NULL,
  suggested_reference TEXT,
  book TEXT,
  chapter INTEGER,
  verse_start INTEGER,
  verse_end INTEGER,
  classification TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  evidence_level TEXT NOT NULL,
  knowledge_confidence TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  biblical_story TEXT NOT NULL,
  core_message TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  evidence_sources_json TEXT NOT NULL,
  legacy_reference TEXT,
  human_verified_reference TEXT,
  conflict_reason TEXT,
  reasoning_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, resolver_version)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bible_reel ON knowledge_bible_resolutions(reel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_bible_classification ON knowledge_bible_resolutions(classification, confidence_level);

CREATE TABLE IF NOT EXISTS knowledge_editorial_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  song_slug TEXT NOT NULL,
  suggestion_version TEXT NOT NULL,
  base_editorial_version INTEGER NOT NULL,
  package_json TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL,
  source_context_json TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, suggestion_version)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_editorial_reel ON knowledge_editorial_suggestions(reel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_editorial_status ON knowledge_editorial_suggestions(status);

CREATE TABLE IF NOT EXISTS section8_editorial_calibrations (
  calibration_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  song_slug TEXT NOT NULL,
  calibration_version TEXT NOT NULL,
  old_overall_score REAL,
  old_editorial_quality_score REAL,
  structural_compliance REAL NOT NULL,
  specificity_score REAL NOT NULL,
  biblical_alignment_score REAL NOT NULL,
  song_context_alignment_score REAL NOT NULL,
  distinctiveness_score REAL NOT NULL,
  brand_voice_score REAL NOT NULL,
  narrative_value_score REAL NOT NULL,
  cta_quality_score REAL NOT NULL,
  retention_potential_score REAL NOT NULL,
  duplication_penalty REAL NOT NULL,
  editorial_quality_score REAL NOT NULL,
  generic_language_level TEXT NOT NULL,
  generic_phrases_json TEXT NOT NULL,
  duplicate_risk TEXT NOT NULL,
  related_reel_ids_json TEXT NOT NULL,
  bible_classification TEXT NOT NULL,
  review_queue TEXT NOT NULL,
  review_priority_score REAL NOT NULL,
  review_priority_rank INTEGER,
  reasoning_summary TEXT NOT NULL,
  knowledge_context_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, calibration_version)
);

CREATE INDEX IF NOT EXISTS idx_section8_calibration_reel ON section8_editorial_calibrations(reel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_section8_calibration_queue ON section8_editorial_calibrations(review_queue, review_priority_rank);
