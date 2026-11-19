// Loads the Tallyhound rules engine. The same file runs in the browser demo and on the server.
// Each call returns a separate engine with its own state, so two firms never share memory.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
const make = new Function("window", src + "\nreturn window.TH;");
function createEngine() { return make({}); }
module.exports = { createEngine };
