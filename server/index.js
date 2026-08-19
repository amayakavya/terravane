import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { contracts, provider, readDeployment, ROOT, RPC_URL, STAGE_NAMES } from "../scripts/lib/chain.js";
import { decodeGeohash } from "../scripts/lib/geohash.js";
import { getMeta, getRoute, openDatabase } from "./db.js";
import { Indexer } from "./indexer.js";
import { mountActions, signingEnabled } from "./actions.js";
import { DocumentStore, mountDocuments } from "./documents.js";

const PORT = Number(process.env.PORT ?? 4300);
const deployment = readDeployment();
const prov = provider();
const db = openDatabase();
const { registry } = contracts(prov, deployment);

const documents = new DocumentStore(db);
const indexer = new Indexer({ db, provider: prov, deployment });

const app = express();
app.use(express.json({ limit: "256kb" }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const participantCache = new Map();

function participants() {
  const rows = db.prepare("SELECT * FROM participants").all();
  participantCache.clear();
  for (const row of rows) participantCache.set(row.address.toLowerCase(), row);
  return rows;
}
participants();

function who(address) {
  if (!address || address === "0x0000000000000000000000000000000000000000") return null;
  const row = participantCache.get(address.toLowerCase()) ?? participants().find((p) => p.address.toLowerCase() === address.toLowerCase());
  return row
    ? { address: row.address, name: row.name, location: row.location, roles: row.role_names.split(",").filter(Boolean), active: !!row.active, lat: row.lat, lon: row.lon, email: row.email, phone: row.phone }
    : { address, name: null, location: null, roles: [], active: null, lat: null, lon: null, email: null, phone: null };
}

function shapeBatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    produceType: row.produce_type,
    variety: row.variety,
    quantity: row.quantity,
    soldQuantity: row.sold_quantity,
    unit: row.unit,
    stage: row.stage,
    stageName: STAGE_NAMES[row.stage] ?? "unknown",
    recalled: !!row.recalled,
    coldChainRequired: !!row.cold_chain_required,
    coldChainBreached: !!row.cold_chain_breached,
    tempWindow: row.cold_chain_required ? [row.min_temp / 10, row.max_temp / 10] : null,
    harvestedAt: row.harvested_at,
    createdAt: row.created_at,
    origin: {
      farm: who(row.origin_farm),
      location: row.origin_location,
      geohash: row.origin_geohash,
      lat: row.lat,
      lon: row.lon
    },
    custodian: who(row.custodian),
    pendingCustodian: who(row.pending_custodian),
    metadataURI: row.metadata_uri,
    metadataHash: row.metadata_hash,
    counts: {
      handovers: row.handover_count,
      telemetry: row.telemetry_count,
      certifications: row.cert_count,
      inspections: row.inspection_count,
      activeCertifications: row.active_certs,
      failedInspections: row.failed_inspections
    },
    custodyIntact: !!row.custody_intact,
    parents: JSON.parse(row.parents || "[]"),
    children: JSON.parse(row.children || "[]")
  };
}

function batchRow(id) {
  return db.prepare("SELECT * FROM batches WHERE id = ?").get(id);
}

const num = (v) => (typeof v === "bigint" ? Number(v) : v);

async function dossier(id) {
  const row = batchRow(id);
  if (!row) return null;

  const [handovers, certs, telemetry, inspections, recall, farmCerts] = await Promise.all([
    registry.getHandovers(id),
    registry.getBatchCertifications(id),
    registry.getTelemetry(id),
    registry.getInspections(id),
    registry.getRecall(id),
    registry.getFarmCertifications(row.origin_farm)
  ]);

  const shapeCert = (c) => ({
    scheme: c.scheme,
    certifier: who(c.certifier),
    issuedAt: num(c.issuedAt),
    expiresAt: num(c.expiresAt),
    evidenceURI: c.evidenceURI,
    evidenceHash: c.evidenceHash,
    revoked: c.revoked,
    revocationReason: c.revocationReason,
    active: !c.revoked && (num(c.expiresAt) === 0 || num(c.expiresAt) * 1000 > Date.now())
  });

  return {
    batch: shapeBatch(row),
    attributes: documents.resolve(row.metadata_uri, row.metadata_hash),
    handovers: handovers.map((h) => ({
      from: who(h.from),
      to: who(h.to),
      proposedAt: num(h.proposedAt),
      settledAt: num(h.settledAt),
      geohash: h.geohash,
      position: decodeGeohash(h.geohash),
      note: h.note,
      documentHash: h.documentHash,
      accepted: h.accepted,
      cancelled: h.cancelled
    })),
    certifications: certs.map(shapeCert),
    farmCertifications: farmCerts.map(shapeCert),
    telemetry: telemetry.map((t) => ({
      reporter: who(t.reporter),
      observedAt: num(t.observedAt),
      tempC: Number(t.tempDeciC) / 10,
      humidityPct: Number(t.humidityDeciPct) / 10,
      geohash: t.geohash,
      position: decodeGeohash(t.geohash),
      payloadHash: t.payloadHash,
      excursion: t.excursion
    })),
    inspections: inspections.map((i) => ({
      inspector: who(i.inspector),
      at: num(i.inspectedAt),
      grade: Number(i.grade),
      passed: i.passed,
      findings: i.findings,
      reportHash: i.reportHash
    })),
    recall: row.recalled
      ? {
          initiator: who(recall.initiator),
          at: num(recall.recalledAt),
          severity: Number(recall.severity),
          reason: recall.reason,
          rootBatch: num(recall.rootBatch)
        }
      : null,
    events: db
      .prepare("SELECT block, ts, tx_hash, name, actor, args FROM events WHERE batch_id = ? ORDER BY block, log_index")
      .all(id)
      .map((e) => ({ ...e, actor: who(e.actor), args: JSON.parse(e.args) }))
  };
}

/** Walk the lineage graph in both directions from a batch. */
function lineage(id, maxNodes = 200) {
  const nodes = new Map();
  const edges = [];
  const seen = new Set();
  const queue = [id];

  while (queue.length && nodes.size < maxNodes) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const row = batchRow(current);
    if (!row) continue;

    nodes.set(current, {
      id: current,
      produceType: row.produce_type,
      variety: row.variety,
      quantity: row.quantity,
      unit: row.unit,
      stage: row.stage,
      stageName: STAGE_NAMES[row.stage] ?? "unknown",
      recalled: !!row.recalled,
      coldChainBreached: !!row.cold_chain_breached,
      custodian: who(row.custodian)?.name ?? null,
      isFocus: current === id
    });

    for (const parent of JSON.parse(row.parents || "[]")) {
      edges.push({ from: parent, to: current });
      queue.push(parent);
    }
    for (const child of JSON.parse(row.children || "[]")) {
      edges.push({ from: current, to: child });
      queue.push(child);
    }
  }

  const key = (e) => `${e.from}->${e.to}`;
  const unique = [...new Map(edges.map((e) => [key(e), e])).values()].filter((e) => nodes.has(e.from) && nodes.has(e.to));
  return { nodes: [...nodes.values()], edges: unique };
}

/** Every batch reachable downstream, which is exactly what a recall must reach. */
function descendants(id) {
  const out = new Set();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    const row = batchRow(current);
    if (!row) continue;
    for (const child of JSON.parse(row.children || "[]")) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

app.get("/api/health", async (_req, res) => {
  let head = null;
  let chainError = null;
  try {
    head = await prov.getBlockNumber();
  } catch (err) {
    chainError = err.message;
  }
  res.json({
    ok: chainError === null && indexer.ready,
    ready: indexer.ready,
    rpc: RPC_URL,
    chainId: deployment.chainId,
    contracts: { accessRegistry: deployment.accessRegistry, produceRegistry: deployment.produceRegistry },
    chainHead: head,
    indexedBlock: Number(getMeta(db, "lastBlock", "0")),
    syncedAt: Number(getMeta(db, "syncedAt", "0")) || null,
    indexerError: indexer.lastError,
    chainError,
    signingEnabled: signingEnabled()
  });
});

app.get("/api/stats", (_req, res) => {
  const totals = db
    .prepare(`
      SELECT COUNT(*) AS batches,
             SUM(recalled) AS recalled,
             SUM(cold_chain_breached) AS breached,
             SUM(CASE WHEN pending_custodian IS NOT NULL THEN 1 ELSE 0 END) AS openHandovers,
             SUM(CASE WHEN custody_intact = 0 THEN 1 ELSE 0 END) AS custodyGaps,
             SUM(failed_inspections) AS failedInspections
      FROM batches
    `)
    .get();

  res.json({
    ...totals,
    participants: db.prepare("SELECT COUNT(*) AS n FROM participants").get().n,
    events: db.prepare("SELECT COUNT(*) AS n FROM events").get().n,
    byStage: db
      .prepare("SELECT stage, COUNT(*) AS n FROM batches GROUP BY stage ORDER BY stage")
      .all()
      .map((r) => ({ stage: r.stage, stageName: STAGE_NAMES[r.stage] ?? "unknown", count: r.n })),
    byProduce: db
      .prepare("SELECT produce_type AS produceType, unit, COUNT(*) AS lots, SUM(CAST(quantity AS INTEGER)) AS quantity FROM batches GROUP BY produce_type, unit ORDER BY lots DESC")
      .all()
  });
});

app.get("/api/participants", (_req, res) => {
  res.json(
    participants().map((p) => ({
      address: p.address,
      name: p.name,
      location: p.location,
      roles: p.role_names.split(",").filter(Boolean),
      active: !!p.active,
      lat: p.lat,
      lon: p.lon,
      email: p.email,
      phone: p.phone,
      holding: db.prepare("SELECT COUNT(*) AS n FROM batches WHERE custodian = ?").get(p.address).n
    }))
  );
});

// Off-chain and self-service: a participant sets how they want to be reached,
// and only for their own address. This never touches the chain, so it works
// even when TERRAVANE_SIGNING is off — there is nothing here for a dev key
// to sign, only a claim about how to reach the person who is already signed
// in as this address.
app.post("/api/participants/:address/contact", (req, res) => {
  const address = req.params.address;
  const as = String(req.body.as ?? "");
  if (!as || as.toLowerCase() !== address.toLowerCase()) {
    return res.status(403).json({ error: "you can only edit your own contact details" });
  }
  if (!participantCache.has(address.toLowerCase()) && !participants().some((p) => p.address.toLowerCase() === address.toLowerCase())) {
    return res.status(404).json({ error: "unknown participant" });
  }

  const email = (req.body.email ?? "").trim() || null;
  const phone = (req.body.phone ?? "").trim() || null;
  db.prepare("UPDATE participants SET email = ?, phone = ? WHERE address = ?").run(email, phone, address);
  participants();
  res.json({ ok: true, email, phone });
});

app.get("/api/batches", (req, res) => {
  const clauses = [];
  const params = {};

  if (req.query.q) {
    clauses.push("(produce_type LIKE @q OR variety LIKE @q OR origin_location LIKE @q OR CAST(id AS TEXT) = @exact)");
    params.q = `%${req.query.q}%`;
    params.exact = String(req.query.q);
  }
  if (req.query.stage !== undefined && req.query.stage !== "") {
    clauses.push("stage = @stage");
    params.stage = Number(req.query.stage);
  }
  if (req.query.custodian) {
    clauses.push("LOWER(custodian) = LOWER(@custodian)");
    params.custodian = req.query.custodian;
  }
  if (req.query.origin) {
    clauses.push("LOWER(origin_farm) = LOWER(@origin)");
    params.origin = req.query.origin;
  }
  const flag = req.query.flag;
  if (flag === "recalled") clauses.push("recalled = 1");
  if (flag === "breached") clauses.push("cold_chain_breached = 1");
  if (flag === "open") clauses.push("pending_custodian IS NOT NULL");
  if (flag === "clean") clauses.push("recalled = 0 AND cold_chain_breached = 0 AND custody_intact = 1");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const rows = db.prepare(`SELECT * FROM batches ${where} ORDER BY id DESC LIMIT ${limit}`).all(params);
  res.json(rows.map(shapeBatch));
});

app.get("/api/batches/:id", async (req, res) => {
  const data = await dossier(Number(req.params.id));
  if (!data) return res.status(404).json({ error: "no such batch" });
  res.json(data);
});

app.get("/api/batches/:id/lineage", (req, res) => {
  const id = Number(req.params.id);
  if (!batchRow(id)) return res.status(404).json({ error: "no such batch" });
  res.json(lineage(id));
});

app.get("/api/batches/:id/descendants", (req, res) => {
  const id = Number(req.params.id);
  if (!batchRow(id)) return res.status(404).json({ error: "no such batch" });
  res.json({ root: id, descendants: descendants(id) });
});

app.get("/api/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 60), 500);
  const rows = req.query.batch
    ? db.prepare("SELECT * FROM events WHERE batch_id = ? ORDER BY block DESC, log_index DESC LIMIT ?").all(Number(req.query.batch), limit)
    : db.prepare("SELECT * FROM events ORDER BY block DESC, log_index DESC LIMIT ?").all(limit);
  res.json(rows.map((e) => ({ ...e, actor: who(e.actor), args: JSON.parse(e.args) })));
});

/// What one participant needs to be told: anything they did, anything done to a
/// lot they hold or grew, and every recall regardless of who it touches.
app.get("/api/notifications", (req, res) => {
  const address = String(req.query.as ?? "").toLowerCase();
  if (!address) return res.status(400).json({ error: "an address is required" });
  const limit = Math.min(Number(req.query.limit ?? 40), 200);

  const rows = db
    .prepare(`
      SELECT e.*, b.produce_type, b.variety, b.quantity, b.unit FROM events e
      LEFT JOIN batches b ON b.id = e.batch_id
      WHERE LOWER(e.actor) = @address
         OR LOWER(b.custodian) = @address
         OR LOWER(b.origin_farm) = @address
         OR LOWER(b.pending_custodian) = @address
         OR e.name IN ('RecallInitiated', 'RecallPropagated')
      ORDER BY e.block DESC, e.log_index DESC
      LIMIT ${limit}
    `)
    .all({ address });

  res.json(
    rows.map((e) => {
      const args = JSON.parse(e.args);
      return {
        name: e.name,
        batchId: e.batch_id,
        actor: who(e.actor),
        // A raw address in a custody event tells a farmer nothing about their
        // own crop's journey — resolve who it moved from and to, same as
        // every other participant-facing address in this API.
        from: args.from ? who(args.from) : null,
        to: args.to ? who(args.to) : null,
        produce: e.produce_type ? { produceType: e.produce_type, variety: e.variety, quantity: e.quantity, unit: e.unit } : null,
        at: e.ts,
        txHash: e.tx_hash,
        args,
        // Something addressed to you reads differently from something you did.
        mine: String(e.actor ?? "").toLowerCase() === address
      };
    })
  );
});

/// The consumer answer. Deliberately narrow: what was it, where did it come
/// from, who touched it, and is there any reason not to eat it.
app.get("/api/trace/:id", async (req, res) => {
  const id = Number(req.params.id);
  const data = await dossier(id);
  if (!data) return res.status(404).json({ error: "no such batch" });

  const { batch } = data;
  const journey = [
    {
      at: batch.harvestedAt,
      label: "Harvested",
      actor: batch.origin.farm?.name ?? "Unknown farm",
      place: batch.origin.location,
      position: batch.origin.lat !== null ? { lat: batch.origin.lat, lon: batch.origin.lon } : null
    },
    ...data.handovers
      .filter((h) => h.accepted)
      .map((h) => ({
        at: h.settledAt,
        label: "Custody transferred",
        actor: `${h.from?.name ?? "?"} to ${h.to?.name ?? "?"}`,
        place: h.note || null,
        position: h.position ? { lat: h.position.lat, lon: h.position.lon } : null
      })),
    ...data.inspections.map((i) => ({
      at: i.at,
      label: i.passed ? `Inspection passed, grade ${i.grade}` : `Inspection failed, grade ${i.grade}`,
      actor: i.inspector?.name ?? "Inspector",
      place: i.findings,
      position: null
    }))
  ].sort((a, b) => a.at - b.at);

  const warnings = [];
  if (batch.recalled) warnings.push({ level: "critical", text: `Recalled: ${data.recall?.reason ?? "no reason recorded"}` });
  if (batch.coldChainBreached) warnings.push({ level: "warning", text: "Cold chain was broken in transit" });
  if (!batch.custodyIntact) warnings.push({ level: "warning", text: "Custody record has an unsettled handover" });
  if (batch.counts.failedInspections > 0) {
    const n = batch.counts.failedInspections;
    warnings.push({ level: "warning", text: n === 1 ? "One inspection was failed" : `${n} inspections were failed` });
  }
  if (batch.stage === 6) warnings.push({ level: "critical", text: "This lot was destroyed and must not be on sale" });

  res.json({
    id,
    verdict: warnings.some((w) => w.level === "critical") ? "unsafe" : warnings.length ? "caution" : "verified",
    warnings,
    batch,
    attributes: data.attributes,
    journey,
    journeyHandovers: data.handovers,
    // Tagged, because a farm-level certification is a claim about the farm and
    // not about this lot — a distinction the consumer page spells out.
    certifications: [
      ...data.certifications.map((c) => ({ ...c, scope: "lot" })),
      ...data.farmCertifications.map((c) => ({ ...c, scope: "farm" }))
    ].filter((c) => c.active),
    telemetry: data.telemetry,
    lineage: lineage(id, 40),
    recall: data.recall
  });
});

app.get("/api/qr/:id", async (req, res) => {
  const id = Number(req.params.id);
  const base = process.env.TERRAVANE_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  const svg = await QRCode.toString(`${base}/trace.html?id=${id}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.type("image/svg+xml").send(svg);
});

// ---------------------------------------------------------------------------
// Write API and static UI
// ---------------------------------------------------------------------------

mountDocuments(app, documents);
mountActions(app, { deployment, provider: prov, indexer, db, documents });

app.get("/api/batches/:id/route", (req, res) => {
  const route = getRoute(db, Number(req.params.id));
  if (!route) return res.json(null);
  res.json({ ...route, steps: route.steps.map(who) });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "no such endpoint" }));

app.use(express.static(path.join(ROOT, "web")));
app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "web", "index.html")));

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message });
});

const server = app.listen(PORT, async () => {
  console.log(`terravane   http://localhost:${PORT}`);
  console.log(`rpc         ${RPC_URL}`);
  console.log(`registry    ${deployment.produceRegistry}`);
  console.log(`signing     ${signingEnabled() ? "enabled (local dev keys)" : "disabled"}`);
  try {
    await indexer.start();
    console.log(`indexed     block ${getMeta(db, "lastBlock", "0")}, ${db.prepare("SELECT COUNT(*) AS n FROM events").get().n} events`);
  } catch (err) {
    console.error(`indexer failed to start: ${err.message}`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    indexer.stop();
    server.close(() => process.exit(0));
  });
}
