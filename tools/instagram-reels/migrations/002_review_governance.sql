CREATE TABLE IF NOT EXISTS bible_reference_sources (
  bible_reference_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  editorial_version INTEGER,
  reference TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_location TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  verified_by TEXT,
  verified_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bible_sources_reel ON bible_reference_sources(reel_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_bible_sources_status ON bible_reference_sources(verification_status);

CREATE TABLE IF NOT EXISTS source_rights_history (
  confirmation_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  rights_status TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmation_scope TEXT NOT NULL,
  confirmation_statement_version TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_rights_asset ON source_rights_history(asset_id, confirmed_at);

CREATE TABLE IF NOT EXISTS content_readiness (
  reel_id TEXT PRIMARY KEY REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  editorial_version INTEGER,
  gates_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
