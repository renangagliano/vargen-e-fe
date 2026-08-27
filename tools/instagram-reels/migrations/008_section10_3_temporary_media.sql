CREATE TABLE IF NOT EXISTS temporary_media (
  temporary_media_id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES derived_reels(reel_id) ON DELETE CASCADE,
  publication_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  blob_container TEXT NOT NULL,
  blob_name TEXT NOT NULL,
  blob_size INTEGER NOT NULL,
  derived_checksum TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  cleanup_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  last_error_safe TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, publication_key, derived_checksum)
);

CREATE INDEX IF NOT EXISTS idx_temporary_media_reel ON temporary_media(reel_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_temporary_media_expiry ON temporary_media(provider, status, expires_at);
