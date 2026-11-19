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

const TABS: [string, string][] = [["firm", "Your firm"], ["people", "People"]];
export function Settings() {
  const { can } = useFirm(), [params, setParams] = useSearchParams(), tab = TABS.some((t) => t[0] === params.get("tab")) ? params.get("tab")! : "firm";
  if (!can("owner")) return <Page title="Settings"><div className="card pad"><p>Settings are for owners. Ask an owner at your firm if something here needs changing.</p></div></Page>;
  return <Page title="Settings">
    <div className="tabs" role="tablist">{TABS.map((t) => <button key={t[0]} role="tab" aria-selected={tab === t[0]} className={tab === t[0] ? "on" : ""} onClick={() => setParams(t[0] === "firm" ? {} : { tab: t[0] })}>{t[1]}</button>)}</div>
    {tab === "firm" ? <FirmTab /> : <PeopleTab />}
    <p className="small muted">More settings are being built: message wording, ready-made checklists, where finished files go, how long data is kept, and your plan.</p>
  </Page>;
}
