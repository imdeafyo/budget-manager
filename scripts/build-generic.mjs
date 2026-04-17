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

// 1a. Replace API load with localStorage + textarea load
const apiLoadRe = /useEffect\(\(\) => \{ \(async \(\) => \{ try \{ const r = await fetch\("\/api\/state"\)[\s\S]*?\}, \[\]\);/;
hook = hook.replace(apiLoadRe, `useEffect(() => {
    try {
      let raw = null;
      try { raw = localStorage.getItem("budget-data"); } catch {}
      if (!raw) {
        const ta = document.getElementById("budget-data");
        if (ta && ta.textContent) raw = ta.textContent.trim();
      }
      if (raw) {
        const d = JSON.parse(raw);
        const m = { cSal:setCS,kSal:setKS,fil:setFil,cEaip:setCE,kEaip:setKE,preDed:setPreDed,postDed:setPostDed,c4pre:setC4pre,c4ro:setC4ro,k4pre:setK4pre,k4ro:setK4ro,exp:setExp,sav:setSav,cats:setCats,savCats:setSavCats,tax:setTax,sortBy:setSortBy,sortDir:setSortDir,hlThresh:setHlThresh,hlPeriod:setHlPeriod,appTitle:setAppTitle,customIcon:setCustomIcon,customTaxDB:setCustomTaxDB,snapshots:setSnapshots,p1Name:setP1Name,p2Name:setP2Name,transactions:setTransactions,transactionColumns:setTransactionColumns,importProfiles:setImportProfiles,categoryAliases:setCategoryAliases,rowCapWarn:setRowCapWarn,rowCapThreshold:setRowCapThreshold,hiddenColumns:setHiddenColumns };
        Object.entries(d).forEach(([k,v])=>{if(m[k])m[k](v)});
      }
    } catch(e) { console.error("Load error:", e); }
    setLoaded(true);
    setTxLoaded(true);
  }, []);`);

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
  'export const DEF_PRE = [{n:"Medical",c:"0",k:"0"},{n:"Dental",c:"0",k:"0"},{n:"Vision",c:"0",k:"0"},{n:"HSA",c:"0",k:"0"}];'
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
`;

// Insert after "const headerRef = useRef(null);"
app = app.replace(
  'const headerRef = useRef(null);',
  'const headerRef = useRef(null);' + saveHelperCode
);

// 4b. Add 💾 button in the header (after the 🌸 theme button)
app = app.replace(
  `>🌸</button>\n            </div>`,
  `>🌸</button>
              <button onClick={handleSaveHTML} title="Save as HTML file" style={{ padding: "5px 10px", background: "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>💾</button>
            </div>`
);

// 4c. Add 🗑 Clear All button on Tax Rates page (after the TaxRatesTab />})
app = app.replace(
  `setFetchStatus={S.setFetchStatus} />}`,
  `setFetchStatus={S.setFetchStatus} />}
        {S.tab === "taxes" && <div style={{ maxWidth: 1100, margin: "20px auto", padding: "0 12px", textAlign: "center" }}>
          <button onClick={handleClearAll} style={{ background: "#dc3545", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>🗑 Clear All Data</button>
        </div>}`
);

// 4d. Add JSON export/import buttons on Charts tab (after the ChartsTab />})
app = app.replace(
  `restoreFullState={S.restoreFullState} />}`,
  `restoreFullState={S.restoreFullState} />}
        {S.tab === "charts" && <div style={{ maxWidth: 1100, margin: "20px auto", padding: "0 12px", display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={handleExportJSON} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📤 Export JSON</button>
          <button onClick={handleImportJSON} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📥 Import JSON</button>
        </div>}`
);

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
<script>${jsContent}</script>
</body>
</html>`;

write(OUT, finalHTML);

// ── 9. Cleanup ──
console.log("→ Cleaning up...");
fs.rmSync(TMP, { recursive: true });

const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`✓ Built ${OUT} (${size} KB)`);
