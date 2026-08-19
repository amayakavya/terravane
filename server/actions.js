import { ethers } from "ethers";
import { contracts, RPC_URL, wallet } from "../scripts/lib/chain.js";
import { advanceRoute, clearRoute, getRoute, setRoute } from "./db.js";
import { dealTerms } from "./documents.js";

/// The server holds development private keys so the console can act as any
/// participant without a browser wallet. That is only ever acceptable against a
/// local chain, so the capability is refused outright anywhere else.
export function signingEnabled() {
  if (process.env.TERRAVANE_SIGNING === "off") return false;
  try {
    const host = new URL(RPC_URL).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function mountActions(app, { deployment, provider, indexer, documents, db }) {
  const roster = deployment.participants;

  function signerFor(identifier) {
    if (!identifier) throw new HttpError(400, "an acting participant is required");
    const needle = String(identifier).toLowerCase();
    const found = roster.find((p) => p.address.toLowerCase() === needle || p.name.toLowerCase() === needle);
    if (!found) throw new HttpError(400, `unknown participant: ${identifier}`);
    return { participant: found, signer: wallet(found.index, provider) };
  }

  function boundContracts(identifier) {
    const { participant, signer } = signerFor(identifier);
    const { access, registry } = contracts(signer, deployment);
    return { participant, access, registry };
  }

  const action = (handler) => async (req, res) => {
    if (!signingEnabled()) {
      return res.status(403).json({ error: "server-side signing is disabled; this is only available against a local chain" });
    }
    try {
      const result = await handler(req);
      // Sync through the block this action actually landed in, so the response
      // never describes a ledger the caller cannot yet read back.
      await indexer.sync({ throughBlock: result?.block ?? 0 });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      res.status(400).json({ error: explain(err, deployment) });
    }
  };

  async function settle(txPromise) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    return { txHash: tx.hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
  }

  app.post("/api/actions/batches", action(async (req) => {
    const { registry, participant } = boundContracts(req.body.as);
    const b = req.body;

    // Commercial attributes are written to the document store first, and the lot
    // commits to their hash. Restating the price of a lot later means either
    // producing a document that hashes to the same value, or being caught.
    let metadataHash = b.metadataHash ?? ethers.ZeroHash;
    let metadataURI = b.metadataURI ?? "";
    let attributes = null;

    if (b.attributes && typeof b.attributes === "object") {
      const stored = documents.put({
        ...b.attributes,
        produceType: req.required("produceType"),
        variety: b.variety ?? "",
        registeredBy: participant.address,
        registeredAt: new Date().toISOString()
      });
      metadataHash = stored.hash;
      metadataURI = stored.uri;
      attributes = stored.body;
    }

    const input = {
      produceType: req.required("produceType"),
      variety: b.variety ?? "",
      quantity: BigInt(req.required("quantity")),
      unit: b.unit ?? "kg",
      harvestedAt: BigInt(b.harvestedAt ?? 0),
      originGeohash: b.originGeohash ?? participant.geohash ?? "",
      originLocation: b.originLocation ?? participant.location ?? "",
      metadataHash,
      metadataURI,
      coldChainRequired: Boolean(b.coldChainRequired),
      minTempDeciC: Math.round((b.minTempC ?? 0) * 10),
      maxTempDeciC: Math.round((b.maxTempC ?? 0) * 10)
    };
    const receipt = await settle(registry.createBatch(input));
    return { ...receipt, batchId: Number(await registry.batchCount()), attributes, metadataHash, metadataURI };
  }));

  /// Write the deal to the document store, then offer it. The chain only ever
  /// sees the digest; what the two sides are actually agreeing to lives here,
  /// and cannot be edited afterwards without the digest ceasing to match.
  async function offerTerms(registry, batchId, from, to, fields) {
    const b = await registry.getBatch(batchId);
    return documents.put(
      dealTerms({
        batchId,
        produce: `${b.produceType}${b.variety ? ` ${b.variety}` : ""}`,
        quantity: Number(b.quantity),
        unit: b.unit,
        seller: from.name,
        buyer: to.name,
        offeredBy: from.address,
        ...fields
      })
    );
  }

  app.post("/api/actions/batches/:id/transfer", action(async (req) => {
    const { registry, participant } = boundContracts(req.body.as);
    const { participant: recipient } = signerFor(req.required("to"));
    const id = Number(req.params.id);

    const agreed = await offerTerms(registry, id, participant, recipient, {
      pricePerUnit: req.body.pricePerUnit ?? 0,
      currency: req.body.currency ?? "INR",
      paymentTerms: req.body.paymentTerms ?? "",
      deliverBy: req.body.deliverBy ?? "",
      note: req.body.note ?? ""
    });

    const receipt = await settle(
      registry.proposeTransfer(id, recipient.address, req.body.geohash ?? "", req.body.note ?? "", agreed.hash)
    );
    return { ...receipt, terms: agreed.body, termsHash: agreed.hash, termsURI: agreed.uri };
  }));

  /// The other half of the handshake's alternative: answer an offer with your
  /// own numbers. Whoever was being asked to sign becomes the one asking.
  app.post("/api/actions/batches/:id/counter", action(async (req) => {
    const { registry, participant } = boundContracts(req.body.as);
    const id = Number(req.params.id);

    const [pending, to, awaiting] = await registry.pendingTransfer(id);
    if (!pending) throw new HttpError(400, "there is no open deal on this lot");
    if (awaiting.toLowerCase() !== participant.address.toLowerCase()) {
      throw new HttpError(400, "the deal is not waiting on you");
    }

    const custodian = (await registry.getBatch(id)).custodian;
    const seller = roster.find((p) => p.address.toLowerCase() === custodian.toLowerCase());
    const buyer = roster.find((p) => p.address.toLowerCase() === to.toLowerCase());

    const agreed = await offerTerms(registry, id, seller ?? participant, buyer ?? participant, {
      pricePerUnit: req.body.pricePerUnit ?? 0,
      currency: req.body.currency ?? "INR",
      paymentTerms: req.body.paymentTerms ?? "",
      deliverBy: req.body.deliverBy ?? "",
      note: req.body.note ?? "",
      // Who put these numbers on the table, which after a counter is no longer
      // the seller — the invoice at the end has to say so.
      offeredBy: participant.address
    });

    const receipt = await settle(registry.counterTransfer(id, agreed.hash, req.body.note ?? ""));
    return { ...receipt, terms: agreed.body, termsHash: agreed.hash, termsURI: agreed.uri };
  }));

  /// A plan is nothing but the first hop of an ordinary transfer, remembered. It
  /// buys nobody's signature in advance — accept still has to happen, at every
  /// step, by the party actually holding the lot at the time.
  app.post("/api/actions/batches/:id/route", action(async (req) => {
    const { registry, participant } = boundContracts(req.body.as);
    const id = Number(req.params.id);
    const steps = req.required("steps")
      .map((s) => String(s).trim())
      .filter(Boolean)
      .map((s) => signerFor(s).participant.address);
    if (!steps.length) throw new HttpError(400, "a route needs at least one stop");

    const agreed = await routeTerms(registry, id, participant, steps[0], req.body.note || "planned route");
    const receipt = await settle(
      registry.proposeTransfer(id, steps[0], req.body.geohash ?? "", req.body.note || "planned route", agreed.hash)
    );
    setRoute(db, id, steps, req.body.as);
    return { ...receipt, route: getRoute(db, id) };
  }));

  /// The caller signs the digest they were shown, not whatever is currently on
  /// chain. If the other side countered in between, the chain rejects it as a
  /// mismatch rather than quietly signing them up to terms they never read.
  app.post("/api/actions/batches/:id/accept", action(async (req) => {
    const id = Number(req.params.id);
    const { registry } = boundContracts(req.body.as);
    const termsHash = req.body.termsHash ?? (await registry.pendingTransfer(id))[3];
    return settle(registry.acceptTransfer(id, req.body.geohash ?? "", termsHash));
  }));

  /// A route plan does not skip the holder's own work — it just tells them
  /// where to send it once they're done. Accepting no longer forwards on its
  /// own; this is its own deliberate action, so a processor can grade, tag or
  /// certify a lot before choosing to move it on.
  app.post("/api/actions/batches/:id/route/continue", action(async (req) => {
    const id = Number(req.params.id);
    const { registry, participant } = boundContracts(req.body.as);
    const route = getRoute(db, id);
    if (!route) throw new HttpError(400, "this lot has no planned route");
    if (route.nextIndex >= route.steps.length) throw new HttpError(400, "the planned route is already complete");

    const to = route.steps[route.nextIndex];
    const agreed = await routeTerms(registry, id, participant, to, req.body.note || "continuing planned route");
    const receipt = await settle(
      registry.proposeTransfer(id, to, req.body.geohash ?? "", req.body.note || "continuing planned route", agreed.hash)
    );
    const remaining = advanceRoute(db, id);
    return { ...receipt, forwardedTo: to, routeComplete: !remaining };
  }));

  /// A planned hop is still a deal — the receiving side still has to sign it —
  /// but a route plan carries no price, so it says so in as many words rather
  /// than inventing one nobody agreed to.
  function routeTerms(registry, batchId, from, toAddress, note) {
    const to = roster.find((p) => p.address.toLowerCase() === toAddress.toLowerCase());
    return offerTerms(registry, batchId, from, to ?? { name: toAddress }, {
      pricePerUnit: 0,
      paymentTerms: "No price agreed; movement under a planned route",
      note
    });
  }

  app.post("/api/actions/batches/:id/cancel", action(async (req) => {
    const id = Number(req.params.id);
    const { registry } = boundContracts(req.body.as);
    const receipt = await settle(registry.cancelTransfer(id));
    // A rejected hop is the plan failing, not the plan continuing without its
    // author's say-so — clear it so custody sits with the farmer, plainly.
    clearRoute(db, id);
    return receipt;
  }));

  app.post("/api/actions/batches/:id/stage", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(registry.advanceStage(Number(req.params.id), Number(req.required("stage"))));
  }));

  app.post("/api/actions/batches/:id/telemetry", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(
      registry.recordTelemetry(
        Number(req.params.id),
        Math.round(Number(req.required("tempC")) * 10),
        Math.round(Number(req.body.humidityPct ?? 0) * 10),
        req.body.geohash ?? "",
        req.body.payloadHash ?? ethers.id(`telemetry:${Date.now()}`),
        BigInt(req.body.observedAt ?? 0)
      )
    );
  }));

  app.post("/api/actions/batches/:id/certify", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    const days = Number(req.body.expiresInDays ?? 0);
    const expiresAt = days > 0 ? BigInt(Math.floor(Date.now() / 1000) + days * 86400) : 0n;
    return settle(
      registry.certifyBatch(
        Number(req.params.id),
        req.required("scheme"),
        expiresAt,
        req.body.evidenceURI ?? "",
        req.body.evidenceHash ?? ethers.id(req.body.scheme)
      )
    );
  }));

  app.post("/api/actions/batches/:id/inspect", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(
      registry.recordInspection(
        Number(req.params.id),
        Number(req.required("grade")),
        Boolean(req.body.passed),
        req.body.findings ?? "",
        req.body.reportHash ?? ethers.id(`report:${Date.now()}`)
      )
    );
  }));

  app.post("/api/actions/batches/:id/split", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    const amounts = req.required("amounts").map((a) => BigInt(a));
    const receipt = await settle(registry.splitBatch(Number(req.params.id), amounts));
    return { ...receipt, children: (await registry.getChildren(Number(req.params.id))).map(Number) };
  }));

  app.post("/api/actions/merge", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    const ids = req.required("ids").map((n) => Number(n));
    const receipt = await settle(registry.mergeBatches(ids, req.body.metadataURI ?? "", req.body.metadataHash ?? ethers.ZeroHash));
    return { ...receipt, batchId: Number(await registry.batchCount()) };
  }));

  app.post("/api/actions/batches/:id/sell", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(
      registry.recordSale(Number(req.params.id), BigInt(req.required("quantity")), req.body.receiptHash ?? ethers.id(`pos:${Date.now()}`))
    );
  }));

  /// Recall and propagation in one call: the descendant set comes from the index,
  /// and the contract re-proves every member before marking it.
  app.post("/api/actions/batches/:id/recall", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    const id = Number(req.params.id);
    const receipt = await settle(registry.initiateRecall(id, Number(req.body.severity ?? 2), req.required("reason")));

    let propagated = [];
    if (req.body.propagate !== false) {
      propagated = await collectDescendants(registry, id);
      if (propagated.length) await settle(registry.propagateRecall(id, propagated));
    }
    return { ...receipt, propagated };
  }));

  app.post("/api/actions/batches/:id/destroy", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(registry.destroyBatch(Number(req.params.id), req.body.reason ?? ""));
  }));

  app.post("/api/actions/pause", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(registry.setPaused(Boolean(req.body.value)));
  }));

  // Small ergonomic helper so every handler above can demand a field in one call.
  app.use((req, _res, next) => next());
  Object.defineProperty(app.request, "required", {
    value: function required(field) {
      const value = this.body?.[field];
      if (value === undefined || value === null || value === "") throw new HttpError(400, `${field} is required`);
      return value;
    },
    configurable: true
  });
}

async function collectDescendants(registry, root) {
  const out = new Set();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const children = (await registry.getChildren(current)).map(Number);
    for (const child of children) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/// Turn a raw revert selector into the contract's error name. Without this every
/// rejected action reads as "execution reverted", which helps nobody.
function explain(err, deployment) {
  const data = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  const raw = typeof data === "string" ? data : data?.data;
  if (raw && raw.startsWith("0x")) {
    for (const name of ["ProduceRegistry", "AccessRegistry"]) {
      try {
        const iface = contracts(null, deployment)[name === "ProduceRegistry" ? "registry" : "access"].interface;
        const parsed = iface.parseError(raw);
        if (parsed) return `${parsed.name}${parsed.args.length ? `(${parsed.args.join(", ")})` : ""}`;
      } catch {
        // try the other ABI
      }
    }
  }
  return err.shortMessage ?? err.message ?? "transaction failed";
}
