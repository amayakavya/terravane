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
  const prov = new ethers.JsonRpcProvider(RPC_URL);
  // The default four second cadence leaves the cached head stale for long enough
  // that a freshly mined block looks like it does not exist yet.
  prov.pollingInterval = 1000;
  return prov;
}

/// A wallet whose nonce is tracked locally instead of re-queried per send.
/// Re-reading "pending" from this node close to broadcast time is not
/// reliable — two sends issued back to back can both read the same value, or
/// a send can land with a nonce lower than what the node just accepted.
/// ethers' own NonceManager exists for exactly this, but proved unreliable
/// against this node too: its counter desynced under load, and once handed a
/// signature that recovered to an unrelated address entirely. This is the
/// same idea, deliberately simpler — one lazy fetch, then a plain local
/// counter — which is safe here because every call site awaits full
/// confirmation before its next send on the same signer, so nothing ever
/// asks this wallet for two nonces at once.
class TrackedWallet extends ethers.Wallet {
  #next = null;

  async getNonce(blockTag) {
    if (blockTag && blockTag !== "pending") return super.getNonce(blockTag);
    // "latest" (confirmed), not "pending" (mempool-inclusive) — this node's
    // pending-nonce accounting is exactly what drifted before, queuing every
    // later send behind a gap that was never real. Every call site here
    // awaits full confirmation before its next send, so there is never an
    // actual in-flight transaction "pending" needs to account for.
    if (this.#next === null) this.#next = await super.getNonce("latest");
    return this.#next++;
  }

  // getNonce() reserves a number the instant it's called — before gas is
  // estimated, before the node has seen the transaction at all. A call that
  // reverts during estimation (a rejected recipient, a wrong stage, any
  // ordinary business-logic refusal) throws *after* that reservation, so the
  // number it claimed was never actually spent on chain. Left uncorrected,
  // every later send from this signer queues forever behind a gap that
  // doesn't exist — a stuck action for reasons that have nothing to do with
  // the action itself. Dropping the cache here means the next call re-reads
  // the real value instead of trusting a count a failure just invalidated.
  async sendTransaction(tx) {
    try {
      return await super.sendTransaction(tx);
    } catch (err) {
      this.#next = null;
      throw err;
    }
  }
}

const walletCache = new Map();

export function wallet(index, prov) {
  if (walletCache.has(index)) return walletCache.get(index);
  const node = ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  const managed = new TrackedWallet(node.privateKey, prov);
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
