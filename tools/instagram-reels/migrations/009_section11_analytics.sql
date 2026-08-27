CREATE TABLE IF NOT EXISTS instagram_analytics_snapshots (
  analytics_snapshot_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  publication_key TEXT NOT NULL,
  instagram_media_id TEXT NOT NULL,
  observation_window TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_timestamp TEXT,
  api_version TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instagram_analytics_reel_window
  ON instagram_analytics_snapshots(reel_id, observation_window, captured_at);
