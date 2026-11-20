// Internal commands. Run from the repo root:
//   npm run admin -- migrate
//   npm run admin -- create-firm --name "Larkin & Poe CPAs" --inbox larkinpoe@docs.tallyhound.com --zone America/Chicago --owner-name "Pat Larkin" --owner-email pat@larkinpoe.com [--sms 6155550100] [--phone "(615) 555-0100"] [--plan Practice] [--checked]
//   npm run admin -- firm-check --firm f_... --by "Jordan" [--suspend]
//   npm run admin -- registration --firm f_...   prints what to file with the carriers for this firm's text number
//   npm run admin -- sender-approved --firm f_... --number 6155550100 --by Jordan   the carriers approved the number
//   npm run admin -- set-plan --firm f_... --plan Practice --by Jordan   starts or changes a paid plan (invoiced by hand until card billing is built)
//   npm run admin -- close-firm --firm f_... --by "Jordan" --yes   destroys the firm's key and everything it holds
//   npm run admin -- after-restore --by "Jordan"   run after every restore: closes again any firm closed since the backup
//   npm run admin -- status                    one line per firm: last tick, sent and failed today, model calls and errors today
//   npm run admin -- usage [--month 2027-02]   what each firm used that month and what it cost us
//   npm run admin -- firms
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
  else if (cmd === "firms") { for (const id of await R.auth.activeFirmIds()) { const us = (await R.auth.usersOfFirm(id)).filter((u) => !u.leftAt); console.log(id + "  " + us.filter((u) => u.role === "owner").map((u) => u.email).join(", ") + "  (" + us.length + (us.length === 1 ? " person)" : " people)")); } }
  else { console.log("Commands: migrate, create-firm, firm-check, firms. See the top of apps/server/src/admin.ts."); process.exitCode = 1; }
} catch (err) { console.error((err as Error).message); process.exitCode = 1; }
finally { await R.pool.end(); }
