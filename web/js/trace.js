import { ago, clear, drawLineage, el, get, qty, temperatureChart, when } from "./api.js";
import { custodyStops, journeyMap, routeDistance } from "./map.js";

const root = document.getElementById("root");
const id = new URLSearchParams(location.search).get("id");

const VERDICT_COPY = {
  verified: "This lot's chain of custody is complete and nothing is outstanding against it.",
  caution: "This lot carries warnings. Read them before you buy.",
  unsafe: "Do not consume. This lot has been withdrawn."
};

async function main() {
  if (!id) {
    clear(root).append(searchBox());
    return;
  }

  let data;
  try {
    data = await get(`/api/trace/${id}`);
  } catch (err) {
    clear(root).append(el("div", { class: "panel" }, el("div", { class: "empty", text: `No record for lot ${id}: ${err.message}` })), searchBox());
    return;
  }

  const b = data.batch;
  clear(root);

  // ------------------------------------------------------------ verdict
  const hero = el("div", { class: `trace-hero ${data.verdict}` }, [
    el("div", { class: "band" }, [
      el("div", { style: "flex:1" }, [
        el("div", { class: "status", text: data.verdict === "verified" ? "verified" : data.verdict === "caution" ? "check the warnings" : "withdrawn" }),
        el("h1", { text: `${b.produceType}${b.variety ? ` · ${b.variety}` : ""}` }),
        el("div", { class: "dim", text: `Lot #${b.id} · ${qty(b.quantity, b.unit)} · ${b.stageName}` })
      ]),
      el("div", { class: "qr", id: "qr" })
    ]),
    data.warnings.length
      ? el("ul", { class: "warn-list" }, data.warnings.map((w) =>
          el("li", { class: w.level }, [el("span", { class: "lvl", text: w.level }), el("span", { text: w.text })])
        ))
      : el("div", { style: "padding:12px 20px;font-size:13px;color:var(--ink-dim)", text: VERDICT_COPY[data.verdict] })
  ]);
  root.append(hero);

  fetch(`/api/qr/${b.id}`)
    .then((r) => r.text())
    .then((svg) => {
      document.getElementById("qr").innerHTML = svg;
    });

  // ------------------------------------------------------------ provenance
  const dl = el("dl", { class: "kv" });
  const add = (k, v) => dl.append(el("dt", { text: k }), el("dd", {}, v));
  add("Grown by", b.origin.farm?.name ?? "unknown");
  add("Where", b.origin.location || "-");
  add("Harvested", `${when(b.harvestedAt)} · ${ago(b.harvestedAt)}`);
  add("Now held by", `${b.custodian?.name ?? "-"}${b.custodian?.location ? ` · ${b.custodian.location}` : ""}`);
  add("Custody hops", el("span", { class: "mono", text: String(b.counts.handovers) }));
  if (b.coldChainRequired) add("Cold chain", `${b.tempWindow[0]}°C to ${b.tempWindow[1]}°C · ${b.coldChainBreached ? "broken" : "held throughout"}`);

  root.append(el("section", { class: "panel" }, [el("h2", { text: "Provenance" }), el("div", { class: "panel-body" }, dl)]));

  // ------------------------------------------------------------ route
  const stops = custodyStops({ batch: b, handovers: data.journeyHandovers ?? [] });
  const readings = data.telemetry.filter((t) => t.position).map((t) => ({ ...t.position, excursion: t.excursion }));
  if (stops.length || readings.length) {
    const km = routeDistance(stops);
    root.append(
      el("section", { class: "panel" }, [
        el("h2", {}, ["Where it travelled", km > 1 ? el("span", { class: "count", text: `${Math.round(km).toLocaleString()} km` }) : null]),
        el("div", { class: "panel-body" }, [
          journeyMap(stops, readings, { height: 340 }),
          el("div", { class: "faint", style: "font-size:12px;margin-top:10px", text: "Each point was written to the ledger when the lot changed hands or a sensor reported in." })
        ])
      ])
    );
  }

  // ------------------------------------------------------------ certificates
  if (data.certifications.length) {
    root.append(
      el("section", { class: "panel" }, [
        el("h2", { text: "Certifications in force" }),
        el("div", { class: "panel-body" },
          el("div", { class: "cert-grid" }, data.certifications.map((c) =>
            el("div", { class: "cert" }, [
              el("div", { class: "scheme", text: c.scheme }),
              el("div", { class: "by", text: `${c.certifier?.name ?? "-"} · ${c.expiresAt ? `to ${when(c.expiresAt)}` : "no expiry"}` })
            ])
          ))
        )
      ])
    );
  }

  // ------------------------------------------------------------ journey
  root.append(
    el("section", { class: "panel" }, [
      el("h2", {}, ["Journey", el("span", { class: "count", text: `${data.journey.length} steps` })]),
      el("div", { class: "panel-body" },
        el("ul", { class: "timeline" }, data.journey.map((step) =>
          el("li", { class: step.label.startsWith("Inspection failed") ? "bad" : "" }, [
            el("div", { class: "when", text: `${when(step.at)} · ${ago(step.at)}` }),
            el("div", { class: "what", text: step.label }),
            el("div", { class: "who", text: [step.actor, step.place].filter(Boolean).join(" · ") })
          ])
        ))
      )
    ])
  );

  // ------------------------------------------------------------ cold chain
  if (data.telemetry.length) {
    root.append(
      el("section", { class: "panel" }, [
        el("h2", {}, ["Temperature record", el("span", { class: "count", text: `${data.telemetry.length} readings` })]),
        el("div", { class: "panel-body" }, [
          temperatureChart(data.telemetry, b.coldChainRequired ? b.tempWindow : null),
          el("div", { class: "faint", style: "font-size:12px;margin-top:10px", text: "Each reading was written to the ledger by the sensor gateway or the party holding the lot at the time. Red points sit outside the permitted band." })
        ])
      ])
    );
  }

  // ------------------------------------------------------------ lineage
  if (data.lineage.nodes.length > 1) {
    root.append(
      el("section", { class: "panel" }, [
        el("h2", { text: "How this lot was made up" }),
        el("div", { class: "panel-body" }, [
          drawLineage(data.lineage, (nodeId) => {
            location.search = `?id=${nodeId}`;
          }),
          el("div", { class: "faint", style: "font-size:12px;margin-top:10px", text: "Lots split and merge as they move. Every parent and child is on the same ledger." })
        ])
      ])
    );
  }

  root.append(
    el("div", { class: "faint", style: "font-size:12px;text-align:center;margin-top:24px" },
      `Lot #${b.id} · record read from chain, not from a database. `
    ),
    el("div", { style: "text-align:center;margin-top:10px" }, searchBox())
  );
}

function searchBox() {
  const input = el("input", { type: "number", placeholder: "Lot number", style: "width:140px" });
  const go = el("button", { class: "primary", text: "Trace" });
  go.addEventListener("click", () => {
    if (input.value) location.search = `?id=${input.value}`;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value) location.search = `?id=${input.value}`;
  });
  return el("div", { style: "display:flex;gap:8px;justify-content:center" }, [input, go]);
}

main();
