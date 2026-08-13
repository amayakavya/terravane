import { api } from "./api.js";
import { add, button, card, cardHeader, clear, el, field, icon, input, mount, notice, page, renderShell, select, t } from "./ui.js";

// Registering a harvest writes two things: the lot itself on chain, and the
// commercial attributes into the document store, with the lot committing to the
// hash of those attributes. Price and grade are therefore off chain but not
// deniable: restating them later breaks the hash.

const main = document.getElementById("main");
let me = null;

async function start() {
  me = await renderShell({ active: "register", title: t("regp.title") });
  if (!me) return;

  if (!(me.roles ?? []).includes("farmer")) {
    mount(main, notice(t("act.noPermission"), "bad"));
    return;
  }

  await page(main, async () => render());
}

function render() {
  const f = {
    produceType: input({ name: "produceType", placeholder: t("regp.cropTypePlaceholder"), required: "required" }),
    variety: input({ name: "variety" }),
    quantity: input({ name: "quantity", type: "number", min: "1", value: "1000" }),
    unit: input({ name: "unit", value: "kg" }),
    pricePerUnit: input({ name: "pricePerUnit", type: "number", step: "0.01" }),
    currency: input({ name: "currency", value: "INR" }),
    grade: select({ name: "grade" }, ["A", "B", "C"].map((g) => el("option", { value: g, text: g }))),
    storage: input({ name: "storage", placeholder: t("regp.storagePlaceholder") }),
    harvestDate: input({ name: "harvestDate", type: "date" }),
    expiresAt: input({ name: "expiresAt", type: "date" }),
    organic: select({ name: "organic" }, [
      el("option", { value: "false", text: t("common.none") }),
      el("option", { value: "true", text: t("regp.organic") })
    ]),
    minTempC: input({ name: "minTempC", type: "number", step: "0.1" }),
    maxTempC: input({ name: "maxTempC", type: "number", step: "0.1" })
  };

  const result = el("div", { class: "mt-5" });
  const submit = button(t("regp.submit"), { tone: "primary" });

  submit.addEventListener("click", async () => {
    if (!f.produceType.value.trim()) {
      mount(result, notice(t("regp.cropTypePlaceholder"), "bad"));
      return;
    }

    const cold = f.minTempC.value !== "" && f.maxTempC.value !== "";
    const body = {
      as: me.address,
      produceType: f.produceType.value.trim(),
      variety: f.variety.value.trim(),
      quantity: Number(f.quantity.value),
      unit: f.unit.value.trim() || "kg",
      harvestedAt: f.harvestDate.value ? Math.floor(new Date(f.harvestDate.value).getTime() / 1000) : 0,
      coldChainRequired: cold,
      minTempC: cold ? Number(f.minTempC.value) : 0,
      maxTempC: cold ? Number(f.maxTempC.value) : 0,
      attributes: {
        pricePerUnit: f.pricePerUnit.value === "" ? null : Number(f.pricePerUnit.value),
        currency: f.currency.value.trim() || null,
        grade: f.grade.value,
        storage: f.storage.value.trim() || null,
        expiresAt: f.expiresAt.value || null,
        organic: f.organic.value === "true"
      }
    };

    submit.disabled = true;
    clear(result);
    try {
      const receipt = await api.create(body);
      mount(result, success(receipt));
    } catch (err) {
      mount(result, notice(err.message, "bad"));
    } finally {
      submit.disabled = false;
    }
  });

  mount(main, 
    el("div", { class: "max-w-3xl" }, [
      el("div", { class: "mb-6" }, [
        el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("regp.title") }),
        el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("regp.subtitle") })
      ]),
      card([
        cardHeader(t("regp.title")),
        el("div", { class: "px-6 py-6 grid gap-5 sm:grid-cols-2" }, [
          field(t("regp.cropType"), f.produceType),
          field(t("table.crop"), f.variety),
          field(t("regp.quantity"), f.quantity),
          field(t("regp.unit"), f.unit),
          field(t("regp.price"), f.pricePerUnit),
          field(t("regp.currency"), f.currency),
          field(t("regp.quality"), f.grade),
          field(t("regp.storage"), f.storage),
          field(t("regp.harvestDate"), f.harvestDate),
          field(t("regp.expiryDate"), f.expiresAt),
          field(t("regp.organic"), f.organic),
          el("div"),
          field(`${t("act.tempC")} min`, f.minTempC),
          field(`${t("act.tempC")} max`, f.maxTempC)
        ]),
        el("div", { class: "px-6 pb-6" }, [
          notice(t("lot.attributesVerified")),
          el("div", { class: "mt-5" }, submit),
          result
        ])
      ], "rise-in")
    ])
  );
}

function success(receipt) {
  return el("div", { class: "rounded-xl border border-primary/40 bg-primary/5 px-5 py-5" }, [
    el("div", { class: "flex items-center gap-2.5 mb-2 text-primary" }, [
      el("span", { html: icon("check_circle", { size: 20 }) }),
      el("p", { class: "font-body-md text-body-md font-medium", text: t("regp.success") })
    ]),
    el("p", { class: "font-body-sm text-body-sm text-on-surface-variant mb-3", text: t("regp.successDesc") }),
    el("p", { class: "font-label-md text-[13px] text-on-surface break-all mb-4", text: `${t("lot.title")} #${receipt.batchId} · ${receipt.metadataHash}` }),
    el("div", { class: "flex flex-wrap gap-2.5" }, [
      el("a", { href: `/lot.html?id=${receipt.batchId}`, class: "inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-4 py-2.5 font-body-sm text-body-sm", text: t("search.viewProduce") }),
      el("a", { href: `/label.html?id=${receipt.batchId}`, target: "_blank", rel: "noopener", class: "inline-flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2.5 font-body-sm text-body-sm text-on-surface hover:border-primary hover:text-primary", text: t("lot.printLabel") })
    ])
  ]);
}

start();
