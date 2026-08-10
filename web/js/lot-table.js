import { badge, el, emptyState, lotFlags, qty, stageBadge, t, when } from "./ui.js";

// One table of lots, used by the dashboard, the inventory and the search. Three
// slightly different tables would drift apart within a week.

export function lotTable(batches, { onEmpty, dense = false } = {}) {
  if (!batches.length) return emptyState(onEmpty ?? t("inv.empty"));

  const head = ["table.refId", "table.crop", "table.quantity", "table.status", "lot.custodian", ""];

  return el("div", { class: "overflow-x-auto" }, [
    el("table", { class: "w-full min-w-[720px] border-collapse" }, [
      el("thead", {}, el("tr", {},
        head.map((key, i) =>
          el("th", {
            class:
              "text-left font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/80 font-semibold " +
              `px-6 py-3 border-b border-outline-variant/60 ${i === 2 ? "text-right" : ""}`,
            text: key ? t(key) : ""
          })
        )
      )),
      el("tbody", {}, batches.map((b) => row(b, dense)))
    ])
  ]);
}

function row(b, dense) {
  const pad = dense ? "px-6 py-2.5" : "px-6 py-3.5";
  const open = () => {
    location.href = `/lot.html?id=${b.id}`;
  };

  return el("tr", {
    class: "border-b border-outline-variant/40 hover:bg-surface-container/60 cursor-pointer transition-colors",
    onclick: open
  }, [
    el("td", { class: `${pad} font-label-md text-[13px] text-on-surface-variant whitespace-nowrap`, text: `#${b.id}` }),
    el("td", { class: pad }, [
      el("p", { class: "font-body-md text-body-sm font-medium text-on-surface", text: b.produceType }),
      el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/80", text: b.variety || t("common.none") })
    ]),
    el("td", { class: `${pad} text-right font-label-md text-[13px] whitespace-nowrap`, text: qty(b.quantity, b.unit) }),
    el("td", { class: pad }, stageBadge(b)),
    el("td", { class: `${pad} font-body-sm text-body-sm text-on-surface-variant` }, [
      el("span", { text: b.custodian?.name ?? "-" }),
      b.pendingCustodian
        ? el("p", { class: "font-body-sm text-[11px] text-on-surface-variant/70", text: `${t("lot.pending")} ${b.pendingCustodian.name}` })
        : null
    ]),
    el("td", { class: pad }, el("div", { class: "flex flex-wrap gap-1.5 justify-end" }, lotFlags(b)))
  ]);
}

/** A compact figure with a caption, used across the dashboards. */
export function statTile(label, value, { tone = "neutral", hint = null } = {}) {
  const colour = { neutral: "text-on-surface", bad: "text-error", warn: "text-[#8a6425]", good: "text-primary" }[tone];
  return el("div", { class: "rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-5 py-4" }, [
    el("p", { class: "font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/80 mb-1.5", text: label }),
    el("p", { class: `font-serif-display text-[28px] leading-none ${colour}`, text: String(value) }),
    hint ? el("p", { class: "font-body-sm text-[11px] text-on-surface-variant/70 mt-1.5", text: hint }) : null
  ]);
}

export { badge, when };
