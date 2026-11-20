// The production loop around the rules engine.
//   inbound text / email / upload  ->  model reads it  ->  engine decides  ->  model writes  ->  safety check  ->  send  ->  save
// Everything outside the engine is an interface, so this file runs in tests with fakes and in production with
// Postgres, Twilio, an email provider, object storage and the Claude API.
//
// store:  { firmIdByNumber(to), firmIdByInbox(addr), lock(firmId, fn(json|null) -> Promise<json>), putFile(firmId, bytes, contentType) -> key,
//           getFile(firmId, key) -> { bytes, contentType }, deleteFile(firmId, key) }   wrap it with encryptedStore (crypto.js) in production
// sms:    { send({ from, to, body }) -> providerId }
// email:  { send({ from, to, subject, body }) -> providerId }
// ai:     { json(prompt, { images?, tier }) -> object }   may be null: the engine then uses rules and standard wording
// clock:  () -> Date
const { createEngine } = require("../engine");
const prompts = require("./prompts");
const precheck = require("./precheck");
// The model reads at most this many pages of one file. A longer file is identified from its first pages and a person is told.
const MAX_PAGES = 90;

const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);
function nameMatch(c, name) {
  const t = String(name || "").toUpperCase(); if (!t.trim()) return "self";
  // A business, trust or nonprofit: the document carries the entity's name, not the contact person's. Its first distinctive word is enough.
  const ent = String(c.entity || "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 2 && !["THE", "LLC", "INC", "CORP", "AND", "TRUST", "ESTATE"].includes(w))[0];
  return [c.first, c.last, c.spouse && c.spouse.first, ent].filter(Boolean).some((w) => t.includes(String(w).toUpperCase())) ? "self" : "other";
}

// The engine reads hours straight off its clock, so the clock must show the firm's own wall time, whatever zone the server runs in.
// Set firm.iana (for example "America/Chicago") on every production firm. Without it the server's zone is used, which is wrong on a UTC host.
function wallTime(date, iana) {
  const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: iana, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(date).forEach((x) => { p[x.type] = +x.value; });
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
// Texting and email providers retry a webhook when we are slow to answer. The same message must never be processed twice.
function seen(T, id) { if (!id) return false; const L = (T.S.firm.seenIn = T.S.firm.seenIn || []); if (L.includes(id)) return true; L.push(id); if (L.length > 500) L.splice(0, L.length - 500); return false; }
// "Jo Day <jo@x.example>" and "JO@X.EXAMPLE" are the same sender.
function addr(v) { const s = String(v || ""), m = /<([^>]+)>/.exec(s); return (m ? m[1] : s).trim().toLowerCase(); }
// A household can share one phone or one email address (spouses who file apart, a parent sending for a college student).
// With several clients on the same contact, a text is taken to be from whoever we wrote to last, and a document goes to the
// person whose first name is printed on it. If the name does not settle it, the one whose checklist is waiting for that form.
// A client's second contacts (T-118): matched on the way in, never sent to.
const also = (c, kind, value) => (c.also || []).some((x) => x.kind === kind && x.value === value);
const CONSENT_WORD = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|yes|help|info|alto|parar|cancelar|ayuda)\s*[.!]?\s*$/i;
function pick(T, list) {
  if (list.length < 2) return list[0] || null;
  const last = (c) => { const e = T.engOf(c.id); let t = 0; if (e) for (const m of T.S.msgs) if (m.engId === e.id && m.dir === "out" && +new Date(m.at) > t) t = +new Date(m.at); return t; };
  return list.slice().sort((a, b) => last(b) - last(a))[0];
}
function ownerOf(T, list, spec, fallback) {
  if (list.length < 2) return fallback; const n = String(spec.recipientName || "").toUpperCase();
  const byName = n.trim() ? list.filter((c) => n.includes(String(c.first).toUpperCase())) : []; if (byName.length === 1) return byName[0];
  const byItem = list.filter((c) => { const e = T.engOf(c.id); return e && T.openItems(e.id).some((i) => i.form === spec.form); }); return byItem.length === 1 ? byItem[0] : fallback;
}
// Files read per firm per day from senders nobody has confirmed. Enough for a busy spouse, too few to be worth abusing.
const UNKNOWN_FILES_PER_DAY = 20;
function createApp({ store, sms, email, ai, clock, log, files, voice }) {
  const now = clock || (() => new Date());
  const say = log || (() => {});
  const ask = async (prompt, opts) => { if (!ai) return null; try { const r = await ai.json(prompt, opts || {}); return r && typeof r === "object" ? r : null; } catch (err) { say("ai_error", String(err && err.message || err)); return null; } };

  // Load one firm, run fn against its engine, let the model write, send what is ready, save. One firm at a time.
  // Send once. A message is claimed and saved before the provider is called, and the provider's answer is saved after.
  // If we crash or the save fails in between, the message is left claimed with no answer: it is flagged for a person
  // and never sent again automatically. A late text is a nuisance; a duplicate text to a client is worse.
  const CLAIM_STALE_MS = 2 * 60 * 1000;
  async function withFirm(firmId, fn) {
    let result, jobs = [], fjobs = [];
    await store.lock(firmId, async (json) => {
      if (!json) throw new Error("Unknown firm " + firmId);
      const T = createEngine(); T.load(json); T.setNow(T.S.firm.iana ? wallTime(now(), T.S.firm.iana) : now());
      T.S.firm.hound.aiLive = !!ai && T.S.firm.hound.aiWrite !== false;
      if (T.S.firm.delivery) T.S.firm.delivery.physical = !!files;   // tells the engine a real storage connection exists, so it waits for the firm's copy before letting go of ours
      await dropFiles(T, firmId);
      result = await fn(T);
      await write(T); sweep(T, firmId); jobs = claim(T); fjobs = fileJobs(T);
      return T.dump();
    });
    if (!jobs.length && !fjobs.length) return result;
    // The firm's own storage. Each original is put there the moment it arrives, then given its final name once it has been checked.
    const fdone = [];
    for (const j of fjobs) {
      try {
        if (j.act === "put") { const f = await store.getFile(firmId, j.key); if (!f) throw new Error("Our copy is missing"); fdone.push({ docId: j.docId, place: j.place, id: await files.put({ firmId, provider: j.provider, folder: j.folder, name: j.name, bytes: f.bytes, contentType: f.contentType }) }); }
        else { await files.move({ firmId, provider: j.provider, id: j.id, folder: j.folder, name: j.name }); fdone.push({ docId: j.docId, place: j.place, id: j.id }); }
      } catch (err) { fdone.push({ docId: j.docId, error: String(err && err.message || err) }); }
    }
    const done = [];
    for (const j of jobs) {
      try { if (j.channel === "voice" && !voice) throw new Error("Calls are not connected");
        done.push({ id: j.id, providerId: j.channel === "voice" ? await voice.call({ from: j.from, to: j.to, say: j.body, idempotencyKey: j.id }) : j.channel === "text" ? await sms.send({ from: j.from, to: j.to, body: j.body, idempotencyKey: j.id }) : await email.send({ from: j.from, replyTo: j.replyTo, fromName: j.fromName, to: j.to, subject: j.subject, body: j.body, idempotencyKey: j.id, unsubscribe: j.unsubscribe }) }); }
      catch (err) { done.push({ id: j.id, error: String(err && err.message || err), code: err && err.code }); }
    }
    await store.lock(firmId, async (json) => {
      const T = createEngine(); T.load(json); T.setNow(T.S.firm.iana ? wallTime(now(), T.S.firm.iana) : now());
      for (const r of fdone) {
        const d = T.S.docs.find((x) => x.id === r.docId); if (!d) continue; const m = (d.master = d.master || { at: new Date(T.S.now) }); delete m.busy;
        if (!r.error) { m.id = r.id; m.place = r.place; m.fails = 0; d.hold = null; continue; }
        m.fails = (m.fails || 0) + 1; d.hold = "storage"; say("file_failed", firmId, d.id, r.error);
        const e = d.engId && T.eng(d.engId), c = e && T.client(e.clientId);
        if (m.fails === 3 && e && c) T.alertx(e, "high", "storage_failed", "A document for " + c.first + " " + c.last + " could not be filed into " + (T.S.firm.delivery.provider || "your storage") + ". Tallyhound is keeping its copy and will keep trying. Check the connection under Settings.", "sf" + d.id);
      }
      for (const r of done) {
        const m = T.S.msgs.find((x) => x.id === r.id); if (!m) continue; const e = T.eng(m.engId), c = e && T.client(e.clientId);
        if (!r.error) { m.providerId = r.providerId; m.sentAt = new Date(T.S.now); continue; }
        m.failed = r.error; m.status = "failed";
        // Twilio 21610: the carrier has this number as unsubscribed. Treat it as an opt-out so nothing else is tried by text.
        if (c && String(r.code) === "21610" && c.textConsent === "given") { c.textConsent = "withdrawn"; c.consentLog.push({ at: new Date(T.S.now), what: "Withdrawn: carrier reports the number as unsubscribed", channel: "text" }); }
        if (e && c) T.alertx(e, "high", "send_failed", "A " + m.channel + " to " + c.first + " " + c.last + " could not be sent: " + m.failed, "sf" + m.id);
        say("send_failed", firmId, m.id, m.failed);
      }
      return T.dump();
    });
    return result;
  }
  // Deletes the stored bytes of every copy the engine has let go of (delivered and past its keep-for time, rejected, asked to be deleted).
  // Only keys that were already saved as forgotten are deleted, so a failed save can never leave a document pointing at a file that is gone.
  // A delete that fails stays on the list and is tried again on the next event or timer pass.
  async function dropFiles(T, firmId) {
    const L = T.S.purgeFiles || []; if (!L.length || !store.deleteFile) return; const left = [];
    for (const key of L) { try { await store.deleteFile(firmId, key); } catch (err) { left.push(key); say("delete_failed", firmId, key, String(err && err.message || err)); } }
    T.S.purgeFiles = left;
  }
  // What needs to happen in the firm's storage. Nothing is done here: jobs are marked, saved, then carried out after the lock, like sends.
  function fileJobs(T) {
    const v = T.S.firm.delivery || {}; if (!files || !v.provider || v.provider === "Download" || v.auto !== "on") return [];
    const out = [], ext = (t) => (/pdf/.test(t || "") ? ".pdf" : /png/.test(t || "") ? ".png" : ".jpg"), stale = now().getTime() - CLAIM_STALE_MS;
    for (const d of T.S.docs) {
      if (!d.engId || out.length >= 20) continue; const m = d.master; if (m && m.busy && m.busy > stale) continue;
      const e = T.eng(d.engId), c = e && T.client(e.clientId); if (!c) continue;
      const base = v.folder + "/" + e.year + "/" + (c.entity || c.last + ", " + c.first), final = d.state === "accepted" && d.deliveredAt, unused = ["rejected", "duplicate", "discarded"].includes(d.state);
      const want = final ? "final" : unused ? "unused" : "incoming", folder = want === "final" ? base : base + (want === "unused" ? "/_Not used" : "/_To check");
      if (m && m.id && m.place !== want) { m.busy = now().getTime(); d.hold = "storage"; out.push({ act: "move", docId: d.id, provider: v.provider, id: m.id, place: want, folder, name: want === "final" ? T.fileName(c, e, d) : m.name || d.id }); }
      else if (!(m && m.id) && d.fileKey && (m || final)) { const name = want === "final" ? T.fileName(c, e, d) : "arrived " + new Date(d.at).toISOString().slice(0, 10) + " " + d.id + ext(d.contentType); d.master = Object.assign(m || { at: new Date(T.S.now) }, { busy: now().getTime(), name }); d.hold = "storage"; out.push({ act: "put", docId: d.id, provider: v.provider, key: d.fileKey, place: want, folder, name }); }
    }
    return out;
  }
  // Marks every message that is ready and returns what to send. Nothing leaves until this has been saved.
  function claim(T) {
    const S = T.S, jobs = [];
    for (const m of S.msgs.filter((x) => x.dir === "out" && x.status === "delivered" && !x.sentAt && !x.failed && !x.claimedAt)) {
      const e = T.eng(m.engId), c = e && T.client(e.clientId); if (!c) continue;
      m.claimedAt = now().getTime();
      if (m.channel === "text") { jobs.push({ id: m.id, channel: "text", from: S.firm.smsNumber, to: c.mobile, body: m.body }); continue; }
      // A recorded reminder call (T-50). Claimed and saved before the call is placed, like every send, and never placed twice.
      if (m.channel === "voice") { jobs.push({ id: m.id, channel: "voice", from: S.firm.smsNumber, to: c.mobile, body: m.body }); continue; }
      // Every email carries a way to stop them: a line at the foot, and the address the mail provider puts in the one-click header.
      const un = T.unsubscribeLink ? T.unsubscribeLink(c) : "", foot = un ? "\n\nYou're getting this because " + S.firm.name + " prepares your taxes. To stop these emails: https://" + un : "";
      jobs.push({ id: m.id, channel: "email", from: S.firm.domain && S.firm.domain.verified && S.firm.domain.from ? S.firm.domain.from : S.firm.email, replyTo: S.firm.email, fromName: S.firm.sender, to: c.email, subject: S.firm.sender + ": your " + e.year + " tax documents", body: m.body + foot, unsubscribe: un ? "https://" + un : undefined });
    }
    return jobs;
  }
  // A message claimed a while ago with no answer recorded: we do not know whether it went. Tell a person, do not resend.
  function sweep(T, firmId) {
    for (const m of T.S.msgs.filter((x) => x.dir === "out" && x.status === "delivered" && x.claimedAt && !x.sentAt && !x.failed && now().getTime() - x.claimedAt > CLAIM_STALE_MS)) {
      const e = T.eng(m.engId), c = e && T.client(e.clientId); m.status = "unconfirmed"; m.unconfirmed = true;
      if (e && c) T.alertx(e, "high", "send_unconfirmed", "A " + m.channel + " to " + c.first + " " + c.last + " may or may not have gone out. It was not sent again. Check the conversation before resending.", "su" + m.id);
      say("send_unconfirmed", firmId, m.id);
    }
  }
  // Model writes every message the engine marked "writing". The engine's own check accepts or rejects each draft.
  async function write(T) {
    for (const m of T.S.msgs.filter((x) => x.status === "writing")) {
      const out = await ask(prompts.writeMessage(T, m), { tier: "quick" });
      T.composeDone(m.id, out && out.text ? String(out.text).trim() : null, "Claude", out && out.text ? null : "no answer");
    }
  }
  // Send every outgoing message that is approved for delivery and has not gone out yet.
  // Read one file with the model and turn the answer into what the engine expects.
  async function readFile(T, c, firmId, file) {
    const key = await store.putFile(firmId, file.bytes, file.contentType);
    // A PDF made by a payroll company or a broker carries its own text. Code reads the form number and year from it, with no model involved.
    const pre = file.text ? precheck.fromText(file.text, T.FORMS) : null;
    const r = await ask(prompts.readDocument(T), { images: file.pages || [file.bytes], tier: "default" });
    if (!r && pre && pre.form) return { form: pre.form, year: pre.year || 0, payer: "", corrected: pre.corrected, fileKey: key, read: { legible: 0.95, conf: pre.year ? 0.9 : 0.6, note: "Read from the text inside the PDF. The model was not available.", missing: [], by: "text" } };
    if (!r) return { form: "OTHER", year: 0, payer: "", fileKey: key, read: { legible: 0.9, conf: 0, note: "Could not be read automatically", missing: [] } };
    return precheck.reconcile({
      form: r.is_tax_document === false ? "OTHER" : (typeof r.form === "string" && Object.hasOwn(T.FORMS, r.form) ? r.form : "OTHER"), year: +r.tax_year || 0, payer: r.payer || "", corrected: !!r.corrected,
      recipient: c ? nameMatch(c, r.recipient_name) : "self", recipientName: r.recipient_name || "", fileKey: key,
      read: { legible: +r.legibility || 0, conf: +r.confidence || 0, note: r.note || "", missing: Array.isArray(r.missing_parts) ? r.missing_parts : [] }
    }, pre);
  }

  // Sorts what arrived: "skip" (logos and signature images in an email), "locked" (a PDF that needs a password),
  // "type" (not a photo or a PDF) or "ok". file: { bytes, contentType, pages?, locked?, inline?, width?, height? }
  function kindOf(file) {
    const t = String(file.contentType || "").toLowerCase(), n = file.bytes ? file.bytes.length : 0;
    if (/^image\//.test(t) && ((file.inline && n < 60000) || (file.width && file.width < 240) || (file.height && file.height < 120))) return "skip";   // the email adapter sets inline, width and height
    if (file.locked) return "locked";
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif|tiff?)$/.test(t) && t !== "application/pdf") return "type";
    return "ok";
  }
  const toSpec = (T, c, r, key) => ({
    form: r.is_tax_document === false ? "OTHER" : (typeof r.form === "string" && Object.hasOwn(T.FORMS, r.form) ? r.form : "OTHER"), year: +r.tax_year || 0, payer: r.payer || "", corrected: !!r.corrected,
    recipient: c ? nameMatch(c, r.recipient_name) : "self", recipientName: r.recipient_name || "", fileKey: key,
    read: { legible: +r.legibility || 0, conf: +r.confidence || 0, note: r.note || "", missing: Array.isArray(r.missing_parts) ? r.missing_parts : [] }
  });
  // A document remembers which stored file it is in and, when several forms came as one file, which pages of it are its own.
  const filed = (d, spec) => { d.fileKey = spec.fileKey; if (spec.pagesOf && spec.pagesOf.length) d.pagesOf = spec.pagesOf; };
  // Reads everything in one message. A file with several pages is read as a bundle and split into documents.
  // Returns { specs, bad } where bad is "locked" or "type" when a file could not be opened at all.
  async function readAll(T, c, firmId, files) {
    const specs = []; let bad = null;
    for (const f of files || []) {
      const k = kindOf(f); if (k === "skip") continue; if (k !== "ok") { bad = bad || k; continue; }
      if (f.pages && f.pages.length > 1) {
        const total = f.pages.length, pages = f.pages.slice(0, MAX_PAGES);
        const key = await store.putFile(firmId, f.bytes, f.contentType), r = await ask(prompts.readBundle(T), { images: pages, tier: "default" });
        const groups = r && Array.isArray(r.documents) ? r.documents.filter((d) => d && typeof d === "object") : [];
        if (!groups.length) { specs.push({ form: "OTHER", year: 0, payer: "", fileKey: key, read: { legible: 0.9, conf: 0, note: "Could not be read automatically", missing: [] } }); continue; }
        const used = new Set();
        for (const g of groups) { const pgs = [].concat(g.pages || []).map(Number).filter((n) => n >= 1 && n <= pages.length && !used.has(n)); pgs.forEach((n) => used.add(n)); const sp = toSpec(T, c, g, key); sp.pagesOf = pgs; if (total > MAX_PAGES) sp.read.note = (sp.read.note ? sp.read.note + " " : "") + "Only the first " + MAX_PAGES + " of " + total + " pages were read."; specs.push(sp); }
      } else specs.push(await readFile(T, c, firmId, f));
    }
    return { specs, bad };
  }
  // While a firm is paused or its trial has ended, nothing runs: files are stored and held, the model is not called.
  async function hold(T, firmId, c, files, channel) {
    T.S.held = T.S.held || [];
    for (const f of files || []) { if (kindOf(f) === "skip") continue; T.S.held.push({ clientId: c ? c.id : null, fileKey: await store.putFile(firmId, f.bytes, f.contentType), contentType: f.contentType, channel, at: new Date(T.S.now) }); }
  }

  return {
    withFirm,
    kindOf,
    // A text arrives at one of our numbers. media: [{ bytes, contentType }]
    async inboundSms({ to, from, body, media, providerId }) {
      const firmId = await store.firmIdByNumber(digits(to)); if (!firmId) { say("unknown_number", to); return { handled: false }; }
      return withFirm(firmId, async (T) => {
        if (seen(T, providerId)) return { handled: true, duplicate: true };
        const ten = digits(from).slice(-10), shown = ten.length === 10 ? "(" + ten.slice(0, 3) + ") " + ten.slice(3, 6) + "-" + ten.slice(6) : String(from || "");
        const own = T.S.clients.filter((x) => x.mobile && digits(x.mobile) === ten), second = own.length ? [] : T.S.clients.filter((x) => also(x, "mobile", ten));
        const cands = own.length ? own : second, c = pick(T, cands), e = c && T.engOf(c.id), out = { handled: true, client: c && c.id, docs: [], intent: null };
        let text = String(body || "").trim();
        // A second contact (T-118) can send documents and ordinary messages for the client. It cannot change the client's consent:
        // STOP, START or HELP from a number we never text is shown to a person, not acted on.
        if (second.length && CONSENT_WORD.test(text)) { T.inboundText(null, text, null, shown + ", " + c.first + " " + c.last + "'s second contact"); out.intent = "unknown"; text = ""; }
        // No access (paused, trial ended) or a trial that has used its document checks: store the files, call no model.
        // inboundText still handles STOP and HELP, and sends the "contact the firm directly" reply at most once a week.
        if (!T.canRead()) { await hold(T, firmId, c, media, "text"); if (text || !T.access().ok) out.intent = T.inboundText(c ? c.id : null, text || "[photo]", null, shown); out.held = true; return out; }
        const { specs, bad } = await readAll(T, c, firmId, media);
        if (specs.length > 1 && c && cands.length < 2) { const res = T.inboundBundle(c.id, specs, "text"); res.docs.forEach((d, i) => { filed(d, specs[i]); out.docs.push(d.state); }); }
        else for (const spec of specs) { const oc = ownerOf(T, cands, spec, c); if (oc && oc !== c) { spec.recipient = "self"; out.routed = (out.routed || []).concat(oc.id); } if (!oc) spec.from = shown; const d = T.inboundDoc(oc ? oc.id : null, spec, "text"); if (d) { filed(d, spec); out.docs.push(d.state); } }
        if (bad && !specs.length && c) { T.inboundUnusable(c.id, bad, "text"); out.unusable = bad; }
        if (text) { const r = e ? await ask(prompts.readText(T, e, text), { tier: "quick" }) : null; out.intent = T.inboundText(c ? c.id : null, text, r, shown); }
        return out;
      });
    },
    // An email arrives at a firm's Tallyhound address. attachments: [{ bytes, contentType, pages?, inline?, width?, height? }]
    // trusted: false when the receiving mail server could not confirm the sender (see adapters/email-inbound.js). Such mail is never
    //          filed to a client on its own word: it waits for a person, exactly like mail from an address nobody knows.
    // forwarded: { from, body } when a staff member forwarded a client's email by hand. Honoured only when the forwarder is the firm itself.
    async inboundEmail({ to, from, body, attachments, providerId, trusted, forwarded }) {
      to = addr(to); from = addr(from);
      const firmId = await store.firmIdByInbox(String(to || "").toLowerCase()); if (!firmId) { say("unknown_inbox", to); return { handled: false }; }
      return withFirm(firmId, async (T) => {
        if (seen(T, providerId)) return { handled: true, duplicate: true };
        const staffAddr = [T.S.firm.email].concat(T.S.users.map((u) => u.email)).filter(Boolean).map((x) => String(x).toLowerCase());
        let byStaff = null;
        if (forwarded && forwarded.from && trusted !== false && staffAddr.includes(from)) { byStaff = from; from = addr(forwarded.from); body = forwarded.body != null ? forwarded.body : body; }
        const mine = T.S.clients.filter((x) => x.email && x.email.toLowerCase() === from), cands = mine.length ? mine : T.S.clients.filter((x) => also(x, "email", from)), known = pick(T, cands), c = trusted === false ? null : known;
        if (!c) {
          // Unknown or unconfirmed sender. Attachments are kept and read so a person can file them (a spouse writing from another address is common),
          // but nothing is sent back and nothing reaches a client's file until someone assigns it. A daily cap stops a stranger running up the bill.
          const day = new Date(T.S.now).toISOString().slice(0, 10), u = (T.S.firm.unknownReads = T.S.firm.unknownReads && T.S.firm.unknownReads.day === day ? T.S.firm.unknownReads : { day, n: 0 });
          const files = (attachments || []).filter((f) => kindOf(f) === "ok"), room = Math.max(0, UNKNOWN_FILES_PER_DAY - u.n), take = T.canRead() ? files.slice(0, room) : [], why = trusted === false ? (known ? "Says it is from " + known.first + " " + known.last + ", but the sender could not be confirmed" : "The sender could not be confirmed") : null;
          u.n += take.length; const out = { handled: true, client: null, docs: [], unverified: trusted === false || undefined };
          if (take.length) { const got = await readAll(T, null, firmId, take); for (const sp of got.specs) { sp.from = from; const d = T.inboundDoc(null, sp, "email"); if (d) { filed(d, sp); out.docs.push(d.state); const y = T.S.tray.find((t) => t.docId === d.id); if (y && why) { y.why = why; y.claims = known ? known.id : null; } } } }
          const text = T.scrub(String(body || "")).text.slice(0, 500).trim(), skipped = files.length - take.length;
          if (text || skipped || why) T.S.tray.push({ id: "y" + Date.now() + Math.random().toString(36).slice(2, 6), text: (text || "") + (skipped ? (text ? " " : "") + "[" + skipped + " attachment" + (skipped === 1 ? " was" : "s were") + " not kept. Ask the sender to send again.]" : ""), from, at: new Date(T.S.now), channel: "email", why: why || undefined, claims: why && known ? known.id : undefined });
          if (why) say("email_unverified", firmId, from);
          return out;
        }
        const e = T.engOf(c.id), specs = [];
        if (!T.canRead()) { await hold(T, firmId, c, attachments, "email"); if (!T.access().ok) T.inboundEmail(c.id, String(body || ""), [], null); return { handled: true, client: c.id, held: true }; }
        const got = await readAll(T, c, firmId, attachments), others = [];
        for (const sp of got.specs) { const oc = ownerOf(T, cands, sp, c); if (oc !== c) { sp.recipient = "self"; const d = T.inboundDoc(oc.id, sp, "email"); if (d) { filed(d, sp); others.push(oc.id); } } else specs.push(sp); }
        if (got.bad && !specs.length && !others.length && !String(body || "").trim()) { T.inboundUnusable(c.id, got.bad, "email"); return { handled: true, client: c.id, unusable: got.bad, docs: [] }; }
        const r = await ask(prompts.readEmail(T, e, String(body || "")), { tier: "quick" });
        const res = T.inboundEmail(c.id, String(body || ""), specs, r);
        res.docs.forEach((d, i) => { filed(d, specs[i]); });
        if (byStaff && e) T.timeline ? T.timeline(e, "Email forwarded in by " + byStaff) : null;
        return { handled: true, client: c.id, understood: res.m.understood, docs: res.docs.map((d) => d.state), forwardedBy: byStaff || undefined, routed: others.length ? others : undefined };
      });
    },
    // The client sends files from their own upload page (no login: the page is reached by their private link).
    // Checked exactly like a text or an email from them, and they get one reply. Held, not read, while the firm has no access.
    async clientUpload({ firmId, clientId, files, providerId }) {
      return withFirm(firmId, async (T) => {
        if (seen(T, providerId)) return { handled: true, duplicate: true };
        const c = T.client(clientId); if (!c) return { handled: false };
        if (!T.canRead()) { await hold(T, firmId, c, files, "portal"); return { handled: true, client: c.id, held: true, docs: [] }; }
        const { specs, bad } = await readAll(T, c, firmId, files), out = { handled: true, client: c.id, docs: [] };
        if (specs.length > 1) { const res = T.inboundBundle(c.id, specs, "portal"); res.docs.forEach((d, i) => { filed(d, specs[i]); out.docs.push(d.state); }); }
        else for (const spec of specs) { const d = T.inboundDoc(c.id, spec, "portal"); if (d) { filed(d, spec); out.docs.push(d.state); } }
        if (bad && !specs.length) { T.inboundUnusable(c.id, bad, "portal"); out.unusable = bad; }
        return out;
      });
    },
    // A staff member adds a document they received some other way. It is checked like any other and the client is not messaged.
    async staffUpload(firmId, userId, clientId, file) { return withFirm(firmId, async (T) => { if (!T.setUser(userId)) throw new Error("Unknown user"); const c = T.client(clientId); if (!c) throw new Error("Unknown client"); const k = kindOf(file); if (k !== "ok") return { error: k }; const { specs } = await readAll(T, c, firmId, [file]); return { docs: specs.map((sp) => { const d = T.staffDoc(c.id, sp); if (d) filed(d, sp); return d && d.state; }) }; }); },
    // Files that arrived while the firm was paused. Call after a plan is chosen or a pause ends. The reader gets the stored bytes back.
    async readHeld(firmId, load) { load = load || (async (key) => { const f = await store.getFile(firmId, key); return f ? f.bytes : null; }); return withFirm(firmId, async (T) => { if (!T.canRead()) return 0; const L = T.S.held || []; T.S.held = []; let n = 0; for (const h of L) { const c = h.clientId && T.client(h.clientId); if (!c) { (T.S.purgeFiles = T.S.purgeFiles || []).push(h.fileKey); continue; } const bytes = await load(h.fileKey); if (!bytes) continue; const { specs } = await readAll(T, c, firmId, [{ bytes, contentType: h.contentType }]); for (const sp of specs) { const d = T.inboundDoc(c.id, sp, h.channel); if (d) filed(d, sp); n++; } (T.S.purgeFiles = T.S.purgeFiles || []).push(h.fileKey); } return n; }); },
    // Run on a timer, every few minutes, for every firm: sends whatever is due.
    tick(firmId) { return withFirm(firmId, async (T) => { T.tick(); return true; }); },
    // Anything a signed-in staff member does: fn receives the engine, already set to that user.
    staff(firmId, userId, fn) { return withFirm(firmId, async (T) => { if (!T.setUser(userId)) throw new Error("Unknown user"); return fn(T); }); },
    // Create a firm's workspace.
    // The client's taps from the check-in page. The page itself needs no login: it is reached by a signed link (T-68).
    async checkinAnswers(firmId, clientId, answers) { return withFirm(firmId, async (T) => { if (!T.client(clientId)) throw new Error("Unknown client"); const a = Object.assign({}, answers || {}); delete a.topics; delete a.custom;   // only the model's reading may set these, never the browser
      if (String(a.note || "").trim()) { const r = await ask(prompts.checkinNote(T, a.note)); if (r) { a.topics = [].concat(r.topics || []).filter((k) => typeof k === "string"); a.custom = [].concat(r.documents || []).filter((k) => typeof k === "string"); } }
      return T.checkinDone(clientId, a); }); },
    // Fills in Spanish wording for custom requests that lack it. Safe to call after any staff action that adds one.
    async translateCustoms(firmId) { return withFirm(firmId, async (T) => { const L = T.needsSpanish(); if (!L.length) return 0; const r = await ask(prompts.translateRequests(L.map((i) => i.custom))); let n = 0; ((r && r.es) || []).forEach((t, k) => { if (L[k] && typeof t === "string" && T.setCustomEs(L[k].id, t)) n++; }); return n; }); },
    // Starts the next tax year for every finished client. Owner only: check the role before calling.
    async rollSeason(firmId, userId, year) { return withFirm(firmId, async (T) => { const u = T.S.users.find((x) => x.id === userId); if (!u || u.role !== "owner") throw new Error("Only an owner can start a season"); T.setUser(userId); return T.rollSeason(year); }); },
    async createFirm(firmId, opt) { const T = createEngine(); T.blank(Object.assign({ now: now() }, opt)); T.S.firm.smsNumber = opt.smsNumber || ""; T.S.firm.iana = opt.iana || null; if (opt.tz) T.S.firm.tz = opt.tz; await store.create(firmId, T.dump(), { number: digits(opt.smsNumber), inbox: String(opt.inbox || opt.email || "").toLowerCase() }); return firmId; },
    // A signed-in staff member opens a document. Returns the bytes, or null when Tallyhound no longer holds a copy. Every view is logged.
    async openFile(firmId, userId, docId) { let key = null; await withFirm(firmId, async (T) => { if (!T.setUser(userId)) throw new Error("Unknown user"); const d = T.S.docs.find((x) => x.id === docId); if (!d || !d.fileKey) return; key = d.fileKey; if (T.audit) T.audit("doc.view", "Opened " + (d.form || "a document"), T.S.user.name); }); return key ? store.getFile(firmId, key) : null; },
    // Closing an account: the firm's key is destroyed first, so every stored byte is unreadable even before the rows are gone.
    async destroyFirm(firmId, userId) { await withFirm(firmId, async (T) => { const u = T.S.users.find((x) => x.id === userId); if (!u || u.role !== "owner") throw new Error("Only an owner can close the account"); return true; }); if (store.destroyFirm) await store.destroyFirm(firmId); return true; }
  };
}
module.exports = { wallTime, createApp, nameMatch, UNKNOWN_FILES_PER_DAY, MAX_PAGES };
