// A holding page for signed-in staff until the product screens land (T-15 onward). Reads live data, escapes nothing by hand:
// every value goes in as text, never as HTML.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var ROLE = { owner: "Everything (owner)", staff: "Everything except settings", read_only: "Look only" };
  function api(method, path, body) {
    return fetch(path, { method: method, credentials: "same-origin", headers: { "content-type": "application/json", "x-tallyhound": "1" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) })
      .then(function (res) { if (res.status === 401) { window.location.replace("/signin"); throw new Error("Signed out"); } return res.json().then(function (j) { if (!res.ok) throw new Error(j.message || "Something went wrong. Try again."); return j; }); });
  }
  function say(t) { $("msg").textContent = t; $("msg").hidden = !t; }
  function row(tbody, cells) { var tr = document.createElement("tr"); cells.forEach(function (c) { var td = document.createElement("td"); td.textContent = c; tr.appendChild(td); }); tbody.appendChild(tr); }
  function people(me) {
    return api("GET", "/api/users").then(function (list) {
      $("people").textContent = ""; list.forEach(function (u) { row($("people"), [u.name, u.email, ROLE[u.role], u.twoStep ? "On" : "Not set up yet"]); });
      $("f-add").hidden = me.role !== "owner"; $("solo").hidden = !(me.role === "owner" && list.filter(function (u) { return u.role === "owner"; }).length < 2);
    });
  }
  api("GET", "/api/me").then(function (me) {
    $("me").textContent = me.name;
    $("f-add").addEventListener("submit", function (ev) {
      ev.preventDefault(); say("");
      api("POST", "/api/users", { name: $("p-name").value, email: $("p-email").value, role: $("p-role").value }).then(function () { $("f-add").reset(); return people(me); }).catch(function (e) { say(e.message); });
    });
    return Promise.all([people(me), api("GET", "/api/state").then(function (d) {
      var s = d.state, f = s.firm; $("firm").textContent = f.name;
      if (f.verified === false) { $("state").textContent = "Your firm is being checked. Nothing is sent to clients until that is done. We will email you."; $("state").hidden = false; }
      row($("facts"), ["Clients", String(s.clients.length)]); row($("facts"), ["Tax year", String(f.taxYear)]);
      row($("facts"), ["Your Tallyhound address", f.email || "Not set"]); row($("facts"), ["Messages", f.hound.mode === "autopilot" ? "Autopilot: it sends on its own and comes to you when it needs a person" : "Copilot: you approve each message"]);
    })]);
  }).catch(function (e) { if (e.message !== "Signed out") say(e.message); });
  $("out").addEventListener("click", function () { api("POST", "/auth/signout").then(function () { window.location.replace("/signin"); }); });
})();
