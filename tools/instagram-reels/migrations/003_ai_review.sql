CREATE TABLE IF NOT EXISTS ai_reel_reviews (
  ai_review_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  ai_review_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  ai_reviewed_at TEXT NOT NULL,
  editorial_quality_score REAL NOT NULL,
  hook_score REAL NOT NULL,
  caption_score REAL NOT NULL,
  cta_score REAL NOT NULL,
  hashtag_score REAL NOT NULL,
  title_score REAL NOT NULL,
  pillar_consistency_score REAL NOT NULL,
  collection_consistency_score REAL NOT NULL,
  biblical_consistency_score REAL NOT NULL,
  theological_risk REAL NOT NULL,
  duplicate_risk TEXT NOT NULL,
  retention_score REAL NOT NULL,
  clarity_score REAL NOT NULL,
  emotional_impact_score REAL NOT NULL,
  authenticity_score REAL NOT NULL,
  clickbait_risk REAL NOT NULL,
  overall_ai_score REAL NOT NULL,
  ai_recommendation TEXT NOT NULL,
  ai_reasoning_summary TEXT NOT NULL,
  related_reel_ids_json TEXT NOT NULL,
  review_priority_score REAL,
  review_priority_rank INTEGER,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, ai_review_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_reviews_reel ON ai_reel_reviews(reel_id, ai_reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_recommendation ON ai_reel_reviews(ai_recommendation);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_priority ON ai_reel_reviews(review_priority_rank);

CREATE TABLE IF NOT EXISTS ai_bible_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  ai_review_version TEXT NOT NULL,
  reference TEXT,
  book TEXT,
  chapter INTEGER,
  verse_range TEXT,
  confidence TEXT NOT NULL,
  evidence_sources_json TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  status TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, ai_review_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_bible_reel ON ai_bible_suggestions(reel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_bible_status ON ai_bible_suggestions(status);

CREATE TABLE IF NOT EXISTS ai_editorial_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  ai_review_version TEXT NOT NULL,
  base_editorial_version INTEGER NOT NULL,
  suggested_package_json TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reel_id, ai_review_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_editorial_reel ON ai_editorial_suggestions(reel_id, updated_at DESC);

