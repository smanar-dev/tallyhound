// Sign-in: an emailed link, then a six-digit code from an authenticator app. No passwords. One step on screen at a time.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";

type Step = "email" | "sent" | "wait" | "setup" | "codes" | "code" | "recovery";
const Card = ({ title, children }: { title: string; children: ReactNode }) => <section className="card pad col" style={{ gap: 12 }}><h1>{title}</h1>{children}</section>;

export function SignIn() {
  const [step, setStep] = useState<Step>("email"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null), [codes, setCodes] = useState<string[]>([]), [copied, setCopied] = useState("");
  const started = useRef(false);
  const go = (s: Step) => { setError(""); setCode(""); setStep(s); };
  const home = () => window.location.replace("/");
  // What to ask for once the link has been opened: first time, set up the authenticator; after that, its code.
  const next = async (n: "setup" | "code") => { if (n === "setup") { setSetup(await api.post<{ secret: string; qr: string }>("/auth/setup/start")); go("setup"); } else go("code"); };
  const run = (fn: () => Promise<void>) => async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true); setError("");
    try { await fn(); } catch (err) { const e = err as ApiError; if (e.code === "too_many" || e.code === "signin") go("email"); setError(e.message); } finally { setBusy(false); }
  };
  // Arriving from the emailed link. The token rides after the # so it never reaches a server log or a referrer.
  useEffect(() => {
    if (started.current) return; started.current = true;
    const m = /[#&]t=([^&]+)/.exec(window.location.hash);
    if (window.location.pathname !== "/signin/open" || !m) return;
    setStep("wait"); window.history.replaceState(null, "", "/signin");
    api.post<{ next: "setup" | "code" }>("/auth/open", { token: decodeURIComponent(m[1]!) }).then((r) => next(r.next)).catch((e: Error) => { go("email"); setError(e.message); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const codeField = (id: string, label: string) => <><label htmlFor={id}>{label}</label><input id={id} className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} /></>;

  return <main className="auth">
    <p className="logo dark"><span className="mark" />tallyhound</p>
    {error ? <div className="banner bad" role="alert">{error}</div> : null}
    {step === "email" && <Card title="Sign in">
      <p className="muted">Enter your work email. We will send you a link. There is no password.</p>
      <form className="col" style={{ gap: 8 }} onSubmit={run(async () => { await api.post("/auth/link", { email: email.trim() }); go("sent"); })}>
        <label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn pri" disabled={busy}>Email me a sign-in link</button>
      </form>
    </Card>}
    {step === "sent" && <Card title="Check your email">
      <p>If <b>{email.trim()}</b> has a Tallyhound account, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
      <p className="small muted">Nothing after a few minutes? Check spam, then <button className="linklike" onClick={() => go("email")}>try a different address</button>.</p>
    </Card>}
    {step === "wait" && <Card title="Signing you in"><p className="muted" role="status">One moment.</p></Card>}
    {step === "setup" && setup && <Card title="Set up two-step sign-in">
      <p className="muted">Every Tallyhound account needs this. It takes a minute and you do it once.</p>
      <ol className="steps"><li>Open an authenticator app on your phone. Google Authenticator, Microsoft Authenticator and 1Password all work.</li><li>Add an account and scan this code.</li></ol>
      <img className="qr" src={setup.qr} alt="Setup code to scan with your authenticator app" />
      <p className="small muted">Cannot scan? Type this key into the app instead:<span className="secret mono">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</span></p>
      <form className="col" style={{ gap: 8 }} onSubmit={run(async () => { const r = await api.post<{ recoveryCodes: string[] }>("/auth/setup/finish", { code }); setCodes(r.recoveryCodes); go("codes"); })}>
        {codeField("setup-code", "3. Enter the six digits the app shows")}
        <button className="btn pri" disabled={busy}>Finish setup</button>
      </form>
    </Card>}
    {step === "codes" && <Card title="Save your recovery codes">
      <p>If you lose your phone, one of these gets you in. Each works once. <b>This is the only time they are shown.</b></p>
      <ul className="codes mono">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied("Copied. Paste them somewhere safe."), () => setCopied("Could not copy. Write them down."))}>Copy the codes</button><span className="small muted" role="status">{copied}</span></div>
      <button className="btn pri" onClick={home}>I have saved them. Continue</button>
    </Card>}
    {step === "code" && <Card title="Enter your code">
      <p className="muted">Open your authenticator app and enter the six digits for Tallyhound.</p>
      <form className="col" style={{ gap: 8 }} onSubmit={run(async () => { await api.post("/auth/code", { code }); home(); })}>
        {codeField("code", "Six-digit code")}
        <button className="btn pri" disabled={busy}>Sign in</button>
      </form>
      <p className="small muted"><button className="linklike" onClick={() => go("recovery")}>I do not have my phone</button></p>
    </Card>}
    {step === "recovery" && <Card title="Use a recovery code">
      <p className="muted">Enter one of the ten codes you saved when you set up two-step sign-in. If you have none left, ask an owner at your firm, or write to support.</p>
      <form className="col" style={{ gap: 8 }} onSubmit={run(async () => { await api.post("/auth/recovery", { code }); home(); })}>
        <label htmlFor="recovery">Recovery code</label><input id="recovery" autoComplete="off" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn pri" disabled={busy}>Sign in</button>
      </form>
      <p className="small muted"><button className="linklike" onClick={() => go("code")}>Use my authenticator app instead</button></p>
    </Card>}
  </main>;
}
