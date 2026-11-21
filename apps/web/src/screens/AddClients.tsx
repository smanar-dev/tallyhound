// Add clients: bring in a spreadsheet in four steps (T-24), or go and add one. Ported from the demo's importView().
// "Check rows" is a dry run of the real import on a copy of the firm's state in the browser, so what it says will happen is what happens.
import { Hound } from "../components/brand";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createEngine } from "virtual:engine";
import { useFirm } from "../lib/firm";
import { Page } from "./Shell";
import { Icon } from "../components/ui";
import { fname, plural } from "../lib/fmt";
import type { Row } from "../lib/select";

const FIELDS: [string, string][] = [["", "Ignore"], ["first", "First name"], ["last", "Last name"], ["email", "Email"], ["mobile", "Mobile"], ["preparer", "Preparer"], ["name", "Full name"], ["tz", "State or time zone"], ["ref", "Client ID"], ["docs", "Documents needed"], ["entity", "Business or trust name"], ["rtype", "Kind of return"]];
// How to get the list out of the tax programs small firms use (docs/INTEGRATIONS.md). Menu names vary a little by version.
const SOURCES: [string, string, string[]][] = [
  ["drake", "Drake Tax", ["Open Reports, then Report Manager.", "Under Client reports, open Client contact and pick Address list (all clients).", "Add the email and cell phone fields, view the report, then export it to CSV."]],
  ["lacerte", "Lacerte", ["On the Clients tab, select the clients to export.", "From the Client menu choose Export, then Export to File.", "Pick Comma Delimited and save the file."]],
  ["ultratax", "UltraTax CS", ["Go to Utilities, then Client Listing Reports.", "Choose the Client Contact report and click Continue.", "Save the report as a CSV file."]],
  ["proseries", "ProSeries", ["Open HomeBase.", "Click Export Contacts.", "Save the file as CSV."]],
  ["cch", "CCH Axcess", ["Export your client list to Excel, then save it as CSV."]],
  ["pm", "TaxDome, Karbon or Canopy", ["Export your accounts or contacts list to CSV."]],
  ["sheet", "A spreadsheet", ["Save it as CSV: File, Save As, CSV.", "Each client needs a name and an email or a mobile number. Extra columns are fine."]]
];
const STEPS = ["Upload", "Match columns", "Check rows", "Done"];
const MAX_BYTES = 5 * 1024 * 1024;

export function AddClients() {
  const { T, can, act, actMany, toast } = useFirm(), [step, setStep] = useState(1), [src, setSrc] = useState(""), [paste, setPaste] = useState(false), [text, setText] = useState(""), [parsed, setParsed] = useState<Row | null>(null), [result, setResult] = useState<Row | null>(null), [busy, setBusy] = useState(false);
  const read = (t: string) => { if (!t.trim()) return toast("That file is empty. Choose a CSV with a header row and one client per row."); const p = T.parseCSV(t); if (!p.rows.length) return toast("Tallyhound found a header row and no clients under it."); setText(t); setParsed(p); setStep(2); };
  const pickFile = (f?: File) => { if (!f) return; if (f.size > MAX_BYTES) return toast("That file is over 5 MB. Export just the client list, as CSV."); if (/\.(xlsx?|numbers)$/i.test(f.name)) return toast("That is a spreadsheet file. Save it as CSV first: File, Save As, CSV."); const r = new FileReader(); r.onload = () => read(String(r.result || "")); r.onerror = () => toast("We couldn't read that file. Save it as CSV and try again, or send it to hello@tallyhound.com."); r.readAsText(f); };
  // The dry run: the same engine, a copy of the same state, the same import. Nothing is saved.
  const preview = useMemo(() => { if (!parsed || step !== 3) return null; const P = createEngine(); P.load(T.dump()); P.setNow(T.S.now); return P.importRows({ ...parsed, map: [...parsed.map] }) as Row; }, [parsed, step, T]);
  const commit = async () => { setBusy(true); try { setResult((await act("importCsv", text, parsed!.map)) as Row); setStep(4); } catch { /* said */ } finally { setBusy(false); } };
  const reset = () => { setStep(1); setText(""); setParsed(null); setResult(null); setPaste(false); };
  const checkinAll = async () => { const who: Row[] = T.S.engs.filter((e: Row) => e.status === "not_started" && !e.checkin); if (!who.length) return toast("Nobody left to send it to."); try { const r = await actMany(who.map((e) => ["sendCheckin", e.id])), ok = r.filter((x) => !x).length; toast(ok ? "Check-in sent to " + plural(ok, "client") + ". Answers come back to the review queue as proposed checklists." : String(r.find((x) => x) || "It could not be sent.")); } catch { /* said */ } };
  const source = SOURCES.find((x) => x[0] === src);
  if (!can()) return <Page title="Add clients"><div className="card pad"><p>Your account can look but not change things, so it cannot add clients. Ask an owner to change your role.</p><Link className="btn" to="/clients">See your clients</Link></div></Page>;

  let body;
  if (step === 1) body = <>
    <h3 style={{ marginBottom: 4 }}>Where is your client list today?</h3><p className="small muted" style={{ marginBottom: 12 }}>Pick one for the exact steps, or upload a file you already have below.</p>
    <div className="tiles srcs">{SOURCES.map((x) => <button key={x[0]} className={"tile" + (src === x[0] ? " on" : "")} aria-pressed={src === x[0]} onClick={() => setSrc(src === x[0] ? "" : x[0])}><b>{x[1]}</b></button>)}</div>
    {source ? <div className="card pad col" style={{ boxShadow: "none", marginTop: 16, gap: 10 }}><b>Get the list out of {source[1]}</b><ol className="steps-list">{source[2].map((t) => <li key={t}>{t}</li>)}</ol><p className="small muted">Menu names vary a little by version. Any CSV with a name and an email or mobile number per client works.</p></div> : null}
    <div className="drop" style={{ marginTop: 14 }}><b>{source ? "Now upload that file" : "Already have the file? Upload it"}</b><p className="small muted" style={{ margin: "4px 0 12px" }}>Leave every column in. Tallyhound uses the name, email, mobile and client ID. Columns such as SSN, date of birth and fees are spotted and never imported.</p>
      <label className="btn pri">Choose the CSV file<input type="file" accept=".csv,text/csv,.txt" hidden onChange={(ev) => { pickFile(ev.target.files?.[0]); ev.target.value = ""; }} /></label></div>
    <div style={{ marginTop: 14 }}>{paste ? <><textarea aria-label="Paste your client list here" placeholder="Paste the rows here, with the header row first" className="pastebox" value={text} onChange={(ev) => setText(ev.target.value)} /><button className="btn" style={{ marginTop: 8 }} onClick={() => read(text)}>Continue</button></> : <button className="btn sm ghost" onClick={() => setPaste(true)}>Or paste the rows instead</button>}</div>
    <div className="note info" style={{ marginTop: 16 }}><Icon name="plus" small /><span className="grow">Only a handful of clients, or trying Tallyhound on yourself first?</span><Link className="btn" to="/clients?do=add">Add one client</Link></div></>;
  else if (step === 2 && parsed) body = <>
    <p className="muted" style={{ marginBottom: 12 }}>Tallyhound guessed each column. Change any that are wrong.</p>
    <div className="tbl"><table style={{ minWidth: 520 }}><thead><tr><th>Column in your file</th><th>Example</th><th>Use as</th></tr></thead><tbody>{parsed.head.map((hd: string, i: number) => { const hidden = (parsed.sensitive || [])[i]; return <tr key={i}><td><b>{hd}</b></td><td className="mono muted">{hidden ? "hidden" : (parsed.rows[0] || [])[i] || ""}</td><td>{hidden ? <span className="chip"><Icon name="lock" small /> Never imported</span> : <select aria-label={"Use " + hd + " as"} value={parsed.map[i] || ""} onChange={(ev) => { const map = [...parsed.map]; map[i] = ev.target.value; setParsed({ ...parsed, map }); }}>{FIELDS.map((f) => <option key={f[0]} value={f[0]}>{f[1]}</option>)}</select>}</td></tr>; })}</tbody></table></div>
    <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn pri" onClick={() => setStep(3)}>Check {plural(parsed.rows.length, "row")}</button></div></>;
  else if (step === 3 && parsed && preview) { const bad = new Map<number, string>((preview.rejects || []).map((r: Row) => [r.row, r.why])), n = (preview.ok || 0) + (preview.updated || 0);
    body = <>
      <div className="row" style={{ marginBottom: 12 }}><span className="chip good">{preview.ok || 0} new</span>{preview.updated ? <span className="chip info">{preview.updated} updated</span> : null}{preview.same ? <span className="chip">{preview.same} already here, unchanged</span> : null}<span className={"chip " + (bad.size ? "bad" : "")}>{bad.size} will be left out</span></div>
      <div className="tbl"><table style={{ minWidth: 560 }}><thead><tr><th>Row</th><th>Data</th><th>Result</th></tr></thead><tbody>{parsed.rows.slice(0, 500).map((r: string[], i: number) => <tr key={i}><td className="mono">{i + 2}</td><td className="mono small">{parsed.map.map((m: string, k: number) => (m && !(parsed.sensitive || [])[k] ? r[k] || "" : "")).filter(Boolean).join(", ")}</td><td>{bad.has(i + 2) ? <span className="chip bad">{bad.get(i + 2)}</span> : <span className="chip good">Ready</span>}</td></tr>)}</tbody></table></div>
      {parsed.rows.length > 500 ? <p className="small muted" style={{ marginTop: 8 }}>Showing the first 500 of {parsed.rows.length} rows. Every row is checked.</p> : null}
      <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn pri" disabled={!n || busy} onClick={commit}>{preview.ok ? "Import " + plural(preview.ok, "client") : "Update " + plural(preview.updated || 0, "client")}{preview.ok && preview.updated ? " and update " + preview.updated : ""}</button></div></>; }
  else if (step === 4 && result) body = <div className="empty hound" style={{ padding: 20 }}><Hound width={120} mode="wag" /><h2>{plural(result.ok || 0, "client")} imported{result.updated ? ", " + result.updated + " updated" : ""}</h2>
    <p className="muted" style={{ margin: "6px 0 16px" }}>{result.same ? result.same + " already here and unchanged. " : ""}{(result.rejects || []).length ? plural(result.rejects.length, "row") + (result.rejects.length === 1 ? " was" : " were") + " left out. " : ""}{(result.skippedColumns || []).length ? "Never imported: " + result.skippedColumns.join(", ") + ". " : ""}{result.shared ? result.shared + " share a phone or email with another client, which is fine: replies are matched by the name on each document. " : ""}{result.withLists ? result.withLists + " got their checklist from your file. " : ""}{result.withLists === result.ok && result.ok ? "" : "New clients" + (result.withLists ? " without one" : "") + " start with the usual checklist (" + (T.S.firm.defaultItems || ["W2", "1098"]).map((f: string) => fname(T, f)).join(", ") + "). "}Next, let each client tell you what applied this year with a few taps. Their answers come back as a checklist for you to confirm.</p>
    <div className="row" style={{ justifyContent: "center" }}><button className="btn pri" onClick={checkinAll}>Next: send the 2-minute check-in</button><Link className="btn" to="/clients?do=assign">Choose a checklist myself</Link><Link className="btn" to="/clients?show=not_started">See new clients</Link><button className="btn" onClick={reset}>Import another file</button></div></div>;

  return <Page title="Add clients"><div className="narrow">
    <div className="steps" style={{ marginBottom: 16 }}>{STEPS.map((x, i) => <span key={x} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""} aria-current={step === i + 1 ? "step" : undefined}>{i ? <span className="faint"> › </span> : null}{step > i + 1 ? "✓ " : i + 1 + ". "}{x}</span>)}</div>
    <div className="card pad">{body}</div></div></Page>;
}
