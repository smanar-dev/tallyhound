// The firm's own Google Drive, for the pipeline's `files` interface: put({ folder, name, bytes, contentType }) -> id, move({ id, folder, name }).
// Uses the drive.file permission only: Tallyhound can see and change the files and folders it created, and nothing else in the drive.
// STARTER: written from Google's Drive v3 reference and tested against a stand-in. Not run against a real account (T-111).
function googleDrive({ token, rootId, fetchImpl }) {
  const f = fetchImpl || fetch, api = "https://www.googleapis.com/drive/v3/files", up = "https://www.googleapis.com/upload/drive/v3/files", cache = new Map();
  const auth = async (firmId) => ({ authorization: "Bearer " + (await token(firmId)) });
  const call = async (firmId, url, opt) => { const res = await f(url, Object.assign({}, opt, { headers: Object.assign({}, (opt || {}).headers, await auth(firmId)) })); const j = await res.json().catch(() => ({})); if (!res.ok) throw Object.assign(new Error((j.error && j.error.message) || "Drive " + res.status), { code: res.status }); return j; };
  const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  // Walks "Client Tax Docs/2026/Garcia, Maria/_To check", making each folder that is missing.
  async function folderId(firmId, path) {
    let parent = (await rootId(firmId)) || "root";
    for (const part of String(path).split("/").filter(Boolean)) {
      const key = firmId + "|" + parent + "|" + part; if (cache.has(key)) { parent = cache.get(key); continue; }
      const found = await call(firmId, api + "?fields=files(id)&q=" + encodeURIComponent("name = '" + q(part) + "' and '" + parent + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"));
      const id = found.files && found.files[0] ? found.files[0].id : (await call(firmId, api + "?fields=id", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: part, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).id;
      cache.set(key, id); parent = id;
    }
    return parent;
  }
  return {
    async put({ firmId, folder, name, bytes, contentType }) {
      const parent = await folderId(firmId, folder), bound = "th" + Date.now().toString(36);
      const body = Buffer.concat([Buffer.from("--" + bound + "\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name, parents: [parent] }) + "\r\n--" + bound + "\r\ncontent-type: " + (contentType || "application/octet-stream") + "\r\n\r\n"), Buffer.from(bytes), Buffer.from("\r\n--" + bound + "--")]);
      return (await call(firmId, up + "?uploadType=multipart&fields=id", { method: "POST", headers: { "content-type": "multipart/related; boundary=" + bound }, body })).id;
    },
    async move({ firmId, id, folder, name }) {
      const now = await call(firmId, api + "/" + id + "?fields=parents"), parent = await folderId(firmId, folder), old = (now.parents || []).filter((p) => p !== parent);
      await call(firmId, api + "/" + id + "?fields=id&addParents=" + parent + (old.length ? "&removeParents=" + old.join(",") : ""), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    }
  };
}
module.exports = { googleDrive };
