// What kind of line a phone number is (T-119), from Twilio Lookup's line type intelligence. A landline cannot get a text, so
// the engine never lets one be given consent (T.setLine). Each number is asked about once. An answer we cannot get is
// "unknown" and changes nothing: a lookup that is down must never stop a client from agreeing to texts.
// Not yet run against a live Twilio account: check the field names on the first real lookup.
import type { App, Engine } from "./kit.ts";

export type Line = "mobile" | "landline" | "voip" | "unknown";
export interface Lookup { lineType(mobile10: string): Promise<Line> }
export const LOOKUPS_PER_PASS = 40;

export function twilioLookup(o: { accountSid: string; authToken: string; fetch?: typeof fetch; timeoutMs?: number }): Lookup {
  const f = o.fetch || fetch, auth = "Basic " + Buffer.from(o.accountSid + ":" + o.authToken).toString("base64");
  return {
    async lineType(mobile10) {
      if (!/^[2-9]\d{9}$/.test(mobile10)) return "unknown";
      try {
        const r = await f("https://lookups.twilio.com/v2/PhoneNumbers/%2B1" + mobile10 + "?Fields=line_type_intelligence", { headers: { authorization: auth }, signal: AbortSignal.timeout(o.timeoutMs ?? 5000) });
        if (!r.ok) return "unknown";
        const t = String((((await r.json()) as { line_type_intelligence?: { type?: string } }).line_type_intelligence || {}).type || "");
        return t === "mobile" ? "mobile" : t === "landline" ? "landline" : /voip/i.test(t) ? "voip" : "unknown";
      } catch { return "unknown"; }
    }
  };
}

/** The timer's part: numbers nobody has asked about yet, a few each pass. Read first, asked with no lock held, then written. */
export async function checkLines(app: App, readState: (firmId: string) => Promise<string | null>, createEngine: () => Engine, lookup: Lookup, firmId: string): Promise<number> {
  const json = await readState(firmId); if (!json) return 0; const T0 = createEngine(); T0.load(json);
  const todo: { id: string; mobile: string }[] = T0.S.clients.filter((c: { mobile?: string; lineFor?: string }) => c.mobile && c.lineFor !== c.mobile).slice(0, LOOKUPS_PER_PASS).map((c: { id: string; mobile: string }) => ({ id: c.id, mobile: c.mobile }));
  if (!todo.length) return 0;
  const got: { id: string; mobile: string; line: Line }[] = []; for (const t of todo) got.push({ ...t, line: await lookup.lineType(t.mobile) });
  // "unknown" is written too, so a number the service cannot classify is not asked about on every pass.
  await app.withFirm(firmId, (T: Engine) => { for (const g of got) { const c = T.client(g.id); if (c && c.mobile === g.mobile) T.setLine(c.id, g.line); } return true; });
  return got.length;
}
