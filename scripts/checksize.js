// Fails the build if a contract grows past the EIP-170 deployment limit.
// ProduceRegistry runs close to it, so this is a real gate and not a formality.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/chain.js";

const LIMIT = 24576;
const CONTRACTS = ["AccessRegistry", "ProduceRegistry"];

let failed = false;

for (const name of CONTRACTS) {
  const file = path.join(ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.error(`${name}: no artifact, run "npm run compile" first`);
    process.exit(1);
  }
  const { deployedBytecode } = JSON.parse(fs.readFileSync(file, "utf8"));
  const size = (deployedBytecode.length - 2) / 2;
  const spare = LIMIT - size;
  const status = spare < 0 ? "OVER LIMIT" : `${spare} bytes spare`;
  console.log(`${name.padEnd(18)} ${String(size).padStart(6)} bytes   ${status}`);
  if (spare < 0) failed = true;
}

if (failed) {
  console.error(`\nat least one contract exceeds the ${LIMIT} byte limit and cannot be deployed`);
  process.exit(1);
}
