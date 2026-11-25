// The follow-up plan for one client (TH-PLN-6): a week grid with a row per document and one for your staff, a legend, and the exact
// wording of any ask. Read only, apart from holding one document until a date, clearing the hold, or asking for it now. The plan
// is worked out by apps/server/src/plan.ts from the state this screen already holds, by running the engine's own scheduler ahead,
// so it changes the moment anything about the client does.
import { useMemo, useState } from "react";
import { createEngine, type Engine } from "virtual:engine";
import { planFor, type PlanEvent } from "../../../server/src/plan";
import { useFirm } from "../lib/firm";
import { emailFirst, iname } from "../lib/fmt";
import { Icon } from "../components/ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;
const DOW = ["M", "T", "W", "T", "F", "S", "S"], DAY = 86400000;
const MARK: Record<string, [string, string]> = { request: ["\u2192", "Request"], reminder: ["\u2022", "Reminder"], final: ["\u2022", "Last reminder"], arrived: ["\u2713", "Arrived"], cancelled: ["\u00d7", "Cancelled"], quiet: ["!", "Bark"] };
const WHY: Record<string, string> = { arrived: "the document arrived", paused: "it was discarded or replaced", opted_out: "the client opted out", item_waived: "marked not needed", client_date: "the client named a date", catalogue_date: "the form is not usually issued until then", staff_date: "your firm set the date", no_reply: "no reply after the last reminder" };
const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), ymd = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

export function PlanTab({ T, e, c }: { T: Engine; e: Row; c: Row }) {
  const { can, act, toast } = useFirm(), P = useMemo(() => planFor(T, e.id, createEngine), [T, e.id]), items: Row[] = T.itemsOf(e.id);
  const EM = emailFirst(T), [sel, setSel] = useState<string | null>(null), [via0, setVia] = useState<"text" | "email">("text"), via: "text" | "email" = EM ? "email" : via0, [menu, setMenu] = useState<string | null>(null), [date, setDate] = useState("");
  // Monday of the first week, and enough weeks to show the last thing planned.
  const first = P.day0 || P.generated_at, mon = new Date(first.getFullYear(), first.getMonth(), first.getDate() - ((first.getDay() + 6) % 7)), lastAt = P.events.reduce((m, x) => Math.max(m, +(x.until || x.date)), +first);
  const weeks = Math.max(2, Math.min(9, Math.ceil((lastAt - +mon + DAY) / (7 * DAY)))), col = (d: Date) => Math.floor((+new Date(d.getFullYear(), d.getMonth(), d.getDate()) - +mon) / DAY), cols = weeks * 7;
  const cell = (rowId: string | null, i: number) => P.events.filter((x) => (rowId === null ? x.kind === "quiet" : x.item_id === rowId) && x.kind !== "held" && col(x.date) === i);
  const held = (rowId: string, i: number) => P.events.some((x) => x.kind === "held" && x.item_id === rowId && i >= col(x.date) && i < col(x.until!));
  const key = (x: PlanEvent) => x.kind + ":" + (x.item_id || "") + ":" + +x.date, shown = P.events.filter((x) => x.kind !== "held"), cur = shown.find((x) => key(x) === sel) || shown.find((x) => x.status === "planned" && x.preview) || null, chan = cur && cur.preview ? cur.preview.channels : null;
  const run = (fn: string, ...a: unknown[]) => void act(fn, ...a).then((r) => { toast(r ? String(r) + "." : "Saved. The plan is updated."); setMenu(null); setDate(""); }, () => {});
  const label = (x: PlanEvent) => MARK[x.kind]![1] + ", " + day(x.date) + (x.status === "planned" ? ", planned" : x.status === "cancelled" ? ", cancelled" + (x.reason ? ": " + (WHY[x.reason] || x.reason) : "") : x.kind === "arrived" ? "" : ", " + x.status);
  return <div className="col" style={{ gap: 16 }}>
    <div className="card"><div className="hd"><h3>Follow-up plan</h3><span className="sp" /><span className="chip plain">{P.preset_label}</span></div>
      {P.note ? <div className="bd"><div className="note info"><Icon name="clock" small /><span>{P.note}.</span></div></div> : null}
      <div className="plangrid" role="table" aria-label={"Follow-up plan for " + c.first} style={{ gridTemplateColumns: "minmax(140px, 1.4fr) repeat(" + cols + ", minmax(18px, 1fr)) 34px" }}>
        <div role="row" className="pg-head"><span role="columnheader" />{Array.from({ length: cols }, (_, i) => <span role="columnheader" key={i} className={(i % 7 === 6 ? "sun" : "") + (i % 7 === 0 ? " wk" : "")}>{i % 7 === 0 ? <small>Week {i / 7 + 1}</small> : null}{DOW[i % 7]}</span>)}<span /></div>
        {items.map((it) => { const h = P.events.find((x) => x.kind === "held" && x.item_id === it.id); return <div role="row" key={it.id} className="pg-row">
          <span role="rowheader" className="trunc" title={iname(T, it)}>{iname(T, it)}{h ? <small> held until {day(h.until!)}</small> : null}</span>
          {Array.from({ length: cols }, (_, i) => { const L = cell(it.id, i); return <span role="cell" key={i} className={(i % 7 === 6 ? "sun" : "") + (held(it.id, i) ? " held" : "")}>{L.map((x) => <button key={x.id} className={"pm " + x.kind + " " + x.status + (cur && key(cur) === key(x) ? " on" : "")} aria-label={label(x)} title={label(x)} onClick={() => setSel(key(x))}>{MARK[x.kind]![0]}</button>)}</span>; })}
          <span>{can() && T.OPEN.includes(it.state) ? <button className="btn sm ghost icon" aria-label={"Change when " + iname(T, it) + " is asked for"} aria-expanded={menu === it.id} onClick={() => { setMenu(menu === it.id ? null : it.id); setDate(""); }}><Icon name="clock" small /></button> : null}</span>
          {menu === it.id ? <div className="pg-menu"><label className="f">Hold until<input type="date" min={ymd(new Date(+T.S.now + DAY))} value={date} onChange={(ev) => setDate(ev.target.value)} /></label><button className="btn sm" disabled={!date} onClick={() => run("setHold", it.id, date)}>Hold</button>{h ? <button className="btn sm" onClick={() => run("setHold", it.id, "")}>Clear hold</button> : null}<button className="btn sm" onClick={() => run("askNow", it.id)}>Ask now</button><span className="small muted">{EM ? "Ask now still keeps to working days and one letter a day." : "Ask now still keeps to sending hours and one automatic message a day."}</span></div> : null}</div>; })}
        <div role="row" className="pg-row staff"><span role="rowheader">Your staff</span>{Array.from({ length: cols }, (_, i) => <span role="cell" key={i} className={i % 7 === 6 ? "sun" : ""}>{cell(null, i).map((x) => <button key={x.id} className={"pm quiet " + x.status + (cur && key(cur) === key(x) ? " on" : "")} aria-label={label(x)} title={label(x)} onClick={() => setSel(key(x))}>!</button>)}</span>)}<span /></div>
      </div>
      <div className="bd pg-legend small muted"><span><b className="pm request">{MARK.request![0]}</b> request</span><span><b className="pm reminder">{MARK.reminder![0]}</b> reminder</span><span><b className="pm arrived">{MARK.arrived![0]}</b> arrived</span><span><b className="pm cancelled">{MARK.cancelled![0]}</b> cancelled</span><span><i className="heldkey" /> held</span><span><b className="pm quiet">!</b> bark to your staff</span><span className="swipe">Swipe to see all weeks</span></div></div>
    {cur ? <div className="card pad col planpreview"><div className="row"><h3 className="grow">{MARK[cur.kind]![1]}, {day(cur.date)}{cur.status === "planned" && cur.window ? ", " + cur.window.start.replace(":00", "") + " am to " + (+cur.window.end.slice(0, 2) % 12 || 12) + " pm (" + c.first + "'s time)" : ""}</h3>
        {cur.preview && !EM ? <div className="pills" role="group" aria-label="Preview by">{(["text", "email"] as const).map((k) => <button key={k} className={via === k ? "on" : ""} aria-pressed={via === k} disabled={!chan![k].available} title={chan![k].unavailable_reason || ""} onClick={() => setVia(k)}>{k === "text" ? "Text" : "Email"}{chan![k].available ? "" : ": " + chan![k].unavailable_reason}</button>)}</div> : null}</div>
      {cur.preview ? <><div className="bub out" style={{ maxWidth: "100%" }}>{cur.preview.body}</div><p className="small muted">A preview of what goes {cur.channel === "email" ? "by email" : "by text"}{cur.fallback_channel ? ", and by email too" : ""}, in {T.VOICES[T.voiceFor(c)].label}. It is what will be sent unless something changes first: a reply, a document, a pause or a hold. Nothing can be sent from here.{chan && !chan[via].available ? " " + (via === "text" ? "Text" : "Email") + " is not available: " + chan[via].unavailable_reason + "." : ""}</p></>
        : <p className="small muted">{cur.kind === "arrived" ? "The document arrived and passed the sniff test, so the asks after it were cancelled." : cur.kind === "cancelled" ? "This ask will not be sent: " + (WHY[cur.reason || ""] || "it is no longer needed") + "." : cur.kind === "quiet" ? (cur.status === "planned" ? "If nobody replies by then, " + c.first + " goes quiet: reminders stop and your staff get a call card in the review queue." : c.first + " has gone quiet. A call card is in the review queue.") : (T.TPL_USE[cur.template || ""] || "A message") + " went " + (cur.channel === "email" ? "by email" : "by text") + (cur.fallback_channel ? " and by email" : "") + (cur.sent_at ? " at " + cur.sent_at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "") + ". The words are on the Conversation tab."}</p>}</div> : null}
  </div>;
}
