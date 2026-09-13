-- Existing installations have one owner. New staff creation always specifies a role.
ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'operations', 'reviewer'));
CREATE TABLE admin_staff_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX admin_staff_events_time ON admin_staff_events(created_at DESC);
