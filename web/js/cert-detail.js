import { CERT_SCHEME_SLUGS } from "./api.js";
import { badge, el, modal, onDay, t } from "./ui.js";

/**
 * The certification sheet, shared by the console dossier and the public trace
 * page. A scheme name on its own — "NPOP Organic", "GlobalGAP" — is only
 * meaningful to someone who already knows the schemes, which is nobody the
 * trace page is written for. This puts what the ledger recorded next to what
 * the scheme is actually a claim about.
 */

function rows(pairs) {
  return el("dl", { class: "grid sm:grid-cols-[150px_minmax(0,1fr)] gap-x-5 gap-y-2.5 m-0" },
    pairs.filter(Boolean).flatMap(([key, value]) => [
      el("dt", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/80 pt-0.5", text: key }),
      el("dd", { class: "font-body-md text-body-sm text-on-surface m-0 break-words" }, value)
    ])
  );
}

function section(title, body) {
  return el("section", { class: "grid gap-3" }, [
    el("h3", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant", text: title }),
    body
  ]);
}

function statusBadge(cert) {
  if (cert.revoked) return badge(t("certd.revoked"), "bad");
  if (!cert.active) return badge(t("certd.expired"), "warn");
  return badge(t("certd.active"), "good");
}

/** Prose about the scheme itself, or an honest note when this build has none. */
function schemeSection(scheme) {
  const slug = CERT_SCHEME_SLUGS[scheme];
  if (!slug) {
    return section(t("certd.whatItMeans"),
      el("p", { class: "font-body-md text-body-sm text-on-surface-variant", text: t("certd.unknownScheme") })
    );
  }
  return section(t("certd.whatItMeans"),
    rows([
      [t("certd.authority"), t(`scheme.${slug}.authority`)],
      [t("certd.covers"), t(`scheme.${slug}.covers`)],
      [t("certd.requires"), t(`scheme.${slug}.requires`)]
    ])
  );
}

/**
 * @param cert   one entry from a dossier's certifications or farmCertifications
 * @param scope  "lot" or "farm" — since a farm-level certification says
 *               something about the farm and not about this particular lot,
 *               and the reader should know which. Null omits the line.
 */
export function openCertificate(cert, scope = null) {
  const mono = (text) => el("span", { class: "font-mono text-[12px] break-all", text });

  return modal(cert.scheme, [
    section(t("certd.onLedger"),
      rows([
        [t("certd.status"), statusBadge(cert)],
        [t("certd.certifier"), cert.certifier?.name ?? "-"],
        scope ? [t("certd.scope"), t(scope === "farm" ? "certd.scopeFarm" : "certd.scopeLot")] : null,
        [t("certd.issued"), cert.issuedAt ? onDay(cert.issuedAt) : "-"],
        [t("certd.expires"), cert.expiresAt ? onDay(cert.expiresAt) : t("certd.noExpiry")],
        cert.revoked && cert.revocationReason
          ? [t("certd.revocationReason"), cert.revocationReason]
          : null,
        // Rendered as text rather than a link on purpose: this string comes off
        // the ledger, and the trace page is public — a certifier should not be
        // able to put a live outbound link in front of a shopper.
        cert.evidenceURI ? [t("certd.evidence"), mono(cert.evidenceURI)] : null,
        cert.evidenceHash ? [t("certd.evidenceHash"), mono(cert.evidenceHash)] : null
      ])
    ),

    cert.evidenceHash
      ? el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/80 leading-relaxed", text: t("certd.evidenceNote") })
      : null,

    el("hr", { class: "border-0 border-t border-outline-variant/60 m-0" }),

    schemeSection(cert.scheme)
  ]);
}

/**
 * Wraps a certification row so it opens the sheet — the row keeps whatever
 * markup the page already gave it and gains the button semantics it needs to
 * be reachable from the keyboard.
 */
export function certificationRow(cert, children, { scope = null, extra = "" } = {}) {
  return el("button", {
    type: "button",
    class: `w-full text-left transition-colors hover:bg-primary/5 ${extra}`,
    "aria-label": `${cert.scheme} — ${t("certd.openHint")}`,
    onclick: () => openCertificate(cert, scope)
  }, children);
}
