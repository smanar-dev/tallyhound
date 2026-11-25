// All messages: every text, email and upload that came in, with how Tallyhound understood it, and the messages from senders
// it could not tie to a client. Ported from the demo's inbox().
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Engine } from "virtual:engine";
import { useFirm } from "../lib/firm";
import { Page } from "./Shell";
import { Empty, Icon } from "../components/ui";
import { Viewer, docTitle } from "../components/Doc";
import { cname, DSTATE, emailFirst, fname, when } from "../lib/fmt";
import type { Row } from "../lib/select";

const VIA: Record<string, string> = { text: "Text", email: "Email", portal: "Upload page", staff: "Added by staff" };
// What Tallyhound made of a message, in plain words. Empty when there is nothing useful to say.
function readAs(T: Engine, m: Row, docs: Row[]): string {
  if (m.understood) return m.understood; if (m.intent && T.KLABEL[m.intent]) return T.KLABEL[m.intent];
  if (docs.length) return docs.length === 1 ? "a " + fname(T, docs[0].form) + ", " + ((DSTATE[docs[0].state] || [""])[0] || "").toLowerCase() : docs.length + " documents";
  return "";
}

export function Messages() {
  const { T, can, act, toast } = useFirm(), s = T.S, [params, setParams] = useSearchParams(), unknown = params.get("show") === "unknown", [view, setView] = useState<string | null>(null), [pick, setPick] = useState<Record<string, string>>({});
  const docOf = (id: string) => s.docs.find((d: Row) => d.id === id), ms: Row[] = s.msgs.filter((m: Row) => m.dir === "in" && m.engId).sort((a: Row, b: Row) => b.at - a.at).slice(0, 100);
  const clients: Row[] = [...s.clients].sort((a: Row, b: Row) => String(a.last).localeCompare(b.last));
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const assign = async (y: Row) => { const cid = pick[y.id] || y.claims || clients[0]?.id; try { const r = (await act("assignUnknown", y.id, cid, !!keep[y.id])) as { ok: boolean; why?: string; first?: string; state?: string | null; remembered?: boolean }; toast(r.ok ? "Assigned to " + r.first + " and checked" + (r.state ? ": " + ((DSTATE[r.state] || [r.state])[0] || "").toLowerCase() : "") + "." + (r.remembered ? " This sender is remembered as " + r.first + "'s second contact." : "") : (r.why || "Could not assign") + "."); } catch { /* said */ } };
  const tabs = <div className="tabs" role="tablist"><button role="tab" aria-selected={!unknown} className={unknown ? "" : "on"} onClick={() => setParams({})}>Every message in</button><button role="tab" aria-selected={unknown} className={unknown ? "on" : ""} onClick={() => setParams({ show: "unknown" })}>Unknown senders<span className="n">{s.tray.length}</span></button></div>;
  return <Page title="All messages">
    {unknown ? <>{tabs}
      <p className="muted">Things that arrived from {emailFirst(T) ? "an address" : "a number or address"} Tallyhound could not tie to a client, or whose sender it could not confirm. Nothing was sent back and nothing reached a client's file.</p>
      {s.tray.length ? s.tray.map((y: Row) => { const d = y.docId ? docOf(y.docId) : null, notice = !d && !y.spec && (y.why === "Could not be processed" || y.why === "Blocked by the virus scan");
        return <div className="card pad row" style={{ gap: 16 }} key={y.id}>{d ? <button className="btn" onClick={() => setView(d.id)}><Icon name="file" small />See the file</button> : <div className="bub in" style={{ maxWidth: 320 }}>{y.text || "(no text)"}</div>}
          <div className="grow" style={{ minWidth: 220 }}><b>{d ? "A " + docTitle(T, d) + (d.payer ? " from " + d.payer : "") : notice ? "A notice from Tallyhound" : "A message"}</b><div className="small muted">From {y.from} · {when(T, y.at)} · {VIA[y.channel] || y.channel}</div>
            {y.why ? <div className="note info" style={{ marginTop: 8 }}><Icon name="alert" small /><span>{y.why}</span></div> : null}{d && y.text ? <div className="small" style={{ marginTop: 6 }}>{y.text}</div> : null}</div>
          {can() ? notice ? <button className="btn" onClick={() => void act("discardUnknown", y.id).then(() => toast("Dismissed."), () => {})}>Dismiss</button>
            : <div className="col" style={{ gap: 6, minWidth: 220 }}><select aria-label="Whose is this?" value={pick[y.id] || y.claims || clients[0]?.id || ""} onChange={(ev) => setPick({ ...pick, [y.id]: ev.target.value })}>{clients.map((c) => <option key={c.id} value={c.id}>{cname(c)}</option>)}</select>{y.from && !/second contact/.test(String(y.from)) && !y.why ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!keep[y.id]} onChange={(ev) => setKeep({ ...keep, [y.id]: ev.target.checked })} />Remember this sender for this client. Tallyhound never writes to it first</label> : null}<div className="row"><button className="btn pri" disabled={!clients.length} onClick={() => void assign(y)}>Assign and check</button><button className="btn bad" onClick={() => void act("discardUnknown", y.id).then(() => toast("Discarded."), () => {})}>Discard</button></div></div> : null}</div>; })
        : <div className="card"><Empty><div className="big"><Icon name="check" /></div><b>Everything that arrived was matched to a client.</b><br />A message from {emailFirst(T) ? "an address" : "a number or address"} you do not have on file shows up here for you to say whose it is.<br /><Link className="btn" style={{ marginTop: 12 }} to="/clients">See your clients</Link></Empty></div>}</>
      : <><p className="muted">{emailFirst(T) ? "Every email and upload from clients" : "Every text, email and upload from clients"}, with how Tallyhound understood it and what it did.</p>{tabs}
        <div className="card">{ms.length ? <div className="list">{ms.map((m) => { const e = T.eng(m.engId), c = e ? T.client(e.clientId) : null; if (!c) return null; const docs: Row[] = (m.docId ? [docOf(m.docId)] : (m.attachments || []).map(docOf)).filter(Boolean), read = readAs(T, m, docs);
          const acts: string[] = (m.actions || []).map((a: string) => { const [f, st] = a.split("|") as [string, string]; return st === "later" ? fname(T, f) + ": coming later" : st === "none" ? fname(T, f) + ": says none" : st === "question" ? "Question to preparer" : (f === "OTHER" ? "Document" : fname(T, f)) + ": " + ((DSTATE[st] || [st])[0] || "").toLowerCase(); });
          return <div className="li" style={{ alignItems: "flex-start" }} key={m.id}><span className="ico" style={{ width: 32, height: 32 }}><Icon name={m.channel === "email" ? "mail" : m.channel === "portal" ? "upload" : "phone"} small /></span>
            <div className="grow"><div className="row" style={{ gap: 6 }}><b>{cname(c)}</b><span className="small faint">{VIA[m.channel] || m.channel} · {when(T, m.at)}</span></div>
              {m.docId ? null : <div className="small" style={{ margin: "3px 0" }}>{String(m.body || "").slice(0, 160)}</div>}
              {docs.length ? <div className="row" style={{ gap: 6, margin: "6px 0" }}>{docs.map((d) => <button key={d.id} className="btn sm" onClick={() => setView(d.id)}><Icon name="file" small />{docTitle(T, d)}</button>)}</div> : null}
              {read ? <div className="small" style={{ color: "var(--info)", fontWeight: 600 }}>Read as: {read}{m.ai ? " (by Claude)" : ""}</div> : null}{acts.length ? <div className="small muted">Did: {acts.join("; ")}</div> : null}</div>
            <Link className="btn sm" to={"/clients/" + e.id + "?tab=conversation"}>Open client</Link></div>; })}</div>
          : <Empty>Nothing has come in yet. Every reply, photo and email from a client is listed here as it arrives.<br /><Link className="btn" style={{ marginTop: 12 }} to="/clients">See your clients</Link></Empty>}</div></>}
    {view ? <Viewer id={view} list={[view]} onMove={setView} onClose={() => setView(null)} /> : null}
  </Page>;
}
