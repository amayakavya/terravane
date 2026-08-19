// The optional half of the desk briefing: a local language model turning the
// figures in desk.js into two or three sentences of English.
//
// Optional is the operative word. This talks to an Ollama daemon on the same
// machine and nothing else — no key, no vendor, no request that leaves the
// host. If that daemon is not running, or the switch is off, every caller here
// gets a null and the console renders the figures on their own. The console is
// never worse than it was before this file existed, which is the only condition
// under which a feature like this belongs in a provenance ledger at all.
//
// The model is also never trusted with arithmetic. It is handed counted figures
// and told to write them up; the console prints the same figures beside its
// prose, so a sentence that disagrees with them is visibly wrong rather than
// quietly believed.

/// Every node in this network runs its own model, if it runs one at all — the
/// whole point of talking to a daemon on 127.0.0.1 rather than a vendor's API
/// is that there is no key to share and nothing to send off this machine.
/// These start from the environment a node was launched with, but any of the
/// three can be overridden at runtime from the admin page, so a different
/// person running this same codebase can point it at their own daemon without
/// touching env vars or restarting the process.
let overrides = { host: null, model: null, enabled: null };

export function setAiConfig({ host, model, enabled } = {}) {
  overrides = { host: host || null, model: model || null, enabled: enabled ?? null };
  // A changed host or model invalidates whatever the last probe found; make
  // the next status check look again instead of reporting stale news for up
  // to PROBE_TTL_MS.
  probe = { at: 0, model: null, reason: "not yet checked" };
}

/** What the admin page shows: the effective values right now, and where each one came from. */
export function getAiConfig() {
  return {
    host: currentHost(),
    hostIsOverride: overrides.host !== null,
    envHost: process.env.TERRAVANE_AI_URL ?? null,
    model: overrides.model ?? process.env.TERRAVANE_AI_MODEL ?? null,
    modelIsOverride: overrides.model !== null,
    envModel: process.env.TERRAVANE_AI_MODEL ?? null,
    enabled: aiEnabled(),
    enabledIsOverride: overrides.enabled !== null
  };
}

function currentHost() {
  return overrides.host ?? process.env.TERRAVANE_AI_URL ?? "http://127.0.0.1:11434";
}

/// Preference order among locally installed models. Smaller first: this is a
/// three-sentence summary on a desk somebody is waiting to use, so latency
/// matters more here than the last few points of fluency.
const PREFERRED = ["gemma2:2b", "gemma4:e2b", "llama3.2:3b", "qwen2.5:3b", "phi3:mini"];

const REQUEST_TIMEOUT_MS = Number(process.env.TERRAVANE_AI_TIMEOUT ?? 30000);
const PROBE_TTL_MS = 30000;
const CACHE_TTL_MS = Number(process.env.TERRAVANE_AI_CACHE ?? 120000);

export function aiEnabled() {
  if (overrides.enabled !== null) return overrides.enabled;
  return process.env.TERRAVANE_AI !== "off";
}

let probe = { at: 0, model: null, reason: "not yet checked" };
let probing = null;

async function fetchJson(path, init = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${currentHost()}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which model this node will actually use, or null and the reason why not.
 *
 * Re-checked at most every 30 seconds, because a daemon started after the server
 * was is a normal thing to do and should not need a restart to be noticed.
 *
 * `wait: false` never blocks on that check. The console polls `/api/health`
 * every eight seconds, and on a machine with no daemon the probe costs a
 * connection timeout — putting that on the health path would make the chain
 * head indicator stutter because of an optional feature that is switched off.
 * Callers that are about to generate something wait; callers that are only
 * reporting status take the last known answer and let the refresh land behind.
 */
export async function aiStatus({ force = false, wait = true } = {}) {
  if (!aiEnabled()) return { enabled: false, model: null, host: currentHost(), reason: "switched off with TERRAVANE_AI=off" };

  const stale = force || Date.now() - probe.at >= PROBE_TTL_MS;
  if (stale) {
    probing = probing ?? refreshProbe().finally(() => (probing = null));
    if (wait) await probing;
  }
  return { enabled: true, model: probe.model, host: currentHost(), reason: probe.reason };
}

async function refreshProbe() {
  try {
    const tags = await fetchJson("/api/tags");
    const installed = (tags.models ?? []).map((m) => m.name);
    if (!installed.length) {
      probe = { at: Date.now(), model: null, reason: "no models installed; try: ollama pull gemma2:2b" };
    } else {
      const pinned = overrides.model ?? process.env.TERRAVANE_AI_MODEL;
      // A pinned model is used whether or not the tag list reports it — the
      // pin is an instruction, and failing loudly at generation time on a typo
      // is clearer than silently substituting something else.
      const chosen = pinned ?? PREFERRED.find((name) => installed.includes(name)) ?? installed[0];
      probe = { at: Date.now(), model: chosen, reason: null };
    }
  } catch (err) {
    probe = { at: Date.now(), model: null, reason: `no model daemon at ${currentHost()} (${err.name === "AbortError" ? "timed out" : err.message})` };
  }
}

const SYSTEM = `You are the desk assistant on Terravane, a food provenance ledger used by farms,
mills, hauliers, shops, certifiers and food-safety inspectors in India.

You will be given a list of counted figures about one participant's desk. Write a briefing of at
most three short sentences, in plain British English, addressed to them as "you".

Rules, without exception:
- Use only the figures given. Never invent, estimate, total or infer a number that is not listed.
- A figure of zero is a fact you may state. The absence of a figure is not: if something is not
  listed at all, say nothing about it rather than reporting it as clear.
- Lead with whatever is most urgent: recalled stock, a broken cold chain, or a signature owed.
- If nothing is urgent, say so plainly in one sentence and stop.
- No greeting, no sign-off, no bullet points, no markdown, no emoji, no exclamation marks.
- Do not explain what Terravane is, and do not offer advice they did not ask for.`;

const cache = new Map();

const cacheKey = (model, lines) => `${model}\n${lines.join("\n")}`;

/**
 * Turn counted figures into prose, or return null if that is not possible right
 * now. Never throws: a failure here degrades the briefing, it does not break
 * the page the briefing sits on.
 */
export async function summariseDesk({ role, name, lines }) {
  const status = await aiStatus();
  if (!status.enabled || !status.model) return { text: null, model: null, reason: status.reason };

  const key = cacheKey(status.model, lines);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { text: hit.text, model: status.model, reason: null, cached: true };

  const prompt = [
    `Desk: ${name}, working as ${role}.`,
    "",
    "Figures, all counted from the ledger:",
    ...lines.map((line) => `- ${line}`),
    "",
    "Write the briefing now."
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${currentHost()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: status.model,
        system: SYSTEM,
        prompt,
        stream: false,
        // Generous, not because the answer is long — three sentences is the
        // brief — but because a reasoning model spends this budget thinking
        // before it writes a word, and a cap tight enough for gemma2 makes
        // gemma4 return an empty string having run out mid-thought. Brevity
        // is the system prompt's job; this is only a ceiling on runaway.
        options: { temperature: 0.2, top_p: 0.9, num_predict: 900 }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = await res.json();
    const text = String(body.response ?? "").trim();
    if (!text) {
      const reason = body.done_reason === "length"
        ? "the model used its whole token budget without answering"
        : "the model returned nothing";
      return { text: null, model: status.model, reason };
    }

    cache.set(key, { at: Date.now(), text });
    // The cache is per-digest, so it grows with distinct ledger states rather
    // than with traffic. A hard ceiling still keeps a long-running node honest.
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return { text, model: status.model, reason: null };
  } catch (err) {
    const reason = err.name === "AbortError" ? `the model took longer than ${REQUEST_TIMEOUT_MS}ms` : err.message;
    return { text: null, model: status.model, reason };
  } finally {
    clearTimeout(timer);
  }
}
