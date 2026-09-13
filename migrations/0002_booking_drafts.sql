CREATE TABLE visitor_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE booking_drafts (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES visitor_sessions(token_hash) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  request_json TEXT NOT NULL,
  estimate_json TEXT NOT NULL,
  pricing_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (session_hash, idempotency_key)
);

CREATE INDEX idx_visitor_sessions_expiry ON visitor_sessions(expires_at);
CREATE INDEX idx_booking_drafts_session ON booking_drafts(session_hash, updated_at DESC);
