// Home: one screen that tells a preparer what to do next (docs/UX.md rule 2). Ported from the demo's home().
import { HoundNote } from "../components/brand";
import { Link, useNavigate } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { useFeatures, useFirm } from "../lib/firm";
import { Page } from "./Shell";
import { activity, countBy, needReason, needsYou, openTasks, readyToStart, type Event, type Need, type Row } from "../lib/select";
import { cname, DOW, fmtDay, fname, iname, MON, plural, rel, senderState, STAT, when } from "../lib/fmt";
import { Avatar, DocChip, Empty, Icon, Ring } from "../components/ui";

const SEGS: [string, string][] = [["complete", "var(--good-fill)"], ["in_progress", "var(--ink2)"], ["awaiting_consent", "#8FB3A3"], ["stuck", "var(--accent)"], ["not_started", "#D9CFBB"], ["paused", "var(--deco)"], ["opted_out", "var(--bad)"]];
const PIPE_TO: Record<string, string> = { clients: "/clients", checklist: "/clients?show=not_started", chasing: "/hound", check: "/needs-you", complete: "/clients?show=complete" };

function NeedRow({ x }: { x: Need }) {
  const { T, can, act } = useFirm(), decide = (d: string) => void act("decideTask", x.t!.id, d, d === "reask" ? { reason: "illegible" } : { reason: "not needed" }).catch(() => {});
  let acts: ReactNode = null;
  if (can()) {
    if (x.t) acts = x.t.kind === "document" ? <Link className="btn sm pri" to={"/needs-you?task=" + x.t.id}>Check it</Link>
      : x.t.kind === "gone_quiet" || x.t.kind === "change_noted" ? <Link className="btn sm" to={"/needs-you?task=" + x.t.id}>Decide what next</Link>
      : x.t.kind === "question" || x.t.kind === "call" ? <Link className="btn sm pri" to={"/clients/" + x.e.id + "?tab=conversation"}>{x.t.kind === "call" ? "Call script" : "Reply"}</Link>
      : x.t.kind === "says_none" ? <><button className="btn sm" onClick={() => decide("waive")}>Not needed this year</button><button className="btn sm" onClick={() => decide("reask")}>Ask again</button></>
      : <button className="btn sm" onClick={() => decide("handled")}>Dismiss</button>;
    else if (x.checkin) acts = <Link className="btn sm pri" to={"/clients/" + x.e.id + "?tab=checklist"}>Go through the checklist</Link>;
    else if (x.suggest) acts = <Link className="btn sm pri" to={"/clients/" + x.e.id + "?tab=" + (x.custom ? "checklist" : "suggested")}>See suggestion</Link>;
    else acts = <Link className="btn sm" to={"/clients/" + x.e.id + "?tab=conversation"}><Icon name="msg" small />Message</Link>;
  }
  return <div className="li"><Avatar first={x.c.first} last={x.c.last} /><div className="grow"><Link className="btn ghost" style={{ padding: 0, fontWeight: 700 }} to={"/clients/" + x.e.id}>{cname(x.c)}</Link><div className="small muted trunc">{needReason(T, x)} · {rel(T, x.at)}</div></div><div className="row" style={{ gap: 6 }}>{acts}</div></div>;
}

function FeedLine({ x }: { x: Event }) {
  const { T } = useFirm(), who = <b>{cname(x.c)}</b>;
  let lead: ReactNode = <Avatar first={x.c.first} last={x.c.last} />, body: ReactNode, to = "/clients/" + x.e.id, label = "Open client";
  if (x.kind === "doc") { lead = <span className="ico"><Icon name="file" small /></span>; body = <>{who} sent {x.d.form === "OTHER" ? "a document" : "a " + fname(T, x.d.form)}{x.d.payer ? " from " + x.d.payer : ""} <DocChip state={x.d.state} /></>; }
  else if (x.kind === "attachments") { lead = <span className="ico"><Icon name="mail" small /></span>; body = <>{who} emailed {plural(x.n, "attachment")} and a note · {x.understood}</>; }
  else if (x.kind === "reply") body = <>{who} {x.portal ? "used the upload page" : "replied"}: “{x.quote}”</>;
  else if (x.kind === "manual") body = <><b>{x.by}</b> messaged {cname(x.c)}</>;
  else {
    lead = <span className="ico" style={{ width: 32, height: 32 }}><Icon name="send" small /></span>;
    if (x.names.length > 1) { to = "/hound"; label = "See each message"; body = <>Tallyhound sent <b>{x.names.length} clients</b> {x.tail}<div className="small muted">{x.names.slice(0, 4).map((c: Row) => cname(c)).join(", ")}{x.names.length > 4 ? " and " + (x.names.length - 4) + " more" : ""}</div></>; }
    else body = <>Tallyhound sent {who} {x.tail}</>;
  }
  return <div className="li">{lead}<div className="grow"><div style={{ lineHeight: 1.4 }}>{body}</div><div className="small faint">{when(T, x.at)}</div></div><Link className="btn sm ghost" to={to} aria-label={label}><Icon name="r" small /></Link></div>;
}

// The three numbered steps shown until the first requests go out. Only the current step has buttons, and only buttons that work.
function StartCard() {
  const { T, can, actMany, toast } = useFirm(), s = T.S, n = s.clients.length, ready = readyToStart(T).length;
  // The check-in goes to everyone who has not been started and has not had one. The engine says who it could not reach.
  const checkinAll = async () => {
    const who: Row[] = s.engs.filter((e: Row) => e.status === "not_started" && !e.checkin); if (!who.length) return toast("Nobody left to send it to.");
    try { const r = await actMany(who.map((e) => ["sendCheckin", e.id])), ok = r.filter((x) => !x).length, no = who.length - ok;
      toast(ok ? "Check-in sent to " + plural(ok, "client") + ". Answers come back to the review queue as proposed checklists." + (no ? " " + no + " could not be sent." : "") : String(r.find((x) => x) || "It could not be sent.")); } catch { /* the toast has said why */ }
  };
  const unconf = s.engs.filter((e: Row) => !e.confirmed && e.status === "not_started").length, started = s.engs.filter((e: Row) => e.status !== "not_started").length;
  if (started || !can()) return null;
  const cur = !n ? 1 : unconf ? 2 : 3, backs = s.engs.filter((e: Row) => e.checkin && e.checkin.doneAt).length, sentCk = s.engs.filter((e: Row) => e.checkin).length;
  const Step = ({ k, title, text, children }: { k: number; title: string; text: string; children?: ReactNode }) => <div className={"gs " + (k < cur ? "done" : k === cur ? "cur" : "")}><span className="gsn">{k < cur ? <Icon name="check" small /> : k}</span><div className="grow"><b>{title}</b><div className="small muted">{text}</div>{k === cur && children ? <div className="row" style={{ marginTop: 10 }}>{children}</div> : null}</div></div>;
  return <div className="card pad col" style={{ gap: 4 }}><h2>Get your first requests out</h2>
    <Step k={1} title="Add your clients" text={n ? plural(n, "client") + " added." : "Upload a spreadsheet of names with a mobile number or email, or add one client to try it."}><Link className="btn pri" to="/add-clients"><Icon name="upload" small />Import a list</Link><Link className="btn" to="/clients?do=add"><Icon name="plus" small />Add one client</Link></Step>
    <Step k={2} title="Give each client a checklist" text={n && !unconf ? "Every client has a confirmed checklist." : (sentCk > backs ? backs + " of " + sentCk + " check-ins are back. " : "") + "The list of documents each client owes you. Let clients tell you with a few taps, or pick a ready-made list for everyone."}><button className="btn pri" onClick={checkinAll}><Icon name="send" small />Ask clients with a 2-minute check-in</button><Link className="btn" to="/clients?do=assign"><Icon name="file" small />Choose a checklist for all {unconf}</Link><Link className="btn" to="/clients?show=not_started">Go through them one by one</Link></Step>
    <Step k={3} title="Go fetch" text={"Tallyhound asks each client for their documents by text and email, checks what comes back, and follows up. " + (s.firm.hound.mode === "copilot" ? "You approve each message before it goes." : "It only comes to you when it needs a person.")}><Link className="btn pri" to="/clients?do=start"><Icon name="send" small />Go fetch for {plural(ready, "client")}</Link></Step>
  </div>;
}

// What a firm connects once. Collecting by email works before any of it is finished.
function SetupCard() {
  const { T, can } = useFirm(), feat = useFeatures(), f = T.S.firm, [copied, setCopied] = useState(false);
  if (!can()) return null;
  const st = senderState(f), filesOk = !!(f.delivery && f.delivery.provider && f.delivery.provider !== "Download");
  if (st === "approved" && filesOk && f.verified !== false && f.headsUpAt) return null;
  const RowLine = ({ ok, title, children, action }: { ok: boolean; title: string; children: ReactNode; action?: ReactNode }) => <div className="li" style={{ alignItems: "flex-start" }}><span className={"chip " + (ok ? "good" : "warn")} style={{ marginTop: 2 }}>{ok ? "Ready" : "To do"}</span><div className="grow"><b>{title}</b><div className="small muted">{children}</div></div>{action}</div>;
  return <div className="card"><div className="hd"><h2>Connect once</h2><span className="sp" /><span className="small faint">You can collect by email before any of this is finished</span></div><div className="list">
    {f.verified === false ? <RowLine ok={false} title="Firm check">Before anything is sent to a client, Tallyhound confirms you are a tax or accounting firm. This usually takes one business day and you can set everything else up now.</RowLine> : null}
    <RowLine ok title="Email" action={f.email ? <button className="btn sm" onClick={() => navigator.clipboard.writeText(f.email).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy address"}</button> : null}>Requests go out in your firm's name and clients reply to <span className="mono">{f.email}</span>. Nothing to set up, and Tallyhound never connects to your own mailbox.</RowLine>
    <RowLine ok={st === "approved"} title="Text number" action={st === "todo" && can("owner") ? <Link className="btn sm" to="/settings?tab=texting">Set up</Link> : null}>{st === "approved" ? "Approved by the carriers. Clients can text photos." : st === "filed" ? "With the carriers" + (f.senderSubmittedAt ? " since " + fmtDay(f.senderSubmittedAt) : "") + ". Approval usually takes one to three weeks. Until then Tallyhound collects by email and the upload page." : "Carriers must approve a business text number, which takes one to three weeks. It needs your firm's legal name, tax ID and address, not a plan. Until it clears, Tallyhound collects by email and each client's upload page, which uses their phone camera."}</RowLine>
    <RowLine ok={!!f.headsUpAt} title="Tell your clients first" action={!f.headsUpAt && can("owner") ? <Link className="btn sm" to="/settings?tab=texting">See the note</Link> : null}>{f.headsUpAt ? "Marked as sent " + fmtDay(f.headsUpAt) + ". Clients know to expect messages from Tallyhound in your name." : "People are told to distrust messages that ask for tax documents. A short note from your own email, sent before the first request, fixes that."}</RowLine>
    <RowLine ok={filesOk} title="Where finished files go" action={!filesOk && can("owner") && feat.storage.length ? <Link className="btn sm" to="/settings?tab=files">Connect</Link> : null}>{filesOk ? f.delivery.provider + ", folder " + f.delivery.folder + ". Tallyhound deletes its own copy " + (T.retain().afterDelivery ? T.retain().afterDelivery + " days after delivery." : "right after delivery.") : (feat.storage.length ? "Right now finished files download as a zip. Connect your firm's storage and they are filed for you, then deleted from Tallyhound on a schedule." : "Finished files download as a zip from each client's page.")}</RowLine>
  </div></div>;
}

export function Home() {
  const { T, can } = useFirm(), s = T.S, nav = useNavigate(), h = s.now.getHours(), ny = needsYou(T), done = countBy(T, "complete") + countBy(T, "closed");
  const wk: Row[] = s.docs.filter((d: Row) => d.engId && s.now - d.at < 7 * T.DAY), auto = wk.filter((d) => d.state === "accepted" && !s.tasks.some((t: Row) => t.docId === d.id)).length;
  const upcoming: Row[] = s.engs.filter((e: Row) => e.next && e.next > s.now && ["in_progress", "awaiting_consent"].includes(e.status)).sort((a: Row, b: Row) => a.next - b.next).slice(0, 6);
  const anyStarted = s.engs.some((e: Row) => e.status !== "not_started"), feed = activity(T, 10);
  const more = readyToStart(T).length;
  return <Page title="Home" actions={can() && more && anyStarted ? <Link className="btn pri" to="/clients?do=start"><Icon name="send" small />Go fetch ({more})</Link> : null}>
    <div><h1>Good {h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"}, {s.user.first}</h1>
      <p className="muted" style={{ marginTop: 4 }}>{DOW[s.now.getDay()]}, {MON[s.now.getMonth()]} {s.now.getDate()}. {!s.clients.length ? "Three steps to your first request. It takes about ten minutes." : !anyStarted ? "Your clients are in. Nothing has been sent yet." : ny.length ? ny.length + " thing" + (ny.length > 1 ? "s need" : " needs") + " you. Tallyhound is handling the rest." : "Nothing needs you. Tallyhound is collecting for everyone else."}</p></div>
    <StartCard /><SetupCard />
    {s.clients.length ? <div className="pipe">{T.pipeline().map((p: Row, i: number) => <Link key={p.key} className="pstep" to={PIPE_TO[p.key] || "/clients"}><span className="pn">Step {i + 1}</span><b>{p.n}</b><span>{p.label}</span><small>{p.hint}</small></Link>)}</div> : null}
    {s.clients.length ? <>
      <p className="small muted" style={{ marginTop: -8 }}>{plural(wk.length, "document")} in the last 7 days{wk.length ? " · " + Math.round((100 * auto) / wk.length) + "% checked with no staff touch" : ""}</p>
      <div className="split">
        <div className="col" style={{ gap: 20 }}>
          <div className="card"><div className="hd"><h2>Review queue</h2><span className="sp" />{openTasks(T).length ? <Link className="btn sm" to="/needs-you">See all</Link> : null}</div>
            {ny.length ? <div className="list">{ny.slice(0, 8).map((x, i) => <NeedRow key={(x.t ? x.t.id : x.e.id) + ":" + i} x={x} />)}</div> : <HoundNote title="Nothing needs you right now."><p>The hound has it. A document it could not confirm, a client question or a client who has gone quiet shows up here.</p></HoundNote>}</div>
          <div className="card"><div className="hd"><h2>Latest activity</h2><span className="sp" /><span className="small faint">Newest first</span></div>
            {feed.length ? <div className="list feed">{feed.map((x, i) => <FeedLine key={i + ":" + +x.at} x={x} />)}</div> : <Empty>Nothing yet. Requests sent, replies and documents show up here as they happen.</Empty>}</div>
        </div>
        <div className="col" style={{ gap: 20 }}>
          <div className="card pad"><h2>Season progress</h2>
            <div className="row" style={{ margin: "14px 0", gap: 18, flexWrap: "nowrap" }}><Ring done={done} total={s.engs.length} size={118} label="all fetched" />
              <div className="col" style={{ gap: 4, flex: 1 }}>{SEGS.filter((g) => countBy(T, g[0])).map((g) => <button key={g[0]} className="btn ghost sm" style={{ justifyContent: "flex-start", padding: "2px 4px" }} onClick={() => nav("/clients?show=" + g[0])}><i className="swatch" style={{ background: g[1] }} />{(STAT[g[0]] || [g[0]])[0]}<span className="sp" /><b>{countBy(T, g[0])}</b></button>)}</div></div>
            <div className="bar" style={{ height: 10 }}>{SEGS.map((g) => <i key={g[0]} style={{ width: (100 * countBy(T, g[0])) / Math.max(1, s.engs.length) + "%", background: g[1], marginRight: 2 }} />)}</div></div>
          <div className="card"><div className="hd"><h2>Coming up</h2></div>
            {upcoming.length ? <div className="list">{upcoming.map((e) => { const c = T.client(e.clientId), it = T.nextItem(e); return <div className="li" key={e.id}><Icon name="clock" small /><div className="grow"><b>{cname(c)}</b><div className="small muted trunc">{e.status === "awaiting_consent" ? "Invitation reminder" : it ? (it.state === "requested" ? "Reminder: " : "Request: ") + iname(T, it) : "Next step"}</div></div><span className="small faint" style={{ whiteSpace: "nowrap" }}>{rel(T, e.next)}</span></div>; })}</div> : <Empty small>Nothing is due to go out. Reminders and next requests are listed here before they are sent.</Empty>}
            <div className="bd small muted" style={{ borderTop: "1px solid var(--line2)" }}>Messages only go out {s.firm.quietStart} am to {s.firm.quietEnd - 12} pm, never on Sundays or federal holidays, at most one a day per client.</div></div>
          {s.tray.length ? <div className="card pad row"><span className="ico in_review"><Icon name="inbox" small /></span><div className="grow"><b>{plural(s.tray.length, "message")} from an unknown sender</b><div className="small muted">Tallyhound could not tell which client sent {s.tray.length === 1 ? "it" : "them"}</div></div><Link className="btn sm" to="/messages?show=unknown">Match to a client</Link></div> : null}
        </div>
      </div></> : null}
  </Page>;
}
