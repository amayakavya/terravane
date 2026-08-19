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
  migrate(db);
  return db;
}

/// CREATE TABLE IF NOT EXISTS does nothing for a table that already exists but
/// has since grown a column, and this index survives across runs. Everything in
/// here is derived, so a column that arrives empty fills itself on the next
/// resync rather than needing a backfill.
function migrate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(batches)").all().map((c) => c.name));
  const wanted = [
    ["pending_awaiting", "TEXT"],
    ["pending_terms", "TEXT"],
    ["pending_round", "INTEGER"]
  ];
  for (const [name, decl] of wanted) {
    if (!columns.has(name)) db.exec(`ALTER TABLE batches ADD COLUMN ${name} ${decl}`);
  }
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
  -- The open deal, mirrored off chain so a desk can be asked "what is waiting
  -- on me" in one query instead of one RPC call per lot it might be.
  pending_awaiting   TEXT,
  pending_terms      TEXT,
  pending_round      INTEGER,
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

-- A farmer's (or whoever currently holds a lot's) declared shipping plan: the
-- ordered addresses it should pass through next. This is intent, not a claim
-- about the produce — every hop it describes is still individually proposed
-- and countersigned on-chain when it happens, so nothing trust-critical
-- depends on the plan surviving a wipe. It rebuilds as empty, same as the
-- rest of this file, which is correct: a plan written against last session's
-- batch #6 has nothing to say about whatever lot becomes #6 next time.
CREATE TABLE IF NOT EXISTS routes (
  batch_id   INTEGER PRIMARY KEY,
  steps      TEXT NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

/** The plan for a lot, with steps parsed back into an array. Null if none is set. */
export function getRoute(db, batchId) {
  const row = db.prepare("SELECT * FROM routes WHERE batch_id = ?").get(batchId);
  if (!row) return null;
  return { batchId: row.batch_id, steps: JSON.parse(row.steps), nextIndex: row.next_index, createdBy: row.created_by, createdAt: row.created_at };
}

/** Replace whatever plan a lot had (there is only ever one) with a fresh one, one step in. */
export function setRoute(db, batchId, steps, createdBy) {
  db.prepare(`
    INSERT INTO routes(batch_id, steps, next_index, created_by, created_at)
    VALUES(@batchId, @steps, 1, @createdBy, @createdAt)
    ON CONFLICT(batch_id) DO UPDATE SET
      steps = excluded.steps, next_index = 1, created_by = excluded.created_by, created_at = excluded.created_at
  `).run({ batchId, steps: JSON.stringify(steps), createdBy, createdAt: Math.floor(Date.now() / 1000) });
}

/** Move the plan on by one hop, or clear it if that was the last one. Returns the plan, or null if it's done. */
export function advanceRoute(db, batchId) {
  const route = getRoute(db, batchId);
  if (!route) return null;
  const nextIndex = route.nextIndex + 1;
  if (nextIndex >= route.steps.length) {
    db.prepare("DELETE FROM routes WHERE batch_id = ?").run(batchId);
    return null;
  }
  db.prepare("UPDATE routes SET next_index = ? WHERE batch_id = ?").run(nextIndex, batchId);
  return { ...route, nextIndex };
}

export function clearRoute(db, batchId) {
  db.prepare("DELETE FROM routes WHERE batch_id = ?").run(batchId);
}

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
