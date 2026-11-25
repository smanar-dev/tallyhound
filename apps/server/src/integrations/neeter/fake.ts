// A stand-in for the mail layer, for tests and for running the whole product on one machine (TH-NTR-1). It keeps what it is told in
// memory, honours every key exactly once, can be switched off to act out an outage, and lets a test change a task behind
// Tallyhound's back to act out drift.
import { LayerError, type LayerProject, type MailLayer, type TaskStatus } from "../../maillayer.ts";

export interface FakeLayer extends MailLayer {
  down: boolean; calls: number;
  letters: { key: string; assistantId: string; projectId: string; to: string; subject: string; body: string; thread: string; unsubscribe?: string }[];
  assistants: Map<string, { firmId: string; userId: string; provider: string; address: string; scopes: string[] }>;
  projects: Map<string, { assistantId: string; name: string; email: string; closed: boolean; due: string | null }>;
  tasks: Map<string, { projectId: string; title: string; status: TaskStatus; note: string }>;
  /** Changes a task as if someone had edited the layer's own list by hand. */
  tamper(taskId: string, status: TaskStatus): void;
}
export function fakeLayer(clock: () => Date = () => new Date()): FakeLayer {
  const seen = new Map<string, unknown>(), history: LayerProject["history"] = []; let n = 0;
  const L: FakeLayer = {
    down: false, calls: 0, letters: [], assistants: new Map(), projects: new Map(), tasks: new Map(),
    tamper(taskId, status) { const t = L.tasks.get(taskId); if (t) { history.push({ taskId, at: clock().toISOString(), from: t.status, to: status, by: "client" }); t.status = status; } },
    async provision(a) { gate(); const id = "as" + ++n; L.assistants.set(id, { firmId: a.firmId, userId: a.userId, provider: a.provider, address: a.address, scopes: a.scopes }); return { assistantId: id }; },
    async remove(a) { gate(); L.assistants.delete(a.assistantId); for (const [id, p] of L.projects) if (p.assistantId === a.assistantId) { L.projects.delete(id); for (const [tid, t] of L.tasks) if (t.projectId === id) L.tasks.delete(tid); } },
    async upsertProject(a) { gate(a.assistantId); return once(a.key, () => { const id = a.remoteId && L.projects.has(a.remoteId) ? a.remoteId : "pr" + ++n; L.projects.set(id, { assistantId: a.assistantId, name: a.name, email: a.email, closed: a.closed, due: a.due }); return { id }; }); },
    async upsertTask(a) { gate(a.assistantId); if (!L.projects.has(a.projectId)) throw new LayerError("refused", "No such project"); return once(a.key, () => { const id = a.remoteId && L.tasks.has(a.remoteId) ? a.remoteId : "tk" + ++n, was = L.tasks.get(id); if (!was || was.status !== a.status) history.push({ taskId: id, at: clock().toISOString(), from: was ? was.status : null, to: a.status, by: "tallyhound" }); L.tasks.set(id, { projectId: a.projectId, title: a.title, status: a.status, note: a.note }); return { id }; }); },
    async forgetProject(a) { gate(a.assistantId); L.projects.delete(a.projectId); for (const [tid, t] of L.tasks) if (t.projectId === a.projectId) L.tasks.delete(tid); },
    async sendLetter(a) { gate(a.assistantId); if (!L.projects.has(a.projectId)) throw new LayerError("refused", "No such project"); return once("letter:" + a.key, () => { const thread = a.thread || "th" + ++n; L.letters.push({ key: a.key, assistantId: a.assistantId, projectId: a.projectId, to: a.to, subject: a.subject, body: a.body, thread, unsubscribe: a.unsubscribe }); return { id: "lt" + ++n, thread }; }); },
    async getProject(a) { gate(a.assistantId); const p = L.projects.get(a.projectId); if (!p) return null; const tasks = [...L.tasks].filter(([, t]) => t.projectId === a.projectId).map(([id, t]) => ({ id, title: t.title, status: t.status })); return { name: p.name, closed: p.closed, tasks, history: history.filter((h) => tasks.some((t) => t.id === h.taskId)) }; }
  };
  function gate(assistantId?: string) { L.calls++; if (L.down) throw new LayerError("unreachable", "The email service could not be reached"); if (assistantId !== undefined && !L.assistants.has(assistantId)) throw new LayerError("no_mailbox", "That mailbox is not connected"); }
  function once<T>(key: string, make: () => T): T { if (seen.has(key)) return seen.get(key) as T; const r = make(); seen.set(key, r); return r; }
  return L;
}
