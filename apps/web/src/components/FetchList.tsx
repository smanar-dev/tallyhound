// The fetch list (docs/FETCH.md): what one client is asked for this season. Until it is approved it is a proposal: each item can be
// ticked or unticked, given an issuer, added, and nothing is sent. Approving it is what lets the first letter go; after that each
// change is a new version and the next letter reads it. Used on the client's page and in the import's "Needs a look" step.
// Every decision is the engine's: this only shows its list and calls one action per click.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFirm } from "../lib/firm";
import { api } from "../lib/api";
import { Modal } from "./Modal";
import { Chip, Icon } from "./ui";
import { dshort, ISTATE, plural, when } from "../lib/fmt";
import { foundWords, KIND, MAX_PDF, readInBrowser, RECORD_STATUS } from "../lib/records";
import type { Row } from "../lib/select";

const cap = (t: string) => String(t || "").replace(/^[a-z]/, (ch) => ch.toUpperCase());
const HELD: Record<string, string> = { catalogue_date: "not issued before then", client_date: "the client's date", staff_date: "your date" };
/** One finding from last year's records, in words. Names only: the reader and the engine drop every number first. */
export function findingWords(T: Row, f: Row): string {
  if (f.kind === "payer" && f.form) return cap(T.itemTitle({ form: f.form, payer: f.payer || null }, "en"));
  if (f.kind === "schedule") return String(f.value || "A schedule");
  if (f.kind === "line") return "An entry for " + String(f.value || "a line");
  if (f.kind === "recipient") return "Made out to " + String(f.recipient || "");
  return "Tax year " + String(f.value || "");
}

/** The list itself. `onDone` lets the import move to the next list after an approval or "Not this season". */
export function FetchList({ e, c, onDone, openDoc }: { e: Row; c: Row; onDone?: () => void; openDoc?: (id: string) => void }) {
  const { T, can, act, toast } = useFirm(), s = T.S, L = T.listOf(e.id) || { status: "proposed", reasons: [], log: [] }, proposed = L.status !== "approved", off = e.status === "off_season";
  const items: Row[] = s.items.filter((i: Row) => i.engId === e.id && i.state !== "removed"), edit = can() && !["closed", "opted_out"].includes(e.status);
  const cat: Row[] = T.catalog().filter((x: Row) => !x.hidden), [code, setCode] = useState(""), [issuer, setIssuer] = useState(""), [waive, setWaive] = useState<Row | null>(null), [why, setWhy] = useState("not_this_year"), [who, setWho] = useState<Row | null>(null), [busy, setBusy] = useState(false);
  const run = async (fn: string, args: unknown[], said?: string) => { try { const r = await act(fn, ...args); if (r && typeof r === "string") toast(r + "."); else if (said) toast(said); return r; } catch { return "failed"; } };
  const approve = async () => { setBusy(true); const r = await run("approveList", [e.id]); setBusy(false); if (r === "failed") return; if (!r) toast("Approved. " + c.first + "'s first letter is on its way."); if (!r || /^Approved/.test(String(r))) onDone?.(); };
  const season = async (on: boolean) => { const r = await run("setSeason", [e.id, on], on ? "Not this season. No letters go to " + c.first + "." : c.first + " is back on for this season."); if (!r && on) onDone?.(); };
  const add = async () => { if (!code) return; const r = await run("addCatalogItem", [e.id, code, issuer.trim()]); if (!r) { setCode(""); setIssuer(""); toast(proposed ? "Added to the list." : "Added. It is asked for in the next letter."); } };
  const pick = cat.find((x) => x.code === code), contacts: Row[] = (T.client(e.clientId)?.contacts || []).filter((p: Row) => !p.emailOff);
  // A new contact is assigned the item once the saved state has them: the engine gives the contact its id.
  const [pend, setPend] = useState<{ iid: string; email: string } | null>(null);
  useEffect(() => { if (!pend) return; const p = contacts.find((x) => x.email === pend.email); if (!p) return; setPend(null); void run("assignItem", [pend.iid, p.id], "It goes to them in their own letter, with their own link."); }, [pend, contacts]);   // eslint-disable-line react-hooks/exhaustive-deps
  const row = (i: Row) => {
    const title = cap(T.itemTitle(i, "en")), h = T.holdOf(i, e), entry = cat.find((x) => x.code === i.form) || T.catalog().find((x: Row) => x.code === i.form), needsIssuer = !i.payer && !i.custom && entry && entry.issuerLabel, p = contacts.find((x) => x.id === i.assignee);
    return <li className="li fl" key={i.id}>
      {proposed ? <input type="checkbox" aria-label={"Ask for " + title} disabled={!edit || off} checked={i.state !== "off"} onChange={(ev) => void run("tickItem", [i.id, ev.target.checked])} /> : <span className={"ico " + i.state}>{i.state === "received" ? <Icon name="check" /> : i.state === "waived" ? <Icon name="minus" /> : null}</span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <b className={i.state === "off" ? "faint" : ""}>{title}</b>{i.isNew ? <> <Chip tone="info plain">New this year</Chip></> : null}{entry && entry.newForYear ? <> <Chip tone="acc plain">New for {s.firm.taxYear || 2026}</Chip></> : null}
        {h ? <> <Chip tone="info plain">{"Held until " + dshort(new Date(h.until)) + ": " + HELD[h.reason]}</Chip></> : null}
        <div className="small muted">{proposed ? "" : (ISTATE[i.state] || "") + " · "}{T.SOURCES[i.source] || "Added by the firm"}{i.why ? " · " + i.why : ""}{p ? " · Asked of " + p.name : ""}</div>
        {(i.evidence || []).slice(0, 2).map((v: Row, k: number) => <div key={k} className="small faint trunc">{v.file}{v.page ? ", page " + v.page : ""}{v.text ? ": “" + v.text + "”" : ""}</div>)}
        {edit && needsIssuer && ["off", "expected"].includes(i.state) ? <IssuerEdit label={entry.issuerLabel} title={title} onSave={(v) => run("setIssuer", [i.id, v], v ? "Issuer saved." : "Cleared.")} /> : null}
      </div>
      {openDoc && i.docId ? <button className="btn sm ghost" aria-label={"Open the " + title} onClick={() => openDoc(i.docId)}><Icon name="eye" small /></button> : null}
      {edit && !proposed ? <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        {T.OPEN.includes(i.state) ? <select aria-label={"Who is asked for the " + title} value={i.assignee || ""} onChange={(ev) => { const v = ev.target.value; if (v === "+") setWho(i); else void run("assignItem", [i.id, v], v ? "It goes to them in their own letter." : "Asked of " + c.first + " again."); }}>
          <option value="">{c.first}</option>{contacts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="+">Someone new</option></select> : null}
        {T.OPEN.includes(i.state) ? <button className="btn sm" onClick={() => { setWhy("not_this_year"); setWaive(i); }}>Not needed</button> : i.state === "waived" ? <button className="btn sm" onClick={() => void run("itemNeeded", [i.id, true], "Asked for again.")}>Ask again</button> : null}
      </div> : null}
    </li>;
  };
  return <div className="card fetchlist">
    <div className="hd"><h3>Fetch list</h3>{proposed ? (off ? <Chip>Not this season</Chip> : L.group === "ready" ? <Chip tone="good">Ready</Chip> : <Chip tone="warn">Needs a look</Chip>) : <Chip tone="good">Approved</Chip>}<span className="sp" />
      <span className="small muted">{proposed ? "Proposed. Nothing is sent to anyone until you approve their list." : "Approved by " + (L.approvedBy || "the firm") + (L.approvedAt ? ", " + when(T, new Date(L.approvedAt)) : "") + ". Version " + (L.version || 1) + "."}</span></div>
    {proposed && !off && (L.reasons || []).length ? <div className="bd row" style={{ gap: 6 }}><span className="small muted">Why it needs a look:</span>{L.reasons.map((r: string) => <Chip key={r} tone="warn plain">{r}</Chip>)}</div> : null}
    {off ? <div className="bd note" style={{ margin: 12 }}><Icon name="pause" small /><span className="grow">Not this season. No letters go to {c.first}, and they stay on your client list.</span>{edit ? <button className="btn sm" onClick={() => void season(false)}>Bring back</button> : null}</div> : null}
    {items.length ? <ul className="list plainlist">{items.map(row)}</ul> : <div className="bd small muted">Nothing on the list yet. Add a document below{proposed ? ", or add last year's records and Tallyhound proposes one" : ""}.</div>}
    {edit && !off ? <div className="bd row addrow" style={{ borderTop: "1px solid var(--line2)" }}>
      <select aria-label="Document to add" value={code} onChange={(ev) => setCode(ev.target.value)}><option value="">Add a document</option>{T.CATALOG_GROUPS.map(([g, label]: [string, string]) => <optgroup key={g} label={label}>{cat.filter((x) => x.group === g).map((x) => <option key={x.code} value={x.code}>{x.display}: {cap(x.name)}</option>)}</optgroup>)}</select>
      {pick && pick.issuerLabel ? <input type="text" aria-label="Who issues it" placeholder={pick.issuerLabel + " (optional)"} maxLength={60} value={issuer} onChange={(ev) => setIssuer(ev.target.value)} /> : null}
      <button className="btn" disabled={!code} onClick={() => void add()}><Icon name="plus" small />Add</button></div> : null}
    {edit && proposed && !off ? <div className="bd row" style={{ borderTop: "1px solid var(--line2)" }}>
      <button className="btn pri" disabled={busy || !items.some((i) => i.state !== "off")} onClick={() => void approve()}><Icon name="check" small />Approve list</button>
      <button className="btn" onClick={() => void season(true)}>Not this season</button>
      {(e.records || []).length ? <button className="btn ghost" onClick={() => void run("buildList", [e.id], "Built again from last year's records. What you added stays.")}>Build it again</button> : null}
      <span className="sp" /><span className="small muted">{plural(items.filter((i) => i.state !== "off").length, "document")} ticked</span></div> : null}
    {edit && !proposed && !off && !["complete", "closed"].includes(e.status) ? <div className="bd row" style={{ borderTop: "1px solid var(--line2)" }}><span className="small muted grow">Not working with {c.first} this year?</span><button className="btn sm" onClick={() => void season(true)}>Not this season</button></div> : null}
    {!proposed && (L.log || []).length > 1 ? <details className="bd small"><summary>Changes since it was approved ({L.log.length - 1})</summary><ul className="plainlist muted">{L.log.slice(1).reverse().map((x: Row, k: number) => <li key={k}>Version {x.version}, {when(T, new Date(x.at))}, {x.by}: {x.what}</li>)}</ul></details> : null}
    {waive ? <Modal title="Not needed this year" onClose={() => setWaive(null)} footer={<><button className="btn" onClick={() => setWaive(null)}>Cancel</button><button className="btn pri" onClick={() => { const i = waive; setWaive(null); void run("itemNeeded", [i.id, false, why], "Marked not needed."); }}>Not needed this year</button></>}>
      <p className="small muted">{cap(T.itemTitle(waive, "en"))} comes off what {c.first} is asked for. You can ask for it again later.</p>
      <label className="f">Why<select value={why} onChange={(ev) => setWhy(ev.target.value)}>{Object.keys(T.WAIVE_REASONS).map((k) => <option key={k} value={k}>{T.WAIVE_REASONS[k]}</option>)}</select></label></Modal> : null}
    {who ? <NewContact c={T.client(e.clientId)} onClose={() => setWho(null)} onAdded={(email) => { const i = who; setWho(null); setPend({ iid: i.id, email }); }} /> : null}
  </div>;
}

function IssuerEdit({ label, title, onSave }: { label: string; title: string; onSave: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState("");
  return <div className="row" style={{ gap: 6, marginTop: 6 }}><input type="text" aria-label={"Who issues the " + title} placeholder={label + " (optional)"} maxLength={60} value={v} onChange={(ev) => setV(ev.target.value)} style={{ maxWidth: 240 }} />
    {v.trim() ? <button className="btn sm" onClick={() => void onSave(v.trim()).then(() => setV(""))}>Save</button> : null}</div>;
}

/** A second person who holds some of a client's documents. Offered, never assumed. Calls back with the new contact's id. */
export function NewContact({ c, onClose, onAdded }: { c: Row; onClose: () => void; onAdded?: (email: string) => void }) {
  const { act, toast } = useFirm(), [name, setName] = useState(""), [email, setEmail] = useState("");
  const save = async () => { try { const r = await act("addContact2", c.id, name.trim(), email.trim()); if (r) return toast(String(r) + "."); onClose(); if (onAdded) onAdded(email.trim().toLowerCase()); else toast("Contact added."); } catch { /* said */ } };
  return <Modal title="Someone else who has documents" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={!name.trim() || !email.trim()} onClick={() => void save()}>Add</button></>}>
    <p className="small muted">They get their own letter with their own upload link, which shows only what they are asked for. Nothing about {c.first}'s other documents is shown to them.</p>
    <label className="f">Their name<input type="text" maxLength={60} value={name} onChange={(ev) => setName(ev.target.value)} /></label>
    <label className="f">Their email<input type="email" maxLength={254} value={email} onChange={(ev) => setEmail(ev.target.value)} /></label></Modal>;
}

/** Last year's records for one client: what was read from each file, and a way to add another. Only findings are kept, never the file. */
export function RecordsCard({ e, c }: { e: Row; c: Row }) {
  const { T, can, act, toast, reload } = useFirm(), recs: Row[] = e.records || [], [server, setServer] = useState(false), [busy, setBusy] = useState("");
  const add = async (f?: File) => {
    if (!f) return; if (f.size > MAX_PDF) return toast("That file is over 25 MB."); if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return toast("Choose a PDF.");
    setBusy(f.name);
    try {
      if (server) { const r = await api.readOnServer("/api/clients/" + encodeURIComponent(e.id) + "/records?name=" + encodeURIComponent(f.name), f); await reload(); toast(foundWords(r) + "."); }
      else { const r = await readInBrowser(f), x = await act("attachRecord", e.id, { file: f.name, kind: r.kind, status: r.status, findings: r.findings }); toast(x ? String(x) + "." : foundWords(r) + ". Read on this computer: the file was not sent."); }
    } catch (err) { if (server) toast((err as Error).message); } finally { setBusy(""); }
  };
  return <div className="card"><div className="hd"><h3>Last year's records</h3><span className="sp" /><span className="small faint">Only what was found is kept, never the file</span></div>
    {recs.length ? <ul className="list plainlist">{recs.map((r) => { const st = RECORD_STATUS[r.status] || [r.status, ""]; return <li className="li" key={r.id} style={{ alignItems: "flex-start" }}><span className="ico"><Icon name="file" small /></span>
      <div className="grow" style={{ minWidth: 0 }}><b className="trunc">{r.file}</b> <Chip tone={st[1] + " plain"}>{st[0]}</Chip><div className="small muted">{KIND[r.kind] || "File"} · read {r.where === "server" ? "on the server" : "on your computer"}{r.by && r.by !== "rules" ? " by the model" : ""}</div>
        {(r.findings || []).length ? <div className="small">{r.findings.slice(0, 8).map((f: Row) => findingWords(T, f)).join(" · ")}{r.findings.length > 8 ? " and " + (r.findings.length - 8) + " more" : ""}</div> : null}</div>
      {can() ? <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>{["needs_person", "nothing_found", "unreadable"].includes(r.status) ? <button className="btn sm" onClick={() => void act("confirmRecord", e.id, r.id).then((x) => toast(x ? String(x) + "." : "Confirmed."), () => {})}>Confirm</button> : null}
        <button className="btn sm ghost" aria-label={"Take " + r.file + " off"} onClick={() => void act("dropRecord", e.id, r.id).then((x) => toast(x ? String(x) + "." : "Taken off. The list was built again without it."), () => {})}><Icon name="trash" small /></button></div> : null}</li>; })}</ul>
      : <div className="bd small muted">No records for {c.first} yet. Add last year's organizer, return or tax documents and Tallyhound proposes what to ask for.</div>}
    {can() ? <div className="bd row" style={{ borderTop: "1px solid var(--line2)" }}><label className="btn">{busy ? "Reading " + busy : "Add last year's file"}<input type="file" accept="application/pdf,.pdf" hidden disabled={!!busy} onChange={(ev) => { void add(ev.target.files?.[0]); ev.target.value = ""; }} /></label>
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={server} onChange={(ev) => setServer(ev.target.checked)} />Read it on the server instead</label></div> : null}</div>;
}

/** Notes for the preparer: from what the client said, a rule, or the firm. Never shown to the client. */
export function NotesCard({ e }: { e: Row }) {
  const { T, can, act, toast } = useFirm(), [v, setV] = useState(""), notes: Row[] = e.notes || [];
  const FROM: Record<string, string> = { client: "The client said", rule: "From last year's records", firm: "Note" };
  return <div className="card"><div className="hd"><h3>For the preparer</h3><span className="sp" /><span className="small faint">Never shown to the client</span></div>
    {notes.length ? <ul className="list plainlist">{notes.slice().reverse().map((n) => <li className="li" key={n.id}><div className="grow"><div>{n.text}</div><div className="small muted">{FROM[n.source] || "Note"}{n.by ? " · " + n.by : ""} · {when(T, new Date(n.at))}</div></div></li>)}</ul> : <div className="bd small muted">Nothing yet. What the client says is new this year, and what last year's return shows, lands here.</div>}
    {can() ? <div className="bd row" style={{ borderTop: "1px solid var(--line2)" }}><input type="text" className="grow" aria-label="A note for the preparer" placeholder="A note for the preparer" maxLength={300} value={v} onChange={(ev) => setV(ev.target.value)} />
      <button className="btn" disabled={!v.trim()} onClick={() => void act("noteForPreparer", e.id, v.trim()).then((x) => { if (x) toast(String(x) + "."); else { setV(""); toast("Note saved."); } }, () => {})}>Add note</button></div> : null}</div>;
}

/** Household and the other people who hold documents, for the Details tab. */
export function HouseholdCard({ c }: { c: Row }) {
  const { T, can } = useFirm(), [open, setOpen] = useState(false), others: Row[] = c.householdId ? T.S.clients.filter((x: Row) => x.id !== c.id && x.householdId === c.householdId) : [], contacts: Row[] = c.contacts || [];
  return <div className="card"><div className="hd"><h3>Household and contacts</h3></div><div className="bd col" style={{ gap: 8 }}>
    <div><span className="small muted">Household</span><div>{c.household || c.first + " " + c.last}{c.spouseName ? <span className="muted"> · spouse {c.spouseName}</span> : null}</div></div>
    {others.length ? <div><span className="small muted">Also in this household</span><ul className="plainlist">{others.map((x) => { const e = T.engOf(x.id); return <li key={x.id}>{e ? <Link to={"/clients/" + e.id}>{x.first} {x.last}</Link> : x.first + " " + x.last}</li>; })}</ul></div> : null}
    <div><span className="small muted">Other people who hold documents</span>{contacts.length ? <ul className="plainlist">{contacts.map((p) => <li key={p.id}>{p.name} <span className="muted">{p.email}</span>{p.emailOff ? <> <Chip tone="bad plain">No more email</Chip></> : null}</li>)}</ul> : <p className="small muted">Nobody yet. A spouse, a parent or a bookkeeper can be asked for the documents they hold, in their own letter.</p>}</div>
    {can() ? <div><button className="btn sm" onClick={() => setOpen(true)}><Icon name="plus" small />Add a person</button></div> : null}</div>
    {open ? <NewContact c={c} onClose={() => setOpen(false)} /> : null}</div>;
}
