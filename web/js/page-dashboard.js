import { api, CUSTODY_ROLES } from "./api.js";
import { add, card, cardHeader, clear, el, icon, isClosed, mount, page, renderShell, t, timeOfDay } from "./ui.js";
import { lotTable, statTile } from "./lot-table.js";
import { networkMap } from "./map.js";
import { briefingCard } from "./briefing.js";

// One dashboard that reads the signed-in participant's roles, rather than four
// near-identical pages that drift. What changes between a farmer and an
// inspector is which figures matter and which shortcuts are worth offering, not
// the shape of the page.

const main = document.getElementById("main");

const SHORTCUTS = {
  farmer: [
    { label: "dash.registerProduce", href: "/register.html", icon: "agriculture", primary: true },
    { label: "nav.inventory", href: "/inventory.html", icon: "inventory_2" },
    { label: "nav.search", href: "/search.html", icon: "search" }
  ],
  processor: [
    { label: "nav.inventory", href: "/inventory.html", icon: "inventory_2", primary: true },
    { label: "nav.search", href: "/search.html", icon: "search" }
  ],
  distributor: [
    { label: "nav.inventory", href: "/inventory.html", icon: "local_shipping", primary: true },
    { label: "nav.search", href: "/search.html", icon: "search" }
  ],
  retailer: [
    { label: "nav.inventory", href: "/inventory.html", icon: "storefront", primary: true },
    { label: "nav.trace", href: "/trace.html", icon: "qr_code_2" }
  ],
  inspector: [
    { label: "nav.inspect", href: "/inspect.html", icon: "fact_check", primary: true },
    { label: "nav.search", href: "/search.html", icon: "search" }
  ],
  certifier: [
    { label: "nav.certify", href: "/certify.html", icon: "verified", primary: true },
    { label: "nav.search", href: "/search.html", icon: "search" }
  ],
  oracle: [
    { label: "nav.telemetry", href: "/telemetry.html", icon: "thermostat", primary: true },
    { label: "nav.search", href: "/search.html", icon: "search" }
  ],
  admin: [{ label: "nav.search", href: "/search.html", icon: "search", primary: true }]
};

/// Certifier, inspector, sensor gateway, and admin never hold a lot — their
/// "You hold" stat and "Recent Inventory" card would always read zero and
/// empty by design, which reads as broken rather than as the custody-free
/// model it actually is. Each gets the same work-queue view their own
/// dedicated page shows, so the dashboard says something true instead.
function workQueue(roles, all) {
  if (roles.includes("certifier")) {
    return {
      title: "cert.viewUncertified",
      href: "/certify.html",
      rows: all.filter((b) => !b.recalled && !isClosed(b) && b.counts.certifications === 0)
    };
  }
  if (roles.includes("inspector")) {
    const seen = new Set();
    const flagged = all.filter((b) => !isClosed(b) && (b.recalled || b.coldChainBreached || b.pendingCustodian) && (seen.has(b.id) ? false : seen.add(b.id)));
    const uninspected = all.filter((b) => !b.recalled && !isClosed(b) && b.counts.inspections === 0 && !seen.has(b.id));
    return { title: "insp.viewFlagged", href: "/inspect.html", rows: [...flagged, ...uninspected] };
  }
  if (roles.includes("oracle")) {
    return {
      title: "tele.viewActive",
      href: "/telemetry.html",
      rows: [...all].filter((b) => !b.recalled && !isClosed(b)).sort((a, b) => Number(b.coldChainRequired) - Number(a.coldChainRequired))
    };
  }
  if (roles.includes("admin")) {
    return {
      title: "dash.needsAttention",
      href: "/regulator.html",
      rows: all.filter((b) => !isClosed(b) && (b.recalled || b.coldChainBreached))
    };
  }
  return null;
}

async function main_() {
  const me = await renderShell({ active: "dashboard", title: t("nav.dashboard") });
  if (!me) return;

  const roles = me.roles ?? [];
  const holdsCustody = roles.some((r) => CUSTODY_ROLES.includes(r));

  await page(main, async () => {
    const [stats, heldAll, recentAll, openDeals, participants] = await Promise.all([
      api.stats(),
      api.batches({ custodian: me.address, limit: 200 }),
      api.batches({ limit: holdsCustody ? 8 : 200 }),
      // A lot mid-negotiation stays with its current custodian until both
      // sides sign, so a farmer waiting on round 2 of their own offer is
      // still its custodian, not its pendingCustodian — and the lot may not
      // be among the 8 most recently touched globally. Fetching every open
      // deal and filtering by who owes the next signature is the only way
      // that farmer's turn actually surfaces.
      api.batches({ flag: "open", limit: 200 }),
      api.participants()
    ]);

    // Sold, destroyed, and consumed lots have nothing left to do with them — keep
    // them off the dashboard so it does not pile up; they're still one click away
    // in My Inventory's "Closed" filter, and fully intact on-chain either way.
    const held = heldAll.filter((b) => !isClosed(b));
    const inTransit = held.filter((b) => b.stage === 3).length;
    const attention = held.filter((b) => b.recalled || b.coldChainBreached || !b.custodyIntact).length;
    const awaiting = openDeals.filter((b) => b.deal?.awaiting?.address?.toLowerCase() === me.address.toLowerCase());
    const queue = holdsCustody ? null : workQueue(roles, recentAll);

    mount(main, 
      hero(me, { held: held.length, inTransit, attention }),

      awaiting.length
        ? card([
            cardHeader(t("dist.pendingTransfers"), null),
            lotTable(awaiting, { dense: true })
          ], "rise-in mb-6 border-gold/50")
        : null,

      el("div", { class: "grid gap-6 xl:grid-cols-[1.4fr_1fr]" }, [
        queue
          ? card([
              cardHeader(t(queue.title), el("a", {
                class: "font-body-sm text-body-sm text-primary hover:underline",
                href: queue.href,
                text: t("dash.viewAll")
              })),
              lotTable(queue.rows.slice(0, 8), { onEmpty: t("common.none"), dense: true })
            ], "rise-in")
          : card([
              cardHeader(t("dash.recentInventory"), el("a", {
                class: "font-body-sm text-body-sm text-primary hover:underline",
                href: "/inventory.html",
                text: t("dash.viewAll")
              })),
              lotTable(held.slice(0, 8), { onEmpty: t("inv.empty"), dense: true })
            ], "rise-in"),

        el("div", { class: "grid gap-6 content-start" }, [
          // Reads the desk's own figures and, where a local model is
          // answering, says them back in a sentence. Draws itself in;
          // nothing else waits on it. Lives beside the map rather than
          // above everything, full width, the way it used to — seven
          // facts stacked as rows there pushed the whole dashboard down
          // before a reader reached anything they could act on.
          briefingCard(me),
          card([
            cardHeader(t("net.title"), el("span", {
              class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/70",
              text: `${participants.length}`
            })),
            el("div", { class: "p-4" }, [
              networkMap(participants, { width: 720, height: 460 }),
              el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/80 mt-3", text: t("net.caption") })
            ])
          ], "rise-in-delay")
        ])
      ]),

      el("div", { class: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6" }, [
        statTile(t("dash.onLedger"), stats.batches ?? 0),
        statTile(t("flag.recalled"), stats.recalled ?? 0, { tone: stats.recalled ? "bad" : "neutral" }),
        statTile(t("flag.breached"), stats.breached ?? 0, { tone: stats.breached ? "warn" : "neutral" }),
        statTile(t("dist.pendingTransfers"), stats.openHandovers ?? 0)
      ])
    );
  });
}

function hero(me, counts) {
  const roles = me.roles ?? [];
  const shortcuts = [];
  const seen = new Set();
  for (const role of roles) {
    for (const item of SHORTCUTS[role] ?? []) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      shortcuts.push(item);
    }
  }

  return el("section", { class: "rise-in relative overflow-hidden rounded-xl bg-primary-deep text-gold-soft p-7 lg:p-10 mb-6 shadow-[0_20px_50px_-20px_rgba(4,36,26,0.55)]" }, [
    el("div", { class: "absolute inset-0 grain pointer-events-none" }),
    el("div", { class: "relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8" }, [
      el("div", { class: "max-w-xl" }, [
        el("p", { class: "font-serif-display text-[30px] lg:text-[34px] leading-[1.15] text-white mb-2", text: t(`dash.greeting.${timeOfDay()}`, { name: me.name }) }),
        el("p", { class: "font-body-md text-body-md text-gold-soft/70 mb-7", text: me.location || "" }),
        el("div", { class: "flex flex-wrap items-center gap-3" },
          shortcuts.map((item) =>
            el("a", {
              href: item.href,
              class: item.primary
                ? "flex items-center gap-2 bg-gold hover:bg-gold-soft text-primary-deep font-medium rounded-lg pl-5 pr-4 py-3 transition-all hover:scale-[1.02]"
                : "action-pill flex items-center gap-2 rounded-lg border border-white/15 px-4 py-3 text-gold-soft/90 hover:border-gold-soft/50 hover:text-gold-soft transition-all"
            }, [
              el("span", { class: "font-body-md text-body-sm font-semibold", text: t(item.label) }),
              el("span", { html: icon(item.primary ? "arrow_forward" : item.icon, { size: 18 }) })
            ])
          )
        )
      ]),
      el("div", { class: "flex items-stretch divide-x divide-white/15 rounded-lg border border-white/10 overflow-hidden shrink-0" }, [
        heroStat(t("dash.youHold"), counts.held),
        heroStat(t("dash.inTransit"), counts.inTransit),
        heroStat(t("dash.needsAttention"), counts.attention)
      ])
    ])
  ]);
}

function heroStat(label, value) {
  return el("div", { class: "px-5 lg:px-6 py-4 min-w-[110px]" }, [
    el("p", { class: "font-label-sm text-[10px] tracking-widest uppercase text-gold-soft/50 mb-1.5", text: label }),
    el("p", { class: "font-serif-display text-[28px] leading-none text-white", text: String(value) })
  ]);
}

main_();
