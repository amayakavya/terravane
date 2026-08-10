import { clear, el, get, qty, when } from "./api.js";

// The label is the only part of this system that leaves the network and gets
// stuck to a crate, so it prints on white regardless of the screen theme and
// carries nothing that needs a connection to interpret: lot number, origin,
// harvest date, and the code that leads back to the full record.

const root = document.getElementById("root");
const id = new URLSearchParams(location.search).get("id");

document.getElementById("print").addEventListener("click", () => window.print());

function field(label, value) {
  return el("div", { class: "label-field" }, [
    el("div", { class: "label-key", text: label }),
    el("div", { class: "label-value", text: value })
  ]);
}

async function main() {
  if (!id) {
    clear(root).append(el("div", { class: "empty", text: "No lot given. Open this page as /label.html?id=5" }));
    return;
  }

  let data;
  try {
    data = await get(`/api/batches/${id}`);
  } catch (err) {
    clear(root).append(el("div", { class: "empty", text: `Could not load lot ${id}: ${err.message}` }));
    return;
  }

  const b = data.batch;
  const certs = [...data.certifications, ...data.farmCertifications].filter((c) => c.active);
  const traceUrl = `${location.origin}/trace.html?id=${b.id}`;

  const qr = el("div", { class: "label-qr" });
  fetch(`/api/qr/${b.id}`)
    .then((r) => r.text())
    .then((svg) => {
      qr.innerHTML = svg;
    });

  clear(root).append(
    el("div", { class: "label" }, [
      el("div", { class: "label-head" }, [
        el("div", {}, [
          el("div", { class: "label-brand", text: "TERRAVANE" }),
          el("div", { class: "label-produce", text: b.produceType }),
          el("div", { class: "label-variety", text: b.variety || "" })
        ]),
        el("div", { class: "label-lot", text: `LOT ${String(b.id).padStart(6, "0")}` })
      ]),

      el("div", { class: "label-body" }, [
        el("div", { class: "label-fields" }, [
          field("Grown by", b.origin.farm?.name ?? "unknown"),
          field("Origin", b.origin.location || "not recorded"),
          field("Harvested", when(b.harvestedAt)),
          field("Net quantity", qty(b.quantity, b.unit)),
          field("Certifications", certs.length ? certs.map((c) => c.scheme).join(", ") : "none in force"),
          b.coldChainRequired ? field("Keep between", `${b.tempWindow[0]} and ${b.tempWindow[1]} degrees C`) : null
        ]),
        el("div", { class: "label-code" }, [qr, el("div", { class: "label-scan", text: "Scan to trace this lot" })])
      ]),

      el("div", { class: "label-foot" }, [
        el("span", { text: traceUrl }),
        el("span", { text: `Recorded on chain, lot ${b.id}` })
      ])
    ])
  );
}

main();
