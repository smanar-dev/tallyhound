// Creating a firm and managing its staff accounts. A staff member exists in two places that must agree: the sign-in table
// (who may sign in) and the firm's own workspace (whose name goes on actions and the audit trail). Both use the same id.
import { randomBytes } from "node:crypto";
import type { App, Engine, Role } from "./kit.ts";
import type { AuthStore, User } from "./authstore.ts";

export class FirmError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const ROLES: Role[] = ["owner", "staff", "read_only"];
const ZONE_OF: Record<string, string> = { "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Mountain", "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii" };
const email = (v: string) => { const e = String(v || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new FirmError("That is not an email address: " + v); return e; };
const clean = (v: string) => String(v || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
const newId = (p: string) => p + randomBytes(8).toString("hex");
const engineUser = (u: { id: string; name: string; email: string; role: Role }) => ({ id: u.id, first: u.name.split(" ")[0] || u.name, name: u.name, role: u.role, email: u.email });

export interface NewFirm { name: string; sender?: string; phone?: string; inbox: string; smsNumber?: string; iana: string; ownerEmail: string; ownerName: string; plan?: string; verified?: boolean }

export function createFirms({ app, auth }: { app: App; auth: AuthStore }) {
  async function owners(firmId: string) { return (await auth.usersOfFirm(firmId)).filter((u) => u.role === "owner"); }
  return {
    // T-05. New firms start unchecked (T-116): nothing sends and nothing is read until the firm check is passed and setVerified is called.
    async create(o: NewFirm): Promise<{ firmId: string; ownerId: string }> {
      const name = clean(o.name), ownerName = clean(o.ownerName), ownerEmail = email(o.ownerEmail), inbox = email(o.inbox);
      if (!name) throw new FirmError("The firm needs a name"); if (!ownerName) throw new FirmError("The owner needs a name");
      if (!ZONE_OF[o.iana]) throw new FirmError("Time zone must be one of: " + Object.keys(ZONE_OF).join(", "));
      const sms = String(o.smsNumber || "").replace(/\D/g, "").slice(-10); if (o.smsNumber && sms.length !== 10) throw new FirmError("The text number must have ten digits");
      if (await auth.userByEmail(ownerEmail)) throw new FirmError("That email address already has an account");
      const firmId = newId("f_"), owner = { id: newId("u_"), name: ownerName, email: ownerEmail, role: "owner" as Role };
      await app.createFirm(firmId, { name, sender: clean(o.sender || "") || name, phone: clean(o.phone || ""), email: inbox, inbox, smsNumber: sms, iana: o.iana, tz: ZONE_OF[o.iana], plan: o.plan, verified: o.verified === true, users: [engineUser(owner)] });
      await auth.createUser({ ...owner, firmId });
      await auth.audit(firmId, "tallyhound", "firm.created", o.verified === true ? "checked" : "waiting for the firm check");
      return { firmId, ownerId: owner.id };
    },
    // The firm check (T-116) is done by a person at Tallyhound. This records the result.
    async setVerified(firmId: string, on: boolean, by: string): Promise<void> {
      await app.withFirm(firmId, (T: Engine) => { T.setVerified(on); });
      await auth.audit(firmId, "tallyhound", on ? "firm.checked" : "firm.suspended", clean(by));
    },
    async addUser(firmId: string, by: User, o: { email: string; name: string; role: Role }): Promise<string> {
      if (by.role !== "owner") throw new FirmError("Only an owner can add people", 403);
      if (!ROLES.includes(o.role)) throw new FirmError("Role must be owner, staff or read_only");
      const u = { id: newId("u_"), name: clean(o.name), email: email(o.email), role: o.role }; if (!u.name) throw new FirmError("Enter the person's name");
      if (await auth.userByEmail(u.email)) throw new FirmError("That email address already has an account");
      try { await auth.createUser({ ...u, firmId }); } catch (err) { throw new FirmError((err as Error).message); }   // two owners adding the same person at once
      try { await app.staff(firmId, by.id, (T: Engine) => { T.S.users.push(engineUser(u)); T.audit("user.added", u.name + " added as " + u.role, by.name); }); }
      catch (err) { await auth.removeUser(u.id); throw err; }
      await auth.audit(firmId, by.id, "user.added", u.id + " as " + u.role); return u.id;
    },
    // A role change signs the person out everywhere, so the old role cannot linger in an open tab.
    async setRole(firmId: string, by: User, userId: string, role: Role): Promise<void> {
      if (by.role !== "owner") throw new FirmError("Only an owner can change roles", 403);
      if (!ROLES.includes(role)) throw new FirmError("Role must be owner, staff or read_only");
      const u = await auth.userById(userId); if (!u || u.firmId !== firmId) throw new FirmError("No such person", 404);
      if (u.role === "owner" && role !== "owner" && (await owners(firmId)).length < 2) throw new FirmError("A firm needs at least one owner. Make someone else an owner first.");
      await app.staff(firmId, by.id, (T: Engine) => { const x = T.S.users.find((y: { id: string }) => y.id === userId); if (x) x.role = role; T.audit("user.role", u.name + " is now " + role, by.name); });
      await auth.setRole(userId, role); await auth.deleteSessionsOf(userId); await auth.audit(firmId, by.id, "user.role", userId + " to " + role);
    },
    async removeUser(firmId: string, by: User, userId: string): Promise<void> {
      if (by.role !== "owner") throw new FirmError("Only an owner can remove people", 403);
      const u = await auth.userById(userId); if (!u || u.firmId !== firmId) throw new FirmError("No such person", 404);
      if (u.role === "owner" && (await owners(firmId)).length < 2) throw new FirmError("A firm needs at least one owner. Make someone else an owner first.");
      await auth.removeUser(userId);   // sign-in goes first: from this line the person cannot get in
      await app.staff(firmId, by.id, (T: Engine) => { T.S.users = T.S.users.filter((y: { id: string }) => y.id !== userId); T.audit("user.removed", u.name + " removed", by.name); });
      await auth.audit(firmId, by.id, "user.removed", userId);
    }
  };
}
export type Firms = ReturnType<typeof createFirms>;
