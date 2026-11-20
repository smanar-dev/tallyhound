// Everything waiting for a person at a firm, worked out from the engine's state. A list, never a rule. The staff screens and the
// morning email both read it from here, so they can never disagree. Ported from the demo (reference/artifact/ui.js).
type Engine = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = any;
export const openTasks = (T: Engine): Row[] => T.S.tasks.filter((t: Row) => t.status === "open");

export interface Need { at: Date; c: Row; e: Row; t?: Row; stuck?: string; checkin?: boolean; suggest?: boolean; custom?: boolean }
/** Everything waiting for a person, oldest first: one list, as docs/UX.md rule 3 asks. */
export function needsYou(T: Engine): Need[] {
  const s = T.S, out: Need[] = [], open = openTasks(T);
  open.forEach((t) => { const e = T.eng(t.engId), c = e ? T.client(e.clientId) : null; if (c) out.push({ at: t.at, c, e, t }); });
  s.engs.filter((e: Row) => e.status === "stuck" && !open.some((t) => t.engId === e.id)).forEach((e: Row) => out.push({ at: e.lastOut || e.startedAt || s.now, c: T.client(e.clientId), e, stuck: e.stuck }));
  s.engs.filter((e: Row) => e.status === "opted_out").forEach((e: Row) => out.push({ at: e.lastIn || s.now, c: T.client(e.clientId), e, stuck: "opted_out" }));
  s.engs.filter((e: Row) => e.checkin && e.checkin.doneAt && !e.checkin.reviewedAt && ["not_started", "in_progress", "stuck"].includes(e.status)).forEach((e: Row) => out.push({ at: e.checkin.doneAt, c: T.client(e.clientId), e, checkin: true }));
  s.engs.filter((e: Row) => e.suggestAt && !["closed", "opted_out"].includes(e.status) && (T.recommend(e.id).add.length || (e.suggestCustom || []).length)).forEach((e: Row) => out.push({ at: e.suggestAt, c: T.client(e.clientId), e, suggest: true, custom: (e.suggestCustom || []).length > 0 }));
  return out.filter((x) => x.c).sort((a, b) => +a.at - +b.at);
}
