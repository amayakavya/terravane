import { api } from "./api.js";
import { add, button, card, cardHeader, clear, el, field, input, isClosed, mount, notice, page, renderShell, t } from "./ui.js";
import { lotTable } from "./lot-table.js";

// The sensor gateway's working surface: a telemetry reading never requires
// holding the lot either — a reefer gateway reports on whatever it is strapped
// to, not on what it owns. Queue of lots in transit, plus a form by lot ID.

const main = document.getElementById("main");
let me = null;

async function start() {
  me = await renderShell({ active: "telemetry", title: t("tele.title") });
  if (!me) return;

  if (!(me.roles ?? []).includes("oracle")) {
    mount(main, notice(t("act.noPermission"), "bad"));
    return;
  }

  await page(main, async () => {
    const all = await api.batches({ limit: 200 });
    // The contract puts no stage restriction on telemetry — a gateway can report
    // a reading at any point a lot is physically moving, not only once it is
    // formally labelled "In transit". Cold-chain lots surface first since those
    // readings are the ones that actually matter.
    const active = all
      .filter((b) => !b.recalled && !isClosed(b))
      .sort((a, b) => Number(b.coldChainRequired) - Number(a.coldChainRequired))
      .slice(0, 12);

    mount(main,
      el("div", { class: "mb-6 max-w-2xl" }, [
        el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("tele.title") }),
        el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("tele.subtitle") })
      ]),
      el("div", { class: "grid gap-6 xl:grid-cols-[1fr_380px] items-start" }, [
        card([cardHeader(t("tele.viewActive")), lotTable(active, { onEmpty: t("common.none"), dense: true })], "rise-in"),
        telemetryForm()
      ])
    );
  });
}

function telemetryForm() {
  const id = input({ type: "number", min: "1", placeholder: t("inspect.produceIdPlaceholder") });
  const tempC = input({ type: "number", step: "0.1" });
  const humidityPct = input({ type: "number", step: "0.1" });
  const result = el("div", { class: "mt-4" });
  const submit = button(t("act.submit"), { tone: "primary" });

  submit.addEventListener("click", async () => {
    const lot = Number(id.value);
    if (!lot || tempC.value === "") {
      mount(result, notice(t("inspect.produceIdPlaceholder"), "bad"));
      return;
    }
    submit.disabled = true;
    clear(result);
    try {
      const receipt = await api.telemetry(lot, {
        as: me.address,
        tempC: Number(tempC.value),
        humidityPct: Number(humidityPct.value || 0)
      });
      mount(result,
        notice(`${t("tele.success")}\n${t("act.committed", { block: receipt.block, gas: Number(receipt.gasUsed).toLocaleString() })}`, "good"),
        el("a", { href: `/lot.html?id=${lot}`, class: "inline-block mt-3 font-body-sm text-body-sm text-primary hover:underline", text: t("search.viewProduce") })
      );
    } catch (err) {
      mount(result, notice(err.message, "bad"));
    } finally {
      submit.disabled = false;
    }
  });

  return card([
    cardHeader(t("tele.recordReading")),
    el("div", { class: "px-6 py-5 grid gap-4" }, [
      field(t("detail.refId"), id),
      field(t("act.tempC"), tempC),
      field(t("act.humidity"), humidityPct),
      submit,
      result
    ])
  ], "rise-in");
}

start();
