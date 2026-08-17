import { OUTLINES } from "./basemap.js";
import { el } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * Equirectangular projection fitted to a bounding box. Longitude is scaled by
 * cos(mean latitude) so a consignment moving east does not look stretched next to
 * one moving north. At the scale of a single country that is close enough to the
 * truth, and it needs no projection library.
 */
function fitBounds(bounds, width, height, pad = 26) {
  const { west, east, south, north } = bounds;
  const midLat = (south + north) / 2;

  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (east - west) * kx;
  const spanY = north - south;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);

  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const project = (lat, lon) => [offsetX + (lon - west) * kx * scale, offsetY + (north - lat) * scale];
  project.scale = scale;
  project.kx = kx;
  project.bounds = bounds;
  return project;
}

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

  return fitBounds({ west, east, south, north }, width, height, pad);
}

// The country's real extent, not wherever the seeded participants happen to
// sit — Jammu & Kashmir has no enrolled participant in the demo data, and a
// data-fitted viewport was cropping it out of the network map entirely
// because nothing north of Karnal ever pulled the frame up that far.
const INDIA_BOUNDS = { west: 67.5, east: 98, south: 6.5, north: 36.5 };

/**
 * Nudge points that would otherwise land on top of each other apart, just
 * enough to read as separate markers. Runs after projection, in pixel space,
 * so it has no notion of geography — two cities 3km apart and two readings
 * logged at the same spot are both just "too close to tell apart" here.
 */
function declutter(points, minGap = 15, passes = 4) {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.5) {
          // Exactly coincident: nothing to push along, so pick a direction —
          // offset by index so three-or-more stacked points fan out rather
          // than two of them landing on the same nudge.
          const angle = (j * 2.4) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        if (dist < minGap) {
          const push = (minGap - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }
  return points;
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
    node(svg, "path", { d: `${d}Z`, fill: "#e9e3d0", stroke: "#cfc6a8", "stroke-width": "0.8" });
  }

  node(svg, "rect", { x: 0, y: 0, width, height, fill: "none", stroke: "#dcd5bf" });
}

/// Greedy label placement. Five participants around Delhi land within a few pixels
/// of each other, and stacked text is worse than no text: each label takes the
/// first candidate position that is clear, and is dropped outright if none is.
function makeLabeller(svg, width, height) {
  const placed = [];

  const overlaps = (a, b) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);

  return function label(x, y, text, { size = 10, fill = "#1c2420", gap = 6 } = {}) {
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
  node(svg, "line", { x1: x, x2: x + barWidth, y1: y, y2: y, stroke: "#6e7a72", "stroke-width": "1.5" });
  node(svg, "line", { x1: x, x2: x, y1: y - 3, y2: y + 3, stroke: "#6e7a72" });
  node(svg, "line", { x1: x + barWidth, x2: x + barWidth, y1: y - 3, y2: y + 3, stroke: "#6e7a72" });

  const label = node(svg, "text", {
    x: x + barWidth + 6,
    y: y + 3,
    fill: "#6e7a72",
    "font-size": "9",
    "font-family": "ui-monospace, monospace"
  });
  label.textContent = `${km} km`;
}

const MARKER = {
  origin: { r: 5, fill: "#006947", stroke: "#ffffff" },
  handover: { r: 4, fill: "#43664d", stroke: "#ffffff" },
  current: { r: 6, fill: "#04241a", stroke: "#ffffff" },
  reading: { r: 2.2, fill: "#8ba793", stroke: "none" },
  excursion: { r: 3.6, fill: "#a13a2c", stroke: "#ffffff" }
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
  svg.setAttribute("class", "figure map rounded-lg");

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

  // Two custody stops close enough to fall on the same pixel — a processor
  // and a distributor headquartered in the same city, say — would otherwise
  // print as a single dot with the route line vanishing into it. Spread the
  // stops themselves apart; the telemetry trail underneath stays exactly
  // where it was recorded, since nudging it would misstate the reading.
  const stopMarks = located.map((stop, i) => {
    const [x, y] = project(stop.lat, stop.lon);
    return { stop, x, y, kind: i === 0 ? "origin" : i === located.length - 1 ? "current" : "handover" };
  });
  declutter(stopMarks, 20);

  if (stopMarks.length > 1) {
    let d = "";
    stopMarks.forEach((m, i) => {
      d += `${i === 0 ? "M" : "L"}${m.x.toFixed(1)},${m.y.toFixed(1)}`;
    });
    node(svg, "path", { d, fill: "none", stroke: "#006947", "stroke-width": "1.6", "stroke-dasharray": "5 4", opacity: "0.75" });
  }

  const label = makeLabeller(svg, width, height);
  stopMarks.forEach((m) => {
    const style = MARKER[m.kind];
    node(svg, "circle", {
      cx: m.x.toFixed(1),
      cy: m.y.toFixed(1),
      r: style.r,
      fill: style.fill,
      stroke: style.stroke,
      "stroke-width": "1.5"
    });
    if (m.stop.label) label(m.x, m.y, m.stop.label, { gap: style.r + 5 });
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
  svg.setAttribute("class", "figure map rounded-lg");

  // The whole country's frame, not just wherever these participants happen to
  // be — see INDIA_BOUNDS.
  const project = fitBounds(INDIA_BOUNDS, width, height, 34);
  drawLand(svg, project, width, height);

  const ROLE_COLOUR = {
    farmer: "#006947",
    processor: "#b6863b",
    distributor: "#43664d",
    retailer: "#7a5ea8",
    certifier: "#6e7a72",
    inspector: "#6e7a72",
    oracle: "#6e7a72",
    admin: "#6e7a72"
  };

  // Project once, then spread out anything sitting on top of a neighbour —
  // two head offices in the same city are common in this data — so every
  // marker and its label stay reachable rather than fused into one blob.
  const marks = located.map((p) => {
    const [x, y] = project(p.lat, p.lon);
    return { p, x, y, r: 3.5 + Math.min(p.holding, 6) * 0.9 };
  });
  declutter(marks, 16);

  for (const m of marks) {
    const primary = m.p.roles.find((r) => ROLE_COLOUR[r]) ?? "admin";
    const colour = m.p.active ? ROLE_COLOUR[primary] : "#a13a2c";
    node(svg, "circle", { cx: m.x.toFixed(1), cy: m.y.toFixed(1), r: m.r + 4, fill: colour, opacity: "0.12" });
    node(svg, "circle", { cx: m.x.toFixed(1), cy: m.y.toFixed(1), r: m.r, fill: colour, stroke: "#ffffff", "stroke-width": "1.2" });
  }

  // Labels come after every marker so none is drawn over, and the busiest nodes
  // claim their space first.
  const label = makeLabeller(svg, width, height);
  const byImportance = [...marks].sort((a, b) => b.p.holding - a.p.holding);
  let dropped = 0;
  for (const m of byImportance) {
    if (!label(m.x, m.y, m.p.name, { size: 9.5, fill: "#5b6058", gap: m.r + 5 })) dropped++;
  }
  if (dropped) {
    const note = node(svg, "text", { x: width - 14, y: 20, fill: "#6e7a72", "font-size": "9", "text-anchor": "end" });
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
