// A document: the picture, and everything Tallyhound knows about it. Used by the full-screen viewer and by Needs you.
// The three checks are T.verdict's answers and nothing here works one out (ticket T-40).
import { api } from "../lib/api";
import { useEffect, useState, type ReactNode } from "react";
import type { Engine } from "virtual:engine";
import { useFirm } from "../lib/firm";
import { cname, fname, iname, when } from "../lib/fmt";
import type { Row } from "../lib/select";
import { DocChip, Icon } from "./ui";

export const docTitle = (T: Engine, d: Row) => (d.form === "OTHER" ? "Other document" : fname(T, d.form));
const CHANNEL: Record<string, string> = { text: "text", email: "email", portal: "upload page", staff: "added by staff" };

/** The file itself. A photo is shown and can be zoomed and turned. A PDF is shown as pictures of its pages, drawn on the server;
 *  when several forms came as one file, only this document's own pages are shown. */
export function DocImage({ d, zoom, rot }: { d: Row; zoom: number; rot: number }) {
  const [kind, setKind] = useState<"image" | "other">("image"), [count, setCount] = useState<number | null>(null), src = "/api/documents/" + d.id + "/file";
  useEffect(() => { setKind("image"); setCount(null); }, [d.id]);
  useEffect(() => { if (kind !== "other") return; let on = true; api.get<{ count: number }>("/api/documents/" + d.id + "/pages").then((r) => { if (on) setCount(r.count); }, () => { if (on) setCount(0); }); return () => { on = false; }; }, [kind, d.id]);
  if (!d.fileKey || d.stripped || d.state === "purged") return <div className="nofile"><Icon name="file" /><b>Tallyhound no longer holds a copy.</b><span className="small">{d.deliveredAt ? "The original is in your firm's storage." : "It was deleted on schedule or by an owner."}</span></div>;
  if (kind === "other" && count === null) return <div className="nofile" role="status">Opening…</div>;
  if (kind === "other" && count) {
    const own: number[] = Array.isArray(d.pagesOf) && d.pagesOf.length ? d.pagesOf.filter((n: number) => n >= 1 && n <= count) : Array.from({ length: count }, (_, i) => i + 1), shown = own.slice(0, 20);
    return <div className="pdfpages">{own.length < count ? <div className="pagenote">{own.length === 1 ? "Page " + own[0] : "Pages " + own.join(", ")} of a {count}-page file. The other pages are other documents.</div> : null}
      {shown.map((n) => <img key={n} className="docimg" loading="lazy" src={"/api/documents/" + d.id + "/page/" + n} alt={"Page " + n + " as it arrived"} style={{ transform: "scale(" + zoom + ") rotate(" + rot + "deg)" }} />)}
      {own.length > shown.length ? <a className="btn" href={src} target="_blank" rel="noreferrer"><Icon name="eye" small />Open the whole file ({own.length} pages)</a> : null}</div>;
  }
  if (kind === "other") return <div className="nofile"><Icon name="file" /><b>This one opens in its own tab.</b><span className="small">This kind of file cannot be shown inside this page.</span><a className="btn" href={src} target="_blank" rel="noreferrer"><Icon name="eye" small />Open the file</a></div>;
  return <img className="docimg" src={src} alt={"The document as it arrived"} style={{ transform: "scale(" + zoom + ") rotate(" + rot + "deg)" }} onError={() => setKind("other")} />;
}

function Three({ T, d }: { T: Engine; d: Row }) {
  const v = T.verdict(d), row = (x: { ok: boolean | null; why: string }, t: string) => { const k = x.ok === true ? "ok" : x.ok === false ? "no" : "na"; return <div className={"v3 " + k}><span className={"ci " + k}><Icon name={x.ok === true ? "check" : x.ok === false ? "x" : "minus"} /></span><div><b>{t}</b><div className="small muted">{x.why}</div></div></div>; };
  return <div className="sec"><h4>Three checks</h4><div className="v3s">{row(v.doc, "Right document")}{row(v.info, "Right information")}{row(v.clear, "Clear to read")}</div></div>;
}

/** Everything beside the picture: the verdict, the decision, what was read, the required parts. onDecided runs after a decision is saved. */
export function DocSide({ d, onDecided, keys }: { d: Row; onDecided?: () => void; keys?: boolean }) {
  const { T, can, act, toast } = useFirm(), s = T.S, e = d.engId ? T.eng(d.engId) : null, c = e ? T.client(e.clientId) : d.clientId ? T.client(d.clientId) : null;
  const task: Row | undefined = s.tasks.find((t: Row) => t.docId === d.id && t.status === "open"), edit = can() && (!!task || d.state === "accepted");
  const [form, setForm] = useState<string>(d.form), [year, setYear] = useState(String(d.year || "")), [payer, setPayer] = useState<string>(d.payer || ""), [why, setWhy] = useState("illegible");
  useEffect(() => { setForm(d.form); setYear(String(d.year || "")); setPayer(d.payer || ""); setWhy("illegible"); }, [d.id, d.form, d.year, d.payer]);
  const decide = async (decision: string, p?: unknown, said?: string) => { try { const r = await act("decideTask", task!.id, decision, p ?? null); toast(r ? String(r) : said || "Done."); if (!r && onDecided) onDecided(); } catch { /* said */ } };
  const correct = async () => { if (task) return decide("correct", { form, year, payer }, "Correction saved and accepted."); try { const r = await act("correctDoc", d.id, { form, year, payer }); toast(r ? String(r) : "Correction saved. The file name updates the next time files are handed off."); } catch { /* said */ } };
  // A document nobody asked for by form: which of the firm's own requests is it?
  const customs: Row[] = task && e && d.form === "OTHER" ? T.itemsOf(e.id).filter((i: Row) => i.custom && T.OPEN.includes(i.state)) : [];
  const els: Row[] = d.elements || [], gaps = els.filter((x) => x.status !== "present" && x.required), pct = Math.round((d.conf || 0) * 100), acceptAt: number = s.firm.acceptAt;
  const sec = (title: string, body: ReactNode, right?: ReactNode) => <div className="sec col" style={{ gap: 8 }}><div className="row"><h4>{title}</h4>{right ? <><span className="sp" />{right}</> : null}</div>{body}</div>;
  return <>
    <div className="sec"><div className="row" style={{ gap: 8 }}><DocChip state={d.state} />{task ? <span className="chip warn plain">{task.reason === "Low confidence" ? "Tallyhound was not sure" : task.reason}</span> : null}</div>
      <p style={{ marginTop: 8 }}>{(d.reasons || []).join(" ") || "Checking."}</p>
      {d.read && d.read.note ? <div className="note info" style={{ marginTop: 10 }}><Icon name="spark" small /><span>{d.read.by === "text" ? "Read from the text inside the PDF: " : "Claude read it: "}{d.read.note}</span></div> : null}</div>
    <Three T={T} d={d} />
    {task && can() && customs.length ? sec("Which request is this?", <>{customs.map((i) => <button key={i.id} className={"btn" + (d.matchItem === i.id ? " pri" : "")} style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => void decide("accept", { itemId: i.id }, "Accepted against that request.")}><Icon name="check" small />{i.custom}{d.matchItem === i.id ? <span className="small" style={{ marginLeft: "auto", opacity: 0.8 }}>best match</span> : null}</button>)}<p className="small muted">Pick one to accept the document against that request.</p></>) : null}
    {task && can() ? sec(customs.length ? "Or" : "Your decision", <>
      <button className={"btn" + (customs.length ? "" : " pri")} onClick={() => void decide("accept", null, "Accepted.")}><Icon name="check" small />Accept as read{keys ? <span className="kbd" style={{ marginLeft: "auto" }}>A</span> : null}</button>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><select style={{ flex: 1, minWidth: 0 }} aria-label="Why ask again" value={why} onChange={(ev) => setWhy(ev.target.value)}><option value="illegible">Hard to read: ask for a retake</option><option value="wrong_year">Wrong year: ask for {e ? e.year : s.firm.taxYear}</option><option value="missing_page">A page is missing</option></select><button className="btn" onClick={() => void decide("reask", { reason: why }, "Asked again. " + (c ? c.first : "The client") + " gets one plain sentence saying what to fix.")}>Ask again</button></div>
      <button className="btn bad" onClick={() => void decide("discard", { reason: "not needed" }, "Discarded.")}><Icon name="trash" small />Discard: not needed</button></>) : null}
    {sec("What Tallyhound read", <><div className="vfields">
      <label className="f full">Form<select value={form} disabled={!edit} onChange={(ev) => setForm(ev.target.value)}>{Object.keys(T.FORMS).map((k) => <option key={k} value={k}>{k === "OTHER" ? "Other document" : T.FORMS[k].plain}</option>)}</select></label>
      <label className="f full">Tax year<input type="number" value={year} disabled={!edit} onChange={(ev) => setYear(ev.target.value)} /></label>
      <label className="f full">Payer<input type="text" value={payer} disabled={!edit} onChange={(ev) => setPayer(ev.target.value)} /></label>
      <label className="f full">Name on the form<input type="text" value={d.recipientName || "Not read"} disabled readOnly /></label></div>
      {edit ? <button className="btn" onClick={() => void correct()}>Save correction{task ? " and accept" : ""}</button> : null}</>, edit ? <span className="small faint">Edit to correct</span> : null)}
    {els.length ? sec("Required parts", <><div>{els.map((x) => <div className="chk" key={x.key || x.label}><span className={"ci " + (x.status !== "missing" ? "ok" : x.required ? "no" : "na")}><Icon name={x.status !== "missing" ? "check" : "x"} /></span><div>{x.label}{x.status === "supplied" ? <span className="small faint"> (sent separately)</span> : null}{x.required ? null : <span className="small faint"> (optional for your firm)</span>}</div></div>)}</div>
      {d.state === "incomplete" && gaps.length ? <div className="note"><Icon name="send" small /><span>Tallyhound asked the client for {T.missText(gaps.map((x) => x.key), "en", d.form).fix} and keeps reminding until it arrives.</span></div> : null}</>, <span className={"small " + (gaps.length ? "bad-text" : "faint")}>{els.filter((x) => x.status !== "missing").length} of {els.length} present</span>) : null}
    {d.conf != null ? sec("How sure Tallyhound was", <><div className="meter"><i style={{ width: pct + "%", background: d.conf >= acceptAt ? "var(--good)" : "var(--accent)" }} /><u style={{ left: acceptAt * 100 + "%" }} /></div><div className="small muted">Accepted on its own at {acceptAt.toFixed(2)} or above.{d.capReason ? " Held back: " + d.capReason + "." : ""}</div></>, <b>{Number(d.conf).toFixed(2)}</b>) : null}
    {d.state === "accepted" && c && e ? sec("Filed as", <div className="mono" style={{ overflowWrap: "anywhere" }}>{T.fileName(c, e, d)}</div>) : null}
    {sec("History", <div className="small"><div>Received {when(T, d.at)} by {CHANNEL[d.channel] || d.channel}{c ? " from " + cname(c) : ""}</div>{(d.versions || []).map((v: Row) => <div className="muted" key={v.v}>v{v.v}: {v.form} {v.year} {v.payer || ""} · {v.by}</div>)}{d.itemId ? (() => { const it = s.items.find((i: Row) => i.id === d.itemId); return it ? <div className="muted">Counts for: {iname(T, it)}{it.payer ? " from " + it.payer : ""}</div> : null; })() : null}</div>)}
  </>;
}

/** The full-screen viewer: the picture, zoom and turn, previous and next, and the panel. Keys: arrows, + and -, A to accept, Escape. */
export function Viewer({ id, list, onMove, onClose }: { id: string; list: string[]; onMove: (id: string) => void; onClose: () => void }) {
  const { T, can, act, toast } = useFirm(), d: Row | undefined = T.S.docs.find((x: Row) => x.id === id), [zoom, setZoom] = useState(1), [rot, setRot] = useState(0), i = list.indexOf(id);
  useEffect(() => { setZoom(1); setRot(0); }, [id]);
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement; if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) { if (ev.key === "Escape") t.blur(); return; }
      if (ev.key === "Escape") onClose(); else if (ev.key === "ArrowLeft" && i > 0) onMove(list[i - 1]!); else if (ev.key === "ArrowRight" && i >= 0 && i < list.length - 1) onMove(list[i + 1]!);
      else if (ev.key === "+" || ev.key === "=") setZoom((z) => Math.min(3, z + 0.15)); else if (ev.key === "-") setZoom((z) => Math.max(0.3, z - 0.15));
      else if ((ev.key === "a" || ev.key === "A") && can() && d) { const task = T.S.tasks.find((x: Row) => x.docId === d.id && x.status === "open"); if (task) void act("decideTask", task.id, "accept", null).then((r) => toast(r ? String(r) : "Accepted."), () => {}); }
    };
    document.addEventListener("keydown", key); return () => { document.removeEventListener("keydown", key); if (was && document.contains(was)) was.focus(); };
  }, [T, d, i, list, onMove, onClose, can, act, toast]);
  if (!d) return null;
  const e = d.engId ? T.eng(d.engId) : null, c = e ? T.client(e.clientId) : null;
  return <div className="viewer" role="dialog" aria-modal="true" aria-label="Document viewer">
    <div className="vtop"><button className="btn sm" autoFocus onClick={onClose}><Icon name="x" small />Close</button>
      <div style={{ minWidth: 0 }}><b>{c ? cname(c) : "Unknown sender"} · {docTitle(T, d)}</b><div className="small vsub">{d.payer ? d.payer + " · " : ""}{when(T, d.at)} by {CHANNEL[d.channel] || d.channel}</div></div><span className="sp" />
      <div className="vtools"><button aria-label="Zoom out" onClick={() => setZoom(Math.max(0.3, zoom - 0.15))}><Icon name="minus" small /></button><button aria-label="Actual size" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom(Math.min(3, zoom + 0.15))}><Icon name="plus" small /></button><button aria-label="Turn" onClick={() => setRot((rot + 90) % 360)}><Icon name="rotate" small /></button></div>
      {list.length > 1 ? <div className="vtools"><button aria-label="Previous document" disabled={i <= 0} onClick={() => onMove(list[i - 1]!)}><Icon name="l" small /></button><span className="small" style={{ padding: "0 4px" }}>{i + 1} of {list.length}</span><button aria-label="Next document" disabled={i >= list.length - 1} onClick={() => onMove(list[i + 1]!)}><Icon name="r" small /></button></div> : null}</div>
    <div className="vbody"><div className="vstage"><DocImage d={d} zoom={zoom} rot={rot} /></div><div className="vside"><DocSide d={d} keys />
      <div className="sec small faint">Keys: <span className="kbd">←</span> <span className="kbd">→</span> move between documents, <span className="kbd">+</span> <span className="kbd">-</span> zoom, <span className="kbd">Esc</span> close.</div></div></div>
  </div>;
}
