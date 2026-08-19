import { allowedActions, api, CERT_SCHEMES, session, STAGE_KEYS } from "./api.js";
import { add, ago, badge, button, card, cardHeader, clear, el, emptyState, field, icon, input, mount, notice, onDay, page, qty, renderShell, select, stageLabel, t, toast, when } from "./ui.js";
import { certificationRow } from "./cert-detail.js";
import { contactCard } from "./contact.js";
import { figureBox, lineageGraph, temperatureChart } from "./charts.js";
import { statTile } from "./lot-table.js";
import { custodyStops, journeyMap, routeDistance } from "./map.js";

const main = document.getElementById("main");
const lotId = Number(new URLSearchParams(location.search).get("id"));

let me = null;
let dossier = null;
let tab = new URLSearchParams(location.search).get("tab") || "overview";

const TABS = [
  ["overview", "lot.overview"],
  ["route", "lot.route"],
  ["timeline", "lot.timeline"],
  ["lineage", "lot.lineage"],
  ["cold", "lot.coldChain"],
  ["actions", "lot.actions"]
];

async function start() {
  me = await renderShell({ active: "inventory", title: `${t("lot.title")} #${lotId}` });
  if (!me) return;

  await page(main, async () => {
    if (!Number.isFinite(lotId) || lotId < 1) {
      mount(main, emptyState(t("search.notFound"), "search"));
      return;
    }
    dossier = await api.batch(lotId);
    render();
  });
}

async function reload() {
  dossier = await api.batch(lotId);
  render();
}

// --------------------------------------------------------------------------

function verdictOf(b) {
  if (b.recalled || b.stage === 6) return "unsafe";
  if (b.coldChainBreached || !b.custodyIntact || b.counts.failedInspections) return "caution";
  return "verified";
}

function render() {
  const b = dossier.batch;
  const verdict = verdictOf(b);
  const tone = { verified: "good", caution: "warn", unsafe: "bad" }[verdict];

  mount(main, 
    el("div", { class: "flex flex-wrap items-start justify-between gap-4 mb-5" }, [
      el("div", { class: "min-w-0" }, [
        el("div", { class: "flex items-center gap-3 flex-wrap mb-1.5" }, [
          el("h2", { class: "font-serif-display text-[28px] leading-none text-on-surface", text: `${b.produceType}${b.variety ? ` · ${b.variety}` : ""}` }),
          verdict === "verified"
            ? badge(t(`trace.${verdict}`), tone)
            : el("a", { href: `/trace.html?id=${b.id}`, target: "_blank", rel: "noopener" }, [badge(t(`trace.${verdict}`), tone)])
        ]),
        el("p", { class: "font-label-md text-[13px] text-on-surface-variant", text: `${t("lot.title")} #${b.id} · ${qty(b.quantity, b.unit)} · ${stageLabel(b.stage)}` })
      ]),
      el("div", { class: "flex items-center gap-2.5" }, [
        linkButton(t("lot.publicTrace"), `/trace.html?id=${b.id}`, "qr_code_2"),
        linkButton(t("lot.printLabel"), `/label.html?id=${b.id}`, "print")
      ])
    ]),

    el("div", { class: "flex gap-1 overflow-x-auto border-b border-outline-variant/60 mb-6" },
      TABS.map(([key, label]) =>
        el("button", {
          type: "button",
          class: `tab-btn ${tab === key ? "tab-active" : "text-on-surface-variant hover:text-on-surface"} px-4 py-2.5 font-body-md text-body-sm whitespace-nowrap transition-colors`,
          text: t(label),
          onclick: () => {
            tab = key;
            history.replaceState(null, "", `?id=${b.id}&tab=${key}`);
            render();
          }
        })
      )
    ),

    el("div", { id: "tab-body", class: "rise-in" })
  );

  // A deep link straight to a later tab (e.g. Actions) otherwise leaves the
  // active tab scrolled out of the mobile tab strip with nothing showing which
  // one is selected.
  main.querySelector(".tab-active")?.scrollIntoView({ inline: "center", block: "nearest" });

  const body = document.getElementById("tab-body");
  ({ overview, route, timeline, lineage, cold, actions })[tab](body);
}

function linkButton(label, href, iconName) {
  return el("a", {
    href,
    target: "_blank",
    rel: "noopener",
    class: "inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2.5 font-body-sm text-body-sm text-on-surface hover:border-primary hover:text-primary transition-all"
  }, [el("span", { html: icon(iconName, { size: 16 }) }), label]);
}

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------

function definition(pairs) {
  return el("dl", { class: "grid sm:grid-cols-[190px_minmax(0,1fr)] gap-x-6 gap-y-3 px-6 py-5" },
    pairs.filter(Boolean).flatMap(([key, value]) => [
      el("dt", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/80 pt-0.5", text: key }),
      el("dd", { class: "font-body-md text-body-sm text-on-surface m-0 break-words" }, value)
    ])
  );
}

/**
 * Where a planned route actually stands, per stop — derived from who holds
 * the lot right now and who it's pending with, not from the plan's own
 * propose-counter. That counter only tracks what to send next; accepting a
 * hop no longer forwards it in the same breath, so by the time a holder is
 * looking at this, "next to propose" and "already accepted" are two
 * different steps, not one.
 */
function routeStepStatus(route, b) {
  const custodian = b.custodian?.address?.toLowerCase();
  const pending = b.pendingCustodian?.address?.toLowerCase();
  const reachedIndex = route.steps.findIndex((p) => p.address?.toLowerCase() === custodian);

  return route.steps.map((p, i) => {
    if (i === reachedIndex) return { name: p.name, tone: "good", label: t("act.routeHere") };
    if (reachedIndex !== -1 && i < reachedIndex) return { name: p.name, tone: "good", label: t("trace.verified") };
    if (pending && p.address?.toLowerCase() === pending) return { name: p.name, tone: "warn", label: t("act.routePending") };
    return { name: p.name, tone: "neutral", label: t("act.routeUpcoming") };
  });
}

/**
 * The farmer's planned shipping route, laid out as a strip of stops: here
 * now, done, awaiting acceptance, or not yet proposed. This is the answer to
 * "where has my crop reached, where is it going" without opening every
 * intermediate holder's own view of the lot.
 */
function routeStatusCard(route, b) {
  const stops = routeStepStatus(route, b);
  const last = stops.length - 1;
  const steps = stops.map((s, i) =>
    el("div", { class: "flex items-center gap-2.5 shrink-0" }, [
      el("div", { class: "text-center" }, [
        badge(s.name, s.tone),
        el("p", { class: "font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/60 mt-1", text: s.label })
      ]),
      i < last ? el("span", { class: "text-on-surface-variant/40 shrink-0", html: icon("arrow_forward", { size: 16 }) }) : null
    ])
  );
  return card([
    cardHeader(t("act.routePlanned")),
    el("div", { class: "px-6 py-5 flex items-center gap-2.5 overflow-x-auto" }, steps)
  ], "mb-6 rise-in");
}

async function overview(body) {
  const b = dossier.batch;
  const attrs = dossier.attributes;
  // Tagged as they are merged, because a farm-level certification is a claim
  // about the farm rather than about this lot, and the sheet says which.
  const certs = [
    ...dossier.certifications.map((c) => ({ cert: c, scope: "lot" })),
    ...dossier.farmCertifications.map((c) => ({ cert: c, scope: "farm" }))
  ];
  // Whoever planned this route — usually the farmer who will never hold the
  // lot again after the first hop — otherwise has no way to see it move
  // without opening every intermediate holder's Actions tab themselves.
  const route = await api.getRoute(b.id).catch(() => null);

  add(body,
    route ? routeStatusCard(route, b) : null,
    el("div", { class: "grid gap-6 xl:grid-cols-[1.3fr_1fr] items-start" }, [
      el("div", { class: "grid gap-6" }, [
        card([
          cardHeader(t("lot.overview")),
          definition([
            [t("lot.origin"), `${b.origin.farm?.name ?? "-"}${b.origin.location ? ` · ${b.origin.location}` : ""}`],
            [t("detail.harvestDate"), `${onDay(b.harvestedAt)} · ${ago(b.harvestedAt)}`],
            [t("detail.quantity"), qty(b.quantity, b.unit) + (Number(b.soldQuantity) ? ` · ${qty(b.soldQuantity, b.unit)} ${t("status.sold")}` : "")],
            [t("lot.custodian"), b.pendingCustodian
              ? `${b.custodian?.name ?? "-"} · ${t("lot.pending")} ${b.pendingCustodian.name}`
              : b.custodian?.name ?? "-"],
            [t("lot.coldChain"), b.coldChainRequired
              ? `${b.tempWindow[0]} to ${b.tempWindow[1]} °C · ${b.coldChainBreached ? t("flag.breached") : t("trace.verified")}`
              : t("common.none")],
            [t("lot.lineage"), b.parents.length || b.children.length
              ? `${b.parents.length} / ${b.children.length}`
              : t("lot.noLineage")]
          ])
        ]),
        attributesCard(attrs)
      ]),

      el("div", { class: "grid gap-6" }, [
        card([
          cardHeader(t("lot.certifications"), badge(String(certs.filter(({ cert }) => cert.active).length), certs.some(({ cert }) => cert.active) ? "good" : "neutral")),
          certs.length
            ? el("div", { class: "divide-y divide-outline-variant/40" }, certs.map(({ cert: c, scope }) =>
                certificationRow(c, [
                  el("div", { class: "flex items-center gap-2 flex-wrap" }, [
                    el("p", { class: "font-body-md text-body-sm font-medium text-on-surface", text: c.scheme }),
                    c.active ? null : badge(c.revoked ? t("act.cancel") : t("common.none"), "bad"),
                    el("span", { class: "ml-auto shrink-0 text-on-surface-variant/50", html: icon("info", { size: 15 }) })
                  ]),
                  el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: `${c.certifier?.name ?? "-"} · ${c.expiresAt ? onDay(c.expiresAt) : t("common.none")}` })
                ], { scope, extra: `px-6 py-3.5 ${c.active ? "" : "opacity-60"}` })
              ))
            : emptyState(t("common.none"), "verified")
        ]),
        contactCards(b),
        card([
          cardHeader(t("lot.inspections")),
          dossier.inspections.length
            ? el("div", { class: "divide-y divide-outline-variant/40" }, dossier.inspections.map((i) =>
                el("div", { class: "px-6 py-3.5" }, [
                  el("div", { class: "flex items-center justify-between gap-3" }, [
                    el("p", { class: "font-body-md text-body-sm text-on-surface", text: `${t("regp.quality")}: ${i.grade}` }),
                    badge(i.passed ? t("trace.verified") : t("status.failed"), i.passed ? "good" : "bad")
                  ]),
                  el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: `${i.inspector?.name ?? "-"} · ${when(i.at)}` }),
                  i.findings ? el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/80 mt-1", text: i.findings }) : null
                ])
              ))
            : emptyState(t("common.none"), "fact_check")
        ]),
        dossier.recall
          ? card([
              cardHeader(t("lot.recall"), badge(`${t("act.severity")} ${dossier.recall.severity}`, "bad")),
              definition([
                [t("act.reason"), dossier.recall.reason],
                [t("event.by"), dossier.recall.initiator?.name ?? "-"],
                [t("event.on"), when(dossier.recall.at)],
                [t("lot.title"), `#${dossier.recall.rootBatch}`]
              ])
            ], "border-error/40")
          : null
      ])
    ])
  );
}

/**
 * Who to ask when the ledger doesn't say enough — the origin farm always,
 * and the current holder too when that's someone else, since a certifier
 * weighing a lot at retail may need a question answered by whoever has it
 * now rather than whoever grew it.
 */
function contactCards(b) {
  const origin = b.origin.farm;
  const custodian = b.custodian;
  const samePart = origin && custodian && origin.address === custodian.address;
  const rows = [
    origin ? contactCard(origin, t("contact.origin")) : null,
    !samePart && custodian ? contactCard(custodian, t("contact.custodian")) : null
  ].filter(Boolean);
  if (!rows.length) return null;
  return card([
    cardHeader(t("lot.contact")),
    el("div", { class: "divide-y divide-outline-variant/40" }, rows.map((row) => el("div", { class: "px-6 py-4" }, [row])))
  ]);
}

/** The off-chain attributes, and whether they still match what was committed. */
function attributesCard(attrs) {
  if (!attrs?.present) {
    return card([cardHeader(t("lot.attributes")), el("div", { class: "px-6 py-5" }, notice(t("lot.noAttributes")))]);
  }

  const a = attrs.attributes ?? {};
  const rows = [
    a.pricePerUnit !== undefined ? [t("detail.price"), `${a.pricePerUnit} ${a.currency ?? ""}`.trim()] : null,
    a.grade !== undefined ? [t("detail.quality"), String(a.grade)] : null,
    a.storage ? [t("detail.storage"), a.storage] : null,
    a.expiresAt ? [t("detail.expiryDate"), a.expiresAt] : null,
    a.organic !== undefined ? [t("detail.organic"), a.organic ? t("common.yes") : t("common.no")] : null
  ].filter(Boolean);

  return card([
    cardHeader(
      t("lot.attributes"),
      badge(attrs.verified ? t("lot.attributesVerified") : t("lot.attributesUnverified"), attrs.verified ? "good" : "bad")
    ),
    rows.length ? definition(rows) : el("div", { class: "px-6 py-5" }, notice(t("common.none"))),
    attrs.verified
      ? null
      : el("div", { class: "px-6 pb-5" }, notice(attrs.reason ?? t("lot.attributesUnverified"), "bad"))
  ], attrs.verified ? "" : "border-error/40");
}

// Average heavy-goods road freight carbon intensity, in the range GLEC/DEFRA-style
// logistics carbon calculators report for a loaded truck (roughly 60-105 gCO2e per
// tonne-kilometre). 62 g/tonne-km is the low end of that band, so this reads as a
// conservative estimate rather than a worst case.
const KG_CO2E_PER_TONNE_KM = 0.062;

function foodMilesCO2(km, quantity, unit) {
  if (unit !== "kg") return null;
  const tonnes = Number(quantity) / 1000;
  return km * tonnes * KG_CO2E_PER_TONNE_KM;
}

function route(body) {
  const stops = custodyStops(dossier);
  const readings = dossier.telemetry.filter((r) => r.position).map((r) => ({ ...r.position, excursion: r.excursion }));
  const km = routeDistance(stops);
  const days = dossier.batch.harvestedAt ? (Date.now() / 1000 - dossier.batch.harvestedAt) / 86400 : 0;
  const co2 = foodMilesCO2(km, dossier.batch.quantity, dossier.batch.unit);

  add(body,
    el("div", { class: "grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-5" }, [
      fact(t("lot.distance"), `${Math.round(km).toLocaleString()} km`),
      fact(t("lot.custodyPoints"), String(stops.length)),
      fact(t("lot.daysSince"), days.toFixed(1)),
      fact(t("lot.positions"), String(readings.length)),
      fact(t("reg.foodMiles"), co2 === null ? t("common.na") : `${co2.toFixed(1)} kg CO₂e`)
    ]),
    card([el("div", { class: "p-4" }, journeyMap(stops, readings, { width: 760, height: 430 }))])
  );
}

function fact(label, value) {
  return el("div", { class: "rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-5 py-4" }, [
    el("p", { class: "font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/80 mb-1.5", text: label }),
    el("p", { class: "font-serif-display text-[26px] leading-none text-on-surface", text: value })
  ]);
}

function timeline(body) {
  const b = dossier.batch;
  const items = [{ at: b.harvestedAt, tone: "good", what: `${t("event.register")} · ${qty(b.quantity, b.unit)}`, who: b.origin.farm?.name }];

  for (const h of dossier.handovers) {
    items.push({
      at: h.settledAt || h.proposedAt,
      tone: h.accepted ? "good" : "warn",
      what: h.accepted ? t("event.sale") : h.cancelled ? t("act.cancel") : t("dist.pendingTransfers"),
      who: `${h.from?.name ?? "?"} to ${h.to?.name ?? "?"}${h.note ? ` · ${h.note}` : ""}`
    });
  }
  for (const c of dossier.certifications) {
    items.push({ at: c.issuedAt, tone: c.revoked ? "bad" : "good", what: `${t("lot.certifications")}: ${c.scheme}`, who: c.certifier?.name });
  }
  for (const i of dossier.inspections) {
    items.push({ at: i.at, tone: i.passed ? "good" : "bad", what: `${t("event.inspect")} · ${i.grade}`, who: `${i.inspector?.name ?? "-"}${i.findings ? ` · ${i.findings}` : ""}` });
  }
  for (const r of dossier.telemetry.filter((r) => r.excursion)) {
    items.push({ at: r.observedAt, tone: "warn", what: `${t("flag.breached")} · ${r.tempC} °C`, who: r.reporter?.name });
  }
  if (dossier.recall) {
    items.push({ at: dossier.recall.at, tone: "bad", what: `${t("lot.recall")} · ${dossier.recall.severity}`, who: `${dossier.recall.initiator?.name ?? "-"} · ${dossier.recall.reason}` });
  }
  for (const e of dossier.events) {
    if (["StageAdvanced", "SaleRecorded", "BatchSplit", "BatchesMerged", "BatchDestroyed"].includes(e.name)) {
      items.push({ at: e.ts, tone: e.name === "BatchDestroyed" ? "bad" : "neutral", what: describe(e), who: e.actor?.name });
    }
  }

  items.sort((a, z) => a.at - z.at);

  const dot = { good: "bg-primary", warn: "bg-gold", bad: "bg-error", neutral: "bg-outline" };

  add(body, 
    card([
      cardHeader(t("detail.journey"), badge(String(items.length))),
      el("ol", { class: "px-6 py-5 space-y-0" }, items.map((item, i) =>
        el("li", { class: "relative pl-7 pb-6 last:pb-0" }, [
          el("span", { class: `absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${dot[item.tone]}` }),
          i < items.length - 1 ? el("span", { class: "absolute left-[4.5px] top-4 bottom-0 w-px bg-outline-variant" }) : null,
          el("p", { class: "font-label-sm text-[11px] tracking-wide text-on-surface-variant/70", text: `${when(item.at)} · ${ago(item.at)} ago` }),
          el("p", { class: "font-body-md text-body-sm text-on-surface mt-0.5", text: item.what }),
          item.who ? el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: item.who }) : null
        ])
      ))
    ])
  );
}

function describe(e) {
  switch (e.name) {
    case "StageAdvanced":
      return `${t("act.stage")}: ${t(STAGE_KEYS[Number(e.args.to)] ?? "common.none")}`;
    case "SaleRecorded":
      return `${t("act.sell")}: ${Number(e.args.quantity).toLocaleString()}`;
    case "BatchSplit":
      return `${t("act.split")}: ${(e.args.childIds ?? []).map((n) => `#${n}`).join(", ")}`;
    case "BatchesMerged":
      return `${t("trace.madeUp")}: ${(e.args.parentIds ?? []).map((n) => `#${n}`).join(", ")}`;
    case "BatchDestroyed":
      return t("act.destroy");
    default:
      return e.name;
  }
}

async function lineage(body) {
  const graph = await api.lineage(lotId);
  add(body, 
    card([
      cardHeader(t("lot.lineage")),
      figureBox(
        lineageGraph(graph, (id) => {
          location.href = `/lot.html?id=${id}`;
        }),
        t("lot.noLineage")
      )
    ])
  );
}

function cold(body) {
  const b = dossier.batch;
  const excursions = dossier.telemetry.filter((r) => r.excursion).length;

  add(body, 
    card([
      cardHeader(
        t("lot.coldChain"),
        b.coldChainRequired ? badge(`${b.tempWindow[0]} to ${b.tempWindow[1]} °C`, excursions ? "bad" : "good") : null
      ),
      el("div", { class: "px-6 py-5" }, [
        el("p", { class: "font-body-md text-body-sm text-on-surface-variant mb-4", text: b.coldChainRequired
          ? `${excursions} ${t("common.of")} ${dossier.telemetry.length}`
          : t("common.none") }),
        figureBox(temperatureChart(dossier.telemetry, b.coldChainRequired ? b.tempWindow : null), t("common.none"))
      ]),
      dossier.telemetry.length
        ? el("div", { class: "overflow-x-auto border-t border-outline-variant/50" }, [
            el("table", { class: "w-full min-w-[560px]" }, [
              el("thead", {}, el("tr", {}, ["event.on", "act.tempC", "act.humidity", "detail.owner"].map((k) =>
                el("th", { class: "text-left font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/80 px-6 py-3 border-b border-outline-variant/40", text: t(k) })
              ))),
              el("tbody", {}, dossier.telemetry.map((r) =>
                el("tr", { class: "border-b border-outline-variant/30" }, [
                  el("td", { class: "px-6 py-2.5 font-label-md text-[12px] text-on-surface-variant whitespace-nowrap", text: when(r.observedAt) }),
                  el("td", { class: `px-6 py-2.5 font-label-md text-[12px] ${r.excursion ? "text-error font-semibold" : "text-on-surface"}`, text: `${r.tempC} °C` }),
                  el("td", { class: "px-6 py-2.5 font-label-md text-[12px] text-on-surface", text: `${r.humidityPct} %` }),
                  el("td", { class: "px-6 py-2.5 font-body-sm text-[12px] text-on-surface-variant", text: r.reporter?.name ?? "-" })
                ])
              ))
            ])
          ])
        : null
    ])
  );
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

const ACTIONS = {
  transfer: {
    label: "act.transfer",
    fields: [["to", "act.recipient", "participant"], ["note", "act.note", "text"]],
    run: (id, body) => api.transfer(id, body)
  },
  route: {
    label: "act.route",
    fields: [["steps", "act.routeSteps", "route"]],
    run: (id, body) => api.route(id, body)
  },
  accept: { label: "act.accept", fields: [], run: (id, body) => api.accept(id, body) },
  cancel: { label: "act.cancel", fields: [], run: (id, body) => api.cancelTransfer(id, body) },
  stage: { label: "act.stage", fields: [["stage", "act.stage", "stage"]], run: (id, body) => api.advance(id, body) },
  telemetry: {
    label: "act.telemetry",
    fields: [["tempC", "act.tempC", "number"], ["humidityPct", "act.humidity", "number"]],
    run: (id, body) => api.telemetry(id, body)
  },
  certify: {
    label: "act.certify",
    fields: [["scheme", "act.scheme", "scheme"], ["expiresInDays", "act.expiryDate", "date"]],
    run: (id, body) => api.certify(id, body)
  },
  inspect: {
    label: "act.inspect",
    fields: [["grade", "act.grade", "number"], ["passed", "act.passed", "bool"], ["findings", "act.findings", "text"]],
    run: (id, body) => api.inspect(id, body)
  },
  split: { label: "act.split", fields: [["amounts", "act.amounts", "list"]], run: (id, body) => api.split(id, body) },
  sell: { label: "act.sell", fields: [["quantity", "act.quantity", "number"]], run: (id, body) => api.sell(id, body) },
  recall: {
    label: "act.recall",
    danger: true,
    fields: [["severity", "act.severity", "number"], ["reason", "act.reason", "text"]],
    run: (id, body) => api.recall(id, body)
  },
  destroy: { label: "act.destroy", danger: true, fields: [["reason", "act.reason", "text"]], run: (id, body) => api.destroy(id, body) }
};

// A dedicated sale slab, separate from the generic action chooser below — this
// is the one action a retailer does over and over on the same lot as stock
// moves, so it gets its own quantity field and a running sold/remaining
// readout instead of being buried behind a dropdown every time.
function saleSlab(b, remaining) {
  const quantityInput = input({ type: "number", min: "1", max: String(remaining), placeholder: t("act.quantity") });
  const result = el("div", { class: "mt-4" });
  const submit = button(t("act.sell"), { tone: "primary" });

  submit.addEventListener("click", async () => {
    const value = Number(quantityInput.value);
    if (!value || value <= 0 || value > remaining) {
      mount(result, notice(t("act.quantity"), "bad"));
      return;
    }
    submit.disabled = true;
    clear(result);
    try {
      await api.sell(b.id, { as: me.address, quantity: value });
      toast(`${t("act.sell")} — ${t("act.done")}`, "good");
      await reload();
      tab = "actions";
    } catch (err) {
      add(result, notice(err.message, "bad"));
    } finally {
      submit.disabled = false;
    }
  });

  return card([
    cardHeader(t("act.sell")),
    el("div", { class: "px-6 py-5" }, [
      el("div", { class: "grid grid-cols-2 gap-4 mb-5" }, [
        statTile(t("status.sold"), qty(b.soldQuantity, b.unit)),
        statTile(t("act.remaining"), qty(remaining, b.unit))
      ]),
      field(t("act.quantity"), quantityInput),
      el("div", { class: "mt-5" }, submit),
      result
    ])
  ], "rise-in mb-6");
}

/**
 * The farmer's plan for this lot, shown to whoever holds it now — with an
 * explicit button to move it on. Accepting a handover no longer forwards it:
 * a processor grades, tags, certifies, whatever their part of the work is,
 * and only sends it on when they choose to, by pressing this.
 */
function routeSlab(b, route, mine) {
  const stops = routeStepStatus(route, b);
  const last = stops.length - 1;
  const strip = stops.map((s, i) =>
    el("div", { class: "flex items-center gap-2 shrink-0" }, [
      el("div", { class: "text-center" }, [
        badge(s.name, s.tone),
        el("p", { class: "font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/60 mt-1", text: s.label })
      ]),
      i < last ? el("span", { class: "text-on-surface-variant/40 shrink-0", html: icon("arrow_forward", { size: 14 }) }) : null
    ])
  );

  const canContinue = mine && route.nextIndex < route.steps.length;
  const result = el("div", { class: "mt-4" });
  const children = [
    el("div", { class: "flex items-center gap-2 overflow-x-auto px-6 py-5" }, strip)
  ];

  if (canContinue) {
    const next = route.steps[route.nextIndex];
    const submit = button(t("act.routeContinue", { to: next.name }), { tone: "primary" });
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      clear(result);
      try {
        const receipt = await api.continueRoute(b.id, { as: me.address });
        toast(t("act.routeForwarded", { to: next.name }), "good");
        add(result, notice(`${t("act.routeForwarded", { to: next.name })}\n${t("act.committed", { block: receipt.block, gas: Number(receipt.gasUsed).toLocaleString() })}`, "good"));
        await reload();
        tab = "actions";
      } catch (err) {
        add(result, notice(err.message, "bad"));
      } finally {
        submit.disabled = false;
      }
    });
    children.push(el("div", { class: "px-6 pb-5 -mt-2" }, [
      el("p", { class: "font-body-sm text-body-sm text-on-surface-variant mb-3", text: t("act.routeContinueNote") }),
      submit,
      result
    ]));
  }

  return card([cardHeader(t("act.routePlanned")), ...children], "rise-in mb-6");
}

async function actions(body) {
  const b = dossier.batch;
  add(body, contactCards(b));
  const mine = b.custodian?.address?.toLowerCase() === me.address.toLowerCase();
  const offered = b.pendingCustodian?.address?.toLowerCase() === me.address.toLowerCase();
  const roles = me.roles ?? [];

  const remaining = Number(b.quantity) - Number(b.soldQuantity);
  if (roles.includes("retailer") && mine && !b.recalled && b.stage < 5 && remaining > 0) {
    add(body, saleSlab(b, remaining));
  }

  const route = await api.getRoute(b.id).catch(() => null);
  if (route) add(body, routeSlab(b, route, mine));

  // Only offer what this participant could actually do with this lot. The chain
  // refuses the rest anyway; presenting them would just be a menu of failures.
  const available = allowedActions(roles).filter((key) => {
    if (["transfer", "route", "stage", "split", "sell"].includes(key)) return mine && !b.recalled && b.stage < 5;
    if (key === "accept") return offered;
    if (key === "cancel") return Boolean(b.pendingCustodian) && (mine || offered);
    if (key === "telemetry") return mine || roles.includes("oracle");
    if (key === "recall") return !b.recalled;
    if (key === "destroy") return b.stage !== 6 && (mine || roles.includes("inspector") || roles.includes("admin"));
    return true;
  });

  if (!available.length) {
    add(body, card([cardHeader(t("lot.actions")), el("div", { class: "px-6 py-5" }, notice(t("act.noPermission")))]));
    return;
  }

  const participants = await api.participants();
  const chooser = select({ id: "action-kind" }, available.map((key) => el("option", { value: key, text: t(ACTIONS[key].label) })));
  const fields = el("div", { class: "grid gap-4 sm:grid-cols-2" });
  const impact = el("div", { class: "mt-4" });
  const result = el("div", { class: "mt-4" });
  const submit = button(t("act.submit"), { tone: "primary" });

  const paint = async () => {
    const spec = ACTIONS[chooser.value];
    mount(fields, ...spec.fields.map(([name, label, kind]) => field(t(label), control(name, kind, participants, b))));
    clear(impact);
    clear(result);
    if (chooser.value !== "recall") return;

    const { descendants } = await api.descendants(b.id);
    add(impact, 
      notice(
        descendants.length
          ? t("act.recallReach", { id: `#${b.id}`, count: `${descendants.length}`, list: descendants.map((n) => `#${n}`).join(", ") })
          : t("act.recallReachNone", { id: `#${b.id}` }),
        "warn"
      )
    );
  };

  chooser.addEventListener("change", paint);

  submit.addEventListener("click", async () => {
    const spec = ACTIONS[chooser.value];
    const payload = { as: me.address };
    for (const [name, , kind] of spec.fields) {
      let value;
      if (kind === "scheme") {
        const choice = fields.querySelector(`[data-scheme-select="${name}"]`);
        const custom = fields.querySelector(`[data-scheme-custom="${name}"]`);
        value = choice.value === "custom" ? custom.value : choice.value;
      } else if (kind === "route") {
        value = [1, 2, 3]
          .map((i) => fields.querySelector(`[data-route-step="${name}-${i}"]`)?.value)
          .filter(Boolean);
      } else {
        const node = fields.querySelector(`[name="${name}"]`);
        value = node.value;
        if (kind === "bool") value = value === "true";
        else if (kind === "list") value = value.split(",").map((s) => s.trim()).filter(Boolean);
        else if (kind === "number" && value !== "") value = Number(value);
        else if (kind === "date") {
          const target = new Date(`${value}T00:00:00`);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          value = value ? Math.max(0, Math.round((target - today) / 86400000)) : 0;
        }
      }
      payload[name] = value;
    }

    submit.disabled = true;
    clear(result);
    try {
      const receipt = await spec.run(b.id, payload);
      // Block number, gas, and tx hash are real, but not what a farmer needs to
      // know "did this go through" — keep them in the in-panel detail only, and
      // keep the toast to the plain confirmation plus anything actually
      // actionable, like which lots a recall reached.
      const detail =
        `${t("act.committed", { block: receipt.block, gas: Number(receipt.gasUsed).toLocaleString() })}\n${receipt.txHash}`;
      const forwardedName = receipt.forwardedTo
        ? (participants.find((p) => p.address.toLowerCase() === receipt.forwardedTo.toLowerCase())?.name ?? receipt.forwardedTo)
        : null;
      const summary =
        `${t(spec.label)} — ${t("act.done")}` +
        (receipt.propagated?.length ? `\n${t("act.recalled", { count: `${receipt.propagated.length}`, list: receipt.propagated.map((n) => `#${n}`).join(", ") })}` : "") +
        (forwardedName ? `\n${t("act.routeForwarded", { to: forwardedName })}` : "") +
        (receipt.route && !forwardedName ? `\n${t("act.routeStarted", { to: participants.find((p) => p.address.toLowerCase() === receipt.route.steps[0]?.toLowerCase())?.name ?? receipt.route.steps[0] })}` : "");
      add(result, notice(`${summary}\n${detail}`, "good"));
      // The reload below rebuilds this whole tab, which would otherwise wipe the
      // notice above before anyone reads it — the toast lives outside this tab
      // and survives that rebuild.
      toast(summary, "good");
      await reload();
      tab = "actions";
    } catch (err) {
      add(result, notice(err.message, "bad"));
    } finally {
      submit.disabled = false;
    }
  });

  add(body, 
    card([
      cardHeader(t("lot.actions"), badge(`${t("act.actingAs")}: ${me.name}`, "info")),
      el("div", { class: "px-6 py-5" }, [
        el("div", { class: "max-w-xs mb-5" }, field(t("lot.actions"), chooser)),
        fields,
        impact,
        el("div", { class: "mt-5" }, submit),
        result
      ])
    ])
  );

  await paint();
}

function control(name, kind, participants, batch) {
  if (kind === "participant") {
    const holders = participants.filter(
      (p) => p.active && p.roles.some((r) => ["farmer", "processor", "distributor", "retailer"].includes(r)) && p.address !== batch.custodian?.address
    );
    return select({ name }, holders.map((p) => el("option", { value: p.address, text: `${p.name} (${p.roles.join("/")})` })));
  }
  if (kind === "route") {
    // Up to three stops is enough for every real shape this chain models
    // (farmer, an optional processor, a distributor, a retailer) without
    // building a full add/remove list widget for it.
    const holders = participants.filter(
      (p) => p.active && p.roles.some((r) => ["farmer", "processor", "distributor", "retailer"].includes(r)) && p.address !== batch.custodian?.address
    );
    const hopOptions = (placeholder) => [
      el("option", { value: "", text: placeholder }),
      ...holders.map((p) => el("option", { value: p.address, text: `${p.name} (${p.roles.join("/")})` }))
    ];
    return el("div", { class: "grid gap-2" }, [
      select({ "data-route-step": `${name}-1` }, hopOptions(t("act.routeHop1"))),
      select({ "data-route-step": `${name}-2` }, hopOptions(t("act.routeHop2"))),
      select({ "data-route-step": `${name}-3` }, hopOptions(t("act.routeHop3")))
    ]);
  }
  if (kind === "stage") {
    return select({ name }, STAGE_KEYS.slice(0, 5).map((key, i) => el("option", { value: String(i), text: t(key) })));
  }
  if (kind === "bool") {
    return select({ name }, [
      el("option", { value: "true", text: t("inspect.submitPass") }),
      el("option", { value: "false", text: t("inspect.submitFail") })
    ]);
  }
  if (kind === "scheme") {
    const choice = select({ "data-scheme-select": name }, [
      ...CERT_SCHEMES.map((s) => el("option", { value: s, text: s })),
      el("option", { value: "custom", text: t("act.schemeCustom") })
    ]);
    const custom = input({ "data-scheme-custom": name, placeholder: t("act.scheme") });
    custom.style.display = "none";
    choice.addEventListener("change", () => {
      custom.style.display = choice.value === "custom" ? "" : "none";
    });
    return el("div", { class: "grid gap-2" }, [choice, custom]);
  }
  if (kind === "date") {
    const today = new Date();
    const inAYear = new Date();
    inAYear.setDate(inAYear.getDate() + 365);
    // The certificate's own validity, not the produce's shelf life — a
    // different thing the certifier decides. Default to what the farmer
    // registered as the produce's expiry, since that's the one date already
    // on record, but it stays editable: an annual audit cert can easily run
    // shorter or longer than the lot's shelf life.
    const registered = name === "expiresInDays" ? dossier?.attributes?.attributes?.expiresAt : null;
    const fallback = inAYear.toISOString().slice(0, 10);
    return input({ name, type: "date", min: today.toISOString().slice(0, 10), value: registered || fallback });
  }
  return input({ name, type: kind === "number" ? "number" : "text", step: kind === "number" ? "any" : null });
}

void session;
start();
