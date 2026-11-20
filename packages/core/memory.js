// In-memory store and fake senders for tests and local development. Production replaces each with a real one
// that has the same methods (packages/adapters/postgres.js for the store).
function memoryStore() {
  const firms = new Map(), byNumber = new Map(), byInbox = new Map(), files = new Map(), queues = new Map(), keys = new Map(); let n = 0;
  return {
    files, firms, keys,
    async create(id, json, { number, inbox }) { firms.set(id, json); if (number) byNumber.set(number, id); if (inbox) byInbox.set(inbox, id); },
    async firmIdByNumber(v) { return byNumber.get(v) || null; },
    // A firm's text number is known only once the carriers approve it, which is after the firm was created.
    async setNumber(id, number) { for (const [k, v] of byNumber) if (v === id) byNumber.delete(k); if (number) byNumber.set(number, id); },
    async firmIdByInbox(a) { return byInbox.get(a) || null; },
    async putFile(firmId, bytes, contentType) { const key = firmId + "/" + ++n; files.set(key, { bytes, contentType }); return key; },
    async getFile(firmId, key) { return String(key).startsWith(firmId + "/") ? files.get(key) || null : null; },   // a firm can only read its own files
    async deleteFile(firmId, key) { if (String(key).startsWith(firmId + "/")) files.delete(key); },
    async getKey(firmId) { return keys.get(firmId) || null; },
    async putKey(firmId, wrapped) { if (wrapped) keys.set(firmId, wrapped); else keys.delete(firmId); },
    async destroyFirm(firmId) { firms.delete(firmId); for (const k of [...files.keys()]) if (k.startsWith(firmId + "/")) files.delete(k); for (const m of [byNumber, byInbox]) for (const [k, v] of m) if (v === firmId) m.delete(k); },
    // One firm at a time: calls for the same firm queue up, exactly what a row lock gives in Postgres.
    lock(id, fn) { const prev = queues.get(id) || Promise.resolve(); const run = prev.catch(() => {}).then(async () => { const next = await fn(firms.has(id) ? firms.get(id) : null); firms.set(id, next); }); queues.set(id, run); return run; },
    async readState(id) { return firms.has(id) ? firms.get(id) : null; },
    read(id) { return firms.get(id); }
  };
}
function fakeSender() { const sent = []; return { sent, async send(m) { sent.push(m); return "fake-" + sent.length; } }; }
// A stand-in model: tests hand it a function from prompt to answer.
function fakeAI(fn) { const calls = []; return { calls, async json(prompt, opts) { calls.push({ prompt, opts }); return fn(prompt, opts); } }; }
// A stand-in for the firm's own storage (Drive, OneDrive, Dropbox, SharePoint).
function memoryFiles() { const items = new Map(); let n = 0, fail = 0; return { items, failNext(k) { fail = k; }, async put({ folder, name, bytes, contentType }) { if (fail > 0) { fail--; throw new Error("storage is down"); } const id = "g" + ++n; items.set(id, { folder, name, bytes: Buffer.from(bytes), contentType }); return id; }, async move({ id, folder, name }) { if (fail > 0) { fail--; throw new Error("storage is down"); } const f = items.get(id); if (!f) throw new Error("No such file"); f.folder = folder; f.name = name; } }; }
module.exports = { memoryStore, fakeSender, fakeAI, memoryFiles };
