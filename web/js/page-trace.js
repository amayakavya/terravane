import { api } from "./api.js";
import { ago, badge, button, card, cardHeader, clear, el, I18n, icon, input, logoMark, mount, notice, onDay, qty, stageLabel, t, when } from "./ui.js";
import { certificationRow } from "./cert-detail.js";
import { figureBox, lineageGraph, temperatureChart } from "./charts.js";
import { statTile } from "./lot-table.js";
import { custodyStops, journeyMap, routeDistance } from "./map.js";

// What somebody standing in a shop with a packet in their hand gets. One verdict
// at the top, the reasons behind it underneath, and then the evidence. No sign in,
// because the whole point is that the record is public.
//
// A consumer has no session, so this page cannot use renderShell — the sidebar it
// draws is built from a signed-in participant's roles. It borrows the console's
// pieces instead (card, cardHeader, statTile, the same logo mark and grain), so it
// reads as the same product without pretending to be a signed-in view.

const root = document.getElementById("root");
const lotbar = document.getElementById("lotbar");
const foot = document.getElementById("foot");
const lotId = new URLSearchParams(location.search).get("id");

document.getElementById("brand-mark").innerHTML = logoMark(34);

document.getElementById("lang-toggle")?.addEventListener("click", () => {
  I18n.toggle();
  location.reload();
});

// Tone per verdict, kept in one place so the hero, the badge and the warning
// icons cannot drift apart.
const VERDICT = {
  verified: { tone: "good", band: "bg-primary/[0.06] border-primary/25", ink: "text-primary", icon: "verified" },
  caution: { tone: "warn", band: "bg-gold/[0.10] border-gold/35", ink: "text-[#8a6425]", icon: "warning" },
  unsafe: { tone: "bad", band: "bg-error/[0.07] border-error/25", ink: "text-error", icon: "error" }
};

async function main() {
  I18n.apply();
  renderFooter();

  if (!lotId) {
    mount(root, el("div", { class: "max-w-xl mx-auto py-10" }, [lookupCard()]));
    return;
  }

  let data;
  try {
    data = await api.trace(lotId);
  } catch (err) {
    mount(root, el("div", { class: "max-w-xl mx-auto py-10 grid gap-6" }, [
      notice(`${t("search.notFound")}: ${err.message}`, "bad"),
      lookupCard()
    ]));
    return;
  }

  const b = data.batch;
  const style = VERDICT[data.verdict];

  renderLotBar(b, data.verdict, style);

  const km = routeDistance(custodyStops({ batch: b, handovers: data.journeyHandovers ?? [] }));

  mount(root,
    verdictHero(data, b, style),

    // The four facts a shopper actually scans for, in the console's stat tiles.
    el("div", { class: "grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 rise-in-delay" }, [
      statTile(t("trace.sinceHarvest"), ago(b.harvestedAt), { hint: onDay(b.harvestedAt) }),
      statTile(t("trace.custodyHops"), String(b.counts.handovers), {
        tone: b.custodyIntact ? "neutral" : "warn",
        hint: km > 1 ? `${Math.round(km).toLocaleString()} km` : null
      }),
      statTile(t("trace.certifications"), String(b.counts.activeCertifications), {
        tone: b.counts.activeCertifications ? "good" : "neutral"
      }),
      statTile(t("trace.readings"), String(b.counts.telemetry), {
        tone: b.coldChainBreached ? "bad" : b.coldChainRequired ? "good" : "neutral",
        hint: b.coldChainRequired ? `${b.tempWindow[0]} to ${b.tempWindow[1]} °C` : t("common.none")
      })
    ]),

    // Two columns on a wide screen, exactly like the lot dossier in the console.
    // The map keeps the console's own 760x430 frame so the coastline sits in it
    // the same way rather than stranded in a letterboxed full-width band.
    el("div", { class: "grid gap-6 xl:grid-cols-[1.3fr_1fr] items-start" }, [
      el("div", { class: "grid gap-6 min-w-0" }, [
        provenanceCard(b),
        routeCard(data, km),
        journeyCard(data)
      ]),
      el("div", { class: "grid gap-6 min-w-0" }, [
        attributesCard(data.attributes),
        certificationsCard(data),
        temperatureCard(data, b),
        lineageCard(data)
      ])
    ])
  );

  fetch(`/api/qr/${b.id}`)
    .then((r) => r.text())
    .then((svg) => {
      const host = document.getElementById("qr");
      if (host) host.innerHTML = svg;
    })
    .catch(() => {});
}

// --------------------------------------------------------------------------
// Chrome
// --------------------------------------------------------------------------

function renderLotBar(b, verdict, style) {
  lotbar.classList.remove("hidden");
  mount(lotbar,
    el("div", { class: "max-w-[1400px] mx-auto flex items-center justify-between gap-4 px-5 lg:px-10 py-3 lg:py-4" }, [
      el("div", { class: "min-w-0" }, [
        el("h1", {
          class: "font-serif-display text-[20px] sm:text-[26px] leading-none text-on-surface truncate",
          text: `${b.produceType}${b.variety ? ` · ${b.variety}` : ""}`
        }),
        el("p", {
          class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/70 mt-1 truncate",
          text: `${t("lot.title")} #${b.id} · ${qty(b.quantity, b.unit)} · ${stageLabel(b.stage)}`
        })
      ]),
      el("div", { class: "shrink-0" }, [badge(t(`trace.${verdict}`), style.tone)])
    ])
  );
}

function renderFooter() {
  mount(foot,
    el("div", { class: "absolute inset-0 grain pointer-events-none" }),
    el("div", { class: "relative max-w-[1400px] mx-auto px-5 lg:px-10 py-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end" }, [
      el("div", { class: "max-w-xl" }, [
        el("h2", { class: "font-serif-display text-[24px] text-gold-soft mb-2.5", text: t("trace.lookupTitle") }),
        el("p", { class: "font-body-md text-body-sm text-gold-soft/60 mb-5", text: t("trace.lookupNote") }),
        lookup()
      ]),
      el("p", {
        class: "font-body-sm text-[12px] leading-relaxed text-gold-soft/40 max-w-sm lg:text-right",
        text: t("trace.whatThisIs")
      })
    ])
  );
}

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

function verdictHero(data, b, style) {
  return el("section", { class: `rounded-xl border overflow-hidden mb-6 rise-in ${style.band}` }, [
    el("div", { class: "flex flex-col sm:flex-row sm:items-center gap-6 px-6 lg:px-8 py-7" }, [
      el("div", { class: `shrink-0 h-14 w-14 rounded-full border flex items-center justify-center bg-surface-container-lowest ${style.ink} border-current/25`, html: icon(style.icon, { size: 30 }) }),
      el("div", { class: "flex-1 min-w-0" }, [
        el("p", { class: `font-label-sm text-[11px] tracking-widest uppercase mb-2 ${style.ink}`, text: t(`trace.${data.verdict}`) }),
        el("h2", {
          class: "font-serif-display text-[30px] lg:text-[36px] leading-tight text-on-surface mb-1.5",
          text: `${b.produceType}${b.variety ? ` · ${b.variety}` : ""}`
        }),
        el("p", {
          class: "font-body-md text-body-sm text-on-surface-variant",
          text: `${t("label.grownBy")} ${b.origin.farm?.name ?? "-"}${b.origin.location ? ` · ${b.origin.location}` : ""}`
        })
      ]),
      el("div", { class: "shrink-0 flex sm:flex-col items-center gap-3 sm:gap-2" }, [
        el("div", { class: "bg-white rounded-lg p-2 w-[124px] h-[124px] shrink-0 border border-outline-variant/50", id: "qr" }),
        el("p", { class: "font-body-sm text-[11px] leading-snug text-on-surface-variant/70 sm:text-center sm:max-w-[132px]", text: t("trace.scanNote") })
      ])
    ]),
    data.warnings.length
      ? el("ul", { class: "border-t border-current/10 divide-y divide-current/10 bg-surface-container-lowest/40" }, data.warnings.map((w) =>
          el("li", { class: "flex items-start gap-3 px-6 lg:px-8 py-3.5" }, [
            el("span", {
              class: `${w.level === "critical" ? "text-error" : "text-[#8a6425]"} shrink-0 mt-px`,
              html: icon(w.level === "critical" ? "error" : "warning", { size: 18 })
            }),
            el("p", { class: "font-body-md text-body-sm text-on-surface", text: w.text })
          ])
        ))
      : el("p", { class: "px-6 lg:px-8 pb-6 -mt-2 font-body-md text-body-sm text-on-surface-variant", text: t("trace.noWarnings") })
  ]);
}

function definition(pairs) {
  return el("dl", { class: "grid sm:grid-cols-[170px_minmax(0,1fr)] gap-x-6 gap-y-3 px-6 py-5" },
    pairs.filter(Boolean).flatMap(([key, value]) => [
      el("dt", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/80 pt-0.5", text: key }),
      el("dd", { class: "font-body-md text-body-sm text-on-surface m-0 break-words", text: value })
    ])
  );
}

function provenanceCard(b) {
  return card([
    cardHeader(t("trace.provenance")),
    definition([
      [t("label.grownBy"), b.origin.farm?.name ?? "-"],
      [t("search.location"), b.origin.location || "-"],
      [t("detail.harvestDate"), `${onDay(b.harvestedAt)} · ${ago(b.harvestedAt)}`],
      [t("lot.custodian"), `${b.custodian?.name ?? "-"}${b.custodian?.location ? ` · ${b.custodian.location}` : ""}`],
      [t("lot.custodyPoints"), String(b.counts.handovers)],
      b.coldChainRequired
        ? [t("lot.coldChain"), `${b.tempWindow[0]} to ${b.tempWindow[1]} °C · ${b.coldChainBreached ? t("flag.breached") : t("trace.verified")}`]
        : null
    ])
  ], "rise-in-delay");
}

function attributesCard(attrs) {
  if (!attrs?.present) return null;
  const a = attrs.attributes ?? {};
  const rows = [
    a.pricePerUnit != null ? [t("detail.price"), `${a.pricePerUnit} ${a.currency ?? ""}`.trim()] : null,
    a.grade ? [t("detail.quality"), String(a.grade)] : null,
    a.storage ? [t("detail.storage"), a.storage] : null,
    a.expiresAt ? [t("detail.expiryDate"), a.expiresAt] : null,
    a.organic != null ? [t("detail.organic"), a.organic ? t("common.yes") : t("common.no")] : null
  ].filter(Boolean);
  if (!rows.length) return null;

  // An unverified digest is the one thing on this page a shopper must not miss,
  // so the card border carries it as well as the badge.
  return el("section", {
    class: `rounded-xl border bg-surface-container-lowest rise-in-delay ${attrs.verified ? "border-outline-variant/70" : "border-error/40"}`
  }, [
    cardHeader(t("lot.attributes"), badge(attrs.verified ? t("lot.attributesVerified") : t("lot.attributesUnverified"), attrs.verified ? "good" : "bad")),
    definition(rows)
  ]);
}

function routeCard(data, km) {
  const stops = custodyStops({ batch: data.batch, handovers: data.journeyHandovers ?? [] });
  const readings = data.telemetry.filter((r) => r.position).map((r) => ({ ...r.position, excursion: r.excursion }));
  if (!stops.length && !readings.length) return null;

  return card([
    cardHeader(t("trace.travelled"), km > 1 ? badge(`${Math.round(km).toLocaleString()} km`, "neutral") : null),
    el("div", { class: "p-4" }, journeyMap(stops, readings, { width: 760, height: 430 }))
  ], "rise-in-delay");
}

function journeyCard(data) {
  return card([
    cardHeader(t("detail.journey")),
    el("ol", { class: "px-6 py-5" }, data.journey.map((step, i) =>
      el("li", { class: "relative pl-7 pb-5 last:pb-0" }, [
        el("span", { class: `absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${/failed/i.test(step.label) ? "bg-error" : "bg-primary"}` }),
        i < data.journey.length - 1 ? el("span", { class: "absolute left-[4.5px] top-4 bottom-0 w-px bg-outline-variant" }) : null,
        el("p", { class: "font-label-sm text-[11px] tracking-wide text-on-surface-variant/70", text: `${when(step.at)} · ${ago(step.at)} ago` }),
        el("p", { class: "font-body-md text-body-sm text-on-surface mt-0.5", text: step.label }),
        el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: [step.actor, step.place].filter(Boolean).join(" · ") })
      ])
    ))
  ], "rise-in-delay");
}

function certificationsCard(data) {
  if (!data.certifications.length) return null;
  return card([
    cardHeader(t("trace.certsInForce"), badge(String(data.certifications.length), "good")),
    el("div", { class: "divide-y divide-outline-variant/50" }, data.certifications.map((c) =>
      certificationRow(c, [
        el("div", { class: "flex items-start gap-3" }, [
          el("span", { class: "text-primary shrink-0 mt-0.5", html: icon("verified", { size: 18 }) }),
          el("div", { class: "min-w-0" }, [
            el("p", { class: "font-body-md text-body-sm text-on-surface", text: c.scheme }),
            el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: `${c.certifier?.name ?? "-"} · ${c.expiresAt ? onDay(c.expiresAt) : t("common.none")}` })
          ]),
          el("span", { class: "ml-auto shrink-0 text-on-surface-variant/50 mt-0.5", html: icon("info", { size: 15 }) })
        ])
      ], { scope: c.scope, extra: "px-6 py-4" })
    ))
  ], "rise-in-delay");
}

function temperatureCard(data, b) {
  if (!data.telemetry.length) return null;
  return card([
    cardHeader(t("trace.temperature"), b.coldChainBreached ? badge(t("flag.breached"), "bad") : null),
    el("div", { class: "px-5 py-5" }, [
      figureBox(temperatureChart(data.telemetry, b.coldChainRequired ? b.tempWindow : null, { width: 520, height: 220 }), t("common.none")),
      el("p", { class: "font-body-sm text-[12px] leading-relaxed text-on-surface-variant/80 mt-3", text: t("trace.temperatureNote") })
    ])
  ], "rise-in-delay");
}

function lineageCard(data) {
  if (data.lineage.nodes.length <= 1) return null;
  return card([
    cardHeader(t("trace.madeUp")),
    el("div", { class: "px-5 py-5" }, figureBox(lineageGraph(data.lineage, (id) => {
      location.search = `?id=${id}`;
    }), t("lot.noLineage")))
  ], "rise-in-delay");
}

// --------------------------------------------------------------------------
// Lot lookup
// --------------------------------------------------------------------------

let lotListCache = null;
const loadLots = () => lotListCache ?? (lotListCache = api.batches({ limit: 200 }).catch(() => []));

/** The lookup on its own card, for the states where there is no lot to show. */
function lookupCard() {
  return card([
    cardHeader(t("trace.lookupTitle")),
    el("div", { class: "px-6 py-6" }, [
      el("p", { class: "font-body-md text-body-sm text-on-surface-variant mb-4", text: t("trace.lookupNote") }),
      lookup({ dark: false })
    ])
  ], "rise-in");
}

function lookup({ dark = true } = {}) {
  const box = input({
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    placeholder: t("trace.scanPrompt"),
    class: dark
      ? "w-full rounded-lg border border-gold-soft/25 bg-white/5 px-3.5 py-2.5 font-body-md text-body-sm text-gold-soft placeholder:text-gold-soft/40 focus:border-gold-soft/60 outline-none transition-all relative z-10"
      : "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 font-body-md text-body-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all relative z-10"
  });
  const go = button(t("trace.trace"), { tone: dark ? "gold" : "primary" });

  // Suggestions drop upward out of the footer, downward everywhere else.
  const panel = el("div", {
    class: `absolute left-0 right-0 ${dark ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} hidden max-h-64 overflow-y-auto rounded-lg border border-outline-variant/70 bg-surface-container-lowest shadow-lg z-20`
  });
  const wrap = el("div", { class: "relative flex-1 min-w-0 sm:max-w-xs" }, [box, panel]);

  const submit = (id) => {
    const clean = String(id ?? box.value).replace(/\D/g, "");
    if (clean) location.search = `?id=${clean}`;
  };

  let batches = [];
  loadLots().then((list) => {
    batches = list;
  });

  function renderOptions(list) {
    clear(panel);
    if (!list.length) {
      panel.classList.add("hidden");
      return;
    }
    for (const b of list) {
      panel.append(
        el("button", {
          type: "button",
          class: "flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-container transition-colors border-b border-outline-variant/40 last:border-b-0",
          onclick: () => submit(b.id)
        }, [
          el("span", { class: "font-label-md text-[12px] text-on-surface-variant/70 shrink-0", text: `#${b.id}` }),
          el("span", { class: "min-w-0 flex-1" }, [
            el("p", { class: "font-body-sm text-body-sm text-on-surface truncate", text: `${b.produceType}${b.variety ? ` · ${b.variety}` : ""}` }),
            el("p", { class: "font-body-sm text-[11px] text-on-surface-variant/70 truncate", text: `${qty(b.quantity, b.unit)} · ${b.custodian?.name ?? b.origin?.location ?? ""}` })
          ]),
          badge(stageLabel(b.stage), b.recalled || b.stage === 6 ? "bad" : "neutral")
        ])
      );
    }
  }

  function filter() {
    const q = box.value.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) =>
      String(b.id) === q ||
      String(b.id).startsWith(q) ||
      b.produceType?.toLowerCase().includes(q) ||
      b.variety?.toLowerCase().includes(q)
    );
  }

  const open = () => {
    renderOptions(filter());
    panel.classList.remove("hidden");
  };

  box.addEventListener("focus", open);
  box.addEventListener("input", open);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") panel.classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) panel.classList.add("hidden");
  });

  go.addEventListener("click", () => submit());

  return el("div", { class: "flex items-center gap-2.5" }, [wrap, go]);
}

main();
