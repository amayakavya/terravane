import { allowedActions, api, session, STAGE_KEYS } from "./api.js";
import { add, ago, badge, button, card, cardHeader, clear, el, emptyState, field, icon, input, mount, notice, onDay, page, qty, renderShell, select, stageLabel, t, when } from "./ui.js";
import { figureBox, lineageGraph, temperatureChart } from "./charts.js";
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

function overview(body) {
  const b = dossier.batch;
  const attrs = dossier.attributes;
  const certs = [...dossier.certifications, ...dossier.farmCertifications];

  add(body, 
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
          cardHeader(t("lot.certifications"), badge(String(certs.filter((c) => c.active).length), certs.some((c) => c.active) ? "good" : "neutral")),
          certs.length
            ? el("div", { class: "divide-y divide-outline-variant/40" }, certs.map((c) =>
                el("div", { class: `px-6 py-3.5 ${c.active ? "" : "opacity-60"}` }, [
                  el("div", { class: "flex items-center gap-2 flex-wrap" }, [
                    el("p", { class: "font-body-md text-body-sm font-medium text-on-surface", text: c.scheme }),
                    c.active ? null : badge(c.revoked ? t("act.cancel") : t("common.none"), "bad")
                  ]),
                  el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: `${c.certifier?.name ?? "-"} · ${c.expiresAt ? onDay(c.expiresAt) : t("common.none")}` })
                ])
              ))
            : emptyState(t("common.none"), "verified")
        ]),
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
    fields: [["scheme", "act.scheme", "text"], ["expiresInDays", "act.validDays", "number"]],
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

async function actions(body) {
  const b = dossier.batch;
  const mine = b.custodian?.address?.toLowerCase() === me.address.toLowerCase();
  const offered = b.pendingCustodian?.address?.toLowerCase() === me.address.toLowerCase();
  const roles = me.roles ?? [];

  // Only offer what this participant could actually do with this lot. The chain
  // refuses the rest anyway; presenting them would just be a menu of failures.
  const available = allowedActions(roles).filter((key) => {
    if (["transfer", "stage", "split", "sell"].includes(key)) return mine && !b.recalled && b.stage < 5;
    if (key === "accept") return offered;
    if (key === "cancel") return Boolean(b.pendingCustodian) && (mine || offered);
    if (key === "telemetry") return mine || roles.includes("oracle");
    if (key === "recall") return !b.recalled;
    if (key === "destroy") return b.stage !== 6;
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
      const node = fields.querySelector(`[name="${name}"]`);
      let value = node.value;
      if (kind === "bool") value = value === "true";
      else if (kind === "list") value = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (kind === "number" && value !== "") value = Number(value);
      payload[name] = value;
    }

    submit.disabled = true;
    clear(result);
    try {
      const receipt = await spec.run(b.id, payload);
      add(result, 
        notice(
          `${t("act.committed", { block: receipt.block, gas: Number(receipt.gasUsed).toLocaleString() })}\n${receipt.txHash}` +
            (receipt.propagated?.length ? `\n${receipt.propagated.map((n) => `#${n}`).join(", ")}` : ""),
          "good"
        )
      );
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
  if (kind === "stage") {
    return select({ name }, STAGE_KEYS.slice(0, 5).map((key, i) => el("option", { value: String(i), text: t(key) })));
  }
  if (kind === "bool") {
    return select({ name }, [
      el("option", { value: "true", text: t("inspect.submitPass") }),
      el("option", { value: "false", text: t("inspect.submitFail") })
    ]);
  }
  return input({ name, type: kind === "number" ? "number" : "text", step: kind === "number" ? "any" : null });
}

void session;
start();
