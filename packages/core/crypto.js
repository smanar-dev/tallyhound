// Encryption at rest, above the database and the file store.
// Every firm has its own data key. The data key is stored wrapped (encrypted) by a master key that lives in a key
// management service, never in the database. A stolen database backup or storage bucket is unreadable on its own,
// and one firm's key cannot open another firm's data.
//
// AES-256-GCM. Layout of every sealed value: "th1" | 12-byte nonce | 16-byte tag | ciphertext.
// Firm state is compressed before sealing: JSON shrinks roughly tenfold, which matters because it is rewritten often.
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const parts = require("./parts");
const MAGIC = Buffer.from("th1");

function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv); if (aad) c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function open(key, sealed, aad) {
  const b = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed); if (b.length < 31 || !b.subarray(0, 3).equals(MAGIC)) throw new Error("Not a sealed value");
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(3, 15)); if (aad) d.setAAD(Buffer.from(String(aad))); d.setAuthTag(b.subarray(15, 31));
  return Buffer.concat([d.update(b.subarray(31)), d.final()]);   // throws if the data or the label was changed
}
// The master key. In production wrap() and unwrap() call the cloud key service (T-102); this local version is for tests and development.
function localKeyring(masterKey) {
  const mk = Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(String(masterKey), "base64"); if (mk.length !== 32) throw new Error("The master key must be 32 bytes");
  return { async newDataKey(label) { const plain = crypto.randomBytes(32); return { plain, wrapped: seal(mk, plain, "key:" + label) }; }, async unwrap(wrapped, label) { return open(mk, wrapped, "key:" + label); } };
}
// Wraps any store so that firm state and files are sealed before they reach it. Same methods as the store it wraps.
// The wrapped store needs getKey(firmId) and putKey(firmId, wrappedKey) for the per-firm data key.
function encryptedStore(inner, keyring) {
  const cache = new Map();
  async function keyFor(firmId, create) {
    if (cache.has(firmId)) return cache.get(firmId);
    let w = await inner.getKey(firmId), plain;
    if (w) plain = await keyring.unwrap(w, firmId); else if (create) { const k = await keyring.newDataKey(firmId); await inner.putKey(firmId, k.wrapped); plain = k.plain; } else throw new Error("No key for firm " + firmId);
    cache.set(firmId, plain); return plain;
  }
  const pack = (key, firmId, json) => seal(key, zlib.gzipSync(Buffer.from(json, "utf8")), "state:" + firmId).toString("base64");
  const unpack = (key, firmId, v) => (v == null ? null : zlib.gunzipSync(open(key, Buffer.from(v, "base64"), "state:" + firmId)).toString("utf8"));
  const hash = (key, id, term) => crypto.createHmac("sha256", key).update("index:" + id + ":" + term).digest("hex").slice(0, 40);
  const pick = (key, id, scope) => { const t = []; if (scope.mobile) t.push("m:" + scope.mobile); for (const e of [scope.email].concat(scope.emails || [])) if (e) t.push("e:" + String(e).toLowerCase()); return { hashes: t.map((x) => hash(key, id, x)), keys: (scope.clientIds || []).filter(Boolean).map(parts.partKey) }; };
  const packPart = (key, id, name, text) => seal(key, zlib.gzipSync(Buffer.from(text, "utf8")), "part:" + id + ":" + name).toString("base64");
  const openPart = (key, id, name, v) => zlib.gunzipSync(open(key, Buffer.from(v, "base64"), "part:" + id + ":" + name)).toString("utf8");
  // What was loaded, joined into one workspace, plus what is needed to save only the difference.
  function join(key, id, raw) {
    const coreText = unpack(key, id, raw.core), core = JSON.parse(coreText);
    if (core.v !== 2) return { json: coreText, texts: new Map(), known: null, bounds: null, old: true };   // saved before parts existed: split on this save
    const texts = new Map(), slices = new Map();
    for (const p of raw.parts) { const t = openPart(key, id, p.key, p.sealed); texts.set(p.key, t); slices.set(p.key, JSON.parse(t)); }
    const m = parts.merge(core, slices); return { whole: m.whole, texts, known: m.known, bounds: m.bounds, coreText };
  }
  async function turn(key, id, raw, fn) {
    if (raw.core == null) { const next = await fn(null); return { core: pack(key, id, next), put: [], del: [], audit: null, lines: 0 }; }
    const L = join(key, id, raw), next = JSON.parse(await fn(L.old ? L.json : JSON.stringify(L.whole))), s = parts.split(next, L.known, L.bounds), put = [];
    for (const [name, slice] of s.slices) { const text = JSON.stringify(slice); if (L.texts.get(name) !== text) put.push({ key: name, sealed: packPart(key, id, name, text), hashes: (s.terms.get(name) || []).map((x) => hash(key, id, x)) }); }
    const del = [...L.texts.keys()].filter((name) => !s.slices.has(name)), coreText = JSON.stringify(s.core);
    return { core: coreText === L.coreText ? null : pack(key, id, coreText), put, del, lines: s.audit.length, audit: s.audit.length ? packPart(key, id, "audit", JSON.stringify(s.audit)) : null };
  }
  function read(key, id, raw) {
    if (!raw || raw.core == null) return null; const L = join(key, id, raw); if (L.old) return L.json;
    const lines = []; for (const row of raw.audit || []) for (const a of JSON.parse(openPart(key, id, "audit", row))) lines.push(a);
    L.whole.state.audit = lines; return JSON.stringify(L.whole);
  }
  return {
    inner,
    firmIdByNumber: (n) => inner.firmIdByNumber(n), setNumber: (id, n) => inner.setNumber(id, n), firmIdByInbox: (a) => inner.firmIdByInbox(a),
    async create(id, json, where) { const key = await keyFor(id, true); return inner.create(id, pack(key, id, json), where); },
    // T-33/T-101: with a store that keeps parts, the firm is saved as a core, one part per client and audit rows (see parts.js).
    // lock and readState still hand over and take back one whole workspace. lockScope and readScope load only the clients an
    // event is about: { mobile, email, emails, clientIds }. Every part is sealed on its own, under a label that names it.
    async lock(id, fn) { const key = await keyFor(id, false); if (!inner.lockParts) return inner.lock(id, async (v) => pack(key, id, await fn(unpack(key, id, v)))); return inner.lockParts(id, null, (raw) => turn(key, id, raw, fn)); },
    async lockScope(id, scope, fn) { const key = await keyFor(id, false); if (!inner.lockParts) return this.lock(id, fn); return inner.lockParts(id, pick(key, id, scope), (raw) => turn(key, id, raw, fn)); },
    async readState(id, opt) { const key = await keyFor(id, false); if (!inner.readParts) return unpack(key, id, await inner.readState(id)); return read(key, id, await inner.readParts(id, null, opt && opt.audit != null ? opt.audit : Infinity)); },
    async readScope(id, scope) { const key = await keyFor(id, false); if (!inner.readParts) return this.readState(id); return read(key, id, await inner.readParts(id, pick(key, id, scope), 0)); },
    async putFile(firmId, bytes, contentType) { const key = await keyFor(firmId, false); return inner.putFile(firmId, seal(key, Buffer.from(bytes), "file:" + firmId), contentType); },
    async getFile(firmId, fileKey) { const key = await keyFor(firmId, false), f = await inner.getFile(firmId, fileKey); return f ? { bytes: open(key, f.bytes, "file:" + firmId), contentType: f.contentType } : null; },
    deleteFile: (firmId, fileKey) => inner.deleteFile(firmId, fileKey),
    // Deleting the data key makes every sealed value for the firm unreadable at once, backups included.
    async destroyFirm(firmId) { cache.delete(firmId); await inner.putKey(firmId, null); if (inner.destroyFirm) await inner.destroyFirm(firmId); }
  };
}
module.exports = { seal, open, localKeyring, encryptedStore };
