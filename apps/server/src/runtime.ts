// Reads the environment and builds the real thing: Postgres, sealed storage, senders, the model. Used by main.ts and admin.ts.
import pg from "pg";
import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claude, trackFirm } from "./model.ts";
import { createApp, kitCrypto, kitEmailOut, kitPostgres, kitTwilio, type Sender, type TwilioAdapter } from "./kit.ts";
import { postgresAuthStore } from "./authstore.ts";
import { createSignIn, firmSecrets, type Mailer } from "./signin.ts";
import { createNotifier, type StaffMailer } from "./notify.ts";
import { createWatch, postgresOpsStore } from "./ops.ts";
import { createFirms } from "./firms.ts";
import { createInbox, postgresQueue } from "./queue.ts";
import { handlers } from "./hooks.ts";
import { prepareOpts } from "./files.ts";
import { s3Bucket } from "./bucket.ts";
import { kmsKeyring } from "./keys.ts";
import { createClosure } from "./closure.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = (k: string) => (process.env[k] || "").trim();
function need(k: string): string { const v = env(k); if (!v) throw new Error("Set " + k + " (see apps/server/README.md)"); return v; }

// Sealed file bytes on local disk. For development and the first staging box only: production uses a private bucket (T-11).
function diskBucket(dir: string) {
  mkdirSync(dir, { recursive: true }); const p = (key: string) => join(dir, key.replace(/[^a-zA-Z0-9_]/g, "_"));
  return { async put(key: string, bytes: Buffer) { await writeFile(p(key), bytes); }, async get(key: string) { try { return await readFile(p(key)); } catch { return null; } }, async del(key: string) { try { await unlink(p(key)); } catch { /* already gone */ } } };
}
// A provider that has not been connected yet. The pipeline records the failure and tells the firm; nothing is pretended.
const notConnected = (what: string): Sender => ({ async send() { throw new Error(what + " is not connected yet"); } });

export function runtime() {
  const production = env("NODE_ENV") === "production", appUrl = env("APP_URL") || "http://localhost:" + (env("PORT") || "3000");
  const pool = new pg.Pool({ connectionString: need("DATABASE_URL"), max: 10 });
  // The master key (T-102). With TH_KMS_KEY_ID it lives in AWS KMS and this service can use it but never read it; TH_MASTER_KEY,
  // if still set, only opens firms made before the move. Without TH_KMS_KEY_ID the key is TH_MASTER_KEY itself: fine for
  // development, and said out loud at every start in production.
  const local = env("TH_MASTER_KEY") ? kitCrypto.localKeyring(env("TH_MASTER_KEY")) : undefined;
  const keyring = env("TH_KMS_KEY_ID") ? kmsKeyring({ keyId: env("TH_KMS_KEY_ID")!, region: env("TH_KMS_REGION") || env("AWS_REGION") || undefined, before: local }) : local || kitCrypto.localKeyring(need("TH_MASTER_KEY"));
  if (production && !env("TH_KMS_KEY_ID")) console.log(JSON.stringify({ at: new Date().toISOString(), event: "master_key_in_environment", note: "Set TH_KMS_KEY_ID to keep the master key in the key service" }));
  // Files: a private S3-compatible bucket when S3_BUCKET is set. Local disk otherwise, which production refuses.
  if (production && !env("S3_BUCKET")) throw new Error("Set S3_BUCKET: production keeps files in a private bucket, not on the server's disk");
  const bucket = env("S3_BUCKET") ? s3Bucket({ bucket: env("S3_BUCKET"), region: env("S3_REGION") || undefined, endpoint: env("S3_ENDPOINT") || undefined }) : diskBucket(env("TH_FILES_DIR") || join(ROOT, ".data/files"));
  const store = trackFirm(kitCrypto.encryptedStore(kitPostgres.postgresStore(pool, bucket), keyring));
  const auth = postgresAuthStore(pool), clock = () => new Date();
  // Ids and outcomes only. The kit names an unconfirmed sender when it logs one; an address never reaches the log.
  const log = (event: string, ...ids: unknown[]) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ids: ids.map((v) => (typeof v === "string" && v.includes("@") ? "[address]" : v)) }));
  const twilio: TwilioAdapter | null = env("TWILIO_ACCOUNT_SID") ? kitTwilio.twilio({ accountSid: env("TWILIO_ACCOUNT_SID"), authToken: need("TWILIO_AUTH_TOKEN"), messagingServiceSid: need("TWILIO_MESSAGING_SERVICE_SID") }) : null;
  const sms = twilio || notConnected("Texting");
  const email = env("POSTMARK_TOKEN") ? kitEmailOut.postmark({ serverToken: env("POSTMARK_TOKEN") }) : notConnected("Email");
  const ops = postgresOpsStore(pool);
  const ai = env("ANTHROPIC_API_KEY") ? claude({ apiKey: env("ANTHROPIC_API_KEY"), dailyCapUsd: +(env("TH_MODEL_DAILY_CAP_USD") || 10), log, record: (c) => { void ops.modelCall(c).catch((err: Error) => log("model_record_failed", c.firmId, err.message)); } }) : null;   // no key: rules and standard wording
  const app = createApp({ store, sms, email, ai, clock, log });
  if (production && !env("POSTMARK_TOKEN")) throw new Error("Set POSTMARK_TOKEN: without it nobody can be sent a sign-in link");
  const mailer: Mailer & StaffMailer = env("POSTMARK_TOKEN")
    ? { async signInLink(to, url) { await email.send({ from: need("TH_SIGNIN_FROM"), fromName: "Tallyhound", to, subject: "Your Tallyhound sign-in link", body: "Open this link to sign in to Tallyhound. It works once and expires in 15 minutes.\n\n" + url + "\n\nIf you did not ask for this, ignore this email." }); },
        async staff(to, subject, body) { await email.send({ from: need("TH_SIGNIN_FROM"), fromName: "Tallyhound", to, subject, body }); },
        async locked(to, minutes) { await email.send({ from: need("TH_SIGNIN_FROM"), fromName: "Tallyhound", to, subject: "Tallyhound sign-in is locked for " + minutes + " minutes", body: "Someone entered the wrong sign-in code for your Tallyhound account several times, so sign-in is locked for " + minutes + " minutes. Nothing else has changed.\n\nIf that was you, wait and then ask for a new sign-in link. If it was not you, tell your firm's owner: someone may have reached your email." }); } }
    : { async signInLink(to, url) { console.log("\n  Sign-in link for " + to + " (development only, no email service connected):\n  " + url + "\n"); }, async locked(to, minutes) { console.log("  Sign-in locked for " + to + " for " + minutes + " minutes"); }, async staff(to, subject) { console.log("  Staff email not sent (no email service connected): " + subject.replace(/^\S+ \S+ /, "")); } };
  const signIn = createSignIn({ auth, secrets: firmSecrets(store, keyring, kitCrypto), mailer, linkSecret: need("TH_LINK_SECRET"), appUrl, clock });
  const firms = createFirms({ app, auth, linkHost: env("LINK_HOST") || new URL(appUrl).host });
  const prepare = prepareOpts({ clamav: env("CLAMAV_HOST") ? { host: env("CLAMAV_HOST"), port: +(env("CLAMAV_PORT") || 3310) } : undefined });
  if (production && !env("CLAMAV_HOST")) log("warning_no_virus_scanner");
  const inbox = createInbox({ queue: postgresQueue(pool), store, app, handlers: handlers({ app, twilio, prepare }), clock, log });
  const hooks = { store, inbox, twilioAuthToken: env("TWILIO_AUTH_TOKEN") || undefined, postmarkHook: env("POSTMARK_HOOK_PASSWORD") ? { user: env("POSTMARK_HOOK_USER") || "postmark", pass: env("POSTMARK_HOOK_PASSWORD") } : undefined };
  return { production, appUrl, pool, store, auth, app, signIn, firms, inbox, hooks, prepare, clock, log, root: ROOT, mailer, notify: createNotifier({ appUrl }), ops, closure: createClosure({ store, auth, markers: bucket, clock, log }),
    // TH_ALERT_EMAIL: where the developer is told that sends are failing, a firm's turn failed, or an arriving message was lost.
    watch: env("TH_ALERT_EMAIL") ? createWatch({ to: env("TH_ALERT_EMAIL")!, send: (to, subject, body) => mailer.staff(to, subject, body), clock, log }) : undefined };
}

// Brings an empty or older database up to date. Safe to run on every deploy.
export async function migrate(pool: pg.Pool, root = ROOT): Promise<string[]> {
  const done: string[] = [], c = await pool.connect();
  try {
    await c.query("create table if not exists schema_migrations (name text primary key, at timestamptz not null default now())");
    const has = new Set((await c.query("select name from schema_migrations")).rows.map((r) => r.name as string));
    const dir = join(root, "db/migrations"), list: [string, string][] = [["001_schema.sql", join(root, "db/schema.sql")]];
    if (existsSync(dir)) for (const n of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) list.push([n, join(dir, n)]);
    for (const [name, file] of list) {
      if (has.has(name)) continue;
      // A database set up by hand from schema.sql before migrations existed already has the tables.
      if (name === "001_schema.sql" && (await c.query("select to_regclass('firms') as t")).rows[0].t) { await c.query("insert into schema_migrations (name) values ($1)", [name]); continue; }
      await c.query("begin");
      try { await c.query(readFileSync(file, "utf8")); await c.query("insert into schema_migrations (name) values ($1)", [name]); await c.query("commit"); done.push(name); }
      catch (err) { await c.query("rollback"); throw err; }
    }
  } finally { c.release(); }
  return done;
}
