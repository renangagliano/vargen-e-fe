CREATE TABLE IF NOT EXISTS pilot_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  publication_key TEXT NOT NULL UNIQUE,
  snapshot_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pilot_snapshots_reel ON pilot_snapshots(reel_id, created_at);

CREATE TABLE IF NOT EXISTS pilot_publications (
  publication_key TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES pilot_snapshots(snapshot_id) ON DELETE RESTRICT,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  container_id TEXT,
  container_created_at TEXT,
  remote_status TEXT,
  last_checked_at TEXT,
  instagram_media_id TEXT,
  permalink TEXT,
  published_at TEXT,
  error_code TEXT,
  error_message_safe TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pilot_publications_reel ON pilot_publications(reel_id, updated_at);
