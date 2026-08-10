import { ethers } from "ethers";
import { contracts, rolesToNames } from "../scripts/lib/chain.js";
import { decodeGeohash } from "../scripts/lib/geohash.js";
import { getMeta, setMeta } from "./db.js";

const CHUNK = 2000;

/// Argument names that identify the human behind an event, in the order we trust
/// them. Falling back to the transaction sender costs an extra RPC round trip.
const ACTOR_KEYS = ["by", "initiator", "certifier", "inspector", "reporter", "retailer", "account", "from", "farm"];

export class Indexer {
  constructor({ db, provider, deployment, pollMs = 2000 }) {
    this.db = db;
    this.provider = provider;
    this.deployment = deployment;
    this.pollMs = pollMs;

    const { access, registry } = contracts(provider, deployment);
    this.access = access;
    this.registry = registry;

    this.sources = [
      { name: "AccessRegistry", address: deployment.accessRegistry.toLowerCase(), iface: access.interface },
      { name: "ProduceRegistry", address: deployment.produceRegistry.toLowerCase(), iface: registry.interface }
    ];

    this.blockTimes = new Map();
    this.txSenders = new Map();
    this.running = false;
    this.timer = null;
    this.lastError = null;
    this.syncing = false;
  }

  get fromBlock() {
    return Number(getMeta(this.db, "lastBlock", String(this.deployment.deployedAtBlock - 1))) + 1;
  }

  async start() {
    this.running = true;
    await this.syncParticipants();
    await this.sync();
    this.timer = setInterval(() => {
      this.sync().catch((err) => {
        this.lastError = err.message;
      });
    }, this.pollMs);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  async syncParticipants() {
    const roster = await this.access.roster();
    const known = new Map(this.deployment.participants.map((p) => [p.address.toLowerCase(), p]));
    const insert = this.db.prepare(`
      INSERT INTO participants(address, name, location, geohash, lat, lon, roles, role_names, active, registered_at)
      VALUES(@address, @name, @location, @geohash, @lat, @lon, @roles, @role_names, @active, @registered_at)
      ON CONFLICT(address) DO UPDATE SET
        name = excluded.name, location = excluded.location, geohash = excluded.geohash,
        lat = excluded.lat, lon = excluded.lon, roles = excluded.roles,
        role_names = excluded.role_names, active = excluded.active
    `);

    for (const address of roster) {
      const p = await this.access.getParticipant(address);
      const seeded = known.get(address.toLowerCase());
      const geo = decodeGeohash(p.geohash);
      insert.run({
        address,
        name: p.name,
        location: p.location,
        geohash: p.geohash,
        lat: geo ? geo.lat : (seeded?.lat ?? null),
        lon: geo ? geo.lon : (seeded?.lon ?? null),
        roles: Number(p.roles),
        role_names: rolesToNames(p.roles).join(","),
        active: p.active ? 1 : 0,
        registered_at: Number(p.registeredAt)
      });
    }
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const head = await this.provider.getBlockNumber();
      let from = this.fromBlock;
      if (from > head) return;

      while (from <= head) {
        const to = Math.min(from + CHUNK - 1, head);
        await this.ingestRange(from, to);
        setMeta(this.db, "lastBlock", to);
        from = to + 1;
      }
      setMeta(this.db, "syncedAt", Date.now());
      this.lastError = null;
    } finally {
      this.syncing = false;
    }
  }

  async ingestRange(fromBlock, toBlock) {
    const logs = await this.provider.getLogs({
      fromBlock,
      toBlock,
      address: this.sources.map((s) => s.address)
    });

    const touched = new Set();
    const rows = [];

    for (const log of logs) {
      const source = this.sources.find((s) => s.address === log.address.toLowerCase());
      if (!source) continue;
      let parsed;
      try {
        parsed = source.iface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        continue; // an event this build of the ABI does not know about
      }
      if (!parsed) continue;

      const args = decodeArgs(parsed);
      const batchId = pickBatchId(args);
      if (batchId !== null) touched.add(batchId);
      for (const id of collectBatchIds(args)) touched.add(id);
      if (source.name === "AccessRegistry") await this.syncParticipants();

      rows.push({
        block: log.blockNumber,
        log_index: log.index,
        tx_hash: log.transactionHash,
        ts: await this.blockTime(log.blockNumber),
        source: source.name,
        name: parsed.name,
        batch_id: batchId,
        actor: await this.resolveActor(args, log.transactionHash),
        args: JSON.stringify(args)
      });
    }

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO events(block, log_index, tx_hash, ts, source, name, batch_id, actor, args)
      VALUES(@block, @log_index, @tx_hash, @ts, @source, @name, @batch_id, @actor, @args)
    `);
    this.db.transaction((batch) => batch.forEach((r) => insert.run(r)))(rows);

    for (const id of touched) await this.resyncBatch(id, toBlock);
  }

  async blockTime(number) {
    if (this.blockTimes.has(number)) return this.blockTimes.get(number);
    const block = await this.provider.getBlock(number);
    const ts = block ? Number(block.timestamp) : null;
    this.blockTimes.set(number, ts);
    return ts;
  }

  async resolveActor(args, txHash) {
    for (const key of ACTOR_KEYS) {
      if (typeof args[key] === "string" && args[key].startsWith("0x") && args[key].length === 42) return args[key];
    }
    if (this.txSenders.has(txHash)) return this.txSenders.get(txHash);
    const tx = await this.provider.getTransaction(txHash);
    const sender = tx ? tx.from : null;
    this.txSenders.set(txHash, sender);
    return sender;
  }

  /// Pull authoritative state for one batch straight from the contract. Cheaper
  /// than replaying every event that ever touched it, and immune to indexer drift.
  async resyncBatch(id, atBlock) {
    const count = Number(await this.registry.batchCount());
    if (id < 1 || id > count) return;

    const [b, v, pending, sold, parents, children] = await Promise.all([
      this.registry.getBatch(id),
      this.registry.verify(id),
      this.registry.pendingTransfer(id),
      this.registry.soldQuantity(id),
      this.registry.getParents(id),
      this.registry.getChildren(id)
    ]);

    const geo = decodeGeohash(b.originGeohash);

    this.db
      .prepare(`
        INSERT INTO batches(
          id, produce_type, variety, quantity, sold_quantity, unit, origin_farm, custodian, pending_custodian,
          stage, recalled, cold_chain_required, cold_chain_breached, min_temp, max_temp, harvested_at, created_at,
          origin_geohash, origin_location, lat, lon, metadata_uri, metadata_hash, handover_count, telemetry_count,
          cert_count, inspection_count, active_certs, failed_inspections, custody_intact, parents, children, updated_block
        ) VALUES(
          @id, @produce_type, @variety, @quantity, @sold_quantity, @unit, @origin_farm, @custodian, @pending_custodian,
          @stage, @recalled, @cold_chain_required, @cold_chain_breached, @min_temp, @max_temp, @harvested_at, @created_at,
          @origin_geohash, @origin_location, @lat, @lon, @metadata_uri, @metadata_hash, @handover_count, @telemetry_count,
          @cert_count, @inspection_count, @active_certs, @failed_inspections, @custody_intact, @parents, @children, @updated_block
        )
        ON CONFLICT(id) DO UPDATE SET
          quantity = excluded.quantity, sold_quantity = excluded.sold_quantity, custodian = excluded.custodian,
          pending_custodian = excluded.pending_custodian, stage = excluded.stage, recalled = excluded.recalled,
          cold_chain_breached = excluded.cold_chain_breached, handover_count = excluded.handover_count,
          telemetry_count = excluded.telemetry_count, cert_count = excluded.cert_count,
          inspection_count = excluded.inspection_count, active_certs = excluded.active_certs,
          failed_inspections = excluded.failed_inspections, custody_intact = excluded.custody_intact,
          metadata_uri = excluded.metadata_uri, metadata_hash = excluded.metadata_hash,
          parents = excluded.parents, children = excluded.children, updated_block = excluded.updated_block
      `)
      .run({
        id,
        produce_type: b.produceType,
        variety: b.variety,
        quantity: b.quantity.toString(),
        sold_quantity: sold.toString(),
        unit: b.unit,
        origin_farm: b.originFarm,
        custodian: b.custodian,
        pending_custodian: pending[0] ? pending[1] : null,
        stage: Number(b.stage),
        recalled: b.recalled ? 1 : 0,
        cold_chain_required: b.coldChainRequired ? 1 : 0,
        cold_chain_breached: b.coldChainBreached ? 1 : 0,
        min_temp: Number(b.minTempDeciC),
        max_temp: Number(b.maxTempDeciC),
        harvested_at: Number(b.harvestedAt),
        created_at: Number(b.createdAt),
        origin_geohash: b.originGeohash,
        origin_location: b.originLocation,
        lat: geo ? geo.lat : null,
        lon: geo ? geo.lon : null,
        metadata_uri: b.metadataURI,
        metadata_hash: b.metadataHash,
        handover_count: Number(b.handoverCount),
        telemetry_count: Number(b.telemetryCount),
        cert_count: Number(b.certCount),
        inspection_count: Number(b.inspectionCount),
        active_certs: Number(v.activeCertifications),
        failed_inspections: Number(v.failedInspections),
        custody_intact: v.custodyIntact ? 1 : 0,
        parents: JSON.stringify(parents.map(Number)),
        children: JSON.stringify(children.map(Number)),
        updated_block: atBlock
      });
  }
}

function decodeArgs(parsed) {
  const out = {};
  parsed.fragment.inputs.forEach((input, i) => {
    out[input.name || `arg${i}`] = normalise(parsed.args[i]);
  });
  return out;
}

function normalise(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value) || (value && typeof value === "object" && typeof value.length === "number" && !("_isBigNumber" in value))) {
    return Array.from(value).map(normalise);
  }
  return value;
}

function pickBatchId(args) {
  for (const key of ["batchId", "parentId", "childId", "rootBatch"]) {
    if (args[key] !== undefined) return Number(args[key]);
  }
  return null;
}

function collectBatchIds(args) {
  const ids = [];
  for (const key of ["childIds", "parentIds"]) {
    if (Array.isArray(args[key])) ids.push(...args[key].map(Number));
  }
  for (const key of ["batchId", "parentId", "childId", "rootBatch"]) {
    if (args[key] !== undefined) ids.push(Number(args[key]));
  }
  return ids.filter((n) => Number.isFinite(n));
}

export { ethers };
