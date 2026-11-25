// What the mail layer tells us, however it arrives: pushed to POST /hooks/neeter, or fetched by the timer when the layer can only
// be asked (docs/neeter/RUNBOOK.md, "If Neeter cannot call us"). One function, so both paths act the same and the tests cover both.
//
// An event is acted on once, whatever the number of deliveries (the pipeline remembers each id). An event for a mailbox that is
// not connected any more, or from a sender who is not on the firm's client list, is dropped and nothing of it is kept.
import { ready } from "./files.ts";
import { kitEmailIn, type App, type PrepareOpts } from "./kit.ts";
import type { LayerEvent } from "./maillayer.ts";

export interface EventDeps { app: App; firmOfAssistant(assistantId: string): Promise<{ firmId: string; userId: string } | null>; prepare?: PrepareOpts; nudge?: (firmId: string) => void; log?: (event: string, ...ids: unknown[]) => void }
const str = (v: unknown) => (typeof v === "string" ? v : "");
export const MAX_ATTACHMENTS = 10, MAX_TEXT = 5000;

/** Returns "done" (acted on, or already acted on), "ignored" (not ours, or not a kind we act on) or "ping" (a test from the layer). */
export async function layerEvent(d: EventDeps, j: LayerEvent): Promise<"done" | "ignored" | "ping"> {
  const say = d.log || (() => {});
  if (j.type === "ping") return "ping";
  const id = str(j.id).slice(0, 80), where = id ? await d.firmOfAssistant(str(j.assistant_id)) : null; if (!id || !where) return "ignored";
  if (j.type === "bounce") { await d.app.layerBounce({ firmId: where.firmId, to: str(j.to), providerId: "ly-" + id }); say("layer_bounce", where.firmId); return "done"; }
  if (j.type !== "reply") return "ignored";
  const sent = (Array.isArray(j.attachments) ? j.attachments : []).slice(0, MAX_ATTACHMENTS);
  const files = await Promise.all(sent.filter((a) => typeof a.content_base64 === "string").map((a) => ready({ bytes: Buffer.from(a.content_base64!, "base64"), contentType: str(a.content_type), name: str(a.name).slice(0, 120) }, d.prepare || {})));
  const r = await d.app.layerReply({ firmId: where.firmId, from: str(j.from), text: kitEmailIn.stripReply(str(j.text)).slice(0, MAX_TEXT), proposed: str(j.proposed_status), attachments: files.filter((x) => !x.refused), attachmentsHeld: Math.max(0, (Number(j.attachment_count) || 0) - files.length), providerId: "ly-" + id });
  say("layer_reply", where.firmId, r && r.client ? "matched" : "unmatched"); if (d.nudge) d.nudge(where.firmId);
  return "done";
}
