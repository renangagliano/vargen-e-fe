CREATE TABLE IF NOT EXISTS review_sessions (
  session_id TEXT PRIMARY KEY,
  reviewer TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  queue TEXT NOT NULL,
  current_reel_id TEXT,
  reviewed_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  needs_changes_count INTEGER NOT NULL DEFAULT 0,
  content_ready_count INTEGER NOT NULL DEFAULT 0,
  last_action_at TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_review_sessions_reviewer ON review_sessions(reviewer, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_sessions_queue ON review_sessions(queue, ended_at);
