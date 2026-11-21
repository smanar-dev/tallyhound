// One client: their checklist, what is suggested, their documents, the conversation, what happened, and their details.
// Ported from the demo's clientPage() and its tabs. Every status, count and "may this be sent" is the engine's.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Engine } from "virtual:engine";
import { useFeatures, useFirm } from "../lib/firm";
import { api } from "../lib/api";
import { Page } from "./Shell";
import { Modal } from "../components/Modal";
import { Avatar, Chip, DocChip, Empty, Icon, Ring, StatusChip } from "../components/ui";
import { Viewer } from "../components/Doc";
import { openTasks, type Row } from "../lib/select";
import { cname, DOW, dshort, dt, DSTATE, fname, iname, ISTATE, phone, plural, rel, tm, when } from "../lib/fmt";
import type { IconName } from "../lib/icons";

const SRC: Record<string, string> = { prior_year: "From last year", question: "From a client answer", arrived: "Arrived unasked", staff: "Added by staff", template: "From template", recommended: "Suggested" };
// The engine's log lines, shown in the product's vocabulary (docs/UX.md).
const houndWords = (t: string) => String(t || "").replace(/\bquiet hours\b/gi, "sending hours").replace(/\bStuck\b/g, "Needs you").replace(/\bstuck\b/g, "waiting on you").replace(/\b[Oo]utreach\b/g, "collecting").replace(/\bhandoffs?\b/gi, "question for you").replace(/\bqueue\b/gi, "Coming up").replace(/\b[Rr]eview\b/g, "a person's check").replace(/\b[Dd]eliver(ed|y)?\b/g, "hand-off").replace(/\bapprovals?\b/gi, "your OK").replace(/\bengagements?\b/gi, "file");
const cap = (t: string) => String(t || "").replace(/^[a-zà-ÿ]/, (ch) => ch.toUpperCase());
const formLabel = (form: string) => (form === "OTHER" ? "Other document" : form.replace(/^(\d{4})([A-Z]+)$/, "$1-$2").replace("W2", "W-2"));
const CHANNEL: Record<string, string> = { text: "text", email: "email", portal: "upload page", staff: "added by staff" };
const FGROUP: [string, string[]][] = [["Work and income", ["w2", "newJob", "selfEmp", "gig", "interest", "investments", "brokerage", "retire", "ss", "k1", "rental"]], ["Home and family", ["homeowner", "childcare", "student", "studentLoan"]], ["Health and other", ["market", "hsa", "charity", "estPay", "newClient"]]];
type Ctx = { T: Engine; e: Row; c: Row };

// A small menu that opens under its button and closes on Escape or a click elsewhere.
function Menu({ label, small, children }: { label: string; small?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const out = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); }, esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); }; document.addEventListener("mousedown", out); document.addEventListener("keydown", esc); return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); }; }, [open]);
  return <div className="rel" ref={box}><button className={"btn icon" + (small ? " sm ghost" : "")} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" small={small} /></button>{open ? <div className="menu-pop">{children(() => setOpen(false))}</div> : null}</div>;
}

// What a task is, in a line, with the buttons that settle it.
function TaskLine({ T, c, t }: { T: Engine; c: Row; t: Row }) {
  const { can, act } = useFirm(), [, setParams] = useSearchParams(), it = t.itemId ? T.S.items.find((i: Row) => i.id === t.itemId) : null;
  const decide = (d: string) => void act("decideTask", t.id, d, d === "reask" ? { reason: "illegible" } : { reason: "not needed" }).catch(() => {});
  const what = t.kind === "document" ? "Document: " + String(t.reason || "").toLowerCase() : t.kind === "question" ? "Question from " + c.first : t.kind === "says_none" ? "Doesn't have: " + (it ? iname(T, it) : "a document") : t.reason;
  return <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}><span className="small grow">{what}</span>{can() ? t.kind === "document" ? <Link className="btn sm pri" to={"/needs-you?task=" + t.id}>Check it</Link> : t.kind === "question" ? <button className="btn sm pri" onClick={() => setParams({ tab: "conversation" })}>Reply</button> : t.kind === "says_none" ? <><button className="btn sm" onClick={() => decide("waive")}>Not needed this year</button><button className="btn sm" onClick={() => decide("reask")}>Ask again</button></> : <button className="btn sm" onClick={() => decide("handled")}>Dismiss</button> : null}</div>;
}

// The hound for this client: who has the conversation, the date the documents are needed by, what it has learned, and why it did what it did.
function HoundCard({ T, e, c }: Ctx) {
  const { can, act, toast } = useFirm(), s = T.S, H = s.firm.hound, [, setParams] = useSearchParams(), [note, setNote] = useState(""), [mem, setMem] = useState("");
  const logs: Row[] = s.hlog.filter((h: Row) => h.engId === e.id).slice(0, 3), memory: Row[] = e.memory || [], day = e.target ? e.target.getFullYear() + "-" + String(e.target.getMonth() + 1).padStart(2, "0") + "-" + String(e.target.getDate()).padStart(2, "0") : "";
  const take = async () => { try { await act("takeover", e.id, "Taken over from the client page"); toast("You have the conversation. The hound keeps reading and tracking but sends nothing until you hand it back."); setParams({ tab: "conversation" }); } catch { /* said */ } };
  return <div className="card"><div className="hd"><Icon name="spark" /><h3>The hound</h3><span className="sp" />{e.takeover ? <Chip tone="warn">A person has it</Chip> : e.quietUntil && e.quietUntil > s.now ? <Chip>Paused to {dshort(e.quietUntil)}</Chip> : <Chip tone={H.mode === "copilot" ? "info" : "good"}>{H.mode === "copilot" ? "Approve each message" : "Sends on its own"}</Chip>}</div>
    <div className="bd col" style={{ gap: 12 }}>
      {e.takeover ? <><p className="small">{e.takeover.by} took over {rel(T, e.takeover.at)}. The hound keeps reading, checking documents and logging, but sends nothing.</p>{can() ? <><input type="text" aria-label="Note for the hound" placeholder="Note for the hound (optional)" value={note} onChange={(ev) => setNote(ev.target.value)} /><button className="btn pri" onClick={() => void act("handback", e.id, note.trim()).then(() => { setNote(""); toast("Handed back. The hound picks up in about an hour."); }, () => {})}>Hand back to the hound</button></> : null}</>
        : can() ? <button className="btn" onClick={take}><Icon name="hand" small />I'll handle {c.first}</button> : null}
      <label className="f">Documents needed by<input type="date" value={day} disabled={!can()} onChange={(ev) => { const v = ev.target.value; void act("setTarget", e.id, v).then(() => toast(v ? "Saved. The hound follows up more often as the date gets close." : "Date cleared."), () => {}); }} /></label>
      <div><h4 style={{ marginBottom: 6 }}>What it knows about {c.first}</h4>{memory.length ? memory.slice(0, 4).map((m, i) => <div className="small" style={{ padding: "3px 0" }} key={i}>{m.text} <span className="faint">{m.source === "Claude" || m.source === "Rules" ? "picked up from a message" : "added by " + m.source}</span></div>) : <div className="small faint">Nothing yet. It learns from replies, and from anything you tell it here.</div>}
        {can() ? <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "nowrap" }}><input type="text" aria-label={"Tell the hound something about " + c.first} placeholder={"Tell it something about " + c.first} style={{ flex: 1, minWidth: 0 }} value={mem} maxLength={200} onChange={(ev) => setMem(ev.target.value)} /><button className="btn sm" onClick={() => void act("rememberNote", e.id, mem).then((r) => { if (r) toast(String(r)); else { setMem(""); toast("Noted. The hound will use it in future messages."); } }, () => {})}>Add</button></div> : null}</div>
      {logs.length ? <div><h4 style={{ marginBottom: 6 }}>Why it did that</h4>{logs.map((l, i) => <div className="small" style={{ padding: "3px 0" }} key={i}><b>{houndWords(l.text)}</b>{l.why ? <><br /><span className="muted">{houndWords(l.why)}</span></> : null}</div>)}</div> : null}
    </div></div>;
}
function NextCard({ T, e, c, onHandOff }: Ctx & { onHandOff: () => void }) {
  const { can, act, toast } = useFirm(), s = T.S, it = T.nextItem(e), tasks = openTasks(T).filter((t) => t.engId === e.id);
  // Start, then let the first message be made at once (the same one action the Go fetch dialog uses), so the person sees it now and not at the timer's next pass.
  const start = async () => { try { const r = (await act("startMany", [e.id])) as { started: number; capped: number; refused: string[] }; toast(r.started ? "Off it goes. The first message goes out inside sending hours." : r.capped ? "The free trial collects from " + T.TRIAL_CLIENTS + " clients. Choose a plan to start more." : (r.refused[0] || "Could not start") + "."); } catch { /* said */ } };
  let body: ReactNode = null;
  if (e.status === "in_progress" && e.next) { const code = !it ? null : it.state === "expected" ? "M4" : e.step >= 4 ? "M6" : "M5"; body = <><div className="small muted">{s.firm.stopped ? "Held: messages are stopped" : "Sends " + dt(e.next) + " by " + (T.channelFor(c, e) || "email")}</div>{code ? <div className="bub out" style={{ maxWidth: "100%", alignSelf: "stretch" }}>{T.fill(code, c, e, { item: it })}</div> : null}</>; }
  else if (e.status === "awaiting_consent") body = <p className="small muted">Tallyhound emailed {c.first} an invitation to text documents. A reminder goes 3 days after the invitation, then the file is flagged at 7 days.</p>;
  else if (e.status === "not_started") body = <><p className="small muted">{e.confirmed ? "Ready. Starting sends the first message inside sending hours." : "Confirm the checklist before collecting can start."}</p>{can() ? e.confirmed ? <button className="btn pri" onClick={start}><Icon name="send" small />Go fetch</button> : <button className="btn pri" onClick={() => void act("confirmChecklist", e.id).catch(() => {})}>Confirm checklist</button> : null}</>;
  else if (e.status === "complete") body = <><p className="small muted">Every document is in or waived.{e.delivered ? " Files handed off " + rel(T, e.delivered) + "." : ""}</p>{can() ? <button className={"btn" + (e.delivered ? "" : " pri")} onClick={onHandOff}><Icon name="deliver" small />{e.delivered ? "Hand off files again" : "Hand off files"}</button> : null}</>;
  else if (e.status === "paused") body = <><p className="small muted">Paused. No automated messages until someone resumes.</p>{can() ? <button className="btn" onClick={() => void act("resume", e.id).then(() => toast("Resumed."), () => {})}><Icon name="play" small />Resume</button> : null}</>;
  else if (e.status === "opted_out") body = <p className="small muted">{c.first} replied STOP{c.email && c.emailOk !== false ? "" : " and has no email on file"}. Call {c.first} to collect the rest.</p>;
  return <div className="card"><div className="hd"><h3>What happens next</h3></div><div className="bd col" style={{ gap: 10 }}>
    {tasks.length ? <><div className="note"><Icon name="alert" small /><span>{tasks.length} thing{tasks.length > 1 ? "s wait" : " waits"} on you before Tallyhound carries on.</span></div>{tasks.slice(0, 4).map((t) => <TaskLine key={t.id} T={T} c={c} t={t} />)}{tasks.length > 4 ? <Link className="btn sm ghost" to="/needs-you">{tasks.length - 4} more in the review queue</Link> : null}</>
      : e.status === "stuck" ? <div className="note"><Icon name="alert" small /><span>{T.STUCK[e.stuck][0]}. {T.STUCK[e.stuck][1]}.</span></div> : null}
    {body}
  </div></div>;
}

// The client's check-in answers, as a proposal: what to add, what may no longer apply, their note. The firm ticks and confirms (docs/UX.md).
function CheckinCard({ T, e, c }: Ctx) {
  const { can, actMany, toast } = useFirm(), k = e.checkin, s = T.S;
  const [add, setAdd] = useState<Set<number>>(() => new Set((k?.adds || []).map((_: Row, n: number) => n))), [drop, setDrop] = useState<Set<string>>(() => new Set(k?.drops || [])), [cus, setCus] = useState<Set<number>>(() => new Set((k?.customs || []).map((_: Row, n: number) => n))), [own, setOwn] = useState("");
  if (!k) return null;
  if (!k.doneAt) {
    if (k.afterOptIn) return ["in_progress", "stuck"].includes(e.status) && s.now - k.sentAt < T.CHECKIN_WAIT_DAYS * T.DAY ? <div className="note info" style={{ marginBottom: 12 }}><Icon name="clock" small /><span className="grow">{k.pending ? "The questions go out by text when sending hours begin" : "The questions went to " + c.first + " by text " + rel(T, k.sentAt)}. Sent once, with no reminder. Document requests wait up to {T.CHECKIN_WAIT_DAYS} days for the answers.</span></div> : null;
    return e.status === "not_started" ? <div className="note info" style={{ marginBottom: 12 }}><Icon name="clock" small /><span className="grow">{k.pending ? "The check-in goes out when sending hours begin" : "Check-in sent " + rel(T, k.sentAt)}. Waiting for {c.first} to tick what applies. You can still choose a checklist yourself and start.</span></div> : null;
  }
  if (k.reviewedAt) return null;
  const it = (id: string) => s.items.find((x: Row) => x.id === id), drops: string[] = (k.drops || []).filter(it), live = ["in_progress", "stuck"].includes(e.status);
  const flip = <V,>(set: Set<V>, v: V, to: (n: Set<V>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); to(n); };
  const apply = async (start: boolean) => {
    const custom = (k.customs || []).filter((_: string, n: number) => cus.has(n)).concat(own.trim() ? [own.trim()] : []);
    try { const r = (await actMany([["applyCheckin", e.id, { add: [...add], drop: [...drop], custom, start }], ["startMany", []]]))[0] as { added: number; removed: number; started?: boolean; why?: string } | string;
      toast(typeof r === "string" ? r + "." : "Checklist confirmed: " + r.added + " added, " + r.removed + " removed." + (live ? " Fetching carries on with the updated list." : "") + (start ? (r.started ? " Collecting has started." : " Not started: " + r.why + ".") : "")); } catch { /* said */ }
  };
  return <div className="card pad col checkin" style={{ marginBottom: 14 }}>
    <div className="row"><h3 className="grow">{c.first} {k.afterOptIn ? "answered the questions" : "finished the check-in"}</h3><span className="small muted">{rel(T, k.doneAt)}</span></div>
    <p className="small muted">{k.same ? "Says this year is about the same as last year. " : ""}Tick what to apply, then confirm.</p>
    {(k.adds || []).length ? <div><b className="small">Add to the checklist</b>{k.adds.map((a: Row, n: number) => <label key={n} className="row small ckrow"><input type="checkbox" checked={add.has(n)} disabled={!can()} onChange={() => flip(add, n, setAdd)} /><span><b>{a.form === "PRIOR" ? "Prior return" : cap(fname(T, a.form))}{a.payer ? " from " + a.payer : ""}</b> <span className="muted">{a.reason}</span></span></label>)}</div> : null}
    {(k.customs || []).length ? <div><b className="small">Requests Claude suggests from the note</b>{k.customs.map((t: string, n: number) => <label key={n} className="row small ckrow"><input type="checkbox" checked={cus.has(n)} disabled={!can()} onChange={() => flip(cus, n, setCus)} /><span><b>{t}</b></span></label>)}</div> : null}
    {drops.length ? <div><b className="small">Remove from the checklist</b>{drops.map((id) => <label key={id} className="row small ckrow"><input type="checkbox" checked={drop.has(id)} disabled={!can()} onChange={() => flip(drop, id, setDrop)} /><span><b>{cap(iname(T, it(id)))}{it(id).payer ? " from " + it(id).payer : ""}</b> <span className="muted">Client says this no longer applies</span></span></label>)}</div> : null}
    {!(k.adds || []).length && !drops.length && !(k.customs || []).length ? <p className="small">Nothing to add or remove. The checklist below stands.</p> : null}
    {k.note ? <><div className="note"><Icon name="msg" small /><span>{c.first} wrote: “{k.note}”{k.noteRead ? "" : " This note was not read by Claude, so check whether it needs a document."}</span></div>{can() ? <label className="f small">Add your own request from the note (optional)<input type="text" maxLength={60} placeholder="For example: closing statement for the home sale" value={own} onChange={(ev) => setOwn(ev.target.value)} /></label> : null}</> : null}
    {can() ? <div className="row">{live ? <button className="btn pri" onClick={() => void apply(false)}><Icon name="check" small />Apply and carry on collecting</button> : <><button className="btn pri" onClick={() => void apply(true)}><Icon name="send" small />Confirm and go fetch</button><button className="btn" onClick={() => void apply(false)}>Confirm only</button></>}</div> : null}
  </div>;
}
// Something a client mentioned in a message that may need a document. Nothing is asked for unless a person adds it.
function MentionCard({ e, c }: Ctx) {
  const { can, act, toast } = useFirm(), L: string[] = e.suggestCustom || []; if (!L.length || !can()) return null;
  return <div className="card pad col" style={{ marginBottom: 14, gap: 8 }}><b>{c.first} mentioned something that may need a document</b>
    {L.map((t) => <div key={t} className="row" style={{ flexWrap: "nowrap" }}><span className="grow">{t}</span><button className="btn sm pri" onClick={() => void act("customSuggest", e.id, t, true).then(() => toast("Added to the checklist. The hound will ask for it."), () => {})}>Add as a request</button><button className="btn sm ghost" onClick={() => void act("customSuggest", e.id, t, false).then(() => toast("Dismissed."), () => {})}>Dismiss</button></div>)}
    <p className="small muted">Claude read the message and flagged this. Nothing is requested from the client unless you add it.</p></div>;
}

// Last year's return in, a proposed checklist out (T-46). The return is read and not kept; nothing is added until it is ticked here.
function PriorReturn({ T, e, c }: Ctx) {
  const { act, toast } = useFirm(), [busy, setBusy] = useState(false), [p, setP] = useState<Awaited<ReturnType<typeof api.prior>> | null>(null), [pick, setPick] = useState<Set<number>>(new Set());
  const read = async (file: File | undefined) => { if (!file) return; setBusy(true); try { const r = await api.prior(e.id, file); setP(r); setPick(new Set(r.items.map((_, n) => n))); } catch (err) { toast((err as Error).message); } finally { setBusy(false); } };
  const add = async () => { const list = p!.items.filter((_, n) => pick.has(n)); setP(null); try { await act("addFromPrior", e.id, list); toast(plural(list.length, "document") + " added to the checklist, where " + c.first + " has not been asked for them already."); } catch { /* said */ } };
  return <div className="row" style={{ marginTop: 10 }}><span className="small muted grow">Have {c.first}'s return from last year? Tallyhound reads it, suggests what to ask for again, and does not keep it.</span>
    <label className={"btn sm" + (busy ? " dis" : "")}>{busy ? "Reading…" : "Build from last year's return"}<input type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={(ev) => { void read(ev.target.files?.[0]); ev.target.value = ""; }} /></label>
    {p ? <Modal title="From last year's return" onClose={() => setP(null)} footer={<><button className="btn" onClick={() => setP(null)}>Cancel</button><button className="btn pri" disabled={!pick.size} onClick={add}>Add {pick.size} to the checklist</button></>}>
      <p className="small muted">Read {p.pages}{p.total > p.pages ? " of " + p.total : ""} {p.pages === 1 ? "page" : "pages"}{p.year ? " of a " + p.year + " return" : ""}. The return was not kept. Tick what {c.first} should be asked for this year.</p>{p.note ? <p className="small">{p.note}</p> : null}
      <div className="col" style={{ gap: 4 }}>{p.items.map((x, n) => <label key={n} className="row small ckrow"><input type="checkbox" checked={pick.has(n)} onChange={(ev) => { const s2 = new Set(pick); if (ev.target.checked) s2.add(n); else s2.delete(n); setPick(s2); }} /><span><b>{fname(T, x.form)}</b>{x.payer ? " from " + x.payer : ""}{x.why ? <span className="muted"> · {x.why}</span> : null}</span></label>)}</div></Modal> : null}</div>;
}
function Checklist({ T, e, c, openDoc }: Ctx & { openDoc: (id: string) => void }) {
  const feat = useFeatures(), { can, act, toast } = useFirm(), s = T.S, items: Row[] = T.itemsOf(e.id), [form, setForm] = useState(Object.keys(T.FORMS).filter((k) => k !== "OTHER")[0]!), [payer, setPayer] = useState(""), [waive, setWaive] = useState<Row | null>(null), [note, setNote] = useState("");
  const editable = can() && !["closed", "opted_out"].includes(e.status), docOf = (id: string) => s.docs.find((d: Row) => d.id === id);
  // T-66: removing a line or marking it not needed can be undone for ten seconds, which puts it back exactly as it was.
  const set = (i: Row, state: string, why?: string, said?: string) => { const was: string = i.state; return act("setItem", i.id, state, why).then(() => { if (said) toast(said, ["removed", "waived"].includes(state) ? { label: "Undo", run: () => void act("setItem", i.id, was, "").then(() => toast("Put back."), () => {}) } : undefined); }, () => {}); };
  const checkin = async () => { try { const r = await act("sendCheckin", e.id); toast(r ? "Not sent: " + r + "." : "Check-in sent. The answers come back here as a proposed checklist."); } catch { /* said */ } };
  const icon = (st: string): IconName | null => st === "received" ? "check" : st === "requested" ? "send" : ["in_review", "says_none", "partial"].includes(st) ? "alert" : st === "waived" ? "minus" : null;
  const proposal = !!(e.checkin && e.checkin.doneAt && !e.checkin.reviewedAt);
  return <>
    <CheckinCard key={"ck" + (e.checkin?.doneAt ? +e.checkin.doneAt : 0)} T={T} e={e} c={c} /><MentionCard T={T} e={e} c={c} />
    {e.confirmed || proposal ? null : <div className="note" style={{ marginBottom: 12 }}><Icon name="alert" small /><span className="grow">This checklist has not been confirmed. Go through it, then confirm so collecting can start.</span>{can() ? <button className="btn sm pri" onClick={() => void act("confirmChecklist", e.id).then(() => toast("Checklist confirmed."), () => {})}>Confirm checklist</button> : null}</div>}
    {editable && e.status === "not_started" && !(e.checkin && e.checkin.doneAt) ? <div className="row" style={{ marginBottom: 12 }}><span className="small muted">{e.checkin ? "No answer yet?" : "Not sure what " + c.first + " has this year? Ask with a 2-minute check-in."}</span><span className="sp" /><button className="btn sm" onClick={checkin}><Icon name="send" small />{e.checkin ? "Send the check-in again" : "Send a check-in"}</button></div> : null}
    <div className="card">
      {items.length ? <div className="list">{items.map((i) => { const d = i.docId ? docOf(i.docId) : null, ic = icon(i.state), rel0 = ["expected", "requested"].includes(i.state) ? T.releaseOf(i, e) : null;
        return <div className="li" key={i.id}><span className={"ico " + i.state}>{ic ? <Icon name={ic} /> : null}</span>
          <div className="grow"><b>{cap(iname(T, i))}</b>{i.payer ? <span className="muted"> from {i.payer}</span> : null}{i.isNew ? <> <span className="chip info plain">New this year</span></> : null}
            <div className="small muted">{ISTATE[i.state]}{d ? " " + when(T, d.at) + " by " + (CHANNEL[d.channel] || d.channel) : ""} · {i.reason || SRC[i.source] || ""}{i.note ? " · " + i.note : ""}
              {i.state === "partial" && i.missing ? <> · <b style={{ color: "var(--warn)" }}>Still needs {T.missText(i.missing, "en", i.form).fix}</b></> : null}
              {rel0 && rel0 > s.now ? <> · <span className="chip info plain">Issued after {dshort(rel0)}: no reminders before then</span></> : null}
              {i.laterUntil && i.laterUntil > s.now ? <> · <span className="chip plain">Client says later: back in touch {dshort(i.laterUntil)}</span></> : null}</div></div>
          {d ? <button className="btn sm ghost" aria-label={"Open the " + iname(T, i)} onClick={() => openDoc(d.id)}><Icon name="eye" small /></button> : null}
          {can() ? <Menu label={"Actions for " + iname(T, i)} small>{(close) => <>
            {["expected", "requested", "says_none", "partial"].includes(i.state) ? <><button onClick={() => { close(); setNote(""); setWaive(i); }}><Icon name="minus" small />Not needed this year</button><button onClick={() => { close(); void set(i, "received", "Received outside Tallyhound", "Marked received."); }}><Icon name="check" small />Received outside Tallyhound</button></> : null}
            {i.state === "waived" ? <button onClick={() => { close(); void set(i, "expected"); }}><Icon name="reset" small />Restore</button> : null}
            <button className="bad" onClick={() => { close(); void set(i, "removed", undefined, "Removed from the checklist."); }}><Icon name="trash" small />Remove from checklist</button></>}</Menu> : null}
        </div>; })}</div> : <Empty small>No documents on this checklist yet.{can() ? " Add the first one below, or choose a ready-made checklist from the client list." : ""}</Empty>}
      {editable ? <div className="bd row" style={{ borderTop: "1px solid var(--line2)" }}><span className="small muted" style={{ width: "100%" }}>Need something else from {c.first}?</span>
        <select aria-label="Document" value={form} onChange={(ev) => setForm(ev.target.value)}>{Object.keys(T.FORMS).filter((k) => k !== "OTHER").map((k) => <option key={k} value={k}>{cap(T.FORMS[k].plain)}</option>)}</select>
        <input type="text" placeholder="Who it comes from (optional)" aria-label="Who it comes from" style={{ width: 220 }} value={payer} onChange={(ev) => setPayer(ev.target.value)} />
        <button className="btn" onClick={() => void act("addItem", e.id, form, payer.trim()).then(() => { setPayer(""); toast("Added to the checklist."); }, () => {})}><Icon name="plus" small />Add to checklist</button></div> : null}
      {editable && s.firm.priorReturn === true && feat.prior ? <PriorReturn T={T} e={e} c={c} /> : null}
    </div>
    {waive ? <Modal title="Not needed this year" onClose={() => setWaive(null)} footer={<><button className="btn" onClick={() => setWaive(null)}>Cancel</button><button className="btn pri" onClick={() => { const i = waive; setWaive(null); void set(i, "waived", note.trim() || "Not needed", "Marked not needed."); }}>Not needed this year</button></>}>
      <p className="small muted">{cap(iname(T, waive))}{waive.payer ? " from " + waive.payer : ""} comes off what {c.first} is asked for. You can restore it later.</p>
      <label className="f">Reason, for the file<input type="text" placeholder="For example: account closed in 2025" value={note} onChange={(ev) => setNote(ev.target.value)} /></label></Modal> : null}
  </>;
}

function Suggested({ T, e, c }: Ctx) {
  const { can, act, toast } = useFirm(), r = T.recommend(e.id), f = c.profile || {}, lbl = (k: string) => (T.FACTS.find((x: Row) => x[0] === k) || [k, k])[1];
  return <div className="grid req" style={{ alignItems: "start" }}>
    <div className="card"><div className="hd"><h3>What applies to {c.first} this year</h3><span className="sp" /><span className="small faint">Drives the suggestions</span></div><div className="bd col" style={{ gap: 14 }}>
      {FGROUP.map((g) => <div key={g[0]}><h4 style={{ marginBottom: 6 }}>{g[0]}</h4><div className="col" style={{ gap: 6 }}>{g[1].filter((k) => T.FACTS.some((x: Row) => x[0] === k)).map((k) => <label key={k} className="row small" style={{ gap: 9, flexWrap: "nowrap" }}><span className="toggle"><input type="checkbox" checked={!!f[k]} disabled={!can()} onChange={(ev) => void act("setFact", c.id, k, ev.target.checked).catch(() => {})} /><span /></span><span className="grow">{lbl(k)}</span><span className="faint">{(T.RULES[k] || []).map((x: string) => cap(fname(T, x))).join(", ")}</span></label>)}</div></div>)}
      <p className="small muted">Set when the client list is imported, then updated by staff and by the client's own answers.</p></div></div>
    <div className="col" style={{ gap: 16 }}>
      <div className="card"><div className="hd"><h3>Suggested for {c.first}</h3><span className="sp" />{r.add.length && can() ? <button className="btn sm pri" onClick={() => void act("addRecommended", e.id).then(() => toast("Added " + plural(r.add.length, "document") + "."), () => {})}>Add all {r.add.length}</button> : null}</div>
        <div className="list">{r.add.length ? r.add.map((a: Row) => <div className="li" key={a.form}><span className="ico"><Icon name="plus" small /></span><div className="grow"><b>{cap(fname(T, a.form))}</b><div className="small muted">Because: {String(a.reason).toLowerCase()}</div></div>{can() ? <><button className="btn sm" onClick={() => void act("addRecommended", e.id, [a.form]).then(() => toast("Added " + fname(T, a.form) + "."), () => {})}>Add</button><button className="btn sm ghost" onClick={() => void act("dismissRec", e.id, a.form).then(() => toast("Dismissed. It won't be suggested again for this client."), () => {})}>Dismiss</button></> : null}</div>) : <div className="li small muted">The checklist covers everything that applies.</div>}</div></div>
      {r.unbacked.length ? <div className="note"><Icon name="alert" small /><span>{r.unbacked.map((i: Row) => cap(iname(T, i))).join(", ")} came from the ready-made checklist, but nothing above calls for {r.unbacked.length > 1 ? "them" : "it"}. Keep or remove on the Checklist tab.</span></div> : null}
    </div></div>;
}

function Documents({ T, e, c, openDoc }: Ctx & { openDoc: (id: string) => void }) {
  const { can, reload, toast } = useFirm(), ds: Row[] = T.S.docs.filter((d: Row) => d.engId === e.id).sort((a: Row, b: Row) => b.at - a.at), [busy, setBusy] = useState(false), input = useRef<HTMLInputElement>(null);
  // T-90: a document the firm received some other way. Checked like any other; the client is not messaged.
  const add = async (files: FileList | null) => {
    if (!files || !files.length) return; setBusy(true); let ok = 0; const bad: string[] = [];
    for (const f of [...files]) { try { ok += (await api.upload(c.id, f)).docs.length; } catch (err) { bad.push(f.name + ": " + (err as Error).message); } }
    await reload(); setBusy(false); if (input.current) input.current.value = "";
    toast((ok ? plural(ok, "document") + " added and checked. " + c.first + " was not messaged." : "") + (bad.length ? " Not added: " + bad.join(" ") : ""));
  };
  return <>
    {can() ? <div className="row" style={{ marginBottom: 12 }}><span className="small muted grow">Got one on paper or in your own email? Add it here. It is checked the same way and {c.first} is not messaged.</span><label className={"btn sm" + (busy ? " dis" : "")}><Icon name="plus" small />{busy ? "Reading…" : "Add a document"}<input ref={input} type="file" accept="image/*,application/pdf" multiple hidden disabled={busy} onChange={(ev) => void add(ev.target.files)} /></label></div> : null}
    {!ds.length ? <div className="card"><Empty><div className="big" style={{ background: "var(--tint)", color: "var(--accent-ink)" }}><Icon name="file" /></div><b>Nothing in yet.{e.lastOut ? " Last asked " + when(T, e.lastOut) + "." : ""}</b><br />Documents appear here the moment {c.first} texts, emails or uploads them.</Empty></div>
      : <div className="dgrid">{ds.map((d) => { const v = T.verdict(d), inner = <><div className="thumb docph"><Icon name="file" /></div><div className="tx"><div className="row" style={{ gap: 6 }}><b className="trunc" style={{ maxWidth: "60%" }}>{formLabel(d.form)}</b><span className="sp" /><DocChip state={d.state} /></div><div className="small muted trunc">{d.payer || "Unknown payer"} · {d.year || "no year"}</div>
          <div className="small faint">{when(T, d.at)} · {CHANNEL[d.channel] || d.channel}{d.stripped ? " · copy deleted " + rel(T, d.stripped) : d.deliveredAt ? " · handed off" : ""}</div>
          <div className="small" style={{ marginTop: 6 }}>{([["Right document", v.doc], ["Right information", v.info], ["Clear to read", v.clear]] as [string, { ok: boolean | null; why: string }][]).map(([k, x]) => <div key={k} className="row" style={{ gap: 6, flexWrap: "nowrap" }} title={x.why}><span className={"dots3"}><i className={x.ok === true ? "ok" : x.ok === false ? "no" : ""} /></span>{k}{x.ok === false ? <span className="muted trunc">: {x.why}</span> : null}</div>)}</div></div></>;
        return <button key={d.id} className="dcard" aria-label={"Open " + formLabel(d.form) + (d.payer ? " from " + d.payer : "")} onClick={() => openDoc(d.id)}>{inner}</button>; })}</div>}
  </>;
}

function Conversation({ T, e, c, openDoc }: Ctx & { openDoc: (id: string) => void }) {
  const { can, act, toast } = useFirm(), s = T.S, ms: Row[] = s.msgs.filter((m: Row) => m.engId === e.id && m.status !== "discarded"), ch = T.channelFor(c, e) || "email";
  const [text, setText] = useState(""), [edits, setEdits] = useState<Record<string, string>>({}), thread = useRef<HTMLDivElement>(null), docOf = (id: string) => s.docs.find((d: Row) => d.id === id);
  useEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [ms.length]);
  // The engine's own check, run as the person types, so a word that would be refused is flagged before Send (T-18).
  const errs: string[] = text.trim() ? T.outputCheck(text, ch, { year: e.year }).filter((x: string) => !x.startsWith("digit run")) : [];
  const send = async () => { const b = text.trim(); if (!b) return toast("Write a message first."); try { const r = await act("manual", e.id, b); if (r) toast("Not sent: " + r); else { setText(""); toast(s.firm.hound.mode === "copilot" ? "Sent." : "Sent."); } } catch { /* said */ } };
  const approve = async (m: Row) => { try { const r = await act("approveMsg", m.id, (edits[m.id] ?? m.body).trim()); toast(r ? "Not sent: " + r + "." : "Approved. It goes out now, or when sending hours begin for this client."); } catch { /* said */ } };
  let last: Date | null = null; const out: ReactNode[] = [];
  ms.forEach((m) => {
    if (m.status === "approved") { out.push(<div key={m.id} className="bub out draft" style={{ opacity: 0.85 }}>{m.body}</div>, <div key={m.id + "m"} className="meta r">Approved by {m.approvedBy || ""} · sends {m.sendAt ? tm(m.sendAt) : "in sending hours"}, when sending hours begin for this client</div>); return; }
    if (m.status === "writing") { out.push(<div key={m.id} className="bub out" style={{ opacity: 0.7 }}>The hound is writing {String(T.TPL_USE[m.tpl] || "a message").toLowerCase()}…</div>); return; }
    if (m.status === "approval") { out.push(<div key={m.id} className="bub out draft">{can() ? <textarea aria-label={"Draft: " + (T.TPL_USE[m.tpl] || "message")} value={edits[m.id] ?? m.body} onChange={(ev) => setEdits({ ...edits, [m.id]: ev.target.value })} /> : m.body}</div>,
      <div key={m.id + "m"} className="meta r" style={{ color: "var(--warn)", fontWeight: 700 }}>Draft waiting for you · {T.TPL_USE[m.tpl] || ""}{m.ai ? " · written by Claude" : ""}{can() ? <> <button className="btn sm pri" onClick={() => void approve(m)}>Approve and send</button> <button className="btn sm ghost" onClick={() => void act("rejectMsg", m.id).then(() => toast("Draft discarded."), () => {})}>Discard</button></> : null}</div>); return; }
    if (!last || last.toDateString() !== m.at.toDateString()) out.push(<div key={m.id + "d"} className="day">{m.at.toDateString() === s.now.toDateString() ? "Today" : DOW[m.at.getDay()] + " " + dshort(m.at)}</div>);
    last = m.at; const d = m.docId ? docOf(m.docId) : null, att: Row[] = (m.attachments || []).map(docOf).filter(Boolean), cls = m.dir === "in" ? "in" : m.kind === "manual" ? "man" : "out";
    const docLink = (x: Row) => <button key={x.id} className="btn sm" onClick={() => openDoc(x.id)}><Icon name="file" small />{formLabel(x.form)}</button>;
    out.push(<div key={m.id} className={"bub " + cls}>{d ? docLink(d) : m.body}{att.length ? <div className="row" style={{ gap: 6, marginTop: 8 }}>{att.map(docLink)}</div> : null}</div>);
    if (m.dir === "in" && m.understood) out.push(<div key={m.id + "u"} className="meta l" style={{ color: "var(--info)", fontWeight: 600 }}>Understood{m.ai ? " by Claude" : ""}: {m.understood}{m.aiNote ? " · " + m.aiNote : ""}</div>);
    out.push(<div key={m.id + "m"} className={"meta " + (m.dir === "in" ? "l" : "r")}>{m.dir === "in" ? c.first + (d ? " · " + (DSTATE[d.state] || [""])[0].toLowerCase() : "") : m.kind === "manual" ? m.by : "Tallyhound · " + (T.TPL_USE[m.tpl] || "") + (m.ai ? " · written by Claude" : "") + (m.approvedBy ? " · approved by " + m.approvedBy : "")} · {m.channel} · {tm(m.at)}{m.dir === "out" ? " · " + (m.failed ? "not sent" : m.status === "unconfirmed" ? "may not have gone" : "sent") : ""}</div>);
  });
  return <div className="card">
    <div className="convo" ref={thread}>{out.length ? out : <Empty small>No messages yet. Requests, replies and anything you write to {c.first} show up here.</Empty>}</div>
    {e.takeover ? <div className="note" style={{ margin: "0 18px 6px" }}><span className="grow">{e.takeover.by} has this conversation. The hound is reading and tracking, but sends nothing until it is handed back.</span>{can() ? <button className="btn sm" onClick={() => void act("handback", e.id, "").then(() => toast("Handed back. The hound picks up in about an hour."), () => {})}>Hand back</button> : null}</div> : null}
    {can() ? <div className="composer"><div className="row small muted" style={{ gap: 6 }}><Icon name={ch === "text" ? "phone" : "mail"} small />Replying by {ch} as {s.user.first} · staff messages are checked for advice words before sending</div>
      <textarea aria-label={"Write to " + c.first} placeholder={"Write to " + c.first} value={text} onChange={(ev) => setText(ev.target.value)} />
      <div className="row"><div className="pills">{["Thanks, got it.", "Could you send a clearer photo of that one?", "I'll call you today to go over it."].map((q) => <button key={q} onClick={() => setText(q)}>{q}</button>)}</div><span className="sp" /><span className="warnline" role="status">{errs.length ? "Will not send: " + errs.join(", ") : ""}</span><button className="btn pri" disabled={errs.length > 0} onClick={send}><Icon name="send" small />Send</button></div></div> : null}
  </div>;
}

function Activity({ T, e }: Ctx) {
  const tl: Row[] = e.timeline || [], ic = (t: string): IconName => /Accepted|Complete/.test(t) ? "check" : /Stuck|re-ask|Re-ask|Unreadable|Wrong/.test(t) ? "alert" : /Deliver/.test(t) ? "deliver" : "clock";
  // A few of the engine's own log lines use older words. They are shown in the product's vocabulary.
  const words = (t: string) => t.replace(/^Stuck: /, "Needs you: ").replace(/^Document sent to review: /, "Document sent to you to check: ").replace(/\bOutreach started\b/, "Collecting started").replace(/\bDelivered\b/g, "Files handed off").replace(/\bdelivered\b/g, "handed off");
  return <div className="card"><div className="list">{tl.length ? tl.map((t, i) => <div className="li" key={i}><span className="ico"><Icon name={ic(t.text)} small /></span><div className="grow">{words(t.text)}<div className="small faint">{when(T, t.at)} · {t.actor}</div></div></div>) : <Empty small>Nothing has happened yet. Every request, reply and decision for this client is listed here.</Empty>}</div></div>;
}

function Details({ T, c }: Ctx) {
  const { can, act, toast } = useFirm(), s = T.S, ro = !can();
  const [v, setV] = useState({ first: c.first, last: c.last, mobile: phone(c.mobile), email: c.email || "", tz: c.tz || "", preparer: c.preparer || "", notes: c.notes || "" });
  const set = (k: keyof typeof v) => (ev: { target: { value: string } }) => setV({ ...v, [k]: ev.target.value });
  const changed = v.mobile.replace(/\D/g, "") !== (c.mobile || "") && c.textConsent === "given";
  return <div className="col" style={{ gap: 16 }}>
    <div className="card pad col"><h3>Contact</h3><div className="grid g2">
      <label className="f">First name<input type="text" value={v.first} onChange={set("first")} disabled={ro} /></label><label className="f">Last name<input type="text" value={v.last} onChange={set("last")} disabled={ro} /></label>
      <label className="f">Mobile<input type="tel" value={v.mobile} onChange={set("mobile")} disabled={ro} /></label><label className="f">Email<input type="email" value={v.email} onChange={set("email")} disabled={ro} /></label>
      <label className="f">Time zone for sending hours<select value={v.tz} onChange={set("tz")} disabled={ro}><option value="">{!c.tz && T.zoneFor(c) ? "Guessed from the area code: " + T.ZNAME[T.zoneFor(c)] : "Same as the firm"}</option>{Object.keys(T.ZNAME).map((z) => <option key={z} value={z}>{T.ZNAME[z]}</option>)}</select></label>
      <label className="f">Preparer<select value={v.preparer} onChange={set("preparer")} disabled={ro}>{s.users.filter((u: Row) => u.role !== "read_only").map((u: Row) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="f" style={{ gridColumn: "1/-1" }}>Private staff notes (never sent, and Tallyhound does not use them)<textarea value={v.notes} onChange={set("notes")} disabled={ro} /></label></div>
      {changed ? <div className="note"><Icon name="alert" small /><span>Changing the mobile number turns texts off for {c.first} until they agree again on the new number.</span></div> : null}
      {can() ? <div><button className="btn pri" onClick={() => void act("saveClient", c.id, v).then((r) => toast(r ? String(r) : "Saved."), () => {})}>Save changes</button></div> : null}</div>
    <div className="card"><div className="hd"><h3>OK to text</h3><span className="sp" /><span className="small muted">The record of when {c.first} agreed or opted out</span></div>
      {(c.consentLog || []).length ? <div className="list">{c.consentLog.map((l: Row, i: number) => <div className="li" key={i}><span className={"ico " + (/Withdrawn|Reset/.test(l.what) ? "says_none" : "received")}><Icon name={/Withdrawn|Reset/.test(l.what) ? "x" : "check"} small /></span><div className="grow">{l.what}<div className="small faint">{when(T, l.at)} · {l.channel}</div></div></div>)}</div>
        : <div className="bd small muted">{c.first} has not agreed to texts. Email is used under your existing relationship with the client.</div>}</div>
    {s.firm.staffConsent === true && c.mobile && c.textConsent !== "given" && !ro ? <RecordConsent T={T} c={c} /> : null}
    {s.firm.hound.voicemail === true && c.mobile ? <div className="card pad col"><h3>Reminder calls</h3><p className="small muted">{c.callOk ? c.first + " has said a recorded reminder call is fine. Tallyhound places at most one, after the final written reminder." : "Tallyhound does not call " + c.first + ". Switch this on only if " + c.first + " has told your firm calls are fine."}</p>
      {ro ? null : <label className="row"><span className="toggle"><input type="checkbox" checked={!!c.callOk} onChange={(ev) => void act("setCallOk", c.id, ev.target.checked, ev.target.checked ? "Recorded on the client's page" : "").then((r) => toast(r ? String(r) + "." : ev.target.checked ? "Recorded." : "Calls are off for " + c.first + "."), () => {})} /><span /></span>{c.first} has agreed to reminder calls</label>}</div> : null}
    {(c.also || []).length ? <div className="card"><div className="hd"><h3>Second contacts</h3><span className="sp" /><span className="small muted">Messages from these are filed to {c.first}. Tallyhound never writes to them</span></div><div className="list">{c.also.map((x: Row) => <div className="li" key={x.value}><span className="ico"><Icon name={x.kind === "mobile" ? "phone" : "mail"} small /></span><div className="grow"><b>{x.kind === "mobile" ? phone(x.value) : x.value}</b><div className="small muted">Remembered {dshort(new Date(x.at))} by {x.by}</div></div>{ro ? null : <button className="btn sm ghost" onClick={() => void act("removeContact", c.id, x.value).then(() => toast("Forgotten. Messages from it will wait for a person again."), () => {})}>Forget</button>}</div>)}</div></div> : null}
    <Earlier T={T} c={c} />
  </div>;
}
// T-145: consent to texts that the firm already holds on paper, recorded by staff. Shown only when an owner has switched it on.
function RecordConsent({ T, c }: { T: Engine; c: Row }) {
  const { act, toast } = useFirm(), [how, setHow] = useState(""), [why, setWhy] = useState("");
  const save = async () => { setWhy(""); try { const r = await act("recordConsent", c.id, how.trim()); if (r) return setWhy(String(r)); setHow(""); toast("Recorded. " + c.first + " gets the text that confirms it."); } catch { /* said */ } };
  return <div className="card pad col"><h3>Record consent you already hold</h3><p className="small muted">Only if {c.first} has agreed in writing to get texts from your firm at {phone(c.mobile)}, for example in the letter they signed with your firm. Say where the agreement is, so it can be shown later. {c.first} is sent the usual confirming text and can reply STOP at any time. {T.isLandline(c) ? "This number is a landline and cannot get texts." : ""}</p>
    {why ? <div className="note bad" role="alert">{why}</div> : null}
    <label className="f">Where the agreement is<input type="text" placeholder="Client letter signed January 12" value={how} maxLength={120} onChange={(ev) => setHow(ev.target.value)} /></label>
    <div><button className="btn" disabled={how.trim().length < 5} onClick={save}>Record that {c.first} agreed</button></div></div>;
}

// Earlier tax years: a summary of each, kept when a new season starts. Which documents came in and when; never the documents themselves.
function Earlier({ T, c }: { T: Engine; c: Row }) {
  const H: Row[] = T.history(c.id); if (!H.length) return null;
  return <div className="card"><div className="hd"><h3>Earlier years</h3><span className="sp" /><span className="small muted">A summary only. The documents are in your own storage</span></div><div className="list">{H.map((a) => { const got = a.items.filter((i: Row) => i.state === "received"), none = a.items.filter((i: Row) => ["waived", "says_none"].includes(i.state));
    return <div className="li" key={a.year} style={{ alignItems: "flex-start" }}><span className="chip plain">{a.year}</span><div className="grow"><b>{got.length} of {a.items.length} documents received</b>{a.completedAt ? <span className="small muted"> · finished {dshort(a.completedAt)}</span> : null}
      <div className="small muted">{got.map((i: Row) => (i.custom || fname(T, i.form)) + (i.payer ? " from " + i.payer : "")).join(", ") || "Nothing received"}</div>{none.length ? <div className="small faint">Not needed or did not have: {none.map((i: Row) => i.custom || fname(T, i.form)).join(", ")}</div> : null}</div></div>; })}</div></div>;
}

// What this client sees, so staff can answer "what did you send me?" without guessing: the last thing Tallyhound sent them, and
// their page as it reads right now. Worked out here from the same state; the client's private link is never shown to staff.
function AsClient({ T, e, c, onClose }: Ctx & { onClose: () => void }) {
  const s = T.S, done = ["complete", "closed"].includes(e.status), open: Row[] = done ? [] : T.openItems(e.id), it: Row | null = done ? null : T.nextItem(e) || open[0] || null;
  const last: Row | undefined = s.msgs.filter((m: Row) => m.engId === e.id && m.dir === "out" && ["sent", "delivered", "unconfirmed"].includes(m.status)).slice(-1)[0], asking = !!(e.checkin && e.checkin.sentAt && !e.checkin.doneAt);
  return <Modal title={"What " + c.first + " sees"} onClose={onClose} footer={<button className="btn pri" onClick={onClose}>Done</button>}>
    <div className="col" style={{ gap: 14 }}>
      <div><h4>The last message from you</h4>{last ? <><div className="bub out" style={{ maxWidth: "100%", marginTop: 6 }}>{last.body}</div><div className="small faint" style={{ marginTop: 4 }}>{last.channel === "text" ? "Text" : "Email"}, {rel(T, last.at)}</div></> : <p className="small muted">Nothing has been sent to {c.first} yet.</p>}</div>
      <div><h4>Their page, when they open the link</h4>
        <div className="phone"><div className="phone-firm">{s.firm.name}</div>
          {done || (!it && !open.length) ? <b>{s.firm.name} already has everything. Thank you.</b>
            : asking ? <><b>A few quick questions</b><div className="small muted">So we only ask for what you have. {c.first} sees the check-in first, then the page for sending documents.</div></>
            : <><div className="small muted">We're waiting for</div><b>{it ? "your " + (it.custom || iname(T, it)) + (it.payer ? " from " + it.payer : "") : "your documents"}</b>{open.length > 1 ? <div className="small muted">and {open.length - 1} other document{open.length - 1 === 1 ? "" : "s"}.</div> : null}<div className="phone-btn">Take a photo</div><div className="phone-btn">Choose files</div></>}
          <div className="small muted">We never show documents here.</div></div>
        <p className="small muted" style={{ marginTop: 8 }}>The page never lists what {c.first} already sent, and never shows a document. Only {c.first} has the link.</p></div>
    </div></Modal>;
}

export function ClientPage() {
  const { T, can, act, toast, reload } = useFirm(), { id } = useParams(), [params, setParams] = useSearchParams(), e = id ? T.eng(id) : null, c = e ? T.client(e.clientId) : null;
  const [handOff, setHandOff] = useState<{ folder: string; files: string[]; missing: string[] } | null>(null), [purge, setPurge] = useState(false), [typed, setTyped] = useState(""), [asClient, setAsClient] = useState(false);
  if (!e || !c) return <Page title="Client"><div className="card"><Empty><b>That client is not on your list.</b><br />They may have been removed, or the address is wrong.<br /><Link className="btn" style={{ marginTop: 12 }} to="/clients">Back to Clients</Link></Empty></div></Page>;
  const s = T.S, p = T.progress(e.id), u = s.users.find((x: Row) => x.id === c.preparer), docs = s.docs.filter((d: Row) => d.engId === e.id).length, msgs = s.msgs.filter((m: Row) => m.engId === e.id && m.status !== "discarded").length, rc = T.recommend(e.id).add.length;
  const TABS: [string, string, (string | number | null)?][] = [["checklist", "Checklist", p.done + "/" + p.total], ["suggested", "Suggested", rc ? rc + " to add" : null], ["documents", "Documents", docs], ["conversation", "Conversation", msgs], ["activity", "Activity"], ["details", "Details"]];
  const tab = TABS.some((t) => t[0] === params.get("tab")) ? params.get("tab")! : "checklist", ctx = { T, e, c };
  // The viewer opens over the page and its address says which document, so a link to it can be shared with a colleague at the firm.
  const docIds: string[] = s.docs.filter((d: Row) => d.engId === e.id).sort((a: Row, b: Row) => a.at - b.at).map((d: Row) => d.id), viewing = params.get("doc");
  const openDoc = (did: string | null) => { const n = new URLSearchParams(params); if (did) n.set("doc", did); else n.delete("doc"); setParams(n); };
  // With storage connected the files are filed there. Without it, the hand-off is a zip saved to this computer.
  const zip = !s.firm.delivery || !s.firm.delivery.provider || s.firm.delivery.provider === "Download";
  const doHandOff = async () => {
    try { if (zip) { const r = await api.handOffZip(e.id); await reload(); toast(r.files ? plural(r.files, "file") + " saved as a zip." + (r.missing ? " " + plural(r.missing, "document") + " still missing: the list is inside." : "") + " Tallyhound's copies are deleted " + (T.retain().afterDelivery ? "in " + T.retain().afterDelivery + " days." : "now.") : "No accepted documents yet, so there is nothing to hand off."); }
      else setHandOff((await act("deliver", e.id)) as { folder: string; files: string[]; missing: string[] }); } catch (err) { if (zip) toast((err as Error).message); }
  };
  const consent = ({ given: ["Texts on", "good"], invited: ["Invited", "info"], withdrawn: ["Opted out", "bad"], none: ["Not OK to text yet", ""] } as Record<string, [string, string]>)[c.textConsent] || ["", ""];
  return <Page title={cname(c)}>
    <div><Link className="btn ghost sm" to="/clients"><Icon name="l" small />Clients</Link></div>
    <div className="card pad row" style={{ gap: 16 }}><Avatar first={c.first} last={c.last} />
      <div className="grow" style={{ minWidth: 200 }}><div className="row" style={{ gap: 8 }}><h1>{cname(c)}</h1><StatusChip status={e.status} /></div>
        <div className="small muted" style={{ marginTop: 4 }}>{c.spouse ? "Joint return with " + c.spouse.first + " · " : ""}{c.entity && c.entity !== c.first ? c.entity + " · " : ""}{e.year} {(T.RETURNS[e.type] || T.RETURNS["1040"]).form}{u ? " · Preparer " + u.name : ""}</div>
        <div className="row small" style={{ marginTop: 8, gap: 14 }}>{c.mobile ? <span className="row" style={{ gap: 5 }}><Icon name="phone" small />{phone(c.mobile)} <Chip tone={consent[1]}>{consent[0]}</Chip>{c.mobileBad ? <Chip tone="bad">Wrong number?</Chip> : null}{T.isLandline(c) ? <Chip tone="bad">Landline: cannot get texts</Chip> : null}</span> : null}{c.email ? <span className="row" style={{ gap: 5 }}><Icon name="mail" small />{c.email}{c.emailOk === false ? <Chip tone="bad">Bouncing</Chip> : null}</span> : null}</div></div>
      <div className="row">{can() ? <><button className="btn" onClick={() => setParams({ tab: "conversation" })}><Icon name="msg" small />Message</button>{e.status === "paused" ? <button className="btn" onClick={() => void act("resume", e.id).then(() => toast("Resumed."), () => {})}><Icon name="play" small />Resume</button> : null}{e.status !== "not_started" ? <button className="btn" onClick={doHandOff}><Icon name="deliver" small />Hand off files</button> : null}
        <Menu label="More actions">{(close) => <>
          <button onClick={() => { close(); setAsClient(true); }}><Icon name="phone" small />See it as the client</button>
          {e.status === "complete" ? <button onClick={() => { close(); void act("closeEng", e.id).then(() => toast("Closed. Tallyhound's copies are deleted after " + s.firm.retention + " days."), () => {}); }}><Icon name="lock" small />Close the file</button> : null}
          {!["complete", "closed", "paused", "not_started"].includes(e.status) ? <button onClick={() => { close(); void act("pause", e.id).then(() => toast("Paused. No automated messages until you resume."), () => {}); }}><Icon name="pause" small />Pause collecting</button> : null}
          {can("owner") ? <button className="bad" onClick={() => { close(); setTyped(""); setPurge(true); }}><Icon name="trash" small />Delete this client's documents</button> : null}
          {e.status === "not_started" && !can("owner") ? <div className="small muted" style={{ padding: 10 }}>Nothing to do here until collecting starts.</div> : null}</>}</Menu></> : null}</div></div>
    <div className="split">
      <div style={{ minWidth: 0 }}>
        <div className="tabs" role="tablist">{TABS.map((t) => <button key={t[0]} role="tab" aria-selected={tab === t[0]} className={tab === t[0] ? "on" : ""} onClick={() => setParams(t[0] === "checklist" ? {} : { tab: t[0] })}>{t[1]}{t[2] != null ? <span className="n">{t[2]}</span> : null}</button>)}</div>
        {tab === "checklist" ? <Checklist {...ctx} openDoc={openDoc} /> : tab === "suggested" ? <Suggested {...ctx} /> : tab === "documents" ? <Documents {...ctx} openDoc={openDoc} /> : tab === "conversation" ? <Conversation {...ctx} openDoc={openDoc} /> : tab === "activity" ? <Activity {...ctx} /> : <Details key={c.id + ":" + (c.mobile || "") + (c.email || "")} {...ctx} />}
      </div>
      <div className="col" style={{ gap: 16 }}>
        <HoundCard {...ctx} />
        <NextCard {...ctx} onHandOff={doHandOff} />
        <div className="card pad row" style={{ gap: 16, flexWrap: "nowrap" }}><Ring done={p.done} total={p.total} size={84} label={"of " + p.total} /><div className="col small" style={{ gap: 3 }}>{["received", "requested", "in_review", "says_none", "expected", "waived"].map((st) => { const n = T.itemsOf(e.id).filter((i: Row) => i.state === st).length; return n ? <span key={st} className="row" style={{ gap: 6 }}><span className="dots"><i className={st} /></span>{n} {(ISTATE[st] || st).toLowerCase()}</span> : null; })}</div></div>
        <div className="card pad small col" style={{ gap: 6 }}><h4>Where finished files go</h4><span>{s.firm.delivery.provider === "Download" ? "A zip you download" : s.firm.delivery.provider + " › " + s.firm.delivery.folder + " › " + e.year + " › " + (c.entity || c.last + ", " + c.first)}</span><span className="muted">{e.delivered ? "Last handed off " + when(T, e.delivered) : "Not handed off yet"}</span></div>
      </div>
    </div>
    {viewing && docIds.includes(viewing) ? <Viewer id={viewing} list={docIds} onMove={openDoc} onClose={() => openDoc(null)} /> : null}
    {handOff ? <Modal title="Files handed off" onClose={() => setHandOff(null)} footer={<button className="btn pri" onClick={() => setHandOff(null)}>Done</button>}>
      <p className="small muted">{handOff.folder}</p>
      <div className="list card" style={{ boxShadow: "none" }}>{handOff.files.length ? handOff.files.map((f) => <div className="li" key={f}><Icon name="file" small /><span className="mono" style={{ overflowWrap: "anywhere" }}>{f}</span></div>) : <div className="li muted">No accepted documents yet.</div>}</div>
      {handOff.missing.length ? <div className="note"><Icon name="alert" small /><span>Still missing: {handOff.missing.join(", ")}</span></div> : null}</Modal> : null}
    {asClient ? <AsClient T={T} e={e} c={c} onClose={() => setAsClient(false)} /> : null}
    {purge ? <Modal title={"Delete " + c.first + "'s documents?"} onClose={() => setPurge(false)} footer={<><button className="btn" onClick={() => setPurge(false)}>Cancel</button><button className="btn bad" disabled={typed.trim().toLowerCase() !== String(c.last).toLowerCase()} onClick={() => { setPurge(false); void act("purge", e.id).then(() => toast("Documents deleted."), () => {}); }}>Delete for good</button></>}>
      <p>Files and what was read from them are deleted, and message text is cleared. A record that this was done stays in the audit trail. <b>This cannot be undone.</b></p>
      <label className="f">Type the client's last name to confirm<input type="text" value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" /></label></Modal> : null}
  </Page>;
}
