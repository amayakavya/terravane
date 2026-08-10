import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const RPC_URL = process.env.TERRAVANE_RPC ?? "http://127.0.0.1:8545";

/** The stock Hardhat development mnemonic. Never use it anywhere real. */
export const DEV_MNEMONIC = process.env.TERRAVANE_MNEMONIC ?? "test test test test test test test test test test test junk";

export const ROLE = {
  FARMER: 1,
  PROCESSOR: 2,
  DISTRIBUTOR: 4,
  RETAILER: 8,
  CERTIFIER: 16,
  INSPECTOR: 32,
  ORACLE: 64,
  ADMIN: 128
};

export const ROLE_NAMES = [
  [1, "farmer"],
  [2, "processor"],
  [4, "distributor"],
  [8, "retailer"],
  [16, "certifier"],
  [32, "inspector"],
  [64, "oracle"],
  [128, "admin"]
];

export const STAGE_NAMES = ["Harvested", "Processed", "Packed", "In transit", "At retail", "Sold", "Destroyed"];

export function rolesToNames(mask) {
  return ROLE_NAMES.filter(([bit]) => (Number(mask) & bit) !== 0).map(([, name]) => name);
}

export function loadArtifact(name) {
  const file = path.join(ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`artifact for ${name} not found; run "npm run compile" first`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function provider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

/// Deterministic dev wallets, index-aligned with the Hardhat node's accounts.
/// Wrapped in a NonceManager and cached per process: the local node does not
/// reliably surface a pending nonce before the next send, so two transactions
/// issued back to back collide unless one object tracks the sequence.
const walletCache = new Map();

export function wallet(index, prov) {
  if (walletCache.has(index)) return walletCache.get(index);
  const node = ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  const base = new ethers.Wallet(node.privateKey, prov);
  const managed = new ethers.NonceManager(base);
  Object.defineProperty(managed, "address", { value: base.address, enumerable: true });
  walletCache.set(index, managed);
  return managed;
}

export const DEPLOYMENT_FILE = path.join(ROOT, "deployments", "local.json");

export function writeDeployment(data) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2));
  return DEPLOYMENT_FILE;
}

export function readDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error(`no deployment found at ${DEPLOYMENT_FILE}; run "npm run deploy" first`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

export function contracts(runner, deployment) {
  const access = new ethers.Contract(deployment.accessRegistry, loadArtifact("AccessRegistry").abi, runner);
  const registry = new ethers.Contract(deployment.produceRegistry, loadArtifact("ProduceRegistry").abi, runner);
  return { access, registry };
}
