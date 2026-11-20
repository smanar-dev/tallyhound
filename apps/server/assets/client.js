/* The upload page, when the phone runs scripts: each file goes as soon as it is chosen, with its own progress line, a
   warning before a photo that is too dark or washed out is sent, and a retry when the phone is offline.
   Without this file the same form posts in the ordinary way. Nothing here reads or shows a document already sent. */
/* global window, document, navigator, FormData, XMLHttpRequest, URL, Image, setTimeout */
(function () {
  "use strict";
  var form = document.getElementById("send"), rows = document.getElementById("rows");
  if (!form || !rows || !window.FormData || !window.XMLHttpRequest) return;
  var MAX = 25 * 1024 * 1024, DARK = 35, WASHED = 245, queue = [], busy = false, thanked = false;
  var inputs = form.querySelectorAll("input[type=file]"), cam = document.getElementById("cam");
  form.className += " js";

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function button(text, fn) { var b = el("button", "btn sm", text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function row(file) {
    var li = el("li", "row"), name = el("span", "fname", file.name || "Photo"), state = el("span", "fstate", "Waiting"), bar = el("progress"), acts = el("div", "facts");
    bar.max = 100; bar.value = 0; li.appendChild(name); li.appendChild(state); li.appendChild(bar); li.appendChild(acts); rows.appendChild(li);
    return { file: file, li: li, state: state, bar: bar, acts: acts };
  }
  function say(r, cls, text) { r.li.className = "row " + cls; r.state.textContent = text; r.acts.textContent = ""; }
  function thanks() {
    if (thanked) return; thanked = true;
    var p = el("p", "ok", "Thanks. We'll check what you send and get back to you if anything is missing."); p.setAttribute("role", "status"); form.parentNode.insertBefore(p, form);
  }
  // A quick look at the photo on the phone itself. The picture never leaves the phone for this.
  function look(file, done) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.URL || !URL.createObjectURL) return done(null);
    var img = new Image(), url = URL.createObjectURL(file), over = false;
    function end(why) { if (over) return; over = true; URL.revokeObjectURL(url); done(why); }
    img.onload = function () {
      try {
        var c = document.createElement("canvas"); c.width = 48; c.height = 48; var g = c.getContext("2d"); g.drawImage(img, 0, 0, 48, 48);
        var d = g.getImageData(0, 0, 48, 48).data, sum = 0; for (var i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        var mean = sum / (d.length / 4); end(mean < DARK ? "dark" : mean > WASHED ? "washed" : null);
      } catch { end(null); }
    };
    img.onerror = function () { end(null); }; setTimeout(function () { end(null); }, 4000); img.src = url;
  }
  function add(file) {
    var r = row(file);
    if (file.size > MAX) return say(r, "bad", "Too large. The limit is 25 MB.");
    look(file, function (why) {
      if (!why) return send(r);
      say(r, "warn", why === "dark" ? "This photo looks too dark to read." : "This photo looks washed out.");
      r.acts.appendChild(button("Retake", function () { rows.removeChild(r.li); (cam || inputs[0]).click(); }));
      r.acts.appendChild(button("Send anyway", function () { send(r); }));
    });
  }
  function send(r) { say(r, "going", "Sending"); queue.push(r); pump(); }
  function again(r, text) { say(r, "bad", text); r.acts.appendChild(button("Try again", function () { send(r); })); }
  function pump() {
    if (busy) return; var r = queue.shift(); if (!r) return; busy = true;
    var x = new XMLHttpRequest(), data = new FormData(); data.append("file", r.file, r.file.name || "photo.jpg");
    function next() { busy = false; pump(); }
    x.open("POST", form.action); x.setRequestHeader("x-tallyhound-client", "1");
    x.upload.onprogress = function (e) { if (e.lengthComputable) { r.bar.value = Math.round(e.loaded / e.total * 100); r.state.textContent = r.bar.value + "%"; } };
    x.onload = function () {
      var j = null; try { j = JSON.parse(x.responseText); } catch { /* not ours */ }
      if (x.status === 200 && j && j.ok) { r.bar.value = 100; say(r, "done", "✓ Received"); thanks(); }
      else again(r, (j && j.error) || "That did not go through.");
      next();
    };
    x.onerror = function () {
      if (navigator.onLine === false) {
        say(r, "wait", "You're offline. We'll send when you're back.");
        window.addEventListener("online", function back() { window.removeEventListener("online", back); send(r); });
      } else again(r, "That did not go through.");
      next();
    };
    x.send(data);
  }
  for (var i = 0; i < inputs.length; i++) inputs[i].addEventListener("change", function () { for (var k = 0; k < this.files.length; k++) add(this.files[k]); this.value = ""; });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
})();
