import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ROOT } from "../scripts/lib/chain.js";

// SQLite is an index, never the record. Everything in here is derived from chain
// events and can be deleted and rebuilt; the contracts remain the sole authority.
export function openDatabase(file = path.join(ROOT, "data", "index.db")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS participants (
  address    TEXT PRIMARY KEY,
  name       TEXT,
  location   TEXT,
  geohash    TEXT,
  lat        REAL,
  lon        REAL,
  roles      INTEGER,
  role_names TEXT,
  active     INTEGER,
  registered_at INTEGER
);

CREATE TABLE IF NOT EXISTS batches (
  id                 INTEGER PRIMARY KEY,
  produce_type       TEXT,
  variety            TEXT,
  quantity           TEXT,
  sold_quantity      TEXT,
  unit               TEXT,
  origin_farm        TEXT,
  custodian          TEXT,
  pending_custodian  TEXT,
  stage              INTEGER,
  recalled           INTEGER,
  cold_chain_required INTEGER,
  cold_chain_breached INTEGER,
  min_temp           INTEGER,
  max_temp           INTEGER,
  harvested_at       INTEGER,
  created_at         INTEGER,
  origin_geohash     TEXT,
  origin_location    TEXT,
  lat                REAL,
  lon                REAL,
  metadata_uri       TEXT,
  metadata_hash      TEXT,
  handover_count     INTEGER,
  telemetry_count    INTEGER,
  cert_count         INTEGER,
  inspection_count   INTEGER,
  active_certs       INTEGER,
  failed_inspections INTEGER,
  custody_intact     INTEGER,
  parents            TEXT,
  children           TEXT,
  updated_block      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_batches_custodian ON batches(custodian);
CREATE INDEX IF NOT EXISTS idx_batches_origin ON batches(origin_farm);
CREATE INDEX IF NOT EXISTS idx_batches_type ON batches(produce_type);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  block     INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  tx_hash   TEXT NOT NULL,
  ts        INTEGER,
  source    TEXT,
  name      TEXT,
  batch_id  INTEGER,
  actor     TEXT,
  args      TEXT,
  UNIQUE(tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_events_batch ON events(batch_id);
CREATE INDEX IF NOT EXISTS idx_events_block ON events(block DESC, log_index DESC);
`;

export function getMeta(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    String(value)
  );
}
