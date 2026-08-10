import { el } from "./ui.js";

// Two figures, both drawn as plain SVG. No chart library: the shapes are a line
// with a band behind it and a layered graph, and a dependency to draw either one
// would be larger than both.

const NS = "http://www.w3.org/2000/svg";

const INK = "#1c2420";
const MUTED = "#6e7a72";
const GRID = "#e0dac6";
const PRIMARY = "#006947";
const DANGER = "#a13a2c";
const BAND = "rgba(0,105,71,0.09)";
const BAND_EDGE = "rgba(0,105,71,0.3)";

function svgNode(parent, tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

function text(parent, x, y, content, { size = 9, fill = MUTED, anchor = "start", mono = false } = {}) {
  const node = svgNode(parent, "text", {
    x,
    y,
    fill,
    "font-size": size,
    "text-anchor": anchor,
    "font-family": mono ? "'JetBrains Mono', ui-monospace, monospace" : "'Work Sans', sans-serif"
  });
  node.textContent = content;
  return node;
}

/**
 * Temperature over time with the lot's permitted band drawn behind it. Readings
 * outside the band are larger and red, because that is the only thing on this
 * chart anybody needs to find in a hurry.
 */
export function temperatureChart(readings, window, { width = 720, height = 220 } = {}) {
  if (!readings.length) return null;

  const pad = { top: 16, right: 16, bottom: 26, left: 42 };
  const temps = readings.map((r) => r.tempC);
  const lo = Math.min(...temps, window ? window[0] : Infinity);
  const hi = Math.max(...temps, window ? window[1] : -Infinity);
  const span = hi - lo || 1;
  const min = lo - span * 0.18;
  const max = hi + span * 0.18;

  const x = (i) => pad.left + (i / Math.max(readings.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "figure");

  svgNode(svg, "rect", { x: 0, y: 0, width, height, fill: "#faf8f0", rx: 8 });

  if (window) {
    svgNode(svg, "rect", {
      x: pad.left,
      y: y(window[1]),
      width: width - pad.left - pad.right,
      height: Math.max(y(window[0]) - y(window[1]), 1),
      fill: BAND,
      stroke: BAND_EDGE
    });
  }

  for (const value of [min, (min + max) / 2, max]) {
    svgNode(svg, "line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), stroke: GRID });
    text(svg, pad.left - 7, y(value) + 3, value.toFixed(1), { anchor: "end", mono: true });
  }

  svgNode(svg, "polyline", {
    points: readings.map((r, i) => `${x(i)},${y(r.tempC)}`).join(" "),
    fill: "none",
    stroke: PRIMARY,
    "stroke-width": "1.75",
    "stroke-linejoin": "round"
  });

  readings.forEach((r, i) => {
    svgNode(svg, "circle", {
      cx: x(i),
      cy: y(r.tempC),
      r: r.excursion ? 4.5 : 2.75,
      fill: r.excursion ? DANGER : PRIMARY,
      stroke: "#ffffff",
      "stroke-width": r.excursion ? 1.5 : 1
    });
  });

  if (readings.length > 1) {
    text(svg, pad.left, height - 8, formatShort(readings[0].observedAt), { mono: true });
    text(svg, width - pad.right, height - 8, formatShort(readings[readings.length - 1].observedAt), {
      anchor: "end",
      mono: true
    });
  }

  return svg;
}

function formatShort(seconds) {
  if (!seconds) return "";
  return new Date(Number(seconds) * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/**
 * The transformation graph. Depth is the longest path from any root inside the
 * sub-graph, so a lot always sits to the right of everything it came from.
 */
export function lineageGraph(graph, onSelect) {
  if (!graph.nodes.length) return null;

  const parents = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const edge of graph.edges) parents.get(edge.to)?.push(edge.from);

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
  for (const node of graph.nodes) {
    const d = depth.get(node.id);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(node);
  }

  const colWidth = 208;
  const rowHeight = 74;
  const boxW = 168;
  const boxH = 56;
  const width = Math.max(columns.size * colWidth, 320);
  const height = Math.max(...[...columns.values()].map((c) => c.length)) * rowHeight + 24;

  const pos = new Map();
  for (const [d, nodes] of columns) {
    nodes.forEach((node, i) => pos.set(node.id, { x: d * colWidth + 14, y: i * rowHeight + 14 }));
  }

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "figure");
  svg.style.maxHeight = `${height}px`;

  for (const edge of graph.edges) {
    const a = pos.get(edge.from);
    const b = pos.get(edge.to);
    if (!a || !b) continue;
    const x1 = a.x + boxW;
    const y1 = a.y + boxH / 2;
    const x2 = b.x;
    const y2 = b.y + boxH / 2;
    svgNode(svg, "path", {
      d: `M${x1},${y1} C${x1 + 26},${y1} ${x2 - 26},${y2} ${x2},${y2}`,
      fill: "none",
      stroke: "#cfc6a8",
      "stroke-width": "1.4"
    });
  }

  for (const node of graph.nodes) {
    const p = pos.get(node.id);
    const group = document.createElementNS(NS, "g");
    group.style.cursor = onSelect ? "pointer" : "default";
    if (onSelect) group.addEventListener("click", () => onSelect(node.id));

    svgNode(group, "rect", {
      x: p.x,
      y: p.y,
      width: boxW,
      height: boxH,
      rx: 8,
      fill: node.isFocus ? "#eef5ef" : "#ffffff",
      stroke: node.recalled ? DANGER : node.isFocus ? PRIMARY : "#dcd5bf",
      "stroke-width": node.isFocus ? 1.8 : 1
    });

    const title = document.createElementNS(NS, "text");
    title.setAttribute("x", p.x + 12);
    title.setAttribute("y", p.y + 22);
    title.setAttribute("fill", node.recalled ? DANGER : INK);
    title.setAttribute("font-size", "12");
    title.setAttribute("font-family", "'JetBrains Mono', ui-monospace, monospace");
    title.textContent = `#${node.id} ${node.produceType}`;
    group.append(title);

    text(group, p.x + 12, p.y + 39, `${Number(node.quantity).toLocaleString()} ${node.unit}`, { size: 10.5 });
    text(group, p.x + boxW - 12, p.y + 39, node.stageName, { size: 10.5, anchor: "end" });

    svg.append(group);
  }

  return svg;
}

/** Both figures scroll inside their own box rather than widening the page. */
export function figureBox(node, fallback) {
  if (!node) return el("div", { class: "px-6 py-10 text-center font-body-sm text-body-sm text-on-surface-variant/70", text: fallback });
  return el("div", { class: "overflow-x-auto" }, node);
}
