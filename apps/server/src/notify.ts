// Email to the firm's own staff (T-26): a 7 am note on working days of what is waiting for them, and a note at once when something
// urgent comes up. These emails carry a first name and a last initial, never a document, a message or a reason: a forwarded one
// reveals nothing. What to send is decided and marked while the firm is locked, and sent after the save, so nothing goes twice.
import type { Engine } from "./kit.ts";
import type { User } from "./authstore.ts";
import { needsYou } from "./needs.ts";

export const DIGEST_HOUR = 7;      // firm time
export const DIGEST_UNTIL = 12;    // a timer that was down at 7 still sends, but not after midday
export interface StaffMail { to: string; kind: "digest" | "urgent" | "allowance" | "bark"; subject: string; body: string; text?: { to: string; body: string }; noEmail?: boolean }
/** TH-BRK-10: Tallyhound's own number for texting staff. Never a firm's client number. */
export interface SystemSms { number: string; send(to: string, body: string): Promise<void> }
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
          const to = (c && staff.some((u) => u.id === c.preparer) ? staff.filter((u) => u.id === c.preparer) : staff.filter((u) => u.role === "owner")).filter((u) => !u.urgentOff);   // each person's own choice (TH-NOT-4)
          for (const u of to) { const p = per.get(u.id) || { u, names: [], cid: null }; p.names.push(c ? short(c) : "Your firm's account"); p.cid = c ? c.id : p.cid; per.set(u.id, p); }
        }
        for (const p of per.values()) {
          const names = [...new Set(p.names)], one = names.length === 1;
          out.push({ to: p.u.email, kind: "urgent", subject: (one ? names[0] + " needs" : names.length + " clients need") + " you in Tallyhound", body: "Hi " + firstName(p.u) + ",\n\n" + (one ? names[0] + " needs a person now." : "These need a person now:\n" + list(names)) + "\n\n" + url + (one && p.cid ? "/clients/" + p.cid : "/needs-you") + "\n\nThe details are left out of this email on purpose. Sign in to see them.\n\n" + S.firm.name + ", by Tallyhound" });
        }
      }
      // TH-BRK: barks. The engine decides who is due one and marks it; this only words the email. Counts by kind and a link to that
      // person's part of the review queue. No client, no document. An escalation names the client by first name and last initial.
      for (const b of T.barkDue() as { id: string; userId: string; byEmail: boolean; byText: boolean; escalation: boolean; who: string | null; words: { n: number; line: string; parts: string[] } }[]) {
        const u = staff.find((x) => x.id === b.userId); if (!u) continue;
        // A text only to a number its owner has verified, and it says even less than the email: a count, and how to stop.
        const text = b.byText && u.mobile && u.mobileVerifiedAt ? { to: "+1" + u.mobile, body: (b.escalation ? "Tallyhound barked again. Something has waited more than a working day." : "Tallyhound barked. " + b.words.line) + " Open the review queue to see. Reply STOP to end these texts." } : undefined;
        if (!b.byEmail && !text) continue;
        out.push({ to: u.email, kind: "bark", text, noEmail: !b.byEmail, subject: b.escalation ? "Tallyhound barked again. " + (b.who || "Something") + " has waited more than a working day." : "Tallyhound barked. " + b.words.line,
          body: "Hi " + firstName(u) + ",\n\n" + (b.escalation ? "Something for " + (b.who || "a client") + " has waited in the review queue for more than a working day." : b.words.parts.map((x) => "  " + x).join("\n")) + "\n\nOpen the review queue: " + url + "/needs-you?mine=1&bark=" + b.id + "\n\nNo client details are sent by email.\n\n" + S.firm.name + ", by Tallyhound" });
      }
      // T-95: the plan's yearly allowance. The owners are emailed when the firm reaches 80% and 100% of it, as well as seeing it in the
      // app. It says what happens next (nothing is cut off) and carries no client's name. The timer also tells Tallyhound.
      for (const a of S.alerts.filter((x: any) => x.kind === "fair_use" && !x.mailed)) {
        a.mailed = true;
        for (const u of staff.filter((x) => x.role === "owner")) out.push({ to: u.email, kind: "allowance", subject: S.firm.name + ": " + (a.level === "medium" ? "you have used this year's allowance" : "you are close to this year's allowance"), body: "Hi " + firstName(u) + ",\n\n" + String(a.text || "") + "\n\nNothing is switched off and nothing extra is charged. If your client list has grown, the next plan gives you more room: " + url + "/settings?tab=plan\n\n" + S.firm.name + ", by Tallyhound" });
      }
      // Once each working morning.
      const today = dayKey(now), h = now.getHours(), working = now.getDay() >= 1 && now.getDay() <= 5 && T.allowed(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12));
      if (working && h >= DIGEST_HOUR && h < DIGEST_UNTIL && S.firm.digestDay !== today) {
        const since = S.firm.digestAt ? +new Date(S.firm.digestAt) : +now - 86400000; S.firm.digestDay = today; S.firm.digestAt = new Date(now);
        const needs = needsYou(T), done = S.engs.filter((e: any) => e.status === "complete" && e.completedAt && +new Date(e.completedAt) > since).map((e: any) => T.client(e.clientId)).filter(Boolean);
        for (const u of staff) {
          if (u.morningOff) continue;
          // v2: the morning overview (spec section 2) also says which letters went out since the last note and which are waiting for a click.
          const L = S.firm.letters ? S.msgs.filter((m: any) => /^L\d$/.test(m.tpl) && mine(u, T.client((T.eng(m.engId) || {}).clientId))) : [], went = L.filter((m: any) => (m.sentAt || m.status === "delivered") && +new Date(m.at) > since), drafts = L.filter((m: any) => m.status === "approval");
          const wait = needs.filter((n) => mine(u, n.c)), quiet = wait.filter((n) => n.stuck && n.stuck !== "opted_out"), rest = wait.filter((n) => !quiet.includes(n)), fin = done.filter((c: any) => mine(u, c)); if (!wait.length && !fin.length && !went.length && !drafts.length) continue;
          const held = T.barkHeld(u.id) as Record<string, number>, heldParts = Object.keys(held).map((k) => held[k] + " " + T.BARK_KINDS[k]), things = needs.filter((x) => mine(u, x.c)).length;
          const parts = ["Good morning, " + firstName(u) + ". " + (things ? things + (things === 1 ? " thing" : " things") + " in the review queue." : "Nothing in the review queue.") + " Everyone else is on track."];
          if (heldParts.length) parts.push("Since you left yesterday\n" + heldParts.map((x) => "  " + x).join("\n"));
          if (rest.length) parts.push("Waiting for you (" + new Set(rest.map((n) => n.c.id)).size + ")\n" + list(rest.map((n) => short(n.c))));
          if (quiet.length) parts.push("Gone quiet (" + new Set(quiet.map((n) => n.c.id)).size + ")\n" + list(quiet.map((n) => short(n.c))));
          if (fin.length) parts.push("All fetched since the last note (" + fin.length + ")\n" + list(fin.map(short)));
          if (went.length || drafts.length) parts.push("Letters\n" + (went.length ? "  " + went.length + (went.length === 1 ? " letter" : " letters") + " went out since the last note\n" : "") + (drafts.length ? "  " + drafts.length + (drafts.length === 1 ? " letter is" : " letters are") + " waiting for your approval" : "").replace(/\n$/, ""));
          parts.push("Open Tallyhound: " + url + (wait.length ? "/needs-you" : "/"), "No documents or details are ever sent by email.\n\n" + S.firm.name + ", by Tallyhound");

          out.push({ to: u.email, kind: "digest", subject: "Tallyhound: " + things + (things === 1 ? " thing" : " things") + " in the review queue" + (!things && fin.length ? ", " + fin.length + " all fetched" : ""), body: parts.join("\n\n") });
        }
      }
      return out;
    }
  };
}
export type Notifier = ReturnType<typeof createNotifier>;
