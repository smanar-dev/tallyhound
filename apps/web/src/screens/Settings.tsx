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

type Person = { id: string; name: string; email: string; role: "owner" | "staff" | "read_only"; twoStep: boolean; left?: boolean };
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
  const owners = (people || []).filter((p) => p.role === "owner" && !p.left).length, former = (people || []).filter((p) => p.left);
  const invite = async () => { setWhy(""); try { await api.post("/api/users", v); setAdd(false); setV({ name: "", email: "", role: "staff" }); toast("Added. They sign in with their email at the usual address and set up two-step sign-in the first time."); await load(); await reload(); } catch (e) { setWhy((e as Error).message); } };
  const setRole = async (p: Person, role: string) => { try { await api.post("/api/users/" + p.id + "/role", { role }); toast(p.name + " is now " + ROLE[role]![0].toLowerCase() + " and has been signed out everywhere."); await load(); await reload(); } catch (e) { toast((e as Error).message); await load(); } };
  const remove = async (p: Person) => { setGone(null); try { const r = await api.del<{ moved?: number }>("/api/users/" + p.id); toast(p.name + " can no longer sign in." + (r && r.moved ? " Their " + (r.moved === 1 ? "client is" : r.moved + " clients are") + " now yours." : "")); await load(); await reload(); } catch (e) { toast((e as Error).message); } };
  return <div className="card"><div className="hd"><h2>People</h2><span className="sp" /><button className="btn sm" onClick={() => { setWhy(""); setAdd(true); }}><Icon name="plus" small />Add a person</button></div>
    {people === null ? <div className="bd muted" role="status">Loading…</div> : <div className="tbl"><table><thead><tr><th>Name</th><th>Can do</th><th>Two-step sign-in</th><th></th></tr></thead><tbody>{people.filter((p) => !p.left).map((p) => <tr key={p.id}>
      <td><span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Avatar first={p.name.split(" ")[0]} last={p.name.split(" ")[1] || " "} small /><span><b>{p.name}</b>{p.id === me.id ? <span className="small faint"> (you)</span> : null}<br /><span className="small faint">{p.email}</span></span></span></td>
      <td><select aria-label={"What " + p.name + " can do"} value={p.role} disabled={p.id === me.id} onChange={(ev) => void setRole(p, ev.target.value)}>{Object.keys(ROLE).map((r) => <option key={r} value={r}>{ROLE[r]![0]}</option>)}</select><div className="small muted">{ROLE[p.role]![1]}</div></td>
      <td>{p.twoStep ? <Chip tone="good">On</Chip> : <Chip tone="warn">Set up at first sign-in</Chip>}</td>
      <td>{p.id !== me.id ? <button className="btn sm ghost" onClick={() => setGone(p)}>Remove</button> : null}</td></tr>)}</tbody></table></div>}
    {former.length ? <div className="bd small muted">No longer here: {former.map((p) => p.name).join(", ")}. Their names stay on the firm's history. Add one again with the same email to bring them back.</div> : null}
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

// The words Tallyhound uses. One message at a time: the standard wording, the firm's own if it has one, and what a client would see.
const WORD_GROUPS: [string, string[]][] = [["Getting started", ["M1", "M1R", "M2", "M28", "M28R", "M29", "M27"]], ["Asking and reminding", ["M3", "M4", "M5", "M6", "M10", "M26", "M13"]], ["When a document has a problem", ["M7", "M8", "M8L", "M9", "M22", "M22R", "M11", "M30L", "M30T", "M30K"]], ["Answering the client", ["M15", "M19", "M19X", "M20", "M23"]], ["Passing to a person", ["M12", "M14", "M24", "M25", "M21"]], ["Required by law", ["M16", "M16H", "M31"]]];
const BLANK: Record<string, string> = { "{first}": "Client's first name", "{firm}": "Firm name", "{n}": "How many documents", "{k}": "How many are still missing", "{year}": "Tax year", "{plain_name}": "Document name", "{from_payer}": "Who it comes from", "{where_hint}": "Where to find it", "{issuer}": "Who sends it", "{doc_year}": "Year on the document", "{question}": "The question", "{preparer}": "Preparer's name", "{link}": "The client's private link", "{missing}": "The missing part", "{fix}": "What to send", "{list}": "The list of documents", "{date}": "The date", "{summary}": "What was received", "{firm_phone}": "Office phone", "{firm_email}": "Your Tallyhound address", "{verify}": "How to check the message is real", "{for_entity}": "The business or trust name" };
function WordingTab() {
  const { T, act, toast } = useFirm(), f = T.S.firm, std: Record<string, string> = T.TPL.en, own: Record<string, string> = (f.templates && f.templates.en) || {}, known = new Set(Object.keys(std));
  const groups = WORD_GROUPS.map((g) => [g[0], g[1].filter((k) => known.delete(k))] as [string, string[]]).filter((g) => g[1].length); if (known.size) groups.push(["Other", [...known]]);
  const [code, setCode] = useState(groups[1]?.[1][0] || groups[0]![1][0]!), [draft, setDraft] = useState<string | null>(null), [why, setWhy] = useState("");
  const locked = T.COMPLIANCE.includes(code) || code === "M31", current = own[code] ?? std[code]!, text = draft ?? current, blanks = [...new Set(std[code]!.match(/\{\w+\}/g) || [])];
  const c0: Row = T.S.clients[0] || { id: "", first: "Alex", last: "Sample", lang: "en", preparer: (T.S.users[0] || {}).id, textConsent: "given", mobile: "6155550100", email: "alex@example.com", emailOk: true }, e0: Row = T.S.engs[0] || { id: "", year: f.taxYear || 2026, clientId: "", status: "in_progress" };
  const pick = (k: string) => { setCode(k); setDraft(null); setWhy(""); };
  const save = async () => { setWhy(""); try { const r = await act("saveWording", code, text); if (r) return setWhy(String(r) + "."); setDraft(null); toast("Saved. It is used from the next message."); } catch { /* said */ } };
  return <div className="grid wording">
    <div className="card"><div className="hd"><h2>Messages</h2></div>{groups.map((g) => <div key={g[0]}><div className="navsec dark">{g[0]}</div>{g[1].map((k) => <button key={k} className={"wpick" + (k === code ? " on" : "")} aria-current={k === code ? "true" : undefined} onClick={() => pick(k)}>{T.TPL_USE[k] || k}{own[k] ? <span className="chip plain info">Yours</span> : null}</button>)}</div>)}</div>
    <div className="col" style={{ gap: 16 }}>
      <div className="card pad col"><div className="row"><h2 className="grow">{T.TPL_USE[code] || code}</h2>{own[code] && !locked ? <button className="btn sm" onClick={() => void act("resetWording", code).then(() => { setDraft(null); toast("Back to the standard wording."); }, () => {})}>Use the standard wording</button> : null}</div>
        {locked ? <div className="note info"><Icon name="lock" small /><span>This wording is required by law, so it cannot be changed here.</span></div> : null}
        {why ? <div className="note bad" role="alert">{why}</div> : null}
        <label className="f">Wording<textarea className="wbox" value={text} disabled={locked} onChange={(ev) => setDraft(ev.target.value)} /></label>
        {blanks.length ? <div className="small muted">Tallyhound fills these in. Keep each one: {blanks.map((b) => <span key={b} className="blankchip"><span className="mono">{b}</span> {BLANK[b] || ""}</span>)}</div> : null}
        {locked ? null : <div className="row"><button className="btn pri" disabled={draft === null || draft.trim() === current} onClick={save}>Save</button>{draft !== null ? <button className="btn" onClick={() => { setDraft(null); setWhy(""); }}>Undo changes</button> : null}</div>}</div>
      <div className="card pad col"><h3>What a client sees now</h3><div className="bub out" style={{ maxWidth: "100%" }}>{T.fill(code, c0, e0, { item: { form: "W2", payer: "Acme Logistics" }, question: "Did you start a new job?", doc_year: 2025, summary: "We have your W-2.", missing: "the second page is missing", fix: "the second page", list: "your W-2", date: "March 1" })}</div>
        <p className="small muted">{f.hound.aiWrite !== false ? "When Claude writes messages, it starts from this wording and must keep every request in it. A draft that strays falls back to exactly this." : "This is sent as it is."} No advice words, no numbers that are not in the standard wording: the same check runs on your wording when you save.</p></div>
    </div></div>;
}

// When messages may go.
function HoursTab() {
  const { T, act, toast } = useFirm(), f = T.S.firm, [v, setV] = useState({ quietStart: f.quietStart, quietEnd: f.quietEnd, newDayHour: f.newDayHour }), days = [0, 2, 5, 9, 14];
  const sel = (k: keyof typeof v, label: string, opts: number[]) => <label className="f">{label}<select value={v[k]} onChange={(ev) => setV({ ...v, [k]: +ev.target.value })}>{opts.map((x) => <option key={x} value={x}>{(x > 12 ? x - 12 : x) + ":00 " + (x >= 12 ? "pm" : "am")}</option>)}</select></label>;
  return <div className="card pad col"><h2>Sending hours and reminders</h2><p className="small muted">Judged on each client's own clock when you have their state or time zone, otherwise on your firm's ({T.ZNAME[Object.keys(T.ZNAME).find((z) => T.ZNAME[z] === f.tz) || ""] || f.tz || "Central"} time).</p>
    <div className="grid g3">{sel("quietStart", "Earliest a message goes", [8, 9, 10])}{sel("quietEnd", "Latest a message goes", [17, 18, 19, 20])}{sel("newDayHour", "When a message waits for the next day, it goes at", [9, 10, 11, 12])}</div>
    <div><button className="btn pri" onClick={() => void act("setSchedule", v).then(() => toast("Saved."), () => {})}>Save</button></div>
    <h4 style={{ marginTop: 8 }}>The rhythm when a client goes quiet</h4>
    <ol className="rhythm">{days.map((d, i) => <li key={d}><b>Day {d}</b><span>{["First request", "Reminder", "Reminder", "Reminder", "Final note"][i]}</span></li>)}</ol>
    <p className="small muted">Never on Sundays or federal holidays. At most one automated message a day, unless the client replied in the last {f.liveMin} minutes. After the final note Tallyhound asks you to call, if that is switched on under The Hound, Rules it follows.</p></div>;
}

// The firm's plan: what it is on, how much of it is used, and a pause for the quiet months. Card billing is not built, so a plan
// is started or changed by Tallyhound and invoiced; nothing on this page takes money.
function PlanTab() {
  const { T, act, toast } = useFirm(), s = T.S, b = T.billing(), a = T.access(), u = T.usage(), plans: [string, number, number, number][] = T.PLANS, mine = plans.find((p) => p[0] === b.plan), n = s.clients.length, left = T.pauseLeft();
  const [until, setUntil] = useState(""), [why, setWhy] = useState("");
  const day = (d: Date) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), pct = (x: number) => Math.min(100, Math.round(x * 100));
  const pause = async () => { setWhy(""); try { const r = await act("pauseSeason", until); if (r) return setWhy(String(r) + "."); toast("Paused. Your data is kept and nothing runs."); } catch { /* said */ } };
  const meter = (label: string, used: number, allow: number, p: number) => <div className="col" style={{ gap: 4 }}><div className="row"><b className="grow">{label}</b><span className="small muted">{used.toLocaleString()} of {allow.toLocaleString()}</span></div><div className="bar"><i style={{ width: pct(p) + "%" }} className={p >= 1 ? "bad" : p >= 0.8 ? "warn" : ""} /></div></div>;
  return <div className="col" style={{ gap: 16 }}>
    <div className="card pad col"><h2>Your plan</h2>
      {b.state === "trial" ? <p>You are on the free trial: <b>{a.daysLeft} {a.daysLeft === 1 ? "day" : "days"} left</b>, and room to start collecting from {a.clientsLeft} more {a.clientsLeft === 1 ? "client" : "clients"}.</p>
        : b.state === "expired" ? <div className="note bad" role="alert">The free trial has ended. Nothing is sent or read until a plan starts. Your data is kept.</div>
        : b.state === "paused" ? <div className="note"><Icon name="pause" small /><span>Paused{b.pausedUntil ? " until " + day(b.pausedUntil) : ""}. Your data is kept, nothing runs and nothing is billed. Documents are still deleted on schedule.</span></div>
        : <p><b>{b.plan}</b>{mine ? <>: ${mine[1]} a month, for up to {mine[2].toLocaleString()} clients. You have {n.toLocaleString()}.</> : null}</p>}
      {b.state === "paused" ? <div><button className="btn pri" onClick={() => void act("resumeNow").then(() => toast("Resumed. Collecting carries on."), () => {})}>Resume now</button></div> : null}
      <p className="small muted">One flat price by number of clients. No charge per return, per document or per message. To start a plan or move to another, write to Tallyhound and it is changed the same day; you are invoiced monthly.</p></div>
    <div className="card"><div className="hd"><h3>Plans</h3></div><div className="tbl"><table><thead><tr><th>Plan</th><th>A month</th><th>Clients</th><th>People who can sign in</th></tr></thead><tbody>{plans.map((p) => <tr key={p[0]} className={b.state === "active" && p[0] === b.plan ? "sel" : ""}><td><b>{p[0]}</b>{b.state === "active" && p[0] === b.plan ? <span className="chip plain info" style={{ marginLeft: 8 }}>Yours</span> : null}</td><td>${p[1]}</td><td>Up to {p[2].toLocaleString()}</td><td>{p[3] >= 99 ? "No limit" : "Up to " + p[3]}</td></tr>)}</tbody></table></div></div>
    {b.state === "active" || b.state === "paused" ? <div className="card pad col"><h3>Included in your plan, over the last 12 months</h3>{meter("Text messages", u.used.segs, u.allow.segs, u.pct.segs)}{meter("Documents checked", u.used.docs, u.allow.docs, u.pct.docs)}<p className="small muted">Going over costs nothing extra. Past the text allowance, reminders go by email where a client has one; replies and required messages still go by text.</p></div> : null}
    {b.state === "active" ? <div className="card pad col"><h3>Pause for the quiet months</h3><p className="small muted">Nothing is sent, read or billed while paused, and everything is here when you come back. Up to 3 months in any 12; you have {left} {left === 1 ? "day" : "days"} left.</p>
      {why ? <div className="note bad" role="alert">{why}</div> : null}
      <div className="row"><label className="f" style={{ margin: 0 }}>Pause until<input type="date" value={until} onChange={(ev) => setUntil(ev.target.value)} /></label><button className="btn" disabled={!until || left <= 0} onClick={pause}><Icon name="pause" small />Pause</button></div></div> : null}
  </div>;
}

// What Tallyhound holds, for how long, and what it never keeps (docs/SECURITY.md). The numbers are the engine's.
function SecurityTab() {
  const { T, act, toast, reload } = useFirm(), s = T.S, f = s.firm, M = T.dataMap(), L = T.RETAIN_LIMIT, [v, setV] = useState<Record<string, string>>({ afterDelivery: String(M.retain.afterDelivery), rejected: String(M.retain.rejected), unmatched: String(M.retain.unmatched), max: String(M.retain.max), close: String(f.retention) }), [stop, setStop] = useState(false), [copied, setCopied] = useState(false);
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
    <div className="card pad col"><h3>Records you can take with you</h3><p className="small muted">Proof of consent for every client: when they agreed to texts or stopped them, the number, and the exact wording they saw. And the full list of everything that was done. Each download is itself recorded.</p>
      <div className="row"><button className="btn" onClick={() => void api.exportCsv("consent").then(() => { toast("Consent records downloaded."); void reload(); }, (e: Error) => toast(e.message))}><Icon name="file" small />Consent records</button><button className="btn" onClick={() => void api.exportCsv("audit").then(() => { toast("Downloaded."); void reload(); }, (e: Error) => toast(e.message))}><Icon name="file" small />Everything that was done</button></div></div>
    <div className="card"><div className="hd"><h2>Everything that was done</h2><span className="sp" /><span className="small faint">Newest first. Cannot be edited</span></div><div className="tbl audit"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>{s.audit.slice(0, 200).map((a: Row, i: number) => <tr key={i}><td className="small" style={{ whiteSpace: "nowrap" }}>{when(T, a.at)}</td><td>{a.actor}</td><td className="mono">{a.action}</td><td className="small">{a.detail}</td></tr>)}</tbody></table></div></div>
    {stop ? <Modal title="Hold all messages?" onClose={() => setStop(false)} footer={<><button className="btn" onClick={() => setStop(false)}>Cancel</button><button className="btn bad" onClick={() => { setStop(false); void act("stopAll").then(() => toast("All automated messages are held."), () => {}); }}>Hold all messages</button></>}><p>No request, reminder or reply written by Tallyhound goes to any client until an owner presses Resume. Use this if something looks wrong. Nothing is lost: messages due in the meantime go out after you resume.</p></Modal> : null}
  </div>;
}

const TABS: [string, string][] = [["firm", "Your firm"], ["people", "People"], ["checklists", "Checklists"], ["wording", "Message wording"], ["hours", "Sending hours"], ["plan", "Your plan"], ["security", "Security and data"]];
export function Settings() {
  const { can } = useFirm(), [params, setParams] = useSearchParams(), tab = TABS.some((t) => t[0] === params.get("tab")) ? params.get("tab")! : "firm";
  if (!can("owner")) return <Page title="Settings"><div className="card pad"><p>Settings are for owners. Ask an owner at your firm if something here needs changing.</p></div></Page>;
  return <Page title="Settings">
    <div className="tabs" role="tablist">{TABS.map((t) => <button key={t[0]} role="tab" aria-selected={tab === t[0]} className={tab === t[0] ? "on" : ""} onClick={() => setParams(t[0] === "firm" ? {} : { tab: t[0] })}>{t[1]}</button>)}</div>
    {tab === "firm" ? <FirmTab /> : tab === "people" ? <PeopleTab /> : tab === "checklists" ? <ChecklistsTab /> : tab === "wording" ? <WordingTab /> : tab === "hours" ? <HoursTab /> : tab === "plan" ? <PlanTab /> : <SecurityTab />}
    <p className="small muted">Still to come here: connecting your firm's own storage. Until then, hand off finished files from each client's page.</p>
  </Page>;
}
