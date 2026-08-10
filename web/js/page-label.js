import { api } from "./api.js";
import { I18n, add, clear, el, mount, notice, onDay, qty, t } from "./ui.js";

// The one artefact that leaves the network and gets stuck to a crate. It prints
// on white whatever the screen is doing, and carries nothing that needs a
// connection to interpret: lot number, origin, dates, and the code back to the
// full record.

const root = document.getElementById("root");
const lotId = new URLSearchParams(location.search).get("id");

document.getElementById("print")?.addEventListener("click", () => window.print());

async function main() {
  I18n.apply();

  if (!lotId) {
    mount(root, notice(t("inspect.produceIdPlaceholder"), "warn"));
    return;
  }

  let data;
  try {
    data = await api.batch(lotId);
  } catch (err) {
    mount(root, notice(`${t("search.notFound")}: ${err.message}`, "bad"));
    return;
  }

  const b = data.batch;
  const attrs = data.attributes?.attributes ?? {};
  const certs = [...data.certifications, ...data.farmCertifications].filter((c) => c.active);

  mount(root, 
    el("article", { class: "mx-auto w-full max-w-[150mm] bg-white text-[#141815] border border-[#c9cdc6] rounded print:border-0 print:rounded-none print:max-w-none" }, [
      el("header", { class: "flex items-start gap-4 px-6 py-5 border-b-2 border-[#141815]" }, [
        el("div", { class: "flex-1 min-w-0" }, [
          el("p", { class: "font-label-sm text-[10px] tracking-[0.24em] text-[#4a534b]", text: "TERRAVANE" }),
          el("p", { class: "font-serif-display text-[26px] leading-tight", text: b.produceType }),
          el("p", { class: "font-body-md text-body-sm text-[#4a534b]", text: b.variety || "" })
        ]),
        el("p", { class: "font-label-md text-[15px] tracking-wide border border-[#141815] rounded px-2.5 py-1.5 whitespace-nowrap", text: `LOT ${String(b.id).padStart(6, "0")}` })
      ]),

      el("div", { class: "flex gap-6 px-6 py-5" }, [
        el("dl", { class: "flex-1 grid gap-3 m-0" },
          [
            [t("label.grownBy"), b.origin.farm?.name ?? "-"],
            [t("search.location"), b.origin.location || "-"],
            [t("detail.harvestDate"), onDay(b.harvestedAt)],
            [t("label.netQuantity"), qty(b.quantity, b.unit)],
            attrs.expiresAt ? [t("detail.expiryDate"), attrs.expiresAt] : null,
            [t("lot.certifications"), certs.length ? certs.map((c) => c.scheme).join(", ") : t("common.none")],
            b.coldChainRequired ? [t("label.keepBetween"), `${b.tempWindow[0]} to ${b.tempWindow[1]} °C`] : null
          ]
            .filter(Boolean)
            .flatMap(([key, value]) => [
              el("dt", { class: "font-label-sm text-[9px] tracking-[0.14em] uppercase text-[#6b746c]", text: key }),
              el("dd", { class: "font-body-md text-body-sm m-0 -mt-2.5", text: value })
            ])
        ),
        el("div", { class: "text-center shrink-0" }, [
          el("div", { class: "w-[108px] h-[108px]", id: "qr" }),
          el("p", { class: "font-label-sm text-[9px] tracking-widest uppercase text-[#6b746c] mt-1.5", text: t("label.scanToTrace") })
        ])
      ]),

      el("footer", { class: "flex justify-between gap-4 px-6 py-2.5 border-t border-[#c9cdc6] font-label-sm text-[9px] text-[#6b746c] break-all" }, [
        el("span", { text: `${location.origin}/trace.html?id=${b.id}` }),
        el("span", { text: data.attributes?.verified ? t("lot.attributesVerified") : `${t("lot.title")} ${b.id}` })
      ])
    ])
  );

  fetch(`/api/qr/${b.id}`)
    .then((r) => r.text())
    .then((svg) => {
      const host = document.getElementById("qr");
      if (host) host.innerHTML = svg;
    });
}

main();
