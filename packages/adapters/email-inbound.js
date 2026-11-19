// Turns what the inbound mail provider posts to our webhook into the input the pipeline expects.
// Tallyhound never signs in to a firm's mailbox. Each firm has its own Tallyhound address; clients write to it,
// or the firm forwards mail to it. This file is the whole of "how email gets in".
//
// Input (provider-neutral; the two small mappers at the bottom produce it from Amazon SES and Postmark):
//   { messageId, to, from, subject, text, headers: { name: value }, attachments: [{ bytes, contentType, name, inline }] }
// Output: { to, from, body, attachments, providerId, trusted, forwarded?, auth }
const MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 20;
const addrOf = (v) => { const s = String(v || ""), m = /<([^>]+)>/.exec(s); return (m ? m[1] : s).trim().toLowerCase(); };
const domainOf = (a) => addrOf(a).split("@")[1] || "";
// "mail.acme.com" and "acme.com" belong to the same organisation. Good enough for alignment without a public-suffix list:
// compare the last two labels, three when the second-to-last is a short country-style label ("co.uk").
function orgDomain(d) { const p = String(d || "").toLowerCase().split(".").filter(Boolean); if (p.length <= 2) return p.join("."); return (p[p.length - 2].length <= 3 && p[p.length - 1].length === 2 ? p.slice(-3) : p.slice(-2)).join("."); }
const aligned = (a, b) => !!a && !!b && orgDomain(a) === orgDomain(b);

// Reads the Authentication-Results header our own receiving server added. Only the first header counts: later ones may be forged by the sender.
function parseAuthResults(h) {
  const s = String(Array.isArray(h) ? h[0] : h || ""), get = (k) => { const m = new RegExp("\\b" + k + "=(\\w+)", "i").exec(s); return m ? m[1].toLowerCase() : "none"; }, dom = (re) => { const m = re.exec(s); return m ? m[1].toLowerCase() : ""; };
  return { spf: get("spf"), dkim: get("dkim"), dmarc: get("dmarc"), dkimDomain: dom(/header\.(?:d|i)=@?([\w.-]+)/i), spfDomain: domainOf(dom(/smtp\.mailfrom=([^\s;]+)/i)) || dom(/smtp\.mailfrom=([\w.-]+)/i) };
}
// Can we believe the From line? DMARC pass is the plain yes. Without a DMARC record, an aligned DKIM signature or an aligned SPF pass will do.
// A DMARC fail is always a no. Mail that an office forwards automatically keeps its DKIM signature, so it normally still passes.
function isTrusted(auth, from) {
  if (!auth) return false; if (auth.dmarc === "pass") return true; if (auth.dmarc === "fail") return false;
  const d = domainOf(from); return (auth.dkim === "pass" && aligned(auth.dkimDomain, d)) || (auth.spf === "pass" && aligned(auth.spfDomain, d));
}
// Keeps what the person wrote and drops the quoted thread and the signature block under it.
function stripReply(text) {
  const L = String(text || "").replace(/\r/g, "").split("\n"), out = [];
  for (const line of L) {
    if (/^\s*On .{5,200}wrote:\s*$/i.test(line) || /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^\s*From:\s.+@/i.test(line) && out.length || /^_{10,}\s*$/.test(line) || /^--\s*$/.test(line) || /^Sent from my /i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// A staff member pressed Forward. Finds whose email it was and what they wrote.
function parseForward(subject, text) {
  const s = String(text || "").replace(/\r/g, ""), m = /(?:-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:|-{2,}\s*Original Message\s*-{2,})\s*\n([\s\S]*)$/i.exec(s);
  if (!m && !/^\s*(fwd?|fw):/i.test(String(subject || ""))) return null;
  const rest = m ? m[1] : s, f = /^\s*From:\s*(.+)$/im.exec(rest); if (!f) return null; const from = addrOf(f[1]); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) return null;
  // the body starts after the block of header lines (From, Date, Subject, To)
  const lines = rest.split("\n"); let i = lines.findIndex((l) => /^\s*From:/i.test(l)); while (i < lines.length && (/^\s*(From|Date|Sent|Subject|To|Cc|Reply-To):/i.test(lines[i]) || !lines[i].trim() && i + 1 < lines.length && /^\s*(From|Date|Sent|Subject|To|Cc):/i.test(lines[i + 1]))) i++;
  return { from, body: stripReply(lines.slice(i).join("\n")) };
}
function toPipeline(mail) {
  const auth = mail.auth || parseAuthResults((mail.headers || {})["authentication-results"] || (mail.headers || {})["Authentication-Results"]), from = addrOf(mail.from);
  const files = (mail.attachments || []).filter((a) => a && a.bytes && a.bytes.length).slice(0, MAX_FILES);
  const fwd = parseForward(mail.subject, mail.text);
  return {
    to: addrOf(mail.to), from, providerId: mail.messageId || null, auth, trusted: isTrusted(auth, from),
    body: fwd ? String(mail.text || "").split(/-{5,}\s*Forwarded message|Begin forwarded message:|-{2,}\s*Original Message/i)[0].trim() : stripReply(mail.text),
    forwarded: fwd || undefined,
    // A file over the size limit is passed on with no bytes and an unreadable type, so the client is told to send it another way instead of hearing nothing.
    attachments: files.map((a) => (a.bytes.length > MAX_FILE ? { bytes: Buffer.alloc(0), contentType: "application/x-too-large", name: a.name } : { bytes: a.bytes, contentType: String(a.contentType || "").toLowerCase().split(";")[0].trim(), name: a.name, inline: !!a.inline, width: a.width, height: a.height, pages: a.pages, locked: a.locked }))
  };
}
// Amazon SES inbound: the receipt carries the verdicts, the message itself is parsed by the caller (mailparser) into text and attachments.
function fromSes(receipt, parsed) {
  const v = (k) => String(((receipt || {})[k] || {}).status || "none").toLowerCase(), from = (parsed.from && (parsed.from.address || parsed.from)) || "";
  // SES reports DMARC directly. For the no-record case it does not say which domain signed, so alignment falls back to the parsed header if present.
  const hdr = parseAuthResults((parsed.headers || {})["authentication-results"]);
  return toPipeline({ messageId: parsed.messageId, to: parsed.to, from, subject: parsed.subject, text: parsed.text, headers: parsed.headers, attachments: parsed.attachments,
    auth: { spf: v("spfVerdict"), dkim: v("dkimVerdict"), dmarc: v("dmarcVerdict") === "gray" ? "none" : v("dmarcVerdict"), dkimDomain: hdr.dkimDomain, spfDomain: hdr.spfDomain } });
}
// Postmark inbound webhook JSON.
function fromPostmark(j) {
  const headers = {}; (j.Headers || []).forEach((h) => { const k = String(h.Name).toLowerCase(); if (!(k in headers)) headers[k] = h.Value; });
  return toPipeline({ messageId: j.MessageID, to: j.OriginalRecipient || j.To, from: j.From, subject: j.Subject, text: j.StrippedTextReply && !/^\s*(fwd?|fw):/i.test(j.Subject || "") ? j.StrippedTextReply : j.TextBody, headers,
    attachments: (j.Attachments || []).map((a) => ({ bytes: Buffer.from(a.Content || "", "base64"), contentType: a.ContentType, name: a.Name, inline: !!a.ContentID })) });
}
module.exports = { toPipeline, parseAuthResults, isTrusted, stripReply, parseForward, fromSes, fromPostmark, orgDomain, MAX_FILE, MAX_FILES };
