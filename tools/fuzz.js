// Randomized audit of the Tallyhound rules engine. node fuzz.js [seeds] [steps]
const fs = require("fs");
const src = fs.readFileSync(require("node:path").join(__dirname, "../packages/engine/engine.js"), "utf8");
const make = new Function("window", src + "\nreturn window.TH;");
const SEEDS = +process.argv[2] || 40, STEPS = +process.argv[3] || 400;
const found = new Map();
const note = (k, d) => { if (!found.has(k)) found.set(k, { n: 0, d }); found.get(k).n++; };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const TEXTS = ["STOP", "stop", "Stop texting me", "START", "HELP", "yes", "no", "YES", "I don't have that", "where do I find it?", "I'll send it next week", "thanks", "ok", "can I deduct my dog?", "this is ridiculous, I already sent it", "call me", "", "   ", "?", "sí", "no tengo", "ALTO", "what's my bill", "unsubscribe", "I'll stop by the end of the week", "😀", "a".repeat(2000), "<script>alert(1)</script>", "My wife handles this", "wrong number"];
for (let seed = 1; seed <= SEEDS; seed++) {
  const T = make({}), r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
  if (seed % 4 === 0) { T.blank({ name: "Fuzz & Co", email: "d@f.example", plan: seed % 8 === 4 ? undefined : "Practice", senderStatus: "approved", mode: seed % 8 < 5 ? "copilot" : "autopilot", now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "p@f.example" }] });
    for (let i = 0; i < 6; i++) T.addClient({ first: "F" + i, last: "L" + i, mobile: "61555501" + (10 + i), email: i % 2 ? "c" + i + "@x.example" : "", lang: i % 3 ? "en" : "es", template: pick(T.templates()).id }); }
  const day = {}, chk = new Set(); T.S.clients.forEach((c, n) => { if (n % 3 === 0) T.setZone(c.id, pick(["ET", "PT", "MT", "HT"])); });
  const forms = Object.keys(T.FORMS);
  const acts = {
    advance: () => T.advance(pick([T.MIN, 30 * T.MIN, T.HOUR, 5 * T.HOUR, T.DAY, 3 * T.DAY])),
    text: (e, c) => T.inboundText(c.id, pick(TEXTS)),
    doc: (e, c) => { const f = pick(forms), el = (T.ELEMENTS[f] || []); T.inboundDoc(c.id, { form: f, year: pick([2026, 2026, 2026, 2025, null]), payer: pick(["Acme Logistics", "First Farmers Bank", "", "Zed Co"]), quality: pick(["clear", "clear", "clear", "blurry", "cropped"]), recipient: pick(["self", "self", "self", "other"]), missing: r() < 0.25 && el.length ? [pick(el)[0]] : [] }, pick(["text", "email", "portal"])); },
    email: (e, c) => T.inboundEmail(c.id, pick(TEXTS), r() < 0.5 ? [{ form: pick(forms), year: 2026, payer: "Acme" }] : []),
    consent: (e, c) => T.giveConsent(c.id, "page"),
    start: (e) => { e.confirmed = true; T.start(e.id); },
    pause: (e) => T.pause(e.id), resume: (e) => T.resume(e.id),
    takeover: (e) => T.takeover(e.id, "fuzz"), handback: (e) => T.handback(e.id),
    tpl: (e) => T.applyTemplate(e.id, pick(T.templates()).id, { confirm: r() < 0.5 }),
    addItem: (e) => T.addItem(e.id, pick(forms.filter((f) => f !== "OTHER")), ""),
    setItem: (e) => { const it = pick(T.itemsOf(e.id)); if (it) T.setItem(it.id, pick(["waived", "expected", "removed"]), "fuzz"); },
    task: () => { const t = T.S.tasks.find((x) => x.status === "open"); if (t) T.decideTask(t.id, pick(["accept", "reask", "discard", "waive", "ask_again", "done"]), {}); },
    approve: () => { const ms = T.S.msgs.filter((x) => x.status === "approval"), m = ms.length ? pick(ms) : null; if (m) (r() < 0.7 ? T.approveMsg : T.rejectMsg)(m.id); },
    night: () => T.setNow(new Date(T.S.now.getFullYear(), T.S.now.getMonth(), T.S.now.getDate(), pick([22, 23, 2, 5]), 15)),
    purgeNow: (e) => { if (r() < 0.05) T.purge(e.id); },
    manual: (e) => T.manual(e.id, "Staff note " + seed),
    rec: (e) => T.addRecommended(e.id),
    portalNone: (e) => { const it = T.openItems(e.id)[0]; if (it) T.portalNone(it.id); },
    deliver: (e) => T.deliver(e.id), close: (e) => { if (r() < 0.1) T.closeEng(e.id); },
    roundtrip: () => { const a = T.dump(); T.load(a); const b = T.dump(); if (a !== b) note("INV save/load not stable", "seed " + seed); },
    jump: () => T.jumpToNext(),
    roll: () => { if (r() < 0.15) { const y = (T.S.firm.taxYear || 2026) + 1, res = T.rollSeason(y); if (!res.error && T.S.engs.some((e) => e.year === y && e.status !== "not_started")) note("INV a rolled file is not waiting to start", "seed " + seed); } },
    customDoc: (e, c) => T.inboundDoc(c.id, { form: "OTHER", year: e.year, payer: pick(["Fidelity", ""]), read: { note: pick(["An inherited IRA statement", "closing disclosure for a home sale", "a utility bill", "<img src=x>"]), legible: 0.9, conf: 0.9 } }, "text"),
    customAdd: (e) => T.customSuggest(e.id, pick(["Closing statement for the home sale", "Statement for the inherited IRA", "Gambling winnings form"]), true),
    es: (e, c) => { c.lang = pick(["en", "es"]); const it = T.itemsOf(e.id).find((i) => i.custom); if (it) T.setCustomEs(it.id, pick(["Estado de cierre", "<b>x</b> {first}", ""])); },
    decItem: () => { const t = T.S.tasks.find((x) => x.status === "open" && x.kind === "document"); if (t) { const e = T.eng(t.engId), it = e && T.itemsOf(e.id).find((i) => i.custom); T.decideTask(t.id, "accept", it ? { itemId: it.id } : {}); } },
    ckSend: (e) => T.sendCheckin(e.id),
    ckDone: (e, c) => { const facts = {}; T.CHECKQ.forEach((q) => { facts[q[0]] = r() < 0.4; }); T.checkinDone(c.id, { facts, counts: { w2: 1 + Math.floor(r() * 3) }, same: r() < 0.3, note: r() < 0.3 ? "We moved and I sold some stock" : "", payers: { W2: ["Target", "<b>Uber</b>"], "1099CONS": "Schwab {year}" }, topics: r() < 0.3 ? ["unemp", "nope", "rental"] : undefined, custom: r() < 0.2 ? ["Closing statement {first}", "x".repeat(200)] : undefined }); },
    ckApply: (e) => { if (e.checkin && e.checkin.doneAt) T.applyCheckin(e.id, { start: r() < 0.6 }); },
    ckAuto: () => { T.S.firm.checkinAuto = r() < 0.5; },
    ckSkip: (e) => { if (r() < 0.3) T.skipQuestions(e.id, r() < 0.7); },
    ckMode: () => { T.S.firm.checkinMode = pick(["auto", "manual", undefined]); },
    topicAI: (e, c) => T.inboundText(c.id, "something odd happened", { intent: "other_update", scope: "documents", sentiment: "calm", topics: pick([["retire"], ["bogus"], ["k1", "misc"], []]), new_document: pick([null, "Inherited IRA statement", "<img src=x> {first}", ""]) }),
    sg: (e) => { const t = (e.suggestCustom || [])[0]; if (t) T.customSuggest(e.id, t, r() < 0.5); },
    topic: (e, c) => T.inboundText(c.id, pick(["we rented out the basement", "I sold some stock and started a business", "new job this year", "had a baby, paying for daycare"])),
    bill: () => { const k = r(); if (k < 0.12) T.pauseSeason(new Date(+T.S.now + pick([2, 20, 60, 95, 400]) * T.DAY)); else if (k < 0.5) T.resumeNow(); else if (k < 0.8) T.choosePlan(pick(["Solo", "Practice", "Firm", "Large", "Free", ""])); },
    staffDoc: (e, c) => { const n = T.S.msgs.length; T.staffDoc(c.id, { form: pick(forms), year: 2026, payer: "Acme Logistics" }); if (T.S.msgs.slice(n).some((m) => m.dir === "out" && m.status === "delivered")) note("INV a staff upload messaged the client", "seed " + seed); },
    bundle: (e, c) => { const n = T.S.msgs.length; T.inboundBundle(c.id, [0, 1, 2].map(() => ({ form: pick(forms), year: 2026, payer: pick(["Acme Logistics", "Zed Co"]) })), pick(["text", "portal", "email"])); const k = T.S.msgs.slice(n).filter((m) => m.dir === "out" && m.status === "delivered" && m.tpl !== "M29" && m.tpl !== "M12").length; if (k > 1) note("INV a bundle got " + k + " replies: " + T.S.msgs.slice(n).filter((m) => m.dir === "out").map((m) => m.tpl).join(","), "seed " + seed); },
    unusable: (e, c) => T.inboundUnusable(c.id, pick(["locked", "type"]), pick(["text", "email", "portal"])),
    ssn: (e, c) => (r() < 0.5 ? T.inboundText(r() < 0.8 ? c.id : null, pick(["my social is 123-45-6789", "SSN 987654321 thanks", "card 4111 1111 1111 1111", "routing 021000021 acct 000123456789"])) : T.inboundEmail(c.id, "Spouse SSN: 222-33-4444, see attached", [])),
    retain: () => T.setRetain(pick(["afterDelivery", "rejected", "unmatched", "max"]), pick([0, 1, 7, 30, 90, 400, 9999, -5, "x"])),
    delNow: (e) => { if (r() < 0.2) T.deleteDocsNow(e.id); },
    stranger: () => (r() < 0.5 ? T.inboundText(null, "is this the tax office?") : T.inboundDoc(null, { form: pick(forms), year: 2026, payer: "Acme Logistics" }, "email")),
    odd: (e, c) => T.inboundText(c.id, pick(["wrong number", "who is this?", "see https://www.icloud.com/photos/#abc", "numero equivocado", "here: drive.google.com/file/d/1"])),
    recCons: (e, c) => { const n = T.S.msgs.length; const why = T.recordConsent(c.id, pick(["engagement letter", "", "<b>x</b>"])); if (c.textConsent === "withdrawn" && !why) note("INV consent recorded over an opt-out", "seed " + seed); if (c.mobileBad && c.textConsent === "given") note("INV texts on for a number reported as wrong", "seed " + seed); },
    verify: () => { if (r() < 0.15) T.setVerified(r() < 0.6); },
    delWhen: () => { T.S.firm.delivery.when = pick(["each", "complete", "arrival", undefined]); if (r() < 0.3) { T.S.firm.delivery.provider = pick(["Google Drive", "Download"]); T.S.firm.delivery.auto = pick(["on", "off"]); } },
    csvDocs: () => T.importRows(T.parseCSV('First,Last,Email,Mobile,Forms\nKit' + i0() + ',Vale,kit' + i0() + '@x.co,615555' + String(1000 + i0() % 9000) + ',"W-2; brokerage, nonsense"\nKim' + i0() + ',Vale,,615555' + String(1000 + (i0() - 1) % 9000) + ',')),
    corr: (e, c) => { const acc = T.S.docs.find((d) => d.engId === e.id && d.state === "accepted"); if (acc) T.inboundDoc(c.id, { form: acc.form, year: acc.year, payer: acc.payer, corrected: true }, "email"); },
    regS: () => T.registerSender(pick([{ legalName: "Fuzz & Co LLC", ein: "621234567", street: "1 Main St", city: "Franklin", state: "TN", zip: "37064", contact: "F Z" }, { legalName: "", ein: "1" }, { legalName: "Solo", soleProp: true, street: "1 A St", city: "X y", state: "TN", zip: "37064", contact: "S O L" }, null])),
    csvBiz: () => T.importRows(T.parseCSV('First,Last,Email,Business name,Return type\nBo' + i0() + ',Reed,bo' + i0() + '@x.co,Reed ' + i0() + ' Holdings LLC,' + pick(["1120-S", "partnership", "trust", "nonprofit", "c corp", "zzz", ""]) + '\n,,biz' + i0() + '@x.co,Solo Biz ' + i0() + ',')),
    heads: () => T.markHeadsUp(r() < 0.8),
    zone: (e, c) => T.setZone(c.id, pick(["ET", "CT", "PT", "HT", ""])),
    csv: () => T.importRows(T.parseCSV(pick(['First,Last,Email\n"Q, Jr.",Z' + i0() + ',q' + i0() + '@x.co', 'Name;Phone;State\nLee Park' + i0() + ';+1 (615) 555-' + String(1000 + i0() % 9000) + ';CA', '', 'garbage', 'a,b\n"unclosed']))),
  };
  let _i = 0; function i0() { return ++_i + seed * 1000; }
  const names = Object.keys(acts);
  for (let i = 0; i < STEPS; i++) {
    const S = T.S, e = pick(S.engs), c = e && T.client(e.clientId), a = pick(names), nMsg = S.msgs.length, ok0 = T.access().ok;
    const ver0 = T.S.firm.verified, st0 = e && e.status;
    try { acts[a](e, c); } catch (err) { note("THROW " + a + ": " + String(err.message).slice(0, 110), "seed " + seed + " step " + i + " status " + (e && e.status) + "\n   " + String(err.stack).split("\n")[1].trim()); continue; }
    // invariants on new messages
    for (const m of S.msgs.slice(nMsg)) {
      if (m.dir !== "out") continue;
      const body = String(m.body || ""), me = m.engId && T.eng(m.engId), mc = me && T.client(me.clientId);
      if (m.tpl === "M28" && me && me.checkin && me.checkin.afterOptIn) { const k = "q" + me.id + me.year; day[k] = (day[k] || 0) + 1; if (me.noQuestions && me.checkin.by === "Tallyhound") note("INV the questions went to a client the firm skipped", "seed " + seed + " after " + a); if (day[k] > 1) note("INV the questions were texted twice to one client", "seed " + seed + " after " + a); if (mc && mc.textConsent !== "given") note("INV the questions were texted without consent", "seed " + seed); }
      if (m.tpl === "M28R" && me && me.checkin && me.checkin.afterOptIn) note("INV a reminder followed the one-time questions", "seed " + seed);
      if (m.tpl === "M31") { const k = "away" + m.engId; if (day[k] && m.at - day[k] < 7 * T.DAY) note("INV two away replies to one client inside a week", "seed " + seed); day[k] = +m.at; if (T.access().ok && ok0) note("INV away reply while the firm is collecting", "seed " + seed + " after " + a); }
      if (!ok0 && !T.access().ok && m.status === "delivered" && !["M16", "M16H", "M31"].includes(m.tpl)) note("INV sent while paused or expired: " + (m.tpl || m.kind) + " after " + a, "seed " + seed + " step " + i + " " + T.access().state);
      if (/undefined|NaN|\[object|\{\w+\}|null\b/.test(body)) note("INV bad text in " + (m.tpl || m.kind) + " (" + (mc && mc.lang) + "): " + body.slice(0, 120), "seed " + seed + " after " + a);
      if (/  |\s\.|\s,| $/.test(body) && m.tpl) note("INV spacing in " + m.tpl + ": " + JSON.stringify(body.slice(0, 110)), "seed " + seed);
      if (m.channel === "text" && body.length > 480 && m.kind !== "staff") note("INV text over 480 chars: " + (m.tpl || m.kind), "seed " + seed);
      if (mc && m.channel === "text" && m.status === "delivered" && !T.COMPLIANCE.includes(m.tpl)) {
        if (mc.textConsent !== "given") note("INV text sent without consent (" + mc.textConsent + "): " + (m.tpl || m.kind) + " after " + a, "seed " + seed + " step " + i);
        const loc = new Date(m.at.getTime() + T.tzOff(mc) * T.HOUR), h = loc.getHours(), d = loc.getDay();
        if (["M3", "M5", "M6", "M10", "M1", "M1R", "M28", "M28R"].includes(m.tpl) && (d === 0 || h < S.firm.quietStart || h >= S.firm.quietEnd)) note("INV sent outside the client's hours: " + (m.tpl || m.kind) + " zone " + mc.tz + " after " + a + " at local day " + d + " hour " + h, "seed " + seed + " step " + i);
        if (["M3", "M5", "M6", "M10"].includes(m.tpl)) { const key = me.id + loc.toDateString(); day[key] = (day[key] || 0) + 1; if (day[key] === 3) note("INV three proactive texts to one client in a day: last " + m.tpl + " after " + a, "seed " + seed + " step " + i); }
      }
      if (me && m.status === "delivered" && !["manual", "staff"].includes(m.kind) && a !== "close" && a !== "start" && ((me.status === "not_started" && ["M3", "M4", "M5", "M6", "M10", "M22R"].includes(m.tpl) && a !== "ckApply" && a !== "ckDone") || (me.status === "closed" && !T.COMPLIANCE.includes(m.tpl) && !["M12", "M14", "M24", "M11", "M23"].includes(m.tpl)))) note("INV message on a " + me.status + " file: " + (m.tpl || m.kind) + " after " + a, "seed " + seed + " step " + i);
      if (me && me.status === "opted_out" && m.status === "delivered" && m.channel === "text" && !T.COMPLIANCE.includes(m.tpl)) note("INV text to opted-out client: " + (m.tpl || m.kind) + " after " + a, "seed " + seed);
      if (me && me.takeover && m.status === "delivered" && !["staff", "manual"].includes(m.kind) && !T.COMPLIANCE.includes(m.tpl)) note("INV Hound sent during takeover: " + (m.tpl || m.kind) + " after " + a, "seed " + seed + " kind " + m.kind + " by " + m.by);
    }
    if (T.billing().state === "trial" && S.engs.filter((x) => x.startedAt || (x.checkin && x.checkin.sentAt)).length > T.TRIAL_CLIENTS) note("INV a trial reached more than " + T.TRIAL_CLIENTS + " clients after " + a, "seed " + seed);
    if (T.pauseUsed() > T.PAUSE_MAX_DAYS + 1) note("INV more than 90 days of pause in a year: " + T.pauseUsed(), "seed " + seed);
    { const u = T.usage(); if (isNaN(u.cost) || u.cost < 0) note("INV usage cost is not a number", "seed " + seed); }
    if (ver0 === false && T.S.firm.verified === false) for (const m of S.msgs.slice(nMsg)) if (m.dir === "out" && ["M1", "M3", "M28"].includes(m.tpl) && !m.sendAt) note("INV first contact (" + m.tpl + ") was made while the firm was unchecked, after " + a, "seed " + seed + " status " + m.status);
    for (const cl of S.clients) if (cl.mobileBad && cl.textConsent === "given") note("INV texts on for a number reported as wrong after " + a, "seed " + seed);
    for (const x of S.engs) if (!T.RETURNS[x.type]) note("INV an engagement with an unknown return type after " + a, "seed " + seed + " " + x.type);
    { const acc = {}; for (const d of S.docs) if (d.state === "accepted" && d.form !== "OTHER" && d.engId && d.itemId) { const k = d.engId + "|" + d.itemId; acc[k] = (acc[k] || 0) + 1; } }
    for (const it of S.items) if (!T.FORMS[it.form] && !it.custom) note("INV a checklist item with an unknown form after " + a, "seed " + seed);
    // what is kept: no tax ID or account number in anything stored, and nothing held past its time
    for (const m of S.msgs.slice(nMsg)) if (m.dir === "in" && /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b|\b(?:\d[ -]?){15}\d\b/.test(String(m.body || ""))) note("INV a tax ID or account number was stored in a message after " + a, "seed " + seed + " " + String(m.body).slice(0, 60));
    for (const y of S.tray) if (/\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/.test(String(y.text || ""))) note("INV a tax ID was stored from an unknown sender", "seed " + seed);
    for (const d of S.docs) if (d.stripped && (d.read || d.image || d.fileKey || (d.elements || []).length)) note("INV a deleted copy still has content after " + a, "seed " + seed);
    if (a === "advance") { const rt = T.retain();
      for (const d of S.docs) if (T.hasContent(d) && ((d.deliveredAt && (S.now - d.deliveredAt) / T.DAY > rt.afterDelivery + 1) || (S.now - d.at) / T.DAY > rt.max + 1)) note("INV a copy was kept past its time", "seed " + seed + " state " + d.state + " delivered " + !!d.deliveredAt);
      for (const y of S.tray) if ((S.now - y.at) / T.DAY > rt.unmatched + 1) note("INV an unknown-sender item was kept past its time", "seed " + seed); }
    { const rt = T.retain(); for (const k of Object.keys(T.RETAIN_LIMIT)) if (!(rt[k] >= T.RETAIN_LIMIT[k][0] && rt[k] <= T.RETAIN_LIMIT[k][1])) note("INV keep-for time outside its limits: " + k + "=" + rt[k], "seed " + seed); }
    for (const x of S.engs) {
      const its = T.itemsOf(x.id), open = T.openItems(x.id).length, live = its.filter((q) => q.state !== "removed").length, desc = () => x.status + " [" + its.map((q) => q.form + ":" + q.state).join(",") + "] tasks " + S.tasks.filter((t) => t.engId === x.id && t.status === "open").map((t) => t.kind).join("/");
      const bad1 = x.status === "complete" && open > 0, bad2 = x.status === "in_progress" && !open && live > 0 && !S.tasks.some((t) => t.engId === x.id && t.status === "open") && !its.some((q) => ["in_review", "says_none", "partial"].includes(q.state));
      x._b = x._b || {};
      if (bad1 && !x._b.b1) note("INV became complete with open items after " + a, "seed " + seed + " step " + i + " " + desc());
      if (bad2 && !x._b.b2) note("INV in progress but nothing left to collect after " + a, "seed " + seed + " step " + i + " " + desc());
      x._b = { b1: bad1, b2: bad2 };
      if (x.next && isNaN(+new Date(x.next))) note("INV invalid next date after " + a, "seed " + seed);
      const p = T.progress(x.id); if (p && (isNaN(p.done) || p.done > p.total)) note("INV progress wrong after " + a, JSON.stringify(p));
    }
    for (const m of S.msgs) { if (m.dir === "out" && m.status === "delivered" && m.approvedBy && !chk.has(m.id)) { chk.add(m.id); const me = T.eng(m.engId), mc = me && T.client(me.clientId); if (mc && ["M3", "M5", "M6", "M10", "M22R"].includes(m.tpl)) { const loc = new Date(m.at.getTime() + T.tzOff(mc) * T.HOUR), h = loc.getHours(); if (loc.getDay() === 0 || h < S.firm.quietStart || h >= S.firm.quietEnd) note("INV approved message delivered outside the client's hours: " + m.tpl + " at local hour " + h + " day " + loc.getDay(), "seed " + seed + " after " + a); } if (mc && m.channel === "text" && mc.textConsent !== "given" && !T.COMPLIANCE.includes(m.tpl) && +m.at === +S.now) note("INV approved text delivered without consent: " + m.tpl, "seed " + seed + " after " + a); } }
    if (S.msgs.filter((m) => m.status === "approval" && ["M3", "M5", "M6", "M10", "M22R"].includes(m.tpl)).reduce((o, m) => ((o[m.engId] = (o[m.engId] || 0) + 1), o), {}) && Object.values(S.msgs.filter((m) => m.status === "approval" && ["M3", "M5", "M6", "M10", "M22R"].includes(m.tpl)).reduce((o, m) => ((o[m.engId] = (o[m.engId] || 0) + 1), o), {})).some((n) => n > 1)) note("INV two proactive drafts waiting for one client after " + a, "seed " + seed);
    { const ids = new Set(S.engs.map((e) => e.id)); for (const k of ["items", "docs", "msgs", "tasks"]) { const o = S[k].find((x) => x.engId && !ids.has(x.engId)); if (o) { note("INV orphan in " + k + " after " + a, "seed " + seed + " step " + i); break; } } const seen = new Set(); for (const e of S.engs) { if (seen.has(e.clientId)) { note("INV two live files for one client after " + a, "seed " + seed); break; } seen.add(e.clientId); } }
    try { T.pipeline(); S.docs.slice(-3).forEach((d) => T.verdict(d)); } catch (err) { note("THROW pipeline/verdict: " + err.message, "seed " + seed); }
  }
}
const rows = [...found.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(rows.length + " distinct findings over " + SEEDS + " seeds x " + STEPS + " steps");
rows.forEach(([k, v]) => console.log("- [" + v.n + "x] " + k + "\n   " + v.d));
