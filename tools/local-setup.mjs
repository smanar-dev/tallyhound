// One command to get a local Tallyhound ready:  npm run local:setup
// It writes .env (keeping one that exists), with the two secrets made for you, and tells you what to run next.
// Nothing here talks to any outside service.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), ".."), file = join(root, ".env");
if (existsSync(file)) console.log(".env is already there and was left alone.");
else {
  let text = readFileSync(join(root, ".env.example"), "utf8");
  text = text.replace(/^TH_MASTER_KEY=$/m, "TH_MASTER_KEY=" + randomBytes(32).toString("base64")).replace(/^TH_LINK_SECRET=$/m, "TH_LINK_SECRET=" + randomBytes(32).toString("hex"));
  if (process.env.DATABASE_URL) text = text.replace(/^DATABASE_URL=.*$/m, "DATABASE_URL=" + process.env.DATABASE_URL);
  writeFileSync(file, text, { mode: 0o600 });
  console.log("Wrote .env with a new master key and link secret. Keep this file: without the master key, nothing stored can be read again.");
}
console.log(`
Next:
  1. Postgres must be running and DATABASE_URL in .env must point at an empty database.
       With Docker:      docker compose up -d db
       Without Docker:   createdb th_dev
  2. npm run build                       the staff web app
  3. npm run admin -- create-firm --name "Your Firm CPAs" --inbox yourfirm@docs.tallyhound.com --zone America/Chicago --owner-name "Your Name" --owner-email you@example.com --plan Practice
  4. npm run admin -- firm-check --firm f_... --by "Your Name"      (the firm id is printed by step 3)
  5. npm start                           then open http://localhost:3000
  6. npm run admin -- check-services     what is connected, and whether each key works

docs/LOCAL.md has the rest: signing in with no email service, trying it with no keys at all, and letting Twilio, Postmark and Stripe reach your computer.`);
