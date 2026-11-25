// The staff web app. `npm run build` writes apps/web/dist, which the web service serves.
// `npm run dev:web` runs it with live reload and passes /api, /auth and /hooks through to a server on port 3000.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), ENGINE = join(here, "../../packages/engine/engine.js");

// The rules engine is one plain script written for a browser global (CLAUDE.md: do not rewrite it). This wraps that exact file as
// a module at build time, the same way packages/engine/index.js wraps it for Node, so the browser runs the engine the server runs
// and nothing is evaluated from a string at run time (the Content-Security-Policy forbids that).
function engine(): Plugin {
  return {
    name: "tallyhound-engine",
    resolveId(id) { return id === "virtual:engine" ? "\0virtual:engine" : null; },
    load(id) { if (id !== "\0virtual:engine") return null; this.addWatchFile(ENGINE); return "export function createEngine() {\nconst window = {};\n" + readFileSync(ENGINE, "utf8") + "\nreturn window.TH;\n}\n"; }
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), engine()],
  // assetsInlineLimit 0: nothing is embedded as a data: address. The Content-Security-Policy only allows files from our own host.
  // The engine gets a file of its own so it is cached apart from the screens. The PDF reader (pdfjs, about 1.6 MB) is its own chunk and
  // loads only when a staff member reads a last-year PDF in the browser; it is the one chunk the size warning names.
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900, assetsInlineLimit: 0,
    rollupOptions: { output: { manualChunks: (id) => id === "\0virtual:engine" ? "engine" : undefined } } },
  server: { port: 5173, proxy: { "/api": "http://localhost:3000", "/auth": "http://localhost:3000", "/hooks": "http://localhost:3000" } }
});
