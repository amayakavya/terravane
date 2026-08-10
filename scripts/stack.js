// One command to bring the whole thing up: chain, contracts, seed data, API.
// Ctrl-C takes it all down again.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, RPC_URL } from "./lib/chain.js";

const children = [];

function run(label, command, args, opts = {}) {
  const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", ...opts });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null && !shuttingDown) {
      console.error(`\n${label} exited with code ${code}`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

function once(label, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed with code ${code}`))));
  });
}

async function waitForRpc(timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })
      });
      if (res.ok) return;
    } catch {
      // node not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no RPC at ${RPC_URL} after ${timeoutMs}ms`);
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));

const fresh = process.argv.includes("--fresh");

async function main() {
  if (fresh) {
    fs.rmSync(path.join(ROOT, "data"), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, "deployments"), { recursive: true, force: true });
    console.log("cleared previous index and deployment\n");
  }

  console.log("compiling contracts");
  await once("compile", "npx", ["hardhat", "compile"]);

  console.log("\nstarting local chain");
  run("chain", "npx", ["hardhat", "node"], { stdio: "ignore" });
  await waitForRpc();

  console.log("\ndeploying");
  await once("deploy", "node", ["scripts/deploy.js"]);

  console.log("\nseeding a season of trade");
  await once("seed", "node", ["scripts/seed.js"]);

  console.log("\nstarting api and console\n");
  run("server", "node", ["server/index.js"]);
}

main().catch((err) => {
  console.error(`\nstack failed: ${err.message}`);
  shutdown(1);
});
