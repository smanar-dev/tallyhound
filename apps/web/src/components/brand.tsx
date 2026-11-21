// The Tallyhound mark, lockup and hound. The artwork is copied unchanged from the website's code (src/components/site/ui.jsx and
// Hound.jsx), which the brand book names as the master. Do not redraw, recolour or flip it here: change it there, then copy it again.
//
// Where the hound may appear in the product (brand book section 5, docs/REBRAND.md section 3): the loading screen, empty states,
// success moments, fetch progress. Never beside an error, on security, billing-problem or sign-in-problem screens, or on any page a
// firm's client sees. One hound per view. Decorative hounds carry no title and are hidden from screen readers.
import { useId } from "react";

export function Mark({ size = 36, title, inverse = false }: { size?: number; title?: string; inverse?: boolean }) {
  const bg = inverse ? "#F6F2E9" : "#13261F", fg = inverse ? "#13261F" : "#F6F2E9";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="15" fill={bg} />
      <path d="M15 51 C15 42 16.5 33 20.5 26 C24 20 29.5 15.5 36 15.5 C40 15.5 42.8 17.3 45 20.2 C46.2 21.8 47.6 22.9 49.6 23.6 L54.6 25.4 C57.6 26.5 58.6 30 56.6 32.3 C55.5 33.6 53.8 34.1 52.2 33.8 L46.5 32.8 C44.4 32.5 42.6 33.8 42 35.8 L39.2 45.6 C38.4 48.8 36.2 51 33 51 Z" fill={fg} />
      <path d="M25.2 20.6 C22 26.5 21.2 34.5 23.4 41.8 C24.4 45 27.9 45.3 29.3 42.4 C31.6 37.4 32.4 29.2 31 21.4 C30.4 18.6 26.7 18 25.2 20.6 Z" fill={bg} stroke={fg} strokeWidth="1.6" />
      <circle cx="41.5" cy="22.6" r="2" fill={bg} />
      <path d="M17 46.8 L37.6 46.8" stroke="#F26B3A" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="29" cy="53.4" r="6.6" fill="#F26B3A" />
      <path d="M25.8 53.6 l2.3 2.3 l4.3-4.6" stroke="#13261F" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The lockup: the mark to the left of the wordmark. dark = on Ledger. */
export function Logo({ dark = false, size = 36 }: { dark?: boolean; size?: number }) {
  return <span className="lockup"><Mark size={size} inverse={dark} /><span className="wordmark" style={{ fontSize: Math.round(size * 0.62) }}>Tallyhound</span></span>;
}

// The hound: a tri-colour foxhound in a Fox collar with a check tag, side view, facing right.
// mode: "run" gallops, "wag" wags the tail, "sniff" dips the head, "sit" is still. Reduced motion stops all of it.
export function Hound({ width = 140, mode = "wag", carry = false, className = "", title, tone = "dark" }: { width?: number; mode?: string; carry?: boolean; className?: string; title?: string; tone?: "dark" | "light" }) {
  const id = useId().replace(/:/g, "");
  const tan = "tan" + id, sad = "sad" + id, sh = "sh" + id, haun = "hn" + id;
  const saddleTop = tone === "light" ? "#4F6F61" : "#22382F", saddleBot = tone === "light" ? "#3A5A4C" : "#13261F";
  return (
    <svg className={"th-hound " + mode + " " + className} width={width} height={width * 0.62} viewBox="0 0 150 92" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={tan} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DCA56C" /><stop offset="1" stopColor="#B97A3E" /></linearGradient>
        <linearGradient id={sad} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={saddleTop} /><stop offset="1" stopColor={saddleBot} /></linearGradient>
        <radialGradient id={haun} cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#D49A5E" /><stop offset="1" stopColor="#A9692F" /></radialGradient>
        <radialGradient id={sh}><stop offset="0" stopColor="#13261F" stopOpacity=".3" /><stop offset="1" stopColor="#13261F" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse className="shadow" cx="76" cy="85" rx="46" ry="4.5" fill={`url(#${sh})`} />
      <g className="body">
        <g className="tail">
          <path d="M38 34 C29 30 23 22 21 11" stroke={`url(#${tan})`} strokeWidth="4.6" fill="none" strokeLinecap="round" />
          <path d="M22.4 15 C21.8 13 21.3 11.6 21 10" stroke="#FFFDF8" strokeWidth="4.6" strokeLinecap="round" />
        </g>
        <g className="leg b2"><path d="M55 46 C55 54 52 60 55 66 L58 77" stroke="#A86C33" strokeWidth="5.6" fill="none" strokeLinecap="round" /><ellipse cx="60" cy="78.5" rx="4" ry="2.2" fill="#E9E1D2" /></g>
        <g className="leg f2"><path d="M96 48 L96 64 L96 77" stroke="#A86C33" strokeWidth="5.2" fill="none" strokeLinecap="round" /><ellipse cx="98.5" cy="78.5" rx="4" ry="2.2" fill="#E9E1D2" /></g>
        <path d="M39 30 C53 27 77 27 93 25 C98 24 101 21 104 17 L114 25 C113 33 114 39 111 45 C108 51 103 54 96 53 C88 52 81 47 72 47 C64 47 58 51 50 50 C41 49 35 44 35 37 C35 33 36 31 39 30 Z" fill={`url(#${tan})`} />
        <path d="M36 37 C36 45 42 51 50 50.5 C56 50 58 45 56 40 C54 35 47 32 41 33 C38 33.5 36 35 36 37 Z" fill={`url(#${haun})`} opacity=".9" />
        <path d="M42 29.5 C56 27 77 27 92 25.4 C96 25 98.5 27 98 30.5 C97.5 36 91 40.5 82 40.5 C76 40.5 70 41.5 63 42 C56 42.5 50 42 46 40.5 C41 38.5 38.5 36 39 33 C39.3 31 40.3 30 42 29.5 Z" fill={`url(#${sad})`} />
        <path d="M111 40 C110 47 105 53 98 53 C93 53 91 50 93 46 C96 42 104 40 111 40 Z" fill="#FFFDF8" />
        <g className="leg b1"><path d="M47 44 C48 53 44 59 47 66 L51 77" stroke={`url(#${tan})`} strokeWidth="6" fill="none" strokeLinecap="round" /><ellipse cx="53" cy="78.4" rx="4.4" ry="2.4" fill="#FFFDF8" /></g>
        <g className="leg f1"><path d="M102 48 L103 64 L102 77" stroke={`url(#${tan})`} strokeWidth="5.8" fill="none" strokeLinecap="round" /><ellipse cx="104.5" cy="78.4" rx="4.4" ry="2.4" fill="#FFFDF8" /></g>
        <g className="head">
          <path d="M102 19 C104 11 110 6 118 6 C122 6 125 8 128 10 L135 13.5 C138.5 15 138 18.5 134.5 19 L126 20 C121 21 117 24 115 29 Z" fill={`url(#${tan})`} />
          <path d="M126 11 L135 13.5 C138.5 15 138 18.5 134.5 19 L126 20 C124 18 124 13 126 11 Z" fill="#FFFDF8" />
          <path d="M112 7.5 C116 6 120 6.5 123 8 C120 10 117 12 115.5 16 C114 13 113 10 112 7.5 Z" fill="#FFFDF8" opacity=".85" />
          <path className="ear" d="M114 8.5 C107 9.5 103.5 17 105.5 29 C110 27.5 114.5 20 117 12 Z" fill="#13261F" />
          <circle cx="122.6" cy="11" r="1.7" fill="#13261F" /><circle cx="123.1" cy="10.5" r=".55" fill="#fff" />
          <ellipse cx="136.5" cy="15.6" rx="2.2" ry="1.8" fill="#13261F" />
          <path d="M131 19.6 C132.5 20.5 134 20.4 135.2 19.4" stroke="#8C5A2B" strokeWidth=".8" fill="none" strokeLinecap="round" />
          {carry && (
            <g transform="translate(129 15) rotate(10)">
              <g className="th-pop" style={{ transformBox: "fill-box", transformOrigin: "30% 30%" }}>
                <rect width="17" height="21" rx="1.6" fill="#FFFDF8" stroke="#13261F" strokeWidth="1.2" />
                <rect x="2.6" y="3.2" width="9" height="2.6" rx=".8" fill="#C0392B" />
                <rect x="2.6" y="8" width="11.5" height="1.5" rx=".7" fill="#C9BFA9" /><rect x="2.6" y="11.2" width="9" height="1.5" rx=".7" fill="#C9BFA9" /><rect x="2.6" y="14.4" width="10.5" height="1.5" rx=".7" fill="#C9BFA9" />
              </g>
            </g>
          )}
          <path d="M104 21 L114 28.4" stroke="#F26B3A" strokeWidth="4.2" strokeLinecap="round" />
          <path d="M105 20.3 L113.5 26.6" stroke="#FF9C73" strokeWidth="1" strokeLinecap="round" opacity=".7" />
          <circle cx="111.5" cy="32.4" r="3.6" fill="#F26B3A" />
          <path d="M109.9 32.5 l1.2 1.2 l2.2-2.4" stroke="#13261F" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

/** An empty or finished screen: the hound, one line, and at most one button. Use only where there is no problem to report. */
export function HoundNote({ mode = "wag", title, children, carry = false }: { mode?: string; title: string; children?: React.ReactNode; carry?: boolean }) {
  return <div className="empty hound"><Hound width={120} mode={mode} carry={carry} /><h3>{title}</h3>{children}</div>;
}
