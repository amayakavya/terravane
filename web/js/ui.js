import { I18n } from "./i18n.js";
import { icon } from "./icons.js";
import { api, CUSTODY_ROLES, session, STAGE_KEYS } from "./api.js";

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

/** Morning until noon, afternoon until 5pm, evening after — the visitor's own clock, not the server's. */
export function timeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

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

/** Sold, destroyed, or fully consumed by a split/merge — nothing left to act on. */
export function isClosed(batch) {
  return batch.stage === 5 || batch.stage === 6 || (Number(batch.quantity) === 0 && batch.children?.length > 0);
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

/**
 * A confirmation that survives a full-page reload/rebuild. An in-form notice
 * gets wiped the moment an action's success handler re-renders the tab it
 * lives in — this mounts to document.body instead of the app root, so it
 * lives on independent of whatever the page does next, and clears itself.
 */
export function toast(message, tone = "good", ms = 5000) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = el("div", { id: "toast-host", class: "fixed top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-[min(420px,calc(100vw-3rem))]" });
    document.body.appendChild(host);
  }
  const node = notice(message, tone);
  node.classList.add("w-full", "shadow-lg", "rise-in");
  host.appendChild(node);
  setTimeout(() => node.remove(), ms);
  return node;
}

/**
 * A dialog over the page, mounted to document.body rather than the app root so
 * a tab re-render underneath cannot tear it out from under the reader. Closes
 * on Escape, on the backdrop, and on the close button; focus goes into the
 * panel on open and back to whatever opened it on close, because a reader who
 * opened this from the keyboard has to be able to get back out the same way.
 */
export function modal(title, children, { subtitle = null } = {}) {
  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  const closeButton = el("button", {
    type: "button",
    class: "shrink-0 rounded-lg p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors",
    "aria-label": t("common.close"),
    html: icon("close", { size: 18 })
  });

  const panel = el("div", {
    class: "relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-outline-variant/70 " +
      "bg-surface-container-lowest shadow-lg rise-in",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId
  }, [
    el("div", { class: "flex items-start justify-between gap-4 px-6 py-4 border-b border-outline-variant/60 sticky top-0 bg-surface-container-lowest z-10" }, [
      el("div", { class: "min-w-0" }, [
        el("h2", { id: titleId, class: "font-headline-md text-[15px] font-semibold text-on-surface", text: title }),
        subtitle ? el("p", { class: "font-body-sm text-[12px] text-on-surface-variant mt-0.5", text: subtitle }) : null
      ]),
      closeButton
    ]),
    el("div", { class: "px-6 py-5 grid gap-5" }, children)
  ]);

  const backdrop = el("div", {
    class: "fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto bg-primary-deep/40"
  }, [panel]);

  function close() {
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeydown, true);

  document.body.append(backdrop);
  closeButton.focus();
  return close;
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

const CHEVRON = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * A dropdown themed like the rest of the app. A native <select>'s open
 * option list is drawn by the OS, not the page — no CSS can restyle it, so
 * it always looks foreign next to the rest of the UI. This builds the
 * trigger and the option panel from the same primitives as everything
 * else (rounded-lg, outline-variant border, primary hover), and keeps a
 * hidden native <select> in sync underneath so every existing call site
 * that reads `.value` or listens for `change` keeps working unchanged.
 */
export function select(attrs = {}, options = []) {
  const native = el("select", { class: "sr-only", tabindex: "-1", "aria-hidden": "true", ...attrs }, options);

  const label = el("span", { class: "truncate text-left flex-1" });
  const trigger = el("button", {
    type: "button",
    class: `${INPUT_CLASS} cursor-pointer flex items-center justify-between gap-2 text-left`
  }, [label, el("span", { class: "shrink-0 text-on-surface-variant", html: CHEVRON })]);

  const panel = el("div", {
    class: "hidden absolute z-20 mt-1.5 w-full max-h-60 overflow-y-auto rounded-lg border border-outline-variant " +
      "bg-surface-container-lowest shadow-lg py-1"
  });

  function syncLabel() {
    label.textContent = native.options[native.selectedIndex]?.text ?? "";
  }

  function closePanel() {
    panel.classList.add("hidden");
    document.removeEventListener("click", onOutsideClick, true);
  }

  function onOutsideClick(e) {
    if (!wrap.contains(e.target)) closePanel();
  }

  function openPanel() {
    clear(panel);
    for (const opt of native.options) {
      const selected = opt.value === native.value;
      const row = el("button", {
        type: "button",
        class: "w-full text-left px-3.5 py-2 font-body-md text-body-sm transition-colors " +
          (selected ? "bg-primary/10 text-primary font-medium" : "text-on-surface hover:bg-primary/5"),
        text: opt.text
      });
      row.addEventListener("click", () => {
        native.value = opt.value;
        native.dispatchEvent(new Event("change", { bubbles: true }));
        syncLabel();
        closePanel();
      });
      panel.append(row);
    }
    panel.classList.remove("hidden");
    document.addEventListener("click", onOutsideClick, true);
  }

  trigger.addEventListener("click", () => (panel.classList.contains("hidden") ? openPanel() : closePanel()));

  const wrap = el("div", { class: "relative" }, [trigger, panel, native]);
  syncLabel();

  // Proxy .value / change-listening onto the hidden native select, so this
  // wrapper is a drop-in replacement wherever `select()` used to hand back
  // the raw <select> element.
  Object.defineProperty(wrap, "value", {
    get: () => native.value,
    set(v) {
      native.value = v;
      syncLabel();
    }
  });
  wrap.addEventListener = native.addEventListener.bind(native);
  wrap.removeEventListener = native.removeEventListener.bind(native);

  /** Swap the option list in place (e.g. a variety list that depends on a crop-type choice elsewhere). */
  wrap.setOptions = (newOptions) => {
    clear(native);
    for (const opt of newOptions) native.append(opt);
    native.selectedIndex = newOptions.length ? 0 : -1;
    syncLabel();
    if (!panel.classList.contains("hidden")) openPanel();
  };

  return wrap;
}

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
  const items = [{ key: "dashboard", icon: "summarize", label: "nav.dashboard", href: "/dashboard.html" }];
  // Certifier, inspector, oracle, and admin act on lots without ever holding
  // one — "My Inventory" would always be empty for them, so it isn't offered.
  if (roles.some((r) => CUSTODY_ROLES.includes(r))) {
    items.push({ key: "inventory", icon: "inventory_2", label: "nav.inventory", href: "/inventory.html" });
  }
  items.push({ key: "search", icon: "search", label: "nav.search", href: "/search.html" });
  if (roles.includes("farmer")) {
    items.push({ key: "register", icon: "agriculture", label: "dash.registerProduce", href: "/register.html" });
  }
  if (roles.includes("inspector")) {
    items.push({ key: "inspect", icon: "fact_check", label: "nav.inspect", href: "/inspect.html" });
  }
  if (roles.includes("certifier")) {
    items.push({ key: "certify", icon: "verified", label: "nav.certify", href: "/certify.html" });
  }
  if (roles.includes("oracle")) {
    items.push({ key: "telemetry", icon: "thermostat", label: "nav.telemetry", href: "/telemetry.html" });
  }
  if (roles.includes("admin")) {
    items.push({ key: "regulator", icon: "shield", label: "nav.regulator", href: "/regulator.html" });
  }
  items.push({ key: "notifications", icon: "notifications", label: "nav.notifications", href: "/notifications.html" });
  items.push({ key: "trace", icon: "qr_code_2", label: "nav.trace", href: "/trace.html" });
  return items;
}

export function logoMark(size = 32) {
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
<a href="/dashboard.html" class="flex items-center gap-2.5 px-6 py-6 relative hover:opacity-90 transition-opacity">
  ${logoMark(32)}
  <span class="font-serif-display text-[22px] tracking-tight text-gold-soft" data-i18n="brand"></span>
</a>
<nav class="flex-1 px-3 py-2 flex flex-col gap-1 relative overflow-y-auto">${links}</nav>
<div class="px-3 pb-4 pt-3 relative">
  <div class="h-px bg-white/10 mb-3"></div>
  <div class="flex items-center gap-3 px-3.5 py-2 mb-1">
    <div class="h-8 w-8 rounded-full bg-gold-soft/15 border border-gold-soft/30 text-gold-soft flex items-center justify-center font-serif-display text-sm shrink-0">${initials(participant.name)}</div>
    <div class="leading-tight min-w-0 flex-1">
      <p class="font-body-sm text-body-sm text-gold-soft truncate">${participant.name}</p>
      <p class="font-label-sm text-[10px] tracking-widest uppercase text-gold-soft/50 truncate">${(participant.roles ?? []).join(", ")}</p>
    </div>
    <button id="edit-contact-btn" type="button" class="shrink-0 p-1.5 rounded-lg text-gold-soft/50 hover:text-gold-soft hover:bg-white/5 transition-all" aria-label="${t("contact.edit")}">
      ${icon("edit", { size: 15 })}
    </button>
  </div>
  <button class="sign-out-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-gold-soft/50 hover:bg-error/10 hover:text-[#e2a396] transition-all" type="button">
    ${icon("logout", { size: 20 })}
    <span class="font-body-md text-body-sm" data-i18n="nav.logout"></span>
  </button>
</div>`;
  }

  if (topbar) {
    topbar.innerHTML = `
<div class="min-w-0">
  <h1 class="font-serif-display text-[20px] sm:text-[26px] leading-none text-on-surface truncate" ${titleKey ? `data-i18n="${titleKey}"` : ""}>${titleKey ? "" : (title ?? "")}</h1>
  <p class="hidden sm:block font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/70 mt-1" id="chain-state"></p>
</div>
<div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
  <button id="lang-toggle" type="button" class="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-full border border-outline-variant/60 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary font-body-sm text-body-sm">
    ${icon("translate", { size: 18 })}<span class="hidden sm:inline" data-lang-label></span>
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
  <button class="sign-out-btn md:hidden p-2.5 rounded-full hover:bg-error/10 transition-all text-on-surface-variant hover:text-error" type="button" aria-label="${t("nav.logout")}">
    ${icon("logout", { size: 20 })}
  </button>
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
  document.querySelectorAll(".sign-out-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      session.clear();
      location.href = "/index.html";
    })
  );

  // Dynamic import, not a static one: contact.js imports back from this
  // module, and a static cycle here would leave one side's exports
  // undefined depending on which file the page happens to load first.
  $("#edit-contact-btn")?.addEventListener("click", async () => {
    const { openEditContact } = await import("./contact.js");
    openEditContact(participant, (result) => {
      session.set({ ...participant, email: result.email, phone: result.phone });
    });
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
    target.className = `${health.ok ? "hidden sm:block" : "block"} font-label-sm text-[11px] tracking-widest uppercase mt-1 ${health.ok ? "text-on-surface-variant/70" : "text-error"}`;
  } catch {
    target.textContent = t("chain.offline");
    target.className = "block font-label-sm text-[11px] tracking-widest uppercase mt-1 text-error";
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
