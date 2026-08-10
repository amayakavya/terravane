export const STAGES = ["Harvested", "Processed", "Packed", "In transit", "At retail", "Sold", "Destroyed"];

export async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status} ${res.statusText}`);
  return res.json();
}

export async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function when(seconds) {
  if (!seconds) return "-";
  const d = new Date(Number(seconds) * 1000);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ago(seconds) {
  if (!seconds) return "";
  const delta = Date.now() / 1000 - Number(seconds);
  const units = [
    [86400 * 365, "y"],
    [86400 * 30, "mo"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"]
  ];
  for (const [size, label] of units) {
    if (delta >= size) return `${Math.floor(delta / size)}${label} ago`;
  }
  return "just now";
}

export function qty(value, unit) {
  const n = Number(value);
  return `${n.toLocaleString()} ${unit ?? ""}`.trim();
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Flags a batch carries, worst first. Shared so the console and trace agree. */
export function flags(batch) {
  const out = [];
  if (batch.recalled) out.push({ cls: "bad", text: "recalled" });
  if (batch.stage === 6) out.push({ cls: "bad", text: "destroyed" });
  if (batch.coldChainBreached) out.push({ cls: "warn", text: "cold chain" });
  if (!batch.custodyIntact) out.push({ cls: "warn", text: "custody gap" });
  if (batch.counts?.failedInspections > 0) out.push({ cls: "warn", text: "failed check" });
  if (Number(batch.quantity) === 0 && batch.children?.length) out.push({ cls: "info", text: "consumed" });
  if (batch.counts?.activeCertifications > 0) out.push({ cls: "ok", text: `${batch.counts.activeCertifications} cert` });
  return out;
}

/** A small line chart with the permitted temperature band drawn behind it. */
export function temperatureChart(readings, window) {
  const width = 640;
  const height = 180;
  const pad = { top: 14, right: 14, bottom: 24, left: 38 };

  if (!readings.length) return el("div", { class: "empty", text: "No sensor readings on this lot." });

  const temps = readings.map((r) => r.tempC);
  const lo = Math.min(...temps, window ? window[0] : Infinity);
  const hi = Math.max(...temps, window ? window[1] : -Infinity);
  const span = hi - lo || 1;
  const min = lo - span * 0.15;
  const max = hi + span * 0.15;

  const x = (i) => pad.left + (i / Math.max(readings.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (t) => pad.top + (1 - (t - min) / (max - min)) * (height - pad.top - pad.bottom);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart");

  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };

  if (window) {
    add("rect", {
      x: pad.left,
      y: y(window[1]),
      width: width - pad.left - pad.right,
      height: Math.max(y(window[0]) - y(window[1]), 1),
      fill: "rgba(110,231,160,0.08)",
      stroke: "rgba(110,231,160,0.25)"
    });
  }

  for (const value of [min, (min + max) / 2, max]) {
    add("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), stroke: "#1f2723" });
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", pad.left - 6);
    label.setAttribute("y", y(value) + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "#5d6a61");
    label.setAttribute("font-size", "9");
    label.setAttribute("font-family", "ui-monospace, monospace");
    label.textContent = value.toFixed(1);
    svg.append(label);
  }

  add("polyline", {
    points: readings.map((r, i) => `${x(i)},${y(r.tempC)}`).join(" "),
    fill: "none",
    stroke: "#7fb3f0",
    "stroke-width": "1.5"
  });

  readings.forEach((r, i) => {
    add("circle", {
      cx: x(i),
      cy: y(r.tempC),
      r: r.excursion ? 4 : 2.5,
      fill: r.excursion ? "#f0736a" : "#7fb3f0"
    });
  });

  return svg;
}

/** Layered DAG: depth is the longest path from any root inside the sub-graph. */
export function drawLineage(graph, onClick) {
  if (!graph.nodes.length) return el("div", { class: "empty", text: "No lineage recorded." });

  const parents = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) parents.get(e.to)?.push(e.from);

  const depth = new Map();
  const resolve = (id, guard = 0) => {
    if (depth.has(id)) return depth.get(id);
    if (guard > 32) return 0;
    const ps = parents.get(id) ?? [];
    const value = ps.length ? Math.max(...ps.map((p) => resolve(p, guard + 1))) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  graph.nodes.forEach((n) => resolve(n.id));

  const columns = new Map();
  for (const n of graph.nodes) {
    const d = depth.get(n.id);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(n);
  }

  const colWidth = 190;
  const rowHeight = 62;
  const boxW = 150;
  const boxH = 46;
  const width = Math.max(columns.size * colWidth, 300);
  const height = Math.max(...[...columns.values()].map((c) => c.length)) * rowHeight + 20;

  const pos = new Map();
  for (const [d, nodes] of columns) {
    nodes.forEach((n, i) => pos.set(n.id, { x: d * colWidth + 12, y: i * rowHeight + 12 }));
  }

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart");
  svg.style.maxHeight = `${height}px`;

  for (const e of graph.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const path = document.createElementNS(ns, "path");
    const x1 = a.x + boxW;
    const y1 = a.y + boxH / 2;
    const x2 = b.x;
    const y2 = b.y + boxH / 2;
    path.setAttribute("d", `M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#2a352e");
    svg.append(path);
  }

  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    const g = document.createElementNS(ns, "g");
    g.style.cursor = "pointer";
    if (onClick) g.addEventListener("click", () => onClick(n.id));

    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", p.x);
    rect.setAttribute("y", p.y);
    rect.setAttribute("width", boxW);
    rect.setAttribute("height", boxH);
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", n.isFocus ? "#17231c" : "#121613");
    rect.setAttribute("stroke", n.recalled ? "#5a2a26" : n.isFocus ? "#2f6f4c" : "#1f2723");
    g.append(rect);

    const title = document.createElementNS(ns, "text");
    title.setAttribute("x", p.x + 10);
    title.setAttribute("y", p.y + 19);
    title.setAttribute("fill", n.recalled ? "#f0736a" : "#e6ece7");
    title.setAttribute("font-size", "11");
    title.setAttribute("font-family", "ui-monospace, monospace");
    title.textContent = `#${n.id} ${n.produceType}`;
    g.append(title);

    const sub = document.createElementNS(ns, "text");
    sub.setAttribute("x", p.x + 10);
    sub.setAttribute("y", p.y + 34);
    sub.setAttribute("fill", "#5d6a61");
    sub.setAttribute("font-size", "10");
    sub.textContent = `${Number(n.quantity).toLocaleString()} ${n.unit} · ${n.stageName}`;
    g.append(sub);

    svg.append(g);
  }

  return svg;
}
