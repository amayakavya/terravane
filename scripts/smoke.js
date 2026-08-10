// End-to-end check against a freshly seeded stack: the API, the indexer and the
// contracts together. Run after `npm run deploy && npm run seed && npm run server`.
// Asserts on the fixed lot numbers the seed produces, so a drift in the seed
// narrative shows up here rather than silently.
import { contracts, provider, readDeployment } from "./lib/chain.js";

const BASE = process.env.TERRAVANE_URL ?? "http://127.0.0.1:4300";

const RICE = 1;
const MANGO = 5;
const TEA_ROOT = 6;
const TEA_DESCENDANTS = [7, 8, 9, 10];
const TOMATO = 14;

let checks = 0;
const failures = [];

function check(label, condition, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
    failures.push(label);
  }
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
}

async function post(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function main() {
  console.log(`smoke against ${BASE}\n`);

  console.log("health and coverage");
  const health = (await api("/api/health")).body;
  check("chain reachable", health.chainError === null, health.chainError ?? "");
  check("indexer reports ready", health.ready === true);
  check("index has caught up with the chain head", health.indexedBlock === health.chainHead, `${health.indexedBlock} vs ${health.chainHead}`);
  if (!health.ready) {
    console.error("\nindexer never became ready; nothing downstream is worth asserting");
    process.exit(1);
  }

  // Every log the chain emitted must be in the index. This is the check that
  // catches a backfill starting from the wrong block.
  const deployment = readDeployment();
  const prov = provider();
  const logs = await prov.getLogs({
    fromBlock: 0,
    toBlock: await prov.getBlockNumber(),
    address: [deployment.accessRegistry, deployment.produceRegistry]
  });
  const stats = (await api("/api/stats")).body;
  check("every chain log is indexed", stats.events === logs.length, `indexed ${stats.events}, chain ${logs.length}`);

  console.log("\nseeded state");
  // The suite writes lots of its own, so it counts from where it finds the ledger
  // rather than demanding a pristine chain. Everything below this is exact.
  check("the fourteen seeded lots are present", stats.batches >= 14, String(stats.batches));
  check("five lots recalled", stats.recalled === 5, String(stats.recalled));
  check("one cold chain breach", stats.breached === 1, String(stats.breached));
  check("one handover still in flight", stats.openHandovers === 1, String(stats.openHandovers));
  check("thirteen participants enrolled", stats.participants === 13, String(stats.participants));

  console.log("\nconsumer verdicts");
  const mango = (await api(`/api/trace/${MANGO}`)).body;
  check("mango reads as caution", mango.verdict === "caution", mango.verdict);
  check("mango names the cold chain break", mango.warnings?.some((w) => /cold chain/i.test(w.text)) === true);
  check("mango carries its certifications", mango.certifications.length > 0);
  check("mango telemetry has an excursion", mango.telemetry?.some((t) => t.excursion) === true);

  const tea = (await api(`/api/trace/${TEA_DESCENDANTS[2]}`)).body;
  check("recalled tea child reads as unsafe", tea.verdict === "unsafe", tea.verdict);
  check("recall reason is carried down the lineage", /residue/i.test(tea.recall?.reason ?? ""));

  const rice = (await api(`/api/trace/${RICE}`)).body;
  check("rice trace resolves", rice.id === RICE);

  console.log("\nlineage and recall reach");
  const descendants = (await api(`/api/batches/${TEA_ROOT}/descendants`)).body;
  check("recall reach matches the seeded tree", JSON.stringify(descendants.descendants) === JSON.stringify(TEA_DESCENDANTS), JSON.stringify(descendants.descendants));
  const lineage = (await api(`/api/batches/${TEA_DESCENDANTS[2]}/lineage`)).body;
  check("lineage graph spans the whole tea tree", lineage.nodes.length === 5, String(lineage.nodes.length));
  check("every node in the tea tree is recalled", lineage.nodes.every((n) => n.recalled));

  console.log("\ncommitted attributes");
  const mangoLot = (await api(`/api/batches/${MANGO}`)).body;
  check("seeded lot carries an attribute document", mangoLot.attributes?.present === true, JSON.stringify(mangoLot.attributes?.reason));
  check("attributes match the hash on chain", mangoLot.attributes?.verified === true, mangoLot.attributes?.reason ?? "");
  check("attributes carry a price", Number(mangoLot.attributes?.attributes?.pricePerUnit) > 0);

  const stored = await post("/api/documents", { grade: "A", note: "smoke document" });
  check("document store returns a content address", /^0x[0-9a-f]{64}$/.test(stored.body.hash ?? ""), JSON.stringify(stored.body));
  const fetched = (await api(`/api/documents/${stored.body.hash}`)).body;
  check("document reads back and verifies", fetched.verified === true && fetched.body.note === "smoke document");
  check("storing the same document is idempotent", (await post("/api/documents", { note: "smoke document", grade: "A" })).body.hash === stored.body.hash);
  check("unknown document is a 404", (await api("/api/documents/0x" + "0".repeat(64))).status === 404);

  console.log("\nnotifications");
  const farmer = (await api("/api/participants")).body.find((p) => p.roles.includes("farmer"));
  const feed = (await api(`/api/notifications?as=${farmer.address}`)).body;
  check("participant has a notification feed", Array.isArray(feed) && feed.length > 0, String(feed.length));
  check("recalls reach everyone", feed.some((n) => n.name.startsWith("Recall")));
  check("feed marks a participant's own actions", feed.some((n) => n.mine === true));
  check("notifications need an address", (await api("/api/notifications")).status === 400);

  console.log("\nsurfaces");
  check("qr renders as svg", (await api(`/api/qr/${RICE}`)).body.startsWith("<svg"));
  for (const path of ["/", "/dashboard.html", "/inventory.html", "/search.html", "/lot.html", "/register.html", "/inspect.html", "/notifications.html", "/trace.html?id=1", "/label.html?id=1"]) {
    check(`page served: ${path}`, (await api(path)).status === 200);
  }
  check("compiled stylesheet served", (await api("/css/app.css")).body.includes("@font-face"));
  check("webfont served locally", (await api("/fonts/manrope-400-latin.woff2")).status === 200);
  check("unknown api route answers json", (await api("/api/nope")).status === 404);
  check("unknown lot answers 404", (await api("/api/batches/9999")).status === 404);

  console.log("\nwrite path");
  const expectedId = stats.batches + 1;
  const created = await post("/api/actions/batches", {
    as: "Sundar Farms",
    produceType: "Okra",
    variety: "Pusa Sawani",
    quantity: 250,
    unit: "kg"
  });
  check("harvest recorded", created.status === 200 && created.body.batchId === expectedId, JSON.stringify(created.body));

  const newId = created.body.batchId;
  const moved = await post(`/api/actions/batches/${newId}/transfer`, { as: "Sundar Farms", to: "Coldline Logistics", note: "smoke" });
  check("handover proposed", moved.status === 200, JSON.stringify(moved.body));
  const accepted = await post(`/api/actions/batches/${newId}/accept`, { as: "Coldline Logistics" });
  check("handover accepted", accepted.status === 200, JSON.stringify(accepted.body));

  const dossier = (await api(`/api/batches/${newId}`)).body;
  check("custody moved in the index", dossier.batch.custodian.name === "Coldline Logistics", dossier.batch.custodian?.name);

  console.log("\nrefusals");
  const wrongRole = await post(`/api/actions/batches/${newId}/stage`, { as: "Coldline Logistics", stage: 1 });
  check("processing by a distributor is refused", wrongRole.status === 400 && wrongRole.body.error === "NotAuthorised", JSON.stringify(wrongRole.body));
  const notHolder = await post(`/api/actions/batches/${newId}/transfer`, { as: "MetroMart", to: "Fresh Bazaar" });
  check("transfer by a non custodian is refused", notHolder.status === 400 && notHolder.body.error === "NotCustodian", JSON.stringify(notHolder.body));
  const openHandover = (await api(`/api/batches/${TOMATO}`)).body;
  check("unsettled handover shows as a custody gap", openHandover.batch.custodyIntact === false);

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) {
    console.error(`\nfailed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nsmoke failed: ${err.message}`);
  process.exit(1);
});
