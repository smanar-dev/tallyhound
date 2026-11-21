// What every staff screen sits in: the menu, the bar with client search and alerts, and the banners (docs/UX.md rule 4: four things in the main menu).
import { Logo } from "../components/brand";
import { useFeatures } from "../lib/firm";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useFirm } from "../lib/firm";
import { api } from "../lib/api";
import { draftsToApprove, needsYou, type Row } from "../lib/select";
import { cname, senderState, STAT, when } from "../lib/fmt";
import { Avatar, Chip, Icon, UserAvatar } from "../components/ui";
import { Modal } from "../components/Modal";
import type { IconName } from "../lib/icons";

const ROLE = { owner: "Owner", staff: "Staff", read_only: "Read-only" } as const;

// Which emails Tallyhound sends you. Each person chooses for themselves.
function EmailNotes() {
  const { me, toast } = useFirm(), [open, setOpen] = useState(false), [n, setN] = useState(me.notes || { morning: true, urgent: true });
  const set = async (k: "morning" | "urgent", on: boolean) => { const was = n; setN({ ...n, [k]: on }); try { const r = await api.post<{ notes: { morning: boolean; urgent: boolean } }>("/api/me/notes", { [k]: on }); setN(r.notes); me.notes = r.notes; toast("Saved."); } catch (e) { setN(was); toast((e as Error).message); } };
  const { T, act } = useFirm(), mine = (T.S.users.find((u: Row) => u.id === me.id) || {}).bark || {}, kinds: string[] | null = mine.kinds || null, KIND: Record<string, string> = { document: "Documents to check", question: "Client questions", says_none: "Client has none", gone_quiet: "Gone quiet", change_noted: "Changes noted", call: "Calls to make", output_check: "Blocked messages" };
  const bark = (p: { email?: boolean; text?: boolean; kinds?: string[] | null }) => void act("setMyBarks", { email: p.email ?? mine.email !== false, text: p.text ?? mine.text === true, kinds: p.kinds === undefined ? kinds : p.kinds }).then(() => toast("Saved."), () => {});
  // TH-BRK-10: a text as well, to this person's own mobile once they have typed back the code sent to it.
  const feat = useFeatures(), [mob, setMob] = useState(me.mobile || null), [num, setNum] = useState(""), [code, setCode] = useState(""), [mobWhy, setMobWhy] = useState("");
  const sendCode = async () => { setMobWhy(""); try { const r = await api.post<{ ends: string }>("/api/me/mobile", { mobile: num }); setMob({ ends: r.ends, verified: false }); me.mobile = { ends: r.ends, verified: false }; setCode(""); } catch (e) { setMobWhy((e as Error).message); } };
  const verify = async () => { setMobWhy(""); try { await api.post("/api/me/mobile/verify", { code }); const v = { ends: mob!.ends, verified: true }; setMob(v); me.mobile = v; bark({ text: true }); } catch (e) { setMobWhy((e as Error).message); } };
  const forget = async () => { try { await api.del("/api/me/mobile"); setMob(null); me.mobile = null; setNum(""); bark({ text: false }); } catch (e) { setMobWhy((e as Error).message); } };
  return <><button className="btn sm ghost notesbtn" onClick={() => setOpen(true)}>My alerts</button>
    {open ? <Modal title="My alerts" onClose={() => setOpen(false)} footer={<button className="btn pri" onClick={() => setOpen(false)}>Done</button>}><div className="col" style={{ gap: 12 }}>
      <p className="small muted">Who gets an alert when something needs a person. A bark tells you how many things in the review queue are yours. It always shows in the app, under the bell.</p>
      <label className="row"><span className="toggle"><input type="checkbox" checked={mine.email !== false} onChange={(ev) => bark({ email: ev.target.checked })} /><span /></span>Email me a bark too, at most one every half hour, and never outside office hours</label>
      {feat.textBarks ? <div className="col" style={{ gap: 8 }}>
        {mob && mob.verified ? <><label className="row"><span className="toggle"><input type="checkbox" checked={mine.text === true} onChange={(ev) => bark({ text: ev.target.checked })} /><span /></span>Text me a bark too, on the mobile ending {mob.ends}</label><div><button className="btn sm ghost" onClick={() => void forget()}>Remove my mobile</button></div></>
          : mob ? <div className="row" style={{ alignItems: "flex-end" }}><label className="f" style={{ flex: 1 }}>The code texted to the mobile ending {mob.ends}<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(ev) => setCode(ev.target.value)} /></label><button className="btn" disabled={code.replace(/\D/g, "").length !== 6} onClick={() => void verify()}>Confirm</button><button className="btn ghost" onClick={() => void forget()}>Cancel</button></div>
          : <div className="row" style={{ alignItems: "flex-end" }}><label className="f" style={{ flex: 1 }}>Text me a bark too: my mobile<input type="tel" autoComplete="tel" placeholder="(615) 555-0100" value={num} onChange={(ev) => setNum(ev.target.value)} /></label><button className="btn" disabled={num.replace(/\D/g, "").length < 10} onClick={() => void sendCode()}>Send me a code</button></div>}
        {mobWhy ? <div className="note bad" role="alert">{mobWhy}</div> : null}
        <p className="small muted">Texts come from Tallyhound's own number, never your firm's client number, and say only how many things are waiting. Reply STOP to end them.</p></div> : null}
      <fieldset className="kinds"><legend className="small b">Bark me about</legend>{Object.keys(KIND).map((k) => <label key={k} className="row"><input type="checkbox" checked={!kinds || kinds.includes(k)} onChange={(ev) => { const all = Object.keys(KIND), cur = kinds || all, next = ev.target.checked ? [...new Set([...cur, k])] : cur.filter((x) => x !== k); bark({ kinds: next.length === all.length ? null : next }); }} />{KIND[k]}</label>)}</fieldset>
      <label className="row"><span className="toggle"><input type="checkbox" checked={n.morning} onChange={(ev) => void set("morning", ev.target.checked)} /><span /></span>A note at 7 am on working days when something is waiting for you</label>
      <label className="row"><span className="toggle"><input type="checkbox" checked={n.urgent} onChange={(ev) => void set("urgent", ev.target.checked)} /><span /></span>A note at once when something urgent comes up</label>
      <p className="small muted">These go to {me.email}. They name clients by first name and last initial and never carry a document or its details.</p></div></Modal> : null}</>;
}

export function Side({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, me, can } = useFirm(), s = T.S, loc = useLocation();
  const waiting = needsYou(T).length + draftsToApprove(T).length;
  const item = (to: string, label: ReactNode, icon: IconName, n?: number) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => "nav" + (isActive || (to === "/clients" && loc.pathname.startsWith("/clients/")) ? " on" : "")} onClick={onClose}><Icon name={icon} />{label}{n ? <span className="n">{n}</span> : null}</NavLink>;
  const signOut = () => api.post("/auth/signout").finally(() => window.location.replace("/signin"));
  return <>
    <aside className={"side" + (open ? " open" : "")}>
      <Link className="logo" to="/" onClick={onClose} aria-label="Tallyhound, home"><Logo dark size={34} /></Link>
      <div className="firm"><b>{s.firm.name}</b><span>Tax year {s.firm.taxYear || 2026} · {s.engs.length} clients</span></div>
      <nav className="col" style={{ gap: 4 }} aria-label="Main">
        {item("/", "Home", "home")}{item("/clients", "Clients", "users")}{item("/needs-you", "Review queue", "review", waiting)}
        {item("/hound", "The hound", "spark")}
        <div className="navsec">More</div>
        {item("/add-clients", "Add clients", "upload")}{item("/messages", "All messages", "inbox", s.tray.length)}{item("/progress", "Progress", "chart")}{item("/help", "How it works", "eye")}
        {can("owner") ? item("/settings", "Settings", "gear") : null}
      </nav>
      <div className="grow" />
      <div className="who"><UserAvatar user={s.user} small /><span className="me trunc">{me.name}<small>{ROLE[me.role]}</small></span><button className="btn sm ghost" onClick={signOut}>Sign out</button></div>
      {me.role !== "read_only" ? <EmailNotes /> : null}
    </aside>
    <div className={"scrim" + (open ? " on" : "")} onClick={onClose} />
  </>;
}

function Bell() {
  const { T, act } = useFirm(), nav = useNavigate(), [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null);
  const { me, toast } = useFirm(), barks: Row[] = (T.S.barks || []).filter((b: Row) => b.userId === me.id && ["queued", "sent", "held", "digest"].includes(b.status)), newBarks = barks.filter((b) => !b.readAt);
  const openBark = (b: Row) => { setOpen(false); void act("barkRead", b.id).catch(() => {}); nav("/needs-you?mine=1"); };
  // A bark that has just arrived says so once, with a way straight to this person's part of the queue.
  const told = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!told.current) { told.current = new Set(barks.map((b) => b.id)); return; }
    for (const b of newBarks) if (!told.current.has(b.id)) { told.current.add(b.id); const w = T.barkWords(b.counts); toast("Tallyhound barked. " + (b.escalation ? "Something has waited more than a working day." : w.line), { label: "Open queue", run: () => openBark(b) }); }
  }, [newBarks.map((b) => b.id).join()]);   // eslint-disable-line react-hooks/exhaustive-deps
  const alerts: Row[] = T.S.alerts || [], unread = alerts.filter((a) => !a.read).length + newBarks.length, LV: Record<string, string> = { high: "bad", medium: "warn", low: "", info: "info" };
  useEffect(() => { if (!open) return; const out = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); }, esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); }; document.addEventListener("mousedown", out); document.addEventListener("keydown", esc); return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); }; }, [open]);
  const go = (a: Row) => { setOpen(false); void act("alertRead", a.id).catch(() => {}); if (a.engId) nav("/clients/" + a.engId + "?tab=" + (a.kind === "handoff" || a.kind === "sla" ? "conversation" : "checklist")); };
  return <div className="rel" ref={box}>
    <button className="btn icon ghost" style={{ position: "relative" }} aria-label={unread ? "Alerts, " + unread + " unread" : "Alerts"} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="bell" />{unread ? <span className="badge-dot">{unread}</span> : null}</button>
    {open ? <div className="menu-pop" style={{ width: "min(380px,90vw)", maxHeight: 420, overflow: "auto" }}>
      {barks.length ? <><div className="row" style={{ padding: "6px 10px" }}><b>Barks</b><span className="sp" /><span className="small faint">Things in the review queue for you</span></div>
        {barks.slice(0, 6).map((b) => { const w = T.barkWords(b.counts); return <button key={b.id} style={{ alignItems: "flex-start", opacity: b.readAt ? 0.6 : 1 }} onClick={() => openBark(b)}><Chip tone={b.escalation ? "warn" : "acc"}>{b.escalation ? "again" : "bark"}</Chip><span style={{ fontWeight: 500, whiteSpace: "normal" }}>{b.escalation ? "Something has waited more than a working day." : w.line}<br /><span className="small faint">{w.parts.join(", ")} · {when(T, b.at)}</span></span></button>; })}</> : null}
      <div className="row" style={{ padding: "6px 10px" }}><b>Alerts</b><span className="sp" />{unread ? <button className="btn sm ghost" onClick={() => { void act("alertsRead").catch(() => {}); void act("barkRead", "all").catch(() => {}); }}>Mark all read</button> : null}</div>
      {alerts.length ? alerts.slice(0, 10).map((a) => <button key={a.id} style={{ alignItems: "flex-start", opacity: a.read ? 0.6 : 1 }} onClick={() => go(a)}><Chip tone={LV[a.level]}>{a.level}</Chip><span style={{ fontWeight: 500, whiteSpace: "normal" }}>{a.text}<br /><span className="small faint">{when(T, a.at)}</span></span></button>) : <div className="small muted" style={{ padding: 10 }}>No alerts. Failed sends, questions past their reply time and storage problems show up here.</div>}
    </div> : null}
  </div>;
}

function Search() {
  const { T } = useFirm(), nav = useNavigate(), [q, setQ] = useState(""), t = q.trim().toLowerCase();
  const res: Row[] = t ? T.S.clients.filter((c: Row) => (c.first + " " + c.last + " " + (c.email || "") + " " + (c.mobile || "")).toLowerCase().includes(t)).slice(0, 6) : [];
  return <div className="search">
    <input type="search" placeholder="Find a client by name, email or phone" aria-label="Find a client" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
    <Icon name="search" small />
    {t ? <div className="sres">{res.length ? res.map((c) => { const e = T.engOf(c.id); return e ? <button key={c.id} onClick={() => { setQ(""); nav("/clients/" + e.id); }}><Avatar first={c.first} last={c.last} small /><span><b>{cname(c)}</b><br /><span className="small muted">{(STAT[e.status] || [e.status])[0]} · {c.email || c.mobile}</span></span></button> : null; }) : <div className="small muted" style={{ padding: 8 }}>No client matches.</div>}</div> : null}
  </div>;
}

export function Banners() {
  const { T, can, act } = useFirm(), f = T.S.firm, acc = T.access(), nav = useNavigate();
  return <>
    {acc.state === "trial" && (acc.daysLeft <= 7 || acc.clientsLeft === 0) ? <div className="banner info" style={{ display: "flex" }}><Icon name="clock" small /><span>Free trial: {acc.daysLeft} day{acc.daysLeft === 1 ? "" : "s"} left{acc.clientsLeft === 0 ? ", and all " + T.TRIAL_CLIENTS + " trial clients are in use" : ""}. Collecting stops when it ends unless you choose a plan.</span>{can("owner") ? <button className="btn sm" onClick={() => nav("/settings?tab=plan")}>See plans</button> : null}</div> : null}
    {acc.state === "checking" ? <div className="banner info" style={{ display: "flex" }}><Icon name="clock" small /><span>{acc.reason} Nothing is sent to clients until it is done.</span></div> : null}
    {f.stopped ? <div className="banner bad"><Icon name="alert" small />All automated messages are stopped. Nothing is sent until an owner resumes.{can("owner") ? <button className="btn sm" onClick={() => void act("resumeAll").then(() => undefined, () => undefined)}>Resume messages</button> : null}</div> : null}
    {senderState(f) === "filed" ? <div className="banner note"><Icon name="alert" small />Your texting number is still being approved by the carriers. Email requests go out now; texts start once it's approved.</div> : null}
  </>;
}

/** One screen: its title bar, the banners, and a scrolling page. */
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { document.title = title + " · Tallyhound"; }, [title]);
  return <>
    <Side open={navOpen} onClose={() => setNavOpen(false)} />
    <div className="main">
      <div className="topbar"><button className="btn icon ghost menu" aria-label="Menu" onClick={() => setNavOpen(true)}><Icon name="menu" /></button><h2 className="hide-s" style={{ whiteSpace: "nowrap" }}>{title}</h2><Search /><span className="sp" />{actions}<Bell /></div>
      <Banners />
      <div className="scroll" id="scroll"><div className="page col" style={{ gap: 20 }}>{children}</div></div>
    </div>
  </>;
}
