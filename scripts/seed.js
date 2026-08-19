// Drives a full season of trade through the deployed contracts so the dashboard
// and the consumer trace pages have something real to read. Idempotent it is not:
// each run appends another season.
import { ethers } from "ethers";
import { contracts, provider, readDeployment, wallet } from "./lib/chain.js";
import { encodeGeohash } from "./lib/geohash.js";
import { openDatabase } from "../server/db.js";
import { DocumentStore } from "../server/documents.js";

const deployment = readDeployment();
const prov = provider();
const db = openDatabase();
const documents = new DocumentStore(db);

const byName = new Map(deployment.participants.map((p) => [p.name, p]));

function actor(name) {
  const p = byName.get(name);
  if (!p) throw new Error(`unknown participant: ${name}`);
  const signer = wallet(p.index, prov);
  return { ...p, signer, ...contracts(signer, deployment) };
}

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const daysAgo = (d) => now - d * DAY;
const hash = (s) => ethers.id(s);

let txCount = 0;
async function send(label, promise) {
  const tx = await promise;
  await tx.wait();
  txCount++;
  if (process.env.TERRAVANE_QUIET !== "1") console.log(`  ${label}`);
  return tx;
}

/// Commercial attributes go into the document store and the lot commits to their
/// hash, which is the same path the register form takes in the interface.
async function newBatch(farm, input, attributes = null) {
  let payload = input;
  if (attributes) {
    const stored = documents.put({
      ...attributes,
      produceType: input.produceType,
      variety: input.variety,
      registeredBy: farm.address,
      registeredAt: new Date().toISOString()
    });
    payload = { ...input, metadataHash: stored.hash, metadataURI: stored.uri };
  }
  await send(`harvest  ${payload.produceType} / ${payload.variety}  ${payload.quantity} ${payload.unit}`, farm.registry.createBatch(payload));
  return Number(await farm.registry.batchCount());
}

function lot(overrides) {
  return {
    produceType: "Rice",
    variety: "",
    quantity: 1000n,
    unit: "kg",
    harvestedAt: BigInt(daysAgo(30)),
    originGeohash: "",
    originLocation: "",
    metadataHash: ethers.ZeroHash,
    metadataURI: "",
    coldChainRequired: false,
    minTempDeciC: 0,
    maxTempDeciC: 0,
    ...overrides
  };
}

/** Move a lot from its holder to `to` and settle it in one step. */
async function handover(from, to, batchId, note, geo) {
  await send(`handover #${batchId}  ${from.name} -> ${to.name}`, from.registry.proposeTransfer(batchId, to.address, geo, note, hash(note)));
  await send(`accept   #${batchId}  ${to.name}`, to.registry.acceptTransfer(batchId, geo));
}

const STAGE = { Harvested: 0, Processed: 1, Packed: 2, InTransit: 3, AtRetail: 4 };

async function main() {
  const sundar = actor("Sundar Farms");
  const nilgiri = actor("Nilgiri Highland Estates");
  const konkan = actor("Konkan Mango Co-operative");
  const anand = actor("Anand Growers Collective");
  const mill = actor("Ganga Rice Mills");
  const coldline = actor("Coldline Logistics");
  const deccan = actor("Deccan Freight");
  const bazaar = actor("Fresh Bazaar");
  const metro = actor("MetroMart");
  const board = actor("India Organic Board");
  const fssai = actor("FSSAI Field Office");
  const sensors = actor("SensorNet Gateway");

  console.log("\n-- farm-level certification");
  await send("certify  Sundar Farms / NPOP Organic", board.registry.certifyFarm(sundar.address, "NPOP Organic", BigInt(now + 300 * DAY), "ipfs://certs/npop-sundar", hash("npop-sundar")));
  await send("certify  Konkan Co-op / GlobalGAP", board.registry.certifyFarm(konkan.address, "GlobalGAP", BigInt(now + 200 * DAY), "ipfs://certs/gg-konkan", hash("gg-konkan")));

  // ------------------------------------------------------------------
  // Thread 1: basmati from Karnal, milled, split, retailed
  // ------------------------------------------------------------------
  console.log("\n-- thread 1: basmati rice");
  const rice = await newBatch(
    sundar,
    lot({
      produceType: "Rice",
      variety: "Basmati 1121",
      quantity: 12000n,
      unit: "kg",
      harvestedAt: BigInt(daysAgo(48)),
      originGeohash: sundar.geohash,
      originLocation: sundar.location,
      metadataURI: "ipfs://agronomy/sundar-basmati-2026",
      metadataHash: hash("sundar-basmati-2026")
    }),
    { pricePerUnit: 62, currency: "INR", grade: "A", organic: true, storage: "Dry, sealed, below 14% moisture", expiresAt: "2027-02-15" }
  );
  await send(`certify  #${rice} India Organic`, board.registry.certifyBatch(rice, "India Organic", BigInt(now + 180 * DAY), "ipfs://certs/io-1", hash("io-1")));
  await send(`inspect  #${rice} grade 94 pass`, fssai.registry.recordInspection(rice, 94, true, "Moisture 12.1%, no broken grain excess", hash("insp-rice-1")));

  await handover(sundar, mill, rice, "Truck HR55 AB 1123, 12t", sundar.geohash);
  await send(`stage    #${rice} -> Processed`, mill.registry.advanceStage(rice, STAGE.Processed));
  await send(`stage    #${rice} -> Packed`, mill.registry.advanceStage(rice, STAGE.Packed));

  await send(`split    #${rice} into 3 lots`, mill.registry.splitBatch(rice, [5000n, 4000n, 3000n]));
  const riceLots = (await mill.registry.getChildren(rice)).map(Number);
  console.log(`  lots     ${riceLots.join(", ")}`);

  await handover(mill, coldline, riceLots[0], "Consignment CL-8841", mill.geohash);
  await send(`stage    #${riceLots[0]} -> In transit`, coldline.registry.advanceStage(riceLots[0], STAGE.InTransit));
  await handover(coldline, bazaar, riceLots[0], "Delivery note FB-2201", encodeGeohash(12.9716, 77.5946, 7));
  await send(`stage    #${riceLots[0]} -> At retail`, bazaar.registry.advanceStage(riceLots[0], STAGE.AtRetail));
  await send(`sale     #${riceLots[0]} 1200 kg`, bazaar.registry.recordSale(riceLots[0], 1200n, hash("pos-fb-1")));
  await send(`sale     #${riceLots[0]} 800 kg`, bazaar.registry.recordSale(riceLots[0], 800n, hash("pos-fb-2")));

  await handover(mill, deccan, riceLots[1], "Consignment DF-1190", mill.geohash);
  await send(`stage    #${riceLots[1]} -> In transit`, deccan.registry.advanceStage(riceLots[1], STAGE.InTransit));
  await handover(deccan, metro, riceLots[1], "Delivery note MM-7781", encodeGeohash(19.076, 72.8777, 7));
  await send(`stage    #${riceLots[1]} -> At retail`, metro.registry.advanceStage(riceLots[1], STAGE.AtRetail));

  // Lot 3 is still sitting at the mill, unsold. Real inventory is never tidy.

  // ------------------------------------------------------------------
  // Thread 2: alphonso mangoes under a cold chain that fails
  // ------------------------------------------------------------------
  console.log("\n-- thread 2: alphonso mangoes, cold chain");
  const mango = await newBatch(
    konkan,
    lot({
      produceType: "Mango",
      variety: "Alphonso",
      quantity: 2400n,
      unit: "kg",
      harvestedAt: BigInt(daysAgo(9)),
      originGeohash: konkan.geohash,
      originLocation: konkan.location,
      metadataURI: "ipfs://agronomy/konkan-alphonso-2026",
      metadataHash: hash("konkan-alphonso-2026"),
      coldChainRequired: true,
      minTempDeciC: 80,
      maxTempDeciC: 130
    }),
    { pricePerUnit: 240, currency: "INR", grade: "A", organic: false, storage: "Reefer, 8 to 13 degrees C", expiresAt: "2026-09-05" }
  );
  await send(`certify  #${mango} Residue Free`, board.registry.certifyBatch(mango, "Residue Free", BigInt(now + 60 * DAY), "ipfs://certs/rf-1", hash("rf-1")));

  await handover(konkan, coldline, mango, "Reefer MH08 KL 4412", konkan.geohash);
  await send(`stage    #${mango} -> In transit`, coldline.registry.advanceStage(mango, STAGE.InTransit));

  // A reefer door left open somewhere near Pune, then recovered.
  const mangoRun = [
    [95, 880, 16.99, 73.31],
    [98, 890, 17.68, 73.86],
    [104, 900, 18.52, 73.85],
    [188, 910, 18.99, 73.79], // excursion
    [176, 905, 19.21, 73.62],
    [121, 890, 19.08, 72.9],
    [99, 880, 19.076, 72.8777]
  ];
  for (const [temp, humidity, lat, lon] of mangoRun) {
    await send(
      `telemetry #${mango} ${(temp / 10).toFixed(1)}C ${(humidity / 10).toFixed(1)}%`,
      sensors.registry.recordTelemetry(mango, temp, humidity, encodeGeohash(lat, lon, 7), hash(`tlm-${mango}-${temp}-${lat}`), 0)
    );
  }
  await handover(coldline, metro, mango, "Delivery note MM-7799", encodeGeohash(19.076, 72.8777, 7));
  await send(`inspect  #${mango} grade 58 fail`, fssai.registry.recordInspection(mango, 58, false, "Pulp temperature history breached; ripening uneven", hash("insp-mango-1")));

  // ------------------------------------------------------------------
  // Thread 3: nilgiri tea, contaminated, recalled through its children
  // ------------------------------------------------------------------
  console.log("\n-- thread 3: tea, recalled");
  const tea = await newBatch(
    nilgiri,
    lot({
      produceType: "Tea",
      variety: "Nilgiri Orthodox",
      quantity: 6000n,
      unit: "kg",
      harvestedAt: BigInt(daysAgo(21)),
      originGeohash: nilgiri.geohash,
      originLocation: nilgiri.location,
      metadataURI: "ipfs://agronomy/nilgiri-orthodox-2026",
      metadataHash: hash("nilgiri-orthodox-2026")
    }),
    { pricePerUnit: 410, currency: "INR", grade: "B", organic: true, storage: "Airtight, away from light", expiresAt: "2027-06-30" }
  );
  await send(`split    #${tea} into 2 lots`, nilgiri.registry.splitBatch(tea, [3500n, 2500n]));
  const teaLots = (await nilgiri.registry.getChildren(tea)).map(Number);
  await send(`split    #${teaLots[0]} into 2 lots`, nilgiri.registry.splitBatch(teaLots[0], [2000n, 1500n]));
  const teaSubLots = (await nilgiri.registry.getChildren(teaLots[0])).map(Number);

  await handover(nilgiri, deccan, teaSubLots[0], "Consignment DF-1204", nilgiri.geohash);
  await send(`stage    #${teaSubLots[0]} -> In transit`, deccan.registry.advanceStage(teaSubLots[0], STAGE.InTransit));

  await send(`inspect  #${tea} grade 22 fail`, fssai.registry.recordInspection(tea, 22, false, "Glyphosate residue 0.34 mg/kg, over the 0.10 limit", hash("insp-tea-1")));
  await send(`recall   #${tea} severity 3`, fssai.registry.initiateRecall(tea, 3, "Pesticide residue above statutory limit"));
  const descendants = [...teaLots, ...teaSubLots];
  await send(`propagate recall over ${descendants.length} descendants`, fssai.registry.propagateRecall(tea, descendants));
  await send(`destroy  #${teaSubLots[1]}`, fssai.registry.destroyBatch(teaSubLots[1], "Incinerated under FSSAI supervision, ref BLR/2026/118"));

  // ------------------------------------------------------------------
  // Thread 4: a co-operative that grows and processes, merging its lots
  // ------------------------------------------------------------------
  console.log("\n-- thread 4: co-operative merge");
  const geo = anand.geohash;
  const wheatA = await newBatch(
    anand,
    lot({ produceType: "Wheat", variety: "Lok-1", quantity: 4000n, harvestedAt: BigInt(daysAgo(35)), originGeohash: geo, originLocation: anand.location })
  );
  const wheatB = await newBatch(
    anand,
    lot({ produceType: "Wheat", variety: "Lok-1", quantity: 2500n, harvestedAt: BigInt(daysAgo(34)), originGeohash: geo, originLocation: anand.location })
  );
  await send(`merge    #${wheatA} + #${wheatB}`, anand.registry.mergeBatches([wheatA, wheatB], "ipfs://agronomy/anand-wheat-blend", hash("anand-wheat-blend")));
  const merged = Number(await anand.registry.batchCount());
  await send(`stage    #${merged} -> Processed`, anand.registry.advanceStage(merged, STAGE.Processed));
  await send(`inspect  #${merged} grade 88 pass`, fssai.registry.recordInspection(merged, 88, true, "Protein 11.8%, foreign matter within limits", hash("insp-wheat-1")));
  await handover(anand, bazaar, merged, "Delivery note FB-2288", geo);
  await send(`stage    #${merged} -> At retail`, bazaar.registry.advanceStage(merged, STAGE.AtRetail));
  await send(`sale     #${merged} 6500 kg`, bazaar.registry.recordSale(merged, 6500n, hash("pos-fb-3")));

  // ------------------------------------------------------------------
  // Thread 5: an open handover nobody has countersigned yet
  // ------------------------------------------------------------------
  console.log("\n-- thread 5: handover in flight");
  const tomatoes = await newBatch(
    sundar,
    lot({
      produceType: "Tomato",
      variety: "Pusa Ruby",
      quantity: 900n,
      harvestedAt: BigInt(daysAgo(2)),
      originGeohash: sundar.geohash,
      originLocation: sundar.location,
      coldChainRequired: true,
      minTempDeciC: 100,
      maxTempDeciC: 150
    }),
    { pricePerUnit: 28, currency: "INR", grade: "B", organic: false, storage: "Cool, ventilated", expiresAt: "2026-08-24" }
  );
  await send(`telemetry #${tomatoes} 12.4C`, sundar.registry.recordTelemetry(tomatoes, 124, 850, sundar.geohash, hash("tlm-tom-1"), 0));
  await send(`handover #${tomatoes} offered to Coldline (unaccepted)`, sundar.registry.proposeTransfer(tomatoes, coldline.address, sundar.geohash, "Awaiting pickup", hash("open-1")));

  const total = Number(await sundar.registry.batchCount());
  console.log(`\nseeded ${txCount} transactions, ${total} batches on chain`);
  console.log(`recalled tea root #${tea}, cold-chain breach on mango #${mango}, open handover on #${tomatoes}`);

  seedContacts();
}

/// Off-chain, self-service contact details, written straight into the index —
/// nothing here is a claim the chain makes, so there is no contract call to
/// wait on. Real participants set this for themselves from the console; this
/// is only so the feature isn't empty the first time the demo shows it.
///
/// `stack.js` runs deploy, then this script, then starts the server — so the
/// participants table is still empty when this runs on a fresh stack. An
/// UPDATE would silently touch nothing; this upserts a row keyed on address
/// alone, and the indexer's own upsert (which never touches these two
/// columns) fills in the rest once it starts.
function seedContacts() {
  const set = db.prepare(`
    INSERT INTO participants(address, email, phone) VALUES(?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET email = excluded.email, phone = excluded.phone
  `);
  const rows = [
    ["Sundar Farms", "harvest@sundarfarms.example", "+91 98180 22341"],
    ["Anand Growers Collective", "office@anandgrowers.example", "+91 90210 55678"],
    ["Konkan Mango Co-operative", "trade@konkanmango.example", "+91 98220 11987"],
    ["Nilgiri Highland Estates", "estate@nilgirihighland.example", "+91 90480 33214"],
    ["Ganga Rice Mills", "orders@gangaricemills.example", null],
    ["Coldline Logistics", null, "+91 98330 44521"],
    ["Fresh Bazaar", "produce@freshbazaar.example", "+91 90090 77612"]
  ];
  for (const [name, email, phone] of rows) set.run(byName.get(name).address, email, phone);
  console.log(`seeded contact details for ${rows.length} participants`);
}

main().catch((err) => {
  console.error(`\nseed failed: ${err.message}`);
  process.exit(1);
});
