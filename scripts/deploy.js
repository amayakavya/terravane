// Deploys the Terravane contracts to the configured RPC and enrols the cast of
// participants, then writes deployments/local.json for the indexer and UI.
import { ethers } from "ethers";
import { contracts, loadArtifact, provider, ROLE, rolesToNames, wallet, writeDeployment } from "./lib/chain.js";
import { encodeGeohash } from "./lib/geohash.js";

export const CAST = [
  { index: 1, name: "Sundar Farms", roles: ROLE.FARMER, location: "Karnal, Haryana", lat: 29.6857, lon: 76.9905 },
  {
    index: 2,
    name: "Nilgiri Highland Estates",
    roles: ROLE.FARMER,
    location: "Ooty, Tamil Nadu",
    lat: 11.4102,
    lon: 76.695
  },
  {
    index: 3,
    name: "Konkan Mango Co-operative",
    roles: ROLE.FARMER,
    location: "Ratnagiri, Maharashtra",
    lat: 16.9902,
    lon: 73.312
  },
  { index: 4, name: "Ganga Rice Mills", roles: ROLE.PROCESSOR, location: "Panipat, Haryana", lat: 29.3909, lon: 76.9635 },
  {
    index: 5,
    name: "Coldline Logistics",
    roles: ROLE.DISTRIBUTOR,
    location: "Delhi NCR",
    lat: 28.6139,
    lon: 77.209
  },
  {
    index: 6,
    name: "Deccan Freight",
    roles: ROLE.DISTRIBUTOR,
    location: "Hyderabad, Telangana",
    lat: 17.385,
    lon: 78.4867
  },
  {
    index: 7,
    name: "Fresh Bazaar",
    roles: ROLE.RETAILER,
    location: "Bengaluru, Karnataka",
    lat: 12.9716,
    lon: 77.5946
  },
  { index: 8, name: "MetroMart", roles: ROLE.RETAILER, location: "Mumbai, Maharashtra", lat: 19.076, lon: 72.8777 },
  {
    index: 9,
    name: "India Organic Board",
    roles: ROLE.CERTIFIER,
    location: "New Delhi",
    lat: 28.6139,
    lon: 77.209
  },
  {
    index: 10,
    name: "FSSAI Field Office",
    roles: ROLE.INSPECTOR,
    location: "New Delhi",
    lat: 28.6139,
    lon: 77.209
  },
  { index: 11, name: "SensorNet Gateway", roles: ROLE.ORACLE, location: "Bengaluru", lat: 12.9716, lon: 77.5946 },
  {
    // One address, two hats: exactly the case the role bitmask exists for.
    index: 12,
    name: "Anand Growers Collective",
    roles: ROLE.FARMER | ROLE.PROCESSOR,
    location: "Anand, Gujarat",
    lat: 22.5645,
    lon: 72.9289
  }
];

async function main() {
  const prov = provider();
  const net = await prov.getNetwork().catch(() => {
    throw new Error(`cannot reach an RPC at ${process.env.TERRAVANE_RPC ?? "http://127.0.0.1:8545"}; start one with "npm run chain"`);
  });

  const admin = wallet(0, prov);
  // Captured before anything is sent: the indexer backfills from here, and the
  // genesis admin's own registration is emitted inside the first deploy block.
  const startBlock = await prov.getBlockNumber();
  console.log(`network      chainId ${net.chainId}`);
  console.log(`deployer     ${admin.address}`);

  const accessArtifact = loadArtifact("AccessRegistry");
  const registryArtifact = loadArtifact("ProduceRegistry");

  const accessFactory = new ethers.ContractFactory(accessArtifact.abi, accessArtifact.bytecode, admin);
  const access = await accessFactory.deploy("Terravane Consortium");
  await access.waitForDeployment();
  const accessAddress = await access.getAddress();

  const registryFactory = new ethers.ContractFactory(registryArtifact.abi, registryArtifact.bytecode, admin);
  const registry = await registryFactory.deploy(accessAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  console.log(`AccessRegistry   ${accessAddress}`);
  console.log(`ProduceRegistry  ${registryAddress}`);

  const participants = [
    {
      index: 0,
      address: admin.address,
      name: "Terravane Consortium",
      roles: ROLE.ADMIN,
      roleNames: ["admin"],
      location: "genesis",
      geohash: "",
      lat: null,
      lon: null
    }
  ];

  for (const member of CAST) {
    const signer = wallet(member.index, prov);
    const geohash = encodeGeohash(member.lat, member.lon, 7);
    const tx = await access.registerParticipant(
      signer.address,
      member.name,
      member.location,
      geohash,
      ethers.id(`licence:${member.name}`),
      "",
      member.roles
    );
    await tx.wait();
    participants.push({
      index: member.index,
      address: signer.address,
      name: member.name,
      roles: member.roles,
      roleNames: rolesToNames(member.roles),
      location: member.location,
      geohash,
      lat: member.lat,
      lon: member.lon
    });
    console.log(`enrolled     ${member.name.padEnd(26)} ${rolesToNames(member.roles).join("+")}`);
  }

  const deployment = {
    chainId: Number(net.chainId),
    rpc: process.env.TERRAVANE_RPC ?? "http://127.0.0.1:8545",
    accessRegistry: accessAddress,
    produceRegistry: registryAddress,
    deployedAtBlock: startBlock,
    deployedAt: new Date().toISOString(),
    participants
  };

  const file = writeDeployment(deployment);
  console.log(`\nwrote        ${file}`);

  // Sanity check through the same path the indexer will use.
  const { registry: readBack } = contracts(prov, deployment);
  console.log(`batches      ${await readBack.batchCount()}`);
}

main().catch((err) => {
  console.error(`\ndeploy failed: ${err.message}`);
  process.exit(1);
});
