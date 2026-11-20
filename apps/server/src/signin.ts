// Staff sign-in, on top of packages/core/auth.js: an emailed link, then a six-digit code from an authenticator app.
// No passwords. The second factor is not optional (docs/SECURITY.md). Every sign-in and every failure is in the audit log.
import { createHash } from "node:crypto";
import { kitAuth } from "./kit.ts";
import type { AuthStore, Session, User } from "./authstore.ts";

export const IDLE_HOURS = 2;           // a session ends after this long without a request (decided November 19: survives lunch, not the night)
export const MAX_HOURS = 12;           // and after this long whatever happens
export const PRE_MINUTES = 15;         // time allowed between opening the link and entering the code
export const MAX_CODE_FAILS = 5;       // wrong codes before the half-open session is thrown away
export const LINKS_PER_HOUR = 5;       // emailed links per address
export const LOCK_FAILS = 5;           // wrong codes, across every attempt, inside LOCK_MINUTES
export const LOCK_MINUTES = 15;        // then sign-in is locked for the same length of time and the person is emailed

export interface Secrets { seal(firmId: string, plain: Buffer, label: string): Promise<Buffer>; open(firmId: string, sealed: Buffer, label: string): Promise<Buffer> }
export interface Mailer { signInLink(to: string, url: string): Promise<void>; locked(to: string, minutes: number): Promise<void> }
export interface SignInDeps { auth: AuthStore; secrets: Secrets; mailer: Mailer; linkSecret: string; appUrl: string; clock: () => Date; issuer?: string }

export class SignInError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const bad = (code: string, message: string, status = 400) => new SignInError(status, code, message);
const emailHash = (e: string) => createHash("sha256").update(e).digest("hex");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

export function createSignIn(d: SignInDeps) {
  const { auth, secrets, clock } = d, issuer = d.issuer || "Tallyhound";
  const label = (u: User) => "mfa:" + u.id, isLocked = (u: User) => !!u.lockedUntil && u.lockedUntil > clock();

  async function open(u: User, hash: string): Promise<Session> {
    const now = clock(), s: Session = { hash, userId: u.id, stage: "link", createdAt: now, expiresAt: new Date(now.getTime() + PRE_MINUTES * 60000), fails: 0 };
    await auth.createSession(s); return s;
  }
  const over = (u: User) => !!u.supportUntil && u.supportUntil <= clock();
  async function complete(u: User, s: Session, how: string) {
    await auth.updateSession(s.hash, { stage: "full", expiresAt: new Date(clock().getTime() + IDLE_HOURS * 3600000) });
    await auth.audit(u.firmId, u.id, "signin", how);
  }
  // A wrong code. After a handful the half-open session is dropped and the person starts again from a new link.
  async function wrong(u: User, s: Session, what: string): Promise<never> {
    const n = await auth.failSession(s.hash), now = clock(); await auth.audit(u.firmId, u.id, "signin.failed", what); await auth.noteFail(u.id, now);
    // Counted per person, not per attempt: asking for a fresh link does not buy more guesses.
    if (await auth.failsSince(u.id, new Date(now.getTime() - LOCK_MINUTES * 60000)) >= LOCK_FAILS) {
      await auth.lock(u.id, new Date(now.getTime() + LOCK_MINUTES * 60000)); await auth.deleteSession(s.hash); await auth.audit(u.firmId, u.id, "signin.locked", LOCK_MINUTES + " minutes");
      try { await d.mailer.locked(u.email, LOCK_MINUTES); } catch { /* the lock stands whether or not the email goes */ }
      throw bad("locked", "Too many wrong codes. Sign-in is locked for " + LOCK_MINUTES + " minutes, and we have emailed you.", 423);
    }
    if (n >= MAX_CODE_FAILS) { await auth.deleteSession(s.hash); throw bad("too_many", "Too many wrong codes. Ask for a new sign-in link.", 401); }
    throw bad("wrong_code", "That code is not right. Check the app and try again.");
  }

  return {
    // Step 1. Always answers the same way, so the form cannot be used to find out who has an account.
    async requestLink(emailRaw: string): Promise<void> {
      const email = String(emailRaw || "").trim().toLowerCase(); if (!validEmail(email)) throw bad("email", "Enter your work email address.");
      const now = clock(), h = emailHash(email);
      if (await auth.linkRequestsSince(h, new Date(now.getTime() - 3600000)) >= LINKS_PER_HOUR) return;
      await auth.noteLinkRequest(h, now);
      const u = await auth.userByEmail(email); if (!u || u.leftAt || over(u) || isLocked(u)) return;
      await d.mailer.signInLink(email, d.appUrl.replace(/\/$/, "") + "/signin/open#t=" + kitAuth.issueLink(d.linkSecret, email, now));
    },
    // Step 2. The link is opened. It works once. The answer says what the browser should ask for next.
    async openLink(token: string): Promise<{ sessionToken: string; expiresAt: Date; next: "setup" | "code" }> {
      const now = clock(), r = kitAuth.checkLink(d.linkSecret, token, now);
      if (!r.ok) throw bad("link_" + r.why, r.why === "expired" ? "That link has expired. Ask for a new one." : "That link is not valid. Ask for a new one.", 401);
      const u = await auth.userByEmail(r.email); if (!u || u.leftAt || over(u)) throw bad("link_invalid", "That link is not valid. Ask for a new one.", 401);
      if (isLocked(u)) throw bad("locked", "Sign-in is locked after too many wrong codes. Try again in " + Math.max(1, Math.ceil((u.lockedUntil!.getTime() - now.getTime()) / 60000)) + " minutes.", 423);
      if (!(await auth.claimLink(r.jti, new Date(now.getTime() + kitAuth.LINK_MIN * 60000 * 2)))) throw bad("link_used", "That link has already been used. Ask for a new one.", 401);
      const t = kitAuth.newSession(now), s = await open(u, t.hash);
      return { sessionToken: t.token, expiresAt: s.expiresAt, next: u.mfaSecret ? "code" : "setup" };
    },
    // Step 3a, first sign-in only: show a secret for the authenticator app. Asking again shows the same one until it is confirmed.
    async setupStart(u: User, s: Session): Promise<{ secret: string; uri: string }> {
      if (s.stage !== "link" || u.mfaSecret) throw bad("not_allowed", "Two-step sign-in is already set up.", 403);
      let raw: Buffer;
      if (u.mfaPending) raw = await secrets.open(u.firmId, u.mfaPending, label(u));
      else { raw = kitAuth.totpSecret().raw; await auth.setMfaPending(u.id, await secrets.seal(u.firmId, raw, label(u))); }
      const text = kitAuth.base32(raw); return { secret: text, uri: kitAuth.setupUri(issuer, u.email, text) };
    },
    // Step 3b: the first code proves the app is set up. Recovery codes are shown now and never again.
    async setupFinish(u: User, s: Session, code: string): Promise<{ recoveryCodes: string[] }> {
      if (s.stage !== "link" || u.mfaSecret || !u.mfaPending) throw bad("not_allowed", "Start two-step setup first.", 403);
      const raw = await secrets.open(u.firmId, u.mfaPending, label(u)), v = kitAuth.verifyTotp(raw, code, clock(), null);
      if (!v.ok) return wrong(u, s, "setup code");
      await auth.confirmMfa(u.id, u.mfaPending, v.step);
      const rc = kitAuth.recoveryCodes(); await auth.putRecovery(u.id, rc.hashes);
      await auth.audit(u.firmId, u.id, "mfa.setup"); await complete(u, s, "link and first code");
      return { recoveryCodes: rc.codes };
    },
    // Step 3, every later sign-in.
    async code(u: User, s: Session, code: string): Promise<void> {
      if (s.stage !== "link" || !u.mfaSecret) throw bad("not_allowed", "Open a sign-in link first.", 403);
      const raw = await secrets.open(u.firmId, u.mfaSecret, label(u)), v = kitAuth.verifyTotp(raw, code, clock(), u.totpStep);
      if (!v.ok || !(await auth.advanceTotp(u.id, v.step))) return wrong(u, s, "code");
      await complete(u, s, "link and code");
    },
    // Lost phone: one of the ten codes from setup. Each works once.
    async recovery(u: User, s: Session, code: string): Promise<{ left: number }> {
      if (s.stage !== "link" || !u.mfaSecret) throw bad("not_allowed", "Open a sign-in link first.", 403);
      const c = String(code || "").trim().toLowerCase().replace(/\s/g, "");
      if (!(await auth.useRecovery(u.id, kitAuth.hashToken(c), clock()))) return wrong(u, s, "recovery code");
      await complete(u, s, "link and recovery code"); const left = await auth.recoveryLeft(u.id);
      await auth.audit(u.firmId, u.id, "mfa.recovery_used", left + " left"); return { left };
    },
    // Every request: who is this? Null when there is no session, it has run out, or the account is gone.
    async whoIs(sessionToken: string | undefined): Promise<{ user: User; session: Session } | null> {
      if (!sessionToken) return null;
      const hash = kitAuth.hashToken(sessionToken), s = await auth.session(hash), now = clock(); if (!s) return null;
      if (s.expiresAt <= now || now.getTime() - s.createdAt.getTime() > MAX_HOURS * 3600000) { await auth.deleteSession(hash); return null; }
      const user = await auth.userById(s.userId); if (!user || user.leftAt) return null;
      if (over(user)) { await auth.deleteSession(hash); return null; }   // T-107: support access ends on the minute, open tab or not
      // Slide the idle timeout, at most once every few minutes so a busy page is not one write per request.
      const fresh = new Date(now.getTime() + IDLE_HOURS * 3600000);
      if (s.stage === "full" && fresh.getTime() - s.expiresAt.getTime() > 5 * 60000) { await auth.updateSession(hash, { expiresAt: fresh }); s.expiresAt = fresh; }
      return { user, session: s };
    },
    async signOut(sessionToken: string | undefined): Promise<void> { if (sessionToken) await auth.deleteSession(kitAuth.hashToken(sessionToken)); }
  };
}
export type SignIn = ReturnType<typeof createSignIn>;

// The second-factor secret is sealed with the firm's own data key, the same key that seals its clients. No firm key, no sign-in.
export function firmSecrets(store: { inner?: { getKey(firmId: string): Promise<Buffer | null> } }, keyring: { unwrap(w: Buffer, label: string): Promise<Buffer> }, crypto: { seal(k: Buffer, p: Buffer, aad?: string): Buffer; open(k: Buffer, s: Buffer, aad?: string): Buffer }): Secrets {
  const key = async (firmId: string) => { const w = store.inner && (await store.inner.getKey(firmId)); if (!w) throw new Error("No key for firm " + firmId); return keyring.unwrap(w, firmId); };
  return {
    async seal(firmId, plain, label) { return crypto.seal(await key(firmId), plain, label); },
    async open(firmId, sealed, label) { return crypto.open(await key(firmId), sealed, label); }
  };
}
