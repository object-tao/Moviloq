-- Reference-only vehicle types. Separate from rated/operational vehicle classes.
-- Unknown dimensions, capacity, English terminology and tariffs are not fabricated.
CREATE TABLE ops_vehicle_type_catalog (
  id TEXT PRIMARY KEY,
  name_zh TEXT NOT NULL UNIQUE CHECK (length(name_zh) BETWEEN 1 AND 100),
  name_en TEXT CHECK (name_en IS NULL OR length(name_en) BETWEEN 1 AND 100),
  notes_zh TEXT NOT NULL DEFAULT '' CHECK (length(notes_zh) <= 1000),
  notes_en TEXT CHECK (notes_en IS NULL OR length(notes_en) <= 1000),
  status TEXT NOT NULL DEFAULT 'reference' CHECK (status IN ('reference','disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999),
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ops_vehicle_type_catalog_listing ON ops_vehicle_type_catalog(status,sort_order,id);
