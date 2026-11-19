// The small pieces every screen is made of. Text always goes in as text: React escapes it, so a client's name can never become markup.
import type { ReactNode } from "react";
import { ICONS, type IconName } from "../lib/icons";
import { colorOf, DSTATE, STAT } from "../lib/fmt";

export const Icon = ({ name, small }: { name: IconName; small?: boolean }) => <svg className={"i" + (small ? " s" : "")} viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
export const Avatar = ({ first, last, small }: { first?: string; last?: string; small?: boolean }) => <span className={"av" + (small ? " sm" : "")} style={{ background: colorOf(first || "?", last || "") }}>{(first || "?")[0]}{(last || "")[0]}</span>;
export const UserAvatar = ({ user, small }: { user: { first?: string; name?: string }; small?: boolean }) => <Avatar first={user.first || "?"} last={(user.name || "").split(" ")[1] || " "} small={small} />;
export const Chip = ({ tone, children }: { tone?: string; children: ReactNode }) => <span className={"chip " + (tone || "")}>{children}</span>;
export const StatusChip = ({ status }: { status: string }) => <Chip tone={(STAT[status] || ["", ""])[1]}>{(STAT[status] || [status])[0]}</Chip>;
export const DocChip = ({ state }: { state: string }) => <Chip tone={(DSTATE[state] || ["", ""])[1]}>{(DSTATE[state] || [state])[0]}</Chip>;
export const Empty = ({ children, small }: { children: ReactNode; small?: boolean }) => <div className={"empty" + (small ? " small" : "")}>{children}</div>;
export function Ring({ done, total, size, label }: { done: number; total: number; size: number; label: string }) {
  const r = 52, C = 2 * Math.PI * r, p = total ? done / total : 0;
  return <div className="ring" style={{ width: size, height: size }}>
    <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r={r} fill="none" stroke="#F1EDE3" strokeWidth="12" />{p > 0 ? <circle cx="60" cy="60" r={r} fill="none" stroke="#127A4E" strokeWidth="12" strokeLinecap="round" strokeDasharray={(C * p).toFixed(1) + " " + C.toFixed(1)} /> : null}</svg>
    <div><span><b style={{ fontSize: size > 100 ? 28 : 18 }}>{done}</b><br /><span className="small muted">{label}</span></span></div>
  </div>;
}
