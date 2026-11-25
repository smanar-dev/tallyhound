// The mail layer (docs/V2.md section 4): the service that sends an email-first firm's letters from each preparer's own mailbox,
// reads the replies, and keeps a copy of who owes what. This file is the interface Tallyhound owns. The one real implementation
// is in integrations/neeter, and nothing outside that folder and the place the service is assembled may import it (TH-NTR-1,
// TH-WLB-4). Its name appears on no screen, in no email and in nothing a browser is sent (TH-WLB-1).
//
// Tallyhound is the record. What the layer holds is a copy that is written from here and repaired from here (TH-NTR-7).
export class LayerError extends Error { code: string; constructor(code: "unreachable" | "refused" | "schema" | "no_mailbox", message: string) { super(message); this.code = code; } }
export type TaskStatus = "Open" | "Completed" | "Done" | "On hold" | "Canceled";
export const TASK_STATUS: TaskStatus[] = ["Open", "Completed", "Done", "On hold", "Canceled"];
export interface LayerProject { name: string; closed: boolean; tasks: { id: string; title: string; status: TaskStatus }[]; history: { taskId: string; at: string; from: string | null; to: string; by: string }[] }

/** What the layer does, addressed by assistant (one per connected mailbox). Every write carries a key and may be repeated safely (TH-NTR-3). */
export interface MailLayer {
  /** Makes the assistant for one preparer's mailbox, from the permission the preparer gave Tallyhound. No second sign-in (TH-MBX-1). */
  provision(a: { firmId: string; userId: string; provider: "google" | "microsoft"; address: string; refreshToken: string; scopes: string[] }): Promise<{ assistantId: string }>;
  /** Removes an assistant and everything it holds. Letters and reading stop at once (TH-MBX-3). */
  remove(a: { firmId: string; assistantId: string }): Promise<void>;
  upsertProject(a: { firmId: string; assistantId: string; key: string; remoteId?: string | null; name: string; email: string; closed: boolean; due: string | null }): Promise<{ id: string }>;
  upsertTask(a: { firmId: string; assistantId: string; key: string; projectId: string; remoteId?: string | null; title: string; status: TaskStatus; note: string }): Promise<{ id: string }>;
  forgetProject(a: { firmId: string; assistantId: string; key: string; projectId: string }): Promise<void>;
  /** Sends one letter now, exactly as written, from the preparer's own address, with no signature or footer added (TH-WLB-2). */
  sendLetter(a: { firmId: string; assistantId: string; key: string; projectId: string; to: string; subject: string; body: string; thread?: string | null; unsubscribe?: string }): Promise<{ id: string; thread: string }>;
  getProject(a: { firmId: string; assistantId: string; projectId: string }): Promise<LayerProject | null>;
}
type ByOwner<T> = T extends { assistantId: string } ? Omit<T, "assistantId"> & { owner: string } : T;
/** The same, as the pipeline calls it: by the staff user whose mailbox it is. */
export interface PipelineLayer {
  upsertProject(a: ByOwner<Parameters<MailLayer["upsertProject"]>[0]>): Promise<{ id: string }>;
  upsertTask(a: ByOwner<Parameters<MailLayer["upsertTask"]>[0]>): Promise<{ id: string }>;
  forgetProject(a: ByOwner<Parameters<MailLayer["forgetProject"]>[0]>): Promise<void>;
  sendLetter(a: ByOwner<Parameters<MailLayer["sendLetter"]>[0]>): Promise<{ id: string; thread: string }>;
  getProject(a: ByOwner<Parameters<MailLayer["getProject"]>[0]>): Promise<LayerProject | null>;
}

// TH-NTR-6: only names leave. A project or a task holds the client's name, an email address, a form name and who issues it, and
// nothing else. A value that looks like an amount or an identifier is refused before any request is made, whatever put it there.
const FIGURE = /\$\s?\d|\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\d{5,}/;
export function checkNames(fields: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || typeof v === "boolean") continue;
    if (typeof v !== "string") throw new LayerError("schema", "Only words may be sent to the email service (" + k + ")");
    if (v.length > 200) throw new LayerError("schema", "Too long to be a name (" + k + ")");
    if (k !== "email" && k !== "key" && k !== "remoteId" && k !== "projectId" && k !== "due" && FIGURE.test(v)) throw new LayerError("schema", "An amount or an identifier may never be sent to the email service (" + k + ")");
  }
}
/** Wraps a layer so that every project and task is checked on its way out (TH-NTR-6). A letter is checked by the engine's own output check before it gets here. */
export function guarded(layer: MailLayer): MailLayer {
  return { ...layer,
    provision: (a) => layer.provision(a), remove: (a) => layer.remove(a), forgetProject: (a) => layer.forgetProject(a), getProject: (a) => layer.getProject(a),
    async upsertProject(a) { checkNames({ name: a.name, email: a.email, due: a.due }); return layer.upsertProject(a); },
    async upsertTask(a) { checkNames({ title: a.title, note: a.note }); if (!TASK_STATUS.includes(a.status)) throw new LayerError("schema", "Unknown status"); return layer.upsertTask(a); },
    async sendLetter(a) { if (/\battachment\b.*base64|^%PDF/im.test(a.body)) throw new LayerError("schema", "A letter never carries a file"); return layer.sendLetter(a); } };
}
