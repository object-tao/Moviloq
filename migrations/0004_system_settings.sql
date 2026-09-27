-- Additive storage for new configuration kinds. Existing versions and identities stay intact.
CREATE TABLE ops_settings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('site','parameters','country','city')),
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
CREATE INDEX ops_settings_active ON ops_settings(kind,scope,status,effective_at DESC);
CREATE VIEW ops_all_configs AS SELECT * FROM ops_configs UNION ALL SELECT * FROM ops_settings;
