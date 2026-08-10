// The single place the interface talks to the node. Everything here is a read of
// chain state or a signed action against it; there is no client-side store of
// produce, because a copy of the ledger held in a browser is just a rumour.

async function request(path, init) {
  const res = await fetch(path, init);
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const message = (isJson && body?.error) || `${res.status} ${res.statusText}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return body;
}

const get = (path) => request(path);
const post = (path, body) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  health: () => get("/api/health"),
  stats: () => get("/api/stats"),
  participants: () => get("/api/participants"),

  batches: (query = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, value);
    }
    return get(`/api/batches?${params}`);
  },
  batch: (id) => get(`/api/batches/${id}`),
  lineage: (id) => get(`/api/batches/${id}/lineage`),
  descendants: (id) => get(`/api/batches/${id}/descendants`),
  trace: (id) => get(`/api/trace/${id}`),
  events: (limit = 40) => get(`/api/events?limit=${limit}`),
  notifications: (address, limit = 40) => get(`/api/notifications?as=${address}&limit=${limit}`),
  document: (hash) => get(`/api/documents/${hash}`),

  create: (body) => post("/api/actions/batches", body),
  transfer: (id, body) => post(`/api/actions/batches/${id}/transfer`, body),
  accept: (id, body) => post(`/api/actions/batches/${id}/accept`, body),
  cancelTransfer: (id, body) => post(`/api/actions/batches/${id}/cancel`, body),
  advance: (id, body) => post(`/api/actions/batches/${id}/stage`, body),
  telemetry: (id, body) => post(`/api/actions/batches/${id}/telemetry`, body),
  certify: (id, body) => post(`/api/actions/batches/${id}/certify`, body),
  inspect: (id, body) => post(`/api/actions/batches/${id}/inspect`, body),
  split: (id, body) => post(`/api/actions/batches/${id}/split`, body),
  sell: (id, body) => post(`/api/actions/batches/${id}/sell`, body),
  recall: (id, body) => post(`/api/actions/batches/${id}/recall`, body),
  destroy: (id, body) => post(`/api/actions/batches/${id}/destroy`, body)
};

// --------------------------------------------------------------------------
// Session
// --------------------------------------------------------------------------

const SESSION_KEY = "terravane.session";

/**
 * Who the browser is acting as. Not an authentication token: the node signs with
 * development keys and refuses to do so unless it is talking to a local chain.
 * This records a choice of participant, nothing more, and the interface says so.
 */
export const session = {
  get() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(participant) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(participant));
    return participant;
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
  /** Send anyone without a session back to the door, remembering where they wanted to go. */
  require() {
    const current = session.get();
    if (!current) {
      const back = encodeURIComponent(location.pathname + location.search);
      location.replace(`/index.html?next=${back}`);
      return null;
    }
    return current;
  }
};

export const STAGE_KEYS = [
  "stage.harvested",
  "stage.processed",
  "stage.packed",
  "stage.inTransit",
  "stage.atRetail",
  "stage.sold",
  "stage.destroyed"
];

/** Which actions a role may even attempt, so the interface offers only those. */
export const ROLE_ACTIONS = {
  farmer: ["transfer", "accept", "cancel", "telemetry", "split", "recall"],
  processor: ["transfer", "accept", "cancel", "stage", "telemetry", "split", "recall"],
  distributor: ["transfer", "accept", "cancel", "stage", "telemetry"],
  retailer: ["transfer", "accept", "cancel", "stage", "telemetry", "sell"],
  certifier: ["certify"],
  inspector: ["inspect", "recall", "destroy"],
  oracle: ["telemetry"],
  admin: ["recall", "destroy"]
};

export function allowedActions(roles = []) {
  const set = new Set();
  for (const role of roles) for (const action of ROLE_ACTIONS[role] ?? []) set.add(action);
  return [...set];
}
