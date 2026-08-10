import { api } from "./api.js";
import { add, badge, card, cardHeader, clear, el, emptyState, icon, input, mount, page, renderShell, t } from "./ui.js";
import { lotTable } from "./lot-table.js";

// Search reaches the whole ledger, not just your own shelf: the point of a shared
// chain is that a retailer can look up a lot they have never held.

const main = document.getElementById("main");
let participants = [];

async function start() {
  const me = await renderShell({ active: "search", title: t("search.title") });
  if (!me) return;

  await page(main, async () => {
    participants = await api.participants();
    render();
    const initial = new URLSearchParams(location.search).get("q");
    if (initial) {
      document.getElementById("q").value = initial;
      run(initial);
    }
  });
}

function render() {
  const box = input({ type: "search", id: "q", placeholder: t("search.produceIdPlaceholder") });
  box.addEventListener("input", (event) => run(event.target.value));

  mount(main, 
    el("div", { class: "mb-6 max-w-2xl" }, [
      el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("search.title") }),
      el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("search.subtitle") })
    ]),
    el("div", { class: "max-w-2xl mb-8 relative" }, [
      el("span", { class: "absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none", html: icon("search", { size: 18 }) }),
      box
    ]),
    el("div", { id: "results" })
  );
  document.getElementById("q").classList.add("pl-10");
}

let inflight = 0;
async function run(term) {
  const seq = ++inflight;
  const host = document.getElementById("results");
  const needle = term.trim();

  if (!needle) {
    mount(host, emptyState(t("search.subtitle"), "search"));
    return;
  }

  const [lots] = await Promise.all([api.batches({ q: needle, limit: 100 })]);
  if (seq !== inflight) return; // a later keystroke already won

  const people = participants.filter((p) =>
    [p.name, p.location, p.address].filter(Boolean).some((f) => f.toLowerCase().includes(needle.toLowerCase()))
  );

  mount(host, 
    people.length
      ? card([
          cardHeader(t("search.userDetails")),
          el("div", { class: "divide-y divide-outline-variant/40" }, people.map(personRow))
        ], "mb-6")
      : null,
    card([
      cardHeader(t("search.produce"), el("span", {
        class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/70",
        text: `${lots.length}`
      })),
      lotTable(lots, { onEmpty: t("search.notFound"), dense: true })
    ])
  );
}

function personRow(p) {
  return el("div", { class: "flex items-center gap-4 px-6 py-4" }, [
    el("div", { class: "h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0", html: icon("person", { size: 20 }) }),
    el("div", { class: "min-w-0 flex-1" }, [
      el("p", { class: "font-body-md text-body-md font-medium text-on-surface truncate", text: p.name }),
      el("p", { class: "font-body-sm text-[12px] text-on-surface-variant truncate", text: `${p.location || "-"} · ${p.address}` })
    ]),
    el("div", { class: "flex flex-wrap gap-1.5 justify-end" }, [
      ...p.roles.map((role) => badge(t(`role.${role}`) === `role.${role}` ? role : t(`role.${role}`), "info")),
      p.active ? null : badge(t("flag.recalled"), "bad")
    ]),
    el("a", {
      href: `/inventory.html`,
      class: "font-body-sm text-body-sm text-primary hover:underline whitespace-nowrap",
      text: `${t("dash.totalBatches")}: ${p.holding}`
    })
  ]);
}

start();
