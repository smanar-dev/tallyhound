// The first live run: one harmless question to every outside service that has been set up, so a wrong key, a wrong id or a
// changed API shows up here and not in front of a client. Run it after filling in .env:
//     npm run admin -- check-services
// Nothing is sent to anyone, no firm is touched, and no secret is printed. Each line says: ok, failed (and why), or not set.
// Two optional real sends, each to an address or number you name, to prove the whole path:
//     npm run admin -- check-services --email you@yourfirm.com --text 6155550100
import Anthropic from "@anthropic-ai/sdk";

export interface Check { name: string; state: "ok" | "failed" | "not set"; detail: string }
export interface PreflightDeps { layer?: () => Promise<string>; env: (k: string) => string; fetch?: typeof fetch; db?: () => Promise<string>; files?: () => Promise<string>; key?: () => Promise<string>; model?: () => Promise<string>; sendEmail?: (to: string) => Promise<string>; sendText?: (to: string) => Promise<string> }

export async function preflight(d: PreflightDeps, o: { email?: string; text?: string } = {}): Promise<Check[]> {
  const f = d.fetch || fetch, env = d.env, out: Check[] = [];
  const run = async (name: string, on: boolean, missing: string, go: () => Promise<string>) => { if (!on) { out.push({ name, state: "not set", detail: missing }); return; } try { out.push({ name, state: "ok", detail: await go() }); } catch (err) { out.push({ name, state: "failed", detail: String((err as Error).message || err).replace(/\s+/g, " ").slice(0, 200) }); } };
  const get = async (url: string, headers: Record<string, string>) => { const r = await f(url, { headers, signal: AbortSignal.timeout(15000) }), j = (await r.json().catch(() => ({}))) as Record<string, any>; if (!r.ok) throw new Error("HTTP " + r.status + " " + String(j.message || j.Message || (j.error && (j.error.message || j.error)) || "").slice(0, 120)); return j; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const basic = (u: string, p: string) => "Basic " + Buffer.from(u + ":" + p).toString("base64");

  await run("Database", !!d.db, "DATABASE_URL", () => d.db!());
  await run("Files", !!d.files, "", () => d.files!());
  await run("Master key", !!d.key, "TH_MASTER_KEY or TH_KMS_KEY_ID", () => d.key!());
  await run("Claude (reading and writing)", !!env("ANTHROPIC_API_KEY") && !!d.model, "ANTHROPIC_API_KEY: documents go to a person, messages use the standard wording", () => d.model!());
  const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN");
  await run("Twilio account", !!sid, "TWILIO_ACCOUNT_SID: no texting, Tallyhound collects by email", async () => { const j = await get("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + ".json", { authorization: basic(sid, tok) }); if (j.status !== "active") throw new Error("the account is " + j.status); return "active" + (j.type === "Trial" ? ", a TRIAL account: it can only text numbers you have verified" : ""); });
  await run("Twilio messaging service", !!sid && !!env("TWILIO_MESSAGING_SERVICE_SID"), "TWILIO_MESSAGING_SERVICE_SID", async () => { const j = await get("https://messaging.twilio.com/v1/Services/" + encodeURIComponent(env("TWILIO_MESSAGING_SERVICE_SID")), { authorization: basic(sid, tok) }); const hook = String(j.inbound_request_url || ""), want = env("APP_URL").replace(/\/$/, "") + "/hooks/twilio"; return "found" + (hook === want ? ", texts arrive at " + want : ". SET its incoming-message address to " + want + " (it is " + (hook || "empty") + ")"); });
  await run("Twilio landline lookup", !!sid && env("TH_LINE_LOOKUP") !== "off", "needs Twilio: landlines are not spotted before the first text", async () => { const j = await get("https://lookups.twilio.com/v2/PhoneNumbers/%2B14155552671?Fields=line_type_intelligence", { authorization: basic(sid, tok) }); const t = j.line_type_intelligence && j.line_type_intelligence.type; if (!j.line_type_intelligence) throw new Error("the answer has no line_type_intelligence: the lookup package may not be enabled on this account"); return "answers (a test number reads as " + (t || "unknown") + ")"; });
  await run("Postmark (email out)", !!env("POSTMARK_TOKEN"), "POSTMARK_TOKEN: no email is sent; sign-in links print to the terminal", async () => { const j = await get("https://api.postmarkapp.com/server", { accept: "application/json", "x-postmark-server-token": env("POSTMARK_TOKEN") }); const hook = String(j.InboundHookUrl || ""); return "server \"" + j.Name + "\"" + (env("TH_SIGNIN_FROM") ? "" : ". SET TH_SIGNIN_FROM to a sender address Postmark has confirmed") + (hook.includes("/hooks/postmark/inbound") ? ", mail in arrives at this service" : ". SET its inbound webhook to " + env("APP_URL").replace(/\/$/, "").replace("://", "://" + (env("POSTMARK_HOOK_USER") || "postmark") + ":<password>@") + "/hooks/postmark/inbound"); });
  await run("Postmark account (own-domain email)", !!env("POSTMARK_ACCOUNT_TOKEN"), "POSTMARK_ACCOUNT_TOKEN: firms cannot send from their own domain", async () => { const j = await get("https://api.postmarkapp.com/domains?count=1&offset=0", { accept: "application/json", "x-postmark-account-token": env("POSTMARK_ACCOUNT_TOKEN") }); return "answers, " + (j.TotalCount ?? 0) + " domains so far"; });
  const sk = env("STRIPE_SECRET_KEY");
  await run("Stripe", !!sk, "STRIPE_SECRET_KEY: plans are started with the admin command and invoiced by hand", async () => { const notes: string[] = []; for (const p of ["SOLO", "PRACTICE", "FIRM", "LARGE", "SOLO_B", "PRACTICE_B", "FIRM_B", "LARGE_B"]) { const id = env("STRIPE_PRICE_" + p); if (!id) continue; const j = await get("https://api.stripe.com/v1/prices/" + encodeURIComponent(id), { authorization: "Bearer " + sk }); if (!j.active) throw new Error("price " + p + " is not active"); if (!j.recurring || j.recurring.interval !== "month") throw new Error("price " + p + " is not a monthly price"); notes.push(p.toLowerCase() + " $" + (Number(j.unit_amount) / 100)); } if (!notes.length) throw new Error("no STRIPE_PRICE_<PLAN> is set, so there is nothing to sell"); return (sk.startsWith("sk_test_") ? "TEST mode, " : "live, ") + notes.join(", ") + (env("STRIPE_WEBHOOK_SECRET") ? "" : ". SET STRIPE_WEBHOOK_SECRET"); });
  for (const [name, id, slugs] of [["Google Drive", "GOOGLE_CLIENT_ID", ["google"]], ["Microsoft (OneDrive, SharePoint)", "MICROSOFT_CLIENT_ID", ["onedrive", "sharepoint"]], ["Dropbox", "DROPBOX_APP_KEY", ["dropbox"]]] as [string, string, string[]][])
    await run(name, !!env(id), id + ": firms cannot connect it", async () => "keys are set. It can only be proved by connecting one from Settings, Finished files. The service must list this return address: " + slugs.map((s) => env("APP_URL").replace(/\/$/, "") + "/api/storage/" + s + "/callback").join(" and "));
  // v2: the mail layer (docs/neeter/RUNBOOK.md). Its settings are checked for sense first, then one question with the partner key.
  const ml = env("TH_MAIL_LAYER"), app = env("APP_URL").replace(/\/$/, "");
  await run("Mail layer settings", !!ml, "TH_MAIL_LAYER: letters go from each firm's Tallyhound address through Postmark", async () => {
    if (ml === "fake") return "the stand-in, held in memory. For a trial run only";
    const miss = ["NEETER_BASE_URL", "NEETER_PARTNER_KEY"].concat(env("NEETER_REPLIES") === "poll" ? [] : ["NEETER_WEBHOOK_SECRET"]).filter((k) => !env(k)); if (miss.length) throw new Error("missing " + miss.join(", "));
    if (!/^https:\/\//.test(env("NEETER_BASE_URL"))) throw new Error("NEETER_BASE_URL must start with https://");
    if (env("NEETER_REPLIES") !== "poll" && env("NEETER_WEBHOOK_SECRET").length < 32) throw new Error("NEETER_WEBHOOK_SECRET is shorter than 32 characters");
    if (!env("GOOGLE_CLIENT_ID") && !env("MICROSOFT_CLIENT_ID")) throw new Error("no sign-in app: set GOOGLE_CLIENT_ID or MICROSOFT_CLIENT_ID so preparers can connect a mailbox");
    const notes = ["letters " + (env("NEETER_SEND") === "due_date" ? "by DUE DATE (Neeter's own wording; pilot stopgap)" : "sent in Tallyhound's words"), "replies " + (env("NEETER_REPLIES") === "poll" ? "fetched by the timer" : "pushed to " + app + "/hooks/neeter")];
    notes.push("sign-in return addresses to register: " + [env("GOOGLE_CLIENT_ID") ? app + "/api/mailbox/google/callback" : "", env("MICROSOFT_CLIENT_ID") ? app + "/api/mailbox/microsoft/callback" : ""].filter(Boolean).join(" and "));
    return notes.join("; ");
  });
  await run("Mail layer (Neeter)", ml === "neeter" && !!d.layer, "TH_MAIL_LAYER=neeter", () => d.layer!());
  if (o.email) await run("A real email to " + o.email, !!d.sendEmail, "POSTMARK_TOKEN", () => d.sendEmail!(o.email!));
  if (o.text) await run("A real text to " + o.text, !!d.sendText, "TWILIO_ACCOUNT_SID", () => d.sendText!(o.text!));
  return out;
}

/** The checks that need this installation's own connections. */
export function localChecks(R: { pool: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }; bucket: { put(k: string, b: Buffer): Promise<void>; get(k: string): Promise<Buffer | null>; del(k: string): Promise<void> }; keyring: { newDataKey(label: string): Promise<{ plain: Buffer; wrapped: Buffer }>; unwrap(w: Buffer, label: string): Promise<Buffer> } }, env: (k: string) => string) {
  return {
    db: async () => { const n = (await R.pool.query("select count(*)::int as n from schema_migrations")).rows[0]!.n, v = String((await R.pool.query("show server_version")).rows[0]!.server_version); return "Postgres " + v.split(" ")[0] + ", " + n + " migrations applied"; },
    files: async () => { const k = "preflight/" + Date.now(), b = Buffer.from("tallyhound preflight"); await R.bucket.put(k, b); const back = await R.bucket.get(k); await R.bucket.del(k); if (!back || !back.equals(b)) throw new Error("what was read back is not what was written"); if (await R.bucket.get(k)) throw new Error("a deleted file can still be read: turn versioning OFF on the bucket"); return env("S3_BUCKET") ? "bucket " + env("S3_BUCKET") + ": write, read and delete all work" : "local disk (development only): write, read and delete all work"; },
    key: async () => { const k = await R.keyring.newDataKey("preflight"), back = await R.keyring.unwrap(k.wrapped, "preflight"); if (!back.equals(k.plain)) throw new Error("a key that was wrapped did not open to the same key"); return env("TH_KMS_KEY_ID") ? "the key service makes and opens data keys" : "the key in TH_MASTER_KEY works (development; use TH_KMS_KEY_ID in production)"; },
    model: async () => { const c = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), timeout: 20000, maxRetries: 1 }), names: string[] = []; for (const m of [env("TH_MODEL_QUICK") || "claude-haiku-5-5", env("TH_MODEL_DEFAULT") || "claude-sonnet-5-5"]) { const r = await c.messages.create({ model: m, max_tokens: 64, messages: [{ role: "user", content: "Reply with the single word: ready" }] }); if (r.stop_reason === "refusal") throw new Error(m + " declined a harmless request"); names.push(m); } return names.join(" and ") + " both answer"; }
  };
}
