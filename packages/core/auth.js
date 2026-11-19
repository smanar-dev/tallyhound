// Staff sign-in: an emailed link, then a six-digit code from an authenticator app. No passwords to steal or reuse.
// Sessions are random tokens; only their hash is stored (see db/schema.sql), so a database reader cannot sign in as anyone.
const crypto = require("node:crypto");
const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("base64url");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const LINK_MIN = 15;
// The caller emails https://app/…?t=<token>. jti is stored and refused on second use.
function issueLink(secret, email, now) { const body = b64(JSON.stringify({ e: String(email).toLowerCase(), x: +now + LINK_MIN * 60000, j: crypto.randomBytes(9).toString("base64url") })); return body + "." + sign(secret, body); }
function checkLink(secret, token, now, used) {
  const [body, mac] = String(token || "").split("."); if (!body || !mac || !same(mac, sign(secret, body))) return { ok: false, why: "invalid" };
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch (e) { return { ok: false, why: "invalid" }; }
  if (+now > p.x) return { ok: false, why: "expired" }; if (used && used.has(p.j)) return { ok: false, why: "used" }; if (used) used.add(p.j);
  return { ok: true, email: p.e, jti: p.j };
}
// Time-based one-time codes (RFC 6238), the kind every authenticator app speaks.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; }
function totpSecret() { const raw = crypto.randomBytes(20); return { raw, text: base32(raw) }; }
function totp(raw, now, step) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(+now / 1000 / (step || 30)))); const h = crypto.createHmac("sha1", raw).update(c).digest(), o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, "0"); }
// Accepts the code for this half-minute and the one either side, so a slow typist or a slightly wrong phone clock still gets in.
// lastStep: the step number of the last accepted code for this user; the same code is never accepted twice.
function verifyTotp(raw, code, now, lastStep) { const step = Math.floor(+now / 30000); for (const k of [0, -1, 1]) { if (lastStep != null && step + k <= lastStep) continue; if (same(totp(raw, (step + k) * 30000), String(code || "").replace(/\s/g, ""))) return { ok: true, step: step + k }; } return { ok: false }; }
const setupUri = (issuer, email, secretText) => "otpauth://totp/" + encodeURIComponent(issuer + ":" + email) + "?secret=" + secretText + "&issuer=" + encodeURIComponent(issuer) + "&digits=6&period=30";
// Ten one-time recovery codes, shown once. Only the hashes are stored.
function recoveryCodes() { const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").replace(/(.{5})/, "$1-")); return { codes, hashes: codes.map(hashToken) }; }
function hashToken(t) { return crypto.createHash("sha256").update(String(t)).digest("hex"); }
function newSession(now, hours) { const token = crypto.randomBytes(32).toString("base64url"); return { token, hash: hashToken(token), expiresAt: new Date(+now + (hours || 12) * 3600000) }; }
module.exports = { issueLink, checkLink, totpSecret, totp, verifyTotp, setupUri, base32, recoveryCodes, hashToken, newSession, LINK_MIN };
