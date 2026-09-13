PRAGMA foreign_keys = ON;

-- Identity is intentionally provider-neutral. Authentication credentials are
-- managed by the selected identity provider, never stored in this database.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  phone_e164 TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'zh', 'de')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trading_name TEXT,
  vat_id TEXT,
  billing_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE organisation_members (
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'dispatcher', 'finance', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organisation_id, user_id)
);

CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_organisation_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
  label TEXT,
  contact_name TEXT,
  contact_phone_e164 TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'DE',
  latitude REAL,
  longitude REAL,
  access_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE fleets (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE driver_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  fleet_id TEXT REFERENCES fleets(id) ON DELETE SET NULL,
  onboarding_status TEXT NOT NULL DEFAULT 'started' CHECK (onboarding_status IN ('started', 'submitted', 'verified', 'rejected', 'suspended')),
  availability_status TEXT NOT NULL DEFAULT 'offline' CHECK (availability_status IN ('offline', 'available', 'busy')),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  owner_driver_id TEXT REFERENCES driver_profiles(id) ON DELETE SET NULL,
  fleet_id TEXT REFERENCES fleets(id) ON DELETE SET NULL,
  vehicle_class TEXT NOT NULL CHECK (vehicle_class IN ('bike', 'cargo-bike', 'car', 'caddy', 'transporter', 'xl-transporter')),
  registration_number TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'DE',
  make TEXT,
  model TEXT,
  payload_kg INTEGER,
  cargo_length_cm INTEGER,
  cargo_width_cm INTEGER,
  cargo_height_cm INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (country_code, registration_number)
);

CREATE TABLE partner_documents (
  id TEXT PRIMARY KEY,
  driver_id TEXT REFERENCES driver_profiles(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('identity', 'driving_licence', 'vehicle_registration', 'insurance', 'business_registration', 'other')),
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
  expires_at TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (driver_id IS NOT NULL OR vehicle_id IS NOT NULL)
);

CREATE TABLE quote_estimates (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  vehicle_class TEXT NOT NULL,
  distance_km REAL NOT NULL CHECK (distance_km > 0),
  extra_stops INTEGER NOT NULL DEFAULT 0 CHECK (extra_stops BETWEEN 0 AND 19),
  inputs_json TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  net_amount_cents INTEGER NOT NULL CHECK (net_amount_cents >= 0),
  vat_amount_cents INTEGER NOT NULL CHECK (vat_amount_cents >= 0),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  valid_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  public_reference TEXT NOT NULL UNIQUE,
  customer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_organisation_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
  quote_id TEXT REFERENCES quote_estimates(id) ON DELETE SET NULL,
  service_type TEXT NOT NULL DEFAULT 'on-demand' CHECK (service_type IN ('on-demand', 'scheduled')),
  vehicle_class TEXT NOT NULL,
  scheduled_pickup_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'offered', 'accepted', 'en_route_pickup', 'at_pickup', 'in_transit', 'delivered', 'cancelled', 'disputed')),
  currency TEXT NOT NULL DEFAULT 'EUR',
  net_amount_cents INTEGER NOT NULL CHECK (net_amount_cents >= 0),
  vat_amount_cents INTEGER NOT NULL CHECK (vat_amount_cents >= 0),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
  customer_notes TEXT,
  accepted_terms_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_stops (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('pickup', 'dropoff')),
  address_id TEXT REFERENCES addresses(id) ON DELETE RESTRICT,
  contact_name TEXT,
  contact_phone_e164 TEXT,
  access_code_hash TEXT,
  instructions TEXT,
  planned_at TEXT,
  arrived_at TEXT,
  completed_at TEXT,
  proof_storage_key TEXT,
  proof_recipient_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, sequence_number)
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  weight_kg REAL,
  length_cm REAL,
  width_cm REAL,
  height_cm REAL,
  declared_value_cents INTEGER,
  is_fragile INTEGER NOT NULL DEFAULT 0 CHECK (is_fragile IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id TEXT NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  assignment_method TEXT NOT NULL DEFAULT 'driver-accepts' CHECK (assignment_method IN ('driver-accepts', 'fleet-dispatch', 'admin-assist')),
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed')),
  offered_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  completed_at TEXT,
  UNIQUE (order_id, driver_id, status)
);

CREATE TABLE order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  latitude REAL,
  longitude REAL,
  data_json TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payment_records (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'authorised', 'captured', 'failed', 'refunded', 'cancelled')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_addresses_owner_user ON addresses(owner_user_id);
CREATE INDEX idx_addresses_owner_org ON addresses(owner_organisation_id);
CREATE INDEX idx_drivers_fleet_status ON driver_profiles(fleet_id, onboarding_status);
CREATE INDEX idx_vehicles_fleet_status ON vehicles(fleet_id, verification_status);
CREATE INDEX idx_quotes_requester_created ON quote_estimates(requester_user_id, created_at DESC);
CREATE INDEX idx_orders_customer_created ON orders(customer_user_id, created_at DESC);
CREATE INDEX idx_orders_org_created ON orders(customer_organisation_id, created_at DESC);
CREATE INDEX idx_orders_status_pickup ON orders(status, scheduled_pickup_at);
CREATE INDEX idx_order_stops_order_sequence ON order_stops(order_id, sequence_number);
CREATE INDEX idx_assignments_order_status ON assignments(order_id, status);
CREATE INDEX idx_assignments_driver_status ON assignments(driver_id, status);
CREATE INDEX idx_order_events_order_time ON order_events(order_id, occurred_at);
CREATE INDEX idx_payments_order_status ON payment_records(order_id, status);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id, created_at DESC);
