// Creating a firm and managing its staff accounts. A staff member exists in two places that must agree: the sign-in table
// (who may sign in) and the firm's own workspace (whose name goes on actions and the audit trail). Both use the same id.
import { randomBytes } from "node:crypto";
import { kitRegistration, type App, type Engine, type Role } from "./kit.ts";
import type { AuthStore, User } from "./authstore.ts";

export class FirmError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const ROLES: Role[] = ["owner", "staff", "read_only"];
export const SUPPORT_HOURS = [4, 24, 72];
const ZONE_OF: Record<string, string> = { "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Arizona", "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii" };
const email = (v: string) => { const e = String(v || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new FirmError("That is not an email address: " + v); return e; };
const clean = (v: string) => String(v || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
const newId = (p: string) => p + randomBytes(8).toString("hex");
const engineUser = (u: { id: string; name: string; email: string; role: Role }) => ({ id: u.id, first: u.name.split(" ")[0] || u.name, name: u.name, role: u.role, email: u.email });

export interface NewFirm { name: string; sender?: string; phone?: string; inbox: string; smsNumber?: string; iana: string; ownerEmail: string; ownerName: string; plan?: string; verified?: boolean; letters?: boolean }

// "Larkin & Poe CPAs" -> "larkinpoe". Letters only: a digit run in a link would be stopped by the engine's own message check.
const LETTERS = "abcdefghijkmnpqrstuvwxyz";
export const slugOf = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/\b(cpas?|llc|llp|pllc|pc|inc|and|the|co|company|associates|group)\b/g, " ").replace(/[^a-z]/g, "").slice(0, 24) || "firm";

// v2 (docs/V2.md): every firm made here is email-first. `letters: false` exists for the tests of the texting code, which is kept
// switched off for a later release. `mail` says who sends a firm's letters: each preparer's own mailbox through the mail layer,
// or Tallyhound's own mail service from the firm's Tallyhound address.
export function createFirms({ app, auth, linkHost, store, clock, letters = true, mail = "own" }: { app: App; auth: AuthStore; linkHost?: string; clock?: () => Date; letters?: boolean; mail?: "mailbox" | "own"; store?: { firmIdByNumber(n: string): Promise<string | null>; setNumber(id: string, n: string | null): Promise<void> } }) {
  const now = clock || (() => new Date());
  async function owners(firmId: string) { return (await auth.usersOfFirm(firmId)).filter((u) => u.role === "owner" && !u.leftAt); }
  return {
    // T-05. New firms start unchecked (T-116): nothing sends and nothing is read until the firm check is passed and setVerified is called.
    async create(o: NewFirm): Promise<{ firmId: string; ownerId: string; slug: string }> {
      const name = clean(o.name), ownerName = clean(o.ownerName), ownerEmail = email(o.ownerEmail), inbox = email(o.inbox);
      if (!name) throw new FirmError("The firm needs a name"); if (!ownerName) throw new FirmError("The owner needs a name");
      if (!ZONE_OF[o.iana]) throw new FirmError("Time zone must be one of: " + Object.keys(ZONE_OF).join(", "));
      const sms = String(o.smsNumber || "").replace(/\D/g, "").slice(-10); if (o.smsNumber && sms.length !== 10) throw new FirmError("The text number must have ten digits");
      if (await auth.userByEmail(ownerEmail)) throw new FirmError("That email address already has an account");
      const firmId = newId("f_"), owner = { id: newId("u_"), name: ownerName, email: ownerEmail, role: "owner" as Role };
      await app.createFirm(firmId, { name, sender: clean(o.sender || "") || name, phone: clean(o.phone || ""), email: inbox, inbox, smsNumber: sms, iana: o.iana, tz: ZONE_OF[o.iana], plan: o.plan, verified: o.verified === true, letters: o.letters === undefined ? letters : o.letters, mail, users: [engineUser(owner)] });
      await auth.createUser({ ...owner, firmId });
      // The firm's public short name. A clash gets a few random letters added.
      let slug = slugOf(name); for (let i = 0; !(await auth.setFirmSlug(firmId, slug)); i++) { if (i > 20) throw new FirmError("Could not find a free short name for the firm"); slug = slugOf(name).slice(0, 20) + Array.from(randomBytes(4), (b) => LETTERS[b % LETTERS.length]).join(""); }
      if (linkHost) await app.withFirm(firmId, (T: Engine) => { T.S.firm.linkBase = linkHost; T.S.firm.slug = slug; });
      await auth.audit(firmId, "tallyhound", "firm.created", o.verified === true ? "checked" : "waiting for the firm check");
      return { firmId, ownerId: owner.id, slug };
    },
    // The firm check (T-116) is done by a person at Tallyhound. This records the result.
    async setVerified(firmId: string, on: boolean, by: string): Promise<void> {
      await app.withFirm(firmId, (T: Engine) => { T.setVerified(on); });
      await auth.audit(firmId, "tallyhound", on ? "firm.checked" : "firm.suspended", clean(by));
    },
    // The carriers approved the firm's text number. Done by a person at Tallyhound, who files the registration by hand (T-134).
    // The number is recorded where arriving texts are matched to a firm, then in the firm's own state.
    async senderApproved(firmId: string, number: string, by: string): Promise<void> {
      const ten = String(number || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"); if (!/^[2-9]\d{9}$/.test(ten)) throw new FirmError("Give the approved number as 10 digits");
      if (!store) throw new FirmError("This service cannot record a number");
      const taken = await store.firmIdByNumber(ten); if (taken && taken !== firmId) throw new FirmError("That number already belongs to another firm");
      await store.setNumber(firmId, ten);
      await app.withFirm(firmId, (T: Engine) => { T.S.firm.smsNumber = ten; T.S.firm.senderStatus = "approved"; T.S.firm.senderApprovedAt = new Date(T.S.now); T.audit("sender.status", "Text number approved by the carriers", "Tallyhound"); });
      await auth.audit(firmId, "tallyhound", "sender.approved", clean(by));
    },
    /** What is filed with the carriers for a firm, from the details its owner entered. Throws with the reason when they are not complete. */
    async registration(firmId: string): Promise<{ brand: unknown; campaign: unknown }> {
      return (await app.withFirm(firmId, (T: Engine) => { const f = T.S.firm; if (!f.reg) throw new FirmError("The firm's owner has not entered its legal details yet"); const firm = { name: f.name, email: f.email, phone: f.phone }; return { brand: kitRegistration.brand(firm, f.reg), campaign: kitRegistration.campaign(firm, f.reg) }; })) as { brand: unknown; campaign: unknown };
    },
    async addUser(firmId: string, by: User, o: { email: string; name: string; role: Role }): Promise<string> {
      if (by.role !== "owner") throw new FirmError("Only an owner can add people", 403);
      if (!ROLES.includes(o.role)) throw new FirmError("Role must be owner, staff or read_only");
      const u = { id: newId("u_"), name: clean(o.name), email: email(o.email), role: o.role }; if (!u.name) throw new FirmError("Enter the person's name");
      // Someone who left this firm and comes back keeps their old row, and sets up two-step sign-in again.
      const old = await auth.userByEmail(u.email), back = !!old && !!old.leftAt && old.firmId === firmId; if (old && !back) throw new FirmError("That email address already has an account");
      if (back) { u.id = old!.id; await auth.reactivateUser(u.id, { role: u.role, name: u.name }); }
      else try { await auth.createUser({ ...u, firmId }); } catch (err) { throw new FirmError((err as Error).message); }   // two owners adding the same person at once
      try { await app.staff(firmId, by.id, (T: Engine) => { T.S.users = T.S.users.filter((y: { id: string }) => y.id !== u.id); T.S.users.push(engineUser(u)); T.audit("user.added", u.name + " added as " + u.role, by.name); }); }
      catch (err) { if (back) await auth.deactivateUser(u.id, new Date()); else await auth.removeUser(u.id); throw err; }
      await auth.audit(firmId, by.id, "user.added", u.id + " as " + u.role); return u.id;
    },
    // T-107: an owner lets one named Tallyhound support person look, not change, for a set time. It ends by itself.
    async addSupport(firmId: string, by: User, o: { email: string; name: string; hours: number }): Promise<{ id: string; until: Date }> {
      if (by.role !== "owner") throw new FirmError("Only an owner can let support in", 403);
      if (!SUPPORT_HOURS.includes(o.hours)) throw new FirmError("Choose 4 hours, 1 day or 3 days");
      const name = clean(o.name).replace(/\s*\(Tallyhound support\)$/, ""); if (!name) throw new FirmError("Enter the support person's name");
      const u = { id: newId("u_"), name: name + " (Tallyhound support)", email: email(o.email), role: "read_only" as Role }, until = new Date(now().getTime() + o.hours * 3600000);
      const old = await auth.userByEmail(u.email), back = !!old && old.firmId === firmId && (!!old.leftAt || !!old.supportUntil); if (old && !back) throw new FirmError("That email address already has an account");
      if (back) { u.id = old!.id; if (old!.leftAt) await auth.reactivateUser(u.id, { role: u.role, name: u.name }); }
      else try { await auth.createUser({ ...u, firmId }); } catch (err) { throw new FirmError((err as Error).message); }
      await auth.setSupport(u.id, until); await auth.setNotes(u.id, { morningOff: true, urgentOff: true });   // support gets no notes about the firm's clients
      await app.staff(firmId, by.id, (T: Engine) => { T.S.users = T.S.users.filter((y: { id: string }) => y.id !== u.id); T.S.users.push({ ...engineUser(u), support: true }); T.audit("support.granted", u.name + " can look, not change, for " + (o.hours < 24 ? o.hours + " hours" : o.hours === 24 ? "1 day" : o.hours / 24 + " days"), by.name); });
      await auth.audit(firmId, by.id, "support.granted", u.id + " for " + o.hours + "h"); return { id: u.id, until };
    },
    /** The timer's part: support people whose time is up are switched off, and the firm's history says so. */
    async expireSupport(): Promise<number> {
      const due = await auth.supportDue(now());
      for (const u of due) {
        await auth.deactivateUser(u.id, now()); await auth.setSupport(u.id, null);
        await app.withFirm(u.firmId, (T: Engine) => { T.S.users = T.S.users.filter((y: { id: string }) => y.id !== u.id); T.audit("support.ended", u.name + "'s access ended on time", "Tallyhound"); });
        await auth.audit(u.firmId, "tallyhound", "support.ended", u.id);
      }
      return due.length;
    },
    // A role change signs the person out everywhere, so the old role cannot linger in an open tab.
    async setRole(firmId: string, by: User, userId: string, role: Role): Promise<void> {
      if (by.role !== "owner") throw new FirmError("Only an owner can change roles", 403);
      if (!ROLES.includes(role)) throw new FirmError("Role must be owner, staff or read_only");
      const u = await auth.userById(userId); if (!u || u.firmId !== firmId || u.leftAt) throw new FirmError("No such person", 404);
      if (u.supportUntil) throw new FirmError("Support can only look. Remove them and add them as a person if they join the firm.");
      if (u.role === "owner" && role !== "owner" && (await owners(firmId)).length < 2) throw new FirmError("A firm needs at least one owner. Make someone else an owner first.");
      await app.staff(firmId, by.id, (T: Engine) => { const x = T.S.users.find((y: { id: string }) => y.id === userId); if (x) x.role = role; T.audit("user.role", u.name + " is now " + role, by.name); });
      await auth.setRole(userId, role); await auth.deleteSessionsOf(userId); await auth.audit(firmId, by.id, "user.role", userId + " to " + role);
    },
    // Removing switches the person off. The row stays so their name stays on the firm's history. Their clients pass to whoever removed them.
    async removeUser(firmId: string, by: User, userId: string): Promise<{ moved: number }> {
      if (by.role !== "owner") throw new FirmError("Only an owner can remove people", 403);
      const u = await auth.userById(userId); if (!u || u.firmId !== firmId || u.leftAt) throw new FirmError("No such person", 404);
      if (u.role === "owner" && (await owners(firmId)).length < 2) throw new FirmError("A firm needs at least one owner. Make someone else an owner first.");
      await auth.deactivateUser(userId, new Date());   // sign-in goes first: from this line the person cannot get in
      if (u.supportUntil) await auth.setSupport(userId, null);
      let moved = 0;
      await app.staff(firmId, by.id, (T: Engine) => { T.S.users = T.S.users.filter((y: { id: string }) => y.id !== userId); for (const c of T.S.clients) if (c.preparer === userId) { c.preparer = by.id; moved++; } T.audit("user.removed", u.name + " removed" + (moved ? ". " + moved + (moved === 1 ? " client" : " clients") + " passed to " + by.name : ""), by.name); });
      await auth.audit(firmId, by.id, "user.removed", userId); return { moved };
    }
  };
}
export type Firms = ReturnType<typeof createFirms>;
