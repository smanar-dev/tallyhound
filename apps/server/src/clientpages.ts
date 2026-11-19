// What a client sees: the consent page, the upload page and the unsubscribe page. Written as React components and turned into
// plain HTML on the server, so they work with no script at all, weigh a few kilobytes, and everything from the firm or the
// client is escaped by React. No login: each page is reached by the client's own private link.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export interface FirmView { name: string; phone: string; page: string }
const frame = (title: string, firm: FirmView, body: ReactNode): string => "<!doctype html>" + renderToStaticMarkup(
  h("html", { lang: "en" },
    h("head", null, h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), h("meta", { name: "robots", content: "noindex, nofollow" }), h("title", null, title + " · " + firm.name), h("link", { rel: "stylesheet", href: "/client.css" })),
    h("body", null, h("main", null, h("p", { className: "firm" }, firm.name), body,
      h("footer", null, h("a", { href: firm.page + "#privacy" }, "Privacy"), " · ", h("a", { href: firm.page + "#terms" }, "Terms"), " · ", h("a", { href: firm.page + "#check" }, "Is this really from " + firm.name + "?"))))));
const call = (firm: FirmView) => (firm.phone ? ", or call " + firm.phone : "");

/** Any link that is wrong, old, or already finished with. Says nothing about whose it was. */
export const expiredPage = (firm: FirmView) => frame("This link has expired", firm, [
  h("h1", { key: 1 }, "This link has expired"), h("p", { key: 2 }, "Ask " + firm.name + " for a new one" + call(firm) + ".")]);
export const unknownPage = () => "<!doctype html>" + renderToStaticMarkup(h("html", { lang: "en" }, h("head", null, h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), h("meta", { name: "robots", content: "noindex, nofollow" }), h("title", null, "This link has expired"), h("link", { rel: "stylesheet", href: "/client.css" })),
  h("body", null, h("main", null, h("h1", null, "This link has expired"), h("p", null, "Ask your accounting firm for a new one, or call their office.")))));

export function consentPage(firm: FirmView, o: { action: string; wording: string; onFile: string; error?: string }) {
  return frame("Send your tax documents by text", firm, [
    h("h1", { key: 1 }, "Send your tax documents by text"), h("p", { key: 2 }, "Take a photo and reply. No app, no password."),
    o.error ? h("p", { key: 3, className: "err", role: "alert" }, o.error) : null,
    h("form", { key: 4, method: "post", action: o.action },
      h("label", { htmlFor: "mobile" }, "Mobile number"),
      // The number on file is never shown in full to whoever holds the link: only its last four digits, and an empty box means "use that one".
      h("input", { id: "mobile", name: "mobile", type: "tel", inputMode: "tel", autoComplete: "tel-national", required: !o.onFile, placeholder: o.onFile ? "(•••) •••-" + o.onFile : undefined, "aria-describedby": "wording" }),
      o.onFile ? h("p", { className: "muted small" }, "We have a number for you ending " + o.onFile + ". Leave the box empty to use it, or type a different one.") : null,
      h("p", { id: "wording", className: "wording" }, o.wording),
      h("button", { className: "btn pri", name: "choice", value: "agree" }, "Agree")),
    h("form", { key: 5, method: "post", action: o.action }, h("button", { className: "btn plain", name: "choice", value: "email" }, "No thanks, I'll use email"))]);
}
export const consentDone = (firm: FirmView) => frame("You're set", firm, [h("h1", { key: 1 }, "You're set"), h("p", { key: 2 }, "Watch for a text from " + firm.name + ".")]);
export const emailInstead = (firm: FirmView) => frame("No problem", firm, [h("h1", { key: 1 }, "No problem"), h("p", { key: 2 }, "Reply to our email with your documents.")]);

export const UPLOAD_TYPES = "Photos (JPG, PNG, HEIC) and PDFs, up to 25 MB each.";
export function uploadPage(firm: FirmView, o: { action: string; ask: string | null; others: number; done?: boolean; error?: string; sent?: number }) {
  const waiting = o.done ? [h("h1", { key: 1 }, firm.name + " already has everything. Thank you.")]
    : [o.sent ? h("p", { key: 0, className: "ok", role: "status" }, "Thanks. We'll check " + (o.sent === 1 ? "it" : "them") + " and get back to you if anything is missing.") : null,
      o.error ? h("p", { key: 1, className: "err", role: "alert" }, o.error) : null,
      h("div", { key: 2, className: "card" }, h("p", { className: "muted small" }, "We're waiting for"), h("p", { className: "ask" }, o.ask || "your documents"), o.others > 0 ? h("p", { className: "muted" }, "and " + o.others + " other document" + (o.others === 1 ? "" : "s") + ".") : null),
      // capture asks a phone for its rear camera; a computer ignores it and shows the file picker.
      h("form", { key: 3, method: "post", action: o.action, encType: "multipart/form-data" },
        h("label", { htmlFor: "photo" }, o.sent ? "Send another" : "Take a photo or choose files"), h("input", { id: "photo", name: "file", type: "file", accept: "image/*,application/pdf", multiple: true, required: true }),
        h("p", { className: "muted small" }, UPLOAD_TYPES), h("button", { className: "btn pri" }, "Send")),
      h("p", { key: 4, className: "muted small" }, "We never show documents here. If one is missing or hard to read, " + firm.name + " will tell you.")];
  return frame("Send your documents", firm, waiting);
}

export function unsubscribePage(firm: FirmView, o: { action: string; keep: string; done?: boolean }) {
  return o.done ? frame("Emails stopped", firm, [h("h1", { key: 1 }, "Emails stopped"), h("p", { key: 2 }, "You will get no more emails from " + firm.name + " about your tax documents." + (firm.phone ? " To send documents another way, call " + firm.phone + "." : ""))])
    : frame("Stop emails", firm, [h("h1", { key: 1 }, "Stop emails from " + firm.name + " about your tax documents?"),
      h("form", { key: 2, method: "post", action: o.action }, h("button", { className: "btn pri" }, "Unsubscribe")), h("a", { key: 3, className: "btn", href: o.keep }, "Keep emails")]);
}
export const keptPage = (firm: FirmView) => frame("Nothing changed", firm, [h("h1", { key: 1 }, "Nothing changed"), h("p", { key: 2 }, "You will keep getting emails from " + firm.name + " about your tax documents.")]);
