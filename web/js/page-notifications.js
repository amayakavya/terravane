import { api } from "./api.js";
import { add, ago, badge, card, cardHeader, clear, el, emptyState, icon, mount, page, renderShell, t, when } from "./ui.js";

// The ledger, filtered to what this participant needs to know about. Every line
// is an event that actually happened on chain, not a message somebody composed.

const main = document.getElementById("main");

const SHAPE = {
  RecallInitiated: { icon: "warning", tone: "bad", key: "notif.recall" },
  RecallPropagated: { icon: "warning", tone: "bad", key: "notif.recall" },
  ColdChainBreached: { icon: "thermostat", tone: "warn", key: "notif.coldChain" },
  InspectionRecorded: { icon: "fact_check", tone: "info", key: "notif.inspection" },
  TransferProposed: { icon: "swap_horiz", tone: "warn", key: "notif.custody" },
  TransferAccepted: { icon: "check_circle", tone: "good", key: "notif.custody" },
  TransferCancelled: { icon: "close", tone: "neutral", key: "notif.custody" },
  BatchCreated: { icon: "agriculture", tone: "good", key: "event.register" },
  BatchCertified: { icon: "verified", tone: "good", key: "lot.certifications" },
  SaleRecorded: { icon: "sell", tone: "info", key: "act.sell" },
  BatchDestroyed: { icon: "error", tone: "bad", key: "act.destroy" },
  StageAdvanced: { icon: "local_shipping", tone: "neutral", key: "act.stage" },
  BatchSplit: { icon: "call_split", tone: "neutral", key: "act.split" },
  BatchesMerged: { icon: "call_split", tone: "neutral", key: "act.split" },
  TelemetryRecorded: { icon: "thermostat", tone: "neutral", key: "act.telemetry" }
};

const TONE_CLASS = {
  bad: "bg-error/10 text-error",
  warn: "bg-gold/15 text-[#8a6425]",
  good: "bg-primary/10 text-primary",
  info: "bg-secondary/10 text-secondary",
  neutral: "bg-surface-container text-on-surface-variant"
};

async function start() {
  const me = await renderShell({ active: "notifications", title: t("notif.title") });
  if (!me) return;

  await page(main, async () => {
    const items = await api.notifications(me.address, 60);

    mount(main, 
      el("div", { class: "max-w-3xl" }, [
        el("div", { class: "mb-6" }, [
          el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("notif.title") }),
          el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: me.name })
        ]),
        card([
          cardHeader(t("notif.title"), badge(String(items.length))),
          items.length
            ? el("div", { class: "divide-y divide-outline-variant/40" }, items.map(row))
            : emptyState(t("notif.empty"), "notifications")
        ], "rise-in")
      ])
    );
  });
}

/**
 * Custody events carry a from/to, and that is the whole story worth telling —
 * "Ganga Rice Mills accepted from Sundar Farms" says where a crop actually is,
 * where the raw event name and actor alone would not.
 */
function custodyLine(item) {
  const produce = item.produce ? `${item.produce.produceType}${item.produce.variety ? ` · ${item.produce.variety}` : ""}` : null;
  if (item.name === "TransferProposed" && item.from && item.to) {
    return t("notif.custodyProposed", { produce: produce ?? t("lot.title"), from: item.from.name, to: item.to.name });
  }
  if (item.name === "TransferAccepted" && item.from && item.to) {
    return t("notif.custodyAccepted", { produce: produce ?? t("lot.title"), from: item.from.name, to: item.to.name });
  }
  if (item.name === "TransferCancelled" && item.from) {
    return t("notif.custodyCancelled", { produce: produce ?? t("lot.title"), from: item.from.name });
  }
  return null;
}

function row(item) {
  const shape = SHAPE[item.name] ?? { icon: "info", tone: "neutral", key: "notif.title" };
  const open = item.batchId ? () => { location.href = `/lot.html?id=${item.batchId}`; } : null;
  const line = custodyLine(item);

  return el("div", {
    class: `flex items-start gap-4 px-6 py-4 ${open ? "cursor-pointer hover:bg-surface-container/50 transition-colors" : ""}`,
    onclick: open
  }, [
    el("div", { class: `h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${TONE_CLASS[shape.tone]}`, html: icon(shape.icon, { size: 18 }) }),
    el("div", { class: "min-w-0 flex-1" }, [
      el("div", { class: "flex items-center gap-2 flex-wrap" }, [
        el("p", { class: "font-body-md text-body-sm font-medium text-on-surface", text: t(shape.key) }),
        item.batchId ? badge(`#${item.batchId}`) : null,
        item.mine ? badge(t("notif.yours"), "info") : null
      ]),
      el("p", { class: "font-body-sm text-[12px] text-on-surface mt-0.5", text: line ?? `${item.name} · ${item.actor?.name ?? "-"}` }),
      item.args?.reason ? el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/80 mt-1", text: item.args.reason }) : null
    ]),
    el("p", { class: "font-label-sm text-[11px] text-on-surface-variant/70 whitespace-nowrap", text: `${ago(item.at)} · ${when(item.at)}` })
  ]);
}

start();
