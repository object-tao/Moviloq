-- Dedicated EU administration-auth database. No customer or booking data binding.
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (username = lower(username)),
  email_sha256 TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  credential_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX admin_sessions_user ON admin_sessions(user_id);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE admin_auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX admin_limits_expiry ON admin_auth_limits(expires_at);
CREATE TABLE admin_auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL CHECK (event IN ('login_success', 'login_failed', 'login_limited', 'logout', 'password_changed', 'owner_provisioned', 'owner_reset')),
  user_id TEXT,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_events_created ON admin_auth_events(created_at);
