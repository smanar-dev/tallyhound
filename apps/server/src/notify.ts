// Email to the firm's own staff (T-26): a 7 am note on working days of what is waiting for them, and a note at once when something
// urgent comes up. These emails carry a first name and a last initial, never a document, a message or a reason: a forwarded one
// reveals nothing. What to send is decided and marked while the firm is locked, and sent after the save, so nothing goes twice.
import type { Engine } from "./kit.ts";
import type { User } from "./authstore.ts";
import { needsYou } from "./needs.ts";

export const DIGEST_HOUR = 7;      // firm time
export const DIGEST_UNTIL = 12;    // a timer that was down at 7 still sends, but not after midday
export interface StaffMail { to: string; kind: "digest" | "urgent"; subject: string; body: string }
export interface StaffMailer { staff(to: string, subject: string, body: string): Promise<void> }

/* eslint-disable @typescript-eslint/no-explicit-any */
const short = (c: any) => (String(c.first || "").trim() + " " + (String(c.last || "").trim()[0] || "")).trim() + (String(c.last || "").trim() ? "." : "");
const dayKey = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const firstName = (u: User) => u.name.split(" ")[0] || "there";
const list = (names: string[]) => { const n = [...new Set(names)]; return n.slice(0, 25).map((x) => "  " + x).join("\n") + (n.length > 25 ? "\n  and " + (n.length - 25) + " more" : ""); };

export function createNotifier({ appUrl }: { appUrl: string }) {
  const url = appUrl.replace(/\/$/, "");
  const mine = (u: User, c: any) => u.role === "owner" || (c && c.preparer === u.id);
  return {
    /** Call with the firm locked, after tick(). Marks what it returns as sent. */
    collect(T: Engine, people: User[]): StaffMail[] {
      const S = T.S, now: Date = new Date(S.now), out: StaffMail[] = [], staff = people.filter((u) => !u.leftAt && u.role !== "read_only"); if (!staff.length || !T.access().ok) return out;
      // At once: anything the engine marked high in the last day that nobody has been emailed about.
      const fresh = S.alerts.filter((a: any) => a.level === "high" && !a.mailed && !a.read && +now - +new Date(a.at) < 86400000);
      if (fresh.length) {
        const per = new Map<string, { u: User; names: string[]; cid: string | null }>();
        for (const a of fresh) {
          a.mailed = true; const e = a.engId ? T.eng(a.engId) : null, c = e ? T.client(e.clientId) : null;
          const to = c && staff.some((u) => u.id === c.preparer) ? staff.filter((u) => u.id === c.preparer) : staff.filter((u) => u.role === "owner");
          for (const u of to) { const p = per.get(u.id) || { u, names: [], cid: null }; p.names.push(c ? short(c) : "Your firm's account"); p.cid = c ? c.id : p.cid; per.set(u.id, p); }
        }
        for (const p of per.values()) {
          const names = [...new Set(p.names)], one = names.length === 1;
          out.push({ to: p.u.email, kind: "urgent", subject: (one ? names[0] + " needs" : names.length + " clients need") + " you in Tallyhound", body: "Hi " + firstName(p.u) + ",\n\n" + (one ? names[0] + " needs a person now." : "These need a person now:\n" + list(names)) + "\n\n" + url + (one && p.cid ? "/clients/" + p.cid : "/needs-you") + "\n\nThe details are left out of this email on purpose. Sign in to see them.\n\n" + S.firm.name + ", by Tallyhound" });
        }
      }
      // Once each working morning.
      const today = dayKey(now), h = now.getHours(), working = now.getDay() >= 1 && now.getDay() <= 5 && T.allowed(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12));
      if (working && h >= DIGEST_HOUR && h < DIGEST_UNTIL && S.firm.digestDay !== today) {
        const since = S.firm.digestAt ? +new Date(S.firm.digestAt) : +now - 86400000; S.firm.digestDay = today; S.firm.digestAt = new Date(now);
        const needs = needsYou(T), done = S.engs.filter((e: any) => e.status === "complete" && e.completedAt && +new Date(e.completedAt) > since).map((e: any) => T.client(e.clientId)).filter(Boolean);
        for (const u of staff) {
          const wait = needs.filter((n) => mine(u, n.c)), quiet = wait.filter((n) => n.stuck && n.stuck !== "opted_out"), rest = wait.filter((n) => !quiet.includes(n)), fin = done.filter((c: any) => mine(u, c)); if (!wait.length && !fin.length) continue;
          const parts = ["Good morning, " + firstName(u) + "."];
          if (rest.length) parts.push("Waiting for you (" + new Set(rest.map((n) => n.c.id)).size + ")\n" + list(rest.map((n) => short(n.c))));
          if (quiet.length) parts.push("Gone quiet (" + new Set(quiet.map((n) => n.c.id)).size + ")\n" + list(quiet.map((n) => short(n.c))));
          if (fin.length) parts.push("Complete since the last note (" + fin.length + ")\n" + list(fin.map(short)));
          parts.push("Open Tallyhound: " + url + (wait.length ? "/needs-you" : "/"), "No documents or details are ever sent by email.\n\n" + S.firm.name + ", by Tallyhound");
          const n = new Set(wait.map((x) => x.c.id)).size;
          out.push({ to: u.email, kind: "digest", subject: n ? n + (n === 1 ? " client is" : " clients are") + " waiting for you" : fin.length + (fin.length === 1 ? " client is" : " clients are") + " complete", body: parts.join("\n\n") });
        }
      }
      return out;
    }
  };
}
export type Notifier = ReturnType<typeof createNotifier>;
