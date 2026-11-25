// Getting a firm approved to text, first time, with no back and forth.
// The carriers reject registrations for three reasons far more than any other: the legal name or tax ID does not match IRS records,
// the business has no website they can look at, and the description of how people agree to texts is vague.
// This file removes all three: it checks the details before anything is filed, gives every firm a public page that says
// exactly what the carriers look for, and files the same tested description for every firm.
//
// STATUS: the field names below follow Twilio's A2P 10DLC registration guides as read in November 2026. Nothing here has been
// submitted. File one real registration by hand first and correct this file from what comes back (T-134).
const clean = (v) => String(v == null ? "" : v).trim();
const esc = (s) => clean(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => clean(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "firm";
function problems(reg) {
  const p = [], r = reg || {}, ein = clean(r.ein).replace(/\D/g, "");
  if (clean(r.legalName).length < 2) p.push("Legal name is missing. It must match the IRS letter that assigned the EIN, word for word.");
  if (!r.soleProp && ein.length !== 9) p.push("EIN must be 9 digits.");
  if (!r.soleProp && /^(00|07|08|09|17|18|19|28|29|49|69|70|78|79|89|96|97)/.test(ein)) p.push("That EIN prefix is not one the IRS issues. Check for a typo.");
  if (r.soleProp && clean(r.ownerMobile).replace(/\D/g, "").length !== 10) p.push("A sole proprietor needs the owner's own mobile number for the carriers' verification code.");
  if (clean(r.street).length < 3 || clean(r.city).length < 2 || !/^[A-Za-z]{2}$/.test(clean(r.state)) || !/^\d{5}$/.test(clean(r.zip))) p.push("Full street address is needed. A PO box is often rejected.");
  if (/\bp\.?\s*o\.?\s*box\b/i.test(clean(r.street))) p.push("Use a street address, not a PO box.");
  if (clean(r.contact).length < 3) p.push("A contact person at the firm is needed.");
  return p;
}
// The page address the carriers are given. Hosted by Tallyhound, one per firm, public, no login.
const pageUrl = (firm, base) => (base || "https://firms.tallyhound.com") + "/" + slug(firm.name);
const SAMPLES = (firm) => [
  "Hi Maria, it's " + firm.name + ". We need 3 documents for your 2026 return. First: your W-2 from Acme Logistics. Reply with a photo when you have it. Reply STOP to stop.",
  "Thanks Maria, " + firm.name + " got your W-2 from Acme Logistics. Still needed: your mortgage interest statement.",
  firm.name + ": that photo was hard to read. Could you retake it with the whole page in view and good light?",
  firm.name + ": texts are on. We will only message you about documents for your tax return. Msg and data rates may apply. Reply STOP to stop, HELP for help."
];
function brand(firm, reg) {
  const p = problems(reg); if (p.length) throw Object.assign(new Error("Not ready to file: " + p[0]), { problems: p });
  return { type: reg.soleProp ? "SOLE_PROPRIETOR" : "LOW_VOLUME_STANDARD", legalName: clean(reg.legalName), displayName: firm.name, ein: reg.soleProp ? null : clean(reg.ein).replace(/\D/g, ""), vertical: "PROFESSIONAL",
    address: { street: clean(reg.street), city: clean(reg.city), state: clean(reg.state).toUpperCase(), postalCode: clean(reg.zip), country: "US" }, website: clean(reg.website) || pageUrl(firm),
    contact: { name: clean(reg.contact), email: firm.email, phone: firm.phone || null }, ownerMobile: reg.soleProp ? clean(reg.ownerMobile).replace(/\D/g, "") : null, reseller: "Tallyhound" };
}
function campaign(firm, reg) {
  const url = pageUrl(firm);
  return { useCase: reg && reg.soleProp ? "SOLE_PROPRIETOR" : "LOW_VOLUME_MIXED",
    description: firm.name + " is a tax and accounting firm. It texts its own existing clients to request, confirm receipt of, and follow up on the documents needed to prepare their tax return (for example a W-2 or a mortgage interest statement). Messages are sent only to clients who have agreed. No marketing is sent.",
    messageFlow: "Clients agree in one of three ways. (1) The firm emails the client a link to " + url + "/texts where the client enters or confirms their mobile number and ticks an unticked box that reads: 'I agree to receive text messages from " + firm.name + " about documents for my tax return. Message frequency varies. Message and data rates may apply. Reply STOP to stop or HELP for help.' The page links to the privacy policy and terms at " + url + ". (2) The client agrees in the firm's signed engagement letter, which carries the same wording, and a named staff member records it. (3) The client texts START to the firm's number. Consent is never a condition of service. Mobile numbers and consent are not shared with or sold to third parties for marketing.",
    sampleMessages: SAMPLES(firm), optInKeywords: ["START", "YES"], optOutKeywords: ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"], helpKeywords: ["HELP", "INFO"],
    optInMessage: SAMPLES(firm)[3], optOutMessage: firm.name + ": you will get no more texts from us. Reply START to turn them back on.", helpMessage: firm.name + ": we text about documents for your tax return. Call " + (firm.phone || "our office") + " for help. Reply STOP to stop.",
    hasEmbeddedLinks: true, hasEmbeddedPhone: !!firm.phone, ageGated: false, directLending: false, privacyPolicyUrl: url + "#privacy", termsUrl: url + "#terms" };
}
// The public page. Plain HTML, nothing to click, readable by a carrier reviewer in a minute and by a wary client in less.
function firmPage(firm, opt) {
  if (opt && opt.letters) return letterPage(firm, opt);
  const o = opt || {}, n = esc(firm.name), num = o.number ? esc(o.number) : "a local number we will list here once it is active", addr = esc(o.address || "");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + n + ": document requests by text and email</title></head><body style=\"font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#14213d\">" +
    "<h1>" + n + "</h1><p>" + n + " collects the documents for your tax return by text message and email. We use a service called Tallyhound to send the requests and check what comes back.</p>" +
    "<h2 id=\"check\">Is this message really from us?</h2><ul><li>Our texts come from <b>" + num + "</b>.</li>" + (addr ? "<li>Our emails come from <b>" + addr + "</b>.</li>" : "") + "<li>Every message names your preparer.</li><li>We will never ask you to text or email a Social Security number, a password, or a payment.</li>" + (firm.phone ? "<li>If you are unsure, call our office on <b>" + esc(firm.phone) + "</b> before you send anything.</li>" : "") + "</ul>" +
    "<h2 id=\"texts\">Text messages</h2><p>We text you only if you have agreed. You agree by ticking the box on your personal page, by signing our engagement letter, or by texting START to our number. Agreeing is never a condition of being our client. We text about one thing: the documents needed for your return. Message frequency varies, usually a few messages a week while documents are outstanding. Message and data rates may apply. Reply <b>STOP</b> at any time to stop, or <b>HELP</b> for help.</p>" +
    "<h2 id=\"privacy\">Privacy</h2><p>Your mobile number and your agreement to receive texts are never sold, rented or shared with anyone for marketing. Documents you send are checked, filed in " + n + "'s own storage, and then deleted from Tallyhound on a schedule. Tallyhound does not keep Social Security numbers or account numbers that are typed into a message.</p>" +
    "<h2 id=\"terms\">Terms</h2><p>This messaging programme is run by " + n + (firm.phone ? ", " + esc(firm.phone) : "") + ". Carriers are not liable for delayed or undelivered messages. To stop texts reply STOP. For help reply HELP or call our office.</p></body></html>";
}
// The same page for an email-first firm (docs/V2.md): it never texts, so nothing about texts, numbers, carriers or STOP.
// own: letters come from each preparer's own mailbox; address: otherwise the one address letters come from.
function letterPage(firm, o) {
  const n = esc(firm.name), addr = esc(o.address || "");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + n + ": document requests by email</title></head><body style=\"font:17px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#14213d\">" +
    "<h1>" + n + "</h1><p>" + n + " asks for the documents for your tax return by email, with a private link where you can upload them. We use a service called Tallyhound to send the letters and check what comes back.</p>" +
    "<h2 id=\"check\">Is this email really from us?</h2><ul>" + (o.own ? "<li>Our letters come from your preparer's own work email at " + n + ".</li>" : addr ? "<li>Our letters come from <b>" + addr + "</b>.</li>" : "") + "<li>Every letter names your preparer.</li><li>We will never ask you to email a Social Security number, a password, or a payment.</li>" + (firm.phone ? "<li>If you are unsure, call our office on <b>" + esc(firm.phone) + "</b> before you send anything.</li>" : "") + "</ul>" +
    "<h2 id=\"stop\">Stopping the emails</h2><p>Every letter has a link at the bottom to stop them. You can also reply and ask us to stop. Either way no more letters go to you, and someone at " + n + " will be in touch another way.</p>" +
    "<h2 id=\"privacy\">Privacy</h2><p>Your email address is never sold, rented or shared with anyone for marketing. Documents you send are checked, filed in " + n + "'s own storage, and then deleted from Tallyhound on a schedule. Tallyhound does not keep Social Security numbers or account numbers that are typed into a message.</p></body></html>";
}
// What the firm sends its own clients, from its own usual email, before Tallyhound's first message.
function headsUp(firm, opt) {
  const o = opt || {}, n = firm.name, num = o.number || "", addr = o.address || "", page = pageUrl(firm), from = (num ? "texts from " + num + " and " : "") + "emails from " + (addr || "our Tallyhound address");
  return {
    subject: "How we are collecting your tax documents this year",
    email: "Hello,\n\nThis year " + n + " is collecting tax documents a new way, so you can send them from your phone in a minute instead of dropping them off.\n\nOver the next few days you will get " + from + ". Those messages are from us. We use a service called Tallyhound to send them and to check each document as it arrives.\n\nYou can reply with a photo or a PDF. We will tell you what we have and what is still missing.\n\nWe will never ask you to send a Social Security number, a password or a payment by text or email. If a message ever looks wrong, call the office" + (firm.phone ? " on " + firm.phone : "") + " first. You can also check our details at " + page + ".\n\nThank you,\n" + n,
    letter: "Document collection. " + n + " uses Tallyhound to request and receive tax documents by text message and email. By signing, you agree to receive text messages from " + n + " about documents for your tax return at the mobile number you gave us. Message frequency varies. Message and data rates may apply. Reply STOP to stop or HELP for help. Agreeing is not a condition of our services.",
    website: n + " collects tax documents by text and email through Tallyhound. Our messages come from " + (num || "our listed number") + (addr ? " and " + addr : "") + ". We never ask for a Social Security number, password or payment by message. Details: " + page,
    voicemail: "If you received a text or email from us asking for tax documents, it is genuine. We collect documents through a service called Tallyhound."
  };
}
// Carriers have been taking one to three weeks. Shown to the firm as a range, never a promise.
function readyBy(submittedAt) { const t = +new Date(submittedAt), d = 86400000; return { earliest: new Date(t + 7 * d), latest: new Date(t + 21 * d) }; }
module.exports = { problems, brand, campaign, firmPage, headsUp, readyBy, pageUrl, slug };
