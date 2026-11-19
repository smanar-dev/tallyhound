// Getting a file ready before anything reads it. The sender's label for a file is never trusted: the first bytes say what it is.
const crypto = require("node:crypto");
function sniff(b) {
  if (!b || b.length < 12) return "unknown"; const h = b.subarray(0, 12), s = h.toString("latin1");
  if (h[0] === 0xff && h[1] === 0xd8) return "image/jpeg"; if (s.startsWith("\x89PNG")) return "image/png"; if (s.startsWith("%PDF")) return "application/pdf";
  if (s.slice(4, 8) === "ftyp" && /heic|heix|hevc|mif1|msf1|heim|heis/.test(s.slice(8, 12))) return "image/heic";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp"; if (s.startsWith("II*\0") || s.startsWith("MM\0*")) return "image/tiff";
  if (s.startsWith("PK\x03\x04")) return "application/zip";   // also every Word, Excel and PowerPoint file
  if (h[0] === 0xd0 && h[1] === 0xcf) return "application/msword"; if (s.startsWith("MZ")) return "application/x-executable";
  return "unknown";
}
const fingerprint = (b) => crypto.createHash("sha256").update(b).digest("hex");
// Enough of a look inside a PDF to know whether it is locked and roughly how long it is, without a PDF library.
function pdfInfo(b) { const s = b.toString("latin1"); return { locked: /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(s), pages: (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length }; }
// opt.heic: async (bytes) -> jpeg bytes (the `heic-convert` package). opt.image: async (bytes) -> { bytes, width, height, mean, sharp }
// (the `sharp` package: rotate by EXIF, shrink to 2,000 px on the long side, measure). opt.scan: async (bytes) -> { clean, name }.
// Each is optional so this file has no dependencies; production passes all three (T-127).
async function prepare(file, opt) {
  const o = opt || {}; let bytes = Buffer.from(file.bytes), type = sniff(bytes); const out = { name: file.name, inline: !!file.inline, declared: file.contentType || "", fingerprint: fingerprint(bytes) };
  if (o.scan) { const v = await o.scan(bytes); if (!v.clean) return Object.assign(out, { bytes: Buffer.alloc(0), contentType: "application/x-infected", refused: "infected", threat: v.name || "" }); }
  if (type === "image/heic") { if (!o.heic) return Object.assign(out, { bytes, contentType: type, refused: "heic" }); bytes = Buffer.from(await o.heic(bytes)); type = "image/jpeg"; out.convertedFrom = "image/heic"; }
  if (type === "application/pdf") { const info = pdfInfo(bytes); return Object.assign(out, { bytes, contentType: type, locked: info.locked, pageCount: info.pages }); }
  if (/^image\/(jpeg|png|webp|tiff)$/.test(type)) { if (o.image) { const m = await o.image(bytes); bytes = Buffer.from(m.bytes || bytes); Object.assign(out, { width: m.width, height: m.height, metrics: { width: m.width, height: m.height, mean: m.mean, sharp: m.sharp } }); if (m.bytes) type = "image/jpeg"; } return Object.assign(out, { bytes, contentType: type }); }
  return Object.assign(out, { bytes, contentType: type === "unknown" ? "application/octet-stream" : type });
}
// ClamAV's daemon speaks a tiny protocol: send the file in chunks, read one line back. connect: () -> a net.Socket-like stream.
function clamav({ connect }) {
  return function scan(bytes) { return new Promise((ok, fail) => { const s = connect(); let reply = ""; s.on("data", (d) => { reply += d.toString(); }); s.on("error", fail); s.on("end", () => { const m = /stream: (.+) FOUND/.exec(reply); ok({ clean: /stream: OK/.test(reply), name: m ? m[1] : "" }); });
    s.write("zINSTREAM\0"); for (let i = 0; i < bytes.length; i += 65536) { const c = bytes.subarray(i, i + 65536), n = Buffer.alloc(4); n.writeUInt32BE(c.length); s.write(n); s.write(c); } s.write(Buffer.alloc(4)); }); };
}
module.exports = { sniff, fingerprint, pdfInfo, prepare, clamav };
