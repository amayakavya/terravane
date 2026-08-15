import { api } from "./api.js";
import { add, button, card, cardHeader, clear, el, field, input, isClosed, mount, notice, page, renderShell, select, t } from "./ui.js";
import { lotTable } from "./lot-table.js";

// The inspector's working surface: what is worth looking at, and the form to
// record a verdict against a lot without hunting for it first.

const main = document.getElementById("main");
let me = null;

async function start() {
  me = await renderShell({ active: "inspect", title: t("inspect.title") });
  if (!me) return;

  if (!(me.roles ?? []).includes("inspector")) {
    mount(main, notice(t("act.noPermission"), "bad"));
    return;
  }

  await page(main, async () => {
    const [breached, open, all] = await Promise.all([
      api.batches({ flag: "breached", limit: 50 }),
      api.batches({ flag: "open", limit: 50 }),
      api.batches({ limit: 200 })
    ]);

    const seen = new Set();
    const queue = [...breached, ...open].filter((b) => !isClosed(b) && (seen.has(b.id) ? false : seen.add(b.id)));
    const uninspected = all.filter((b) => !b.recalled && !isClosed(b) && b.counts.inspections === 0).slice(0, 12);

    mount(main, 
      el("div", { class: "mb-6 max-w-2xl" }, [
        el("h2", { class: "font-serif-display text-[26px] text-on-surface mb-1", text: t("inspect.title") }),
        el("p", { class: "font-body-md text-body-md text-on-surface-variant", text: t("insp.subtitle") })
      ]),
      el("div", { class: "grid gap-6 xl:grid-cols-[1fr_380px] items-start" }, [
        el("div", { class: "grid gap-6" }, [
          card([cardHeader(t("insp.viewFlagged")), lotTable(queue, { onEmpty: t("common.none"), dense: true })], "rise-in"),
          card([cardHeader(t("insp.awaiting")), lotTable(uninspected, { onEmpty: t("common.none"), dense: true })], "rise-in-delay")
        ]),
        inspectForm()
      ])
    );
  });
}

function inspectForm() {
  const id = input({ type: "number", min: "1", placeholder: t("inspect.produceIdPlaceholder") });
  const grade = input({ type: "number", min: "0", max: "100", value: "80" });
  const passed = select({}, [
    el("option", { value: "true", text: t("inspect.submitPass") }),
    el("option", { value: "false", text: t("inspect.submitFail") })
  ]);
  const findings = input({ placeholder: t("inspect.conditionPlaceholder") });
  const result = el("div", { class: "mt-4" });
  const submit = button(t("act.submit"), { tone: "primary" });

  submit.addEventListener("click", async () => {
    const lot = Number(id.value);
    if (!lot) {
      mount(result, notice(t("inspect.produceIdPlaceholder"), "bad"));
      return;
    }
    submit.disabled = true;
    clear(result);
    try {
      const receipt = await api.inspect(lot, {
        as: me.address,
        grade: Number(grade.value),
        passed: passed.value === "true",
        findings: findings.value
      });
      mount(result, 
        notice(`${t("inspect.success")}\n${t("act.committed", { block: receipt.block, gas: Number(receipt.gasUsed).toLocaleString() })}`, "good"),
        el("a", { href: `/lot.html?id=${lot}`, class: "inline-block mt-3 font-body-sm text-body-sm text-primary hover:underline", text: t("search.viewProduce") })
      );
    } catch (err) {
      mount(result, notice(err.message, "bad"));
    } finally {
      submit.disabled = false;
    }
  });

  return card([
    cardHeader(t("insp.inspectProduce")),
    el("div", { class: "px-6 py-5 grid gap-4" }, [
      field(t("detail.refId"), id),
      field(t("act.grade"), grade),
      field(t("act.passed"), passed),
      field(t("act.findings"), findings),
      submit,
      result
    ])
  ], "rise-in");
}

start();
