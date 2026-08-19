import { api } from "./api.js";
import { badge, card, cardHeader, clear, el, mount, t } from "./ui.js";

// The desk briefing, in two passes. The figures come back immediately and are
// drawn first; the model's sentences arrive when they arrive and replace the
// placeholder above them. The figures never move, and never wait on the model.
//
// This is why the panel is honest under every configuration: with the model
// switched off, or not installed, or simply slow, what is on screen is the
// counted state of the desk. The prose is a convenience laid over it, and the
// panel says which of the two it is showing.
//
// This now lives in the dashboard's narrow right column, beside the network
// map, rather than full width above everything — it used to push the whole
// page down before a reader reached anything actionable. A narrow column
// wants short dense rows, not padded stat tiles, so the figures stay a
// compact list, just tighter than the original.

const TONE_DOT = { neutral: "bg-outline", warn: "bg-gold", bad: "bg-error", good: "bg-primary" };

function figureRow(f) {
  return el("li", { class: "flex items-start gap-2.5 py-1.5" }, [
    el("span", { class: `mt-[6px] h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[f.tone] ?? TONE_DOT.neutral}` }),
    el("div", { class: "min-w-0 flex-1" }, [
      el("p", { class: "font-body-sm text-[12.5px] text-on-surface leading-snug" }, [
        el("span", { text: f.label }),
        el("span", { class: "text-on-surface-variant", text: " · " }),
        el("span", { class: "font-label-md tabular-nums", text: String(f.value) })
      ]),
      f.detail ? el("p", { class: "font-body-sm text-[11px] text-on-surface-variant/70 break-words", text: f.detail }) : null
    ])
  ]);
}

export function briefingCard(me) {
  const prose = el("div", { class: "px-5 pt-4" }, [
    el("p", { class: "font-body-md text-body-sm text-on-surface-variant/70 italic", text: t("brief.reading") })
  ]);
  const figures = el("ul", { class: "px-5 pb-1 divide-y divide-outline-variant/40 m-0 list-none" });
  // Uppercase with wide tracking reads fine as a short "written by {model}"
  // caption, but this line is sometimes a full fallback sentence instead —
  // stretched that way, it wraps to twice the lines it needs.
  const provenance = el("p", { class: "px-5 pb-4 pt-2 font-body-sm text-[11px] leading-snug text-on-surface-variant/60" });
  const stamp = badge(t("brief.figuresOnly"), "neutral");

  const panel = card([cardHeader(t("brief.title"), stamp), prose, figures, provenance], "rise-in mb-6");

  const paintFigures = (data) => {
    mount(figures, ...data.facts.map(figureRow));
    if (!data.facts.length) mount(prose, el("p", { class: "font-body-md text-body-sm text-on-surface", text: t("brief.nothing") }));
  };

  // Figures first and unconditionally; then the sentences, if a model answers.
  api
    .desk(me.address, { summarise: false })
    .then((data) => {
      paintFigures(data);
      return api.desk(me.address);
    })
    .then((data) => {
      paintFigures(data);
      if (data.summary) {
        mount(prose, el("p", { class: "font-body-md text-body-md text-on-surface leading-relaxed whitespace-pre-line", text: data.summary }));
        stamp.textContent = data.model;
        provenance.textContent = t("brief.writtenBy", { model: data.model });
      } else {
        clear(prose);
        // Say which kind of absence this is. "Switched off" and "nothing
        // answered on the port" are different facts and a desk should not
        // have to guess which one it is looking at.
        provenance.textContent = data.reason ? `${t("brief.noModel")} ${data.reason}` : t("brief.switchedOff");
      }
    })
    .catch(() => {
      clear(prose);
      provenance.textContent = t("brief.noModel");
    });

  return panel;
}
