// Bringing a client list in from somewhere other than a file.
// Every importer returns plain rows { first, last, email, mobile, ref, preparer } and nothing else. Tax IDs, dates of birth,
// fees and bank details are never requested and never mapped, even when the other system offers them.
// The rows go through the same engine.importRows as a spreadsheet, so de-duplication and validation are identical.
//
// Karbon is the one practice-management system with an open, documented REST API at the time of writing (see docs/INTEGRATIONS.md).
// FIELD NAMES BELOW ARE FROM KARBON'S PUBLISHED REFERENCE AND HAVE NOT BEEN RUN AGAINST A LIVE ACCOUNT. Confirm with a test tenant (T-104).
const clean = (v) => String(v == null ? "" : v).trim();
function splitName(full) { const p = clean(full).split(/\s+/).filter(Boolean); if (!p.length) return ["", ""]; if (p.length === 1) return [p[0], ""]; return [p.slice(0, -1).join(" "), p[p.length - 1]]; }
function karbonContactToRow(k) {
  let first = clean(k.FirstName), last = clean(k.LastName); if (!first && !last) [first, last] = splitName(k.FullName);
  const card = (k.BusinessCards || []).find((b) => b.IsPrimaryCard) || (k.BusinessCards || [])[0] || {};
  const emails = [].concat(k.EmailAddress || [], card.EmailAddresses || []).map(clean).filter(Boolean);
  const phones = [].concat(card.PhoneNumbers || []).map((p) => (typeof p === "string" ? { Number: p } : p || {}));
  const mobile = (phones.find((p) => /mobile|cell/i.test(p.Label || "")) || {}).Number || clean(k.PhoneNumber);
  return { first, last, email: emails[0] || "", mobile: clean(mobile), ref: clean(k.ContactKey), preparer: clean(k.ClientOwner || "") };
}
// The list call returns a summary per contact. Mobile numbers sit on the contact's business card, so with opt.details each contact is
// fetched once more with $expand=BusinessCards. That is one extra call per client: fine for a first import, wasteful for a nightly sync.
// Pages through GET /v3/Contacts. fetchImpl defaults to the global fetch. keys: { accessKey, bearer }.
async function karbonContacts(keys, opt) {
  const f = (opt && opt.fetch) || fetch, base = (opt && opt.base) || "https://api.karbonhq.com/v3", rows = []; let url = base + "/Contacts?$top=100", pages = 0;
  while (url && pages++ < 200) {
    const r = await f(url, { headers: { AccessKey: keys.accessKey, Authorization: "Bearer " + keys.bearer, Accept: "application/json" } });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1000 * Math.min(30, +r.headers.get("retry-after") || 2))); pages--; continue; }
    if (!r.ok) throw Object.assign(new Error("Karbon answered " + r.status), { status: r.status });
    const j = await r.json(); for (const k of j.value || []) rows.push(karbonContactToRow(k)); url = j["@odata.nextLink"] || null;
  }
  if (opt && opt.details) for (const row of rows) {
    if (row.mobile || !row.ref) continue;
    const r = await f(base + "/Contacts/" + encodeURIComponent(row.ref) + "?$expand=BusinessCards", { headers: { AccessKey: keys.accessKey, Authorization: "Bearer " + keys.bearer, Accept: "application/json" } });
    if (r.ok) { const d = karbonContactToRow(await r.json()); row.mobile = d.mobile || row.mobile; row.email = row.email || d.email; }
  }
  return rows;
}
// Rows -> the shape engine.importRows takes (the same object parseCSV returns).
function toParsed(rows) { const head = ["First", "Last", "Email", "Mobile", "Client ID", "Preparer"], keys = ["first", "last", "email", "mobile", "ref", "preparer"]; return { head, map: keys.slice(), rows: rows.map((r) => keys.map((k) => clean(r[k]))), delim: ",", sensitive: [] }; }
module.exports = { karbonContactToRow, karbonContacts, toParsed, splitName };
