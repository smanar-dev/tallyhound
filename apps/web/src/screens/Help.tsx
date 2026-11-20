// How Tallyhound works (T-67): one page in plain words, inside the product. No separate manual. The numbers on it (sending hours,
// the reminder rhythm, how long copies are kept) are read from the firm's own settings, so the page is never out of date.
import { Link } from "react-router-dom";
import { useFirm } from "../lib/firm";
import { Page } from "./Shell";
import { Icon } from "../components/ui";

const hour = (h: number) => (h > 12 ? h - 12 : h) + (h >= 12 ? " pm" : " am");
export function Help() {
  const { T, can } = useFirm(), f = T.S.firm, r = T.retain(), copilot = f.hound.mode === "copilot";
  const Sec = ({ n, title, children }: { n: string; title: string; children: React.ReactNode }) => <section className="card pad col" style={{ gap: 8 }}><h2><span className="helpn">{n}</span>{title}</h2>{children}</section>;
  return <Page title="How Tallyhound works">
    <p className="muted" style={{ maxWidth: 720 }}>Tallyhound does one job: it gets every client's tax documents in, and checks each one. Four steps. This page is all there is to learn.</p>
    <Sec n="1" title="Your client list"><p>Add clients one at a time or from a spreadsheet, on <Link to="/add-clients">Add clients</Link>. A name and an email or mobile number is enough. A Social Security number, a date of birth or a fee in your spreadsheet is never brought in.</p></Sec>
    <Sec n="2" title="A checklist for each client"><p>The checklist is the documents that client owes you this year. The quickest way to build it is the check-in: the client gets a link, taps what applied to them this year, and you get a suggested list to confirm. You can also give everyone a ready-made list, or add documents by hand on the client's page.</p><p>Nothing is asked of a client until you confirm their checklist and start collecting.</p></Sec>
    <Sec n="3" title="Asking, reminding and answering"><p>Tallyhound asks for one document at a time, by text when the client has agreed to texts and by email otherwise. It thanks them for what arrives and asks for the next. If a client goes quiet it reminds them on day 2, 5, 9 and 14, then stops and asks you to call.</p>
      <ul className="helplist"><li>Messages go only between {hour(f.quietStart)} and {hour(f.quietEnd)} on the client's own clock, never on Sundays or federal holidays, and at most once a day unless the client is mid-conversation.</li>
        <li>{copilot ? <>You are on <b>Copilot</b>: every message is a draft until someone approves it. Drafts wait under Needs you and on The Hound.</> : <>You are on <b>Autopilot</b>: messages go by themselves. You can still take over any conversation from the client's page.</>}</li>
        <li>A client who replies STOP gets no more texts, at once, whatever else is happening.</li>
        <li>Tallyhound never gives tax advice. A tax question, a question about your fee, or an upset client is passed to you with a suggested reply.</li></ul></Sec>
    <Sec n="4" title="Checking every document"><p>Each document that arrives must pass three checks before it counts:</p>
      <ul className="helplist"><li><b>Right document.</b> It is the form that was asked for, for the right tax year, and not a copy of one already in.</li><li><b>Right information.</b> It is this client's, and every part of the form is there.</li><li><b>Clear to read.</b> The key boxes can be read.</li></ul>
      <p>A document that fails goes back to the client with one plain sentence saying what to fix. One that Tallyhound is unsure about comes to you. It checks that a document is right; it does not pull the numbers out of it.</p></Sec>
    <Sec n="→" title="When it comes to you"><p><Link to="/needs-you">Needs you</Link> is the one list of everything waiting for a person: a document Tallyhound was unsure of, a client's question, a client who says they do not have something, a call to make{copilot ? ", and drafts to approve" : ""}. When that list is empty, there is nothing you have to do.</p><p><Link to="/hound">The Hound</Link> shows everything Tallyhound did and why, and what it plans to do next.</p></Sec>
    <Sec n="✓" title="When a client is finished"><p>When every document is in or marked not needed, the client is complete. Hand off their files from the client's page: named consistently, one folder per client, with a list of anything still missing{f.delivery && f.delivery.provider && f.delivery.provider !== "Download" ? ". They are filed in your " + f.delivery.provider + " for you" : ""}.</p>
      <p>Tallyhound is a pass-through. It deletes its copy of a document {r.afterDelivery ? r.afterDelivery + " days" : "the same day"} after hand-off, and never holds one longer than {r.max} days. {can("owner") ? <>You can change this under <Link to="/settings?tab=security">Settings, Security and data</Link>.</> : null}</p></Sec>
    <section className="card pad col" style={{ gap: 8 }}><h2>What your clients see</h2><p>A text or an email in your firm's name, asking for one document. To send it they reply with a photo, reply to the email, or open their own private page, which needs no account or password and never shows anything they sent before. To see exactly what one client sees, open that client and choose See it as the client under More actions.</p>
      <div className="note info"><Icon name="lock" small /><span>Tell your clients before the first message that it is coming. People are right to distrust messages that ask for tax documents. {can("owner") ? <Link to="/settings?tab=texting">Settings, Text number has a note you can send.</Link> : "An owner can find a note to send under Settings."}</span></div></section>
  </Page>;
}
