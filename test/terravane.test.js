import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.connect();

const ROLE = {
  FARMER: 1,
  PROCESSOR: 2,
  DISTRIBUTOR: 4,
  RETAILER: 8,
  CERTIFIER: 16,
  INSPECTOR: 32,
  ORACLE: 64,
  ADMIN: 128
};

const STAGE = {
  Harvested: 0,
  Processed: 1,
  Packed: 2,
  InTransit: 3,
  AtRetail: 4,
  Sold: 5,
  Destroyed: 6
};

const ZERO_HASH = ethers.ZeroHash;

// A handover carries the digest of the deal both sides are signing. The digests
// themselves are opaque to the contract — what matters is that the two
// signatures land on the same one, so the tests only need two distinguishable
// values and a third nobody ever offered.
const TERMS = ethers.id("terms:1200 INR/kg, net 30");
const COUNTER_TERMS = ethers.id("terms:1100 INR/kg, net 15");
const OTHER_TERMS = ethers.id("terms:never offered");

function batchInput(overrides = {}) {
  return {
    produceType: "Rice",
    variety: "Basmati 1121",
    quantity: 1000n,
    unit: "kg",
    harvestedAt: 0n,
    originGeohash: "tuvz5x",
    originLocation: "Karnal, Haryana",
    metadataHash: ZERO_HASH,
    metadataURI: "ipfs://agronomy/1",
    coldChainRequired: false,
    minTempDeciC: 0,
    maxTempDeciC: 0,
    ...overrides
  };
}

async function deployStack() {
  const [admin, farmer, processor, distributor, retailer, certifier, inspector, oracle, outsider] =
    await ethers.getSigners();

  const access = await ethers.deployContract("AccessRegistry", ["Consortium Root"], admin);
  const registry = await ethers.deployContract("ProduceRegistry", [await access.getAddress()], admin);

  const enrol = (signer, name, roles, location) =>
    access
      .connect(admin)
      .registerParticipant(signer.address, name, location, "tuvz5x", ZERO_HASH, "", roles);

  await enrol(farmer, "Sundar Farms", ROLE.FARMER, "Karnal");
  await enrol(processor, "Ganga Mills", ROLE.PROCESSOR, "Panipat");
  await enrol(distributor, "Coldline Logistics", ROLE.DISTRIBUTOR, "Delhi");
  await enrol(retailer, "Fresh Bazaar", ROLE.RETAILER, "Bengaluru");
  await enrol(certifier, "India Organic Board", ROLE.CERTIFIER, "Delhi");
  await enrol(inspector, "FSSAI Field Office", ROLE.INSPECTOR, "Delhi");
  await enrol(oracle, "SensorNet Gateway", ROLE.ORACLE, "Delhi");

  return { access, registry, admin, farmer, processor, distributor, retailer, certifier, inspector, oracle, outsider };
}

async function createBatch(registry, farmer, overrides) {
  await registry.connect(farmer).createBatch(batchInput(overrides));
  return registry.batchCount();
}

/// The EDR node reports custom errors raised inside modifiers as raw selectors,
/// so match on the selector as well as the decoded name.
let _selectors;
async function errorSelectors() {
  if (_selectors) return _selectors;
  _selectors = new Map();
  for (const name of ["AccessRegistry", "ProduceRegistry"]) {
    const factory = await ethers.getContractFactory(name);
    for (const fragment of factory.interface.fragments) {
      if (fragment.type === "error") _selectors.set(fragment.name, fragment.selector);
    }
  }
  return _selectors;
}

/** Assert a call reverts with a specific custom error name. */
async function expectRevert(promise, errorName) {
  // Attach the rejection handler in this tick; anything awaited first would let
  // the transaction reject unobserved and take the whole run down with it.
  const settled = promise.then(
    () => null,
    (err) => err
  );

  const map = await errorSelectors();
  const selector = map.get(errorName);
  assert.ok(selector, `no such custom error in the ABIs: ${errorName}`);

  const err = await settled;
  if (err === null) assert.fail(`expected revert ${errorName}, call succeeded`);

  const blob = JSON.stringify(err, Object.getOwnPropertyNames(err));
  assert.ok(
    blob.includes(errorName) || blob.includes(selector),
    `expected revert ${errorName} (${selector}), got: ${err.shortMessage ?? err.message}`
  );
}

describe("AccessRegistry", () => {
  let ctx;
  beforeEach(async () => {
    ctx = await deployStack();
  });

  it("seeds the deployer as the genesis admin", async () => {
    assert.equal(await ctx.access.hasRole(ctx.admin.address, ROLE.ADMIN), true);
    assert.equal(await ctx.access.isActive(ctx.admin.address), true);
  });

  it("registers participants with the roles they were given", async () => {
    const p = await ctx.access.getParticipant(ctx.farmer.address);
    assert.equal(p.name, "Sundar Farms");
    assert.equal(Number(p.roles), ROLE.FARMER);
    assert.equal(p.active, true);
    assert.equal(Number(await ctx.access.rosterLength()), 8);
  });

  it("refuses registration from a non-admin", async () => {
    await expectRevert(
      ctx.access
        .connect(ctx.farmer)
        .registerParticipant(ctx.outsider.address, "Rogue", "x", "", ZERO_HASH, "", ROLE.FARMER),
      "NotAdmin"
    );
  });

  it("refuses duplicate registration", async () => {
    await expectRevert(
      ctx.access
        .connect(ctx.admin)
        .registerParticipant(ctx.farmer.address, "Again", "x", "", ZERO_HASH, "", ROLE.FARMER),
      "AlreadyRegistered"
    );
  });

  it("grants and revokes roles as a bitmask", async () => {
    await ctx.access.connect(ctx.admin).grantRoles(ctx.farmer.address, ROLE.PROCESSOR);
    assert.equal(await ctx.access.hasRole(ctx.farmer.address, ROLE.PROCESSOR), true);
    assert.equal(await ctx.access.hasRole(ctx.farmer.address, ROLE.FARMER), true);

    await ctx.access.connect(ctx.admin).revokeRoles(ctx.farmer.address, ROLE.PROCESSOR);
    assert.equal(await ctx.access.hasRole(ctx.farmer.address, ROLE.PROCESSOR), false);
    assert.equal(await ctx.access.hasRole(ctx.farmer.address, ROLE.FARMER), true);
  });

  it("will not let the last admin be removed", async () => {
    await expectRevert(ctx.access.connect(ctx.admin).revokeRoles(ctx.admin.address, ROLE.ADMIN), "LastAdmin");
    await expectRevert(ctx.access.connect(ctx.admin).suspend(ctx.admin.address, "oops"), "LastAdmin");
  });

  it("counts only admins that are active, so suspension cannot lock the registry out", async () => {
    await ctx.access.connect(ctx.admin).grantRoles(ctx.certifier.address, ROLE.ADMIN);
    assert.equal(Number(await ctx.access.activeAdmins()), 2);

    // Suspending the second admin must put the seat back in play, otherwise the
    // first can hand its own role away and leave nobody able to administer.
    await ctx.access.connect(ctx.admin).suspend(ctx.certifier.address, "under investigation");
    assert.equal(Number(await ctx.access.activeAdmins()), 1);
    await expectRevert(ctx.access.connect(ctx.admin).revokeRoles(ctx.admin.address, ROLE.ADMIN), "LastAdmin");

    await ctx.access.connect(ctx.admin).reinstate(ctx.certifier.address);
    assert.equal(Number(await ctx.access.activeAdmins()), 2);
    await ctx.access.connect(ctx.admin).revokeRoles(ctx.admin.address, ROLE.ADMIN);
    assert.equal(Number(await ctx.access.activeAdmins()), 1);
    assert.equal(await ctx.access.hasRole(ctx.certifier.address, ROLE.ADMIN), true);
  });

  it("does not double count an admin granted the role twice", async () => {
    await ctx.access.connect(ctx.admin).grantRoles(ctx.certifier.address, ROLE.ADMIN);
    await ctx.access.connect(ctx.admin).grantRoles(ctx.certifier.address, ROLE.ADMIN);
    assert.equal(Number(await ctx.access.activeAdmins()), 2);
  });

  it("blocks a suspended participant from originating produce", async () => {
    await ctx.access.connect(ctx.admin).suspend(ctx.farmer.address, "licence lapsed");
    await expectRevert(ctx.registry.connect(ctx.farmer).createBatch(batchInput()), "InactiveParticipant");

    await ctx.access.connect(ctx.admin).reinstate(ctx.farmer.address);
    await ctx.registry.connect(ctx.farmer).createBatch(batchInput());
    assert.equal(await ctx.registry.batchCount(), 1n);
  });
});

describe("Origination", () => {
  let ctx;
  beforeEach(async () => {
    ctx = await deployStack();
  });

  it("creates a batch owned and custodied by the farm", async () => {
    const id = await createBatch(ctx.registry, ctx.farmer);
    const b = await ctx.registry.getBatch(id);

    assert.equal(b.originFarm, ctx.farmer.address);
    assert.equal(b.custodian, ctx.farmer.address);
    assert.equal(b.produceType, "Rice");
    assert.equal(b.quantity, 1000n);
    assert.equal(Number(b.stage), STAGE.Harvested);
    assert.ok(b.harvestedAt > 0n, "harvest time defaults to block time");
  });

  it("rejects origination by anyone who is not a farmer", async () => {
    await expectRevert(ctx.registry.connect(ctx.processor).createBatch(batchInput()), "NotAuthorised");
    await expectRevert(ctx.registry.connect(ctx.outsider).createBatch(batchInput()), "NotAuthorised");
  });

  it("rejects a zero-quantity or unnamed lot", async () => {
    await expectRevert(ctx.registry.connect(ctx.farmer).createBatch(batchInput({ quantity: 0n })), "ZeroQuantity");
    await expectRevert(ctx.registry.connect(ctx.farmer).createBatch(batchInput({ produceType: "" })), "BadInput");
  });

  it("rejects an inverted cold-chain window", async () => {
    await expectRevert(
      ctx.registry
        .connect(ctx.farmer)
        .createBatch(batchInput({ coldChainRequired: true, minTempDeciC: 80, maxTempDeciC: 20 })),
      "BadInput"
    );
  });

  it("indexes the batch under its farm", async () => {
    const id = await createBatch(ctx.registry, ctx.farmer);
    const owned = await ctx.registry.batchesOfOrigin(ctx.farmer.address);
    assert.deepEqual(owned.map(Number), [Number(id)]);
  });
});

describe("Custody", () => {
  let ctx, id;
  beforeEach(async () => {
    ctx = await deployStack();
    id = await createBatch(ctx.registry, ctx.farmer);
  });

  it("moves custody only after the recipient countersigns", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "tuvz5x", "truck HR55", TERMS);

    let b = await ctx.registry.getBatch(id);
    assert.equal(b.custodian, ctx.farmer.address, "custody must not move on proposal alone");
    assert.equal(b.pendingCustodian, ctx.processor.address);

    const [pending, to, awaiting, terms, round] = await ctx.registry.pendingTransfer(id);
    assert.equal(pending, true);
    assert.equal(to, ctx.processor.address);
    assert.equal(awaiting, ctx.processor.address);
    assert.equal(terms, TERMS);
    assert.equal(Number(round), 1);

    await ctx.registry.connect(ctx.processor).acceptTransfer(id, "tuw12b", TERMS);
    b = await ctx.registry.getBatch(id);
    assert.equal(b.custodian, ctx.processor.address);
    assert.equal(b.pendingCustodian, ethers.ZeroAddress);
    assert.equal(Number(b.handoverCount), 1);

    const hs = await ctx.registry.getHandovers(id);
    assert.equal(hs.length, 1);
    assert.equal(hs[0].accepted, true);
    assert.equal(hs[0].geohash, "tuw12b");
  });

  it("refuses a proposal from anyone but the custodian", async () => {
    await expectRevert(
      ctx.registry.connect(ctx.distributor).proposeTransfer(id, ctx.retailer.address, "", "", TERMS),
      "NotCustodian"
    );
  });

  it("refuses a recipient who cannot legally hold custody", async () => {
    await expectRevert(
      ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.certifier.address, "", "", TERMS),
      "RecipientUnfit"
    );
    await expectRevert(
      ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.outsider.address, "", "", TERMS),
      "RecipientUnfit"
    );
  });

  it("allows only one open handover at a time", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await expectRevert(
      ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.distributor.address, "", "", TERMS),
      "TransferPending"
    );
  });

  it("lets either party cancel, freeing the lot", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await ctx.registry.connect(ctx.processor).cancelTransfer(id);

    const [pending] = await ctx.registry.pendingTransfer(id);
    assert.equal(pending, false);

    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.distributor.address, "", "", TERMS);
    await ctx.registry.connect(ctx.distributor).acceptTransfer(id, "", TERMS);
    assert.equal((await ctx.registry.getBatch(id)).custodian, ctx.distributor.address);
  });

  it("refuses acceptance by a party the lot was not offered to", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await expectRevert(ctx.registry.connect(ctx.distributor).acceptTransfer(id, "", TERMS), "NotAwaiting");
  });

  it("refuses a handover with no stated deal", async () => {
    await expectRevert(
      ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", ZERO_HASH),
      "TermsRequired"
    );
  });

  it("refuses acceptance of terms other than the ones on the table", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await expectRevert(ctx.registry.connect(ctx.processor).acceptTransfer(id, "", OTHER_TERMS), "TermsMismatch");
    assert.equal((await ctx.registry.getBatch(id)).custodian, ctx.farmer.address);
  });

  it("hands the outstanding signature back when the recipient counters", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await ctx.registry.connect(ctx.processor).counterTransfer(id, COUNTER_TERMS, "1100 is what the mill pays");

    const [pending, to, awaiting, terms, round] = await ctx.registry.pendingTransfer(id);
    assert.equal(pending, true);
    assert.equal(to, ctx.processor.address, "a counter re-prices the deal, it does not reverse it");
    assert.equal(awaiting, ctx.farmer.address, "the offering side now owes the signature");
    assert.equal(terms, COUNTER_TERMS);
    assert.equal(Number(round), 2);

    // The original terms are dead the moment they are countered.
    await expectRevert(ctx.registry.connect(ctx.farmer).acceptTransfer(id, "", TERMS), "TermsMismatch");

    await ctx.registry.connect(ctx.farmer).acceptTransfer(id, "", COUNTER_TERMS);
    const b = await ctx.registry.getBatch(id);
    assert.equal(b.custodian, ctx.processor.address, "custody still moves to the receiving side");

    const [h] = await ctx.registry.getHandovers(id);
    assert.equal(h.accepted, true);
    assert.equal(h.termsHash, COUNTER_TERMS);
    assert.equal(h.awaiting, ethers.ZeroAddress);
    assert.equal(Number(h.round), 2);
    assert.equal(h.note, "1100 is what the mill pays");
  });

  it("refuses a counter from the side that is already waiting on an answer", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await expectRevert(ctx.registry.connect(ctx.farmer).counterTransfer(id, COUNTER_TERMS, ""), "NotAwaiting");
    await expectRevert(ctx.registry.connect(ctx.distributor).counterTransfer(id, COUNTER_TERMS, ""), "NotAwaiting");
  });

  it("refuses a counter that changes nothing", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await expectRevert(ctx.registry.connect(ctx.processor).counterTransfer(id, TERMS, ""), "BadInput");
    await expectRevert(ctx.registry.connect(ctx.processor).counterTransfer(id, ZERO_HASH, ""), "TermsRequired");
  });

  it("counts an unsettled deal as a gap in the custody record", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    assert.equal((await ctx.registry.verify(id)).custodyIntact, false);

    await ctx.registry.connect(ctx.processor).counterTransfer(id, COUNTER_TERMS, "");
    assert.equal((await ctx.registry.verify(id)).custodyIntact, false, "a deal mid-negotiation is still open");

    await ctx.registry.connect(ctx.farmer).acceptTransfer(id, "", COUNTER_TERMS);
    assert.equal((await ctx.registry.verify(id)).custodyIntact, true);
  });

  it("leaves nothing outstanding on a cancelled deal", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await ctx.registry.connect(ctx.processor).counterTransfer(id, COUNTER_TERMS, "");
    await ctx.registry.connect(ctx.farmer).cancelTransfer(id);

    const [h] = await ctx.registry.getHandovers(id);
    assert.equal(h.cancelled, true);
    assert.equal(h.awaiting, ethers.ZeroAddress);
    assert.equal((await ctx.registry.verify(id)).custodyIntact, true, "a walked-away deal is not a custody gap");
    await expectRevert(ctx.registry.connect(ctx.processor).counterTransfer(id, TERMS, ""), "NoPendingTransfer");
  });
});

describe("Lifecycle", () => {
  let ctx, id;
  beforeEach(async () => {
    ctx = await deployStack();
    id = await createBatch(ctx.registry, ctx.farmer);
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    await ctx.registry.connect(ctx.processor).acceptTransfer(id, "", TERMS);
  });

  it("advances stages in order for the right role", async () => {
    await ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Processed);
    await ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Packed);
    assert.equal(Number((await ctx.registry.getBatch(id)).stage), STAGE.Packed);
  });

  it("refuses to move a stage backwards or sideways", async () => {
    await ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Packed);
    await expectRevert(ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Processed), "StageNotMonotonic");
    await expectRevert(ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Packed), "StageNotMonotonic");
  });

  it("refuses a stage the custodian is not licensed for", async () => {
    await expectRevert(ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.InTransit), "NotAuthorised");
  });

  it("routes sale and destruction through their own entry points", async () => {
    await expectRevert(ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Sold), "BadInput");
    await expectRevert(ctx.registry.connect(ctx.processor).advanceStage(id, STAGE.Destroyed), "BadInput");
  });

  it("records partial sales and closes the lot when it is exhausted", async () => {
    await ctx.registry.connect(ctx.processor).proposeTransfer(id, ctx.retailer.address, "", "", TERMS);
    await ctx.registry.connect(ctx.retailer).acceptTransfer(id, "", TERMS);

    await ctx.registry.connect(ctx.retailer).recordSale(id, 400n, ZERO_HASH);
    assert.equal(await ctx.registry.soldQuantity(id), 400n);
    assert.notEqual(Number((await ctx.registry.getBatch(id)).stage), STAGE.Sold);

    await ctx.registry.connect(ctx.retailer).recordSale(id, 600n, ZERO_HASH);
    assert.equal(Number((await ctx.registry.getBatch(id)).stage), STAGE.Sold);

    await expectRevert(ctx.registry.connect(ctx.retailer).recordSale(id, 1n, ZERO_HASH), "BatchTerminal");
  });

  it("refuses to sell more than the lot holds", async () => {
    await ctx.registry.connect(ctx.processor).proposeTransfer(id, ctx.retailer.address, "", "", TERMS);
    await ctx.registry.connect(ctx.retailer).acceptTransfer(id, "", TERMS);
    await expectRevert(ctx.registry.connect(ctx.retailer).recordSale(id, 1001n, ZERO_HASH), "QuantityMismatch");
  });
});

describe("Cold chain telemetry", () => {
  let ctx, id;
  beforeEach(async () => {
    ctx = await deployStack();
    id = await createBatch(ctx.registry, ctx.farmer, {
      produceType: "Alphonso Mango",
      coldChainRequired: true,
      minTempDeciC: 80, // 8.0 degC
      maxTempDeciC: 130 // 13.0 degC
    });
  });

  it("accepts readings inside the window without flagging", async () => {
    await ctx.registry.connect(ctx.oracle).recordTelemetry(id, 100, 850, "tuvz5x", ZERO_HASH, 0);
    const t = await ctx.registry.getTelemetry(id);
    assert.equal(t.length, 1);
    assert.equal(t[0].excursion, false);
    assert.equal((await ctx.registry.getBatch(id)).coldChainBreached, false);
  });

  it("flags an excursion and latches the breach on the batch", async () => {
    await ctx.registry.connect(ctx.oracle).recordTelemetry(id, 210, 900, "tuvz5x", ZERO_HASH, 0);
    const t = await ctx.registry.getTelemetry(id);
    assert.equal(t[0].excursion, true);

    const b = await ctx.registry.getBatch(id);
    assert.equal(b.coldChainBreached, true);
    assert.equal(Number(b.telemetryCount), 1);

    // A later good reading must not scrub the record.
    await ctx.registry.connect(ctx.oracle).recordTelemetry(id, 100, 900, "tuvz5x", ZERO_HASH, 0);
    assert.equal((await ctx.registry.getBatch(id)).coldChainBreached, true);
  });

  it("does not flag ambient produce that has no cold-chain requirement", async () => {
    const ambient = await createBatch(ctx.registry, ctx.farmer, { produceType: "Wheat" });
    await ctx.registry.connect(ctx.oracle).recordTelemetry(ambient, 400, 300, "", ZERO_HASH, 0);
    assert.equal((await ctx.registry.getTelemetry(ambient))[0].excursion, false);
  });

  it("refuses telemetry from a party with neither custody nor an oracle licence", async () => {
    await expectRevert(
      ctx.registry.connect(ctx.retailer).recordTelemetry(id, 100, 800, "", ZERO_HASH, 0),
      "NotAuthorised"
    );
  });

  it("lets the current custodian report its own readings", async () => {
    await ctx.registry.connect(ctx.farmer).recordTelemetry(id, 95, 800, "", ZERO_HASH, 0);
    assert.equal((await ctx.registry.getTelemetry(id)).length, 1);
  });
});

describe("Certification and inspection", () => {
  let ctx, id;
  beforeEach(async () => {
    ctx = await deployStack();
    id = await createBatch(ctx.registry, ctx.farmer);
  });

  it("attaches a certificate that verify() counts", async () => {
    await ctx.registry.connect(ctx.certifier).certifyBatch(id, "India Organic", 0, "ipfs://cert/1", ZERO_HASH);
    const v = await ctx.registry.verify(id);
    assert.equal(Number(v.activeCertifications), 1);
  });

  it("stops counting a revoked certificate", async () => {
    await ctx.registry.connect(ctx.certifier).certifyBatch(id, "India Organic", 0, "", ZERO_HASH);
    await ctx.registry.connect(ctx.certifier).revokeBatchCertification(id, 0, "audit failed");

    const certs = await ctx.registry.getBatchCertifications(id);
    assert.equal(certs[0].revoked, true);
    assert.equal(certs[0].revocationReason, "audit failed");
    assert.equal(Number((await ctx.registry.verify(id)).activeCertifications), 0);
  });

  it("stops counting an expired certificate", async () => {
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    await ctx.registry.connect(ctx.certifier).certifyBatch(id, "GlobalGAP", now + 100n, "", ZERO_HASH);
    assert.equal(Number((await ctx.registry.verify(id)).activeCertifications), 1);

    await ethers.provider.send("evm_increaseTime", [200]);
    await ethers.provider.send("evm_mine", []);
    assert.equal(Number((await ctx.registry.verify(id)).activeCertifications), 0);
  });

  it("counts a farm-level certificate toward the lot", async () => {
    await ctx.registry.connect(ctx.certifier).certifyFarm(ctx.farmer.address, "NPOP Organic", 0, "", ZERO_HASH);
    assert.equal(Number((await ctx.registry.verify(id)).activeCertifications), 1);
    assert.equal((await ctx.registry.getFarmCertifications(ctx.farmer.address)).length, 1);
  });

  it("refuses certification from a party without the certifier role", async () => {
    await expectRevert(
      ctx.registry.connect(ctx.distributor).certifyBatch(id, "Fake Organic", 0, "", ZERO_HASH),
      "NotAuthorised"
    );
  });

  it("refuses revocation by an unrelated party", async () => {
    await ctx.registry.connect(ctx.certifier).certifyBatch(id, "India Organic", 0, "", ZERO_HASH);
    await expectRevert(
      ctx.registry.connect(ctx.distributor).revokeBatchCertification(id, 0, "spite"),
      "NotAuthorised"
    );
  });

  it("rejects revocation of a certificate that does not exist", async () => {
    await expectRevert(ctx.registry.connect(ctx.certifier).revokeBatchCertification(id, 0, "nothing there"), "BadInput");
  });

  it("records inspections and surfaces failures in verify()", async () => {
    await ctx.registry.connect(ctx.inspector).recordInspection(id, 92, true, "moisture within spec", ZERO_HASH);
    await ctx.registry.connect(ctx.inspector).recordInspection(id, 41, false, "aflatoxin over limit", ZERO_HASH);

    const v = await ctx.registry.verify(id);
    assert.equal(Number(v.failedInspections), 1);
    assert.equal(Number(v.lastInspectionGrade), 41);
    assert.equal((await ctx.registry.getInspections(id)).length, 2);
  });

  it("rejects an out-of-range grade", async () => {
    await expectRevert(ctx.registry.connect(ctx.inspector).recordInspection(id, 101, true, "", ZERO_HASH), "BadInput");
  });
});

describe("Transformation", () => {
  let ctx, id;
  beforeEach(async () => {
    ctx = await deployStack();
    id = await createBatch(ctx.registry, ctx.farmer);
  });

  it("splits a lot with quantity conserved and lineage recorded", async () => {
    await ctx.registry.connect(ctx.farmer).splitBatch(id, [400n, 350n, 250n]);
    const children = (await ctx.registry.getChildren(id)).map(Number);
    assert.equal(children.length, 3);

    const quantities = [];
    for (const c of children) quantities.push((await ctx.registry.getBatch(c)).quantity);
    assert.deepEqual(quantities, [400n, 350n, 250n]);

    assert.equal((await ctx.registry.getBatch(id)).quantity, 0n, "parent is consumed by the split");
    assert.deepEqual((await ctx.registry.getParents(children[0])).map(Number), [Number(id)]);

    const child = await ctx.registry.getBatch(children[0]);
    assert.equal(child.originFarm, ctx.farmer.address);
    assert.equal(child.custodian, ctx.farmer.address);
    assert.equal(child.produceType, "Rice");
  });

  it("refuses a split that does not account for the parent exactly", async () => {
    await expectRevert(ctx.registry.connect(ctx.farmer).splitBatch(id, [400n, 300n]), "QuantityMismatch");
    await expectRevert(ctx.registry.connect(ctx.farmer).splitBatch(id, [1000n]), "BadInput");
    await expectRevert(ctx.registry.connect(ctx.farmer).splitBatch(id, [1000n, 0n]), "ZeroQuantity");
  });

  it("merges like lots held by one custodian", async () => {
    const second = await createBatch(ctx.registry, ctx.farmer, { quantity: 500n });
    await ctx.registry.connect(ctx.farmer).mergeBatches([id, second], "ipfs://merged", ZERO_HASH);

    const merged = await ctx.registry.batchCount();
    const b = await ctx.registry.getBatch(merged);
    assert.equal(b.quantity, 1500n);
    assert.equal(b.metadataURI, "ipfs://merged");
    assert.deepEqual((await ctx.registry.getParents(merged)).map(Number), [Number(id), Number(second)]);
    assert.equal((await ctx.registry.getBatch(id)).quantity, 0n);
  });

  it("refuses to merge different produce or units", async () => {
    const wheat = await createBatch(ctx.registry, ctx.farmer, { produceType: "Wheat" });
    await expectRevert(ctx.registry.connect(ctx.farmer).mergeBatches([id, wheat], "", ZERO_HASH), "BadInput");

    const tonnes = await createBatch(ctx.registry, ctx.farmer, { unit: "t" });
    await expectRevert(ctx.registry.connect(ctx.farmer).mergeBatches([id, tonnes], "", ZERO_HASH), "BadInput");
  });

  it("refuses a merge that lists the same lot twice", async () => {
    const second = await createBatch(ctx.registry, ctx.farmer, { quantity: 500n });
    // Counting a lot twice would mint 2,500 kg out of 1,500 kg of produce.
    await expectRevert(ctx.registry.connect(ctx.farmer).mergeBatches([id, id, second], "", ZERO_HASH), "ZeroQuantity");
    assert.equal((await ctx.registry.getBatch(id)).quantity, 1000n, "a rejected merge leaves the inputs untouched");
  });

  it("refuses to merge lots held by someone else", async () => {
    const second = await createBatch(ctx.registry, ctx.farmer, { quantity: 500n });
    await ctx.registry.connect(ctx.farmer).proposeTransfer(second, ctx.processor.address, "", "", TERMS);
    await ctx.registry.connect(ctx.processor).acceptTransfer(second, "", TERMS);
    await expectRevert(ctx.registry.connect(ctx.farmer).mergeBatches([id, second], "", ZERO_HASH), "NotCustodian");
  });

  it("carries a cold-chain breach into the merged lot", async () => {
    const a = await createBatch(ctx.registry, ctx.farmer, {
      produceType: "Mango",
      coldChainRequired: true,
      minTempDeciC: 80,
      maxTempDeciC: 130
    });
    const b = await createBatch(ctx.registry, ctx.farmer, {
      produceType: "Mango",
      coldChainRequired: true,
      minTempDeciC: 80,
      maxTempDeciC: 130
    });
    await ctx.registry.connect(ctx.farmer).recordTelemetry(b, 250, 900, "", ZERO_HASH, 0);

    await ctx.registry.connect(ctx.farmer).mergeBatches([a, b], "", ZERO_HASH);
    const merged = await ctx.registry.batchCount();
    assert.equal((await ctx.registry.getBatch(merged)).coldChainBreached, true);
  });
});

describe("Recall", () => {
  let ctx, root, children;
  beforeEach(async () => {
    ctx = await deployStack();
    root = await createBatch(ctx.registry, ctx.farmer);
    await ctx.registry.connect(ctx.farmer).splitBatch(root, [600n, 400n]);
    children = (await ctx.registry.getChildren(root)).map(Number);
  });

  it("lets an inspector recall a lot", async () => {
    await ctx.registry.connect(ctx.inspector).initiateRecall(root, 3, "salmonella detected");
    const b = await ctx.registry.getBatch(root);
    assert.equal(b.recalled, true);

    const r = await ctx.registry.getRecall(root);
    assert.equal(r.initiator, ctx.inspector.address);
    assert.equal(Number(r.severity), 3);
    assert.equal(r.reason, "salmonella detected");
  });

  it("lets the originating farm recall its own lot", async () => {
    await ctx.registry.connect(ctx.farmer).initiateRecall(root, 1, "advisory");
    assert.equal((await ctx.registry.getBatch(root)).recalled, true);
  });

  it("refuses a recall from an unrelated party", async () => {
    await expectRevert(ctx.registry.connect(ctx.distributor).initiateRecall(root, 2, "nope"), "NotAuthorised");
    await expectRevert(ctx.registry.connect(ctx.inspector).initiateRecall(root, 0, "bad severity"), "BadInput");
  });

  it("propagates to proved descendants and refuses everything else", async () => {
    // Grandchild, so the ancestry proof has to walk more than one hop.
    await ctx.registry.connect(ctx.farmer).splitBatch(children[0], [300n, 300n]);
    const grandchildren = (await ctx.registry.getChildren(children[0])).map(Number);
    const unrelated = await createBatch(ctx.registry, ctx.farmer);

    await ctx.registry.connect(ctx.inspector).initiateRecall(root, 3, "listeria");
    await ctx.registry
      .connect(ctx.inspector)
      .propagateRecall(root, [...children, ...grandchildren]);

    for (const id of [...children, ...grandchildren]) {
      const b = await ctx.registry.getBatch(id);
      assert.equal(b.recalled, true, `batch ${id} should be recalled`);
      assert.equal(Number((await ctx.registry.getRecall(id)).rootBatch), Number(root));
    }

    await expectRevert(
      ctx.registry.connect(ctx.inspector).propagateRecall(root, [Number(unrelated)]),
      "NotDescendant"
    );
    assert.equal((await ctx.registry.getBatch(unrelated)).recalled, false);
  });

  it("freezes a recalled lot against movement and sale", async () => {
    await ctx.registry.connect(ctx.inspector).initiateRecall(children[0], 3, "contaminated");
    await expectRevert(
      ctx.registry.connect(ctx.farmer).proposeTransfer(children[0], ctx.processor.address, "", "", TERMS),
      "BatchRecalled"
    );
    await expectRevert(ctx.registry.connect(ctx.farmer).splitBatch(children[0], [300n, 300n]), "BatchRecalled");
    await expectRevert(ctx.registry.connect(ctx.inspector).initiateRecall(children[0], 3, "again"), "AlreadyRecalled");
  });

  it("marks a destroyed lot terminal", async () => {
    await ctx.registry.connect(ctx.inspector).initiateRecall(children[0], 3, "contaminated");
    await ctx.registry.connect(ctx.inspector).destroyBatch(children[0], "incinerated under supervision");
    assert.equal(Number((await ctx.registry.getBatch(children[0])).stage), STAGE.Destroyed);
    await expectRevert(ctx.registry.connect(ctx.inspector).destroyBatch(children[0], "again"), "BatchTerminal");
  });
});

describe("Verification and pause", () => {
  let ctx, id;
  beforeEach(async () => {
    ctx = await deployStack();
    id = await createBatch(ctx.registry, ctx.farmer);
  });

  it("returns an empty verification for an unknown lot", async () => {
    const v = await ctx.registry.verify(9999n);
    assert.equal(v.exists, false);
  });

  it("reports custody as broken while a handover sits unaccepted", async () => {
    await ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS);
    assert.equal((await ctx.registry.verify(id)).custodyIntact, false);

    await ctx.registry.connect(ctx.processor).acceptTransfer(id, "", TERMS);
    const v = await ctx.registry.verify(id);
    assert.equal(v.custodyIntact, true);
    assert.equal(Number(v.chainLength), 1);
  });

  it("reports custody as broken when the current holder is suspended", async () => {
    await ctx.access.connect(ctx.admin).suspend(ctx.farmer.address, "licence lapsed");
    assert.equal((await ctx.registry.verify(id)).custodyIntact, false);
  });

  it("halts writes when paused and resumes when lifted", async () => {
    await ctx.registry.connect(ctx.admin).setPaused(true);
    await expectRevert(ctx.registry.connect(ctx.farmer).createBatch(batchInput()), "Paused");
    await expectRevert(
      ctx.registry.connect(ctx.farmer).proposeTransfer(id, ctx.processor.address, "", "", TERMS),
      "Paused"
    );

    // Reads must keep working while the chain is halted.
    assert.equal((await ctx.registry.verify(id)).exists, true);

    await ctx.registry.connect(ctx.admin).setPaused(false);
    await ctx.registry.connect(ctx.farmer).createBatch(batchInput());
  });

  it("refuses a pause from a non-admin", async () => {
    await expectRevert(ctx.registry.connect(ctx.inspector).setPaused(true), "NotAuthorised");
  });
});
