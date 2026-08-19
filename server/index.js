import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { contracts, loadArtifact, provider, readDeployment, ROOT, RPC_URL, STAGE_NAMES } from "../scripts/lib/chain.js";
import { decodeGeohash } from "../scripts/lib/geohash.js";
import { getMeta, getRoute, openDatabase } from "./db.js";
import { Indexer } from "./indexer.js";
import { mountActions, signingEnabled } from "./actions.js";
import { DocumentStore, mountDocuments } from "./documents.js";
import { attachmentName, render } from "./render.js";
import { briefingLines, deskBriefing } from "./desk.js";
import { aiEnabled, aiStatus, summariseDesk } from "./ai.js";

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
  // role_names can briefly be null for a row the contact-seed step inserted
  // ahead of the indexer's own pass, and — belt and braces — for any other
  // row this server didn't fully populate itself.
  return row
    ? { address: row.address, name: row.name, location: row.location, roles: (row.role_names ?? "").split(",").filter(Boolean), active: !!row.active, lat: row.lat, lon: row.lon, email: row.email, phone: row.phone }
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
    // Who owes the next signature on the open deal, and on what. Null when the
    // lot is not mid-handshake.
    deal: row.pending_custodian
      ? { to: who(row.pending_custodian), awaiting: who(row.pending_awaiting), termsHash: row.pending_terms, round: row.pending_round }
      : null,
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
    handovers: handovers.map((h, index) => ({
      index,
      from: who(h.from),
      to: who(h.to),
      proposedAt: num(h.proposedAt),
      settledAt: num(h.settledAt),
      geohash: h.geohash,
      position: decodeGeohash(h.geohash),
      note: h.note,
      // The digest is what the chain holds; the terms themselves are resolved
      // out of the document store so the console can show what was signed
      // rather than a hash nobody can read.
      termsHash: h.termsHash,
      terms: documents.get(h.termsHash)?.body ?? null,
      awaiting: who(h.awaiting),
      round: Number(h.round),
      accepted: h.accepted,
      cancelled: h.cancelled,
      open: h.awaiting !== "0x0000000000000000000000000000000000000000"
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
    ok: chainError === null && indexer.ready && codeDrift === null,
    ready: indexer.ready,
    rpc: RPC_URL,
    chainId: deployment.chainId,
    contracts: { accessRegistry: deployment.accessRegistry, produceRegistry: deployment.produceRegistry },
    chainHead: head,
    indexedBlock: Number(getMeta(db, "lastBlock", "0")),
    syncedAt: Number(getMeta(db, "syncedAt", "0")) || null,
    indexerError: indexer.lastError,
    chainError,
    contractMismatch: codeDrift,
    signingEnabled: signingEnabled(),
    // Never blocks: see the note on aiStatus. Health is polled every eight seconds.
    ai: await aiStatus({ wait: false })
  });
});

/// The desk briefing. The figures are counted here and always returned; the
/// prose is a local model's rendering of those same figures and may be absent,
/// which the console is built to expect rather than to hide.
app.get("/api/desk", async (req, res) => {
  const address = String(req.query.as ?? "");
  if (!address) return res.status(400).json({ error: "an address is required" });
  const participant = who(address);
  if (!participant?.name) return res.status(404).json({ error: "no such participant" });

  const briefing = deskBriefing(db, participant);
  const lines = briefingLines(briefing);

  if (!aiEnabled() || req.query.summarise === "0") {
    return res.json({ ...briefing, summary: null, model: null, reason: aiEnabled() ? "not requested" : "switched off" });
  }

  const { text, model, reason, cached } = await summariseDesk({
    role: (participant.roles ?? []).join(" and ") || "participant",
    name: participant.name,
    lines
  });
  res.json({ ...briefing, summary: text, model, reason, cached: Boolean(cached) });
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
      roles: (p.role_names ?? "").split(",").filter(Boolean),
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

  // A lot's most recent event tells you whether its current custodian has
  // actually done anything with it yet. If the last thing that happened was
  // a custody acceptance, they haven't — every other event (a stage advance,
  // a new offer, telemetry, a split) would itself be more recent. This is
  // what lets a list of held lots say "just landed on you" without a
  // separate read/seen table to maintain.
  const ids = rows.map((r) => r.id);
  const latestByBatch = ids.length
    ? db
        .prepare(`
          SELECT batch_id, name FROM events
          WHERE id IN (SELECT MAX(id) FROM events WHERE batch_id IN (${ids.map(() => "?").join(",")}) GROUP BY batch_id)
        `)
        .all(...ids)
    : [];
  const justAccepted = new Set(latestByBatch.filter((e) => e.name === "TransferAccepted").map((e) => e.batch_id));

  res.json(rows.map((r) => ({ ...shapeBatch(r), justAccepted: justAccepted.has(r.id) })));
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

// ---------------------------------------------------------------------------
// Printed documents
// ---------------------------------------------------------------------------

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const onDay = (seconds) =>
  seconds ? new Date(Number(seconds) * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";

/// ethers hands back a Result proxy, which throws on an out-of-range index
/// rather than returning undefined — so the bounds are checked, not probed.
function pick(list, index) {
  return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
}

const publicBase = (req) => process.env.TERRAVANE_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;

const traceQr = (url) => QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

/// Send a filled template as a file rather than a page. `inline` in the query
/// keeps it in the tab instead, which is what the console's preview link uses.
function sendDocument(res, req, html, filename) {
  const disposition = req.query.inline === undefined ? "attachment" : "inline";
  res.type("text/html; charset=utf-8").set("Content-Disposition", `${disposition}; filename="${filename}"`).send(html);
}

/// The invoice for one settled handover. Only a countersigned deal has an
/// invoice: an offer nobody accepted is not a sale, and printing one that looks
/// like a sale would be the single most useful document to forge here.
app.get("/api/batches/:id/invoice/:index", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const index = Number(req.params.index);
    const row = batchRow(id);
    if (!row) return res.status(404).json({ error: "no such batch" });

    const h = pick(await registry.getHandovers(id), index);
    if (!h) return res.status(404).json({ error: "no such handover" });
    if (!h.accepted) return res.status(409).json({ error: "this deal has not been countersigned; there is nothing to invoice" });

    const terms = documents.get(h.termsHash)?.body ?? {};
    const seller = who(h.from);
    const buyer = who(h.to);
    const quantity = Number(terms.quantity ?? row.quantity);
    const price = Number(terms.pricePerUnit ?? 0);
    const total = Number(terms.total ?? quantity * price);
    const verifyUrl = `${publicBase(req)}/trace.html?id=${id}`;
    const event = db
      .prepare("SELECT block FROM events WHERE batch_id = ? AND name = 'TransferAccepted' ORDER BY block LIMIT 1 OFFSET ?")
      .get(id, index);

    const html = render("invoice", {
      INVOICE_NUMBER: `TV-${String(id).padStart(6, "0")}-${String(index + 1).padStart(2, "0")}`,
      ISSUED_ON: onDay(h.settledAt),
      SETTLED_BLOCK: event?.block ?? "-",
      LOT_ID: id,
      SELLER_NAME: seller?.name ?? "Unknown",
      SELLER_LOCATION: seller?.location ?? "",
      SELLER_ADDRESS: h.from,
      BUYER_NAME: buyer?.name ?? "Unknown",
      BUYER_LOCATION: buyer?.location ?? "",
      BUYER_ADDRESS: h.to,
      PRODUCE: terms.produce || `${row.produce_type}${row.variety ? ` ${row.variety}` : ""}`,
      ORIGIN_FARM: who(row.origin_farm)?.name ?? "-",
      HARVESTED_ON: onDay(row.harvested_at),
      QUANTITY: quantity.toLocaleString("en-IN"),
      UNIT: terms.unit || row.unit,
      PRICE_PER_UNIT: price ? money.format(price) : "-",
      LINE_TOTAL: price ? money.format(total) : "-",
      CURRENCY: terms.currency ?? "INR",
      TOTAL: price ? money.format(total) : "No price agreed",
      PAYMENT_TERMS: terms.paymentTerms || "Not stated",
      DELIVER_BY: terms.deliverBy || "Not stated",
      NOTE: h.note || terms.note || "-",
      // A deal that took three rounds says something an invoice usually hides.
      ROUNDS: Number(h.round) > 1 ? `Settled at round ${Number(h.round)} after ${Number(h.round) - 1} counter-offer${Number(h.round) > 2 ? "s" : ""}` : "Accepted as first offered",
      TERMS_HASH: h.termsHash,
      VERIFY_URL: verifyUrl,
      OFFERED_ON: onDay(h.proposedAt),
      AGREED_ON: onDay(h.settledAt),
      QR_SVG: await traceQr(verifyUrl)
    });

    sendDocument(res, req, html, attachmentName("invoice", id, index));
  } catch (err) {
    next(err);
  }
});

/// The certificate for one certification on a lot. Revoked and expired ones
/// still render — a certificate that quietly disappears when withdrawn is
/// worse than one that prints the word VOID across itself.
app.get("/api/batches/:id/certificate/:index", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const index = Number(req.params.index);
    const row = batchRow(id);
    if (!row) return res.status(404).json({ error: "no such batch" });

    const c = pick(await registry.getBatchCertifications(id), index);
    if (!c) return res.status(404).json({ error: "no such certification" });

    const expired = Number(c.expiresAt) !== 0 && Number(c.expiresAt) * 1000 <= Date.now();
    const status = c.revoked ? `Revoked — ${c.revocationReason || "no reason recorded"}` : expired ? "Expired" : "In force";
    const verifyUrl = `${publicBase(req)}/trace.html?id=${id}`;
    const origin = who(row.origin_farm);

    const html = render("certificate", {
      CERT_NUMBER: `TV-C-${String(id).padStart(6, "0")}-${String(index + 1).padStart(2, "0")}`,
      SCHEME: c.scheme,
      STATUS: status,
      STATUS_CLASS: c.revoked || expired ? "void" : "",
      LOT_ID: id,
      PRODUCE: `${row.produce_type}${row.variety ? ` ${row.variety}` : ""}`,
      ORIGIN_FARM: origin?.name ?? "-",
      ORIGIN_LOCATION: row.origin_location || "-",
      HARVESTED_ON: onDay(row.harvested_at),
      // A lot consumed by a split or a merge reads zero, and "0 kg certified"
      // on a certificate looks like a broken document rather than a lot that
      // has since become other lots. Say what actually happened to it.
      QUANTITY: Number(row.quantity) > 0
        ? `${Number(row.quantity).toLocaleString("en-IN")} ${row.unit}`
        : (() => {
            const children = JSON.parse(row.children || "[]");
            return children.length
              ? `Since divided into ${children.length} lots (${children.map((n) => `#${n}`).join(", ")})`
              : "None remaining";
          })(),
      ISSUED_ON: onDay(c.issuedAt),
      EXPIRES_ON: Number(c.expiresAt) === 0 ? "No expiry recorded" : onDay(c.expiresAt),
      CERTIFIER_NAME: who(c.certifier)?.name ?? "Unknown certifier",
      CERTIFIER_ADDRESS: c.certifier,
      EVIDENCE_URI: c.evidenceURI || "None filed",
      EVIDENCE_HASH: c.evidenceHash,
      VERIFY_URL: verifyUrl,
      QR_SVG: await traceQr(verifyUrl)
    });

    sendDocument(res, req, html, attachmentName("certificate", id, index));
  } catch (err) {
    next(err);
  }
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

/// Is the contract this server is talking to the one this server was built
/// against? A chain that persists across runs will happily hand back an older
/// deployment, and the first symptom of that pairing is an unreadable decode
/// error somewhere deep in a page. Said plainly at startup, it is a one-line fix.
///
/// Immutables are the wrinkle: `access` is written into the code at construction,
/// so those byte ranges hold the registry address on chain and zeroes in the
/// artifact. The compiler records exactly where they are, so both sides are
/// blanked before the comparison rather than the comparison being abandoned.
function maskImmutables(hex, references) {
  const bytes = Buffer.from(hex.slice(2), "hex");
  for (const spans of Object.values(references ?? {})) {
    for (const { start, length } of spans) {
      // The offsets belong to the artifact. Applied to some other contract's
      // code they can run past its end, and an out-of-range fill throws — so
      // they are clamped. A wrong contract is caught on length anyway, below.
      bytes.fill(0, Math.min(start, bytes.length), Math.min(start + length, bytes.length));
    }
  }
  return bytes.toString("hex");
}

async function checkDeployedCode() {
  // Only the fetch may fail for reasons that are not this function's business;
  // the comparison itself must never be swallowed, or a real mismatch reports
  // as a clean bill of health.
  let onChain;
  try {
    onChain = await prov.getCode(deployment.produceRegistry);
  } catch {
    return null; // the chain being unreachable is already reported elsewhere
  }
  if (onChain === "0x") return "no contract at the recorded address; run npm run deploy";

  const artifact = loadArtifact("ProduceRegistry");
  const drifted =
    onChain.length !== artifact.deployedBytecode.length ||
    maskImmutables(onChain, artifact.immutableReferences) !==
      maskImmutables(artifact.deployedBytecode, artifact.immutableReferences);

  return drifted ? "the deployed contract is not the one these sources compile to; run npm run deploy && npm run seed" : null;
}

let codeDrift = null;

const server = app.listen(PORT, async () => {
  console.log(`terravane   http://localhost:${PORT}`);
  console.log(`rpc         ${RPC_URL}`);
  console.log(`registry    ${deployment.produceRegistry}`);
  console.log(`signing     ${signingEnabled() ? "enabled (local dev keys)" : "disabled"}`);
  // Warmed here rather than on the first request, so health reports the real
  // answer from the start instead of "not yet checked".
  aiStatus({ force: true }).then((ai) =>
    console.log(`summaries   ${ai.model ? `${ai.model} at ${ai.host}` : `off (${ai.reason})`}`)
  );
  codeDrift = await checkDeployedCode();
  if (codeDrift) console.error(`\nCONTRACT MISMATCH: ${codeDrift}\n`);

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
