// The build kit is plain JavaScript and stays that way (CLAUDE.md: do not rewrite the engine). This file is the one place
// new TypeScript code reaches into it, with just enough typing to catch a wrong call.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export type Role = "owner" | "staff" | "read_only";
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Engine = any;   // the rules engine: ~160 functions plus S, its state. Typed loosely on purpose.

export interface KitStore {
  inner?: any;
  create(id: string, json: string, where: { number?: string; inbox?: string; name?: string }): Promise<void>;
  firmIdByNumber(n: string): Promise<string | null>;
  setNumber(id: string, number: string | null): Promise<void>;
  firmIdByInbox(a: string): Promise<string | null>;
  lock(id: string, fn: (json: string | null) => Promise<string>): Promise<void>;
  readState(id: string): Promise<string | null>;
  putFile(firmId: string, bytes: Buffer, contentType: string): Promise<string>;
  getFile(firmId: string, key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  deleteFile(firmId: string, key: string): Promise<void>;
  getKey?(firmId: string): Promise<Buffer | null>;
  putKey?(firmId: string, wrapped: Buffer | null): Promise<void>;
  destroyFirm?(firmId: string): Promise<void>;
}
export interface Sender { send(m: { from: string; to: string; subject?: string; body: string; idempotencyKey?: string; fromName?: string }): Promise<string> }
export interface Keyring { newDataKey(label: string): Promise<{ plain: Buffer; wrapped: Buffer }>; unwrap(wrapped: Buffer, label: string): Promise<Buffer> }
export interface App {
  withFirm<R>(firmId: string, fn: (T: Engine) => R | Promise<R>): Promise<R>;
  staff<R>(firmId: string, userId: string, fn: (T: Engine) => R | Promise<R>): Promise<R>;
  tick(firmId: string): Promise<boolean>;
  createFirm(firmId: string, opt: Record<string, unknown>): Promise<string>;
  rollSeason(firmId: string, userId: string, year: number): Promise<unknown>;
  inboundSms(m: Record<string, unknown>): Promise<any>;
  inboundEmail(m: Record<string, unknown>): Promise<any>;
  readHeld(firmId: string): Promise<number>;
  checkinAnswers(firmId: string, clientId: string, answers: Record<string, unknown>): Promise<unknown>;
  clientUpload(m: { firmId: string; clientId: string; files: { bytes: Buffer; contentType?: string }[]; providerId?: string }): Promise<{ handled: boolean; duplicate?: boolean; held?: boolean; docs?: string[]; unusable?: string }>;
  staffUpload(firmId: string, userId: string, clientId: string, file: { bytes: Buffer; contentType?: string }): Promise<{ error?: string; docs?: (string | null)[] }>;
  openFile(firmId: string, userId: string, docId: string): Promise<{ bytes: Buffer; contentType: string } | null>;
}

export const { createEngine } = require("../../../packages/engine") as { createEngine(): Engine };
export const { wallTime } = require("../../../packages/core/pipeline.js") as { wallTime(date: Date, iana: string): Date };
export const kitRegistration = require("../../../packages/core/registration.js") as { firmPage(firm: { name: string; phone?: string }, opt?: { number?: string; address?: string }): string; brand(firm: unknown, reg: unknown): unknown; campaign(firm: unknown, reg: unknown): unknown; headsUp(firm: { name: string }, opt?: { number?: string; address?: string }): { subject: string; email: string; letter: string; website: string; voicemail: string } };
export const { createApp } = require("../../../packages/core/pipeline.js") as {
  createApp(deps: { store: KitStore; sms: Sender; email: Sender; ai: unknown; clock?: () => Date; log?: (event: string, ...ids: unknown[]) => void; files?: unknown }): App;
};
export const kitAuth = require("../../../packages/core/auth.js") as {
  issueLink(secret: string, email: string, now: Date | number): string;
  checkLink(secret: string, token: string, now: Date | number): { ok: true; email: string; jti: string } | { ok: false; why: string };
  totpSecret(): { raw: Buffer; text: string };
  totp(raw: Buffer, now: Date | number): string;
  verifyTotp(raw: Buffer, code: string, now: Date | number, lastStep: number | null): { ok: true; step: number } | { ok: false };
  setupUri(issuer: string, email: string, secretText: string): string;
  base32(buf: Buffer): string;
  recoveryCodes(): { codes: string[]; hashes: string[] };
  hashToken(t: string): string;
  newSession(now: Date | number, hours?: number): { token: string; hash: string; expiresAt: Date };
  LINK_MIN: number;
};
export const kitCrypto = require("../../../packages/core/crypto.js") as {
  seal(key: Buffer, plain: Buffer, aad?: string): Buffer;
  open(key: Buffer, sealed: Buffer, aad?: string): Buffer;
  localKeyring(masterKey: Buffer | string): Keyring;
  encryptedStore(inner: any, keyring: Keyring): KitStore;
};
export const kitMemory = require("../../../packages/core/memory.js") as {
  memoryStore(): any; fakeSender(): Sender & { sent: any[] }; fakeAI(fn: (p: string, o: unknown) => unknown): any; memoryFiles(): any;
};
export const kitPostgres = require("../../../packages/adapters/postgres.js") as { postgresStore(pool: unknown, bucket: unknown): any; memoryBucket(): any };
export interface TwilioAdapter extends Sender { inbound(p: Record<string, string>, opt?: { keep?: boolean }): Promise<{ to: string; from: string; body: string; media: { bytes: Buffer; contentType: string }[]; providerId: string | null }>; forget(p: Record<string, string>): Promise<number> }
export const kitTwilio = require("../../../packages/adapters/twilio.js") as { twilio(o: Record<string, unknown>): TwilioAdapter; verifySignature(t: string, url: string, p: Record<string, string>, sig: string): boolean; voiceForward(n: string): string };
export const kitEmailOut = require("../../../packages/adapters/email-out.js") as { postmark(o: Record<string, unknown>): Sender; bounceEvent(j: unknown): any };
export interface PrepareOpts { heic?: (b: Buffer) => Promise<Buffer>; image?: (b: Buffer) => Promise<{ bytes?: Buffer; width: number; height: number; mean?: number; sharp?: number }>; scan?: (b: Buffer) => Promise<{ clean: boolean; name?: string }> }
export const kitPrepare = require("../../../packages/adapters/prepare.js") as { prepare(file: { bytes: Buffer; contentType?: string; name?: string; inline?: boolean }, opt?: PrepareOpts): Promise<any>; sniff(b: Buffer): string };
export const kitEmailIn = require("../../../packages/adapters/email-inbound.js") as { fromPostmark(j: unknown): { to: string; from: string; body: string; providerId: string | null; trusted: boolean; forwarded?: unknown; attachments: any[] } };
