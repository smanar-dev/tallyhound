// T-33, T-54, T-101: a firm is no longer saved as one value.
//
// What the engine sees has not changed: one workspace, loaded and dumped as before. What is stored is now:
//   the core        the firm's settings, people, the tray, counters, and anything that belongs to no client
//   one part each   per client: the client, their engagements, checklist items, messages, documents, tasks, alerts, log lines
//   audit rows      added to, never rewritten (the engine only ever adds to the audit trail; it never reads it)
// An event from one client loads the core and that client's part, and saves only what changed.
//
// This file is the splitting and the joining. It knows nothing about storage or sealing (crypto.js does that).
// Every element keeps its place in the firm-wide order: it is stored with a number, and joining sorts by it.

const SLICED = ["clients", "engs", "items", "msgs", "docs", "tasks", "alerts", "hlog", "archive", "memory"];
const idOf = (coll, x) => (coll === "archive" ? (x && x.clientId && x.year != null ? x.clientId + ":" + x.year : null) : coll === "memory" ? (x && x.clientId ? [x.clientId, x.year, x.form, x.payer || "", x.custom || ""].join(":") : null) : x && typeof x.id === "string" ? x.id : null);
const partKey = (clientId) => "c:" + clientId;
const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);

/** What a client can be found by on the way in: their mobile, their email, and their second contacts. Hashed before it is stored. */
function terms(client) {
  const out = new Set(), m = digits(client.mobile); if (m.length === 10) out.add("m:" + m); if (client.email) out.add("e:" + String(client.email).toLowerCase());
  for (const a of Array.isArray(client.also) ? client.also : []) if (a && a.value) out.add((a.kind === "mobile" ? "m:" : "e:") + String(a.value));
  return [...out];
}

/** Joins the core and the parts that were loaded into one workspace. Returns it with what split() needs to save it again. */
function merge(core, slices) {
  const state = Object.assign({}, core.state), known = {};
  for (const coll of SLICED) {
    const all = (core.loose && core.loose[coll] ? core.loose[coll] : []).slice();
    for (const s of slices.values()) if (s[coll]) for (const pair of s[coll]) all.push(pair);
    all.sort((a, b) => a[0] - b[0]); const k = (known[coll] = new Map());
    state[coll] = all.map(([ord, x]) => { const id = idOf(coll, x); if (id) k.set(id, ord); return x; });
  }
  state.audit = [];
  return { whole: { v: 1, seq: core.seq, userId: core.userId, state }, known, bounds: JSON.parse(JSON.stringify(core.bounds || {})) };
}

// Gives every element a number that keeps the order the engine left the list in. An element that was loaded keeps its number
// whenever it can, so a part is rewritten only when something in it really changed. New at the end counts up from the firm's
// highest number; new at the front counts down from its lowest; new in between takes the midpoint.
function number(arr, known, b) {
  const have = arr.map((x, i) => (known ? known.get(arr[i].__id) : undefined)), next = new Array(arr.length); let nx;
  for (let i = arr.length - 1; i >= 0; i--) { next[i] = nx; if (have[i] !== undefined) nx = have[i]; }
  const out = new Array(arr.length); let prev = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    let o = have[i];
    if (o === undefined || !(o > prev)) {
      const after = next[i] !== undefined && next[i] > prev ? next[i] : undefined;
      if (after === undefined) { b[1] = Math.max(b[1], prev === -Infinity ? b[1] : prev) + 1; o = b[1]; }
      else if (prev === -Infinity) {
        // New at the front (the engine puts the newest alert and log line first). Several at once stay together, ahead of everything the firm has.
        let r = 1; while (i + r < arr.length && have[i + r] === undefined) r++;
        const base = Math.min(b[0], after) - r; for (let k = 0; k < r; k++) out[i + k] = base + k; b[0] = base; prev = base + r - 1; i += r - 1; continue;
      }
      else { o = (prev + after) / 2; if (!(o > prev && o < after)) o = prev; }   // out of room: equal numbers keep their order within a part; the next full save renumbers
    }
    if (o > b[1]) b[1] = o; if (o < b[0]) b[0] = o;
    out[i] = o; prev = o;
  }
  return out;
}

/**
 * Splits a workspace into the core and one part per client.
 * known and bounds come from merge() (omit both for a workspace that has never been split).
 * Returns { core, slices: Map(key -> part), terms: Map(key -> [what the client can be found by]), audit: [new audit lines] }.
 */
function split(whole, known, bounds) {
  const S = whole.state, rest = {}, loose = {}, slices = new Map(), found = new Map(), b = bounds || {};
  for (const k in S) if (!SLICED.includes(k) && k !== "audit") rest[k] = S[k];
  const clients = new Set((S.clients || []).map((c) => c.id)), engClient = new Map(); for (const e of S.engs || []) if (clients.has(e.clientId)) engClient.set(e.id, e.clientId);
  const owner = (coll, x) => coll === "clients" ? x.id : coll === "engs" || coll === "archive" || coll === "memory" ? (clients.has(x.clientId) ? x.clientId : null) : (x.engId && engClient.get(x.engId)) || (x.clientId && clients.has(x.clientId) ? x.clientId : null) || null;
  for (const coll of SLICED) {
    const arr = Array.isArray(S[coll]) ? S[coll] : []; if (!b[coll]) b[coll] = [0, -1];
    // A renumbering from scratch when the numbers have run out of room between two neighbours (only possible with every part loaded).
    const tagged = arr.map((x) => ({ __id: idOf(coll, x), x }));
    const ords = number(tagged, known && known[coll], b[coll]);
    tagged.forEach((t, i) => {
      const who = owner(coll, t.x), pair = [ords[i], t.x];
      if (!who) { (loose[coll] = loose[coll] || []).push(pair); return; }
      const key = partKey(who); let s = slices.get(key); if (!s) slices.set(key, (s = {})); (s[coll] = s[coll] || []).push(pair);
      if (coll === "clients") found.set(key, terms(t.x));
    });
  }
  // A part with no client in it (the client was deleted but something still points at them) goes back to the core, so nothing is lost or orphaned.
  for (const [key, s] of [...slices]) if (!s.clients) { for (const coll in s) (loose[coll] = loose[coll] || []).push(...s[coll]); slices.delete(key); }
  for (const coll in loose) loose[coll].sort((x, y) => x[0] - y[0]);
  return { core: { v: 2, seq: whole.seq, userId: whole.userId, state: rest, loose, bounds: b }, slices, terms: found, audit: Array.isArray(S.audit) ? S.audit : [] };
}

module.exports = { SLICED, split, merge, terms, partKey };
