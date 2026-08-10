import { api } from "./api.js";
import { I18n, add, ago, badge, button, clear, el, icon, input, mount, notice, onDay, qty, t, when } from "./ui.js";
import { figureBox, lineageGraph, temperatureChart } from "./charts.js";
import { custodyStops, journeyMap, routeDistance } from "./map.js";

// What somebody standing in a shop with a packet in their hand gets. One verdict
// at the top, the reasons behind it underneath, and then the evidence. No sign in,
// because the whole point is that the record is public.

const root = document.getElementById("root");
const lotId = new URLSearchParams(location.search).get("id");

document.getElementById("lang-toggle")?.addEventListener("click", () => {
  I18n.toggle();
  location.reload();
});

const VERDICT = {
  verified: { tone: "good", band: "bg-primary/8 border-primary/30", ink: "text-primary" },
  caution: { tone: "warn", band: "bg-gold/10 border-gold/40", ink: "text-[#8a6425]" },
  unsafe: { tone: "bad", band: "bg-error/10 border-error/30", ink: "text-error" }
};

async function main() {
  I18n.apply();

  if (!lotId) {
    mount(root, lookup());
    return;
  }

  let data;
  try {
    data = await api.trace(lotId);
  } catch (err) {
    mount(root, notice(`${t("search.notFound")}: ${err.message}`, "bad"), el("div", { class: "mt-6" }, lookup()));
    return;
  }

  const b = data.batch;
  const style = VERDICT[data.verdict];

  mount(root, 
    // Verdict
    el("section", { class: `rounded-xl border overflow-hidden mb-6 rise-in ${style.band}` }, [
      el("div", { class: "flex flex-col sm:flex-row sm:items-center gap-5 px-6 py-6" }, [
        el("div", { class: "flex-1 min-w-0" }, [
          el("p", { class: `font-label-sm text-[11px] tracking-widest uppercase mb-1.5 ${style.ink}`, text: t(`trace.${data.verdict}`) }),
          el("h1", { class: "font-serif-display text-[28px] leading-tight text-on-surface mb-1", text: `${b.produceType}${b.variety ? ` · ${b.variety}` : ""}` }),
          el("p", { class: "font-body-md text-body-sm text-on-surface-variant", text: `${t("lot.title")} #${b.id} · ${qty(b.quantity, b.unit)}` })
        ]),
        el("div", { class: "bg-white rounded-lg p-2 shrink-0 w-[118px] h-[118px]", id: "qr" })
      ]),
      data.warnings.length
        ? el("ul", { class: "border-t border-current/10 divide-y divide-current/10" }, data.warnings.map((w) =>
            el("li", { class: "flex items-start gap-3 px-6 py-3" }, [
              el("span", { class: w.level === "critical" ? "text-error shrink-0" : "text-[#8a6425] shrink-0", html: icon(w.level === "critical" ? "error" : "warning", { size: 18 }) }),
              el("p", { class: "font-body-md text-body-sm text-on-surface", text: w.text })
            ])
          ))
        : el("p", { class: "px-6 pb-5 font-body-md text-body-sm text-on-surface-variant", text: t("lot.attributesVerified") })
    ]),

    panel(t("trace.provenance"), definition([
      [t("label.grownBy"), b.origin.farm?.name ?? "-"],
      [t("search.location"), b.origin.location || "-"],
      [t("detail.harvestDate"), `${onDay(b.harvestedAt)} · ${ago(b.harvestedAt)}`],
      [t("lot.custodian"), `${b.custodian?.name ?? "-"}${b.custodian?.location ? ` · ${b.custodian.location}` : ""}`],
      [t("lot.custodyPoints"), String(b.counts.handovers)],
      b.coldChainRequired
        ? [t("lot.coldChain"), `${b.tempWindow[0]} to ${b.tempWindow[1]} °C · ${b.coldChainBreached ? t("flag.breached") : t("trace.verified")}`]
        : null
    ])),

    attributesPanel(data.attributes),
    routePanel(data),

    data.certifications.length
      ? panel(t("trace.certsInForce"), el("div", { class: "grid sm:grid-cols-2 gap-3 px-6 py-5" }, data.certifications.map((c) =>
          el("div", { class: "rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3" }, [
            el("p", { class: "font-body-md text-body-sm text-on-surface", text: c.scheme }),
            el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: `${c.certifier?.name ?? "-"} · ${c.expiresAt ? onDay(c.expiresAt) : t("common.none")}` })
          ])
        )))
      : null,

    panel(t("detail.journey"), el("ol", { class: "px-6 py-5" }, data.journey.map((step, i) =>
      el("li", { class: "relative pl-7 pb-5 last:pb-0" }, [
        el("span", { class: `absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${/failed/i.test(step.label) ? "bg-error" : "bg-primary"}` }),
        i < data.journey.length - 1 ? el("span", { class: "absolute left-[4.5px] top-4 bottom-0 w-px bg-outline-variant" }) : null,
        el("p", { class: "font-label-sm text-[11px] tracking-wide text-on-surface-variant/70", text: `${when(step.at)} · ${ago(step.at)} ago` }),
        el("p", { class: "font-body-md text-body-sm text-on-surface mt-0.5", text: step.label }),
        el("p", { class: "font-body-sm text-[12px] text-on-surface-variant", text: [step.actor, step.place].filter(Boolean).join(" · ") })
      ])
    ))),

    data.telemetry.length
      ? panel(t("trace.temperature"), el("div", { class: "px-6 py-5" }, [
          figureBox(temperatureChart(data.telemetry, b.coldChainRequired ? b.tempWindow : null), t("common.none")),
          el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/80 mt-3", text: t("trace.temperatureNote") })
        ]))
      : null,

    data.lineage.nodes.length > 1
      ? panel(t("trace.madeUp"), el("div", { class: "px-6 py-5" }, figureBox(lineageGraph(data.lineage, (id) => {
          location.search = `?id=${id}`;
        }), t("lot.noLineage"))))
      : null,

    el("div", { class: "mt-8 text-center" }, [
      el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/70 mb-4", text: `${t("lot.title")} #${b.id}` }),
      lookup()
    ])
  );

  fetch(`/api/qr/${b.id}`)
    .then((r) => r.text())
    .then((svg) => {
      const host = document.getElementById("qr");
      if (host) host.innerHTML = svg;
    });
}

function panel(title, body) {
  return el("section", { class: "rounded-xl border border-outline-variant/70 bg-surface-container-lowest mb-6 rise-in-delay" }, [
    el("h2", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant px-6 py-4 border-b border-outline-variant/50", text: title }),
    body
  ]);
}

function definition(pairs) {
  return el("dl", { class: "grid sm:grid-cols-[170px_minmax(0,1fr)] gap-x-6 gap-y-3 px-6 py-5" },
    pairs.filter(Boolean).flatMap(([key, value]) => [
      el("dt", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/80 pt-0.5", text: key }),
      el("dd", { class: "font-body-md text-body-sm text-on-surface m-0", text: value })
    ])
  );
}

function attributesPanel(attrs) {
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

  return el("section", { class: `rounded-xl border mb-6 rise-in-delay ${attrs.verified ? "border-outline-variant/70" : "border-error/40"} bg-surface-container-lowest` }, [
    el("div", { class: "flex items-center justify-between gap-3 px-6 py-4 border-b border-outline-variant/50" }, [
      el("h2", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant", text: t("lot.attributes") }),
      badge(attrs.verified ? t("lot.attributesVerified") : t("lot.attributesUnverified"), attrs.verified ? "good" : "bad")
    ]),
    definition(rows)
  ]);
}

function routePanel(data) {
  const stops = custodyStops({ batch: data.batch, handovers: data.journeyHandovers ?? [] });
  const readings = data.telemetry.filter((r) => r.position).map((r) => ({ ...r.position, excursion: r.excursion }));
  if (!stops.length && !readings.length) return null;

  const km = routeDistance(stops);
  return panel(
    `${t("trace.travelled")}${km > 1 ? ` · ${Math.round(km).toLocaleString()} km` : ""}`,
    el("div", { class: "p-4" }, journeyMap(stops, readings, { width: 680, height: 400 }))
  );
}

function lookup() {
  const box = input({ type: "number", min: "1", placeholder: t("trace.scanPrompt"), class: "w-56 rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 font-body-md text-body-sm" });
  const go = button(t("trace.trace"), { tone: "primary" });
  const submit = () => {
    if (box.value) location.search = `?id=${box.value}`;
  };
  go.addEventListener("click", submit);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  return el("div", { class: "flex items-center justify-center gap-2.5" }, [box, go]);
}

main();
