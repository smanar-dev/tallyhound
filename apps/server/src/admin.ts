// Internal commands. Run from the repo root:
//   npm run admin -- migrate
//   npm run admin -- create-firm --name "Larkin & Poe CPAs" --inbox larkinpoe@docs.tallyhound.com --zone America/Chicago --owner-name "Pat Larkin" --owner-email pat@larkinpoe.com [--sms 6155550100] [--phone "(615) 555-0100"] [--plan Practice] [--checked]
//   npm run admin -- firm-check --firm f_... --by "Jordan" [--suspend]
//   npm run admin -- firms
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
  else if (cmd === "firms") { for (const id of await R.auth.activeFirmIds()) { const us = await R.auth.usersOfFirm(id); console.log(id + "  " + us.filter((u) => u.role === "owner").map((u) => u.email).join(", ") + "  (" + us.length + (us.length === 1 ? " person)" : " people)")); } }
  else { console.log("Commands: migrate, create-firm, firm-check, firms. See the top of apps/server/src/admin.ts."); process.exitCode = 1; }
} catch (err) { console.error((err as Error).message); process.exitCode = 1; }
finally { await R.pool.end(); }
