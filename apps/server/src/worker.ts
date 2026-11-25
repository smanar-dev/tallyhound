// The timer. Every few minutes it calls tick() for each active firm: reminders, escalations, scheduled deletion, held sends.
// One firm failing never stops the others. Deletion runs whatever a firm's billing state is; the engine decides that, not this loop.
import type { App } from "./kit.ts";
import type { AuthStore } from "./authstore.ts";
import type { Engine } from "./kit.ts";
import type { Notifier, StaffMail, StaffMailer, SystemSms } from "./notify.ts";
import { snapshot, type FirmSnapshot, type OpsStore, type Watch } from "./ops.ts";

export interface WorkerStatus { lastPass: Date | null; firms: number; failed: number; lastError: string | null }
export function createWorker({ app, auth, clock, log, inbox, notify, mailer, ops, watch, lines, billing, cleanup, expireSupport, systemSms, reconcileHour, layerPoll, layerMaintain }: { reconcileHour?: number | null; layerPoll?: (firmId: string) => Promise<number>; layerMaintain?: (firmId: string) => Promise<void>; notify?: Notifier; mailer?: StaffMailer; ops?: OpsStore; watch?: Watch; lines?: (firmId: string) => Promise<number>; cleanup?: { sweep(force?: boolean): Promise<number> }; expireSupport?: () => Promise<number>; systemSms?: SystemSms; billing?: { check(firmId: string, b: { state: string; pausedUntil: Date | null }): Promise<void> }; app: App; auth: AuthStore; clock: () => Date; log?: (event: string, ...ids: unknown[]) => void; inbox?: { drain(): Promise<number>; sweep(): Promise<number>; counts(): Promise<{ waiting: number; dead: number }> } }) {
  const status: WorkerStatus = { lastPass: null, firms: 0, failed: 0, lastError: null }; const failedBefore = new Map<string, number>(); let deadBefore = 0, running = false, timer: NodeJS.Timeout | null = null, quick: NodeJS.Timeout | null = null;
  // TH-NTR-7: once a night each firm's copy in the mail layer is compared with Tallyhound and put right. reconcileHour is the hour
  // (server time) after which it runs; null or undefined means there is no mail layer.
  let reconciledOn = "";
  async function reconcileAll(ids: string[]): Promise<void> {
    if (reconcileHour == null) return; const now = clock(), day = now.toISOString().slice(0, 10); if (reconciledOn === day || now.getHours() < reconcileHour) return; reconciledOn = day;
    for (const id of ids) { try { if (layerMaintain) await layerMaintain(id); const r = await app.reconcile(id); if (log && r.checked) log("reconciled", id, r.checked, r.drift.length); if (watch && r.drift.length) await watch.tell("drift", id, r.drift.length + " records in the email service did not match Tallyhound overnight and were put back"); } catch (err) { if (log) log("reconcile_failed", id, (err as Error).message); } }
  }
  async function pass(): Promise<WorkerStatus> {
    if (running) return status; running = true;
    try {
      if (inbox) { await inbox.drain(); await inbox.sweep(); }   // retries that have come due, and events nobody could process past their keep-for time
      const ids = await auth.activeFirmIds(); let failed = 0;
      for (const id of ids) { try {
        // The same load and save as the tick: what to email staff is decided and marked with the firm locked, and sent after the save.
        if (layerPoll) { try { const n = await layerPoll(id); if (n && log) log("layer_polled", id, n); } catch (err) { if (log) log("layer_poll_failed", id, (err as Error).message); } }   // replies, when the layer cannot call us
        if (lines) { try { await lines(id); } catch (err) { if (log) log("lookup_failed", id, (err as Error).message); } }   // before the tick, so a landline is known before the first send
        const people = notify && mailer ? await auth.usersOfFirm(id) : []; let mails: StaffMail[] = [], snap: FirmSnapshot | null = null, bill: { state: string; pausedUntil: Date | null } | null = null;
        await app.withFirm(id, (T: Engine) => { T.tick(); mails = notify && mailer ? notify.collect(T, people) : []; snap = ops ? snapshot(T) : null; const b = T.billing(); bill = { state: b.state, pausedUntil: b.pausedUntil ? new Date(b.pausedUntil) : null }; return true; });
        if (billing && bill) { try { await billing.check(id, bill); } catch (err) { if (log) log("billing_check_failed", id, (err as Error).message); } }
        if (watch && mails.some((m) => m.kind === "allowance")) await watch.tell("allowance", id, "A firm has reached its plan's allowance. Offer the next plan");   // T-95: the internal list
        for (const m of mails) { if (m.text && systemSms) { try { await systemSms.send(m.text.to, m.text.body); if (log) log("staff_text", id, m.kind); } catch (err) { if (log) log("staff_text_failed", id, (err as Error).message); } } if (m.noEmail) continue;
          try { await mailer!.staff(m.to, m.subject, m.body); if (log) log("staff_mail", id, m.kind); } catch (err) { if (log) log("staff_mail_failed", id, m.kind, (err as Error).message); } }
        if (ops) { await ops.noteTick(id, clock(), null, snap); const f = (snap as FirmSnapshot | null)?.failed || 0; if (watch && f > (failedBefore.get(id) || 0)) await watch.tell("sends", id, f + (f === 1 ? " message" : " messages") + " failed to send for a firm today"); failedBefore.set(id, f); }
      } catch (err) {
        failed++; status.lastError = (err as Error).message; if (log) log("tick_failed", id, status.lastError);
        if (ops) await ops.noteTick(id, clock(), status.lastError, null).catch(() => {}); if (watch) await watch.tell("tick", id, "The timer could not finish a firm's turn");
      } }
      if (inbox && watch) { const dead = (await inbox.counts()).dead; if (dead > deadBefore) await watch.tell("webhook", "", (dead - deadBefore) + " arriving " + (dead - deadBefore === 1 ? "message" : "messages") + " could not be processed after every retry"); deadBefore = dead; }
      await reconcileAll(ids);
      if (expireSupport) await expireSupport().catch((err: Error) => { if (log) log("support_expire_failed", err.message); });   // T-107
      if (cleanup) await cleanup.sweep().catch((err: Error) => { if (log) log("twilio_cleanup_failed", err.message); });   // T-108
      if (ops) await ops.sweep(clock());
      await auth.sweep(clock()); Object.assign(status, { lastPass: clock(), firms: ids.length, failed });
    } catch (err) { status.lastError = (err as Error).message; if (log) log("worker_failed", status.lastError); }
    finally { running = false; }
    return status;
  }
  // A staff action may have made something due right now (pressing Start, approving a draft). Rather than leave it for the next
  // five-minute pass, that one firm gets its turn within a second. Several actions close together share one turn.
  const soonFor = new Map<string, NodeJS.Timeout>();
  function soon(firmId: string, afterMs = 400): void {
    if (soonFor.has(firmId)) return;
    const t = setTimeout(() => { soonFor.delete(firmId); void app.tick(firmId).catch((err: Error) => { if (log) log("tick_failed", firmId, err.message); }); }, afterMs); t.unref(); soonFor.set(firmId, t);
  }
  return {
    status, pass, soon, reconcileNow: async () => { reconciledOn = ""; const was = reconcileHour; reconcileHour = 0; try { await reconcileAll(await auth.activeFirmIds()); } finally { reconcileHour = was; } },
    start(everyMs = 5 * 60000) { if (timer) return; void pass(); timer = setInterval(() => void pass(), everyMs); timer.unref(); },
    stop() { if (timer) clearInterval(timer); if (quick) clearInterval(quick); timer = quick = null; },
    /** The queue is looked at far more often than the firms are ticked: a retry is due within the minute, not within five. */
    watchQueue(everyMs = 15000) { if (!inbox || quick) return; quick = setInterval(() => void inbox.drain(), everyMs); quick.unref(); }
  };
}
