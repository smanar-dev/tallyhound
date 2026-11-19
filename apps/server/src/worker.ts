// The timer. Every few minutes it calls tick() for each active firm: reminders, escalations, scheduled deletion, held sends.
// One firm failing never stops the others. Deletion runs whatever a firm's billing state is; the engine decides that, not this loop.
import type { App } from "./kit.ts";
import type { AuthStore } from "./authstore.ts";

export interface WorkerStatus { lastPass: Date | null; firms: number; failed: number; lastError: string | null }
export function createWorker({ app, auth, clock, log, inbox }: { app: App; auth: AuthStore; clock: () => Date; log?: (event: string, ...ids: unknown[]) => void; inbox?: { drain(): Promise<number>; sweep(): Promise<number> } }) {
  const status: WorkerStatus = { lastPass: null, firms: 0, failed: 0, lastError: null }; let running = false, timer: NodeJS.Timeout | null = null, quick: NodeJS.Timeout | null = null;
  async function pass(): Promise<WorkerStatus> {
    if (running) return status; running = true;
    try {
      if (inbox) { await inbox.drain(); await inbox.sweep(); }   // retries that have come due, and events nobody could process past their keep-for time
      const ids = await auth.activeFirmIds(); let failed = 0;
      for (const id of ids) { try { await app.tick(id); } catch (err) { failed++; status.lastError = (err as Error).message; if (log) log("tick_failed", id, status.lastError); } }
      await auth.sweep(clock()); Object.assign(status, { lastPass: clock(), firms: ids.length, failed });
    } catch (err) { status.lastError = (err as Error).message; if (log) log("worker_failed", status.lastError); }
    finally { running = false; }
    return status;
  }
  return {
    status, pass,
    start(everyMs = 5 * 60000) { if (timer) return; void pass(); timer = setInterval(() => void pass(), everyMs); timer.unref(); },
    stop() { if (timer) clearInterval(timer); if (quick) clearInterval(quick); timer = quick = null; },
    /** The queue is looked at far more often than the firms are ticked: a retry is due within the minute, not within five. */
    watchQueue(everyMs = 15000) { if (!inbox || quick) return; quick = setInterval(() => void inbox.drain(), everyMs); quick.unref(); }
  };
}
