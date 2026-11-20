// How big does one firm's saved state get, and how long does it take to load and save? node tools/scale.js [clients]
// The pilot store keeps each firm as one document. This measures where that stops being comfortable.
const { createEngine } = require("../packages/engine");
const N = +process.argv[2] || 500;
const T = createEngine(); let seed = 7; const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
T.blank({ plan: N > 1000 ? "Large" : N > 500 ? "Firm" : "Practice", name: "Scale Test CPAs", email: "docs@scale.example", phone: "6155550100", senderStatus: "approved", mode: "autopilot", now: new Date(2027, 0, 25, 9, 0), users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@scale.example" }] });
const tpl = T.templates()[0].id;
for (let i = 0; i < N; i++) T.addClient({ first: "C" + i, last: "L" + i, email: "c" + i + "@x.example", mobile: "615" + String(2000000 + i), template: tpl });
T.S.engs.forEach((e) => { e.confirmed = true; T.start(e.id); });
T.S.clients.forEach((c) => T.giveConsent(c.id, "page"));
const t0 = Date.now();
for (let day = 0; day < 75; day++) {
  T.advance(T.DAY);
  for (const e of T.S.engs) { if (e.status !== "in_progress" || r() > 0.12) continue; const it = T.itemsOf(e.id).find((i) => ["requested", "expected"].includes(i.state)); if (!it) continue; const k = r();
    if (k < 0.8) T.inboundDoc(e.clientId, { form: it.form, year: 2026, payer: it.payer || "Acme Logistics" }, r() < 0.7 ? "text" : "email"); else if (k < 0.9) T.inboundText(e.clientId, "will send tonight"); else T.inboundDoc(e.clientId, { form: it.form, year: 2025, payer: it.payer || "Acme Logistics" }, "text"); }
}
const sim = Date.now() - t0, json = T.dump(), t1 = Date.now(); const U = createEngine(); U.load(json); const load = Date.now() - t1, t2 = Date.now(); U.dump(); const save = Date.now() - t2, t3 = Date.now(); U.tick(); const tick = Date.now() - t3;
const S = T.S, mb = (n) => (n / 1048576).toFixed(1) + " MB";
console.log(N + " clients after a 75-day season: " + S.msgs.length + " messages, " + S.docs.length + " documents, " + S.hlog.length + " log lines, " + S.audit.length + " audit lines");
console.log("saved state " + mb(Buffer.byteLength(json)) + " | load " + load + " ms | save " + save + " ms | one timer pass " + tick + " ms | complete: " + S.engs.filter((e) => ["complete", "closed"].includes(e.status)).length);
const part = (k) => mb(Buffer.byteLength(JSON.stringify(S[k]))); console.log("by part: messages " + part("msgs") + ", documents " + part("docs") + ", activity log " + part("hlog") + ", audit " + part("audit") + ", engagements " + part("engs") + ", items " + part("items"));

// T-101: the same firm saved as parts (a core, one sealed row per client, audit rows). How much does one inbound text touch?
(async () => {
  const { createApp } = require("../packages/core/pipeline"), { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory"), { encryptedStore, localKeyring } = require("../packages/core/crypto");
  const inner = memoryStore(), store = encryptedStore(inner, localKeyring(require("node:crypto").randomBytes(32))), kb = (n) => (n / 1024).toFixed(0) + " KB";
  const ai = fakeAI((p) => (p.startsWith("You read text messages") ? { intent: "thanks", item_id: null, summary: "thanks", scope: "documents", sentiment: "calm" } : null));
  const app = createApp({ store, sms: fakeSender(), email: fakeSender(), ai, clock: () => new Date(S.now) });
  T.S.firm.smsNumber = "6155550100"; await store.create("scale", T.dump(), { number: "6155550100", inbox: "docs@scale.example" });
  let a = Date.now(); await app.withFirm("scale", () => true); const first = Date.now() - a;   // the first save splits the firm into parts
  a = Date.now(); await app.withFirm("scale", () => true); const whole = Date.now() - a;
  inner.touched.read = inner.touched.written = 0; a = Date.now();
  const r = await app.inboundSms({ to: "+16155550100", from: "+1" + S.clients[Math.floor(N / 2)].mobile.replace(/\D/g, ""), body: "thanks, will send the rest tonight", media: [], providerId: "scale-1" });
  const ms = Date.now() - a, t = inner.touched;
  console.log("as parts: " + inner.parts.get("scale").size + " client rows, core " + kb(inner.firms.get("scale").length) + " sealed | first save (the split) " + first + " ms | a whole-firm turn " + whole + " ms");
  console.log("one inbound text (client found: " + !!r.client + "): read " + kb(t.read) + ", wrote " + kb(t.written) + ", " + ms + " ms" + (t.read + t.written < 200 * 1024 ? "  (under the 200 KB target)" : "  (OVER the 200 KB target)"));
})();
