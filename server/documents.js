import { ethers } from "ethers";

// Price, grade, storage advice and expiry are commercial attributes. They do not
// belong in contract storage: they change hands with the goods, they are long
// strings, and every byte of them is gas. They also cannot simply live in a
// database, because then a distributor could quietly restate the grade of a lot
// after a buyer had seen it.
//
// So they live here, content-addressed. The document is hashed, the hash goes on
// chain with the batch, and anyone reading a lot back can recompute the hash and
// see whether the attributes in front of them are the ones the farm committed to.
// The store cannot lie about a document without the hash ceasing to match.

/** Deterministic serialisation: same content, same bytes, same hash, always. */
export function canonicalise(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(value[k])}`).join(",")}}`;
}

export function documentHash(value) {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalise(value)));
}

export function documentUri(hash) {
  return `terravane://doc/${hash}`;
}

export function hashFromUri(uri) {
  const match = /^terravane:\/\/doc\/(0x[0-9a-fA-F]{64})$/.exec(uri ?? "");
  return match ? match[1].toLowerCase() : null;
}

// The commercial half of a handover. The contract only ever sees this
// document's digest; both sides sign that digest, so neither can restate the
// bargain afterwards, and the invoice at the end is rendered from the same
// bytes the ledger committed to rather than from anybody's later account of
// what was agreed.
export function dealTerms(fields) {
  const quantity = Number(fields.quantity ?? 0);
  const pricePerUnit = Number(fields.pricePerUnit ?? 0);
  return {
    kind: "terms",
    batchId: Number(fields.batchId),
    produce: fields.produce ?? "",
    quantity,
    unit: fields.unit ?? "",
    pricePerUnit,
    currency: fields.currency ?? "INR",
    // Stated, not left to be recomputed by whoever reads it later: the total is
    // part of what was agreed, so it is part of what was signed.
    total: Number((quantity * pricePerUnit).toFixed(2)),
    paymentTerms: fields.paymentTerms ?? "",
    deliverBy: fields.deliverBy ?? "",
    seller: fields.seller ?? "",
    buyer: fields.buyer ?? "",
    note: fields.note ?? "",
    offeredBy: fields.offeredBy ?? "",
    offeredAt: fields.offeredAt ?? new Date().toISOString()
  };
}

export class DocumentStore {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        hash       TEXT PRIMARY KEY,
        body       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /** Storing the same content twice is a no-op: the hash is the identity. */
  put(value) {
    const body = canonicalise(value);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(body));
    this.db
      .prepare("INSERT OR IGNORE INTO documents(hash, body, created_at) VALUES(?, ?, ?)")
      .run(hash, body, Math.floor(Date.now() / 1000));
    return { hash, uri: documentUri(hash), body: JSON.parse(body) };
  }

  get(hash) {
    const row = this.db.prepare("SELECT body, created_at FROM documents WHERE hash = ?").get(String(hash).toLowerCase());
    if (!row) return null;
    return { hash, body: JSON.parse(row.body), storedAt: row.created_at };
  }

  /**
   * Resolve the attributes a batch committed to, and say plainly whether they
   * still match. `verified` false is a finding, not a formatting problem.
   */
  resolve(metadataURI, metadataHash) {
    const hash = hashFromUri(metadataURI);
    if (!hash) return { present: false, verified: false, reason: "no document referenced", attributes: null };

    const doc = this.get(hash);
    if (!doc) return { present: false, verified: false, reason: "document not held by this node", attributes: null };

    const recomputed = documentHash(doc.body);
    const committed = String(metadataHash ?? "").toLowerCase();

    if (recomputed !== hash) {
      return { present: true, verified: false, reason: "stored document does not hash to its own address", attributes: doc.body };
    }
    if (committed !== hash) {
      return { present: true, verified: false, reason: "document does not match the hash committed on chain", attributes: doc.body };
    }
    return { present: true, verified: true, reason: null, attributes: doc.body, hash };
  }
}

export function mountDocuments(app, store) {
  app.post("/api/documents", (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "a document must be a JSON object" });
    }
    res.json(store.put(req.body));
  });

  app.get("/api/documents/:hash", (req, res) => {
    const doc = store.get(req.params.hash);
    if (!doc) return res.status(404).json({ error: "no such document" });
    res.json({ ...doc, verified: documentHash(doc.body) === String(req.params.hash).toLowerCase() });
  });
}
