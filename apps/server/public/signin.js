// Sign-in screens. Each step is one section in signin.html; this file shows the right one and talks to /auth.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var steps = ["email", "sent", "wait", "setup", "codes", "code", "recovery"];
  function show(step, focus) { steps.forEach(function (s) { $("s-" + s).hidden = s !== step; }); say(""); if (focus) $(focus).focus(); }
  function say(text) { $("msg").textContent = text; $("msg").hidden = !text; }
  function post(path, body) {
    return fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-tallyhound": "1" }, body: JSON.stringify(body || {}) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok) { var e = new Error(j.message || "Something went wrong. Try again."); e.code = j.error; throw e; } return j; }); });
  }
  function form(id, run) {
    $(id).addEventListener("submit", function (ev) {
      ev.preventDefault(); var b = $(id).querySelector("button[type=submit]"); b.disabled = true; say("");
      run().catch(function (e) { say(e.message); if (e.code === "too_many" || e.code === "signin") show("email", "email"), say(e.message); }).then(function () { b.disabled = false; });
    });
  }
  function next(step) { if (step === "setup") return post("/auth/setup/start").then(function (r) { $("qr").src = r.qr; $("secret").textContent = r.secret.replace(/(.{4})/g, "$1 ").trim(); show("setup", "setup-code"); }); show("code", "code"); return Promise.resolve(); }
  function home() { window.location.replace("/"); }

  form("f-email", function () { var e = $("email").value.trim(); return post("/auth/link", { email: e }).then(function () { $("sent-to").textContent = e; show("sent"); }); });
  form("f-setup", function () { return post("/auth/setup/finish", { code: $("setup-code").value }).then(function (r) { var ul = $("codes"); ul.textContent = ""; r.recoveryCodes.forEach(function (c) { var li = document.createElement("li"); li.textContent = c; ul.appendChild(li); }); show("codes", "copy"); }); });
  form("f-code", function () { return post("/auth/code", { code: $("code").value }).then(home); });
  form("f-recovery", function () { return post("/auth/recovery", { code: $("recovery").value }).then(home); });
  $("again").addEventListener("click", function () { show("email", "email"); });
  $("lost").addEventListener("click", function () { show("recovery", "recovery"); });
  $("back").addEventListener("click", function () { show("code", "code"); });
  $("saved").addEventListener("click", home);
  $("copy").addEventListener("click", function () {
    var text = Array.prototype.map.call($("codes").children, function (li) { return li.textContent; }).join("\n");
    navigator.clipboard.writeText(text).then(function () { $("copied").textContent = "Copied. Paste them somewhere safe."; }, function () { $("copied").textContent = "Could not copy. Write them down."; });
  });

  // Arriving from the emailed link: the token sits after the # so it never reaches a server log or a referrer.
  var m = /[#&]t=([^&]+)/.exec(window.location.hash);
  if (window.location.pathname === "/signin/open" && m) {
    show("wait"); history.replaceState(null, "", "/signin");
    post("/auth/open", { token: decodeURIComponent(m[1]) }).then(function (r) { return next(r.next); }).catch(function (e) { show("email", "email"); say(e.message); });
  } else show("email", "email");
})();
