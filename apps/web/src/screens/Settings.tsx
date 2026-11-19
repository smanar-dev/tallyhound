// Settings, for owners. Built so far: the firm's details and the people who can sign in. Every page here maps to one of the four
// steps in docs/SCOPE.md (ticket T-45); the others are added as they are built and are not shown before then.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFirm } from "../lib/firm";
import { api } from "../lib/api";
import { Page } from "./Shell";
import { Modal } from "../components/Modal";
import { Avatar, Chip, Icon } from "../components/ui";
import type { Row } from "../lib/select";
import { fmtDay, fname, plural, when } from "../lib/fmt";

type Person = { id: string; name: string; email: string; role: "owner" | "staff" | "read_only"; twoStep: boolean };
const ROLE: Record<string, [string, string]> = { owner: ["Owner", "Everything, including settings, people and deleting documents"], staff: ["Staff", "Clients, checklists, messages, documents and handing off files"], read_only: ["Read-only", "Can look at clients and progress, and change nothing"] };

function FirmTab() {
  const { T, act, toast } = useFirm(), f = T.S.firm, [v, setV] = useState({ name: f.name, sender: f.sender, phone: f.phone || "", taxYear: String(f.taxYear || 2026) });
  const set = (k: keyof typeof v) => (ev: { target: { value: string } }) => setV({ ...v, [k]: ev.target.value });
  const c0: Row = T.S.clients[0] || { id: "", first: "Alex", last: "Sample", lang: "en", preparer: (T.S.users[0] || {}).id, textConsent: "given", mobile: "6155550100", email: "alex@example.com", emailOk: true }, e0: Row = T.S.engs[0] || { id: "", year: f.taxYear || 2026, clientId: "", status: "in_progress" };
  return <div className="card pad col"><h2>Your firm</h2>
    <div className="grid g2"><label className="f">Firm name<input type="text" value={v.name} onChange={set("name")} maxLength={80} /></label><label className="f">Name at the start of every text<input type="text" value={v.sender} onChange={set("sender")} maxLength={30} /></label>
      <label className="f">Office phone<input type="tel" value={v.phone} onChange={set("phone")} maxLength={20} /></label><label className="f">Tax year for new clients<select value={v.taxYear} onChange={set("taxYear")}>{[2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}</select></label>
      <label className="f" style={{ gridColumn: "1/-1" }}>Your Tallyhound address (clients reply here; it cannot be changed)<input type="text" value={f.email || ""} readOnly disabled /></label></div>
    <div><button className="btn pri" onClick={() => void act("saveFirm", { ...v, taxYear: +v.taxYear }).then(() => toast("Saved."), () => {})}>Save</button></div>
    <div className="note info"><Icon name="eye" small /><span>Clients see: “{T.fill("M5", c0, e0, { item: { form: "W2", payer: "Acme Logistics" } })}”</span></div></div>;
}

function PeopleTab() {
  const { me, toast, reload } = useFirm(), [people, setPeople] = useState<Person[] | null>(null), [add, setAdd] = useState(false), [v, setV] = useState({ name: "", email: "", role: "staff" }), [why, setWhy] = useState(""), [gone, setGone] = useState<Person | null>(null);
  const load = () => api.get<Person[]>("/api/users").then(setPeople, (e: Error) => toast(e.message));
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const owners = (people || []).filter((p) => p.role === "owner").length;
  const invite = async () => { setWhy(""); try { await api.post("/api/users", v); setAdd(false); setV({ name: "", email: "", role: "staff" }); toast("Added. They sign in with their email at the usual address and set up two-step sign-in the first time."); await load(); await reload(); } catch (e) { setWhy((e as Error).message); } };
  const setRole = async (p: Person, role: string) => { try { await api.post("/api/users/" + p.id + "/role", { role }); toast(p.name + " is now " + ROLE[role]![0].toLowerCase() + " and has been signed out everywhere."); await load(); await reload(); } catch (e) { toast((e as Error).message); await load(); } };
  const remove = async (p: Person) => { setGone(null); try { await api.del("/api/users/" + p.id); toast(p.name + " can no longer sign in."); await load(); await reload(); } catch (e) { toast((e as Error).message); } };
  return <div className="card"><div className="hd"><h2>People</h2><span className="sp" /><button className="btn sm" onClick={() => { setWhy(""); setAdd(true); }}><Icon name="plus" small />Add a person</button></div>
    {people === null ? <div className="bd muted" role="status">Loading…</div> : <div className="tbl"><table><thead><tr><th>Name</th><th>Can do</th><th>Two-step sign-in</th><th></th></tr></thead><tbody>{people.map((p) => <tr key={p.id}>
      <td><span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Avatar first={p.name.split(" ")[0]} last={p.name.split(" ")[1] || " "} small /><span><b>{p.name}</b>{p.id === me.id ? <span className="small faint"> (you)</span> : null}<br /><span className="small faint">{p.email}</span></span></span></td>
      <td><select aria-label={"What " + p.name + " can do"} value={p.role} disabled={p.id === me.id} onChange={(ev) => void setRole(p, ev.target.value)}>{Object.keys(ROLE).map((r) => <option key={r} value={r}>{ROLE[r]![0]}</option>)}</select><div className="small muted">{ROLE[p.role]![1]}</div></td>
      <td>{p.twoStep ? <Chip tone="good">On</Chip> : <Chip tone="warn">Set up at first sign-in</Chip>}</td>
      <td>{p.id !== me.id ? <button className="btn sm ghost" onClick={() => setGone(p)}>Remove</button> : null}</td></tr>)}</tbody></table></div>}
    {owners < 2 && people ? <div className="bd"><div className="note"><Icon name="alert" small /><span>You are the only owner. Add a second owner so the firm is never locked out if you lose your phone and your recovery codes.</span></div></div> : null}
    {add ? <Modal title="Add a person" onClose={() => setAdd(false)} footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn pri" onClick={invite}>Add</button></>}>
      {why ? <div className="note bad" role="alert">{why}</div> : null}
      <label className="f">Name<input type="text" value={v.name} onChange={(ev) => setV({ ...v, name: ev.target.value })} autoComplete="off" /></label>
      <label className="f">Work email<input type="email" value={v.email} onChange={(ev) => setV({ ...v, email: ev.target.value })} autoComplete="off" /></label>
      <label className="f">Can do<select value={v.role} onChange={(ev) => setV({ ...v, role: ev.target.value })}>{Object.keys(ROLE).map((r) => <option key={r} value={r}>{ROLE[r]![0]}: {ROLE[r]![1].toLowerCase()}</option>)}</select></label>
      <p className="small muted">There is no password to send them. They enter this email on the sign-in page and get a link.</p></Modal> : null}
    {gone ? <Modal title={"Remove " + gone.name + "?"} onClose={() => setGone(null)} footer={<><button className="btn" onClick={() => setGone(null)}>Cancel</button><button className="btn bad" onClick={() => void remove(gone)}>Remove</button></>}>
      <p>{gone.name} is signed out everywhere and can no longer sign in. What they did stays in the audit trail under their name. Clients they prepare for keep them as preparer until you change it.</p></Modal> : null}
  </div>;
}

// Ready-made checklists. Applying one only ever adds documents to a client's list; it never removes any.
function ChecklistsTab() {
  const { T, act, toast } = useFirm(), tpls: Row[] = T.templates(), forms = Object.keys(T.FORMS).filter((k) => k !== "OTHER"), [edit, setEdit] = useState<null | { id?: string; name: string; note: string; items: Set<string> }>(null), [gone, setGone] = useState<Row | null>(null), [why, setWhy] = useState("");
  const label = (k: string) => (k === "PRIOR" ? "Prior return" : fname(T, k));
  const save = async () => { setWhy(""); try { const r = await act("saveTemplate", { id: edit!.id, name: edit!.name, note: edit!.note, items: [...edit!.items] }); if (!r) return setWhy("Give the checklist a name and at least one document."); setEdit(null); toast("Checklist saved."); } catch { /* said */ } };
  const using = (t: Row) => T.S.engs.filter((e: Row) => e.template === t.name).length;
  return <div className="card"><div className="hd"><h2>Ready-made checklists</h2><span className="sp" /><button className="btn sm" onClick={() => { setWhy(""); setEdit({ name: "", note: "", items: new Set() }); }}><Icon name="plus" small />New checklist</button></div>
    <div className="list">{tpls.map((t) => <div className="li" style={{ alignItems: "flex-start" }} key={t.id}><span className="ico"><Icon name="file" small /></span><div className="grow"><b>{t.name}</b><div className="small muted">{t.note || ""}</div><div className="row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>{t.items.map((k: string) => <span className="chip" key={k}>{label(k)}</span>)}</div></div>
      <button className="btn sm ghost" onClick={() => { setWhy(""); setEdit({ id: t.id, name: t.name, note: t.note || "", items: new Set(t.items) }); }}>Edit</button><button className="btn sm ghost" onClick={() => setGone(t)}>Remove</button></div>)}</div>
    <div className="bd small muted" style={{ borderTop: "1px solid var(--line2)" }}>Give one to a client from the Clients list, or to many at once. It only adds documents. It never removes one.</div>
    {edit ? <Modal title={edit.id ? "Edit checklist" : "New checklist"} wide onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn pri" onClick={save}>Save</button></>}>
      {why ? <div className="note bad" role="alert">{why}</div> : null}
      <div className="grid g2"><label className="f">Name<input type="text" maxLength={40} value={edit.name} onChange={(ev) => setEdit({ ...edit, name: ev.target.value })} /></label><label className="f">Who it is for (optional)<input type="text" maxLength={80} value={edit.note} onChange={(ev) => setEdit({ ...edit, note: ev.target.value })} /></label></div>
      <fieldset className="pickforms"><legend className="small b">Documents on it</legend>{forms.map((k) => <label key={k} className="row small"><input type="checkbox" checked={edit.items.has(k)} onChange={() => { const n = new Set(edit.items); if (n.has(k)) n.delete(k); else n.add(k); setEdit({ ...edit, items: n }); }} />{label(k)}</label>)}</fieldset></Modal> : null}
    {gone ? <Modal title={"Remove “" + gone.name + "”?"} onClose={() => setGone(null)} footer={<><button className="btn" onClick={() => setGone(null)}>Cancel</button><button className="btn bad" onClick={() => { const t = gone; setGone(null); void act("removeTemplate", t.id).then(() => toast("Checklist removed. Clients who already have it keep their documents."), () => {}); }}>Remove</button></>}>
      <p>{using(gone) ? plural(using(gone), "client") + " got their list from it. They keep every document on it." : "No client's list came from it."} It will no longer be offered when you choose a checklist.</p></Modal> : null}
  </div>;
}

// What Tallyhound holds, for how long, and what it never keeps (docs/SECURITY.md). The numbers are the engine's.
function SecurityTab() {
  const { T, act, toast } = useFirm(), s = T.S, f = s.firm, M = T.dataMap(), L = T.RETAIN_LIMIT, [v, setV] = useState<Record<string, string>>({ afterDelivery: String(M.retain.afterDelivery), rejected: String(M.retain.rejected), unmatched: String(M.retain.unmatched), max: String(M.retain.max), close: String(f.retention) }), [stop, setStop] = useState(false), [copied, setCopied] = useState(false);
  const saveKeep = async () => { try { await act("setRetain", "afterDelivery", +v.afterDelivery!); await act("setRetain", "rejected", +v.rejected!); await act("setRetain", "unmatched", +v.unmatched!); await act("setRetain", "max", +v.max!); await act("setCloseRetention", +v.close!); toast("Saved. Anything already past the new times is deleted at the next pass."); } catch { /* said */ } };
  const num = (k: string, label: string, help: string, lim: [number, number]) => <label className="f">{label}<span className="row" style={{ flexWrap: "nowrap", gap: 8 }}><input type="number" style={{ width: 110 }} min={lim[0]} max={lim[1]} value={v[k]} onChange={(ev) => setV({ ...v, [k]: ev.target.value })} /><span className="small muted">days ({lim[0]} to {lim[1]})</span></span><span className="small muted">{help}</span></label>;
  const stat = (n: string | number, label: string) => <div className="card pad" style={{ boxShadow: "none" }}><b style={{ fontSize: 26 }}>{n}</b><div className="small muted">{label}</div></div>;
  const never: [string, string][] = [["Social Security, card and bank account numbers", "If a client types one into a text or email, it is removed before the message is stored or read by AI."], ["Dollar amounts from documents", "Tallyhound checks that a document is right. It does not pull the numbers out."], ["SSN, date of birth and fee columns in your client list", "Spotted at import and never brought in."], ["Passwords", "You sign in with an emailed link and a code. A locked PDF gets a request for an unlocked copy."], ["Your mailbox", "Tallyhound has its own address for client replies. It never connects to your Gmail or Outlook."]];
  const plan = "Service provider: Tallyhound (document collection).\nPurpose: requests tax source documents from our clients by text and email, checks each document, and files accepted documents into our own storage.\nData it handles: client name, email, mobile number, messages, and images of tax documents.\nData it never keeps: Social Security numbers, card and bank account numbers typed into messages (removed before storage); dollar amounts read from documents; SSN, date of birth and fee columns from client list imports; passwords. It does not connect to our mailbox.\nRetention: document images are deleted from Tallyhound " + M.retain.afterDelivery + " days after they reach our storage; rejected or duplicate documents after " + M.retain.rejected + " days; messages from unknown senders after " + M.retain.unmatched + " days; nothing is held longer than " + M.retain.max + " days; everything for a closed file is deleted " + f.retention + " days after closing.\nAccess: two-step sign-in for every user, three roles (owner, staff, read-only), and a log of every action.\nEach year: confirm the vendor's current security documents, list of other companies involved and incident notice terms at least yearly.";
  return <div className="col" style={{ gap: 16 }}>
    <div className="card pad col"><h2>Security and data</h2><p className="small muted">Tallyhound is a pass-through. Your own storage holds the permanent copy of every document. Tallyhound keeps its copy only as long as collecting needs it, then deletes it.</p>
      <div className="grid statgrid">{stat(M.docsHeld, "document copies held now")}{stat(M.docsDeleted, "already deleted")}{stat(M.undelivered, "accepted, not yet in your storage")}{stat(M.nextDeletion ? fmtDay(M.nextDeletion) : "None due", "next scheduled deletion")}</div></div>
    <div className="card pad col"><h3>How long Tallyhound keeps a document</h3><div className="grid g2">{num("afterDelivery", "After it reaches your storage", "0 deletes it the same day. 7 lets a preparer still open it here for a week.", L.afterDelivery)}{num("rejected", "Rejected, duplicate or discarded", "Wrong year, unreadable, or sent twice.", L.rejected)}{num("unmatched", "From a sender nobody matched to a client", "The message and any file are deleted.", L.unmatched)}{num("max", "Longest any copy is kept, whatever happens", "A backstop for files that never reach your storage.", L.max)}{num("close", "After a client's file is closed", "Its documents and message text are deleted this many days later.", [30, 730])}</div>
      <div><button className="btn pri" onClick={saveKeep}>Save</button></div><p className="small muted">What stays after deletion is one line per document: which form, which year, who issued it and when it arrived. That is what builds next year's list. To delete one client's copies now, open the client.</p></div>
    <div className="card"><div className="hd"><h3>What Tallyhound never keeps</h3></div><div className="list">{never.map((x) => <div className="li" key={x[0]}><span style={{ color: "var(--good)" }}><Icon name="lock" small /></span><div className="grow"><b>{x[0]}</b><div className="small muted">{x[1]}</div></div></div>)}</div></div>
    <div className="card pad col"><h3>Stop everything</h3><p className="small muted">Holds every automated message to every client until an owner lifts it. STOP and HELP replies still go, as the law requires. Documents that arrive are still checked.</p>
      <div>{f.stopped ? <button className="btn" onClick={() => void act("resumeAll").then(() => toast("Messages resumed."), () => {})}>Resume all messages</button> : <button className="btn bad" onClick={() => setStop(true)}><Icon name="pause" small />Hold all messages</button>}</div></div>
    <div className="card pad col"><h3>For your written security plan</h3><p className="small muted">Tax firms must keep a written information security plan that lists each service provider. This paragraph describes Tallyhound with your current settings.</p><pre className="plantext">{plan}</pre><div><button className="btn" onClick={() => navigator.clipboard.writeText(plan).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy"}</button></div></div>
    <div className="card"><div className="hd"><h2>Everything that was done</h2><span className="sp" /><span className="small faint">Newest first. Cannot be edited</span></div><div className="tbl audit"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>{s.audit.slice(0, 200).map((a: Row, i: number) => <tr key={i}><td className="small" style={{ whiteSpace: "nowrap" }}>{when(T, a.at)}</td><td>{a.actor}</td><td className="mono">{a.action}</td><td className="small">{a.detail}</td></tr>)}</tbody></table></div></div>
    {stop ? <Modal title="Hold all messages?" onClose={() => setStop(false)} footer={<><button className="btn" onClick={() => setStop(false)}>Cancel</button><button className="btn bad" onClick={() => { setStop(false); void act("stopAll").then(() => toast("All automated messages are held."), () => {}); }}>Hold all messages</button></>}><p>No request, reminder or reply written by Tallyhound goes to any client until an owner presses Resume. Use this if something looks wrong. Nothing is lost: messages due in the meantime go out after you resume.</p></Modal> : null}
  </div>;
}

const TABS: [string, string][] = [["firm", "Your firm"], ["people", "People"], ["checklists", "Checklists"], ["security", "Security and data"]];
export function Settings() {
  const { can } = useFirm(), [params, setParams] = useSearchParams(), tab = TABS.some((t) => t[0] === params.get("tab")) ? params.get("tab")! : "firm";
  if (!can("owner")) return <Page title="Settings"><div className="card pad"><p>Settings are for owners. Ask an owner at your firm if something here needs changing.</p></div></Page>;
  return <Page title="Settings">
    <div className="tabs" role="tablist">{TABS.map((t) => <button key={t[0]} role="tab" aria-selected={tab === t[0]} className={tab === t[0] ? "on" : ""} onClick={() => setParams(t[0] === "firm" ? {} : { tab: t[0] })}>{t[1]}</button>)}</div>
    {tab === "firm" ? <FirmTab /> : tab === "people" ? <PeopleTab /> : tab === "checklists" ? <ChecklistsTab /> : <SecurityTab />}
    <p className="small muted">More settings are being built: message wording, sending hours, where finished files go, and your plan.</p>
  </Page>;
}
