-- Preparation records intentionally do not create customer/driver login identities.
-- Credential storage remains in the separate ADMIN_DB, never in this database.
CREATE TABLE ops_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, last_event_id TEXT);
INSERT INTO ops_meta (id, revision) VALUES (1, 0);
CREATE TABLE ops_resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('fleet', 'driver', 'vehicle')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','needs_info','approved','rejected','suspended')),
  fleet_id TEXT REFERENCES ops_resources(id) ON DELETE RESTRICT,
  driver_id TEXT REFERENCES ops_resources(id) ON DELETE RESTRICT,
  registration TEXT,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind = 'vehicle' OR driver_id IS NULL),
  CHECK (kind != 'fleet' OR fleet_id IS NULL)
);
CREATE INDEX ops_resources_listing ON ops_resources(kind, status, updated_at DESC);
CREATE INDEX ops_resources_fleet ON ops_resources(fleet_id);
CREATE UNIQUE INDEX ops_vehicle_registration ON ops_resources(registration) WHERE kind = 'vehicle' AND registration IS NOT NULL;
CREATE UNIQUE INDEX ops_vehicle_driver ON ops_resources(driver_id) WHERE driver_id IS NOT NULL;
CREATE TABLE ops_documents (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES ops_resources(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','needs_info','approved','rejected')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 524288),
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL,
  sequence INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ops_documents_resource ON ops_documents(resource_id, document_type, created_at DESC);
CREATE INDEX ops_documents_expiry ON ops_documents(expires_on, status);
CREATE TABLE ops_configs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('region','vehicle','pricing','requirements','content')),
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  version INTEGER NOT NULL DEFAULT 1,
  effective_at TEXT,
  publication_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ops_configs_active ON ops_configs(kind, scope, status, effective_at DESC);
CREATE TABLE ops_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ops_events_resource ON ops_events(resource_id, created_at DESC);
CREATE INDEX ops_events_time ON ops_events(created_at DESC);
