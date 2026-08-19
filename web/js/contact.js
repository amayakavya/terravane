import { api } from "./api.js";
import { button, el, field, icon, input, modal, t, toast } from "./ui.js";

/**
 * Reaching a farmer or organisation outside the ledger — for a certifier who
 * wants a document the chain doesn't hold, or an inspector who needs to ask
 * a question before they sign anything. Contact details are off-chain and
 * self-declared: nobody but the participant themself can set their own, so a
 * card here always shows what that party chose to share, never a claim made
 * about them by whoever is looking.
 */

function contactLink(kind, value) {
  if (!value) return null;
  const href = kind === "email" ? `mailto:${value}` : `tel:${value.replace(/[^+\d]/g, "")}`;
  return el("a", {
    href,
    class: "flex items-center gap-2.5 rounded-lg border border-outline-variant/70 px-3.5 py-2.5 " +
      "font-body-md text-body-sm text-on-surface hover:border-primary hover:text-primary transition-colors"
  }, [
    el("span", { class: "shrink-0 text-on-surface-variant", html: icon(kind === "email" ? "mail" : "phone_iphone", { size: 17 }) }),
    el("span", { class: "truncate", text: value })
  ]);
}

/**
 * @param who    a who()-shaped participant (address, name, email, phone, ...)
 * @param label  what this party's relationship to the lot is, e.g. "Origin farm"
 */
export function contactCard(who, label) {
  if (!who?.address) return null;
  const links = [contactLink("email", who.email), contactLink("phone", who.phone)].filter(Boolean);

  return el("div", { class: "grid gap-2.5" }, [
    el("p", { class: "font-label-sm text-[11px] tracking-widest uppercase text-on-surface-variant/80", text: label }),
    el("p", { class: "font-body-md text-body-sm font-medium text-on-surface", text: who.name ?? "-" }),
    links.length
      ? el("div", { class: "grid gap-2", "data-testid": "contact-links" }, links)
      : el("p", { class: "font-body-sm text-[12px] text-on-surface-variant/70", text: t("contact.none") })
  ]);
}

/** Opens the self-edit sheet for the signed-in participant's own contact details. */
export function openEditContact(me, onSaved) {
  const emailField = input({ type: "email", value: me.email ?? "", placeholder: t("contact.emailPlaceholder"), autocomplete: "email" });
  const phoneField = input({ type: "tel", value: me.phone ?? "", placeholder: t("contact.phonePlaceholder"), autocomplete: "tel" });
  const error = el("p", { class: "font-body-sm text-[12px] text-error hidden" });

  const save = button(t("contact.save"), {
    onclick: async () => {
      save.disabled = true;
      error.classList.add("hidden");
      try {
        const result = await api.setContact(me.address, { as: me.address, email: emailField.value, phone: phoneField.value });
        close();
        toast(t("contact.saved"));
        onSaved?.(result);
      } catch (err) {
        error.textContent = err.message;
        error.classList.remove("hidden");
      } finally {
        save.disabled = false;
      }
    }
  });

  const close = modal(t("contact.editTitle"), [
    field(t("contact.email"), emailField),
    field(t("contact.phone"), phoneField),
    error,
    el("div", { class: "flex justify-end gap-2.5" }, [save])
  ], { subtitle: t("contact.editSubtitle") });
}
