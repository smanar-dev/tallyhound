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
const { AsyncLocalStorage } = require("node:async_hooks");
const { createHash } = require("node:crypto");
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
// Which pages of a file go into one document's own PDF, when several forms arrived as one file (TH-DOC-19). Its own pages, plus any
// page nobody was given (a blank back, an instruction sheet, a page past the reading limit): such a page goes with the document
// before it, or with the first document when it comes before them all. So every page of the original lands in exactly one file.
function pagesToFile(total, own, others) {
  const mine = new Set((own || []).map(Number).filter((n) => n >= 1 && n <= total)), claim = new Map();
  (others || []).forEach((L, k) => (L || []).forEach((n) => { n = Number(n); if (n >= 1 && n <= total && !claim.has(n)) claim.set(n, k); })); mine.forEach((n) => claim.set(n, -1));
  if (!mine.size) return []; const first = Math.min.apply(null, [...claim.keys()]); let cur = claim.get(first); const out = [];
  for (let n = 1; n <= total; n++) { if (claim.has(n)) cur = claim.get(n); if (cur === -1) out.push(n); }
  return out;
}

function createApp({ store, sms, email, ai, clock, log, files, voice, cut, layer }) {
  const now = clock || (() => new Date());
  // T-106: the model reads before the firm is locked. An inbound event is first run against a throwaway copy of the firm with no lock held.
  // Nothing from that run is kept except what the model answered (by the exact prompt and pictures) and where each file was stored.
  // Then the same code runs under the lock and finds its answers waiting. If the firm changed in between, the prompt differs, the answer
  // is not found, and the model is asked under the lock as before: slower, never wrong.
  const ahead = new AsyncLocalStorage();
  const say = (...a) => { const m = ahead.getStore(); if (log && !(m && m.record)) log(...a); };
  const call = async (prompt, opts) => { if (!ai) return null; try { const r = await ai.json(prompt, opts || {}); return r && typeof r === "object" ? r : null; } catch (err) { if (log) log("ai_error", String(err && err.message || err)); return null; } };
  const sum = (parts) => { const h = createHash("sha256"); for (const p of parts) { h.update(Buffer.isBuffer(p) || p instanceof Uint8Array ? p : JSON.stringify(p === undefined ? null : p)); h.update("|"); } return h.digest("hex"); };
  const ask = async (prompt, opts) => {
    const m = ahead.getStore(); if (!m || !ai) return call(prompt, opts);
    const k = sum([prompt, (opts && opts.tier) || ""].concat((opts && opts.images) || [])); if (m.answers.has(k)) return m.answers.get(k);
    const r = await call(prompt, opts); m.answers.set(k, r); return r;
  };
  const put = async (firmId, bytes, contentType) => {
    const m = ahead.getStore(); if (!m) return store.putFile(firmId, bytes, contentType);
    const k = sum([firmId, contentType || "", bytes]), L = m.files.get(k) || []; m.files.set(k, L);
    if (m.record) { const key = await store.putFile(firmId, bytes, contentType); L.push(key); return key; }
    return L.length ? L.shift() : store.putFile(firmId, bytes, contentType);
  };
  const open = (json) => { const T = createEngine(); T.load(json); T.setNow(T.S.firm.iana ? wallTime(now(), T.S.firm.iana) : now()); T.S.firm.hound.aiLive = !!ai && T.S.firm.hound.aiWrite !== false; if (T.S.firm.delivery) T.S.firm.delivery.physical = !!files; return T; };
  async function readFirst(firmId, fn, scope) {
    if (!store.readState) return withFirm(firmId, fn, scope);
    const memo = { record: true, answers: new Map(), files: new Map() };
    try { const json = scope && store.readScope ? await store.readScope(firmId, scope) : await store.readState(firmId); const first = () => ahead.run(memo, async () => { const T0 = open(json); await fn(T0); await write(T0); }); if (json) await (store.forFirm ? store.forFirm(firmId, first) : first()); } catch (err) { /* the locked run below decides what happens */ }
    memo.record = false;
    try { return await ahead.run(memo, () => withFirm(firmId, fn, scope)); }
    // A file stored by the first run that the locked run did not take is in no saved state, so it can go at once.
    finally { if (store.deleteFile) for (const L of memo.files.values()) for (const key of L) await store.deleteFile(firmId, key).catch(() => {}); }
  }

  // Load one firm, run fn against its engine, let the model write, send what is ready, save. One firm at a time.
  // Send once. A message is claimed and saved before the provider is called, and the provider's answer is saved after.
  // If we crash or the save fails in between, the message is left claimed with no answer: it is flagged for a person
  // and never sent again automatically. A late text is a nuisance; a duplicate text to a client is worse.
  const CLAIM_STALE_MS = 2 * 60 * 1000;
  // scope (T-101): { mobile, email, emails, clientIds } when the event is about known clients only. The store then loads the core and
  // those clients' parts instead of the whole firm. Leave it out for anything that looks across clients (the timer, staff actions).
  async function withFirm(firmId, fn, scope) {
    let result, jobs = [], fjobs = [], mjobs = [];
    const lock = (f) => (scope && store.lockScope ? store.lockScope(firmId, scope, f) : store.lock(firmId, f));
    await lock(async (json) => {
      if (!json) throw new Error("Unknown firm " + firmId);
      const T = open(json);   // also tells the engine whether a real storage connection exists, so it waits for the firm's copy before letting go of ours
      await dropFiles(T, firmId);
      result = await fn(T);
      await write(T); sweep(T, firmId); mjobs = mirrorJobs(T); jobs = claim(T); fjobs = fileJobs(T);
      return T.dump();
    });
    if (!jobs.length && !fjobs.length && !mjobs.length) return result;
    // The mail layer's copy of who owes what (TH-NTR). Written before any letter, so a letter never names a document the copy has
    // as done, and a project exists before a letter is sent on it. A project that fails takes its tasks with it until the next try.
    const mdone = [], proj = new Map(), down = new Set();
    for (const j of mjobs) {
      if (down.has(j.engId)) continue;
      try {
        if (j.op === "project") { const r = await layer.upsertProject({ firmId, owner: j.owner, key: j.key, remoteId: j.remoteId, name: j.name, email: j.email, closed: j.closed, due: j.due }); proj.set(j.engId, r.id); mdone.push({ op: j.op, engId: j.engId, ver: j.ver, owner: j.owner, id: r.id }); }
        else if (j.op === "task") { const pid = proj.get(j.engId) || j.projectId; if (!pid) throw new Error("No project yet"); const r = await layer.upsertTask({ firmId, owner: j.owner, key: j.key, projectId: pid, remoteId: j.remoteId, title: j.title, status: j.status, note: j.note }); mdone.push({ op: j.op, engId: j.engId, itemId: j.itemId, ver: j.ver, status: j.status, id: r.id }); }
        else { await layer.forgetProject({ firmId, owner: j.owner, key: j.key, projectId: j.remoteId }); mdone.push({ op: j.op, engId: j.engId }); }
      } catch (err) { down.add(j.engId); mdone.push({ op: j.op, engId: j.engId, error: String(err && err.message || err) }); }
    }
    // The firm's own storage. Each original is put there the moment it arrives, then given its final name once it has been checked.
    const fdone = [];
    for (const j of fjobs) {
      try {
        if (j.act === "put") { const f = await store.getFile(firmId, j.key); if (!f) throw new Error("Our copy is missing");
          // One form out of a file that held several is filed as a PDF of its own pages. If the file cannot be cut, the whole file is filed: nothing is lost.
          let bytes = f.bytes; if (j.pages && cut && /pdf/.test(f.contentType || "")) { const part = await cut(f.bytes, j.pages.own, j.pages.others); if (part) bytes = part; else say("pdf_cut_failed", firmId, j.docId); }
          fdone.push({ docId: j.docId, place: j.place, id: await files.put({ firmId, provider: j.provider, folder: j.folder, name: j.name, bytes, contentType: f.contentType }) }); }
        else { await files.move({ firmId, provider: j.provider, id: j.id, folder: j.folder, name: j.name }); fdone.push({ docId: j.docId, place: j.place, id: j.id }); }
      } catch (err) { fdone.push({ docId: j.docId, error: String(err && err.message || err) }); }
    }
    const done = [];
    for (const j of jobs) {
      try { if (j.channel === "voice" && !voice) throw new Error("Calls are not connected");
        // A letter of an email-first firm goes through the mail layer, from the preparer's own mailbox. The message id is the key the
        // layer must honour (TH-NTR-3), so trying again after an outage can never send it twice.
        if (j.layer) { const pid = proj.get(j.engId) || j.projectId; if (!pid) throw Object.assign(new Error("The email service is not ready for this client yet"), { code: "unreachable" }); const r = await layer.sendLetter({ firmId, owner: j.owner, key: j.id, projectId: pid, to: j.to, subject: j.subject, body: j.body, thread: j.thread, unsubscribe: j.unsubscribe }); done.push({ id: j.id, providerId: r.id, thread: r.thread, engId: j.engId }); continue; }
        done.push({ id: j.id, providerId: j.channel === "voice" ? await voice.call({ from: j.from, to: j.to, say: j.body, idempotencyKey: j.id }) : j.channel === "text" ? await sms.send({ from: j.from, to: j.to, body: j.body, idempotencyKey: j.id }) : await email.send({ firmId, from: j.from, replyTo: j.replyTo, fromName: j.fromName, to: j.to, subject: j.subject, body: j.body, idempotencyKey: j.id, unsubscribe: j.unsubscribe }) }); }
      catch (err) { done.push({ id: j.id, error: String(err && err.message || err), code: err && err.code, layer: !!j.layer }); }
    }
    await lock(async (json) => {
      const T = createEngine(); T.load(json); T.setNow(T.S.firm.iana ? wallTime(now(), T.S.firm.iana) : now());
      for (const r of fdone) {
        const d = T.S.docs.find((x) => x.id === r.docId); if (!d) continue; const m = (d.master = d.master || { at: new Date(T.S.now) }); delete m.busy;
        if (!r.error) { m.id = r.id; m.place = r.place; m.fails = 0; d.hold = null; continue; }
        m.fails = (m.fails || 0) + 1; d.hold = "storage"; say("file_failed", firmId, d.id, r.error);
        const e = d.engId && T.eng(d.engId), c = e && T.client(e.clientId);
        if (m.fails === 3 && e && c) T.alertx(e, "high", "storage_failed", (T.S.firm.delivery.provider || "Your storage") + " is disconnected, so documents are waiting here safely, starting with one for " + c.first + " " + c.last + ". Reconnect it under Settings to file them.", "sf" + d.id);
      }
      const t = now().getTime();
      for (const j of mjobs) { const e = T.eng(j.engId); if (e && e.mirror) delete e.mirror.busy; }
      for (const r of mdone) {
        const e = T.eng(r.engId); if (!e) continue; const M = (e.mirror = e.mirror || { tasks: {} });
        if (r.error) {
          // TH-NTR-5: nothing is lost while the layer is away. The same write is tried again, a little later each time, and after a day a person is told.
          const E = (M.err = M.err || { n: 0, first: t }); E.n++; E.msg = r.error.slice(0, 200); E.next = t + Math.min(60, Math.pow(2, Math.min(E.n, 6))) * 60000; say("mirror_failed", firmId, r.engId, r.op);
          if (t - E.first > MIRROR_ALERT_MS && !E.told) { E.told = true; const c = T.client(e.clientId); T.alertx(e, "high", "mirror", "Tallyhound's email service has not taken updates for " + (c ? c.first + " " + c.last : "a client") + " for a day. Letters may be late. Nothing is lost, and it keeps trying.", "mir" + e.id + E.first); }
          continue;
        }
        delete M.err;
        if (r.op === "project") { M.id = r.id; M.ver = r.ver; M.owner = r.owner; } else if (r.op === "task") { M.tasks = M.tasks || {}; M.tasks[r.itemId] = Object.assign(M.tasks[r.itemId] || {}, { id: r.id, ver: r.ver, status: r.status }); } else M.gone = true;
      }
      for (const r of done) {
        const m = T.S.msgs.find((x) => x.id === r.id); if (!m) continue; const e = T.eng(m.engId), c = e && T.client(e.clientId);
        if (!r.error) { m.providerId = r.providerId; m.sentAt = new Date(T.S.now); if (r.thread && e) e.thread = r.thread; delete m.retryAt; continue; }
        // The layer could not be reached: the letter did not go. It stays in line and is tried again with the same key, for a day.
        if (r.layer && String(r.code) === "unreachable" && t - (m.firstTry || t) < MIRROR_ALERT_MS) { m.firstTry = m.firstTry || t; m.tries = (m.tries || 0) + 1; m.retryAt = t + Math.min(60, Math.pow(2, Math.min(m.tries, 6))) * 60000; delete m.claimedAt; say("letter_waiting", firmId, m.id); continue; }
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
  // A document that came in one file with others: its own pages and everyone else's, for pagesToFile. Null for a file of its own.
  const sharedPages = (T, d) => (d.pagesOf && d.pagesOf.length ? { own: d.pagesOf, others: T.S.docs.filter((x) => x.id !== d.id && x.fileKey === d.fileKey && x.pagesOf && x.pagesOf.length).map((x) => x.pagesOf) } : null);
  function fileJobs(T) {
    const v = T.S.firm.delivery || {}; if (!files || !v.provider || v.provider === "Download" || v.auto !== "on") return [];
    const out = [], ext = (t) => (/pdf/.test(t || "") ? ".pdf" : /png/.test(t || "") ? ".png" : ".jpg"), stale = now().getTime() - CLAIM_STALE_MS;
    for (const d of T.S.docs) {
      if (!d.engId || out.length >= 20) continue; const m = d.master; if (m && m.busy && m.busy > stale) continue;
      const e = T.eng(d.engId), c = e && T.client(e.clientId); if (!c) continue;
      const base = v.folder + "/" + e.year + "/" + (c.entity || c.last + ", " + c.first), final = d.state === "accepted" && d.deliveredAt, unused = ["rejected", "duplicate", "discarded"].includes(d.state);
      const want = final ? "final" : unused ? "unused" : "incoming", folder = want === "final" ? base : base + (want === "unused" ? "/_Not used" : "/_To check");
      if (m && m.id && m.place !== want) { m.busy = now().getTime(); d.hold = "storage"; out.push({ act: "move", docId: d.id, provider: v.provider, id: m.id, place: want, folder, name: want === "final" ? (T.filedName ? T.filedName(c, e, d).replace(/\.pdf$/, ext(d.contentType)) : T.fileName(c, e, d)) : m.name || d.id }); }
      else if (!(m && m.id) && d.fileKey && (m || final)) { const name = want === "final" ? (T.filedName ? T.filedName(c, e, d).replace(/\.pdf$/, ext(d.contentType)) : T.fileName(c, e, d)) : "arrived " + new Date(d.at).toISOString().slice(0, 10) + " " + d.id + ext(d.contentType); d.master = Object.assign(m || { at: new Date(T.S.now) }, { busy: now().getTime(), name }); d.hold = "storage"; out.push({ act: "put", docId: d.id, provider: v.provider, key: d.fileKey, place: want, folder, name, pages: sharedPages(T, d) }); }
    }
    return out;
  }
  // Marks every message that is ready and returns what to send. Nothing leaves until this has been saved.
  function claim(T) {
    const S = T.S, jobs = [];
    const viaLayer = !!layer && S.firm.letters === true && S.firm.mail === "mailbox";
    for (const m of S.msgs.filter((x) => x.dir === "out" && x.status === "delivered" && !x.sentAt && !x.failed && !x.claimedAt)) {
      const e = T.eng(m.engId), c = e && T.client(e.clientId); if (!c) continue;
      if (m.retryAt && m.retryAt > now().getTime()) continue;
      if (T.letterCheck && !T.letterCheck(m.id)) continue;   // TH-EML-5: checked as it leaves. A letter naming a document that has since arrived is not sent
      m.claimedAt = now().getTime();
      if (m.channel === "text") { jobs.push({ id: m.id, channel: "text", from: S.firm.smsNumber, to: c.mobile, body: m.body }); continue; }
      // A recorded reminder call (T-50). Claimed and saved before the call is placed, like every send, and never placed twice.
      if (m.channel === "voice") { jobs.push({ id: m.id, channel: "voice", from: S.firm.smsNumber, to: c.mobile, body: m.body }); continue; }
      // Every email carries a way to stop them: a line at the foot, and the address the mail provider puts in the one-click header.
      const pc = m.contactId ? (c.contacts || []).find((x) => x.id === m.contactId) : null; if (m.contactId && (!pc || pc.emailOff)) { m.status = "discarded"; m.note = "That person no longer gets letters"; delete m.claimedAt; continue; }
      const un = T.unsubscribeLink ? T.unsubscribeLink(c, pc || undefined) : "", foot = un ? "\n\nYou're getting this because " + S.firm.name + " prepares your taxes. To stop these emails: https://" + un : "";
      const subject = m.subject || S.firm.sender + ": your " + e.year + " tax documents";
      const to = pc ? pc.email : c.email;
      if (viaLayer) { jobs.push({ id: m.id, channel: "email", layer: true, owner: m.sender && m.sender !== "firm" ? m.sender : (e.mirror && e.mirror.owner) || c.preparer, engId: e.id, projectId: (e.mirror && e.mirror.id) || null, to, subject, body: m.body + foot, thread: pc ? null : e.thread || null, unsubscribe: un ? "https://" + un : undefined }); continue; }
      jobs.push({ id: m.id, channel: "email", from: S.firm.domain && S.firm.domain.verified && S.firm.domain.from ? S.firm.domain.from : S.firm.email, replyTo: S.firm.email, fromName: S.firm.sender, to, subject, body: m.body + foot, unsubscribe: un ? "https://" + un : undefined });
    }
    return jobs;
  }
  // What the mail layer's copy needs changing to, as a list of writes. Each write carries a key made of the record's id and a
  // short hash of what it should hold (TH-NTR-3): sending the same write twice changes nothing.
  const MIRROR_OPS_A_PASS = 300, MIRROR_ALERT_MS = 24 * 3600 * 1000;
  function mirrorJobs(T) {
    if (!layer || !T.mirrorWant || !T.S.firm.letters || T.S.firm.mail !== "mailbox") return [];
    const out = [], t = now().getTime(), ver = (parts) => sum(parts).slice(0, 16);
    for (const e of T.S.engs) {
      if (out.length >= MIRROR_OPS_A_PASS) break; const M = e.mirror;
      if (e.purged) { if (M && M.id && !M.gone && !(M.err && M.err.next > t)) out.push({ op: "forget", engId: e.id, owner: M.owner, key: e.id + ":forget", remoteId: M.id }); continue; }
      const w = T.mirrorWant(e.id); if (!w) continue; const R = (e.mirror = M || { tasks: {} }); R.tasks = R.tasks || {};
      if ((R.err && R.err.next > t) || (R.busy && R.busy > t - CLAIM_STALE_MS)) continue;
      const pv = ver([w.name, w.email, w.closed, w.due, w.owner, R.fix || 0]), ops = [];
      if (R.ver !== pv || !R.id) ops.push({ op: "project", engId: e.id, owner: w.owner, key: e.id + ":" + pv, ver: pv, remoteId: R.id || null, name: w.name, email: w.email, closed: w.closed, due: w.due });
      for (const k of w.tasks) { const r = R.tasks[k.key] || {}, tv = ver([k.title, k.status, k.note, r.fix || 0]); if (r.ver !== tv || !r.id) ops.push({ op: "task", engId: e.id, itemId: k.key, owner: w.owner, key: k.key + ":" + tv, ver: tv, projectId: R.id || null, remoteId: r.id || null, title: k.title, status: k.status, note: k.note }); }
      if (ops.length) { R.busy = t; for (const o of ops) out.push(o); }
    }
    return out;
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
    const key = await put(firmId, file.bytes, file.contentType);
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
        const key = await put(firmId, f.bytes, f.contentType), r = await ask(prompts.readBundle(T), { images: pages, tier: "default" });
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
    for (const f of files || []) { if (kindOf(f) === "skip") continue; T.S.held.push({ clientId: c ? c.id : null, fileKey: await put(firmId, f.bytes, f.contentType), contentType: f.contentType, channel, at: new Date(T.S.now) }); }
  }

  // An email from a client of an email-first firm, however it reached us: the firm's Tallyhound address, or the mail layer reading
  // the preparer's mailbox. Attachments are checked like any upload and answered once; the words are read as a reply (TH-EML-9).
  async function lettersIn(T, firmId, c, body, attachments, opt) {
    const e = T.engOf(c.id), out = { handled: true, client: c.id, docs: [] }, files = attachments || [];
    if (files.length) {
      const got = await readAll(T, c, firmId, files);
      if (got.specs.length) { const res = T.inboundEmail(c.id, String(body || "").trim(), got.specs, null); res.docs.forEach((d, i) => { filed(d, got.specs[i]); d.intake = "email_attachment"; out.docs.push(d.state); }); }
      else if (got.bad) { T.inboundUnusable(c.id, got.bad, "email"); out.unusable = got.bad; }
    }
    // The layer saw an attachment it cannot hand over yet: a person is asked to forward that email or add the file (TH-UPL-5, the fallback).
    if (opt.attachmentsHeld && T.attachmentWaiting) T.attachmentWaiting(c.id, opt.attachmentsHeld);
    // Words that came with a document were kept with it and answered in the one reply. Words alone are read as a reply.
    const text = out.docs.length ? "" : String(body || "").trim();
    if (text && e) {
      let r = await ask(prompts.readText(T, e, text), { tier: "quick" });
      // The layer's own reading is one more suggestion. It is used only when ours has none, and the engine checks it like any other.
      if ((!r || !r.intent) && opt.proposed === "Completed" && !out.docs.length) r = { intent: "already_sent", confidence: "high", legacy_intent: "other_update", item_id: null };
      out.intent = T.inboundReply(c.id, text, r);
    }
    return out;
  }

  return {
    withFirm,
    kindOf,
    /** A reply the mail layer read in a preparer's mailbox (TH-EML-9). Only a sender on the firm's client list is ever acted on. */
    async layerReply({ firmId, from, text, proposed, attachments, attachmentsHeld, providerId }) {
      const from0 = addr(from);
      return readFirst(firmId, async (T) => {
        if (seen(T, providerId)) return { handled: true, duplicate: true };
        if (!T.LETTERS || !T.LETTERS()) return { handled: false };
        const mine = T.S.clients.filter((x) => x.email && x.email.toLowerCase() === from0), c = pick(T, mine.length ? mine : T.S.clients.filter((x) => also(x, "email", from0)));
        if (!c) { say("layer_reply_unknown", firmId); return { handled: true, client: null }; }
        if (!T.canRead()) { await hold(T, firmId, c, attachments, "email"); if (!T.access().ok) T.inboundEmail(c.id, String(text || ""), [], null); return { handled: true, client: c.id, held: true }; }
        return lettersIn(T, firmId, c, String(text || ""), attachments, { proposed, attachmentsHeld });
      }, { emails: [from0] });
    },
    /** A letter bounced (TH-EML-8): the address stops being written to and a person is told. */
    async layerBounce({ firmId, to, providerId }) { const a = addr(to); return withFirm(firmId, async (T) => { if (seen(T, providerId)) return { handled: true, duplicate: true }; const c = T.S.clients.find((x) => x.email && x.email.toLowerCase() === a); if (!c || !T.emailBounced) return { handled: true, client: null }; T.emailBounced(c.id); return { handled: true, client: c.id }; }, { emails: [a] }); },
    /** TH-NTR-7, 8: once a night. Every mirrored engagement is compared with what the layer holds; anything that differs is put back
        to what Tallyhound says, and each status change the layer recorded is copied into the audit trail. Returns what it found. */
    async reconcile(firmId) {
      if (!layer || !store.readState) return { checked: 0, drift: [] };
      const json = await store.readState(firmId); if (!json) return { checked: 0, drift: [] }; const T0 = open(json), found = [];
      if (!T0.S.firm.letters || T0.S.firm.mail !== "mailbox") return { checked: 0, drift: [] };
      let checked = 0;
      for (const e of T0.S.engs) {
        const M = e.mirror, w = M && M.id && !M.gone ? T0.mirrorWant(e.id) : null; if (!w) continue; checked++;
        try {
          const r = await layer.getProject({ firmId, owner: M.owner || w.owner, projectId: M.id }), miss = [];
          if (!r) miss.push({ engId: e.id, what: "project", gone: true });
          else { if (r.name !== w.name || !!r.closed !== !!w.closed) miss.push({ engId: e.id, what: "project" });
            for (const k of w.tasks) { const have = (M.tasks || {})[k.key], rt = have && (r.tasks || []).find((x) => x.id === have.id); if (!rt) miss.push({ engId: e.id, what: "task", itemId: k.key, gone: true }); else if (rt.status !== k.status || rt.title !== k.title) miss.push({ engId: e.id, what: "task", itemId: k.key, was: rt.status }); } }
          found.push({ engId: e.id, miss, history: r ? r.history || [] : [] });
        } catch (err) { say("reconcile_failed", firmId, e.id); }
      }
      const drift = [];
      await withFirm(firmId, async (T) => {
        for (const f of found) {
          const e = T.eng(f.engId), M = e && e.mirror; if (!M) continue;
          for (const x of f.miss) { drift.push({ engId: x.engId, what: x.what, itemId: x.itemId }); // A repair is a new write with a new key: the layer has already seen the old key and would do nothing for it.
            if (x.what === "project") { M.ver = null; M.fix = (M.fix || 0) + 1; if (x.gone) { M.id = null; M.tasks = {}; } } else if (M.tasks && M.tasks[x.itemId]) { M.tasks[x.itemId].ver = null; M.tasks[x.itemId].fix = (M.tasks[x.itemId].fix || 0) + 1; if (x.gone) M.tasks[x.itemId].id = null; } }
          // Each change of status the layer recorded, once, in the firm's audit trail.
          const since = M.histAt || 0; let top = since;
          for (const h of f.history) { const at = +new Date(h.at); if (!(at > since)) continue; top = Math.max(top, at); const it = T.S.items.find((i) => M.tasks && M.tasks[i.id] && M.tasks[i.id].id === h.taskId); T.audit("mirror.status", (it ? T.itemTitle(it, "en") : "A document") + ": " + (h.from ? h.from + " to " : "") + h.to, h.by === "client" ? "The client" : "Tallyhound"); }
          M.histAt = top;
        }
        if (drift.length) T.audit("mirror.repaired", drift.length + " record" + (drift.length === 1 ? "" : "s") + " in the email service did not match and " + (drift.length === 1 ? "was" : "were") + " put back", "Tallyhound");
        return true;
      });
      if (drift.length) say("mirror_drift", firmId, drift.length);
      return { checked, drift };
    },
    // A text arrives at one of our numbers. media: [{ bytes, contentType }]
    async inboundSms({ to, from, body, media, providerId }) {
      const firmId = await store.firmIdByNumber(digits(to)); if (!firmId) { say("unknown_number", to); return { handled: false }; }
      return readFirst(firmId, async (T) => {
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
      }, { mobile: digits(from) });
    },
    // An email arrives at a firm's Tallyhound address. attachments: [{ bytes, contentType, pages?, inline?, width?, height? }]
    // trusted: false when the receiving mail server could not confirm the sender (see adapters/email-inbound.js). Such mail is never
    //          filed to a client on its own word: it waits for a person, exactly like mail from an address nobody knows.
    // forwarded: { from, body } when a staff member forwarded a client's email by hand. Honoured only when the forwarder is the firm itself.
    async inboundEmail({ to, from, body, attachments, providerId, trusted, forwarded }) {
      to = addr(to); from = addr(from);
      const firmId = await store.firmIdByInbox(String(to || "").toLowerCase()); if (!firmId) { say("unknown_inbox", to); return { handled: false }; }
      const from0 = from, body0 = body;
      return readFirst(firmId, async (T) => {
        let from = from0, body = body0;   // this runs twice (T-106), so it must not change what it was given
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
        if (T.LETTERS && T.LETTERS()) { const out = await lettersIn(T, firmId, c, String(body || ""), attachments, {}); if (byStaff && e && T.timeline) T.timeline(e, "Email forwarded in by " + byStaff); out.forwardedBy = byStaff || undefined; return out; }
        const got = await readAll(T, c, firmId, attachments), others = [];
        for (const sp of got.specs) { const oc = ownerOf(T, cands, sp, c); if (oc !== c) { sp.recipient = "self"; const d = T.inboundDoc(oc.id, sp, "email"); if (d) { filed(d, sp); others.push(oc.id); } } else specs.push(sp); }
        if (got.bad && !specs.length && !others.length && !String(body || "").trim()) { T.inboundUnusable(c.id, got.bad, "email"); return { handled: true, client: c.id, unusable: got.bad, docs: [] }; }
        const r = await ask(prompts.readEmail(T, e, String(body || "")), { tier: "quick" });
        const res = T.inboundEmail(c.id, String(body || ""), specs, r);
        res.docs.forEach((d, i) => { filed(d, specs[i]); });
        if (byStaff && e) T.timeline ? T.timeline(e, "Email forwarded in by " + byStaff) : null;
        return { handled: true, client: c.id, understood: res.m.understood, docs: res.docs.map((d) => d.state), forwardedBy: byStaff || undefined, routed: others.length ? others : undefined };
      }, { emails: [from0, forwarded && forwarded.from ? addr(forwarded.from) : null] });
    },
    // The client sends files from their own upload page (no login: the page is reached by their private link).
    // Checked exactly like a text or an email from them, and they get one reply. Held, not read, while the firm has no access.
    async clientUpload({ firmId, clientId, files, providerId }) {
      return readFirst(firmId, async (T) => {
        if (seen(T, providerId)) return { handled: true, duplicate: true };
        const c = T.client(clientId); if (!c) return { handled: false };
        if (!T.canRead()) { await hold(T, firmId, c, files, "portal"); return { handled: true, client: c.id, held: true, docs: [] }; }
        const { specs, bad } = await readAll(T, c, firmId, files), out = { handled: true, client: c.id, docs: [] };
        // Each document remembers which upload it came in, so the page can tell the client what was found (TH-UPL-4), and how it arrived.
        if (specs.length > 1) { const res = T.inboundBundle(c.id, specs, "portal"); res.docs.forEach((d, i) => { filed(d, specs[i]); d.batch = providerId || null; d.intake = "upload_link"; out.docs.push(d.state); }); }
        else for (const spec of specs) { const d = T.inboundDoc(c.id, spec, "portal"); if (d) { filed(d, spec); d.batch = providerId || null; d.intake = "upload_link"; out.docs.push(d.state); } }
        if (bad && !specs.length) { T.inboundUnusable(c.id, bad, "portal"); out.unusable = bad; }
        return out;
      }, { clientIds: [clientId] });
    },
    // A staff member adds a document they received some other way. It is checked like any other and the client is not messaged.
    async staffUpload(firmId, userId, clientId, file) { return readFirst(firmId, async (T) => { if (!T.setUser(userId)) throw new Error("Unknown user"); const c = T.client(clientId); if (!c) throw new Error("Unknown client"); const k = kindOf(file); if (k !== "ok") return { error: k }; const { specs } = await readAll(T, c, firmId, [file]); return { docs: specs.map((sp) => { const d = T.staffDoc(c.id, sp); if (d) filed(d, sp); return d && d.state; }) }; }, { clientIds: [clientId] }); },
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
module.exports = { wallTime, createApp, pagesToFile, nameMatch, UNKNOWN_FILES_PER_DAY, MAX_PAGES };
