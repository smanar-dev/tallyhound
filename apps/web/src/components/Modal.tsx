// A dialog. Focus moves into it when it opens and back to where it was when it closes; Escape and the backdrop close it;
// Tab stays inside it (T-53).
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';
export function Modal({ title, wide, onClose, children, footer, head }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; head?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null, el = box.current!;
    (el.querySelector<HTMLElement>("input:not([type=checkbox]):not([disabled]), select, textarea") || el.querySelector<HTMLElement>(".btn.pri") || el).focus();
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); close.current(); return; }
      if (ev.key !== "Tab") return;
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]; if (!f.length) return; const first = f[0]!, last = f[f.length - 1]!;
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); if (was && document.contains(was)) was.focus(); };
  }, []);
  return <div className="modal" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
    <div className={"card" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
      <div className="hd"><h2>{title}</h2>{head ? <><span className="sp" />{head}</> : null}</div>
      <div className="bd col">{children}</div>
      {footer ? <div className="bd row" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--line2)" }}>{footer}</div> : null}
    </div>
  </div>;
}
