import { api } from "./api.js";
import { card, cardHeader, el, mount, notice, page, renderShell, t } from "./ui.js";
import { lotTable, statTile } from "./lot-table.js";

// The regulator's working surface: no single lot matters here, the network-wide
// pattern does. Where recalls cluster, where cold chain keeps breaking, and
// which lots are live right now — the questions FSSAI/APEDA-style oversight
// actually asks, not a copy of the operator console with fewer buttons.

const main = document.getElementById("main");

async function start() {
  const me = await renderShell({ active: "regulator", title: t("reg.title") });
  if (!me) return;

  if (!(me.roles ?? []).includes("admin")) {
    mount(main, notice(t("act.noPermission"), "bad"));
    return;
  }

  await page(main, async () => {
    const [stats, recalled, breached, all] = await Promise.all([
      api.stats(),
      api.batches({ flag: "recalled", limit: 100 }),
      api.batches({ flag: "breached", limit: 100 }),
      api.batches({ limit: 1000 })
    ]);

    const byRegion = groupByRegion(all);

    mount(main,
      el("div", { class: "mb-6 max-w-2xl" }, [
        el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("reg.title") }),
        el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("reg.subtitle") })
      ]),

      el("div", { class: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6" }, [
        statTile(t("dash.onLedger"), stats.batches ?? 0),
        statTile(t("flag.recalled"), stats.recalled ?? 0, { tone: stats.recalled ? "bad" : "neutral" }),
        statTile(t("flag.breached"), stats.breached ?? 0, { tone: stats.breached ? "warn" : "neutral" }),
        statTile(t("reg.failedInspections"), stats.failedInspections ?? 0, { tone: stats.failedInspections ? "warn" : "neutral" })
      ]),

      el("div", { class: "grid gap-6 lg:grid-cols-2 mb-6" }, [
        card([cardHeader(t("reg.recallsByRegion")), regionTable(byRegion, "recalls")], "rise-in"),
        card([cardHeader(t("reg.breachByRegion")), regionTable(byRegion, "breaches")], "rise-in-delay")
      ]),

      el("div", { class: "grid gap-6 lg:grid-cols-2" }, [
        card([cardHeader(t("reg.recalledLots")), lotTable(recalled, { onEmpty: t("reg.noRecalls"), dense: true })], "rise-in"),
        card([cardHeader(t("reg.breachedLots")), lotTable(breached, { onEmpty: t("reg.noBreaches"), dense: true })], "rise-in-delay")
      ])
    );
  });
}

/** Every lot bucketed by where it started, the unit a regulator actually reasons in. */
function groupByRegion(batches) {
  const map = new Map();
  for (const b of batches) {
    const region = b.origin?.location || t("common.none");
    if (!map.has(region)) map.set(region, { region, lots: 0, recalls: 0, breaches: 0 });
    const row = map.get(region);
    row.lots++;
    if (b.recalled) row.recalls++;
    if (b.coldChainBreached) row.breaches++;
  }
  return [...map.values()].sort((a, b) => b.lots - a.lots);
}

function regionTable(rows, sortKey) {
  const ranked = [...rows].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 8);
  const withSignal = ranked.filter((r) => r[sortKey] > 0);
  if (!withSignal.length) return el("div", { class: "p-6" }, notice(t(sortKey === "recalls" ? "reg.noRecalls" : "reg.noBreaches")));

  return el("div", { class: "overflow-x-auto" }, [
    el("table", { class: "w-full min-w-[420px] border-collapse" }, [
      el("thead", {}, el("tr", {}, [
        th(t("reg.region")),
        th(t("reg.lots"), "text-right"),
        th(t(sortKey === "recalls" ? "reg.recalls" : "reg.breaches"), "text-right"),
        th(t("reg.rate"), "text-right")
      ])),
      el("tbody", {}, withSignal.map((r) =>
        el("tr", { class: "border-b border-outline-variant/40" }, [
          td(r.region),
          td(String(r.lots), "text-right"),
          td(String(r[sortKey]), "text-right"),
          td(`${Math.round((r[sortKey] / r.lots) * 100)}%`, "text-right")
        ])
      ))
    ])
  ]);
}

function th(text, extra = "") {
  return el("th", {
    class: `text-left font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/80 font-semibold px-6 py-3 border-b border-outline-variant/60 ${extra}`,
    text
  });
}

function td(text, extra = "") {
  return el("td", { class: `px-6 py-2.5 font-body-sm text-body-sm text-on-surface ${extra}`, text });
}

start();
