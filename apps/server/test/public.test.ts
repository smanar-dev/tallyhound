// The client's pages: agree to texts, send documents, stop emails, and the firm's public page. No login, no script, no cookie.
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS } from "./harness.ts";
import { createEngine, kitMemory, type Engine } from "../src/kit.ts";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30000, 7)]);
const model = () => kitMemory.fakeAI((p: string) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" } : null);
// One firm on Autopilot with an approved number. Jo has been invited to text; her invitation email carries her private link.
async function firmWithJo(kind: "memory" | "postgres") {
  const H = await build(kind, { ai: model() }), { firmId, ownerId, slug } = await H.newFirm();
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.senderStatus = "approved"; T.S.firm.phone = "(615) 555-0100";
    T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111\nSam,Lee,sam@x.example,6155550122")); for (const e of T.S.engs) { T.itemsOf(e.id).find((i: { form: string }) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); } });
  const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
  const T = await state(), jo = T.S.clients[0], inv = H.email.sent.find((m: { to: string }) => m.to === "jo@x.example")!;
  const link = /go\.tallyhound\.test\/c\/(\S+?)[.\s]/.exec(inv.body)![1]!, unsub = /\/e\/([a-z-]+)$/.exec(inv.unsubscribe)![1]!;
  const get = (url: string, headers = {}) => H.server.inject({ method: "GET", url, headers }), form = (url: string, body: Record<string, string>) => H.server.inject({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mobile Safari" } });
  const upload = (url: string, files: { name: string; type: string; bytes: Buffer }[]) => { const b = "----th" + Date.now(), parts = files.map((f) => Buffer.concat([Buffer.from("--" + b + '\r\nContent-Disposition: form-data; name="file"; filename="' + f.name + '"\r\nContent-Type: ' + f.type + "\r\n\r\n"), f.bytes, Buffer.from("\r\n")]));
    return H.server.inject({ method: "POST", url, payload: Buffer.concat([...parts, Buffer.from("--" + b + "--\r\n")]), headers: { "content-type": "multipart/form-data; boundary=" + b } }); };
  return Object.assign(H, { firmId, slug, state, jo, link, unsub, get, form, upload });
}
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

for (const kind of KINDS) {
  const name = (s: string) => "client pages (" + kind + "): " + s;

  test(name("the link in the invitation opens the consent page, which shows the wording in full and never the whole phone number"), async () => {
    const H = await firmWithJo(kind); assert.match(H.link, /^[a-z]+-[a-z]{28}$/); assert.ok(H.link.startsWith(H.slug + "-"));
    const r = await H.get("/c/" + H.link); assert.equal(r.statusCode, 200); const t = words(r.body);
    assert.match(t, /Test CPAs 1 .*Send your tax documents by text .*No app, no password/); assert.match(t, /you agree to receive text messages from Test CPAs 1, sent using Tallyhound/); assert.match(t, /Reply STOP to opt out or HELP for help\. Agreeing is not a condition of any service/);
    assert.match(t, /ending 0111/); assert.ok(!r.body.includes("6155550111") && !r.body.includes("555-0111"), "the full number is not on the page"); assert.ok(!/Sam|Lee|jo@x|W-2|Acme/.test(r.body), "nothing about anyone's documents or anyone else");
    assert.ok(!/<script/i.test(r.body), "no script"); assert.equal(r.headers["x-robots-tag"], "noindex, nofollow"); assert.equal(r.headers["cache-control"], "no-store"); assert.match(String(r.headers["content-security-policy"]), /default-src 'self'/); assert.equal(r.headers["set-cookie"], undefined, "no cookie");
    assert.ok(Buffer.byteLength(r.body) + (await H.get("/client.css")).rawPayload.length < 150 * 1024, "well under 150 KB");
    await H.close();
  });

  test(name("Agree turns texts on with proof of what was shown; the confirmation text goes; a second press does nothing"), async () => {
    const H = await firmWithJo(kind), before = H.sms.sent.length;
    const bad = await H.form("/c/" + H.link, { mobile: "12", choice: "agree" }); assert.equal(bad.statusCode, 400); assert.match(words(bad.body), /Enter a 10-digit mobile number/); assert.equal(H.sms.sent.length, before);
    const r = await H.form("/c/" + H.link, { mobile: "", choice: "agree" }); assert.equal(r.statusCode, 303); assert.equal(r.headers.location, "/c/" + H.link);
    let T = await H.state(); const c = T.S.clients[0], rec = c.consentLog.at(-1); assert.equal(c.textConsent, "given"); assert.equal(rec.wording, "v1"); assert.match(rec.shown, /from Test CPAs 1/); assert.equal(rec.agent, "Mobile Safari"); assert.ok(rec.ip);
    assert.equal(H.sms.sent.length, before + 1); assert.equal(H.sms.sent.at(-1)!.to, "6155550111");
    assert.match(words((await H.get("/c/" + H.link)).body), /You're set .*Watch for a text from Test CPAs 1/); await H.form("/c/" + H.link, { mobile: "", choice: "agree" }); assert.equal(H.sms.sent.length, before + 1);
    T = await H.state(); assert.equal(T.S.clients[1].textConsent, "invited", "Sam is untouched");
    await H.close();
  });

  test(name("'No thanks, I'll use email' records the choice and texts nothing; a corrected number is used instead of the one on file"), async () => {
    const H = await firmWithJo(kind), before = H.sms.sent.length;
    const r = await H.form("/c/" + H.link, { choice: "email" }); assert.equal(r.statusCode, 200); assert.match(words(r.body), /No problem .*Reply to our email with your documents/);
    let T = await H.state(); assert.equal(T.S.clients[0].textConsent, "none"); assert.equal(T.S.engs[0].emailOnly, true); assert.equal(H.sms.sent.length, before);
    await H.form("/c/" + H.link, { mobile: "(615) 555-0199", choice: "agree" }); T = await H.state(); assert.equal(T.S.clients[0].mobile, "6155550199"); assert.equal(H.sms.sent.at(-1)!.to, "6155550199");
    await H.close();
  });

  test(name("a wrong, old or foreign link says only that it has expired"), async () => {
    const H = await firmWithJo(kind), z = "z".repeat(28);
    for (const u of ["/c/" + H.slug + "-" + z, "/u/" + H.slug + "-" + z, "/e/" + H.slug + "-" + z, "/c/nosuchfirm-" + z, "/u/x", "/c/" + H.link.toUpperCase(), "/e/" + H.link]) { const r = await H.get(u); assert.equal(r.statusCode, 404, u); assert.match(words(r.body), /This link has expired/); assert.ok(!/Jo|Day/.test(r.body)); }
    assert.match(words((await H.get("/c/" + H.slug + "-" + z)).body), /Ask Test CPAs 1 for a new one, or call \(615\) 555-0100/, "a real firm's page says who to call");
    H.advance(15 * 86400); const late = await H.get("/c/" + H.link); assert.equal(late.statusCode, 404, "fourteen days and the link is dead"); assert.equal((await H.form("/c/" + H.link, { choice: "agree" })).statusCode, 404);
    assert.equal((await H.state()).S.clients[0].textConsent, "invited", "and it can no longer be used to agree");
    await H.close();
  });

  test(name("the upload page says what is being waited for, takes files with no script, and they are checked like any other"), async () => {
    const H = await firmWithJo(kind), u = "/u/" + H.link, page = await H.get(u); assert.equal(page.statusCode, 200); const t = words(page.body);
    assert.match(t, /We're waiting for your W-2 wage statement from Acme Logistics and 1 other document\./); assert.match(t, /We never show documents here/); assert.match(page.body, /<input[^>]+type="file"[^>]+multiple/); assert.match(page.body, /enctype="multipart\/form-data"/i);
    assert.equal((await H.form(u, {})).statusCode, 400); const none = await H.upload(u, []); assert.equal(none.statusCode, 400); assert.match(words(none.body), /Choose a photo or a PDF first/);
    const r = await H.upload(u, [{ name: "IMG_2041.jpg", type: "image/jpeg", bytes: JPEG }]); assert.equal(r.statusCode, 303); assert.equal(r.headers.location, u + "?sent=1");
    await H.inbox.drain(); const T = await H.state(), d = T.S.docs.find((x: { engId: string }) => x.engId === T.S.engs[0].id); assert.ok(d, "the document is in Jo's file"); assert.equal(d.state, "accepted"); assert.equal(d.channel, "portal"); assert.ok(d.fileKey);
    const after = words((await H.get(u + "?sent=1")).body); assert.match(after, /Thanks\. We'll check it/); assert.match(after, /We're waiting for your mortgage interest statement/); assert.ok(!/Acme|W-2/.test(after), "what has arrived is never shown back");
    assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 0 });
    // Not a photo or a PDF: taken, and the client is told by a reply, as with a text.
    await H.upload(u, [{ name: "notes.docx", type: "application/zip", bytes: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(400)]) }]); await H.inbox.drain(); assert.equal((await H.state()).S.docs.filter((x: { engId?: string }) => x.engId).length, 1);
    await H.close();
  });

  test(name("a finished client's upload link says the firm has everything; a file over the limit is refused in words"), async () => {
    const H = await firmWithJo(kind), u = "/u/" + H.link;
    const big = await H.upload(u, [{ name: "huge.pdf", type: "application/pdf", bytes: Buffer.alloc(26 * 1024 * 1024, 1) }]); assert.equal(big.statusCode, 413); assert.match(words(big.body), /Too large\. The limit is 25 MB a file/);
    await H.app.withFirm(H.firmId, (T: Engine) => { for (const i of T.itemsOf(T.S.engs[0].id)) T.setItem(i.id, "waived", "test"); });
    const done = words((await H.get(u)).body); assert.match(done, /Test CPAs 1 already has everything\. Thank you\./); assert.ok(!/type="file"/.test((await H.get(u)).body));
    await H.close();
  });

  test(name("unsubscribe: the page asks first, one click from the mail program stops email, and 'Keep emails' changes nothing"), async () => {
    const H = await firmWithJo(kind), u = "/e/" + H.unsub; assert.notEqual(H.unsub, H.link, "the unsubscribe link is its own key");
    const page = await H.get(u); assert.equal(page.statusCode, 200); assert.match(words(page.body), /Stop emails from Test CPAs 1 about your tax documents\? .*Unsubscribe .*Keep emails/);
    assert.match(words((await H.get(u + "?keep=1")).body), /Nothing changed/); assert.equal((await H.state()).S.clients[0].emailOk, true);
    H.advance(60 * 86400); const one = await H.form(u, { "List-Unsubscribe": "One-Click" }); assert.equal(one.statusCode, 200, "the link in a two-month-old email still works");
    const T = await H.state(), c = T.S.clients[0]; assert.equal(c.emailOk, false); assert.match(c.consentLog.at(-1).what, /unsubscribed from email \(one click\)/); assert.equal(T.S.clients[1].emailOk, true);
    assert.match(words((await H.get(u)).body), /Emails stopped .*call \(615\) 555-0100/);
    const n = H.email.sent.filter((m: { to: string }) => m.to === "jo@x.example").length; H.advance(4 * 86400); await H.worker.pass(); assert.equal(H.email.sent.filter((m: { to: string }) => m.to === "jo@x.example").length, n, "no more email to Jo");
    await H.close();
  });

  test(name("the firm's public page says who they are, how to stop texts and what is never asked for, with no script"), async () => {
    const H = await firmWithJo(kind), r = await H.get("/f/" + H.slug); assert.equal(r.statusCode, 200); const t = words(r.body);
    assert.match(t, /Test CPAs 1 collects the documents for your tax return by text message and email/); assert.match(t, /Reply STOP at any time to stop, or HELP for help/); assert.match(t, /never ask you to text or email a Social Security number/); assert.match(t, /\(615\) 555-0101/);
    assert.match(String(r.headers["content-security-policy"]), /default-src 'none'/); assert.ok(!/<script/i.test(r.body)); assert.equal((await H.get("/f/nosuchfirm")).statusCode, 404);
    await H.close();
  });
}

for (const kind of KINDS) {
  test("client pages (" + kind + "): the check-in is taps and one note, comes back to the firm as a proposal, and is taken once", async () => {
    const H = await build(kind, { ai: model() }), { firmId, ownerId } = await H.newFirm();
    await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.senderStatus = "approved"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const r = T.sendCheckin(T.S.engs[0].id); if (r) throw new Error(r); });
    const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; }, sent = H.email.sent.concat(H.sms.sent).find((m: { body: string }) => /\/u\//.test(m.body))!;
    assert.ok(sent, "the check-in message went with a link"); const u = "/u/" + /\/u\/([a-z-]+)/.exec(sent.body)![1];
    const page = await H.server.inject({ method: "GET", url: u }); assert.equal(page.statusCode, 200); const t = words(page.body);
    assert.match(t, /What did you have in 2026\?/); assert.match(t, /A job with a W-2/); assert.match(t, /Sold stocks, funds or crypto/); assert.equal((page.body.match(/type="checkbox"/g) || []).length, (await state()).CHECKQ.length); assert.ok(!/<script/i.test(page.body));
    const post = (body: Record<string, string>) => H.server.inject({ method: "POST", url: u, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const r = await post({ form: "checkin", f_w2: "1", f_brokerage: "1", w2: "2", note: "I sold some shares in March", topics: "rental", custom: "x" }); assert.equal(r.statusCode, 200); assert.match(words(r.body), /Thanks\. That's all\. Test CPAs 1 will send you a short list/);
    const T = await state(), e = T.S.engs[0]; assert.ok(e.checkin.doneAt); assert.equal(e.checkin.note, "I sold some shares in March"); assert.ok(e.checkin.adds.length > 0, "a proposal for the firm to confirm");
    assert.equal(T.S.clients[0].profile.brokerage, true); assert.ok(!T.S.clients[0].profile.rental, "a field the browser added by hand is ignored");
    // The firm decides: nothing was added to the checklist by the client's taps alone, and collecting has not started.
    assert.equal(e.status, "not_started"); const n = (await state()).S.msgs.length; assert.equal((await post({ form: "checkin", f_rental: "1", w2: "1" })).statusCode, 303, "a second set of answers is not taken"); assert.equal((await state()).S.msgs.length, n);
    assert.match(words((await H.server.inject({ method: "GET", url: u })).body), /We're waiting for|already has everything/, "afterwards the link is the upload page");
    await H.close();
  });
}
