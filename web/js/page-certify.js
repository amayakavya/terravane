import { api, CERT_SCHEMES } from "./api.js";
import { add, button, card, cardHeader, clear, el, field, input, isClosed, mount, notice, page, renderShell, select, t } from "./ui.js";
import { lotTable } from "./lot-table.js";

// The certifier's working surface: certification never requires holding the
// lot, so there is no handover to wait for — just a queue of what still needs
// a scheme attached, and a form to attach one to any lot by ID.

// The chain only knows an expiry timestamp; the operator thinks in a calendar date.
function isoDatePlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysUntil(isoDate) {
  if (!isoDate) return 0;
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target - today) / 86400000));
}

const main = document.getElementById("main");
let me = null;

async function start() {
  me = await renderShell({ active: "certify", title: t("cert.title") });
  if (!me) return;

  if (!(me.roles ?? []).includes("certifier")) {
    mount(main, notice(t("act.noPermission"), "bad"));
    return;
  }

  await page(main, async () => {
    const all = await api.batches({ limit: 200 });
    // activeCertifications includes farm-level certification inherited by every lot that
    // farm grows, so it can't tell us whether this specific lot was ever certified — only
    // the lot's own certification count can.
    const uncertified = all.filter((b) => !b.recalled && !isClosed(b) && b.counts.certifications === 0).slice(0, 12);

    mount(main,
      el("div", { class: "mb-6 max-w-2xl" }, [
        el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("cert.title") }),
        el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("cert.subtitle") })
      ]),
      el("div", { class: "grid gap-6 xl:grid-cols-[1fr_380px] items-start" }, [
        card([cardHeader(t("cert.viewUncertified")), lotTable(uncertified, { onEmpty: t("common.none"), dense: true })], "rise-in"),
        certifyForm()
      ])
    );
  });
}

function certifyForm() {
  const id = input({ type: "number", min: "1", placeholder: t("inspect.produceIdPlaceholder") });
  const schemeChoice = select({}, [
    ...CERT_SCHEMES.map((name) => el("option", { value: name, text: name })),
    el("option", { value: "custom", text: t("act.schemeCustom") })
  ]);
  const schemeCustom = input({ placeholder: t("act.scheme") });
  const schemeCustomField = field(t("act.scheme"), schemeCustom);
  schemeCustomField.style.display = "none";
  schemeChoice.addEventListener("change", () => {
    schemeCustomField.style.display = schemeChoice.value === "custom" ? "" : "none";
  });
  const expiryDate = input({ type: "date", min: isoDatePlusDays(0), value: isoDatePlusDays(365) });
  const result = el("div", { class: "mt-4" });
  const submit = button(t("act.submit"), { tone: "primary" });

  // Certificate validity is the certifier's own call, not the produce's shelf
  // life — but the registered expiry is the one date already on record, so
  // default to it when the lot has one. Stops overwriting once the certifier
  // has touched the field themselves.
  let expiryTouched = false;
  expiryDate.addEventListener("input", () => { expiryTouched = true; });
  id.addEventListener("change", async () => {
    const lot = Number(id.value);
    if (!lot || expiryTouched) return;
    try {
      const dossier = await api.batch(lot);
      const registered = dossier?.attributes?.attributes?.expiresAt;
      if (registered) expiryDate.value = registered;
    } catch {
      // unknown lot id — leave the default in place
    }
  });

  submit.addEventListener("click", async () => {
    const lot = Number(id.value);
    const scheme = schemeChoice.value === "custom" ? schemeCustom.value : schemeChoice.value;
    if (!lot || !scheme) {
      mount(result, notice(t("inspect.produceIdPlaceholder"), "bad"));
      return;
    }
    submit.disabled = true;
    clear(result);
    try {
      const receipt = await api.certify(lot, {
        as: me.address,
        scheme,
        expiresInDays: daysUntil(expiryDate.value)
      });
      mount(result,
        notice(`${t("cert.success")}\n${t("act.committed", { block: receipt.block, gas: Number(receipt.gasUsed).toLocaleString() })}`, "good"),
        el("a", { href: `/lot.html?id=${lot}`, class: "inline-block mt-3 font-body-sm text-body-sm text-primary hover:underline", text: t("search.viewProduce") })
      );
    } catch (err) {
      mount(result, notice(err.message, "bad"));
    } finally {
      submit.disabled = false;
    }
  });

  return card([
    cardHeader(t("cert.certifyProduce")),
    el("div", { class: "px-6 py-5 grid gap-4" }, [
      field(t("detail.refId"), id),
      field(t("act.scheme"), schemeChoice),
      schemeCustomField,
      field(t("act.expiryDate"), expiryDate),
      submit,
      result
    ])
  ], "rise-in");
}

start();
