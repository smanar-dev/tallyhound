// Starts the web service and the timer. TH_ROLE=web or TH_ROLE=worker runs one of them; the default runs both in one process.
import { checkLines } from "./lookup.ts";
import { createEngine } from "./kit.ts";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./server.ts";
import { createWorker } from "./worker.ts";
import { migrate, runtime } from "./runtime.ts";

const STALE_MS = 10 * 60000;   // the timer runs every five minutes: ten without a pass means it has stopped, and /healthz says so
const R = runtime(), role = process.env.TH_ROLE || "both";
const applied = await migrate(R.pool); if (applied.length) R.log("migrated", ...applied);
const worker = createWorker({ app: R.app, auth: R.auth, clock: R.clock, log: R.log, inbox: R.inbox, notify: R.notify, mailer: R.mailer, ops: R.ops, watch: R.watch, billing: R.billing, lines: R.lookup ? (id) => checkLines(R.app, (f) => R.store.readState(f), createEngine, R.lookup!, id) : undefined });
if (role !== "web") { worker.start(); worker.watchQueue(); }
if (role !== "worker") {
  const server = await buildServer({ app: R.app, auth: R.auth, signIn: R.signIn, firms: R.firms, readState: (id) => R.store.readState(id), getFile: (id, key) => R.store.getFile(id, key), appUrl: R.appUrl, secureCookies: R.appUrl.startsWith("https:"),
    webDir: join(dirname(fileURLToPath(import.meta.url)), "../../web/dist"), log: R.log, hooks: R.hooks, prepare: R.prepare, clientPages: { store: R.store, inbox: R.inbox, clock: R.clock, lookup: R.lookup }, ask: R.ask, storage: R.storage, billing: R.billing, signup: R.signup, domains: R.domains, voice: R.voiceOn, prior: R.prior, health: async () => ({ ok: role === "web" || !worker.status.lastPass || Date.now() - worker.status.lastPass.getTime() < STALE_MS, worker: role === "web" ? "separate" : worker.status, queue: await R.inbox.counts() }) });
  await server.listen({ port: +(process.env.PORT || 3000), host: "0.0.0.0" }); R.log("listening", R.appUrl);
}
