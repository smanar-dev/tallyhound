// Encryption at rest, above the database and the file store.
// Every firm has its own data key. The data key is stored wrapped (encrypted) by a master key that lives in a key
// management service, never in the database. A stolen database backup or storage bucket is unreadable on its own,
// and one firm's key cannot open another firm's data.
//
// AES-256-GCM. Layout of every sealed value: "th1" | 12-byte nonce | 16-byte tag | ciphertext.
// Firm state is compressed before sealing: JSON shrinks roughly tenfold, which matters because it is rewritten often.
const crypto = require("node:crypto");
const zlib = require("node:zlib");
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
  return {
    inner,
    firmIdByNumber: (n) => inner.firmIdByNumber(n), setNumber: (id, n) => inner.setNumber(id, n), firmIdByInbox: (a) => inner.firmIdByInbox(a),
    async create(id, json, where) { const key = await keyFor(id, true); return inner.create(id, pack(key, id, json), where); },
    async lock(id, fn) { const key = await keyFor(id, false); return inner.lock(id, async (v) => pack(key, id, await fn(unpack(key, id, v)))); },
    async readState(id) { const key = await keyFor(id, false); return unpack(key, id, await inner.readState(id)); },
    async putFile(firmId, bytes, contentType) { const key = await keyFor(firmId, false); return inner.putFile(firmId, seal(key, Buffer.from(bytes), "file:" + firmId), contentType); },
    async getFile(firmId, fileKey) { const key = await keyFor(firmId, false), f = await inner.getFile(firmId, fileKey); return f ? { bytes: open(key, f.bytes, "file:" + firmId), contentType: f.contentType } : null; },
    deleteFile: (firmId, fileKey) => inner.deleteFile(firmId, fileKey),
    // Deleting the data key makes every sealed value for the firm unreadable at once, backups included.
    async destroyFirm(firmId) { cache.delete(firmId); await inner.putKey(firmId, null); if (inner.destroyFirm) await inner.destroyFirm(firmId); }
  };
}
module.exports = { seal, open, localKeyring, encryptedStore };
