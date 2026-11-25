// Closing a firm's account, and making sure a restore from backup cannot bring a closed firm back (T-28).
// A database backup holds each firm's wrapped key, so a restore to before a closure would make that firm readable again.
// So a closure first leaves a marker in the bucket, which is not part of the database backup. The marker holds a time and
// nothing else. After any restore, afterRestore() closes again every firm that has a marker.
import type { AuthStore } from "./authstore.ts";
import type { KitStore } from "./kit.ts";

export interface Markers { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer | null> }
export interface ClosureDeps { store: KitStore; auth: AuthStore; markers: Markers; clock: () => Date; log?: (event: string, ...ids: unknown[]) => void;
  /** v2: before the key goes, every connected mailbox is disconnected and its assistant removed at the mail layer (the tokens are sealed with the key). */
  beforeDestroy?: (firmId: string) => Promise<unknown> }
const marker = (firmId: string) => "closed/" + firmId;

export function createClosure({ store, auth, markers, clock, log, beforeDestroy }: ClosureDeps) {
  async function destroy(firmId: string, why: string, by: string) {
    for (const u of await auth.usersOfFirm(firmId)) if (!u.leftAt) await auth.deactivateUser(u.id, clock());   // nobody signs in to a closed firm
    if (!store.destroyFirm) throw new Error("This store cannot close a firm");
    if (beforeDestroy) { try { await beforeDestroy(firmId); } catch (err) { if (log) log("firm_mailboxes_not_removed", firmId, (err as Error).message); } }   // the closure goes ahead: an assistant left behind is removed by hand (docs/neeter/RUNBOOK.md)
    await store.destroyFirm(firmId);   // the key goes first: every sealed byte is unreadable from here, then the rows and files
    await auth.audit(firmId, by, why); if (log) log("firm_destroyed", firmId, why);
  }
  return {
    /** Closes one firm for good. The marker is written before anything is destroyed, so an interrupted closure is finished by afterRestore(). */
    async close(firmId: string, by: string): Promise<void> {
      if (!(await auth.activeFirmIds()).includes(firmId)) throw new Error("No open firm " + firmId);
      await markers.put(marker(firmId), Buffer.from(JSON.stringify({ closedAt: clock().toISOString() })));
      await destroy(firmId, "firm.closed", by);
    },
    /** Run after every restore from backup. Returns the firms it closed again. */
    async afterRestore(by: string): Promise<string[]> {
      const again: string[] = [];
      for (const id of await auth.activeFirmIds()) if (await markers.get(marker(id))) { await destroy(id, "firm.closed_again_after_restore", by); again.push(id); }
      return again;
    }
  };
}
