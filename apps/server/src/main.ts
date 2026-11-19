// Starts the web service and the timer. TH_ROLE=web or TH_ROLE=worker runs one of them; the default runs both in one process.
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./server.ts";
import { createWorker } from "./worker.ts";
import { migrate, runtime } from "./runtime.ts";

const R = runtime(), role = process.env.TH_ROLE || "both";
const applied = await migrate(R.pool); if (applied.length) R.log("migrated", ...applied);
const worker = createWorker({ app: R.app, auth: R.auth, clock: R.clock, log: R.log, inbox: R.inbox });
if (role !== "web") { worker.start(); worker.watchQueue(); }
if (role !== "worker") {
  const server = await buildServer({ app: R.app, auth: R.auth, signIn: R.signIn, firms: R.firms, readState: (id) => R.store.readState(id), appUrl: R.appUrl, secureCookies: R.appUrl.startsWith("https:"),
    publicDir: join(dirname(fileURLToPath(import.meta.url)), "../public"), log: R.log, hooks: R.hooks, prepare: R.prepare, health: async () => ({ worker: role === "web" ? "separate" : worker.status, queue: await R.inbox.counts() }) });
  await server.listen({ port: +(process.env.PORT || 3000), host: "0.0.0.0" }); R.log("listening", R.appUrl);
}
