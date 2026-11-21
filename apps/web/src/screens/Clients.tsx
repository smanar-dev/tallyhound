// The client list: filters, selection, things to do to many clients at once, and the three dialogs that get a firm collecting.
// Ported from the demo's clients(), clientTable() and its addClient, assignTpl and start dialogs.
import { HoundNote } from "../components/brand";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Engine } from "virtual:engine";
import { useFirm } from "../lib/firm";
import { Page } from "./Shell";
import { Modal } from "../components/Modal";
import { Avatar, Empty, Icon, StatusChip, UserAvatar } from "../components/ui";
import { inPill, openTasks, PILLS, readyToStart, type Row } from "../lib/select";
import { cname, dt, iname, ISTATE, phone, plural, rel } from "../lib/fmt";

const PAGE = 200;

// What happens next for one client, in a few words. The status itself is the engine's.
function NextStep({ T, e, open }: { T: Engine; e: Row; open: Row[] }) {
  const warn = (t: string) => <span style={{ color: "var(--warn)", fontWeight: 600 }}>{t}</span>, quiet = (t: string) => <span className="muted">{t}</span>;
  if (e.status === "stuck") return warn(T.STUCK[e.stuck][0]);
  if (open.some((t) => t.engId === e.id)) return warn("Waiting for you to check");
  if (e.status === "complete") return e.delivered ? quiet("Files handed off " + rel(T, e.delivered)) : <b>Ready to hand off</b>;
  if (e.status === "not_started" && e.checkin && e.checkin.doneAt && !e.checkin.reviewedAt) return warn("Check-in is back: go through it");
  if (e.status === "not_started" && e.checkin && !e.checkin.doneAt && !e.confirmed) return quiet("Check-in sent " + rel(T, e.checkin.sentAt));
  if (e.status === "not_started") return e.confirmed ? <>Ready to start</> : quiet("Confirm the checklist");
  if (e.status === "awaiting_consent") return quiet("Invited " + rel(T, e.invitedAt));
  if (e.status === "in_progress") { const it = T.nextItem(e); return <>{it ? iname(T, it) : "Waiting"}{e.next ? <span className="faint"> · {rel(T, e.next)}</span> : null}</>; }
  if (e.status === "opted_out") return quiet("Reach them another way");
  if (e.status === "paused") return quiet("Paused by staff");
  return null;
}

function AddClient({ onClose }: { onClose: () => void }) {
  const { T, act, toast } = useFirm(), nav = useNavigate(), [v, setV] = useState({ first: "", last: "", mobile: "", email: "", template: "t_home", rtype: "1040", entity: "" }), [why, setWhy] = useState(""), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (ev: { target: { value: string } }) => setV({ ...v, [k]: ev.target.value });
  const BIZ: Record<string, string> = { "1120S": "t_scorp", "1065": "t_partner", "1120": "t_ccorp", "1041": "t_trust", "990": "t_np" };
  const save = async () => {
    setBusy(true); setWhy("");
    try {
      const r = (await act("addClient", { first: v.first, last: v.last, mobile: v.mobile, email: v.email, lang: "en", entity: v.entity.trim(), rtype: v.rtype, template: v.rtype === "1040" ? v.template : BIZ[v.rtype] })) as { ok: boolean; why?: string; engId?: string };
      if (!r.ok) { setWhy((r.why || "Could not add this client") + "."); return; }   // T-38: the engine's own reason, and nothing was saved
      toast("Client added with a checklist. Confirm it, then say go fetch."); onClose(); nav("/clients/" + r.engId);
    } catch { /* the toast has said why */ } finally { setBusy(false); }
  };
  return <Modal title="Add a client" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={busy} onClick={save}>Add client</button></>}>
    {why ? <div className="note bad" role="alert">{why}</div> : null}
    <div className="grid g2">
      <label className="f">First name<input type="text" value={v.first} onChange={set("first")} autoComplete="off" /></label>
      <label className="f">Last name<input type="text" value={v.last} onChange={set("last")} autoComplete="off" /></label>
      <label className="f">Mobile<input type="tel" placeholder="10 digits" value={v.mobile} onChange={set("mobile")} autoComplete="off" /></label>
      <label className="f">Email<input type="email" value={v.email} onChange={set("email")} autoComplete="off" /></label>
      <label className="f">Kind of return<select value={v.rtype} onChange={set("rtype")}>{Object.keys(T.RETURNS).map((k) => <option key={k} value={k}>{T.RETURNS[k].label} ({T.RETURNS[k].form})</option>)}</select></label>
      {v.rtype === "1040" ? <label className="f">Checklist<select value={v.template} onChange={set("template")}>{T.templates().map((t: Row) => <option key={t.id} value={t.id}>{t.name} ({t.items.length})</option>)}</select></label>
        : <label className="f">Business, trust or organization name<input type="text" value={v.entity} onChange={set("entity")} /></label>}
    </div>
    <p className="small muted">Needs a name and either a mobile number or an email. Nothing goes out until you say go fetch.</p>
  </Modal>;
}

function AssignChecklist({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { T, actMany, toast } = useFirm(), tpls: Row[] = T.templates(), [tid, setTid] = useState(tpls[0]?.id || ""), [confirm, setConfirm] = useState(true), [skip, setSkip] = useState(true), [busy, setBusy] = useState(false);
  const complete = ids.filter((id) => T.eng(id)?.status === "complete").length;
  const go = async () => {
    setBusy(true);
    try {
      const was = ids.map((id) => T.eng(id).status), added = (await actMany(ids.map((id) => ["applyTemplate", id, tid, { confirm, skipComplete: skip }]))) as number[];
      const n = added.reduce((a, b) => a + (+b || 0), 0), reopened = skip ? 0 : was.filter((s) => s === "complete").length;
      toast("Checklist assigned to " + plural(ids.length, "client") + ": " + plural(n, "item") + " added." + (reopened ? " " + (reopened === 1 ? "1 complete file was" : reopened + " complete files were") + " reopened." : ""));
      onDone();
    } catch { /* the toast has said why */ } finally { setBusy(false); }
  };
  return <Modal title={"Choose a checklist for " + plural(ids.length, "client")} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={busy || !tid} onClick={go}>Assign</button></>}>
    <label className="f">Checklist<select value={tid} onChange={(e) => setTid(e.target.value)}>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.items.length})</option>)}</select></label>
    <p className="small muted">{(tpls.find((t) => t.id === tid)?.items || []).map((i: Row) => iname(T, typeof i === "string" ? { form: i } : i)).join(", ")}</p>
    <p className="small muted">Documents already on a client's checklist are kept. Only missing ones are added.</p>
    <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Confirm the checklists, so these clients are ready to start</label>
    {complete ? <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />Leave the {plural(complete, "complete file")} alone. Adding a document would reopen {complete === 1 ? "it" : "them"}</label> : null}
  </Modal>;
}

// Who, a preview of the first message, then send: the demo's three-step start.
function StartCollecting({ onClose }: { onClose: () => void }) {
  const { T, act, toast } = useFirm(), nav = useNavigate(), s = T.S, ready = readyToStart(T), unconf: Row[] = s.engs.filter((e: Row) => e.status === "not_started" && !e.confirmed);
  const [step, setStep] = useState(1), [pick, setPick] = useState(() => new Set<string>(ready.map((e) => e.id))), [busy, setBusy] = useState(false);
  const first = ready.find((e) => pick.has(e.id)), fc = first ? T.client(first.clientId) : null, byText = !!fc && fc.textConsent === "given" && s.firm.senderStatus === "approved";
  const toggle = (id: string) => { const n = new Set(pick); if (n.has(id)) n.delete(id); else n.add(id); setPick(n); };
  const go = async () => {
    setBusy(true); const docs = [...pick].reduce((n, id) => n + T.openItems(id).length, 0);
    try {
      const r = (await act("startMany", [...pick])) as { started: number; capped: number; refused: string[]; paced?: number };
      toast("Off it goes. " + plural(r.started, "client") + ", " + plural(docs, "document") + " to fetch." + (r.capped ? " " + r.capped + " more are waiting: the free trial collects from " + T.TRIAL_CLIENTS + " clients. Choose a plan to start them." : "") + (r.refused.length ? " Not started: " + r.refused.join("; ") + "." : ""));
      onClose(); if (r.capped) nav("/settings?tab=plan");
    } catch { /* the toast has said why */ } finally { setBusy(false); }
  };
  const steps = <div className="steps">{["Who", "Preview", "Send"].map((x, i) => <span key={x} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>{i ? " › " : ""}{i + 1}. {x}</span>)}</div>;
  const foot = <><button className="btn" onClick={() => (step > 1 ? setStep(step - 1) : onClose())}>{step > 1 ? "Back" : "Cancel"}</button>{step < 3 ? <button className="btn pri" disabled={!pick.size} onClick={() => setStep(step + 1)}>Continue</button> : <button className="btn pri" disabled={busy} onClick={go}><Icon name="send" small />Start {pick.size}</button>}</>;
  return <Modal title="Go fetch" wide onClose={onClose} head={steps} footer={foot}>
    {step === 1 ? <>
      {ready.length ? <><p className="muted">These clients have a confirmed checklist and have not been contacted.</p>
        <div className="list card" style={{ boxShadow: "none" }}>{ready.map((e) => { const c = T.client(e.clientId); return <label className="li" style={{ cursor: "pointer" }} key={e.id}><input type="checkbox" checked={pick.has(e.id)} onChange={() => toggle(e.id)} /><Avatar first={c.first} last={c.last} small /><span className="grow"><b>{cname(c)}</b><span className="small muted"> · {plural(T.itemsOf(e.id).length, "document")} · {c.textConsent === "given" ? "texts" : c.email ? "email invitation" : "no way to reach them"}</span></span></label>; })}</div></>
        : <p className="muted">No client is ready. Confirm their checklists first.</p>}
      {unconf.length ? <div className="note"><Icon name="alert" small /><span>{unconf.length === 1 ? "1 client is" : unconf.length + " clients are"} left out because the checklist is not confirmed: {unconf.slice(0, 12).map((e) => cname(T.client(e.clientId))).join(", ")}{unconf.length > 12 ? " and " + (unconf.length - 12) + " more" : ""}.</span></div> : null}
    </> : null}
    {step === 2 && fc && first ? <div className="grid g2" style={{ alignItems: "start" }}>
      <div className="col"><p>The first message {fc.first} gets{byText ? " by text:" : " is an email invitation to switch on texting:"}</p><p className="small muted">Each client gets their own name, preparer and first document.{s.firm.hound.mode === "copilot" ? " You approve each message before it goes." : ""}</p></div>
      <div className="minip"><div className="screen"><div className="pb them">{byText ? T.fill("M3", fc, first, { item: T.itemsOf(first.id)[0] }) : T.fill("M1", fc, first, {})}</div></div></div>
    </div> : null}
    {step === 3 ? <><p>Tallyhound will contact <b>{plural(pick.size, "client")}</b>. {T.allowed(s.now) ? "It is inside sending hours, so the first messages go out now." : "It is outside sending hours, so the first messages go out " + dt(T.nextAllowed(s.now)) + "."}</p><p className="small muted">Reminders then run on their own. You can pause anyone at any time.</p></> : null}
  </Modal>;
}

type Dialog = null | { kind: "add" } | { kind: "start" } | { kind: "assign"; ids: string[] };

export function Clients() {
  const { T, can, act, actMany, toast } = useFirm(), s = T.S, nav = useNavigate(), [params, setParams] = useSearchParams();
  const pill = PILLS.some((p) => p[0] === params.get("show")) ? params.get("show")! : "all";
  const [q, setQ] = useState(""), [prep, setPrep] = useState(""), [voi, setVoi] = useState(""), [inten, setInten] = useState(""), [sel, setSel] = useState(() => new Set<string>()), [limit, setLimit] = useState(PAGE), [dialog, setDialog] = useState<Dialog>(null);
  // Home and other screens can open a dialog here: /clients?do=add, ?do=start, ?do=assign (everyone not started).
  useEffect(() => {
    const d = params.get("do"); if (!d) return;
    if (can()) setDialog(d === "add" ? { kind: "add" } : d === "start" ? { kind: "start" } : d === "assign" ? { kind: "assign", ids: s.engs.filter((e: Row) => e.status === "not_started" && !e.confirmed).map((e: Row) => e.id) } : null);
    const p = new URLSearchParams(params); p.delete("do"); setParams(p, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const open = useMemo(() => openTasks(T), [T]);
  const rows: Row[] = useMemo(() => { const t = q.trim().toLowerCase(); return s.engs.filter((e: Row) => { const c = T.client(e.clientId); return c && inPill(T, e, pill, open) && (!prep || c.preparer === prep) && (!voi || T.voiceFor(c) === voi) && (!inten || T.cadenceFor(e).key === inten) && (!t || (c.first + " " + c.last + " " + (c.email || "") + " " + (c.mobile || "")).toLowerCase().includes(t)); }).sort((a: Row, b: Row) => (a.status === "stuck" ? 0 : 1) - (b.status === "stuck" ? 0 : 1) || T.client(a.clientId).last.localeCompare(T.client(b.clientId).last)); }, [T, s, pill, prep, voi, inten, q, open]);
  const shown = rows.slice(0, limit), ready = readyToStart(T).length, allSel = shown.length > 0 && shown.every((e) => sel.has(e.id));
  const setPill = (p: string) => { const n = new URLSearchParams(params); if (p === "all") n.delete("show"); else n.set("show", p); setParams(n); setLimit(PAGE); };
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const ids = [...sel].filter((id) => T.eng(id)), clear = () => setSel(new Set());
  // One action for everyone selected. Whoever it does not apply to is left alone and counted.
  const bulk = async (kind: "checkin" | "recommend" | "confirm" | "start" | "pause" | "resume") => {
    try {
      if (kind === "start") { const r = (await act("startMany", ids)) as { started: number; capped: number; refused: string[]; paced?: number }; toast((r.paced ? "The first 50 go now and the rest in groups of 50 every half hour. " : "") + "Off it goes. Fetching for " + r.started + (ids.length - r.started ? ", left " + (ids.length - r.started) + " that could not be started" + (r.refused.length ? " (" + r.refused.join("; ").toLowerCase() + ")" : "") : "") + "."); }
      else if (kind === "checkin") { const r = await actMany(ids.map((id) => ["sendCheckin", id])), ok = r.filter((x) => !x).length; toast("Check-in sent to " + plural(ok, "client") + "." + (ids.length - ok ? " " + (ids.length - ok) + " left out: already collecting, already answered, or no way to reach them." : "")); }
      else if (kind === "recommend") { const r = (await actMany(ids.map((id) => ["addRecommended", id]))) as number[], n = r.reduce((a, b) => a + (+b || 0), 0), m = r.filter((x) => +x > 0).length; toast("Added " + plural(n, "suggested document") + " across " + plural(m, "client") + ". Each one shows the reason on the checklist."); }
      else {
        const applies = (e: Row) => kind === "confirm" ? !e.confirmed : kind === "pause" ? !["complete", "closed", "not_started", "paused"].includes(e.status) : e.status === "paused";
        const todo = ids.filter((id) => applies(T.eng(id))); await actMany(todo.map((id) => [kind === "confirm" ? "confirmChecklist" : kind, id]));
        toast({ confirm: "Confirmed", pause: "Paused", resume: "Resumed" }[kind] + " " + todo.length + (ids.length - todo.length ? ", left " + (ids.length - todo.length) + " that did not apply" : "") + ".");
      }
      clear();
    } catch { /* the toast has said why */ }
  };
  const actions: ReactNode = can() ? <><Link className="btn hide-s" to="/add-clients"><Icon name="upload" small />Import your client list</Link><button className="btn" onClick={() => setDialog({ kind: "add" })}><Icon name="plus" small /><span className="hide-s">Add client</span></button>{ready ? <button className="btn pri" onClick={() => setDialog({ kind: "start" })}><Icon name="send" small />Go fetch ({ready})</button> : null}</> : null;

  return <Page title="Clients" actions={actions}>
    <div className="row"><div className="pills">{PILLS.map((p) => <button key={p[0]} className={pill === p[0] ? "on" : ""} aria-pressed={pill === p[0]} onClick={() => setPill(p[0])}>{p[1]}<span>{s.engs.filter((e: Row) => inPill(T, e, p[0], open)).length}</span></button>)}</div><span className="sp" />
      <input type="search" placeholder="Filter this list" aria-label="Filter clients" style={{ width: 180 }} value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
      <select aria-label="Preparer" value={prep} onChange={(e) => setPrep(e.target.value)}><option value="">All preparers</option>{s.users.filter((u: Row) => u.role !== "read_only").map((u: Row) => <option key={u.id} value={u.id}>{u.first}</option>)}</select>
      <select aria-label="Voice" value={voi} onChange={(e) => setVoi(e.target.value)}><option value="">Any voice</option>{Object.keys(T.VOICES).map((k) => <option key={k} value={k}>{T.VOICES[k].label}</option>)}</select>
      <select aria-label="Fetch intensity" value={inten} onChange={(e) => setInten(e.target.value)}><option value="">Any intensity</option>{Object.keys(T.CADENCE_PRESETS).map((k) => <option key={k} value={k}>{T.CADENCE_PRESETS[k].label}</option>)}</select></div>
    <div className="card">
      {!s.clients.length ? <HoundNote title="No clients yet." mode="sniff wag"><p>Import your client list and the hound will get to work.</p>{can() ? <div className="row" style={{ justifyContent: "center", marginTop: 14 }}><Link className="btn pri" to="/add-clients"><Icon name="upload" small />Import your client list</Link><button className="btn" onClick={() => setDialog({ kind: "add" })}><Icon name="plus" small />Add one client</button></div> : null}</HoundNote>
        : !rows.length ? <Empty>No clients match. <button className="btn sm" onClick={() => { setQ(""); setPrep(""); setPill("all"); }}>Clear filters</button></Empty>
        : <><div className="tbl"><table className="ctbl"><thead><tr><th style={{ width: 36 }}>{can() ? <input type="checkbox" aria-label="Select all shown" checked={allSel} onChange={() => { const n = new Set(sel); shown.forEach((e) => (allSel ? n.delete(e.id) : n.add(e.id))); setSel(n); }} /> : null}</th><th>Client</th><th>Preparer</th><th>Status</th><th>In and verified</th><th>Last heard</th><th>What happens next</th></tr></thead>
          <tbody>{shown.map((e) => { const c = T.client(e.clientId), p = T.verified(e.id), u = s.users.find((x: Row) => x.id === c.preparer); return <tr key={e.id} tabIndex={0} className={"click" + (sel.has(e.id) ? " sel" : "")} onClick={() => nav("/clients/" + e.id)} onKeyDown={(ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) nav("/clients/" + e.id); }}>
            <td onClick={(ev) => ev.stopPropagation()}>{can() ? <input type="checkbox" aria-label={"Select " + cname(c)} checked={sel.has(e.id)} onChange={() => toggle(e.id)} /> : null}</td>
            <td><div className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar first={c.first} last={c.last} /><div><b>{cname(c)}</b><div className="small faint">{c.email || phone(c.mobile)}</div></div></div></td>
            <td>{u ? <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><UserAvatar user={u} small />{u.first}</span> : null}</td>
            <td><StatusChip status={e.status} /></td>
            <td><div className="row" style={{ gap: 8, flexWrap: "nowrap" }}><span className="dots">{T.itemsOf(e.id).map((i: Row) => <i key={i.id} className={i.state} title={iname(T, i) + ": " + ISTATE[i.state]} />)}</span><span className="mono faint" title={"In and verified " + p.n + " of " + p.m}>{p.n} of {p.m}</span></div></td>
            <td className="muted small" style={{ whiteSpace: "nowrap" }}>{rel(T, e.lastIn)}</td>
            <td className="small"><NextStep T={T} e={e} open={open} /></td></tr>; })}</tbody></table></div>
          {rows.length > limit ? <div className="bd row" style={{ justifyContent: "center", borderTop: "1px solid var(--line2)" }}><span className="small muted">Showing {limit} of {rows.length}</span><button className="btn sm" onClick={() => setLimit(limit + PAGE)}>Show {PAGE} more</button></div> : null}</>}
    </div>
    {ids.length && can() ? <div className="card pad row bulkbar" role="region" aria-label="Selected clients"><b>{ids.length} selected</b><span className="sp" />
      <button className="btn sm" onClick={() => bulk("checkin")}>Send check-in</button><button className="btn sm" onClick={() => setDialog({ kind: "assign", ids })}>Choose a checklist</button><button className="btn sm" onClick={() => bulk("recommend")}>Add suggested documents</button>
      <button className="btn sm" onClick={() => bulk("confirm")}>Confirm checklists</button><button className="btn sm" onClick={() => bulk("start")}>Go fetch</button><button className="btn sm" onClick={() => bulk("pause")}>Pause</button><button className="btn sm" onClick={() => bulk("resume")}>Resume</button>
      <button className="btn sm ghost" style={{ color: "#fff" }} onClick={clear}>Clear</button></div> : null}
    {dialog?.kind === "add" ? <AddClient onClose={() => setDialog(null)} /> : null}
    {dialog?.kind === "start" ? <StartCollecting onClose={() => setDialog(null)} /> : null}
    {dialog?.kind === "assign" ? <AssignChecklist ids={dialog.ids} onClose={() => setDialog(null)} onDone={() => { setDialog(null); clear(); }} /> : null}
  </Page>;
}
