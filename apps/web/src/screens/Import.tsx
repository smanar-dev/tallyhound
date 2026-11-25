// Add clients for an email-first firm (docs/FETCH.md, "Import flow"): three steps. Bring in the client list, add last year's
// records, then check the fetch lists and approve them. The batch keeps its place for 30 days, so the address carries only its id
// and the step, and leaving and coming back picks up where it was. Rows become clients when the columns are confirmed, with no list
// approved: nothing is sent to anyone until the firm approves their list. Every count and status here is the engine's.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useFirm } from "../lib/firm";
import { api } from "../lib/api";
import { Page } from "./Shell";
import { Modal } from "../components/Modal";
import { Chip, Icon } from "../components/ui";
import { FetchList } from "../components/FetchList";
import { plural, when } from "../lib/fmt";
import { foundWords, KIND, MAX_PDF, readInBrowser } from "../lib/records";
import type { Row } from "../lib/select";

const STEPS = ["Bring in clients", "Last year's records", "Fetch lists"];
const NOTHING_SENT = "Nothing is sent to anyone until you approve their list.";
const FIELD: Record<string, string> = { "": "Leave out", first: "First name", last: "Last name", name: "Full name", email: "Email", mobile: "Phone", spouse: "Spouse", ref: "Client ID", returning: "Returning client?", preparer: "Preparer", lang: "Language", tz: "State or time zone", entity: "Business or trust name", rtype: "Kind of return", docs: "Documents needed" };
const ROW: Record<string, [string, string]> = { ok: ["New client", "good"], no_email: ["New, no email yet", "warn"], updated: ["Updated", "info"], same: ["Already here, unchanged", ""], duplicate: ["Already a client", ""], possible_duplicate: ["Decide", "warn"], rejected: ["Left out", "bad"], skipped: ["Skipped", ""] };
const STATUS: Record<string, string> = { mapping: "Matching columns", records: "Adding last year's records", review: "Checking fetch lists" };
const MAX_LIST = 5 * 1024 * 1024;

export function ImportWizard() {
  const { T, can } = useFirm(), [params] = useSearchParams(), bid = params.get("batch") || "", v: Row | null = bid ? T.importView(bid) : null;
  const step = !v ? 1 : v.status === "review" ? 3 : v.status === "records" && params.get("step") === "2" ? 2 : 1;
  if (!can()) return <Page title="Add clients"><div className="card pad"><p>Your account can look but not change things, so it cannot add clients. Ask an owner to change your role.</p><Link className="btn" to="/clients">See your clients</Link></div></Page>;
  return <Page title="Add clients"><div className="narrow">
    <ol className="steps" style={{ marginBottom: 16 }}>{STEPS.map((x, i) => <li key={x} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""} aria-current={step === i + 1 ? "step" : undefined}>{step > i + 1 ? "✓ " : i + 1 + ". "}{x}</li>)}</ol>
    {bid && !v ? <div className="card pad col"><p><b>That import has expired or is finished.</b> An import keeps its place for 30 days.</p><div><Link className="btn pri" to="/add-clients">Start a new import</Link></div></div>
      : !v ? <Start /> : v.status === "mapping" ? <Columns v={v} /> : step === 1 ? <Results v={v} /> : step === 2 ? <Records v={v} /> : <Lists v={v} />}
  </div></Page>;
}

/** Step 1: choose the client list (CSV or a spreadsheet), or pick up an import already started. */
function Start() {
  const { T, act, toast } = useFirm(), [, setParams] = useSearchParams(), [busy, setBusy] = useState(false), open: Row[] = T.importsOpen();
  const begin = async (name: string, text: string) => { const r = (await act("importBegin", name, text)) as Row; if (!r || r.error) return toast((r && r.error ? r.error : "That file could not be read") + "."); setParams({ batch: r.id }); };
  const pick = async (f?: File) => {
    if (!f) return; if (f.size > MAX_LIST) return toast("That file is over 5 MB. Export just the client list.");
    setBusy(true);
    try { if (/\.xlsx$/i.test(f.name)) await begin(f.name, await api.xlsxToCsv(f)); else if (/\.(xls|numbers)$/i.test(f.name)) toast("Save it as .xlsx or CSV first."); else await begin(f.name, await f.text()); }
    catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };
  return <div className="col" style={{ gap: 16 }}>
    {open.length ? <div className="card"><div className="hd"><h3>Pick up where you left off</h3></div><ul className="list plainlist">{open.map((b) => <li className="li" key={b.id}><span className="ico"><Icon name="file" small /></span><div className="grow" style={{ minWidth: 0 }}><b className="trunc">{b.file}</b><div className="small muted">{STATUS[b.status] || ""} · {plural(b.rows, "row")} · started {when(T, new Date(b.at))}</div></div><button className="btn sm" onClick={() => setParams(b.status === "records" ? { batch: b.id, step: "2" } : { batch: b.id })}>Pick up</button></li>)}</ul></div> : null}
    <div className="card pad col">
      <h3>Bring in your client list</h3>
      <p className="small muted">A CSV or an Excel file from your tax software or practice tool. Leave every column in: Tallyhound uses names, email, phone, spouse and client ID. Columns such as Social Security number, date of birth, bank details and fees are spotted and never imported.</p>
      <div className="drop"><label className="btn pri">{busy ? "Reading the file" : "Choose the file"}<input type="file" accept=".csv,text/csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={busy} onChange={(ev) => { void pick(ev.target.files?.[0]); ev.target.value = ""; }} /></label><p className="small muted" style={{ marginTop: 8 }}>{NOTHING_SENT}</p></div>
      <div className="note info"><Icon name="plus" small /><span className="grow">Only a handful of clients?</span><Link className="btn" to="/clients?do=add">Add one client</Link></div></div>
  </div>;
}

/** Step 1, the columns: Tallyhound's guess for each, the firm's last choice for the same file, and sensitive columns locked out. */
function Columns({ v }: { v: Row }) {
  const { T, act, toast } = useFirm(), [map, setMap] = useState<string[]>(v.map), [busy, setBusy] = useState(false), sample: string[][] = v.sample || [];
  useEffect(() => setMap(v.map), [v.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setBusy(true); try { const r = (await act("importMap", v.id, map)) as Row; if (r && r.error) toast(r.error + "."); } catch { /* said */ } finally { setBusy(false); } };
  return <div className="card pad col">
    <h3>Match the columns</h3>
    <p className="small muted">{v.savedMap ? "Matched the way you did last time for this file. Change any that are wrong." : "Tallyhound guessed each column. Change any that are wrong."}</p>
    <div className="tbl"><table><thead><tr><th>Column in your file</th><th>Example</th><th>Use as</th></tr></thead><tbody>{v.head.map((h: string, i: number) => { const locked = v.sensitive[i]; return <tr key={i}><td><b>{h}</b></td><td className="mono muted small">{locked ? "hidden" : (sample[0] || [])[i] || ""}</td>
      <td>{locked ? <Chip tone="bad">Never imported</Chip> : <select aria-label={"Use " + h + " as"} value={map[i] || ""} onChange={(ev) => setMap(map.map((m, k) => (k === i ? ev.target.value : m)))}>{T.IMPORT_FIELDS.map((f: string) => <option key={f} value={f}>{FIELD[f] || f}</option>)}</select>}</td></tr>; })}</tbody></table></div>
    {v.sensitive.some(Boolean) ? <p className="small muted">Never imported: {v.head.filter((_: string, i: number) => v.sensitive[i]).join(", ")}. Those columns are dropped before anything is saved.</p> : null}
    <div className="row"><Link className="btn" to="/add-clients">Start again</Link><span className="sp" /><span className="small muted">{NOTHING_SENT}</span><button className="btn pri" disabled={busy} onClick={() => void go()}>Bring them in</button></div></div>;
}

/** Step 1, what happened to each row, with the ones the firm has to decide. */
function Results({ v }: { v: Row }) {
  const { act, toast } = useFirm(), [, setParams] = useSearchParams(), rows: Row[] = v.rows, n = (k: string) => rows.filter((r) => r.status === k).length;
  const decide = (r: Row, choice: string) => void act("importDecide", v.id, r.n, choice).then((x) => toast(x ? String(x) + "." : choice === "new" ? "Added as a new client." : "Skipped."), () => {});
  return <div className="card pad col">
    <h3>{plural(n("ok") + n("no_email"), "new client")} from {v.file}</h3>
    <div className="row" style={{ gap: 6 }}>{Object.keys(ROW).map((k) => (n(k) ? <Chip key={k} tone={ROW[k]![1]}>{n(k)} {ROW[k]![0].toLowerCase()}</Chip> : null))}</div>
    {(v.dropped || []).length ? <p className="small muted">Never imported: {v.dropped.join(", ")}.</p> : null}
    <div className="tbl"><table><thead><tr><th>Row</th><th>Client</th><th>What happened</th></tr></thead><tbody>{rows.slice(0, 500).map((r) => <tr key={r.n}><td className="mono">{r.n}</td><td><b>{r.name}</b>{r.email ? <div className="small muted">{r.email}</div> : null}</td>
      <td><Chip tone={(ROW[r.status] || ["", ""])[1]}>{(ROW[r.status] || [r.status])[0]}</Chip>{r.why ? <div className="small muted">{r.why}</div> : null}
        {r.status === "possible_duplicate" ? <div className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn sm" onClick={() => decide(r, "new")}>A new client</button><button className="btn sm ghost" onClick={() => decide(r, "skip")}>Skip</button></div> : null}</td></tr>)}</tbody></table></div>
    {rows.length > 500 ? <p className="small muted">Showing the first 500 of {rows.length} rows.</p> : null}
    <div className="row"><span className="small muted grow">{NOTHING_SENT}</span><button className="btn pri" disabled={n("possible_duplicate") > 0} onClick={() => setParams({ batch: v.id, step: "2" })}>Next: last year's records</button></div>
    {n("possible_duplicate") ? <p className="small muted">Decide the rows marked Decide first.</p> : null}</div>;
}

type Seen = { name: string; state: "reading" | "done" | "failed"; words?: string; to?: string; where?: string };
/** Step 2: last year's organizers, returns and documents. Read on this computer unless the firm chooses the server. */
function Records({ v }: { v: Row }) {
  const { act, toast, reload } = useFirm(), [, setParams] = useSearchParams(), [server, setServer] = useState(false), [seen, setSeen] = useState<Seen[]>([]), [busy, setBusy] = useState(false);
  const people: Row[] = v.rows.filter((r: Row) => r.clientId && ["ok", "no_email", "updated", "same"].includes(r.status)), nameOf = (n?: number) => (people.find((r) => r.n === n) || { name: "" }).name;
  const one = async (f: File): Promise<Seen> => {
    if (f.size > MAX_PDF) return { name: f.name, state: "failed", words: "Over 25 MB" }; if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return { name: f.name, state: "failed", words: "Not a PDF" };
    if (server) { const r = await api.readOnServer("/api/imports/" + encodeURIComponent(v.id) + "/read?name=" + encodeURIComponent(f.name), f); return { name: f.name, state: "done", words: foundWords(r), to: r.row ? nameOf(r.row) : "", where: "server" }; }
    const r = await readInBrowser(f), x = (await act("importRecord", v.id, { file: f.name, kind: r.kind, status: r.status, findings: r.findings, where: "browser" })) as Row;
    if (x && x.error) return { name: f.name, state: "failed", words: x.error }; return { name: f.name, state: "done", words: foundWords(r), to: x && x.row ? nameOf(x.row) : "", where: "browser" };
  };
  const add = async (files: File[]) => {
    if (!files.length) return; setBusy(true); let list = [...files.map((f): Seen => ({ name: f.name, state: "reading" })), ...seen]; setSeen(list);
    for (const f of files) { let r: Seen; try { r = await one(f); } catch (err) { r = { name: f.name, state: "failed", words: (err as Error).message }; } list = list.map((x) => (x.name === f.name && x.state === "reading" ? r : x)); setSeen(list); }
    if (server) await reload(); setBusy(false);
  };
  const build = async () => { setBusy(true); try { const r = (await act("importBuild", v.id)) as Row; if (r && r.error) toast(r.error + "."); else setParams({ batch: v.id }); } catch { /* said */ } finally { setBusy(false); } };
  const done = seen.filter((x) => x.state !== "reading").length;
  return <div className="col" style={{ gap: 16 }}>
    <div className="card pad col">
      <h3>Add last year's records</h3>
      <p className="small muted">Last year's organizers, returns or tax documents, as PDFs. Name each file with the client's name or client ID and Tallyhound files it to them. Only what is found is kept: which forms, which payers, which schedules. Never a number, and never the file.</p>
      <div className="drop"><label className="btn pri">{busy ? "Reading" : "Choose files"}<input type="file" multiple accept="application/pdf,.pdf" hidden disabled={busy} onChange={(ev) => { void add([...(ev.target.files || [])]); ev.target.value = ""; }} /></label>
        <label className="row small" style={{ gap: 6, marginTop: 10, justifyContent: "center" }}><input type="checkbox" checked={server} onChange={(ev) => setServer(ev.target.checked)} />Read them on the server instead of on this computer</label>
        <p className="small muted" style={{ marginTop: 6 }}>{server ? "Each file is held in memory while it is read, then gone. A scan is read by the model and a person confirms it." : "Read on this computer: the files are not sent anywhere, only what was found."}</p></div>
      {seen.length ? <><div className="progress" role="progressbar" aria-label="Files read" aria-valuemin={0} aria-valuemax={seen.length} aria-valuenow={done}><i style={{ width: Math.round((100 * done) / seen.length) + "%" }} /></div>
        <ul className="plainlist small filelist">{seen.map((x, i) => <li key={i} className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Icon name={x.state === "done" ? "check" : x.state === "failed" ? "alert" : "clock"} small /><span className="trunc grow"><b>{x.name}</b>: {x.state === "reading" ? "reading" : x.words}{x.state === "done" ? (x.to ? ". Filed to " + x.to : ". Whose is this? See below") : ""}</span></li>)}</ul></> : null}
      <p className="small muted">{plural(v.counts.read, "client")} with records so far.</p></div>
    {v.tray.length ? <div className="card"><div className="hd"><h3>Whose is this?</h3><span className="sp" /><span className="small faint">Files Tallyhound could not place</span></div><ul className="list plainlist">{v.tray.map((t: Row) => <li className="li" key={t.id}><span className="ico"><Icon name="file" small /></span><div className="grow" style={{ minWidth: 0 }}><b className="trunc">{t.file}</b><div className="small muted">{KIND[t.kind] || "File"}</div></div>
      <select aria-label={"Whose is " + t.file} defaultValue="" onChange={(ev) => { const n = +ev.target.value; if (n) void act("importPlace", v.id, t.id, n).then((x) => toast(x ? String(x) + "." : "Filed to " + nameOf(n) + "."), () => {}); }}><option value="">Choose a client</option>{people.map((r) => <option key={r.n} value={r.n}>{r.name}</option>)}</select></li>)}</ul></div> : null}
    <div className="row"><button className="btn" onClick={() => setParams({ batch: v.id })}>Back</button><span className="sp" /><span className="small muted">{NOTHING_SENT}</span><button className="btn" disabled={busy} onClick={() => void build()}>Skip</button><button className="btn pri" disabled={busy} onClick={() => void build()}>Build the fetch lists</button></div></div>;
}

/** Step 3: the proposed lists, sorted by the engine into Ready and Needs a look. Approve the ready ones together; look at the rest one at a time. */
function Lists({ v }: { v: Row }) {
  const { T, act, toast } = useFirm(), lists: Row[] = v.lists, open = (x: Row) => x.list === "proposed" && x.status !== "off_season";
  const look = lists.filter((x) => open(x) && x.group === "look"), ready = lists.filter((x) => open(x) && x.group === "ready"), [k, setK] = useState(0), [all, setAll] = useState(false), [res, setRes] = useState<Row | null>(null);
  const cur = look[Math.min(k, Math.max(0, look.length - 1))], e = cur ? T.eng(cur.engId) : null, c = e ? T.client(e.clientId) : null;
  const approve = async (which: "ready" | "all") => { setAll(false); try { const r = (await act("importApprove", v.id, which)) as Row; if (r && r.error) return toast(r.error + "."); setRes(r); toast("Approved " + plural(r.approved, "list") + "."); } catch { /* said */ } };
  const who = (eid: string) => { const ee = T.eng(eid), cc = ee ? T.client(ee.clientId) : null; return cc ? cc.first + " " + cc.last : "A client"; };
  return <div className="col" style={{ gap: 16 }}>
    <div className="grid g3 stats">
      <div className="card stat" data-n="read"><b>{v.counts.read}</b><span>with last year's records read</span></div>
      <div className="card stat" data-n="ready"><b>{v.counts.ready}</b><span>ready to approve</span></div>
      <div className="card stat" data-n="look"><b>{v.counts.look}</b><span>need a look</span></div></div>
    <p className="small muted">{plural(v.counts.approved, "list")} approved{v.counts.offSeason ? ", " + v.counts.offSeason + " not this season" : ""}. {NOTHING_SENT}</p>
    {res ? <div className="note info col" style={{ alignItems: "flex-start" }}><span><b>Approved {plural(res.approved, "list")}.</b> Each client's first letter is on its way, on the next working day.</span>
      {(res.notStarted || []).length ? <ul className="plainlist small">{res.notStarted.map((x: Row) => <li key={x.engId}><Link to={"/clients/" + x.engId}>{who(x.engId)}</Link>: not started. {x.why}</li>)}</ul> : null}</div> : null}
    {cur && e && c ? <div className="col" style={{ gap: 8 }}>
      <div className="row"><h3 className="grow">Needs a look: {cur.name}</h3><span className="small muted">{Math.min(k, look.length - 1) + 1} of {look.length}</span><Link className="btn sm ghost" to={"/clients/" + e.id}>Open client</Link><button className="btn sm" disabled={look.length < 2} onClick={() => setK((Math.min(k, look.length - 1) + 1) % look.length)}>Next<Icon name="r" small /></button></div>
      <FetchList key={e.id} e={e} c={c} onDone={() => setK(Math.min(k, Math.max(0, look.length - 2)))} /></div> : null}
    <div className="card"><div className="hd"><h3>Ready to approve</h3><span className="sp" /><span className="small faint">Every item came from last year's own documents, with a named issuer</span></div>
      {ready.length ? <ul className="list plainlist">{ready.map((x) => <li className="li" key={x.engId}><div className="grow"><Link to={"/clients/" + x.engId}><b>{x.name}</b></Link><div className="small muted">{plural(x.items, "document")} · {plural(x.records, "file")} read</div></div></li>)}</ul> : <div className="bd small muted">No list is ready on its own. Those that need a look are above.</div>}
      <div className="bd row" style={{ borderTop: "1px solid var(--line2)" }}>{ready.length ? <button className="btn pri" onClick={() => void approve("ready")}><Icon name="check" small />Approve all {ready.length} ready {ready.length === 1 ? "list" : "lists"}</button> : null}
        {look.length + ready.length ? <button className="btn" onClick={() => setAll(true)}>Approve every open list</button> : null}<span className="sp" /><Link className="btn ghost" to="/clients?show=not_started">See your clients</Link></div></div>
    {all ? <Modal title="Approve every open list" onClose={() => setAll(false)} footer={<><button className="btn" onClick={() => setAll(false)}>Cancel</button><button className="btn pri" onClick={() => void approve("all")}>Approve {plural(look.length + ready.length, "list")}</button></>}>
      <p>That includes {plural(look.length, "list")} that {look.length === 1 ? "needs" : "need"} a look. Each client's first letter goes on the next working day, asking for what is ticked on their list.</p></Modal> : null}
  </div>;
}
