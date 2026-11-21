// Sending from a firm's own domain (T-110). Until a firm does this, requests come from its Tallyhound address, which works
// everywhere. With it, clients see mail from, say, documents@maplepine.com. Replies and bounces still come to Tallyhound
// (Reply-To is always the firm's Tallyhound address), so Tallyhound still never connects to the firm's mailbox.
// The owner adds three DNS records and presses Check:
//   DKIM         a TXT record: proves the mail was really sent for the domain
//   Return-Path  a CNAME: lets bounces come back to the mail service
//   DMARC        a TXT record at _dmarc: the domain's own policy. Any policy will do; none at all is why mail gets filtered.
// The first two are made and checked by the mail service (Postmark's Domains API); the third is looked up in DNS here.
// An address on the domain is used only after both of the first two have verified. Written from Postmark's API reference and
// tested against a stand-in. Not yet run against a real account.
import { resolveTxt as dnsTxt } from "node:dns/promises";
import type { App, Engine } from "./kit.ts";

export interface DomainRecord { kind: "DKIM" | "Return-Path" | "DMARC"; type: "TXT" | "CNAME"; host: string; value: string; ok: boolean }
export class DomainError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export interface DomainDeps { app: App; accountToken: string; fetch?: typeof fetch; resolveTxt?: (host: string) => Promise<string[][]>; log?: (event: string, ...ids: unknown[]) => void }
const FREE = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "aol.com", "icloud.com", "me.com", "msn.com", "proton.me", "protonmail.com", "comcast.net", "att.net", "verizon.net"];

export function createDomains(d: DomainDeps) {
  const f = d.fetch || fetch, txt = d.resolveTxt || dnsTxt, say = d.log || (() => {});
  async function pm(method: string, path: string, body?: unknown): Promise<Record<string, any>> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await f("https://api.postmarkapp.com" + path, { method, headers: { accept: "application/json", "content-type": "application/json", "x-postmark-account-token": d.accountToken }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!r.ok) { say("domain_api_failed", path.split("/")[1], r.status); throw new DomainError(r.status === 422 ? "The mail service did not accept that domain. Check the spelling, or it may already be in use by another sender." : "The mail service could not be reached. Try again in a moment.", r.status === 422 ? 400 : 502); }
    return j;
  }
  const dmarc = async (name: string) => { try { return (await txt("_dmarc." + name)).some((parts) => /^v=DMARC1/i.test(parts.join("").trim())); } catch { return false; } };
  const records = async (name: string, j: Record<string, any>): Promise<DomainRecord[]> => [   // eslint-disable-line @typescript-eslint/no-explicit-any
    { kind: "DKIM", type: "TXT", host: String(j.DKIMPendingHost || j.DKIMHost || ""), value: String(j.DKIMPendingTextValue || j.DKIMTextValue || ""), ok: !!j.DKIMVerified },
    { kind: "Return-Path", type: "CNAME", host: String(j.ReturnPathDomain || "pm-bounces." + name), value: String(j.ReturnPathDomainCNAMEValue || "pm.mtasv.net"), ok: !!j.ReturnPathDomainVerified },
    { kind: "DMARC", type: "TXT", host: "_dmarc." + name, value: "v=DMARC1; p=none;", ok: await dmarc(name) }];
  const held = (firmId: string) => d.app.withFirm(firmId, (T: Engine) => (T.S.firm.domain ? { ...T.S.firm.domain } : null)) as Promise<{ name: string; id: number; from: string; verified: boolean } | null>;
  return {
    /** What the firm has set up, with the records and whether each has been found. Null when it has no domain of its own. */
    async status(firmId: string) { const dom = await held(firmId); if (!dom) return null; const j = await pm("GET", "/domains/" + dom.id); return { name: dom.name, from: dom.from, verified: !!dom.verified, records: await records(dom.name, j) }; },
    /** The owner names the domain and the address on it. The mail service makes the records to add. Nothing is sent from it yet. */
    async start(firmId: string, userId: string, o: { name: string; local: string }) {
      const name = String(o.name || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""), local = String(o.local || "documents").trim().toLowerCase();
      if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(name)) throw new DomainError("Enter your firm's domain, like maplepine.com");
      if (FREE.includes(name) || /(^|\.)tallyhound\.com$/.test(name)) throw new DomainError("That is not a domain your firm controls. Use the one your firm's own email is on");
      if (!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(local)) throw new DomainError("The part before the @ can use letters, numbers, dots and dashes");
      if (await held(firmId)) throw new DomainError("Remove the domain you have set up before adding another");
      const j = await pm("POST", "/domains", { Name: name, ReturnPathDomain: "pm-bounces." + name }); if (!j.ID) throw new DomainError("The mail service did not set the domain up. Try again", 502);
      await d.app.staff(firmId, userId, (T: Engine) => { T.S.firm.domain = { name, id: j.ID, from: local + "@" + name, verified: false, at: new Date(T.S.now) }; T.audit("settings.domain", name + " added. Not used until its records are found"); });
      return { name, from: local + "@" + name, verified: false, records: await records(name, j) };
    },
    /** Asks the mail service to look for the records now. Once DKIM and Return-Path are both found, mail goes from the firm's own address. */
    async check(firmId: string, userId: string) {
      const dom = await held(firmId); if (!dom) throw new DomainError("There is no domain to check");
      await pm("PUT", "/domains/" + dom.id + "/verifyDkim"); const j = await pm("PUT", "/domains/" + dom.id + "/verifyReturnPath"), ok = !!j.DKIMVerified && !!j.ReturnPathDomainVerified;
      if (ok !== !!dom.verified) await d.app.staff(firmId, userId, (T: Engine) => { if (T.S.firm.domain) { T.S.firm.domain.verified = ok; T.audit("settings.domain", ok ? "Requests now come from " + T.S.firm.domain.from : dom.name + " no longer checks out. Requests come from the Tallyhound address again"); } });
      return { name: dom.name, from: dom.from, verified: ok, records: await records(dom.name, j) };
    },
    /** Back to the Tallyhound address at once; the domain is then removed at the mail service. */
    async remove(firmId: string, userId: string) {
      const dom = await held(firmId); if (!dom) return;
      await d.app.staff(firmId, userId, (T: Engine) => { T.S.firm.domain = null; T.audit("settings.domain", dom.name + " removed. Requests come from the Tallyhound address"); });
      try { await pm("DELETE", "/domains/" + dom.id); } catch { /* already stopped using it, which is what matters */ }
    }
  };
}
export type Domains = ReturnType<typeof createDomains>;
