// Loads every page in a real browser and fails on anything a user would notice:
// a console error, an uncaught rejection, a request that 404s, or a view that
// renders empty. Screenshots prove a page looked right once; this proves every
// page still works after a change.
//
// Drives Chrome over the DevTools Protocol using Node's built-in WebSocket, so it
// adds no dependency. Run with `npm run checkui` against a serving stack.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.TERRAVANE_URL ?? "http://127.0.0.1:4300";
const PORT = 9333;

// Optional: `node scripts/checkui.js --shots docs` writes a full page capture of
// every page it checks, so the documentation images come from the same run that
// proved the pages work.
const SHOT_DIR = (() => {
  const at = process.argv.indexOf("--shots");
  return at === -1 ? null : process.argv[at + 1] ?? "docs";
})();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`no Chrome found; set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`);
  return found;
}

/** Minimal DevTools Protocol client: one socket, one id counter, no library. */
class Session {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("devtools socket failed")), { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
        return;
      }
      for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  close() {
    this.ws?.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // browser still starting
    }
    await sleep(250);
  }
  throw new Error("Chrome never opened its debugging port");
}

// Every page, with what has to be true once it has settled.
const PAGES = [
  { path: "/index.html", needs: ["Terravane"], selector: "#signin-root", auth: false, shot: "signin" },
  { path: "/dashboard.html", needs: [], selector: "#main", auth: true, shot: "dashboard" },
  { path: "/inventory.html", needs: [], selector: "#main", auth: true, shot: "inventory" },
  { path: "/search.html?q=rice", needs: [], selector: "#main", auth: true },
  { path: "/lot.html?id=5&tab=overview", needs: ["Mango"], selector: "#tab-body", auth: true, shot: "lot" },
  { path: "/lot.html?id=5&tab=route", needs: ["km"], selector: "#tab-body", auth: true, shot: "route" },
  { path: "/lot.html?id=5&tab=timeline", needs: [], selector: "#tab-body", auth: true },
  { path: "/lot.html?id=9&tab=lineage", needs: [], selector: "#tab-body", auth: true, shot: "lineage" },
  { path: "/lot.html?id=5&tab=cold", needs: [], selector: "#tab-body", auth: true },
  { path: "/lot.html?id=5&tab=actions", needs: [], selector: "#tab-body", auth: true },
  { path: "/register.html", needs: [], selector: "#main", auth: "farmer" },
  { path: "/inspect.html", needs: [], selector: "#main", auth: "inspector", shot: "inspect" },
  { path: "/notifications.html", needs: [], selector: "#main", auth: true },
  { path: "/trace.html?id=5", needs: ["Mango"], selector: "#root", auth: false, shot: "trace", width: 900 },
  { path: "/trace.html?id=9", needs: [], selector: "#root", auth: false },
  { path: "/label.html?id=5", needs: ["LOT"], selector: "#root", auth: false, shot: "label", width: 900 }
];

const IGNORABLE = [/favicon/i, /DevTools/i];

async function main() {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "terravane-ui-"));

  const browser = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1440,1000",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  let failures = 0;
  let checked = 0;

  try {
    await waitForDevtools();

    // Pick the participants the signed-in pages will act as.
    const participants = await (await fetch(`${BASE}/api/participants`)).json();
    const pick = (role) => participants.find((p) => p.roles.includes(role) && p.active);
    const identities = {
      true: pick("farmer") ?? participants[0],
      farmer: pick("farmer"),
      inspector: pick("inspector")
    };
    if (!identities.farmer || !identities.inspector) throw new Error("chain has no farmer or inspector to act as");

    console.log(`checking ${PAGES.length} pages against ${BASE}\n`);

    for (const spec of PAGES) {
      const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
      const session = new Session(target.webSocketDebuggerUrl);
      await session.open();

      const problems = [];
      session.on("Runtime.exceptionThrown", (p) => {
        problems.push(`uncaught: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`);
      });
      session.on("Runtime.consoleAPICalled", (p) => {
        if (p.type !== "error") return;
        const text = p.args.map((a) => a.description ?? a.value ?? "").join(" ");
        if (IGNORABLE.some((re) => re.test(text))) return;
        problems.push(`console: ${text}`);
      });
      session.on("Log.entryAdded", (p) => {
        if (p.entry.level !== "error") return;
        if (IGNORABLE.some((re) => re.test(p.entry.text) || re.test(p.entry.url ?? ""))) return;
        problems.push(`${p.entry.source}: ${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ""}`);
      });

      await session.send("Runtime.enable");
      await session.send("Log.enable");
      await session.send("Page.enable");
      await session.send("Network.enable");

      // Seed the session before any script runs, so an authenticated page does
      // not bounce to the door on its first paint.
      const identity = identities[String(spec.auth)];
      if (spec.auth && identity) {
        await session.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `try { localStorage.setItem("terravane.session", ${JSON.stringify(JSON.stringify(identity))}); } catch (e) {}`
        });
      }

      await session.send("Page.navigate", { url: `${BASE}${spec.path}` });
      await sleep(2600);

      const { result } = await session.send("Runtime.evaluate", {
        expression: `(() => {
          const host = document.querySelector(${JSON.stringify(spec.selector)});
          return JSON.stringify({
            url: location.pathname + location.search,
            filled: host ? host.textContent.trim().length : -1,
            body: document.body.innerText.slice(0, 4000),
            wide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
          });
        })()`,
        returnByValue: true
      });
      const state = JSON.parse(result.value);

      if (state.filled === -1) problems.push(`selector ${spec.selector} never appeared`);
      else if (state.filled < 20) problems.push(`view ${spec.selector} rendered empty`);
      if (state.wide) problems.push("page scrolls horizontally");
      if (spec.auth && !state.url.startsWith(spec.path.split("?")[0])) problems.push(`redirected to ${state.url}`);
      for (const needle of spec.needs) {
        if (!state.body.includes(needle)) problems.push(`expected to see "${needle}"`);
      }

      if (SHOT_DIR && spec.shot) {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const metrics = await session.send("Page.getLayoutMetrics");
        const width = spec.width ?? 1440;
        const height = Math.min(Math.ceil(metrics.cssContentSize.height), 2400);
        await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        const shot = await session.send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(SHOT_DIR, `${spec.shot}.png`), Buffer.from(shot.data, "base64"));
        await session.send("Emulation.clearDeviceMetricsOverride");
      }

      checked++;
      if (problems.length) {
        failures++;
        console.log(`  FAIL  ${spec.path}`);
        for (const problem of problems) console.log(`          ${problem}`);
      } else {
        console.log(`  ok    ${spec.path}`);
      }

      session.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
    }
  } finally {
    // Chrome writes to its profile as it shuts down, so wait for it to actually
    // exit before clearing the directory out from under it.
    browser.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), sleep(5000)]);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // a leftover temp profile is untidy, not a failure of the thing under test
    }
  }

  console.log(`\n${checked - failures}/${checked} pages clean`);
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(`\nui check failed: ${err.message}`);
  process.exit(1);
});
