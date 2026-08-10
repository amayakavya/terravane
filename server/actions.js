import { ethers } from "ethers";
import { contracts, RPC_URL, wallet } from "../scripts/lib/chain.js";

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

export function mountActions(app, { deployment, provider, indexer }) {
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
      await indexer.sync();
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      // A rejected send leaves the cached nonce ahead of the chain; drop it so the
      // next action re-reads rather than replaying a number the node has seen.
      try {
        signerFor(req.body?.as).signer.reset();
      } catch {
        // no identifiable signer on this request
      }
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
    const input = {
      produceType: req.required("produceType"),
      variety: b.variety ?? "",
      quantity: BigInt(req.required("quantity")),
      unit: b.unit ?? "kg",
      harvestedAt: BigInt(b.harvestedAt ?? 0),
      originGeohash: b.originGeohash ?? participant.geohash ?? "",
      originLocation: b.originLocation ?? participant.location ?? "",
      metadataHash: b.metadataHash ?? ethers.ZeroHash,
      metadataURI: b.metadataURI ?? "",
      coldChainRequired: Boolean(b.coldChainRequired),
      minTempDeciC: Math.round((b.minTempC ?? 0) * 10),
      maxTempDeciC: Math.round((b.maxTempC ?? 0) * 10)
    };
    const receipt = await settle(registry.createBatch(input));
    return { ...receipt, batchId: Number(await registry.batchCount()) };
  }));

  app.post("/api/actions/batches/:id/transfer", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    const { participant: recipient } = signerFor(req.required("to"));
    return settle(
      registry.proposeTransfer(
        Number(req.params.id),
        recipient.address,
        req.body.geohash ?? "",
        req.body.note ?? "",
        req.body.documentHash ?? ethers.id(req.body.note ?? "handover")
      )
    );
  }));

  app.post("/api/actions/batches/:id/accept", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(registry.acceptTransfer(Number(req.params.id), req.body.geohash ?? ""));
  }));

  app.post("/api/actions/batches/:id/cancel", action(async (req) => {
    const { registry } = boundContracts(req.body.as);
    return settle(registry.cancelTransfer(Number(req.params.id)));
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
