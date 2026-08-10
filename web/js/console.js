import { STAGES, ago, clear, drawLineage, el, flags, get, plural, post, qty, temperatureChart, when } from "./api.js";
import { custodyStops, journeyMap, networkMap, routeDistance } from "./map.js";

const state = {
  filter: { q: "", stage: "", flag: "" },
  selected: null,
  tab: "overview",
  batches: [],
  participants: [],
  dossier: null,
  signingEnabled: false
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- bootstrap

const stageSelect = $("stage");
STAGES.forEach((name, i) => stageSelect.append(el("option", { value: String(i), text: name })));

$("q").addEventListener("input", (e) => {
  state.filter.q = e.target.value.trim();
  loadBatches();
});
stageSelect.addEventListener("change", (e) => {
  state.filter.stage = e.target.value;
  loadBatches();
});
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.filter.flag = chip.dataset.flag;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === chip));
    loadBatches();
  });
});
document.querySelector('.chip[data-flag=""]').classList.add("on");
$("new-batch").addEventListener("click", renderCreateForm);

// ---------------------------------------------------------------- loading

async function loadHealth() {
  try {
    const health = await get("/api/health");
    state.signingEnabled = health.signingEnabled;
    const lag = health.chainHead === null ? null : health.chainHead - health.indexedBlock;
    clear($("chain")).append(
      el("span", {}, [
        el("span", { class: `dot ${health.ok ? (lag > 3 ? "warn" : "") : "bad"}` }),
        health.ok ? `chain ${health.chainId}` : "chain unreachable"
      ]),
      el("span", { text: `head ${health.chainHead ?? "-"}` }),
      el("span", { text: `indexed ${health.indexedBlock}` }),
      el("span", { class: "faint", text: health.contracts.produceRegistry.slice(0, 10) + "…" })
    );
  } catch (err) {
    clear($("chain")).append(el("span", {}, [el("span", { class: "dot bad" }), err.message]));
  }
}

async function loadStats() {
  const s = await get("/api/stats");
  const cards = [
    { k: "Lots", v: s.batches ?? 0 },
    { k: "Recalled", v: s.recalled ?? 0, cls: s.recalled ? "alert" : "" },
    { k: "Cold chain breaks", v: s.breached ?? 0, cls: s.breached ? "warn" : "" },
    { k: "Handovers in flight", v: s.openHandovers ?? 0 },
    { k: "Failed checks", v: s.failedInspections ?? 0, cls: s.failedInspections ? "warn" : "" },
    { k: "Ledger events", v: s.events ?? 0 }
  ];
  clear($("stats")).append(
    ...cards.map((c) =>
      el("div", { class: `stat ${c.cls ?? ""}` }, [el("div", { class: "k", text: c.k }), el("div", { class: "v", text: c.v })])
    )
  );
}

async function loadBatches() {
  const params = new URLSearchParams();
  if (state.filter.q) params.set("q", state.filter.q);
  if (state.filter.stage) params.set("stage", state.filter.stage);
  if (state.filter.flag) params.set("flag", state.filter.flag);

  state.batches = await get(`/api/batches?${params}`);
  $("batch-count").textContent = `${state.batches.length}`;

  const body = clear($("rows"));
  if (!state.batches.length) {
    body.append(el("tr", {}, el("td", { colspan: "6", class: "empty", text: "Nothing matches that filter." })));
    return;
  }

  for (const b of state.batches) {
    const row = el("tr", { class: b.id === state.selected ? "selected" : "", onclick: () => select(b.id) }, [
      el("td", { class: "mono dim", text: `#${b.id}` }),
      el("td", {}, [el("div", { text: b.produceType }), el("div", { class: "faint", text: b.variety || "-" })]),
      el("td", { class: "mono right nowrap", text: qty(b.quantity, b.unit) }),
      el("td", {}, el("span", { class: `badge ${b.stage === 6 ? "bad" : b.stage === 5 ? "info" : ""}`, text: b.stageName })),
      el("td", { class: "dim", text: b.custodian?.name ?? "-" }),
      el("td", {}, flags(b).map((f) => el("span", { class: `badge ${f.cls}`, text: f.text, style: "margin-right:4px" })))
    ]);
    body.append(row);
  }
}

async function loadParticipants() {
  state.participants = await get("/api/participants");
  $("participant-count").textContent = `${state.participants.length}`;
  const box = clear($("participants"));
  for (const p of state.participants) {
    box.append(
      el("div", { style: "padding:9px 16px;border-bottom:1px solid var(--line-soft)" }, [
        el("div", {}, [
          p.name,
          !p.active && el("span", { class: "badge bad", text: "suspended", style: "margin-left:6px" })
        ]),
        el("div", { class: "faint", style: "font-size:11px" }, `${p.roles.join(", ")} · ${p.location || "-"} · holding ${p.holding}`)
      ])
    );
  }
}

async function loadFeed() {
  const events = await get("/api/events?limit=60");
  $("event-count").textContent = `${events.length}`;
  const list = clear($("feed"));
  for (const e of events) {
    list.append(
      el("li", { onclick: () => e.batch_id && select(e.batch_id) }, [
        el("div", { style: "min-width:0" }, [
          el("div", { class: "ev", text: e.name }),
          el("div", { class: "faint", style: "font-size:11px" }, `${e.batch_id ? `lot #${e.batch_id} · ` : ""}${e.actor?.name ?? "-"}`)
        ]),
        el("span", { class: "meta", text: ago(e.ts) })
      ])
    );
  }
}

/// `scroll` is off when restoring from a URL: arriving at a shared link should
/// show the whole console, not fling the page down to the dossier.
async function select(id, { scroll = true } = {}) {
  state.selected = id;
  state.tab = "overview";
  syncHash();
  document.querySelectorAll("#rows tr").forEach((tr) => tr.classList.remove("selected"));
  await loadBatches();
  state.dossier = await get(`/api/batches/${id}`);
  renderDetail();
  if (scroll) $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function syncHash() {
  if (state.selected) history.replaceState(null, "", `#lot=${state.selected}&tab=${encodeURIComponent(state.tab)}`);
}

// ---------------------------------------------------------------- detail

function renderDetail() {
  const d = state.dossier;
  const panel = clear($("detail"));
  if (!d) {
    panel.append(
      el("h2", {}, ["Where the chain is", el("span", { class: "count", text: `${state.participants.length} nodes` })]),
      el("div", { class: "panel-body" }, [
        networkMap(state.participants),
        el("div", { class: "faint", style: "font-size:12px;margin-top:10px", text: "Every enrolled participant, sized by how many lots it is holding. Select a lot above to trace its route." })
      ])
    );
    return;
  }
  const b = d.batch;

  const verdict = b.recalled || b.stage === 6 ? "unsafe" : b.coldChainBreached || !b.custodyIntact || b.counts.failedInspections ? "caution" : "verified";
  const why = b.recalled
    ? d.recall?.reason ?? "recalled"
    : b.stage === 6
      ? "lot destroyed"
      : b.coldChainBreached
        ? "temperature excursion recorded in transit"
        : !b.custodyIntact
          ? "a handover is still unsettled"
          : b.counts.failedInspections
            ? "an inspection was failed"
            : "custody unbroken, certifications current";

  panel.append(
    el("h2", {}, [
      `Lot #${b.id} · ${b.produceType}${b.variety ? ` (${b.variety})` : ""}`,
      el("span", { class: "count" }, [
        el("a", { href: `/trace.html?id=${b.id}`, target: "_blank", text: "consumer view" })
      ])
    ]),
    el("div", { class: `verdict ${verdict}` }, [
      el("span", { class: "mark", text: verdict }),
      el("span", { class: "why", text: why })
    ]),
    el("div", { class: "tabs" }, ["overview", "route", "timeline", "lineage", "cold chain", "actions"].map((name) =>
      el("button", {
        class: `tab ${state.tab === name ? "on" : ""}`,
        text: name,
        onclick: () => {
          state.tab = name;
          syncHash();
          renderDetail();
        }
      })
    )),
    el("div", { class: "panel-body", id: "tab-body" })
  );

  const body = $("tab-body");
  if (state.tab === "overview") renderOverview(body, d);
  if (state.tab === "route") renderRoute(body, d);
  if (state.tab === "timeline") renderTimeline(body, d);
  if (state.tab === "lineage") renderLineage(body, b.id);
  if (state.tab === "cold chain") renderColdChain(body, d);
  if (state.tab === "actions") renderActions(body, d);
}

function renderOverview(body, d) {
  const b = d.batch;
  const certs = [...d.certifications, ...d.farmCertifications];

  const dl = el("dl", { class: "kv" });
  const add = (k, v) => dl.append(el("dt", { text: k }), el("dd", {}, v));

  add("Origin", `${b.origin.farm?.name ?? "unknown"} · ${b.origin.location || "-"}`);
  add("Position", b.origin.lat === null ? "-" : el("span", { class: "mono", text: `${b.origin.lat.toFixed(4)}, ${b.origin.lon.toFixed(4)} (${b.origin.geohash})` }));
  add("Harvested", `${when(b.harvestedAt)} · ${ago(b.harvestedAt)}`);
  add("Quantity", el("span", { class: "mono", text: `${qty(b.quantity, b.unit)}${Number(b.soldQuantity) ? ` · ${qty(b.soldQuantity, b.unit)} sold` : ""}` }));
  add("Stage", b.stageName);
  add("Custodian", `${b.custodian?.name ?? "-"}${b.pendingCustodian ? ` → ${b.pendingCustodian.name} (awaiting acceptance)` : ""}`);
  add("Cold chain", b.coldChainRequired ? `${b.tempWindow[0]}°C to ${b.tempWindow[1]}°C · ${b.coldChainBreached ? "BREACHED" : "held"}` : "not required");
  add("Handovers", el("span", { class: "mono", text: String(b.counts.handovers) }));
  add(
    "Lineage",
    b.parents.length || b.children.length
      ? `${plural(b.parents.length, "parent lot", "parent lots")}, ${plural(b.children.length, "child lot", "child lots")}`
      : "whole from harvest, never split or merged"
  );
  add("Metadata", b.metadataURI ? el("span", { class: "mono faint", text: b.metadataURI }) : "-");

  body.append(dl);

  if (certs.length) {
    body.append(
      el("h3", { style: "font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:20px 0 10px", text: "Certifications" }),
      el("div", { class: "cert-grid" }, certs.map((c) =>
        el("div", { class: "cert", style: c.active ? "" : "border-color:var(--line);background:none;opacity:.6" }, [
          el("div", { class: "scheme" }, [c.scheme, !c.active && el("span", { class: "badge bad", text: c.revoked ? "revoked" : "expired", style: "margin-left:6px" })]),
          el("div", { class: "by", text: `${c.certifier?.name ?? "-"} · ${c.expiresAt ? `expires ${when(c.expiresAt)}` : "no expiry"}` })
        ])
      ))
    );
  }

  const qr = el("div", { class: "qr" });
  fetch(`/api/qr/${b.id}`)
    .then((r) => r.text())
    .then((svg) => {
      qr.innerHTML = svg;
    });
  body.append(
    el("div", { style: "display:flex;gap:16px;align-items:center;margin-top:20px" }, [
      qr,
      el("div", {}, [
        el("div", { class: "dim", text: "Pack label" }),
        el("div", { class: "faint", style: "font-size:12px", text: "Scanning this opens the consumer trace for the lot." }),
        el("div", { style: "margin-top:8px;display:flex;gap:12px" }, [
          el("a", { href: `/label.html?id=${b.id}`, target: "_blank", text: "Printable label" }),
          el("a", { href: `/trace.html?id=${b.id}`, target: "_blank", text: "Consumer view" })
        ])
      ])
    ])
  );
}

function renderRoute(body, d) {
  const stops = custodyStops(d);
  const readings = d.telemetry.filter((t) => t.position).map((t) => ({ ...t.position, excursion: t.excursion }));
  const km = routeDistance(stops);
  const elapsed = d.batch.harvestedAt ? (Date.now() / 1000 - d.batch.harvestedAt) / 86400 : 0;

  body.append(
    el("div", { class: "map-facts" }, [
      el("div", {}, [el("div", { class: "k", text: "Distance travelled" }), el("div", { class: "v mono", text: `${Math.round(km).toLocaleString()} km` })]),
      el("div", {}, [el("div", { class: "k", text: "Custody points" }), el("div", { class: "v mono", text: String(stops.length) })]),
      el("div", {}, [el("div", { class: "k", text: "Days since harvest" }), el("div", { class: "v mono", text: elapsed.toFixed(1) })]),
      el("div", {}, [el("div", { class: "k", text: "Positions logged" }), el("div", { class: "v mono", text: String(readings.length) })])
    ]),
    journeyMap(stops, readings),
    el("div", { class: "faint", style: "font-size:12px;margin-top:10px" },
      "Positions are decoded from the geohashes written on chain at each handover and sensor reading. Red points sit outside the lot's permitted temperature band."
    )
  );
}

function renderTimeline(body, d) {
  const items = [];
  const b = d.batch;

  items.push({ at: b.harvestedAt, cls: "", what: `Harvested ${qty(b.quantity, b.unit)}`, who: b.origin.farm?.name });
  for (const h of d.handovers) {
    items.push({
      at: h.settledAt || h.proposedAt,
      cls: h.accepted ? "" : h.cancelled ? "warn" : "warn",
      what: h.accepted ? "Custody accepted" : h.cancelled ? "Handover cancelled" : "Handover offered, unsettled",
      who: `${h.from?.name ?? "?"} → ${h.to?.name ?? "?"}${h.note ? ` · ${h.note}` : ""}`
    });
  }
  for (const c of d.certifications) {
    items.push({ at: c.issuedAt, cls: c.revoked ? "bad" : "", what: `${c.revoked ? "Certificate revoked" : "Certified"}: ${c.scheme}`, who: c.certifier?.name });
  }
  for (const i of d.inspections) {
    items.push({ at: i.at, cls: i.passed ? "" : "bad", what: `Inspection ${i.passed ? "passed" : "failed"} · grade ${i.grade}`, who: `${i.inspector?.name ?? "-"} · ${i.findings}` });
  }
  for (const t of d.telemetry.filter((t) => t.excursion)) {
    items.push({ at: t.observedAt, cls: "warn", what: `Temperature excursion ${t.tempC}°C`, who: t.reporter?.name });
  }
  if (d.recall) {
    items.push({ at: d.recall.at, cls: "bad", what: `Recalled, severity ${d.recall.severity}`, who: `${d.recall.initiator?.name ?? "-"} · ${d.recall.reason}` });
  }
  for (const e of d.events.filter((e) => ["StageAdvanced", "SaleRecorded", "BatchSplit", "BatchesMerged", "BatchDestroyed"].includes(e.name))) {
    items.push({ at: e.ts, cls: e.name === "BatchDestroyed" ? "bad" : "", what: describeEvent(e), who: e.actor?.name });
  }

  items.sort((a, b) => a.at - b.at);

  body.append(
    el("ul", { class: "timeline" }, items.map((i) =>
      el("li", { class: i.cls }, [
        el("div", { class: "when", text: `${when(i.at)} · ${ago(i.at)}` }),
        el("div", { class: "what", text: i.what }),
        el("div", { class: "who", text: i.who ?? "" })
      ])
    ))
  );
}

function describeEvent(e) {
  switch (e.name) {
    case "StageAdvanced":
      return `Stage → ${STAGES[Number(e.args.to)] ?? e.args.to}`;
    case "SaleRecorded":
      return `Sold ${Number(e.args.quantity).toLocaleString()} units`;
    case "BatchSplit":
      return `Split into lots ${(e.args.childIds ?? []).join(", ")}`;
    case "BatchesMerged":
      return `Merged from lots ${(e.args.parentIds ?? []).join(", ")}`;
    case "BatchDestroyed":
      return "Lot destroyed";
    default:
      return e.name;
  }
}

async function renderLineage(body, id) {
  const graph = await get(`/api/batches/${id}/lineage`);
  body.append(drawLineage(graph, (nodeId) => select(nodeId)));
}

function renderColdChain(body, d) {
  const b = d.batch;
  body.append(
    el("div", { class: "dim", style: "margin-bottom:10px" },
      b.coldChainRequired
        ? `Permitted window ${b.tempWindow[0]}°C to ${b.tempWindow[1]}°C. ${d.telemetry.filter((t) => t.excursion).length} excursion(s) across ${d.telemetry.length} reading(s).`
        : "This lot carries no cold-chain requirement; readings are recorded but never flagged."
    ),
    temperatureChart(d.telemetry, b.coldChainRequired ? b.tempWindow : null)
  );

  if (d.telemetry.length) {
    body.append(
      el("table", { style: "margin-top:16px" }, [
        el("thead", {}, el("tr", {}, [
          el("th", { text: "Observed" }),
          el("th", { class: "right", text: "Temp" }),
          el("th", { class: "right", text: "Humidity" }),
          el("th", { text: "Position" }),
          el("th", { text: "Reporter" })
        ])),
        el("tbody", {}, d.telemetry.map((t) =>
          el("tr", {}, [
            el("td", { class: "mono", text: when(t.observedAt) }),
            el("td", { class: `mono right ${t.excursion ? "" : ""}`, style: t.excursion ? "color:var(--danger)" : "", text: `${t.tempC}°C` }),
            el("td", { class: "mono right", text: `${t.humidityPct}%` }),
            el("td", { class: "mono faint", text: t.position ? `${t.position.lat.toFixed(3)}, ${t.position.lon.toFixed(3)}` : "-" }),
            el("td", { class: "dim", text: t.reporter?.name ?? "-" })
          ])
        ))
      ])
    );
  }
}

// ---------------------------------------------------------------- actions

const ACTIONS = [
  { id: "transfer", label: "Propose handover", path: (id) => `/api/actions/batches/${id}/transfer`, fields: [{ name: "to", label: "Recipient", type: "participant" }, { name: "note", label: "Consignment note", type: "text" }] },
  { id: "accept", label: "Accept handover", path: (id) => `/api/actions/batches/${id}/accept`, fields: [] },
  { id: "cancel", label: "Cancel handover", path: (id) => `/api/actions/batches/${id}/cancel`, fields: [] },
  { id: "stage", label: "Advance stage", path: (id) => `/api/actions/batches/${id}/stage`, fields: [{ name: "stage", label: "Stage", type: "stage" }] },
  { id: "telemetry", label: "Record sensor reading", path: (id) => `/api/actions/batches/${id}/telemetry`, fields: [{ name: "tempC", label: "Temp °C", type: "number", step: "0.1" }, { name: "humidityPct", label: "Humidity %", type: "number", step: "0.1" }] },
  { id: "certify", label: "Issue certificate", path: (id) => `/api/actions/batches/${id}/certify`, fields: [{ name: "scheme", label: "Scheme", type: "text" }, { name: "expiresInDays", label: "Valid days", type: "number" }] },
  { id: "inspect", label: "Record inspection", path: (id) => `/api/actions/batches/${id}/inspect`, fields: [{ name: "grade", label: "Grade 0-100", type: "number" }, { name: "passed", label: "Passed", type: "bool" }, { name: "findings", label: "Findings", type: "text" }] },
  { id: "split", label: "Split lot", path: (id) => `/api/actions/batches/${id}/split`, fields: [{ name: "amounts", label: "Amounts, comma separated", type: "list" }] },
  { id: "sell", label: "Record sale", path: (id) => `/api/actions/batches/${id}/sell`, fields: [{ name: "quantity", label: "Quantity", type: "number" }] },
  { id: "recall", label: "Recall lot and descendants", path: (id) => `/api/actions/batches/${id}/recall`, fields: [{ name: "severity", label: "Severity 1-3", type: "number" }, { name: "reason", label: "Reason", type: "text" }], danger: true },
  { id: "destroy", label: "Destroy lot", path: (id) => `/api/actions/batches/${id}/destroy`, fields: [{ name: "reason", label: "Reason", type: "text" }], danger: true }
];

function fieldInput(field) {
  if (field.type === "participant") {
    return el("select", { name: field.name }, state.participants.map((p) => el("option", { value: p.address, text: `${p.name} (${p.roles.join("/")})` })));
  }
  if (field.type === "stage") {
    return el("select", { name: field.name }, STAGES.slice(0, 5).map((s, i) => el("option", { value: String(i), text: s })));
  }
  if (field.type === "bool") {
    return el("select", { name: field.name }, [el("option", { value: "true", text: "yes" }), el("option", { value: "false", text: "no" })]);
  }
  return el("input", { name: field.name, type: field.type === "number" ? "number" : "text", step: field.step ?? null });
}

function renderActions(body, d) {
  if (!state.signingEnabled) {
    body.append(el("div", { class: "notice bad", text: "Server-side signing is disabled. Actions are only available against a local chain." }));
    return;
  }

  const chooser = el("select", { id: "action-kind" }, ACTIONS.map((a) => el("option", { value: a.id, text: a.label })));
  const actorSelect = el("select", { id: "action-actor" }, state.participants.map((p) => el("option", { value: p.address, text: `${p.name} (${p.roles.join("/")})` })));
  actorSelect.value = d.batch.custodian?.address ?? actorSelect.value;

  const fieldsBox = el("div", { class: "form-grid", id: "action-fields" });
  const notice = el("div", { id: "action-notice" });

  const impact = el("div", { id: "action-impact" });

  const renderFields = async () => {
    const action = ACTIONS.find((a) => a.id === chooser.value);
    clear(fieldsBox).append(
      ...action.fields.map((f) => el("div", { class: "field" }, [el("label", { text: f.label }), fieldInput(f)]))
    );

    // A recall is irreversible and reaches further than the lot in front of you.
    // Show the operator exactly what they are about to freeze, before they sign.
    clear(impact);
    if (action.id !== "recall") return;
    try {
      const { descendants } = await get(`/api/batches/${d.batch.id}/descendants`);
      impact.append(
        el("div", { class: "notice warn" },
          descendants.length
            ? `This will freeze lot #${d.batch.id} and ${plural(descendants.length, "lot derived from it", "lots derived from it")}: ${descendants.map((n) => `#${n}`).join(", ")}. The contract re-proves the lineage of each one before marking it.`
            : `This will freeze lot #${d.batch.id}. Nothing has been derived from it, so there is nothing further to reach.`
        )
      );
    } catch (err) {
      impact.append(el("div", { class: "notice bad", text: `Could not work out the recall reach: ${err.message}` }));
    }
  };
  chooser.addEventListener("change", renderFields);

  const submit = el("button", { class: "primary", text: "Sign and submit" });
  submit.addEventListener("click", async () => {
    const action = ACTIONS.find((a) => a.id === chooser.value);
    const payload = { as: actorSelect.value };
    for (const f of action.fields) {
      const input = fieldsBox.querySelector(`[name="${f.name}"]`);
      let value = input.value;
      if (f.type === "bool") value = value === "true";
      else if (f.type === "list") value = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (f.type === "number" && value !== "") value = Number(value);
      payload[f.name] = value;
    }

    submit.disabled = true;
    clear(notice);
    try {
      const result = await post(action.path(d.batch.id), payload);
      notice.append(el("div", { class: "notice ok", text: `Committed in block ${result.block}, gas ${Number(result.gasUsed).toLocaleString()}\n${result.txHash}${result.propagated?.length ? `\npropagated to lots ${result.propagated.join(", ")}` : ""}` }));
      await refresh();
      state.dossier = await get(`/api/batches/${d.batch.id}`);
      const preserved = notice.cloneNode(true);
      renderDetail();
      state.tab = "actions";
      $("tab-body")?.append(preserved);
    } catch (err) {
      notice.append(el("div", { class: "notice bad", text: err.message }));
    } finally {
      submit.disabled = false;
    }
  });

  body.append(
    el("div", { class: "form-grid" }, [
      el("div", { class: "field" }, [el("label", { text: "Acting as" }), actorSelect]),
      el("div", { class: "field" }, [el("label", { text: "Action" }), chooser])
    ]),
    el("div", { style: "height:10px" }),
    fieldsBox,
    impact,
    el("div", { style: "margin-top:14px" }, submit),
    notice
  );
  renderFields();
}

function renderCreateForm() {
  const panel = clear($("detail"));
  const notice = el("div", {});

  const farmSelect = el("select", { name: "as" }, state.participants.filter((p) => p.roles.includes("farmer")).map((p) => el("option", { value: p.address, text: p.name })));
  const fields = {
    produceType: el("input", { name: "produceType", value: "Tomato" }),
    variety: el("input", { name: "variety", value: "" }),
    quantity: el("input", { name: "quantity", type: "number", value: "1000" }),
    unit: el("input", { name: "unit", value: "kg" }),
    minTempC: el("input", { name: "minTempC", type: "number", step: "0.1", value: "" }),
    maxTempC: el("input", { name: "maxTempC", type: "number", step: "0.1", value: "" })
  };

  const submit = el("button", { class: "primary", text: "Record harvest" });
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    clear(notice);
    try {
      const body = {
        as: farmSelect.value,
        produceType: fields.produceType.value,
        variety: fields.variety.value,
        quantity: Number(fields.quantity.value),
        unit: fields.unit.value
      };
      if (fields.minTempC.value !== "" && fields.maxTempC.value !== "") {
        body.coldChainRequired = true;
        body.minTempC = Number(fields.minTempC.value);
        body.maxTempC = Number(fields.maxTempC.value);
      }
      const result = await post("/api/actions/batches", body);
      await refresh();
      await select(result.batchId);
    } catch (err) {
      notice.append(el("div", { class: "notice bad", text: err.message }));
      submit.disabled = false;
    }
  });

  panel.append(
    el("h2", { text: "Record a harvest" }),
    el("div", { class: "panel-body" }, [
      el("div", { class: "form-grid" }, [
        el("div", { class: "field" }, [el("label", { text: "Farm" }), farmSelect]),
        el("div", { class: "field" }, [el("label", { text: "Produce" }), fields.produceType]),
        el("div", { class: "field" }, [el("label", { text: "Variety" }), fields.variety]),
        el("div", { class: "field" }, [el("label", { text: "Quantity" }), fields.quantity]),
        el("div", { class: "field" }, [el("label", { text: "Unit" }), fields.unit]),
        el("div", { class: "field" }, [el("label", { text: "Min °C (optional)" }), fields.minTempC]),
        el("div", { class: "field" }, [el("label", { text: "Max °C (optional)" }), fields.maxTempC])
      ]),
      el("div", { style: "margin-top:14px" }, submit),
      notice
    ])
  );
}

// ---------------------------------------------------------------- loop

/// One failed poll should degrade the page, not blank it. The banner states what
/// broke and stays until a later poll succeeds.
function setBanner(message) {
  const existing = document.getElementById("banner");
  if (!message) {
    existing?.remove();
    return;
  }
  const banner = existing ?? el("div", { class: "banner", id: "banner" });
  clear(banner).append(el("span", { class: "dot bad" }), el("span", { text: message }));
  if (!existing) document.querySelector("main").prepend(banner);
}

async function refresh() {
  const results = await Promise.allSettled([loadHealth(), loadStats(), loadBatches(), loadParticipants(), loadFeed()]);
  const failed = results.filter((r) => r.status === "rejected");
  setBanner(failed.length ? `${failed.length} of ${results.length} panels could not load: ${failed[0].reason?.message ?? "unknown error"}` : null);
}

/// Keys for the operator who lives in this screen all day. Nothing here shadows
/// typing: every shortcut stands down while a field has focus.
document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);

  if (event.key === "/" && !typing) {
    event.preventDefault();
    $("q").focus();
    $("q").select();
    return;
  }
  if (event.key === "Escape") {
    if (typing) return document.activeElement.blur();
    state.selected = null;
    state.dossier = null;
    renderDetail();
    loadBatches();
    history.replaceState(null, "", location.pathname);
    return;
  }
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "j" || event.key === "k") {
    event.preventDefault();
    if (!state.batches.length) return;
    const at = state.batches.findIndex((b) => b.id === state.selected);
    const next = event.key === "j" ? Math.min(at + 1, state.batches.length - 1) : Math.max(at - 1, 0);
    select(state.batches[at === -1 ? 0 : next].id);
    return;
  }
  const tabs = ["overview", "route", "timeline", "lineage", "cold chain", "actions"];
  const index = Number(event.key) - 1;
  if (state.dossier && index >= 0 && index < tabs.length) {
    state.tab = tabs[index];
    syncHash();
    renderDetail();
  }
});

await refresh();

// Deep link so a lot can be sent to somebody as a URL, and so a reload holds place.
const hash = new URLSearchParams(location.hash.slice(1));
const deepLink = Number(hash.get("lot"));
if (deepLink) {
  await select(deepLink, { scroll: false }).catch(() => {});
  const tab = hash.get("tab");
  if (tab) {
    state.tab = tab;
    renderDetail();
  }
} else {
  // Nothing selected: the panel shows the network rather than an instruction.
  renderDetail();
}

setInterval(() => {
  loadHealth();
  loadStats();
  loadFeed();
}, 5000);
