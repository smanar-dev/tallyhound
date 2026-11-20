// The production store: Postgres for firm state, a bucket for document files.
// Same methods as packages/core/memory.js. Wrap it:  encryptedStore(postgresStore(pool, bucket), keyring)
//
// pool:   a node-postgres Pool (or anything with connect() -> client.query / client.release)
// bucket: { put(key, bytes, contentType), get(key) -> bytes | null, del(key) }   (S3: PutObject / GetObject / DeleteObject)
//
// STATUS: the SQL below runs in the test suite against an in-process Postgres emulator (pg-mem), which does not implement row
// locking. The lock itself (select ... for update) has NOT been exercised against a real server. Do that before pilot (T-100).
const crypto = require("node:crypto");
function postgresStore(pool, bucket, opt) {
  const one = async (sql, args) => { const r = await pool.query(sql, args); return r.rows[0] || null; };
  const list = (n, from) => Array.from({ length: n }, (_, i) => "$" + (i + from)).join(", ");
  // The parts a caller asked for: all of them, or the named ones plus whatever the contact index points at.
  async function partsOf(q, id, pick) {
    if (!pick) return (await q.query("select key, sealed from firm_parts where firm_id = $1", [id])).rows;
    const keys = new Set(pick.keys || []);
    if (pick.hashes && pick.hashes.length) for (const r of (await q.query("select part from firm_index where firm_id = $1 and hash in (" + list(pick.hashes.length, 2) + ")", [id].concat(pick.hashes))).rows) keys.add(r.part);
    if (!keys.size) return []; const K = [...keys];
    return (await q.query("select key, sealed from firm_parts where firm_id = $1 and key in (" + list(K.length, 2) + ")", [id].concat(K))).rows;
  }
  // T-33/T-101 (db/migrations/015). Switched on with { parts: true }; the encrypted store wrapper is the only caller.
  const withParts = !(opt && opt.parts) ? {} : {
    async lockParts(id, pick, fn) {
      const c = await pool.connect();
      try { await c.query("begin"); const r = await c.query("select sealed from firm_state where firm_id = $1 for update", [id]);
        const out = await fn({ core: r.rows[0] ? r.rows[0].sealed : null, parts: r.rows[0] ? await partsOf(c, id, pick) : [] });
        for (const k of out.del) { await c.query("delete from firm_parts where firm_id = $1 and key = $2", [id, k]); await c.query("delete from firm_index where firm_id = $1 and part = $2", [id, k]); }
        for (const p of out.put) {
          await c.query("insert into firm_parts (firm_id, key, sealed, bytes) values ($1, $2, $3, $4) on conflict (firm_id, key) do update set sealed = excluded.sealed, bytes = excluded.bytes, updated_at = now()", [id, p.key, p.sealed, p.sealed.length]);
          await c.query("delete from firm_index where firm_id = $1 and part = $2", [id, p.key]);
          for (const h of new Set(p.hashes || [])) await c.query("insert into firm_index (firm_id, hash, part) values ($1, $2, $3)", [id, h, p.key]);
        }
        if (out.audit) await c.query("insert into firm_audit (firm_id, lines, sealed) values ($1, $2, $3)", [id, out.lines || 0, out.audit]);
        if (out.core != null) await c.query("update firm_state set sealed = $2, bytes = $3, version = version + 1, updated_at = now() where firm_id = $1", [id, out.core, out.core.length]);
        await c.query("commit"); }
      catch (err) { await c.query("rollback"); throw err; } finally { c.release(); }
    },
    // One snapshot for the core, the parts and the audit rows, so a read never sees half of somebody else's save.
    async readParts(id, pick, auditLimit) {
      const c = await pool.connect();
      try { await c.query("begin isolation level repeatable read read only");
        const r = (await c.query("select sealed from firm_state where firm_id = $1", [id])).rows[0]; if (!r) { await c.query("commit"); return null; }
        const out = { core: r.sealed, parts: await partsOf(c, id, pick), audit: [] };
        if (auditLimit) out.audit = (await c.query("select sealed from firm_audit where firm_id = $1 order by id desc" + (auditLimit === Infinity ? "" : " limit " + Math.max(1, Math.floor(auditLimit))), [id])).rows.map((x) => x.sealed);
        await c.query("commit"); return out; }
      catch (err) { await c.query("rollback").catch(() => {}); throw err; } finally { c.release(); }
    }
  };
  return Object.assign(withParts, {
    async create(id, sealed, { number, inbox, name }) {
      const c = await pool.connect();
      try { await c.query("begin"); await c.query("insert into firms (id, name, inbox, sms_number) values ($1, $2, $3, $4) on conflict (id) do update set inbox = excluded.inbox, sms_number = excluded.sms_number", [id, name || id, inbox || null, number || null]);
        await c.query("insert into firm_state (firm_id, sealed, bytes) values ($1, $2, $3)", [id, sealed, sealed.length]); await c.query("commit"); }
      catch (err) { await c.query("rollback"); throw err; } finally { c.release(); }
    },
    async setNumber(id, number) { await pool.query("update firms set sms_number = $2 where id = $1", [id, number || null]); },
    async firmIdByNumber(v) { const r = v ? await one("select id from firms where sms_number = $1 and status = 'active'", [v]) : null; return r ? r.id : null; },
    async firmIdByInbox(a) { const r = a ? await one("select id from firms where inbox = $1 and status = 'active'", [String(a).toLowerCase()]) : null; return r ? r.id : null; },
    // One firm at a time, across every server: the row lock is held for the whole of fn. Keep fn short (no sending inside it).
    async lock(id, fn) {
      const c = await pool.connect();
      try { await c.query("begin"); const r = await c.query("select sealed from firm_state where firm_id = $1 for update", [id]);
        const next = await fn(r.rows[0] ? r.rows[0].sealed : null);
        await c.query("update firm_state set sealed = $2, bytes = $3, version = version + 1, updated_at = now() where firm_id = $1", [id, next, next.length]); await c.query("commit"); }
      catch (err) { await c.query("rollback"); throw err; } finally { c.release(); }
    },
    async readState(id) { const r = await one("select sealed from firm_state where firm_id = $1", [id]); return r ? r.sealed : null; },
    async putFile(firmId, bytes, contentType) {
      const key = firmId + "/" + crypto.randomBytes(16).toString("hex");
      await bucket.put(key, bytes, "application/octet-stream");   // sealed bytes: the real type is kept in the database, not on the object
      await pool.query("insert into files (key, firm_id, content_type, bytes) values ($1, $2, $3, $4)", [key, firmId, contentType || "application/octet-stream", bytes.length]); return key;
    },
    async getFile(firmId, key) { const r = await one("select content_type from files where key = $1 and firm_id = $2 and deleted_at is null", [key, firmId]); if (!r) return null; const bytes = await bucket.get(key); return bytes ? { bytes, contentType: r.content_type } : null; },
    // The object goes first. If that fails the row still says "not deleted" and the pipeline tries again.
    async deleteFile(firmId, key) { const r = await one("select key from files where key = $1 and firm_id = $2", [key, firmId]); if (!r) return; await bucket.del(key); await pool.query("update files set deleted_at = now() where key = $1 and firm_id = $2", [key, firmId]); },
    async getKey(firmId) { const r = await one("select wrapped_key from firms where id = $1", [firmId]); return r && r.wrapped_key ? Buffer.from(r.wrapped_key) : null; },
    async putKey(firmId, wrapped) { const r = await pool.query("update firms set wrapped_key = $2 where id = $1", [firmId, wrapped]); if (!r.rowCount && wrapped) await pool.query("insert into firms (id, name, wrapped_key) values ($1, $1, $2)", [firmId, wrapped]); },
    async destroyFirm(firmId) {
      const L = await pool.query("select key from files where firm_id = $1 and deleted_at is null", [firmId]);
      for (const f of L.rows) { await bucket.del(f.key); await pool.query("update files set deleted_at = now() where key = $1", [f.key]); }
      await pool.query("delete from firm_state where firm_id = $1", [firmId]);
      if (opt && opt.parts) for (const t of ["firm_parts", "firm_index", "firm_audit"]) await pool.query("delete from " + t + " where firm_id = $1", [firmId]);
      await pool.query("update firms set status = 'destroyed', wrapped_key = null, inbox = null, sms_number = null, destroyed_at = now() where id = $1", [firmId]);
    },
    async audit(firmId, actor, action, detail) { await pool.query("insert into audit_log (firm_id, actor, action, detail) values ($1, $2, $3, $4)", [firmId, actor, action, detail || null]); },
    // A webhook delivery we have already taken returns false.
    async firstTime(provider, providerId, firmId) { if (!providerId) return true; const r = await pool.query("insert into inbound_events (provider, provider_id, firm_id) values ($1, $2, $3) on conflict do nothing", [provider, providerId, firmId || null]); return r.rowCount > 0; }
  });
}
function memoryBucket() { const m = new Map(); return { m, async put(k, b) { m.set(k, Buffer.from(b)); }, async get(k) { return m.get(k) || null; }, async del(k) { m.delete(k); } }; }
module.exports = { postgresStore, memoryBucket };
