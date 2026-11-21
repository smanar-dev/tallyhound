// When a firm is paused or its trial has ended, nothing runs and every screen except Settings says so (T-83).
// The server refuses the same things, so this page is information, not the lock itself.
import { Link } from "react-router-dom";
import { useFirm } from "../lib/firm";
import { Page } from "./Shell";
import { Icon } from "../components/ui";
import { fmtDay, plural } from "../lib/fmt";

export function Lock() {
  const { T, can, act, toast } = useFirm(), a = T.access(), b = T.billing(), n = T.S.clients.length;
  if (a.state === "paused") return <Page title="Paused"><div className="narrow"><div className="card pad col lockcard"><div className="big"><Icon name="clock" /></div><h1>Paused{b.pausedUntil ? " until " + fmtDay(b.pausedUntil) + ", " + b.pausedUntil.getFullYear() : ""}</h1>
    <p className="muted">{plural(n, "client")}, their checklists and everything Tallyhound learned about them are stored. Nothing is being sent or collected, and nothing is billed. A client who writes in gets an automatic reply asking them to contact you directly. It all switches back on by itself on that date.</p>
    {can("owner") ? <button className="btn pri" onClick={() => void act("resumeNow").then(() => toast("Resumed. Fetching carries on."), () => {})}>Resume now</button> : <p className="small muted">Ask an owner to resume early.</p>}</div></div></Page>;
  return <Page title="Your free trial has ended"><div className="narrow"><div className="card pad col lockcard"><div className="big"><Icon name="lock" /></div><h1>Your free trial has ended</h1>
    <p className="muted">Everything is saved: {plural(n, "client")}, their checklists and every document received. Nothing is being sent or read until a plan is chosen. Documents are still deleted on the schedule you set.</p>
    <p>To choose a plan, write to the person at Tallyhound who set up your firm. One flat monthly price by number of clients. Never per return, per document or per message.</p>
    {can("owner") ? <Link className="btn" to="/settings">Open Settings</Link> : <p className="small muted">Ask an owner to choose a plan.</p>}</div></div></Page>;
}
/** True when the firm is paused or its trial has ended. A firm still being checked is not locked: it can set everything up. */
export const locked = (T: { access(): { ok: boolean; state: string } }) => { const a = T.access(); return !a.ok && a.state !== "checking"; };
