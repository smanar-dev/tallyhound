// Where sign-in data lives: staff accounts, sessions, used links, recovery codes, and the append-only audit log.
// Two versions with the same methods: memory (tests, local development) and Postgres (db/schema.sql + db/migrations).
import type { Role } from "./kit.ts";

export interface User {
  id: string; firmId: string; email: string; role: Role; name: string;
  mfaSecret: Buffer | null;    // sealed with the firm's key
  mfaPending: Buffer | null;   // sealed; shown at setup, not yet confirmed
  totpStep: number | null;
  leftAt: Date | null;        // set when the person was removed: no sign-in, the name stays on history
  lockedUntil: Date | null;   // too many wrong codes
  morningOff: boolean;        // no 7 am note
  urgentOff: boolean;         // no email at once when something urgent comes up
  supportUntil: Date | null;  // T-107: a Tallyhound support person the owner let in, and when that ends
}
export interface Session { hash: string; userId: string; stage: "link" | "full"; createdAt: Date; expiresAt: Date; fails: number }

export interface AuthStore {
  userByEmail(email: string): Promise<User | null>;
  userById(id: string): Promise<User | null>;
  usersOfFirm(firmId: string): Promise<User[]>;
  createUser(u: { id: string; firmId: string; email: string; role: Role; name: string }): Promise<void>;
  setRole(id: string, role: Role): Promise<void>;
  removeUser(id: string): Promise<void>;
  /** The person can no longer sign in. Their sessions, second factor and recovery codes go; the row and the name stay. */
  deactivateUser(id: string, at: Date): Promise<void>;
  reactivateUser(id: string, o: { role: Role; name: string }): Promise<void>;
  setNotes(id: string, o: { morningOff: boolean; urgentOff: boolean }): Promise<void>;
  setSupport(id: string, until: Date | null): Promise<void>;
  /** Support people whose time has run out and who are not yet switched off. */
  supportDue(now: Date): Promise<User[]>;
  noteFail(userId: string, at: Date): Promise<void>;
  failsSince(userId: string, since: Date): Promise<number>;
  /** Locks sign-in until the given time and forgets the failures that led to it. */
  lock(userId: string, until: Date): Promise<void>;
  setMfaPending(id: string, sealed: Buffer): Promise<void>;
  confirmMfa(id: string, sealed: Buffer, step: number): Promise<void>;
  /** Records the step of an accepted code. False when that step, or a later one, was already used. */
  advanceTotp(id: string, step: number): Promise<boolean>;
  putRecovery(userId: string, hashes: string[]): Promise<void>;
  /** True exactly once per code. */
  useRecovery(userId: string, hash: string, now: Date): Promise<boolean>;
  recoveryLeft(userId: string): Promise<number>;
  /** True the first time a link is opened, false ever after. */
  claimLink(jti: string, expiresAt: Date): Promise<boolean>;
  noteLinkRequest(emailHash: string, at: Date): Promise<void>;
  linkRequestsSince(emailHash: string, since: Date): Promise<number>;
  createSession(s: Session): Promise<void>;
  session(hash: string): Promise<Session | null>;
  updateSession(hash: string, patch: { stage?: "link" | "full"; expiresAt?: Date }): Promise<void>;
  /** Adds one failed code to the session and returns the new count. */
  failSession(hash: string): Promise<number>;
  deleteSession(hash: string): Promise<void>;
  deleteSessionsOf(userId: string, exceptHash?: string): Promise<void>;
  audit(firmId: string, actor: string, action: string, detail?: string): Promise<void>;
  /** Claims a public short name for a firm. False when another firm has it. */
  setFirmSlug(firmId: string, slug: string): Promise<boolean>;
  firmIdBySlug(slug: string): Promise<string | null>;
  /** Firms the timer should visit. */
  activeFirmIds(): Promise<string[]>;
  /** Claims a request key. Fresh the first time; afterwards gives back what the first request answered, or null if it has not finished. */
  claimKey(firmId: string, key: string, at: Date): Promise<{ fresh: true } | { fresh: false; response: unknown }>;
  finishKey(firmId: string, key: string, response: unknown): Promise<void>;
  /** Removes expired sessions, used links and old rate-limit rows. */
  sweep(now: Date): Promise<void>;
}

const lower = (s: string) => String(s || "").trim().toLowerCase();

export function memoryAuthStore(firmIds: () => string[] = () => []): AuthStore & { auditRows: { firmId: string; actor: string; action: string; detail?: string }[] } {
  const users = new Map<string, User>(), sessions = new Map<string, Session>(), links = new Map<string, Date>();
  const recovery = new Map<string, Map<string, Date | null>>(), requests: { h: string; at: Date }[] = [];
  const auditRows: { firmId: string; actor: string; action: string; detail?: string }[] = [], slugs = new Map<string, string>(), fails: { u: string; at: Date }[] = [], keys = new Map<string, { at: Date; response: unknown }>();
  const copy = <T>(v: T | undefined): T | null => (v ? { ...v } : null);
  return {
    auditRows,
    async userByEmail(email) { const e = lower(email); return copy([...users.values()].find((u) => u.email === e)); },
    async userById(id) { return copy(users.get(id)); },
    async usersOfFirm(firmId) { return [...users.values()].filter((u) => u.firmId === firmId).map((u) => ({ ...u })); },
    async createUser(u) {
      const email = lower(u.email); if ([...users.values()].some((x) => x.email === email)) throw new Error("That email address already has an account");
      users.set(u.id, { ...u, email, mfaSecret: null, mfaPending: null, totpStep: null, leftAt: null, lockedUntil: null, morningOff: false, urgentOff: false, supportUntil: null });
    },
    async setRole(id, role) { const u = users.get(id); if (u) u.role = role; },
    async removeUser(id) { users.delete(id); recovery.delete(id); for (const [h, s] of sessions) if (s.userId === id) sessions.delete(h); },
    async deactivateUser(id, at) { const u = users.get(id); if (!u) return; Object.assign(u, { leftAt: at, mfaSecret: null, mfaPending: null, totpStep: null, lockedUntil: null }); recovery.delete(id); for (const [h, s] of sessions) if (s.userId === id) sessions.delete(h); },
    async reactivateUser(id, o) { const u = users.get(id); if (u) Object.assign(u, { leftAt: null, role: o.role, name: o.name }); },
    async setNotes(id, o) { const u = users.get(id); if (u) Object.assign(u, { morningOff: !!o.morningOff, urgentOff: !!o.urgentOff }); },
    async setSupport(id, until) { const u = users.get(id); if (u) u.supportUntil = until; },
    async supportDue(now) { return [...users.values()].filter((u) => !u.leftAt && u.supportUntil && u.supportUntil <= now).map((u) => ({ ...u })); },
    async noteFail(userId, at) { fails.push({ u: userId, at }); },
    async failsSince(userId, since) { return fails.filter((f) => f.u === userId && f.at >= since).length; },
    async lock(userId, until) { const u = users.get(userId); if (u) u.lockedUntil = until; for (let i = fails.length - 1; i >= 0; i--) if (fails[i]!.u === userId) fails.splice(i, 1); },
    async setMfaPending(id, sealed) { const u = users.get(id); if (u) u.mfaPending = sealed; },
    async confirmMfa(id, sealed, step) { const u = users.get(id); if (u) { u.mfaSecret = sealed; u.mfaPending = null; u.totpStep = step; } },
    async advanceTotp(id, step) { const u = users.get(id); if (!u || (u.totpStep != null && step <= u.totpStep)) return false; u.totpStep = step; return true; },
    async putRecovery(userId, hashes) { recovery.set(userId, new Map(hashes.map((h) => [h, null]))); },
    async useRecovery(userId, hash, now) { const m = recovery.get(userId); if (!m || !m.has(hash) || m.get(hash)) return false; m.set(hash, now); return true; },
    async recoveryLeft(userId) { return [...(recovery.get(userId)?.values() || [])].filter((v) => !v).length; },
    async claimLink(jti, expiresAt) { if (links.has(jti)) return false; links.set(jti, expiresAt); return true; },
    async noteLinkRequest(h, at) { requests.push({ h, at }); },
    async linkRequestsSince(h, since) { return requests.filter((r) => r.h === h && r.at >= since).length; },
    async createSession(s) { sessions.set(s.hash, { ...s }); },
    async session(hash) { return copy(sessions.get(hash)); },
    async updateSession(hash, patch) { const s = sessions.get(hash); if (s) Object.assign(s, patch); },
    async failSession(hash) { const s = sessions.get(hash); if (!s) return 0; s.fails++; return s.fails; },
    async deleteSession(hash) { sessions.delete(hash); },
    async deleteSessionsOf(userId, except) { for (const [h, s] of sessions) if (s.userId === userId && h !== except) sessions.delete(h); },
    async audit(firmId, actor, action, detail) { auditRows.push({ firmId, actor, action, detail }); },
    async setFirmSlug(firmId, slug) { if (slugs.has(slug) && slugs.get(slug) !== firmId) return false; slugs.set(slug, firmId); return true; },
    async firmIdBySlug(slug) { return slugs.get(slug) || null; },
    async activeFirmIds() { return firmIds(); },
    async claimKey(firmId, key, at) { const k = firmId + "\n" + key, was = keys.get(k); if (was) return { fresh: false, response: was.response }; keys.set(k, { at, response: null }); return { fresh: true }; },
    async finishKey(firmId, key, response) { const r = keys.get(firmId + "\n" + key); if (r) r.response = JSON.parse(JSON.stringify(response)); },
    async sweep(now) {
      for (const [h, s] of sessions) if (s.expiresAt <= now) sessions.delete(h);
      for (const [j, x] of links) if (x <= now) links.delete(j);
      const cut = now.getTime() - 86400000; for (let i = requests.length - 1; i >= 0; i--) if (requests[i]!.at.getTime() < cut) requests.splice(i, 1);
      for (let i = fails.length - 1; i >= 0; i--) if (fails[i]!.at.getTime() < cut) fails.splice(i, 1);
      for (const [k, r] of keys) if (r.at.getTime() < cut) keys.delete(k);
    }
  };
}

interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }

export function postgresAuthStore(pool: Db): AuthStore {
  const one = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0] || null;
  const buf = (v: unknown) => (v ? Buffer.from(v as Buffer) : null);
  const toUser = (r: Record<string, unknown> | null): User | null => r && {
    id: r.id as string, firmId: r.firm_id as string, email: r.email as string, role: r.role as Role, name: (r.name as string) || "",
    mfaSecret: buf(r.mfa_secret), mfaPending: buf(r.mfa_pending), totpStep: r.totp_step == null ? null : Number(r.totp_step),
    leftAt: (r.left_at as Date) || null, lockedUntil: (r.locked_until as Date) || null, morningOff: !!r.morning_off, urgentOff: !!r.urgent_off, supportUntil: (r.support_until as Date) || null
  };
  const toSession = (r: Record<string, unknown> | null): Session | null => r && {
    hash: Buffer.from(r.token_hash as Buffer).toString("hex"), userId: r.user_id as string, stage: r.stage as "link" | "full",
    createdAt: r.created_at as Date, expiresAt: r.expires_at as Date, fails: Number(r.fails)
  };
  const H = (hash: string) => Buffer.from(hash, "hex");
  return {
    async userByEmail(email) { return toUser(await one("select * from users where email = $1", [lower(email)])); },
    async userById(id) { return toUser(await one("select * from users where id = $1", [id])); },
    async usersOfFirm(firmId) { return (await pool.query("select * from users where firm_id = $1 order by created_at, id", [firmId])).rows.map((r) => toUser(r)!); },
    async createUser(u) {
      try { await pool.query("insert into users (id, firm_id, email, role, name) values ($1, $2, $3, $4, $5)", [u.id, u.firmId, lower(u.email), u.role, u.name]); }
      catch (err) { if ((err as { code?: string }).code === "23505") throw new Error("That email address already has an account", { cause: err }); throw err; }
    },
    async setRole(id, role) { await pool.query("update users set role = $2 where id = $1", [id, role]); },
    async removeUser(id) { await pool.query("delete from users where id = $1", [id]); },
    async deactivateUser(id, at) {
      await pool.query("update users set left_at = $2, mfa_secret = null, mfa_pending = null, totp_step = null, locked_until = null where id = $1", [id, at]);
      await pool.query("delete from sessions where user_id = $1", [id]); await pool.query("delete from recovery_codes where user_id = $1", [id]); await pool.query("delete from signin_fails where user_id = $1", [id]);
    },
    async reactivateUser(id, o) { await pool.query("update users set left_at = null, role = $2, name = $3 where id = $1", [id, o.role, o.name]); },
    async setSupport(id, until) { await pool.query("update users set support_until = $2 where id = $1", [id, until]); },
    async supportDue(now) { return (await pool.query("select * from users where left_at is null and support_until is not null and support_until <= $1", [now])).rows.map((r) => toUser(r)!); },
    async setNotes(id, o) { await pool.query("update users set morning_off = $2, urgent_off = $3 where id = $1", [id, !!o.morningOff, !!o.urgentOff]); },
    async noteFail(userId, at) { await pool.query("insert into signin_fails (user_id, at) values ($1, $2)", [userId, at]); },
    async failsSince(userId, since) { return Number((await one("select count(*)::int as n from signin_fails where user_id = $1 and at >= $2", [userId, since]))!.n); },
    async lock(userId, until) { await pool.query("update users set locked_until = $2 where id = $1", [userId, until]); await pool.query("delete from signin_fails where user_id = $1", [userId]); },
    async setMfaPending(id, sealed) { await pool.query("update users set mfa_pending = $2 where id = $1", [id, sealed]); },
    async confirmMfa(id, sealed, step) { await pool.query("update users set mfa_secret = $2, mfa_pending = null, totp_step = $3 where id = $1", [id, sealed, step]); },
    async advanceTotp(id, step) { return ((await pool.query("update users set totp_step = $2 where id = $1 and (totp_step is null or totp_step < $2)", [id, step])).rowCount || 0) > 0; },
    async putRecovery(userId, hashes) {
      await pool.query("delete from recovery_codes where user_id = $1", [userId]);
      for (const h of hashes) await pool.query("insert into recovery_codes (user_id, hash) values ($1, $2)", [userId, h]);
    },
    async useRecovery(userId, hash, now) { return ((await pool.query("update recovery_codes set used_at = $3 where user_id = $1 and hash = $2 and used_at is null", [userId, hash, now])).rowCount || 0) > 0; },
    async recoveryLeft(userId) { return Number((await one("select count(*)::int as n from recovery_codes where user_id = $1 and used_at is null", [userId]))!.n); },
    async claimLink(jti, expiresAt) { return ((await pool.query("insert into signin_links (jti, expires_at) values ($1, $2) on conflict do nothing", [jti, expiresAt])).rowCount || 0) > 0; },
    async noteLinkRequest(h, at) { await pool.query("insert into signin_requests (email_hash, at) values ($1, $2)", [h, at]); },
    async linkRequestsSince(h, since) { return Number((await one("select count(*)::int as n from signin_requests where email_hash = $1 and at >= $2", [h, since]))!.n); },
    async createSession(s) { await pool.query("insert into sessions (token_hash, user_id, created_at, expires_at, stage, fails) values ($1, $2, $3, $4, $5, $6)", [H(s.hash), s.userId, s.createdAt, s.expiresAt, s.stage, s.fails]); },
    async session(hash) { return toSession(await one("select * from sessions where token_hash = $1", [H(hash)])); },
    async updateSession(hash, patch) { await pool.query("update sessions set stage = coalesce($2, stage), expires_at = coalesce($3, expires_at) where token_hash = $1", [H(hash), patch.stage || null, patch.expiresAt || null]); },
    async failSession(hash) { const r = await one("update sessions set fails = fails + 1 where token_hash = $1 returning fails", [H(hash)]); return r ? Number(r.fails) : 0; },
    async deleteSession(hash) { await pool.query("delete from sessions where token_hash = $1", [H(hash)]); },
    async deleteSessionsOf(userId, except) { await pool.query("delete from sessions where user_id = $1 and ($2::bytea is null or token_hash <> $2)", [userId, except ? H(except) : null]); },
    async audit(firmId, actor, action, detail) { await pool.query("insert into audit_log (firm_id, actor, action, detail) values ($1, $2, $3, $4)", [firmId, actor, action, detail || null]); },
    async setFirmSlug(firmId, slug) { try { return ((await pool.query("update firms set slug = $2 where id = $1", [firmId, slug])).rowCount || 0) > 0; } catch (err) { if ((err as { code?: string }).code === "23505") return false; throw err; } },
    async firmIdBySlug(slug) { const r = await one("select id from firms where slug = $1 and status = 'active'", [slug]); return r ? (r.id as string) : null; },
    async activeFirmIds() { return (await pool.query("select f.id from firms f join firm_state s on s.firm_id = f.id where f.status = 'active' order by f.id")).rows.map((r) => r.id as string); },
    async claimKey(firmId, key, at) {
      if (((await pool.query("insert into request_keys (firm_id, key, at) values ($1, $2, $3) on conflict do nothing", [firmId, key, at])).rowCount || 0) > 0) return { fresh: true };
      const r = await one("select response from request_keys where firm_id = $1 and key = $2", [firmId, key]); return { fresh: false, response: r ? r.response : null };
    },
    async finishKey(firmId, key, response) { await pool.query("update request_keys set response = $3::jsonb where firm_id = $1 and key = $2", [firmId, key, JSON.stringify(response)]); },
    async sweep(now) {
      await pool.query("delete from request_keys where at < $1", [new Date(now.getTime() - 86400000)]);
      await pool.query("delete from sessions where expires_at <= $1", [now]);
      await pool.query("delete from signin_links where expires_at <= $1", [now]);
      await pool.query("delete from signin_requests where at < $1", [new Date(now.getTime() - 86400000)]);
      await pool.query("delete from signin_fails where at < $1", [new Date(now.getTime() - 86400000)]);
    }
  };
}
