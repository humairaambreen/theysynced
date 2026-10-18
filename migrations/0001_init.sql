-- TheySynced Database Schema for Cloudflare D1 / Turso (Free Tier Compatible)
-- All organizational data stored in encrypted envelopes (enc:v1:<company_id>:...)

CREATE TABLE IF NOT EXISTS ts_users (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ts_companies (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ts_teams (
    company_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ts_assets (
    company_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ts_messages (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ts_passkeys (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ts_invites (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

-- Fast indexing for query lookups
CREATE INDEX IF NOT EXISTS idx_messages_key ON ts_messages (key);
CREATE INDEX IF NOT EXISTS idx_companies_id ON ts_companies (id);
