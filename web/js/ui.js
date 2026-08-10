import { I18n } from "./i18n.js";
import { icon } from "./icons.js";
import { api, session, STAGE_KEYS } from "./api.js";

export { icon, I18n };
export const t = (key, vars) => I18n.t(key, vars);

// --------------------------------------------------------------------------
// DOM
// --------------------------------------------------------------------------

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Append, dropping the optional children that came out as null. */
export function add(parent, ...children) {
  parent.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return parent;
}

/** Replace a node's contents in one call. */
export function mount(parent, ...children) {
  return add(clear(parent), ...children);
}

export const $ = (selector) => document.querySelector(selector);

// --------------------------------------------------------------------------
// Formatting
// --------------------------------------------------------------------------

export function when(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function onDay(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function ago(seconds) {
  if (!seconds) return "";
  const delta = Date.now() / 1000 - Number(seconds);
  const units = [
    [86400 * 365, "y"],
    [86400 * 30, "mo"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"]
  ];
  for (const [size, label] of units) if (delta >= size) return `${Math.floor(delta / size)}${label}`;
  return "now";
}

export const qty = (value, unit) => `${Number(value).toLocaleString()} ${unit ?? ""}`.trim();

export const initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const stageLabel = (stage) => t(STAGE_KEYS[stage] ?? "common.none");

// --------------------------------------------------------------------------
// Small components
// --------------------------------------------------------------------------

const TONES = {
  neutral: "border-outline-variant text-on-surface-variant bg-surface-container-lowest",
  good: "border-primary/30 text-primary bg-primary/5",
  warn: "border-gold/40 text-[#8a6425] bg-gold/10",
  bad: "border-error/30 text-error bg-error/5",
  info: "border-secondary/30 text-secondary bg-secondary/5"
};

export function badge(text, tone = "neutral") {
  return el("span", {
    class: `inline-flex items-center rounded-full border px-2.5 py-0.5 font-label-sm text-[11px] whitespace-nowrap ${TONES[tone] ?? TONES.neutral}`,
    text
  });
}

/** Everything a lot is currently carrying, worst first. */
export function lotFlags(batch) {
  const out = [];
  if (batch.recalled) out.push([t("flag.recalled"), "bad"]);
  if (batch.stage === 6) out.push([t("stage.destroyed"), "bad"]);
  if (batch.coldChainBreached) out.push([t("flag.breached"), "warn"]);
  if (!batch.custodyIntact) out.push([t("flag.custodyGap"), "warn"]);
  if (batch.counts?.failedInspections > 0) {
    const n = batch.counts.failedInspections;
    out.push([`${n} ${t(n === 1 ? "flag.failedCheck" : "flag.failedChecks")}`, "warn"]);
  }
  if (Number(batch.quantity) === 0 && batch.children?.length) out.push([t("flag.consumed"), "info"]);
  if (batch.counts?.activeCertifications > 0) out.push([`${batch.counts.activeCertifications} ${t("flag.certified")}`, "good"]);
  return out.map(([label, tone]) => badge(label, tone));
}

export function stageBadge(batch) {
  const tone = batch.stage === 6 ? "bad" : batch.stage === 5 ? "info" : batch.recalled ? "bad" : "neutral";
  return badge(stageLabel(batch.stage), tone);
}

export function emptyState(message, iconName = "inventory_2") {
  return el("div", { class: "flex flex-col items-center justify-center gap-3 py-16 text-on-surface-variant/70" }, [
    el("div", { class: "text-on-surface-variant/40", html: icon(iconName, { size: 36 }) }),
    el("p", { class: "font-body-md text-body-sm", text: message })
  ]);
}

export function notice(message, tone = "neutral") {
  const style = {
    neutral: "border-outline-variant bg-surface-container-lowest text-on-surface-variant",
    good: "border-primary/30 bg-primary/5 text-primary",
    warn: "border-gold/40 bg-gold/10 text-[#7a5820]",
    bad: "border-error/30 bg-error/5 text-error"
  }[tone];
  return el("div", { class: `rounded-lg border px-4 py-3 font-body-sm text-body-sm whitespace-pre-wrap break-words ${style}`, text: message });
}

export function card(children, extra = "") {
  return el("section", { class: `rounded-xl border border-outline-variant/70 bg-surface-container-lowest ${extra}` }, children);
}

export function cardHeader(title, right = null) {
  return el("div", { class: "flex items-center justify-between gap-4 px-6 py-4 border-b border-outline-variant/60" }, [
    el("h2", { class: "font-headline-md text-[15px] font-semibold text-on-surface", text: title }),
    right
  ]);
}

export function field(label, control) {
  return el("label", { class: "block" }, [
    el("span", { class: "block font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant mb-1.5", text: label }),
    control
  ]);
}

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 font-body-md text-body-sm " +
  "text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all";

export const input = (attrs = {}) => el("input", { class: INPUT_CLASS, ...attrs });
export const select = (attrs = {}, options = []) => el("select", { class: INPUT_CLASS, ...attrs }, options);

export const button = (label, { tone = "primary", ...attrs } = {}) => {
  const tones = {
    primary: "bg-primary text-on-primary hover:bg-primary-container",
    gold: "bg-gold text-primary-deep hover:bg-gold-soft",
    quiet: "border border-outline-variant text-on-surface hover:border-primary hover:text-primary bg-surface-container-lowest",
    danger: "border border-error/40 text-error hover:bg-error/5 bg-surface-container-lowest"
  };
  return el("button", {
    class: `inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-body-md text-body-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${tones[tone]}`,
    type: "button",
    ...attrs,
    text: label
  });
};

// --------------------------------------------------------------------------
// Shell
// --------------------------------------------------------------------------

function navItems(participant) {
  const roles = participant.roles ?? [];
  const items = [
    { key: "dashboard", icon: "summarize", label: "nav.dashboard", href: "/dashboard.html" },
    { key: "inventory", icon: "inventory_2", label: "nav.inventory", href: "/inventory.html" },
    { key: "search", icon: "search", label: "nav.search", href: "/search.html" }
  ];
  if (roles.includes("farmer")) {
    items.push({ key: "register", icon: "agriculture", label: "dash.registerProduce", href: "/register.html" });
  }
  if (roles.includes("inspector")) {
    items.push({ key: "inspect", icon: "fact_check", label: "nav.inspect", href: "/inspect.html" });
  }
  items.push({ key: "notifications", icon: "notifications", label: "nav.notifications", href: "/notifications.html" });
  items.push({ key: "trace", icon: "qr_code_2", label: "nav.trace", href: "/trace.html" });
  return items;
}

function logoMark(size = 32) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="shrink-0">
<path d="M32 6c8 4 12 12 10 22H22c-2-10 2-18 10-22z" fill="#e7d3a8"/>
<path d="M14 38c6-4 12-6 18-6s12 2 18 6l-4 4c-5-3-9-4-14-4s-9 1-14 4z" fill="#b6863b"/>
<rect x="24" y="18" width="14" height="12" rx="1" fill="#f3ecd8"/>
<rect x="27" y="21" width="6" height="5" fill="#04241a"/>
<circle cx="27" cy="34" r="5" fill="#f3ecd8"/><circle cx="27" cy="34" r="2" fill="#04241a"/>
<circle cx="37" cy="34" r="4" fill="#f3ecd8"/><circle cx="37" cy="34" r="1.6" fill="#04241a"/>
</svg>`;
}

/**
 * Draws the frame every signed-in page sits in. Returns the participant so the
 * page can get straight on with its own work.
 */
export async function renderShell({ active, titleKey, title }) {
  const participant = session.require();
  if (!participant) return null;

  const sidebar = $("#sidebar-root");
  const topbar = $("#topbar-root");
  let unread = 0;
  try {
    unread = (await api.notifications(participant.address, 20)).filter((n) => !n.mine).length;
  } catch {
    unread = 0;
  }

  if (sidebar) {
    const links = navItems(participant)
      .map((item) => {
        const on = item.key === active;
        return `<a href="${item.href}" class="nav-link ${on ? "active" : "hover:bg-white/5"} flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all">
  <span class="shrink-0">${icon(item.icon, { size: 20 })}</span>
  <span class="font-body-md text-body-sm" data-i18n="${item.label}"></span>
  ${item.key === "notifications" && unread ? `<span class="ml-auto bg-gold text-primary-deep text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">${unread}</span>` : ""}
</a>`;
      })
      .join("");

    sidebar.innerHTML = `
<div class="absolute inset-0 grain pointer-events-none"></div>
<div class="flex items-center gap-2.5 px-6 py-6 relative">
  ${logoMark(32)}
  <span class="font-serif-display text-[22px] tracking-tight text-gold-soft" data-i18n="brand"></span>
</div>
<nav class="flex-1 px-3 py-2 flex flex-col gap-1 relative overflow-y-auto">${links}</nav>
<div class="px-3 pb-4 pt-3 relative">
  <div class="h-px bg-white/10 mb-3"></div>
  <div class="flex items-center gap-3 px-3.5 py-2 mb-1">
    <div class="h-8 w-8 rounded-full bg-gold-soft/15 border border-gold-soft/30 text-gold-soft flex items-center justify-center font-serif-display text-sm shrink-0">${initials(participant.name)}</div>
    <div class="leading-tight min-w-0">
      <p class="font-body-sm text-body-sm text-gold-soft truncate">${participant.name}</p>
      <p class="font-label-sm text-[10px] tracking-widest uppercase text-gold-soft/50 truncate">${(participant.roles ?? []).join(", ")}</p>
    </div>
  </div>
  <button id="sign-out" type="button" class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-gold-soft/50 hover:bg-error/10 hover:text-[#e2a396] transition-all">
    ${icon("logout", { size: 20 })}
    <span class="font-body-md text-body-sm" data-i18n="nav.logout"></span>
  </button>
</div>`;
  }

  if (topbar) {
    topbar.innerHTML = `
<div class="min-w-0">
  <h1 class="font-serif-display text-[26px] leading-none text-on-surface truncate" ${titleKey ? `data-i18n="${titleKey}"` : ""}>${titleKey ? "" : (title ?? "")}</h1>
  <p class="font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/70 mt-1" id="chain-state"></p>
</div>
<div class="flex items-center gap-3">
  <button id="lang-toggle" type="button" class="flex items-center gap-1.5 px-3 py-2 rounded-full border border-outline-variant/60 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary font-body-sm text-body-sm">
    ${icon("translate", { size: 18 })}<span data-lang-label></span>
  </button>
  <a href="/notifications.html" class="relative p-2.5 rounded-full hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary">
    ${icon("notifications", { size: 20 })}
    ${unread ? '<span class="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-gold"></span>' : ""}
  </a>
  <div class="flex items-center gap-2.5 pl-3 border-l border-outline-variant">
    <div class="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-serif-display text-sm">${initials(participant.name)}</div>
    <div class="leading-tight hidden sm:block max-w-[180px]">
      <p class="font-body-sm text-body-sm font-medium text-on-surface truncate">${participant.name}</p>
      <p class="font-label-sm text-[10px] tracking-widest uppercase text-on-surface-variant/70 truncate">${participant.location ?? ""}</p>
    </div>
  </div>
</div>`;
  }

  const mobile = $("#mobile-nav");
  if (mobile) {
    // Below the sidebar breakpoint the same destinations run across the top,
    // scrolling sideways rather than hiding behind a menu nobody opens.
    mobile.innerHTML = navItems(participant)
      .map((item) => {
        const on = item.key === active;
        return `<a href="${item.href}" class="flex items-center gap-2 rounded-full px-3.5 py-2 whitespace-nowrap font-body-sm text-body-sm transition-all ${
          on ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-container"
        }">${icon(item.icon, { size: 18 })}<span data-i18n="${item.label}"></span></a>`;
      })
      .join("");
  }

  I18n.apply();

  $("#lang-toggle")?.addEventListener("click", () => {
    I18n.toggle();
    location.reload();
  });
  $("#sign-out")?.addEventListener("click", () => {
    session.clear();
    location.href = "/index.html";
  });

  paintChainState();
  setInterval(paintChainState, 8000);

  return participant;
}

async function paintChainState() {
  const target = $("#chain-state");
  if (!target) return;
  try {
    const health = await api.health();
    target.textContent = health.ok
      ? `${t("chain.head")} ${health.chainHead} · ${t("chain.indexed")} ${health.indexedBlock}`
      : t("chain.offline");
    target.className = `font-label-sm text-[11px] tracking-widest uppercase mt-1 ${health.ok ? "text-on-surface-variant/70" : "text-error"}`;
  } catch {
    target.textContent = t("chain.offline");
    target.className = "font-label-sm text-[11px] tracking-widest uppercase mt-1 text-error";
  }
}

/** Run a page body, and put any failure on screen rather than in the console. */
export async function page(root, work) {
  try {
    await work();
  } catch (err) {
    clear(root).append(
      el("div", { class: "max-w-xl mx-auto py-16" }, [notice(`${t("common.error")}: ${err.message}`, "bad")])
    );
  }
}
