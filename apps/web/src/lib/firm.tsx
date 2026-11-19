// The firm's workspace in the browser. The server sends the saved state; the same rules engine that runs on the server loads it
// here, so every count, status and check on screen comes from the engine and nothing is worked out twice (CLAUDE.md).
// The engine here is for reading. Anything that changes something goes to the server as one action and the state is fetched again.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createEngine, type Engine } from "virtual:engine";
import { api, ApiError, type Me } from "./api";

// The engine reads hours off its clock, which must show the firm's own wall time (packages/core/pipeline.js wallTime).
export function wallTime(date: Date, iana?: string | null): Date {
  if (!iana) return date;
  const p: Record<string, number> = {};
  new Intl.DateTimeFormat("en-US", { timeZone: iana, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(date).forEach((x) => { p[x.type] = +x.value; });
  return new Date(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}
export function loadEngine(stateText: string, now = new Date()): Engine {
  const T = createEngine(); T.load(stateText); T.setNow(wallTime(now, T.S.firm.iana)); return T;
}

export interface Firm {
  T: Engine; me: Me;
  /** staff may change things; read-only may look */
  can: (level?: "owner") => boolean;
  /** One staff action, by the engine function's name. Resolves with what the engine returned, after the screen has the new state. */
  act: (fn: string, ...args: unknown[]) => Promise<unknown>;
  /** Many actions in one turn: the firm is loaded and saved once. Resolves with each result, in order. */
  actMany: (calls: [fn: string, ...args: unknown[]][]) => Promise<unknown[]>;
  reload: () => Promise<void>;
  toast: (text: string) => void;
}
const Ctx = createContext<Firm | null>(null);
export const useFirm = (): Firm => { const f = useContext(Ctx); if (!f) throw new Error("useFirm outside FirmProvider"); return f; };

type Phase = { at: "loading" } | { at: "signin" } | { at: "error"; message: string } | { at: "ready"; T: Engine; me: Me };
const REFRESH_MS = 30000;

export function FirmProvider({ children, onSignedOut }: { children: ReactNode; onSignedOut: () => void }) {
  const [phase, setPhase] = useState<Phase>({ at: "loading" }), [toastText, setToast] = useState<string | null>(null);
  const meRef = useRef<Me | null>(null), timer = useRef<number | undefined>(undefined);
  const toast = useCallback((text: string) => { setToast(text); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(null), 4500); }, []);
  const reload = useCallback(async () => {
    try {
      const me = meRef.current || (meRef.current = await api.me());
      setPhase({ at: "ready", T: loadEngine(await api.stateText()), me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { meRef.current = null; setPhase({ at: "signin" }); onSignedOut(); return; }
      setPhase((p) => (p.at === "ready" ? p : { at: "error", message: (err as Error).message }));   // a failed refresh keeps what is on screen
    }
  }, [onSignedOut]);
  useEffect(() => { void reload(); }, [reload]);
  // New texts and documents arrive without anyone clicking. Look again every half minute while the tab is in front.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void reload(); };
    const h = window.setInterval(tick, REFRESH_MS); document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(h); document.removeEventListener("visibilitychange", tick); };
  }, [reload]);
  const act = useCallback(async (fn: string, ...args: unknown[]) => {
    try { const r = await api.act(fn, args); await reload(); return r.result; }
    catch (err) { if (err instanceof ApiError && err.status === 401) { await reload(); return null; } toast((err as Error).message); throw err; }
  }, [reload, toast]);
  const actMany = useCallback(async (calls: [string, ...unknown[]][]) => {
    if (!calls.length) return [];
    try { const r = await api.actMany(calls.map(([fn, ...args]) => ({ fn, args }))); await reload(); return r.results; }
    catch (err) { if (err instanceof ApiError && err.status === 401) { await reload(); return []; } toast((err as Error).message); throw err; }
  }, [reload, toast]);
  const value = useMemo<Firm | null>(() => phase.at !== "ready" ? null : { T: phase.T, me: phase.me, can: (level) => (level === "owner" ? phase.me.role === "owner" : phase.me.role !== "read_only"), act, actMany, reload, toast }, [phase, act, actMany, reload, toast]);

  if (phase.at === "loading" || phase.at === "signin") return <div className="main"><div className="empty" role="status">Loading your firm…</div></div>;
  if (phase.at === "error") return <div className="main"><div className="empty" role="alert"><b>Tallyhound could not load your firm.</b><br />{phase.message}<br /><button className="btn" style={{ marginTop: 12 }} onClick={() => { setPhase({ at: "loading" }); void reload(); }}>Try again</button></div></div>;
  return <Ctx.Provider value={value}>{children}{toastText ? <div className="toast" role="status">{toastText}</div> : null}</Ctx.Provider>;
}
