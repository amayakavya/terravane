import { api } from "./api.js";
import { add, card, cardHeader, clear, el, input, mount, page, renderShell, t } from "./ui.js";
import { lotTable } from "./lot-table.js";

// What this participant is holding right now, filterable. Anything they no longer
// hold has left their responsibility and belongs on the search page instead.

const main = document.getElementById("main");
let held = [];
let query = "";
let flag = "";

const FLAGS = [
  ["", "search.produce"],
  ["clean", "trace.verified"],
  ["recalled", "flag.recalled"],
  ["breached", "flag.breached"],
  ["open", "dist.pendingTransfers"]
];

async function start() {
  const me = await renderShell({ active: "inventory", title: t("inv.title") });
  if (!me) return;

  await page(main, async () => {
    held = await api.batches({ custodian: me.address, limit: 500 });
    render();
  });
}

function visible() {
  const needle = query.trim().toLowerCase();
  return held.filter((b) => {
    if (flag === "clean" && (b.recalled || b.coldChainBreached || !b.custodyIntact)) return false;
    if (flag === "recalled" && !b.recalled) return false;
    if (flag === "breached" && !b.coldChainBreached) return false;
    if (flag === "open" && !b.pendingCustodian) return false;
    if (!needle) return true;
    return [b.produceType, b.variety, b.origin?.location, `#${b.id}`, String(b.id)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });
}

function render() {
  const rows = visible();
  const search = input({ type: "search", placeholder: t("inv.searchPlaceholder"), value: query });
  search.addEventListener("input", (event) => {
    query = event.target.value;
    repaint();
  });

  mount(main, 
    el("div", { class: "mb-6" }, [
      el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("inv.title") }),
      el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("inv.holding", { count: `${held.length} ${t("inv.lots")}` }) })
    ]),
    card([
      el("div", { class: "flex flex-wrap items-center gap-2.5 px-6 py-4 border-b border-outline-variant/60" }, [
        el("div", { class: "flex-1 min-w-[220px]" }, search),
        ...FLAGS.map(([value, key]) =>
          el("button", {
            type: "button",
            class: `rounded-full border px-3.5 py-1.5 font-label-sm text-[11px] transition-all ${
              flag === value
                ? "border-primary text-primary bg-primary/5"
                : "border-outline-variant text-on-surface-variant hover:border-primary/50"
            }`,
            text: value === "" ? t("dash.viewAll") : t(key),
            onclick: () => {
              flag = value;
              render();
            }
          })
        )
      ]),
      el("div", { id: "rows" }, lotTable(rows, { onEmpty: t("inv.empty") }))
    ], "rise-in")
  );
}

function repaint() {
  const host = document.getElementById("rows");
  if (host) mount(host, lotTable(visible(), { onEmpty: t("inv.empty") }));
}

start();
