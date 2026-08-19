// Printed documents are filled templates, never generated markup. The layout of
// an invoice is a fixed thing that an accountant, a buyer's clerk and a court
// all expect to look the same every time; only the values in it change. So the
// templates live as whole HTML files next to this module, and this does nothing
// but substitute into them.
//
// The substitution is deliberately strict. A placeholder with no value is a
// template that has drifted from its caller, and shipping a document with
// "{{TOTAL}}" printed where the money goes is far worse than a 500.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

const cache = new Map();

function template(name) {
  // Read once per process, not once per request — but never in production only,
  // so a template edit during development still needs a restart either way.
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(DIR, `${name}.html`), "utf8"));
  return cache.get(name);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Fill a template. `{{KEY}}` is escaped; `{{{KEY}}}` is inserted as markup and
 * is only ever used for things this server generated itself, such as a QR code
 * SVG. Anything left unfilled throws rather than reaching the reader.
 */
export function render(name, values) {
  const missing = new Set();

  const filled = template(name)
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => {
      if (!(key in values)) return missing.add(key), "";
      return String(values[key] ?? "");
    })
    .replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in values)) return missing.add(key), "";
      return escapeHtml(values[key]);
    });

  if (missing.size) {
    throw new Error(`${name} template has placeholders nothing filled: ${[...missing].join(", ")}`);
  }
  return filled;
}

/** A filename a person can find again in six months of downloads. */
export function attachmentName(kind, batchId, index) {
  return `terravane-${kind}-lot-${String(batchId).padStart(6, "0")}-${String(index + 1).padStart(2, "0")}.html`;
}
