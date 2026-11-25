// Internal commands. Run from the repo root:
//   npm run admin -- migrate
//   npm run admin -- create-firm --name "Larkin & Poe CPAs" --inbox larkinpoe@docs.tallyhound.com --zone America/Chicago --owner-name "Pat Larkin" --owner-email pat@larkinpoe.com [--sms 6155550100] [--phone "(615) 555-0100"] [--plan Practice] [--checked]
//   npm run admin -- firm-check --firm f_... --by "Jordan" [--suspend]
//   npm run admin -- check-services [--email you@firm.com] [--text 6155550100 --from <your Twilio number>]   one harmless live question to every service that is set up
//   npm run admin -- registration --firm f_...   prints what to file with the carriers for this firm's text number
//   npm run admin -- sender-approved --firm f_... --number 6155550100 --by Jordan   the carriers approved the number
//   npm run admin -- set-plan --firm f_... --plan Practice --by Jordan   starts or changes a paid plan (invoiced by hand until card billing is built)
//   npm run admin -- close-firm --firm f_... --by "Jordan" --yes   destroys the firm's key and everything it holds
//   npm run admin -- after-restore --by "Jordan"   run after every restore: closes again any firm closed since the backup
//   npm run admin -- status                    one line per firm: last tick, sent and failed today, model calls and errors today
//   npm run admin -- usage [--month 2027-02]   what each firm used that month and what it cost us
//   npm run admin -- firms
//   The mail layer (docs/neeter/RUNBOOK.md):
//   npm run admin -- mailboxes --firm f_...                     each connected mailbox, with the layer's id for it
//   npm run admin -- link-mailbox --firm f_... --user u_... --assistant <id> --provider google --address pat@firm.com
//                                                               when the layer cannot make an assistant from our sign-in
//   npm run admin -- disconnect-mailbox --firm f_... --user u_...   stops letters from that mailbox and removes its assistant
//   npm run admin -- layer-reconcile --firm f_...               compares the layer's copy with Tallyhound now and repairs it
//   npm run admin -- layer-poll --firm f_...                    fetches replies now (when the layer cannot call us)
//   npm run admin -- layer-rotate-key --firm f_...              replaces the firm's layer key now
//   npm run admin -- layer-ping                                 sends a signed test event to our own /hooks/neeter
//   npm run admin -- pilot-report [--firm f_...]                the pilot's six measures, for one firm or every firm
//   npm run admin -- set-mail --firm f_... --mode own|mailbox --by Jordan   who sends this firm's letters: its Tallyhound address, or its preparers' mailboxes
import { localChecks, preflight } from "./preflight.ts";
import { hookSign } from "./mailbox.ts";
import { costOf } from "./ops.ts";
import { createEngine } from "./kit.ts";
import { migrate, runtime } from "./runtime.ts";

const [cmd, ...rest] = process.argv.slice(2), o: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) if (rest[i]!.startsWith("--")) { const k = rest[i]!.slice(2), v = rest[i + 1]; if (v === undefined || v.startsWith("--")) o[k] = "true"; else { o[k] = v; i++; } }
const need = (k: string) => { if (!o[k]) throw new Error("Missing --" + k); return o[k]!; };

const R = runtime();
try {
  if (cmd === "migrate") { const d = await migrate(R.pool); console.log(d.length ? "Applied: " + d.join(", ") : "Already up to date."); }
  else if (cmd === "create-firm") {
    await migrate(R.pool);
    const r = await R.firms.create({ name: need("name"), sender: o.sender, phone: o.phone, inbox: need("inbox"), smsNumber: o.sms, iana: need("zone"), ownerName: need("owner-name"), ownerEmail: need("owner-email"), plan: o.plan, verified: o.checked === "true" });
    console.log("Firm created: " + r.firmId + "\nOwner: " + need("owner-email") + " (" + r.ownerId + ")\n" + (o.checked === "true" ? "Checked: it can send." : "Not checked yet: nothing sends until you run firm-check.") + "\nThe owner signs in at " + R.appUrl + "/signin");
  }
  else if (cmd === "firm-check") { await R.firms.setVerified(need("firm"), o.suspend !== "true", need("by")); console.log(o.suspend === "true" ? "Suspended." : "Checked: the firm can send."); }
  else if (cmd === "check-services") {
    const env = (k: string) => (process.env[k] || "").trim(), L = localChecks(R, env), stamp = new Date().toISOString().slice(11, 19);
    const checks = await preflight({ env, ...L, layer: R.mailboxes && R.mailboxes.whoAmI ? async () => "answers; it knows us as " + (await R.mailboxes!.whoAmI!()) : undefined, sendEmail: R.emailOn ? async (to) => { const id = await R.email.send({ from: env("TH_SIGNIN_FROM"), fromName: "Tallyhound", to, subject: "Tallyhound test email " + stamp, body: "This is a test from Tallyhound's check-services command. If you can read it, email out works." }); return "accepted by Postmark, id " + id + ". Check the inbox"; } : undefined,
      sendText: R.twilioOn && o.from ? async (to) => { const id = await R.sms.send({ from: o.from!, to, body: "Tallyhound test " + stamp + ". If you can read this, texting works." }); return "accepted by Twilio, id " + id + ". Check the phone"; } : undefined }, { email: o.email, text: o.text });
    const w = Math.max(...checks.map((c) => c.name.length)); for (const c of checks) console.log(c.name.padEnd(w + 2) + (c.state === "ok" ? "ok       " : c.state === "failed" ? "FAILED   " : "not set  ") + c.detail);
    const bad = checks.filter((c) => c.state === "failed").length; console.log("\n" + (bad ? bad + " failed. Fix those before a client is involved." : "Nothing failed. \"not set\" lines are services you have not connected, which is fine for a first local run.")); if (bad) process.exitCode = 1;
  }
  else if (cmd === "registration") { console.log(JSON.stringify(await R.firms.registration(need("firm")), null, 2)); }
  else if (cmd === "sender-approved") { await R.firms.senderApproved(need("firm"), need("number"), need("by")); console.log("Recorded. Texts to and from " + o.number + " now belong to this firm."); }
  else if (cmd === "set-plan") { const r = await R.app.withFirm(need("firm"), (T: any) => { const x = T.choosePlan(need("plan")); if (!x) T.audit("billing.plan", need("plan") + ", set by Tallyhound for " + need("by"), "Tallyhound"); return x; }); console.log(r ? "Not changed: " + r : "Plan set to " + o.plan + ". The firm is active."); }   // eslint-disable-line @typescript-eslint/no-explicit-any
  else if (cmd === "close-firm") { if (o.yes !== "true") throw new Error("This destroys the firm's key and everything it holds, for good. Add --yes to go ahead."); await R.closure.close(need("firm"), need("by")); console.log("Closed. Nothing of this firm's can be read again."); }
  else if (cmd === "after-restore") { const L = await R.closure.afterRestore(need("by")); console.log(L.length ? "Closed again: " + L.join(", ") : "No firm in this database was closed after the backup was taken."); }
  else if (cmd === "status") {
    // One line per firm: when the timer last visited, how today's sending went, and what the model did today.
    const L = await R.ops.status(new Date()); if (!L.length) console.log("No firm has been visited by the timer yet.");
    for (const l of L) console.log([l.firmId, "last tick " + (l.lastTick ? l.lastTick.toISOString() : "never"), "sent today " + l.sent, "failed " + l.failed, "model calls " + l.modelCalls, "model errors " + l.modelErrors, "model $" + l.modelUsd.toFixed(2), l.lastError ? "LAST ERROR: " + l.lastError : ""].filter(Boolean).join("  |  "));
  }
  else if (cmd === "usage") {
    // What each firm used in a month and what that cost us, from the engine's own rates.
    const month = o.month || new Date().toISOString().slice(0, 7), rates = createEngine().RATES as Record<string, number>; if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Give the month as --month 2027-02");
    for (const l of await R.ops.usage(month)) console.log([l.firmId, month, "texts out " + l.usage.segOut, "texts in " + l.usage.segIn, "pictures " + l.usage.mmsIn, "emails " + l.usage.email, "documents read " + l.usage.docRead, "texts read " + l.usage.textRead, "written " + l.usage.write, "cost $" + costOf(l.usage, rates).toFixed(2)].join("  |  "));
  }
  else if (cmd === "mailboxes") { if (!R.mailboxes) throw new Error("TH_MAIL_LAYER is not set: no mailboxes are connected anywhere"); const L = await R.mailboxes.adminList(need("firm")); if (!L.length) console.log("No mailbox has been connected for this firm."); for (const m of L) console.log([m.userId, m.provider, m.address, m.status, "layer id " + (m.assistantId || "none"), m.linked ? "linked by hand" : "connected by the preparer", "since " + new Date(m.connectedAt).toISOString().slice(0, 10)].join("  ")); }
  else if (cmd === "link-mailbox") { if (!R.mailboxes) throw new Error("TH_MAIL_LAYER is not set"); const p = need("provider"); if (p !== "google" && p !== "microsoft") throw new Error("--provider google or microsoft"); await R.mailboxes.linkExisting(need("firm"), need("user"), { assistantId: need("assistant"), provider: p, address: need("address") }); console.log("Linked. Letters to this preparer's clients now go from " + o.address + ". Tallyhound holds no token for it: to withdraw the permission the preparer uses their own Google or Microsoft account."); }
  else if (cmd === "disconnect-mailbox") { if (!R.mailboxes) throw new Error("TH_MAIL_LAYER is not set"); console.log((await R.mailboxes.disconnect(need("firm"), need("user"))) ? "Disconnected. No letter goes from that mailbox and its assistant is removed." : "That person had no connected mailbox."); }
  else if (cmd === "layer-reconcile") { const r = await R.app.reconcile(need("firm")); console.log(r.checked + " checked, " + r.drift.length + " put back" + (r.drift.length ? ": " + r.drift.map((x) => x.what + (x.itemId ? " " + x.itemId : "") + " of " + x.engId).join(", ") : "")); }
  else if (cmd === "layer-poll") { if (!R.layerPoll) throw new Error("Replies are pushed to /hooks/neeter (NEETER_REPLIES is not poll)"); console.log((await R.layerPoll(need("firm"))) + " events fetched and acted on."); }
  else if (cmd === "layer-rotate-key") { if (!R.mailboxes) throw new Error("TH_MAIL_LAYER is not set"); const L = R.mailboxes; await L.maintain(need("firm")); console.log("Done. (A key is only replaced when it is 90 days old; to force one, delete the firm's row in mail_layer_key and the next call makes a new key.)"); }
  else if (cmd === "layer-ping") { const secret = (process.env.NEETER_WEBHOOK_SECRET || "").trim(); if (!secret) throw new Error("NEETER_WEBHOOK_SECRET is not set"); const raw = Buffer.from(JSON.stringify({ id: "ping-" + Date.now(), type: "ping" })), r = await fetch(R.appUrl.replace(/\/$/, "") + "/hooks/neeter", { method: "POST", headers: { "content-type": "application/json", "x-layer-signature": hookSign(secret, raw, new Date()) }, body: raw }); console.log(r.status === 200 ? "ok: " + R.appUrl + "/hooks/neeter took a signed test event" : "FAILED: HTTP " + r.status + " from " + R.appUrl + "/hooks/neeter"); if (r.status !== 200) process.exitCode = 1; }
  else if (cmd === "pilot-report") {
    // The v2 spec's six measures, from each firm's own record (engine pilotMeasures). For the weekly numbers during the pilot.
    for (const id of o.firm ? [o.firm] : await R.auth.activeFirmIds()) { const json = await R.store.readState(id); if (!json) continue; const T = createEngine(); T.load(json); if (!T.S.firm.letters) continue; const M = T.pilotMeasures();
      console.log(id + "  " + T.S.firm.name + "  (" + M.clients + " clients sent a first letter, " + M.approvals + " letters approved)"); for (const r of M.rows) console.log("  " + r.label.padEnd(66) + String(r.display).padStart(12) + "  " + (r.n ? r.of : "").padEnd(26) + " " + ({ on_track: "on track", watch: "WATCH", stop: "PAST THE STOP LINE", early: "too early" } as Record<string, string>)[r.state]); }
  }
  else if (cmd === "set-mail") { const m = need("mode"); if (m !== "own" && m !== "mailbox") throw new Error("--mode own or mailbox"); if (m === "mailbox" && !R.mailboxes) throw new Error("TH_MAIL_LAYER is not set: no mailbox can send"); await R.app.withFirm(need("firm"), (T: any) => { T.S.firm.mail = m; T.audit("settings.mail", m === "own" ? "Letters now go from the firm's Tallyhound address" : "Letters now go from each preparer's own mailbox", "Tallyhound for " + need("by")); T.S.engs.forEach((e: any) => { if (e.status === "in_progress" && !e.next) { e.runFresh = true; e.next = new Date(T.S.now); } }); }); console.log(m === "own" ? "Letters for this firm now go from its Tallyhound address." : "Letters for this firm now go from each preparer's mailbox. A preparer with none connected sends nothing until they connect one."); }   // eslint-disable-line @typescript-eslint/no-explicit-any
  else if (cmd === "firms") { for (const id of await R.auth.activeFirmIds()) { const us = (await R.auth.usersOfFirm(id)).filter((u) => !u.leftAt); console.log(id + "  " + us.filter((u) => u.role === "owner").map((u) => u.email).join(", ") + "  (" + us.length + (us.length === 1 ? " person)" : " people)")); } }
  else { console.log("Commands: migrate, create-firm, firm-check, firms. See the top of apps/server/src/admin.ts."); process.exitCode = 1; }
} catch (err) { console.error((err as Error).message); process.exitCode = 1; }
finally { await R.pool.end(); }
