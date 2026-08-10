import { OUTLINES } from "./basemap.js";
import { el } from "./api.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * Equirectangular projection fitted to a bounding box. Longitude is scaled by
 * cos(mean latitude) so a consignment moving east does not look stretched next to
 * one moving north. At the scale of a single country that is close enough to the
 * truth, and it needs no projection library.
 */
function fit(points, width, height, pad = 26, minSpan = 1.2) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const p of points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }

  // A single stop, or several in one town, would otherwise fit to a zero-size box.
  const midLon = (west + east) / 2;
  const midLat = (south + north) / 2;
  if (east - west < minSpan) {
    west = midLon - minSpan / 2;
    east = midLon + minSpan / 2;
  }
  if (north - south < minSpan) {
    south = midLat - minSpan / 2;
    north = midLat + minSpan / 2;
  }

  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (east - west) * kx;
  const spanY = north - south;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);

  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const project = (lat, lon) => [offsetX + (lon - west) * kx * scale, offsetY + (north - lat) * scale];
  project.scale = scale;
  project.kx = kx;
  project.bounds = { west, east, south, north };
  return project;
}

function node(parent, tag, attrs) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  parent.append(element);
  return element;
}

function drawLand(svg, project, width, height) {
  const { west, east, south, north } = project.bounds;
  const margin = 4; // degrees of slack so coastlines do not end mid-view

  for (const ring of OUTLINES) {
    let visible = false;
    for (let i = 0; i < ring.length; i += 2) {
      if (ring[i] > west - margin && ring[i] < east + margin && ring[i + 1] > south - margin && ring[i + 1] < north + margin) {
        visible = true;
        break;
      }
    }
    if (!visible) continue;

    let d = "";
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = project(ring[i + 1], ring[i]);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    node(svg, "path", { d: `${d}Z`, fill: "#111714", stroke: "#222c26", "stroke-width": "0.8" });
  }

  node(svg, "rect", { x: 0, y: 0, width, height, fill: "none", stroke: "#1f2723" });
}

/// Greedy label placement. Five participants around Delhi land within a few pixels
/// of each other, and stacked text is worse than no text: each label takes the
/// first candidate position that is clear, and is dropped outright if none is.
function makeLabeller(svg, width, height) {
  const placed = [];

  const overlaps = (a, b) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);

  return function label(x, y, text, { size = 10, fill = "#c7d2ca", gap = 6 } = {}) {
    const w = text.length * size * 0.55;
    const h = size + 2;

    const candidates = [
      { x: x + gap, y: y + size * 0.35, anchor: "start" },
      { x: x - gap, y: y + size * 0.35, anchor: "end" },
      { x, y: y - gap - 2, anchor: "middle" },
      { x, y: y + gap + size, anchor: "middle" }
    ];

    for (const spot of candidates) {
      const x1 = spot.anchor === "start" ? spot.x : spot.anchor === "end" ? spot.x - w : spot.x - w / 2;
      const box = { x1, x2: x1 + w, y1: spot.y - h, y2: spot.y + 2 };
      if (box.x1 < 2 || box.x2 > width - 2 || box.y1 < 2 || box.y2 > height - 20) continue;
      if (placed.some((other) => overlaps(box, other))) continue;

      placed.push(box);
      const node = document.createElementNS(NS, "text");
      node.setAttribute("x", spot.x.toFixed(1));
      node.setAttribute("y", spot.y.toFixed(1));
      node.setAttribute("fill", fill);
      node.setAttribute("font-size", String(size));
      node.setAttribute("text-anchor", spot.anchor);
      node.textContent = text;
      svg.append(node);
      return true;
    }
    return false;
  };
}

/** Great circle distance in kilometres. */
export function haversine(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function routeDistance(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += haversine(stops[i - 1], stops[i]);
  return total;
}

function scaleBar(svg, project, width, height) {
  // Pick a round number of kilometres that occupies roughly a fifth of the view.
  const kmPerDegree = 111.32;
  const pxPerKm = project.scale / kmPerDegree;
  const target = (width * 0.2) / pxPerKm;
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2000];
  const km = steps.find((s) => s >= target) ?? steps[steps.length - 1];
  const barWidth = km * pxPerKm;

  const y = height - 16;
  const x = 14;
  node(svg, "line", { x1: x, x2: x + barWidth, y1: y, y2: y, stroke: "#5d6a61", "stroke-width": "1.5" });
  node(svg, "line", { x1: x, x2: x, y1: y - 3, y2: y + 3, stroke: "#5d6a61" });
  node(svg, "line", { x1: x + barWidth, x2: x + barWidth, y1: y - 3, y2: y + 3, stroke: "#5d6a61" });

  const label = node(svg, "text", {
    x: x + barWidth + 6,
    y: y + 3,
    fill: "#5d6a61",
    "font-size": "9",
    "font-family": "ui-monospace, monospace"
  });
  label.textContent = `${km} km`;
}

const MARKER = {
  origin: { r: 5, fill: "#6ee7a0", stroke: "#0b0e0c" },
  handover: { r: 4, fill: "#7fb3f0", stroke: "#0b0e0c" },
  current: { r: 6, fill: "#e6ece7", stroke: "#0b0e0c" },
  reading: { r: 2.2, fill: "#3f6f8f", stroke: "none" },
  excursion: { r: 3.6, fill: "#f0736a", stroke: "#0b0e0c" }
};

/**
 * Draws a lot's route over the basemap.
 *
 * @param stops    ordered custody points, each {lat, lon, label, kind}
 * @param readings optional telemetry positions, each {lat, lon, excursion}
 */
export function journeyMap(stops, readings = [], { width = 640, height = 380, minSpan = 6.5 } = {}) {
  const located = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!located.length) {
    return el("div", { class: "empty", text: "No positions were recorded against this lot." });
  }

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart map");

  const all = [...located, ...readings.filter((r) => Number.isFinite(r.lat))];
  // A 200 km hop would otherwise fill the frame with empty land. Holding a floor
  // on the viewport keeps enough coastline in shot to tell you where you are.
  const project = fit(all, width, height, 26, minSpan);

  drawLand(svg, project, width, height);

  // Telemetry sits under the route: it is context, not the story.
  for (const reading of readings) {
    if (!Number.isFinite(reading.lat)) continue;
    const [x, y] = project(reading.lat, reading.lon);
    const style = reading.excursion ? MARKER.excursion : MARKER.reading;
    node(svg, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: style.r, fill: style.fill, stroke: style.stroke });
  }

  if (located.length > 1) {
    let d = "";
    located.forEach((stop, i) => {
      const [x, y] = project(stop.lat, stop.lon);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    node(svg, "path", { d, fill: "none", stroke: "#6ee7a0", "stroke-width": "1.6", "stroke-dasharray": "5 4", opacity: "0.75" });
  }

  const label = makeLabeller(svg, width, height);
  located.forEach((stop, i) => {
    const [x, y] = project(stop.lat, stop.lon);
    const kind = i === 0 ? "origin" : i === located.length - 1 ? "current" : "handover";
    const style = MARKER[kind];
    node(svg, "circle", {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: style.r,
      fill: style.fill,
      stroke: style.stroke,
      "stroke-width": "1.5"
    });
    if (stop.label) label(x, y, stop.label, { gap: style.r + 5 });
  });

  scaleBar(svg, project, width, height);
  return svg;
}

/** Every participant on one map, sized by how much they are currently holding. */
export function networkMap(participants, { width = 960, height = 470 } = {}) {
  const located = participants.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!located.length) return el("div", { class: "empty", text: "No participant positions on file." });

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart map");

  const project = fit(located, width, height, 34, 3);
  drawLand(svg, project, width, height);

  const ROLE_COLOUR = {
    farmer: "#6ee7a0",
    processor: "#e8b95a",
    distributor: "#7fb3f0",
    retailer: "#c58ff0",
    certifier: "#5d6a61",
    inspector: "#5d6a61",
    oracle: "#5d6a61",
    admin: "#5d6a61"
  };

  for (const p of located) {
    const [x, y] = project(p.lat, p.lon);
    const primary = p.roles.find((r) => ROLE_COLOUR[r]) ?? "admin";
    const colour = p.active ? ROLE_COLOUR[primary] : "#5a2a26";
    const r = 3.5 + Math.min(p.holding, 6) * 0.9;

    node(svg, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: r + 4, fill: colour, opacity: "0.12" });
    node(svg, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r, fill: colour, stroke: "#0b0e0c", "stroke-width": "1.2" });
  }

  // Labels come after every marker so none is drawn over, and the busiest nodes
  // claim their space first.
  const label = makeLabeller(svg, width, height);
  const byImportance = [...located].sort((a, b) => b.holding - a.holding);
  let dropped = 0;
  for (const p of byImportance) {
    const [x, y] = project(p.lat, p.lon);
    const r = 3.5 + Math.min(p.holding, 6) * 0.9;
    if (!label(x, y, p.name, { size: 9.5, fill: "#8d9a91", gap: r + 5 })) dropped++;
  }
  if (dropped) {
    const note = node(svg, "text", { x: width - 14, y: 20, fill: "#5d6a61", "font-size": "9", "text-anchor": "end" });
    note.textContent = `${dropped} label${dropped === 1 ? "" : "s"} hidden by crowding`;
  }

  scaleBar(svg, project, width, height);
  return svg;
}

/// Custody points in order: the farm gate, then wherever each accepted handover
/// was countersigned. A handover with no geohash falls back to the receiving
/// participant's own registered position, which is the honest approximation.
export function custodyStops(d) {
  const stops = [];
  const b = d.batch;

  if (Number.isFinite(b.origin.lat)) {
    stops.push({ lat: b.origin.lat, lon: b.origin.lon, label: b.origin.farm?.name ?? "Origin" });
  }
  for (const h of d.handovers) {
    if (!h.accepted) continue;
    const position = h.position ?? (Number.isFinite(h.to?.lat) ? { lat: h.to.lat, lon: h.to.lon } : null);
    if (!position) continue;
    stops.push({ lat: position.lat, lon: position.lon, label: h.to?.name ?? "Handover" });
  }
  return stops;
}
