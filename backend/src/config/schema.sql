-- ============================================================================
-- FleetOpz — PostgreSQL schema
-- Run: psql -U postgres -d fleetopz -f src/config/schema.sql
--
-- Design notes:
--  * Date-ish fields are stored as TEXT (e.g. "2026-07-15", or a full ISO
--    datetime for booking start/end). The React frontend treats these as
--    plain strings for all its status/date math, so storing them as TEXT
--    round-trips them back byte-for-byte and keeps that logic working.
--  * Money fields are NUMERIC.
--  * Bookings keep the "core" fields the app filters/derives on as real
--    columns, and stash the many extra wizard fields (pricing breakdown,
--    additional drivers, logistics, etc.) in a JSONB `details` column so new
--    frontend fields don't require a migration.
-- ============================================================================

-- ── USERS (for login / JWT auth) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  username    VARCHAR(80) UNIQUE NOT NULL,     -- login handle
  password    VARCHAR(255) NOT NULL,           -- bcrypt hash, never plain text
  role        VARCHAR(20)  NOT NULL DEFAULT 'admin',  -- admin | staff
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── CARS (the fleet) — keyed by number plate ────────────────────────────────
CREATE TABLE IF NOT EXISTS cars (
  plate                      VARCHAR(40) PRIMARY KEY,
  make                       VARCHAR(80),
  model                      VARCHAR(80),
  year                       INTEGER,
  color                      VARCHAR(40),
  fuel_type                  VARCHAR(40),
  transmission               VARCHAR(40),
  purchase                   NUMERIC(12,2) DEFAULT 0,
  purchase_advance           NUMERIC(12,2) DEFAULT 0,   -- advance already paid toward the purchase
  insurance                  NUMERIC(12,2) DEFAULT 0,
  reg                        NUMERIC(12,2) DEFAULT 0,
  other_charges              NUMERIC(12,2) DEFAULT 0,
  purchase_date              TEXT,
  insurance_expiry           TEXT,
  lta_transfer_date          TEXT,
  road_tax_expiry            TEXT,
  inspection_expiry          TEXT,
  maint                      NUMERIC(6,2)  DEFAULT 0,   -- annual maintenance % of investment
  coe                        TEXT,                       -- registration renewal / COE expiry date
  status                     VARCHAR(30)   DEFAULT 'Available',
  min_rate                   NUMERIC(12,2),
  max_rate                   NUMERIC(12,2),
  target_rate                NUMERIC(12,2),
  running_days_target        NUMERIC(12,2),
  profit_pct_target          NUMERIC(12,2),
  monthly_forecast           NUMERIC(12,2),   -- editable per-car monthly cash-receipt forecast
  maintenance_start_date     TEXT,
  maintenance_completed_at   TEXT,
  maintenance_auto_released  BOOLEAN DEFAULT false,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── BOOKINGS — keyed by app-generated id (e.g. "BK-001") ────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                    VARCHAR(20) PRIMARY KEY,
  plate                 VARCHAR(40) REFERENCES cars(plate) ON DELETE CASCADE,
  customer              VARCHAR(160),
  ic                    VARCHAR(80),         -- IC / Emirates ID / passport no.
  contact               VARCHAR(80),
  start                 TEXT,                -- pickup datetime (ISO string)
  "end"                 TEXT,                -- return datetime (ISO string)
  rate                  NUMERIC(12,2) DEFAULT 0,
  status                VARCHAR(30) DEFAULT 'Active',
  cancelled             BOOLEAN DEFAULT false,
  force_completed       BOOLEAN DEFAULT false,
  maintenance_triggered BOOLEAN DEFAULT false,
  details               JSONB  DEFAULT '{}'::jsonb,   -- passport, license, address, pricing, additionalDrivers, ...
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_plate ON bookings (plate);

-- ── EARNINGS — keyed by app-generated id (e.g. "ER-001") ────────────────────
CREATE TABLE IF NOT EXISTS earnings (
  id          VARCHAR(20) PRIMARY KEY,
  booking_id  VARCHAR(20) REFERENCES bookings(id) ON DELETE SET NULL,
  plate       VARCHAR(40),
  customer    VARCHAR(160),
  start       TEXT,
  "end"       TEXT,
  days        INTEGER DEFAULT 0,
  rate        NUMERIC(12,2) DEFAULT 0,
  total       NUMERIC(12,2) DEFAULT 0,
  locked      BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_earnings_plate ON earnings (plate);

-- ── EXPENSES — keyed by app-generated id (e.g. "EX-001") ────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id          VARCHAR(20) PRIMARY KEY,
  plate       VARCHAR(40),
  date        TEXT,
  category    VARCHAR(80),
  "desc"      TEXT,
  amount      NUMERIC(12,2) DEFAULT 0,
  receipt     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_plate ON expenses (plate);

-- ── CUSTOMERS — master customer records, keyed by IC/ID ─────────────────────
-- Identity is the IC/ID (unique). A customer is created either directly ("Add
-- New Customer") or automatically when a booking is made with a new IC (upsert).
-- Booking-derived stats (count, total spent, last rental) are computed live on
-- the frontend from bookings joined by IC — not stored here.
CREATE TABLE IF NOT EXISTS customers (
  id                  SERIAL PRIMARY KEY,
  ic                  VARCHAR(80) UNIQUE NOT NULL,
  name                VARCHAR(160) NOT NULL,
  contact             VARCHAR(80),
  email               VARCHAR(160),
  license             VARCHAR(120),
  license_expiry      TEXT,                 -- driving-license expiry date (ISO string)
  customer_type       VARCHAR(40),          -- Local | Foreigner | Tourist
  age                 INTEGER,
  dob                 TEXT,                 -- date of birth (ISO string)
  nationality         VARCHAR(80),
  driving_experience  INTEGER,              -- years
  address             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

-- Idempotent migrations so existing databases (created before these columns
-- existed) pick up the new fields without a manual rebuild. Safe to re-run.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email          VARCHAR(160);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS license_expiry TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dob            TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS nationality    VARCHAR(80);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ;
ALTER TABLE cars      ADD COLUMN IF NOT EXISTS monthly_forecast NUMERIC(12,2);
ALTER TABLE cars      ADD COLUMN IF NOT EXISTS purchase_advance NUMERIC(12,2);

-- ── EMPLOYEES — staff who operations (pickups/returns) get assigned to ──────
CREATE TABLE IF NOT EXISTS employees (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  phone       VARCHAR(40),
  role        VARCHAR(60),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RESTRICTED LICENSES — driving-license blocklist (admin managed) ──────────
-- Booking creation is blocked if the driver's license number is on this list
-- (e.g. active criminal case, court restriction). Keyed by app-generated id.
CREATE TABLE IF NOT EXISTS restricted_licenses (
  id             VARCHAR(40) PRIMARY KEY,
  license_number VARCHAR(120) NOT NULL,
  reason         VARCHAR(200),
  added_date     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── USER MANAGEMENT: extra user fields, role permissions, audit logs ────────
-- Managed users are the SAME rows used for login (the users table above), just
-- with a few extra profile fields. Idempotent so existing DBs pick them up.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email      VARCHAR(160);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status     VARCHAR(20) DEFAULT 'Active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- Role-based permission grid — one shared row per (role, module). Editing a
-- role here applies to every user with that role. Roles/modules are stored in
-- the UI's canonical form ("Admin"/"Staff"; "Dashboard","Fleet",...).
CREATE TABLE IF NOT EXISTS role_permissions (
  role       VARCHAR(20)  NOT NULL,
  module     VARCHAR(40)  NOT NULL,
  can_view   BOOLEAN NOT NULL DEFAULT false,
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_edit   BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (role, module)
);

-- Seed the default grid (Admin = full, Staff = daily-ops subset). Safe to
-- re-run; existing edits are preserved by ON CONFLICT DO NOTHING.
INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete) VALUES
  ('Admin','Dashboard',true,true,true,true),
  ('Admin','Fleet',    true,true,true,true),
  ('Admin','Bookings', true,true,true,true),
  ('Admin','Earnings', true,true,true,true),
  ('Admin','Expenses', true,true,true,true),
  ('Admin','P&L',      true,true,true,true),
  ('Admin','Alerts',   true,true,true,true),
  ('Staff','Dashboard',true,false,false,false),
  ('Staff','Fleet',    true,false,false,false),
  ('Staff','Bookings', true,true,true,false),
  ('Staff','Earnings', false,false,false,false),
  ('Staff','Expenses', true,true,false,false),
  ('Staff','P&L',      false,false,false,false),
  ('Staff','Alerts',   true,false,false,false)
ON CONFLICT (role, module) DO NOTHING;

-- Audit trail — one row per recorded action (user CRUD, permission changes,
-- logins). Newest-first when listed.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  user_name   VARCHAR(160),
  module      VARCHAR(60),
  action      VARCHAR(40),
  description TEXT,
  ip          VARCHAR(60),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);

-- ── INVESTORS — one row per investor (profile) ──────────────────────────────
-- Money movements live in investor_transactions below. App-generated string id
-- (e.g. "INV-001"), same convention as bookings/earnings.
CREATE TABLE IF NOT EXISTS investors (
  id             VARCHAR(20) PRIMARY KEY,
  name           VARCHAR(160) NOT NULL,
  status         VARCHAR(20) DEFAULT 'Active',   -- Active | Inactive
  investor_since TEXT,                            -- ISO date
  investor_code  VARCHAR(40),                     -- user-entered display id (e.g. INV-001)
  pan            VARCHAR(40),                     -- tax / ID number
  email          VARCHAR(160),
  phone          VARCHAR(40),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotent so an existing investors table picks up the display-id column.
ALTER TABLE investors ADD COLUMN IF NOT EXISTS investor_code VARCHAR(40);

-- ── INVESTOR TRANSACTIONS — the unified dated money ledger ───────────────────
-- One row per money movement. `type` is Investment | Reinvestment | Dividend |
-- Exit | Withdrawal; `flow` (IN|OUT) is derived from type and stored for cheap
-- filtering. The `date` is the cash-flow date that feeds XIRR on the frontend.
-- `status` is used for dividends (Paid | Pending); null otherwise. The UI's six
-- detail tabs are just filtered views of this one table.
CREATE TABLE IF NOT EXISTS investor_transactions (
  id           VARCHAR(20) PRIMARY KEY,
  investor_id  VARCHAR(20) REFERENCES investors(id) ON DELETE CASCADE,
  date         TEXT,
  type         VARCHAR(30),
  flow         VARCHAR(3),                        -- IN | OUT
  amount       NUMERIC(14,2) DEFAULT 0,           -- always positive; flow carries the sign
  description  TEXT,
  status       VARCHAR(20),                       -- dividends: Paid | Pending
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investor_tx_investor ON investor_transactions (investor_id);

-- Investors permission grid (Admin full; Staff no access — finance data). Safe
-- to re-run; existing edits preserved by ON CONFLICT DO NOTHING.
INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete) VALUES
  ('Admin','Investors',true,true,true,true),
  ('Staff','Investors',false,false,false,false)
ON CONFLICT (role, module) DO NOTHING;

-- No seed fleet — a fresh install starts with zero cars. Add vehicles through
-- the app (Fleet → Add Car). The role_permissions grid above is intentionally
-- kept seeded, since the app's access control relies on it.
