#!/usr/bin/env node
/**
 * build-generic.js
 *
 * Transforms the deploy version of budget-manager into a self-contained
 * generic HTML file that uses localStorage + <textarea> for persistence.
 *
 * Steps:
 *   1. Copy src/frontend to a temp build dir
 *   2. Patch useAppState.jsx: swap API fetch for localStorage/textarea load/save
 *   3. Patch taxDB.js: zero personal defaults, generic item names
 *   4. Patch main.jsx: add stRef + save/clear/export UI
 *   5. Patch index.html: add <textarea id="budget-data">
 *   6. Run Vite build
 *   7. Assemble single HTML from dist output
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src", "frontend");
const TMP = path.join(ROOT, ".generic-build");
const OUT = path.join(ROOT, "budget-manager-generic.html");

// App version baked into the generic HTML for the Phase 13A update check.
// The running generic app reads window.__APP_VERSION__; the update check
// fetches the latest budget-manager-generic.html from raw main and extracts
// its baked version to compare. Sourced from the repo's package.json so a
// single version bump there flows into the built file.
// App version baked into the generic HTML for the Phase 13A update check.
// Sourced from the current git tag (git describe), so the tag you cut is the
// version the banner shows and compares against. On an untagged commit,
// describe yields "vX.Y.Z-N-gSHA" whose numeric core still parses to the base
// tag, so an untagged build never looks newer than the last real tag.
// Prefer a CI-provided tag ref when present; fall back to git locally.
const APP_VERSION = (() => {
  const ci = process.env.GITHUB_REF_NAME; // set to the tag name on tag pushes
  if (ci && /^v?\d/.test(ci)) return ci;
  try {
    return execSync("git describe --tags --always", { cwd: ROOT }).toString().trim();
  } catch {
    // No tags yet and no git → last-resort package.json so the marker isn't empty.
    try {
      return JSON.parse(read(path.join(ROOT, "package.json"))).version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
})();

// ── helpers ──
function read(f) { return fs.readFileSync(f, "utf8"); }
function write(f, s) { fs.writeFileSync(f, s, "utf8"); }
function replace(file, search, replacement) {
  const content = read(file);
  if (typeof search === "string") {
    if (!content.includes(search)) {
      console.error(`WARNING: Could not find patch target in ${path.basename(file)}:`);
      console.error(`  Looking for: ${search.slice(0, 120)}...`);
      return;
    }
    write(file, content.replace(search, replacement));
  } else {
    // regex
    write(file, content.replace(search, replacement));
  }
}

// ── 0. Clean & copy ──
console.log("→ Copying src/frontend to temp build dir...");
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
fs.cpSync(SRC, TMP, { recursive: true });

// ── 1. Patch useAppState.jsx: swap API load/save for localStorage + textarea ──
console.log("→ Patching useAppState.jsx...");
const hookFile = path.join(TMP, "hooks", "useAppState.jsx");
let hook = read(hookFile);

// 1a. Swap the /api/state fetch for a localStorage reader that returns the same
// {state: ...} shape the real endpoint produces. The surrounding useEffect --
// crucially, the full setter map -- stays exactly as-is in source, so any new
// state field added to useAppState.jsx automatically works in generic mode
// without touching this script. This replaces the older approach of
// block-replacing the whole effect with a hardcoded map, which silently drifted
// out of sync as new fields were added (transferCats, transactionRules, and the
// transfer-tolerance/refund settings all stopped loading for that reason).
hook = hook.replace(
  'await fetch("/api/state").then(r => r.json())',
  `await (async () => {
    // If this file was produced by the in-app "download update" action, its
    // textarea carries data-fresh="1" and holds the user's data baked in at
    // download time. Because a downloaded update opens on the SAME origin as
    // the copy it replaced, localStorage still holds the OLD data — so without
    // this, the loader would read stale localStorage and the update would look
    // like it lost the user's data. When the fresh marker is present, the
    // textarea wins and we re-seed localStorage from it.
    let raw = null;
    const ta = document.getElementById("budget-data");
    const fresh = ta && ta.getAttribute("data-fresh") === "1" && ta.textContent && ta.textContent.trim();
    if (fresh) {
      raw = ta.textContent.trim();
      try { localStorage.setItem("budget-data", raw); } catch {}
      try { ta.removeAttribute("data-fresh"); } catch {}
    } else {
      try { raw = localStorage.getItem("budget-data"); } catch {}
      if (!raw && ta && ta.textContent) raw = ta.textContent.trim();
    }
    if (!raw) return null;
    try { return { state: JSON.parse(raw) }; } catch(e) { console.error("Load error:", e); return null; }
  })()`
);

// 1a-bis. Generic mode has no separate /api/transactions effect (MODE=generic
// neutralizes it), so we also set txLoaded from the state-load effect.
hook = hook.replace(
  'setLoaded(true); })(); }, []);',
  'setLoaded(true); setTxLoaded(true); })(); }, []);'
);

// 1a-ter. The deploy-mode loader map doesn't include `transactions` (deploy
// loads them separately from /api/transactions). Generic mode bundles them
// into the same localStorage blob, so we inject the setter here. This is the
// ONE field that legitimately differs between modes.
hook = hook.replace(
  'p2Name:setP2Name,transactionColumns:setTransactionColumns',
  'p2Name:setP2Name,transactions:setTransactions,transactionColumns:setTransactionColumns'
);

// 1b. Replace API save with localStorage save
const apiSaveRe = /useEffect\(\(\) => \{ const t = setTimeout\(async \(\) => \{ try \{ await fetch\("\/api\/state"[\s\S]*?\}, \[st\]\);/;
hook = hook.replace(apiSaveRe, `useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try { localStorage.setItem("budget-data", JSON.stringify(st)); } catch(e) { console.error("Save error:", e); }
    }, 600);
    return () => clearTimeout(t);
  }, [st, loaded]);`);

// 1c. Add stRef right after the st useMemo line
hook = hook.replace(
  /const st = useMemo\(\(\) => \(\{.*?\]\);/s,
  (match) => match + `\n  const stRef = useRef(st);\n  useEffect(() => { stRef.current = st; }, [st]);`
);

// 1c2. Swap MODE = "deploy" → "generic" so the CRUD helpers skip fetch() calls
hook = hook.replace(/const MODE = "deploy";/, 'const MODE = "generic";');

// 1c3. Include transactions in the st useMemo so it round-trips through
// localStorage + textarea. We append it to both the object literal and the
// dependency array of the first st useMemo we find.
hook = hook.replace(
  /const st = useMemo\(\(\) => \(\{([^}]+)\}\), \[([^\]]+)\]\);/,
  (match, objBody, deps) => {
    if (objBody.includes("transactions")) return match; // idempotent
    const newObj = objBody.trim().replace(/,?\s*$/, "") + ",transactions";
    const newDeps = deps.trim().replace(/,?\s*$/, "") + ",transactions";
    return `const st = useMemo(() => ({${newObj}}), [${newDeps}]);`;
  }
);

// 1d. Make sure useRef is imported
if (!hook.includes("useRef")) {
  hook = hook.replace(
    'import { useState, useMemo, useEffect, useCallback, useRef }',
    'import { useState, useMemo, useEffect, useCallback, useRef }'
  );
}

// 1e. Add stRef to the return object
hook = hook.replace(
  "// calculations\n    C,",
  "// generic persistence\n    stRef,\n    // calculations\n    C,"
);

write(hookFile, hook);

// ── 2. Patch taxDB.js: generic defaults ──
console.log("→ Patching taxDB.js defaults...");
const taxFile = path.join(TMP, "data", "taxDB.js");
let taxDB = read(taxFile);

// 2a. Generic DEF_EXP
const defExpRe = /export const DEF_EXP = \[[\s\S]*?\];/;
taxDB = taxDB.replace(defExpRe, `export const DEF_EXP = [
  {n:"Expense 1",c:"General",t:"N",v:"0",p:"m"},{n:"Expense 2",c:"General",t:"N",v:"0",p:"m"},
  {n:"Expense 3",c:"General",t:"D",v:"0",p:"m"},{n:"Expense 4",c:"General",t:"D",v:"0",p:"m"},
];`);

// 2b. Generic DEF_SAV
taxDB = taxDB.replace(
  /export const DEF_SAV = \[.*?\];/,
  'export const DEF_SAV = [{n:"Savings 1",v:"0",p:"m",c:"Other"},{n:"Savings 2",v:"0",p:"m",c:"Other"}];'
);

// 2c. Generic DEF_PRE
taxDB = taxDB.replace(
  /export const DEF_PRE = \[.*?\];/,
  'export const DEF_PRE = [{n:"Medical",c:"0",k:"0"},{n:"Dental",c:"0",k:"0"},{n:"Vision",c:"0",k:"0"}];'
);

// 2d. Generic state defaults
taxDB = taxDB.replace(
  /p1State: \{ name: "Colorado", abbr: "CO", famli: 0\.45 \}/,
  'p1State: { name: "State", abbr: "ST", famli: 0 }'
);
taxDB = taxDB.replace(
  /p2State: \{ name: "Colorado", abbr: "CO", famli: 0\.45 \}/,
  'p2State: { name: "State", abbr: "ST", famli: 0 }'
);

// 2e. Zero match tiers
taxDB = taxDB.replace(
  /cMatchTiers:.*?, cMatchBase: \d+/,
  'cMatchTiers: [], cMatchBase: 0'
);
taxDB = taxDB.replace(
  /kMatchTiers:.*?, kMatchBase: \d+/,
  'kMatchTiers: [], kMatchBase: 0'
);

write(taxFile, taxDB);

// ── 3. Patch main.jsx: wrap App with generic save/clear/export buttons ──
console.log("→ Patching main.jsx...");
const mainFile = path.join(TMP, "main.jsx");
write(mainFile, `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
`);

// ── 4. Patch App.jsx: add save/clear/export buttons on Charts tab ──
console.log("→ Patching App.jsx for generic buttons...");
const appFile = path.join(TMP, "App.jsx");
let app = read(appFile);

// Generic-only: App.jsx needs useState/useEffect/useCallback (for the update
// check handlers) and the updateCheck module. Deploy App.jsx imports only
// useRef/useMemo/Component, so widen the import and add the UC namespace here.
app = app.replace(
  'import { useRef, useMemo, Component } from "react";',
  'import { useRef, useMemo, useState, useEffect, useCallback, Component } from "react";\nimport * as UC from "./utils/updateCheck.js";'
);
if (!app.includes("import * as UC from")) {
  throw new Error("build-generic: failed to inject updateCheck import into App.jsx — the react import line changed shape.");
}

// Find the ChartsTab usage and add generic buttons after it
// We need to add:
//   - 💾 Save button in header
//   - 🗑 Clear All Data on Tax Rates page
//   - JSON export/import on Charts tab

// Add helper functions at the top of App component
const saveHelperCode = `
  /* ── Generic: Save / Clear / Export ── */
  const handleSaveHTML = () => {
    try {
      const data = JSON.stringify(S.stRef.current);
      const parser = new DOMParser();
      const doc = parser.parseFromString(document.documentElement.outerHTML, "text/html");
      const ta = doc.getElementById("budget-data");
      if (ta) ta.textContent = data;
      // Remove scripts and re-add the original inline script
      doc.querySelectorAll("script").forEach(s => s.remove());
      const origHTML = document.documentElement.outerHTML;
      const scriptMatch = origHTML.match(/<script>(.*)<\\/script>/s);
      if (scriptMatch) {
        const newScript = doc.createElement("script");
        newScript.textContent = scriptMatch[1];
        doc.body.appendChild(newScript);
      }
      const blob = new Blob(["<!DOCTYPE html>\\n" + doc.documentElement.outerHTML], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "budget-manager.html"; a.click();
      URL.revokeObjectURL(url);
    } catch(e) { alert("Save error: " + e.message); }
  };
  const handleClearAll = () => {
    if (confirm("Clear ALL budget data? This cannot be undone.")) {
      try { localStorage.removeItem("budget-data"); } catch {}
      location.reload();
    }
  };
  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(S.stRef.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "budget-data.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const handleImportJSON = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const d = JSON.parse(ev.target.result);
          localStorage.setItem("budget-data", JSON.stringify(d));
          location.reload();
        } catch(err) { alert("Invalid JSON: " + err.message); }
      };
      reader.readAsText(f);
    };
    input.click();
  };

  /* ── Generic: Update check (Phase 13A) ──
     Reads its own baked version from window.__APP_VERSION__, fetches the
     latest generic HTML from raw main, extracts that file's baked version,
     and — if behind — offers a one-tap "download the new version with my
     data baked in" action. Auto-checks on mount (cached ~24h) plus a manual
     button. Pure version logic lives in utils/updateCheck.js; this handler
     owns fetch + DOM only. */
  const CURRENT_VERSION = (typeof window !== "undefined" && window.__APP_VERSION__) || "0.0.0";
  const [updateState, setUpdateState] = useState({
    status: "idle", // idle | checking | behind | current | error
    latest: null,   // latest tag from main (display + compare)
    message: "",
  });

  const runUpdateCheck = useCallback(async (manual) => {
    // Cache gate: skip the network on auto-checks within the TTL.
    if (!manual) {
      try {
        const raw = localStorage.getItem("bm-update-cache");
        const cache = raw ? JSON.parse(raw) : null;
        if (!UC.shouldRecheck(cache)) {
          if (UC.isBehind(CURRENT_VERSION, cache.latest)) {
            setUpdateState({ status: "behind", latest: cache.latest, message: "" });
          }
          return;
        }
      } catch {}
    }
    setUpdateState(s => ({ ...s, status: "checking", message: "" }));
    try {
      const res = await fetch(UC.RAW_HTML_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      const latest = UC.extractVersionFromHtml(html);
      if (!latest) throw new Error("Could not read version from the latest file");
      try {
        localStorage.setItem("bm-update-cache", JSON.stringify(UC.makeCacheEntry(latest)));
      } catch {}
      if (UC.isBehind(CURRENT_VERSION, latest)) {
        // Stash the fetched HTML so the download action doesn't re-fetch.
        window.__BM_LATEST_HTML__ = html;
        setUpdateState({ status: "behind", latest, message: "" });
      } else {
        setUpdateState({ status: "current", latest, message: manual ? "You're on the latest version." : "" });
      }
    } catch (e) {
      setUpdateState({ status: "error", latest: null, message: String(e && e.message || e) });
    }
  }, [CURRENT_VERSION]);

  useEffect(() => { runUpdateCheck(false); }, [runUpdateCheck]);

  // Auto-fade the green "you're on the latest version" confirmation after 5s.
  // Only the current-status message fades; the orange "behind" banner persists
  // until dismissed or updated. Clearing just the message (not the status)
  // collapses the green box since it only renders when message is truthy.
  useEffect(() => {
    if (updateState.status === "current" && updateState.message) {
      const t = setTimeout(() => {
        setUpdateState(s => (s.status === "current" ? { ...s, message: "" } : s));
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [updateState.status, updateState.message]);

  // Download the latest HTML with the current data injected — the same
  // machinery as handleSaveHTML, but the shell comes from the network copy
  // (already fetched during the check) rather than the current document.
  const handleDownloadUpdate = async () => {
    try {
      let html = window.__BM_LATEST_HTML__;
      if (!html) {
        const res = await fetch(UC.RAW_HTML_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        html = await res.text();
      }
      const data = JSON.stringify(S.stRef.current);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const ta = doc.getElementById("budget-data");
      if (ta) { ta.textContent = data; ta.setAttribute("data-fresh", "1"); }
      const blob = new Blob(["<!DOCTYPE html>\\n" + doc.documentElement.outerHTML], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "budget-manager.html"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Update download failed: " + (e && e.message || e) + "\\n\\nYou can update manually from " + UC.RELEASES_PAGE_URL);
    }
  };
`;

// ── Marker-based injection ──
// App.jsx carries stable marker comments at each injection point. We replace
// the *entire* marker (including its surrounding JSX braces for the in-JSX
// ones) with the generated code. Markers don't drift when props/refs get
// renamed, unlike the old string-literal anchors (a rename of
// headerRef→iconRef silently dropped the save handler and shipped a 💾 button
// calling an undefined variable).
//
// IMPORTANT: keys must be the FULL literal as it appears in App.jsx. The JSX
// markers are written `{/* @generic:x */}` — the braces ARE the JSX-expression
// wrapper, so the replacement must consume them too. Replacing only the inner
// `/* ... */` would leave the braces behind and produce `{{...}}`, a syntax
// error. The helpers marker is a plain JS block comment in the component body
// (no braces), so its replacement is brace-free.

const MARKERS = {
  // JS comment in component body — inject handler definitions.
  "/* @generic:helpers */": saveHelperCode,
  // JSX comment inside the existing theme-button <div> — inject a bare element.
  "{/* @generic:save-btn */}":
    `<button onClick={handleSaveHTML} title="Save as HTML file" style={{ padding: "5px 10px", background: "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>💾</button>`,
  // Manual "check for updates" button next to save. Shows a dot when behind.
  "{/* @generic:update-btn */}":
    `<button onClick={() => runUpdateCheck(true)} title={updateState.status === "checking" ? "Checking for updates…" : (updateState.status === "behind" ? ("Update available" + (updateState.latest ? (": " + updateState.latest) : "")) : "Check for updates")} style={{ padding: "5px 10px", background: updateState.status === "behind" ? "#E8573A" : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{updateState.status === "checking" ? "⏳" : "⟳"}{updateState.status === "behind" ? " •" : ""}</button>`,
  // Update banner — renders only when a newer version is on main. Appears
  // directly below the sticky header. "Download update" bakes the user's
  // current data into the freshly-fetched HTML and downloads it.
  "{/* @generic:update-banner */}":
    `{updateState.status === "behind" && <div style={{ maxWidth: 1100, margin: "12px auto 0", padding: "10px 16px", background: "#FFF4E5", border: "1px solid #E8573A", borderRadius: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", color: "#7a2e12" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>🎉 A newer version{updateState.latest ? (" (" + updateState.latest + ")") : ""} is available.{CURRENT_VERSION && CURRENT_VERSION !== "0.0.0" ? (" You're on " + CURRENT_VERSION + ".") : ""}</span>
          <button onClick={handleDownloadUpdate} style={{ background: "#E8573A", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>⬇ Download update with my data</button>
          <button onClick={() => setUpdateState(s => ({ ...s, status: "current" }))} title="Dismiss for now" style={{ background: "transparent", color: "#7a2e12", border: "1px solid #E8573A", borderRadius: 6, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Your data stays in this download — nothing is uploaded.</span>
        </div>}
        {updateState.status === "current" && updateState.message && <div style={{ maxWidth: 1100, margin: "12px auto 0", padding: "8px 16px", background: "#E9F7EF", border: "1px solid #27AE60", borderRadius: 8, color: "#1e7e45", fontSize: 13, fontWeight: 600 }}>✓ {updateState.message}</div>}
        {updateState.status === "error" && updateState.message && <div style={{ maxWidth: 1100, margin: "12px auto 0", padding: "8px 16px", background: "#FDECEA", border: "1px solid #C0392B", borderRadius: 8, color: "#922", fontSize: 13, fontWeight: 600 }}>Update check failed: {updateState.message}</div>}`,
  // JSX comment at tab-block level — inject a full {cond && <div>…</div>} block.
  "{/* @generic:clear-btn */}":
    `{S.tab === "taxes" && <div style={{ maxWidth: 1100, margin: "20px auto", padding: "0 12px", textAlign: "center" }}>
          <button onClick={handleClearAll} style={{ background: "#dc3545", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>🗑 Clear All Data</button>
        </div>}`,
  "{/* @generic:json-btns */}":
    `{S.tab === "charts" && <div style={{ maxWidth: 1100, margin: "20px auto", padding: "0 12px", display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={handleExportJSON} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📤 Export JSON</button>
          <button onClick={handleImportJSON} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📥 Import JSON</button>
        </div>}`,
};

// Assert all markers present before mutating anything.
const missing = Object.keys(MARKERS).filter((m) => !app.includes(m));
if (missing.length) {
  throw new Error(
    `build-generic: App.jsx is missing required injection marker(s): ${missing.join(", ")}. ` +
      `Re-add the marker comment(s) in src/frontend/App.jsx.`
  );
}
for (const [marker, code] of Object.entries(MARKERS)) {
  app = app.replace(marker, code);
}

// Safety net 1: no generic handler should be referenced without being defined.
for (const fn of ["handleSaveHTML", "handleClearAll", "handleExportJSON", "handleImportJSON", "handleDownloadUpdate", "runUpdateCheck"]) {
  const defined = app.includes(`const ${fn} =`);
  const used = app.includes(`onClick={${fn}}`);
  if (used && !defined) {
    throw new Error(`build-generic: ${fn} is used but never defined — injection markers out of sync.`);
  }
}

// Safety net 2: no marker (or stray double-brace from a bad replace) survives.
if (app.includes("@generic:")) {
  throw new Error("build-generic: an @generic marker survived replacement — keys out of sync with App.jsx.");
}
if (app.includes("{{S.tab")) {
  throw new Error("build-generic: produced `{{S.tab` (double-brace) — a marker key omitted its JSX braces.");
}

write(appFile, app);

// ── 5. Patch index.html: add textarea ──
console.log("→ Patching index.html...");
const htmlFile = path.join(TMP, "index.html");
let html = read(htmlFile);
html = html.replace(
  '<div id="root"></div>',
  '<div id="root"></div>\n<textarea id="budget-data" style="display:none"></textarea>'
);
write(htmlFile, html);

// ── 6. Patch vite.config.js for generic build ──
console.log("→ Patching vite.config.js...");
const viteFile = path.join(TMP, "vite.config.js");
write(viteFile, `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: './dist', emptyOutDir: true },
});
`);

// ── 7. Run Vite build ──
console.log("→ Running Vite build...");
execSync("npx vite build", { cwd: TMP, stdio: "inherit" });

// ── 8. Assemble single HTML ──
console.log("→ Assembling single HTML...");
const distDir = path.join(TMP, "dist");
const distHTML = read(path.join(distDir, "index.html"));

// Find the JS filename
const jsMatch = distHTML.match(/src="\/assets\/(index-[^"]+\.js)"/);
if (!jsMatch) {
  console.error("ERROR: Could not find JS asset in dist/index.html");
  process.exit(1);
}
const jsContent = read(path.join(distDir, "assets", jsMatch[1]));

// Find CSS if any
const cssMatch = distHTML.match(/href="\/assets\/(index-[^"]+\.css)"/);
let cssContent = "";
if (cssMatch) {
  cssContent = read(path.join(distDir, "assets", cssMatch[1]));
}

// Build final HTML
let finalHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Budget Manager</title>
<style>${cssContent}</style>
</head>
<body>
<div id="root"></div>
<textarea id="budget-data" style="display:none"></textarea>
<script>window.__APP_VERSION__ = ${JSON.stringify(APP_VERSION)};</script>
<script>${jsContent}</script>
</body>
</html>`;

write(OUT, finalHTML);

// ── 9. Cleanup ──
console.log("→ Cleaning up...");
fs.rmSync(TMP, { recursive: true });

const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`✓ Built ${OUT} (${size} KB)`);
