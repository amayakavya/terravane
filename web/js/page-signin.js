import { api, session } from "./api.js";
import { I18n, add, badge, button, clear, el, icon, mount, notice, t } from "./ui.js";

// Signing in here is choosing which enrolled participant the browser acts as.
// There is no password because there is no account: identity on this chain is an
// address the registry knows about, and the node signs with development keys it
// will only use against a local chain. The page says that out loud rather than
// dressing it up with a login form that checks nothing.

const ROLE_ORDER = ["farmer", "processor", "distributor", "retailer", "certifier", "inspector", "oracle", "admin"];
const ROLE_ICON = {
  farmer: "agriculture",
  processor: "science",
  distributor: "local_shipping",
  retailer: "storefront",
  certifier: "verified",
  inspector: "shield",
  oracle: "thermostat",
  admin: "badge"
};

const root = document.getElementById("signin-root");
const nextUrl = new URLSearchParams(location.search).get("next") || "/dashboard.html";

let participants = [];
let chosenRole = null;

async function main() {
  I18n.apply();
  document.getElementById("lang-hook")?.remove();

  mount(root, 
    el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("common.loading") })
  );

  try {
    participants = await api.participants();
  } catch (err) {
    mount(root, notice(`${t("common.error")}: ${err.message}`, "bad"));
    return;
  }

  paintChainFacts();
  render();
}

async function paintChainFacts() {
  const host = document.getElementById("chain-facts");
  if (!host) return;
  try {
    const [health, stats] = await Promise.all([api.health(), api.stats()]);
    const facts = [
      [t("dash.onLedger"), stats.batches ?? 0],
      [t("chain.indexed"), health.indexedBlock],
      [t("signin.pickParticipant"), stats.participants ?? 0]
    ];
    mount(host, 
      el("div", { class: "flex flex-wrap gap-3" },
        facts.map(([label, value]) =>
          el("div", { class: "rounded-lg border border-white/10 px-5 py-3 min-w-[120px]" }, [
            el("p", { class: "font-label-sm text-[10px] tracking-widest uppercase text-gold-soft/50 mb-1", text: label }),
            el("p", { class: "font-serif-display text-[24px] leading-none text-white", text: String(value) })
          ])
        )
      )
    );
  } catch {
    mount(host, 
      el("p", { class: "font-body-sm text-body-sm text-gold-soft/50", text: t("chain.offline") })
    );
  }
}

function rolesPresent() {
  const seen = new Set();
  for (const p of participants) for (const role of p.roles) seen.add(role);
  return ROLE_ORDER.filter((role) => seen.has(role));
}

function render() {
  const roles = rolesPresent();
  const forRole = chosenRole ? participants.filter((p) => p.roles.includes(chosenRole)) : [];

  mount(root, 
    el("div", { class: "mb-8" }, [
      el("h2", { class: "font-serif-display text-[30px] leading-tight text-on-surface mb-2", text: t("welcome") }),
      el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("login.selectRoleDesc") })
    ]),

    el("p", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant mb-3", text: t("login.selectRole") }),
    el("div", { class: "grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-8" },
      roles.map((role) =>
        el("button", {
          type: "button",
          class: `role-btn ${role === chosenRole ? "role-active" : "role-inactive"} flex flex-col items-center gap-2 rounded-xl px-3 py-4 transition-all`,
          onclick: () => {
            chosenRole = role;
            render();
          }
        }, [
          el("span", { html: icon(ROLE_ICON[role] ?? "person", { size: 22 }) }),
          el("span", { class: "font-body-sm text-body-sm", text: t(`role.${role}`) !== `role.${role}` ? t(`role.${role}`) : role })
        ])
      )
    ),

    chosenRole
      ? el("div", {}, [
          el("p", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant mb-3", text: t("signin.pickParticipant") }),
          forRole.length
            ? el("div", { class: "grid gap-2.5 mb-8" }, forRole.map(participantRow))
            : notice(t("signin.noneForRole"), "warn")
        ])
      : null,

    el("div", { class: "flex items-start gap-2.5 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3" }, [
      el("span", { class: "text-on-surface-variant/70 shrink-0 mt-0.5", html: icon("lock", { size: 16 }) }),
      el("p", { class: "font-body-sm text-body-sm text-on-surface-variant", text: t("signin.chainNote") })
    ])
  );
}

function participantRow(participant) {
  const go = () => {
    session.set(participant);
    location.href = nextUrl;
  };

  return el("button", {
    type: "button",
    onclick: go,
    class:
      "w-full text-left flex items-center gap-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3.5 " +
      "hover:border-primary hover:bg-primary/[0.03] transition-all"
  }, [
    el("div", { class: "h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0", html: icon(ROLE_ICON[chosenRole] ?? "person", { size: 20 }) }),
    el("div", { class: "min-w-0 flex-1" }, [
      el("p", { class: "font-body-md text-body-md font-medium text-on-surface truncate", text: participant.name }),
      el("p", { class: "font-body-sm text-body-sm text-on-surface-variant truncate", text: participant.location || "" })
    ]),
    participant.active ? null : badge(t("common.none"), "bad"),
    el("span", { class: "text-on-surface-variant/50 shrink-0", html: icon("arrow_forward", { size: 18 }) })
  ]);
}

// Anyone already signed in is sent straight through.
if (session.get() && !new URLSearchParams(location.search).has("switch")) {
  location.replace(nextUrl);
} else {
  main();
}

void button;
