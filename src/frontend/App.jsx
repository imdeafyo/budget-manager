import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TAX_DB, DEF_TAX, STATE_ABBR, STATE_TAX, STATE_PAYROLL, STATE_BRACKETS, DEF_CATS, DEF_PRE, DEF_POST, DEF_EXP, DEF_SAV_CATS, DEF_SAV } from "./data/taxDB.js";
import { evalF, resolveFormula, calcMatch, calcFed, getMarg, calcStateTax, getStateMarg, toWk, fromWk, fmt, fp, p2, pctOf } from "./utils/calc.js";
import { useM, Card, SH, CSH, NI, PI, EditTxt, VisColsCtx, Row, ExpRowInner, SavRowInner } from "./components/ui.jsx";




/* ══════════════════════════ MAIN APP ══════════════════════════ */
export default function App() {
  const mob = useM();
  const [tab, setTab] = useState("budget");
  const [darkMode, setDarkMode] = useState(() => { try { return localStorage.getItem("budget-theme") || "light"; } catch { return "light"; } });
  const [appTitle, setAppTitle] = useState("Budget Manager");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [tax, setTax] = useState(DEF_TAX);
  const upTax = (k, v) => setTax(p => ({ ...p, [k]: v }));
  const upP1State = (k, v) => { if (k === "name") { const abbr = STATE_ABBR[v]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; setTax(p => ({ ...p, p1State: { ...p.p1State, name: v, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) } })); } else setTax(p => ({ ...p, p1State: { ...p.p1State, [k]: v } })); };
  const upP2State = (k, v) => { if (k === "name") { const abbr = STATE_ABBR[v]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; setTax(p => ({ ...p, p2State: { ...p.p2State, name: v, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) } })); } else setTax(p => ({ ...p, p2State: { ...p.p2State, [k]: v } })); };
  const [fetchStatus, setFetchStatus] = useState("");
  const [showTaxPaste, setShowTaxPaste] = useState(false);
  const [taxPaste, setTaxPaste] = useState("");
  const [customTaxDB, setCustomTaxDB] = useState({});
  const allTaxDB = { ...TAX_DB, ...customTaxDB };
  const loadTaxYear = (yr) => {
    const rates = allTaxDB[yr];
    if (!rates) { setFetchStatus("❌ No data for " + yr); return; }
    setTax(prev => ({ ...prev, year: yr, ...rates, p1State: prev.p1State, p2State: prev.p2State, cMatchTiers: prev.cMatchTiers, cMatchBase: prev.cMatchBase, kMatchTiers: prev.kMatchTiers, kMatchBase: prev.kMatchBase, hsaEmployerMatch: prev.hsaEmployerMatch }));
    setFetchStatus("✅ Loaded " + yr + " federal rates.");
  };
  const addTaxYear = (json) => {
    try {
      const parsed = JSON.parse(json.replace(/```json|```/g, "").trim());
      if (!parsed.year || !parsed.fedSingle || !parsed.fedMFJ) { setFetchStatus("❌ JSON must include year, fedSingle, fedMFJ."); return; }
      const yr = String(parsed.year);
      const entry = { fedSingle: parsed.fedSingle, fedMFJ: parsed.fedMFJ, stdSingle: parsed.stdSingle, stdMFJ: parsed.stdMFJ, ssRate: parsed.ssRate, ssCap: parsed.ssCap, medRate: parsed.medRate, k401Lim: parsed.k401Lim, hsaLimit: parsed.hsaLimit };
      setCustomTaxDB(prev => ({ ...prev, [yr]: entry }));
      setTax(prev => ({ ...prev, year: yr, ...entry, p1State: prev.p1State, p2State: prev.p2State, cMatchTiers: prev.cMatchTiers, cMatchBase: prev.cMatchBase, kMatchTiers: prev.kMatchTiers, kMatchBase: prev.kMatchBase, hsaEmployerMatch: prev.hsaEmployerMatch }));
      setFetchStatus("✅ Added & loaded " + yr + " rates!");
      setTaxPaste(""); setShowTaxPaste(false);
    } catch (e) { setFetchStatus("❌ Invalid JSON: " + e.message); }
  };
  const [cSal, setCS] = useState("0"); const [kSal, setKS] = useState("0");
  const [p1Name, setP1Name] = useState("Person 1"); const [p2Name, setP2Name] = useState("Person 2");
  const [fil, setFil] = useState("mfj");
  const [cEaip, setCE] = useState("8"); const [kEaip, setKE] = useState("5");
  const [preDed, setPreDed] = useState(DEF_PRE);
  const [postDed, setPostDed] = useState(DEF_POST);
  const [c4pre, setC4pre] = useState("8"); const [c4ro, setC4ro] = useState("0");
  const [k4pre, setK4pre] = useState("8"); const [k4ro, setK4ro] = useState("0");
  const [cHsaAnn, setCHsaAnn] = useState("0"); const [kHsaAnn, setKHsaAnn] = useState("0");
  const [exp, setExp] = useState(DEF_EXP);
  const [sav, setSav] = useState(DEF_SAV);
  const [cats, setCats] = useState(DEF_CATS);
  const [savCats, setSavCats] = useState(DEF_SAV_CATS);
  const [newCat, setNewCat] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [sortDir, setSortDir] = useState("desc");
  const [hlThresh, setHlThresh] = useState("200");
  const [hlPeriod, setHlPeriod] = useState("w"); // w, m, y
  const [niN, setNiN] = useState(""); const [niC, setNiC] = useState(DEF_CATS[0]);
  const [niT, setNiT] = useState("N"); const [niS, setNiS] = useState("exp"); const [niP, setNiP] = useState("m"); const [niV, setNiV] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [customIcon, setCustomIcon] = useState(null);
  const [bannerOpen, setBannerOpen] = useState(() => { try { const v = localStorage.getItem("budget-banner"); return v !== null ? v === "true" : (!window.innerWidth || window.innerWidth >= 700); } catch { return true; } });
  const [toolbarOpen, setToolbarOpen] = useState(() => { try { const v = localStorage.getItem("budget-toolbar"); return v !== null ? v === "true" : (!window.innerWidth || window.innerWidth >= 700); } catch { return true; } });
  const [visCols, setVisCols] = useState(() => { try { const v = localStorage.getItem("budget-cols"); return v ? JSON.parse(v) : { wk: true, mo: !window.innerWidth || window.innerWidth >= 700, y48: true, y52: !window.innerWidth || window.innerWidth >= 700 }; } catch { return { wk: true, mo: true, y48: true, y52: true }; } });
  const [showPerPerson, setShowPerPerson] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapLabel, setSnapLabel] = useState("");
  const [snapDate, setSnapDate] = useState("");
  const [editSnapIdx, setEditSnapIdx] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState(null);
  const [itemHistoryName, setItemHistoryName] = useState("");
  const [viewingSnap, setViewingSnap] = useState(null); // snapshot index being viewed
  const [snapTab, setSnapTab] = useState("budget"); // "budget" | "deductions" | "tax"
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkVal, setBulkVal] = useState("");
  const [bulkPer, setBulkPer] = useState("m");
  const [bulkType, setBulkType] = useState("N");
  const [bulkSec, setBulkSec] = useState("exp");
  const [bulkCat, setBulkCat] = useState("");
  const [bulkTargets, setBulkTargets] = useState({}); // { current: true, snapId1: true, ... }
  const [catChartMode, setCatChartMode] = useState("stacked"); // "stacked" (only mode now)
  const [catHistoryName, setCatHistoryName] = useState(""); // selected category for history chart
  const [catHistMode, setCatHistMode] = useState("line"); // "line" | "stacked" for Budget History chart style
  const [itemHistMode, setItemHistMode] = useState("category"); // "category" | "item" for Budget History view toggle
  const [necDisMode, setNecDisMode] = useState("line"); // "line" | "stacked" for Nec vs Dis
  const [snapHistView, setSnapHistView] = useState("years"); // "years" | "all"
  const [snapHistYear, setSnapHistYear] = useState(null); // which year tab is selected
  const [savRateBase, setSavRateBase] = useState("net"); // "net" or "gross"
  const [chartWeeks, setChartWeeks] = useState(48); // 48 or 52 for chart income/budget multiplier
  const [snapVisCols, setSnapVisCols] = useState(() => { try { const v = localStorage.getItem("budget-snap-cols"); return v ? JSON.parse(v) : { wk: true, mo: true, y48: true, y52: true }; } catch { return { wk: true, mo: true, y48: true, y52: true }; } }); // snapshot column toggle
  const DEF_CHART_ORDER = ["pieCategory", "pieNecDis", "budgetVsSalary", "necVsDis", "netSalary", "grossSalary", "budgetHistory"];
  const [chartOrder, setChartOrder] = useState(() => { try { const v = localStorage.getItem("budget-chart-order"); return v ? JSON.parse(v) : DEF_CHART_ORDER; } catch { return DEF_CHART_ORDER; } });
  const [dragChart, setDragChart] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const toggleSec = s => setCollapsed(p => ({ ...p, [s]: !p[s] }));
  const allExpanded = !collapsed.nec && !collapsed.dis && !collapsed.sav && !collapsed.preTax && !collapsed.postTax && !collapsed.fedTax && !collapsed.stTax && !collapsed.preSav && !collapsed.eaip && !collapsed.eaipTax;
  const allCollapsed = collapsed.nec && collapsed.dis && collapsed.sav && collapsed.preTax && collapsed.postTax && collapsed.fedTax && collapsed.stTax && collapsed.preSav && collapsed.eaip && collapsed.eaipTax;
  const isMixed = !allExpanded && !allCollapsed;
  const expandAll = () => setCollapsed({ nec: false, dis: false, sav: false, preTax: false, postTax: false, fedTax: false, stTax: false, preSav: false, eaip: false, eaipTax: false });
  const collapseAll = () => setCollapsed({ nec: true, dis: true, sav: true, preTax: true, postTax: true, fedTax: true, stTax: true, preSav: true, eaip: true, eaipTax: true });
  const toggleAll = () => { if (allExpanded) collapseAll(); else expandAll(); };
  const [includeEaip, setIncludeEaip] = useState(false);

  // Load
  useEffect(() => { (async () => { try { const r = await fetch("/api/state").then(r => r.json()); if (r?.state) { const d = r.state; const m = { cSal:setCS,kSal:setKS,fil:setFil,cEaip:setCE,kEaip:setKE,preDed:setPreDed,postDed:setPostDed,c4pre:setC4pre,c4ro:setC4ro,k4pre:setK4pre,k4ro:setK4ro,cHsaAnn:setCHsaAnn,kHsaAnn:setKHsaAnn,exp:setExp,sav:setSav,cats:setCats,savCats:setSavCats,tax:setTax,sortBy:setSortBy,sortDir:setSortDir,hlThresh:setHlThresh,hlPeriod:setHlPeriod,appTitle:setAppTitle,customIcon:setCustomIcon,customTaxDB:setCustomTaxDB,snapshots:setSnapshots,p1Name:setP1Name,p2Name:setP2Name }; Object.entries(d).forEach(([k,v])=>{if(m[k])m[k](v)}); } } catch(e){} setLoaded(true); })(); }, []);
  const st = useMemo(() => ({cSal,kSal,fil,cEaip,kEaip,preDed,postDed,c4pre,c4ro,k4pre,k4ro,cHsaAnn,kHsaAnn,exp,sav,cats,savCats,tax,sortBy,sortDir,hlThresh,hlPeriod,appTitle,customIcon,customTaxDB,snapshots,p1Name,p2Name}), [cSal,kSal,fil,cEaip,kEaip,preDed,postDed,c4pre,c4ro,k4pre,k4ro,cHsaAnn,kHsaAnn,exp,sav,cats,savCats,tax,sortBy,sortDir,hlThresh,hlPeriod,appTitle,customIcon,customTaxDB,snapshots,p1Name,p2Name]);
  useEffect(() => { const t = setTimeout(async () => { try { await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: st }) }); } catch(e){} }, 600); return () => clearTimeout(t); }, [st]);

  // HSA: auto-populate the HSA pre-tax deduction from annual amounts — ONLY if annual is non-zero
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) return; // don't run until persistence has loaded
    const cAnn = evalF(cHsaAnn);
    const kAnn = evalF(kHsaAnn);
    if (cAnn === 0 && kAnn === 0) return; // don't overwrite manual entries with zeros
    const cW = cAnn / 52;
    const kW = kAnn / 52;
    const hsaIdx = preDed.findIndex(d => d.n.toLowerCase().includes("hsa"));
    if (hsaIdx >= 0) {
      const n = [...preDed]; n[hsaIdx] = { ...n[hsaIdx], c: String(Math.round(cW * 100) / 100), k: String(Math.round(kW * 100) / 100) }; setPreDed(n);
    }
  }, [cHsaAnn, kHsaAnn, loaded]);

  /* ── Tax calculations ── */
  const C = useMemo(() => {
    const cs = evalF(cSal), ks = evalF(kSal), cw = cs / 52, kw = ks / 52;
    const cPreW = preDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPreW = preDed.reduce((s, d) => s + evalF(d.k), 0);
    // 401k limits: base + catch-up per person
    const cLim = tax.k401Lim + (tax.c401Catch || 0), kLim = tax.k401Lim + (tax.k401Catch || 0);
    // Catch-up split: if pre-tax, adds to pre-tax cap; if Roth, adds to Roth cap
    const cCatchPre = (tax.c401CatchPreTax !== false) ? (tax.c401Catch || 0) : 0;
    const cCatchRo = (tax.c401CatchPreTax === false) ? (tax.c401Catch || 0) : 0;
    const kCatchPre = (tax.k401CatchPreTax !== false) ? (tax.k401Catch || 0) : 0;
    const kCatchRo = (tax.k401CatchPreTax === false) ? (tax.k401Catch || 0) : 0;
    const cPrePct = Math.min(evalF(c4pre) / 100, (tax.k401Lim + cCatchPre) / Math.max(cs, 1));
    const cRoPct = Math.min(evalF(c4ro) / 100, (cLim - cs * cPrePct) / Math.max(cs, 1));
    const kPrePct = Math.min(evalF(k4pre) / 100, (tax.k401Lim + kCatchPre) / Math.max(ks, 1));
    const kRoPct = Math.min(evalF(k4ro) / 100, (kLim - ks * kPrePct) / Math.max(ks, 1));
    const c4preW = cs * cPrePct / 52, c4roW = cs * cRoPct / 52;
    const k4preW = ks * kPrePct / 52, k4roW = ks * kRoPct / 52;
    const c4w = c4preW + c4roW, k4w = k4preW + k4roW;
    const cTxW = cw - cPreW - c4preW, kTxW = kw - kPreW - k4preW;
    const combTxA = (cTxW + kTxW) * 52;
    const br = fil === "mfj" ? tax.fedMFJ : tax.fedSingle;
    const sd = fil === "mfj" ? tax.stdMFJ : tax.stdSingle;
    const fTax = fil === "mfj" ? calcFed(Math.max(0, combTxA - sd), br) : calcFed(Math.max(0, cTxW * 52 - tax.stdSingle), tax.fedSingle) + calcFed(Math.max(0, kTxW * 52 - tax.stdSingle), tax.fedSingle);
    const mr = getMarg(Math.max(0, combTxA - sd), br);
    const tot = cTxW + kTxW, cr = tot > 0 ? cTxW / tot : .5;
    const cFed = (fTax / 52) * cr, kFed = (fTax / 52) * (1 - cr);
    const ssR = tax.ssRate / 100, medR = tax.medRate / 100;
    const p1s = (tax.p1State || {}), p2s = (tax.p2State || {});
    const cSS = Math.min(cw, tax.ssCap / 52) * ssR, kSS = Math.min(kw, tax.ssCap / 52) * ssR;
    const cMc = cw * medR, kMc = kw * medR;
    const cStAnn = calcStateTax(cTxW * 52, p1s.abbr || "", fil);
    const kStAnn = calcStateTax(kTxW * 52, p2s.abbr || "", fil);
    const cCO = cStAnn / 52, kCO = kStAnn / 52;
    const cStMR = getStateMarg(cTxW * 52, p1s.abbr || "", fil);
    const kStMR = getStateMarg(kTxW * 52, p2s.abbr || "", fil);
    const cFL = cw * (p1s.famli || 0) / 100, kFL = kw * (p2s.famli || 0) / 100;
    const cTx = cFed + cSS + cMc + cCO + cFL, kTx = kFed + kSS + kMc + kCO + kFL;
    const cPostW = c4roW + postDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPostW = k4roW + postDed.reduce((s, d) => s + evalF(d.k), 0);
    const cNet = cw - cPreW - c4w - cTx - postDed.reduce((s, d) => s + evalF(d.c), 0);
    const kNet = kw - kPreW - k4w - kTx - postDed.reduce((s, d) => s + evalF(d.k), 0);
    const cTotalPct = evalF(c4pre) + evalF(c4ro), kTotalPct = evalF(k4pre) + evalF(k4ro);
    const cMP = calcMatch(cTotalPct, tax.cMatchTiers || [], tax.cMatchBase || 0);
    const kMP = calcMatch(kTotalPct, tax.kMatchTiers || [], tax.kMatchBase || 0);
    // EAIP — annual bonus, taxed at marginal rates
    const cEaipGross = cs * (evalF(cEaip) / 100);
    const kEaipGross = ks * (evalF(kEaip) / 100);
    const eaipGross = cEaipGross + kEaipGross;
    // EAIP taxes: fed marginal, SS (if under cap), Medicare, state, FAMLI
    const cEaipFed = cEaipGross * mr;
    const kEaipFed = kEaipGross * mr;
    const cEaipSS = Math.max(0, Math.min(cEaipGross, Math.max(0, tax.ssCap - cs))) * ssR;
    const kEaipSS = Math.max(0, Math.min(kEaipGross, Math.max(0, tax.ssCap - ks))) * ssR;
    const cEaipMc = cEaipGross * medR, kEaipMc = kEaipGross * medR;
    const cEaipSt = cEaipGross > 0 ? calcStateTax(cTxW * 52 + cEaipGross, p1s.abbr || "", fil) - cStAnn : 0;
    const kEaipSt = kEaipGross > 0 ? calcStateTax(kTxW * 52 + kEaipGross, p2s.abbr || "", fil) - kStAnn : 0;
    const cEaipFL = cEaipGross * (p1s.famli || 0) / 100, kEaipFL = kEaipGross * (p2s.famli || 0) / 100;
    const cEaipTax = cEaipFed + cEaipSS + cEaipMc + cEaipSt + cEaipFL;
    const kEaipTax = kEaipFed + kEaipSS + kEaipMc + kEaipSt + kEaipFL;
    const cEaipNet = cEaipGross - cEaipTax, kEaipNet = kEaipGross - kEaipTax;
    const eaipNet = cEaipNet + kEaipNet;
    return { cs, ks, cw, kw, cPreW, kPreW, c4w, k4w, c4preW, k4preW, c4roW, k4roW, cTxW, kTxW, fTax, mr, sd, cFed, kFed, cSS, kSS, cMc, kMc, cCO, kCO, cStMR, kStMR, cFL, kFL, cTx, kTx, cPostW, kPostW, cNet, kNet, net: cNet + kNet, cMP, kMP, ssR, medR, eaipGross, eaipNet, cEaipGross, kEaipGross, cEaipNet, kEaipNet, cEaipTax, kEaipTax, cEaipFed, kEaipFed, cEaipSS, kEaipSS, cEaipMc, kEaipMc, cEaipSt, kEaipSt, cEaipFL, kEaipFL };
  }, [cSal, kSal, fil, preDed, postDed, c4pre, c4ro, k4pre, k4ro, tax, cEaip, kEaip]);

  const moC = v => v * 48 / 12, y4 = v => v * 48, y5 = v => v * 52;
  const hlW = evalF(hlThresh);
  const hlWk = hlPeriod === "m" ? hlW * 12 / 48 : hlPeriod === "y" ? hlW / 48 : hlW; // convert threshold to weekly for comparison

  const applySort = items => {
    const s = [...items];
    if (sortBy === "amount") s.sort((a, b) => sortDir === "desc" ? b.wk - a.wk : a.wk - b.wk);
    else if (sortBy === "category") s.sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));
    return s;
  };
  const ewk = useMemo(() => exp.map((e, i) => ({ ...e, idx: i, wk: toWk(e.v, e.p), hl: toWk(e.v, e.p) >= hlWk && hlWk > 0 })), [exp, hlW, hlPeriod]);
  const necI = useMemo(() => applySort(ewk.filter(e => e.t === "N")), [ewk, sortBy, sortDir]);
  const disI = useMemo(() => applySort(ewk.filter(e => e.t === "D")), [ewk, sortBy, sortDir]);
  const savSorted = useMemo(() => { const items = sav.map((s, i) => ({ ...s, idx: i, wk: toWk(s.v, s.p), hl: toWk(s.v, s.p) >= hlWk && hlWk > 0 })); if (sortBy === "amount") items.sort((a, b) => sortDir === "desc" ? b.wk - a.wk : a.wk - b.wk); return items; }, [sav, sortBy, sortDir, hlW]);

  const tNW = necI.reduce((s, e) => s + e.wk, 0), tDW = disI.reduce((s, e) => s + e.wk, 0);
  const tExpW = tNW + tDW, tSavW = savSorted.reduce((s, e) => s + e.wk, 0);
  const remW = C.net - tExpW - tSavW;
  const remY48 = C.net * 48 - tExpW * 48 - tSavW * 48;
  const remY52 = C.net * 52 - tExpW * 48 - tSavW * 52; // expenses stay at 48-wk annual, income & savings get 52
  const totalSavPlusRemW = tSavW + Math.max(0, remW); // remaining adds to savings

  const budgetTotal = (savRateBase === "gross" ? (C.cw + C.kw) * 48 : C.net * 48) + (includeEaip ? (savRateBase === "gross" ? C.eaipGross : C.eaipNet) : 0);
  const allocatedTotal = (tExpW + tSavW) * 48;
  const unallocatedPct = budgetTotal > 0 ? ((budgetTotal - allocatedTotal) / budgetTotal * 100).toFixed(1) : "0";

  const catTot = useMemo(() => { const m = {}; ewk.forEach(e => { if (e.wk > 0) m[e.c] = (m[e.c] || 0) + e.wk * 48; }); return Object.entries(m).map(([k, v], i) => ({ name: k, value: Math.round(v), _allValues: [budgetTotal], _base: budgetTotal, color: ["#E8573A", "#F2A93B", "#4ECDC4", "#556FB5", "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#95A5A6", "#D35400", "#C0392B", "#3498DB"][i % 12] })); }, [ewk, budgetTotal]);

  const typTot = useMemo(() => {
    let n = 0, d = 0, s = 0;
    ewk.forEach(e => { e.t === "N" ? n += e.wk * 48 : d += e.wk * 48; });
    savSorted.forEach(e => s += e.wk * 48);
    s += Math.max(0, remW) * 48; // add remaining to savings
    if (includeEaip) s += C.eaipNet; // add Bonus to savings
    const base = savRateBase === "gross" ? (C.cw + C.kw) * 48 + (includeEaip ? C.eaipGross : 0) : C.net * 48 + (includeEaip ? C.eaipNet : 0);
    const vals = [n, d, s, Math.max(0, base - n - d - s)];
    return [
      { name: "Necessity", value: Math.round(n), _allValues: vals, color: "#556FB5" },
      { name: "Discretionary", value: Math.round(d), _allValues: vals, color: "#E8573A" },
      { name: "Savings" + (includeEaip ? " + Bonus" : ""), value: Math.round(s), _allValues: vals, color: "#2ECC71" },
    ].filter(x => x.value > 0);
  }, [ewk, savSorted, savRateBase, C, includeEaip, remW]);

  const updExp = useCallback((idx, updates) => { setExp(prev => { const n = [...prev]; n[idx] = { ...n[idx], ...updates }; return n; }); }, []);
  const updSav = useCallback((idx, updates) => { setSav(prev => { const n = [...prev]; n[idx] = { ...n[idx], ...updates }; return n; }); }, []);
  const rmExp = useCallback(idx => { setExp(prev => prev.filter((_, j) => j !== idx)); }, []);
  const rmSav = useCallback(idx => { setSav(prev => prev.filter((_, j) => j !== idx)); }, []);

  // recalcSnap — recalculates all aggregate snapshot fields from items + salaries + deductions
  const recalcSnap = useCallback((snapObj) => {
    const it = snapObj.items || {};
    let nec = 0, dis = 0, sv = 0;
    Object.values(it).forEach(x => { if (x.t === "N") nec += x.v || 0; else if (x.t === "D") dis += x.v || 0; else sv += x.v || 0; });
    const sCS = snapObj.cSalary !== undefined ? snapObj.cSalary : (snapObj.cGrossW || 0) * 52;
    const sKS = snapObj.kSalary !== undefined ? snapObj.kSalary : (snapObj.kGrossW || 0) * 52;
    const sYr = snapObj.date ? snapObj.date.slice(0, 4) : tax.year;
    const sTD = allTaxDB[sYr] || allTaxDB[tax.year] || TAX_DB["2026"];
    const sF = snapObj.fil || fil;
    const sP1 = snapObj.p1State || (tax.p1State || {});
    const sP2 = snapObj.p2State || (tax.p2State || {});
    const sw1 = sCS / 52, sw2 = sKS / 52;
    // Pre-tax deductions from fullState
    const fs = snapObj.fullState || {};
    const snapPreDed = fs.preDed || [];
    const snapPostDed = fs.postDed || [];
    const cPreW = snapPreDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPreW = snapPreDed.reduce((s, d) => s + evalF(d.k), 0);
    // 401k from fullState
    const c4prePct = Math.min(evalF(fs.c4pre || 0) / 100, 1);
    const c4roPct = Math.min(evalF(fs.c4ro || 0) / 100, 1);
    const k4prePct = Math.min(evalF(fs.k4pre || 0) / 100, 1);
    const k4roPct = Math.min(evalF(fs.k4ro || 0) / 100, 1);
    const c4preW = sCS * c4prePct / 52, c4roW = sCS * c4roPct / 52;
    const k4preW = sKS * k4prePct / 52, k4roW = sKS * k4roPct / 52;
    // Taxable = gross - pre-tax deductions - pre-tax 401k
    const cTxW = sw1 - cPreW - c4preW, kTxW = sw2 - kPreW - k4preW;
    const sBr = sF === "mfj" ? sTD.fedMFJ : sTD.fedSingle;
    const sSd = sF === "mfj" ? sTD.stdMFJ : sTD.stdSingle;
    const sCTA = (cTxW + kTxW) * 52;
    const sFT = sF === "mfj" ? calcFed(Math.max(0, sCTA - sSd), sBr) : calcFed(Math.max(0, cTxW * 52 - sTD.stdSingle), sTD.fedSingle) + calcFed(Math.max(0, kTxW * 52 - sTD.stdSingle), sTD.fedSingle);
    const sR = sTD.ssRate / 100, mR = sTD.medRate / 100;
    const sT = cTxW + kTxW, sC = sT > 0 ? cTxW / sT : 0.5;
    const f1 = (sFT / 52) * sC, f2 = (sFT / 52) * (1 - sC);
    const ss1 = Math.min(sw1, sTD.ssCap / 52) * sR, ss2 = Math.min(sw2, sTD.ssCap / 52) * sR;
    const mc1 = sw1 * mR, mc2 = sw2 * mR;
    const st1 = calcStateTax(cTxW * 52, sP1.abbr || "", sF) / 52;
    const st2 = calcStateTax(kTxW * 52, sP2.abbr || "", sF) / 52;
    const fl1 = sw1 * (sP1.famli || 0) / 100, fl2 = sw2 * (sP2.famli || 0) / 100;
    // Post-tax deductions
    const cPostW = c4roW + snapPostDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPostW = k4roW + snapPostDed.reduce((s, d) => s + evalF(d.k), 0);
    // Net = gross - preTax - 401k(all) - taxes - postTax deductions
    const n1 = sw1 - cPreW - c4preW - c4roW - f1 - ss1 - mc1 - st1 - fl1 - snapPostDed.reduce((s, d) => s + evalF(d.c), 0);
    const n2 = sw2 - kPreW - k4preW - k4roW - f2 - ss2 - mc2 - st2 - fl2 - snapPostDed.reduce((s, d) => s + evalF(d.k), 0);
    const nW = n1 + n2;
    const gW = sw1 + sw2;
    const eW = (nec + dis) / 48;
    const sW = sv / 48;
    const rW = nW - eW - sW;
    const cBonusPct = snapObj.cEaipPct !== undefined ? snapObj.cEaipPct : (snapObj.fullState?.cEaip !== undefined ? evalF(snapObj.fullState.cEaip) : 0);
    const kBonusPct = snapObj.kEaipPct !== undefined ? snapObj.kEaipPct : (snapObj.fullState?.kEaip !== undefined ? evalF(snapObj.fullState.kEaip) : 0);
    const cBonusGross = sCS * cBonusPct / 100;
    const kBonusGross = sKS * kBonusPct / 100;
    const mr = getMarg(Math.max(0, sCTA - sSd), sBr);
    const cBonusTax = cBonusGross * mr + Math.max(0, Math.min(cBonusGross, Math.max(0, sTD.ssCap - sCS))) * sR + cBonusGross * mR + (cBonusGross > 0 ? calcStateTax(cTxW * 52 + cBonusGross, sP1.abbr || "", sF) - calcStateTax(cTxW * 52, sP1.abbr || "", sF) : 0) + cBonusGross * (sP1.famli || 0) / 100;
    const kBonusTax = kBonusGross * mr + Math.max(0, Math.min(kBonusGross, Math.max(0, sTD.ssCap - sKS))) * sR + kBonusGross * mR + (kBonusGross > 0 ? calcStateTax(kTxW * 52 + kBonusGross, sP2.abbr || "", sF) - calcStateTax(kTxW * 52, sP2.abbr || "", sF) : 0) + kBonusGross * (sP2.famli || 0) / 100;
    const cBonusNet = cBonusGross - cBonusTax;
    const kBonusNet = kBonusGross - kBonusTax;
    const totalSavPlusRem = sW + Math.max(0, rW);
    return {
      ...snapObj,
      necW: nec / 48, disW: dis / 48, expW: eW, savW: sW, remW: rW,
      netW: nW, grossW: gW, cNetW: n1, kNetW: n2, cGrossW: sw1, kGrossW: sw2,
      savRate: nW > 0 ? (totalSavPlusRem / nW * 100) : 0,
      savRateGross: gW > 0 ? (totalSavPlusRem / gW * 100) : 0,
      eaipGross: cBonusGross + kBonusGross, eaipNet: cBonusNet + kBonusNet,
      cEaipNet: cBonusNet, kEaipNet: kBonusNet,
      cEaipPct: cBonusPct, kEaipPct: kBonusPct,
    };
  }, [tax, fil, allTaxDB]);

  // Recalculate all snapshot aggregate fields on load to ensure consistency
  const [snapsRecalced, setSnapsRecalced] = useState(false);
  useEffect(() => {
    if (!loaded || snapsRecalced || snapshots.length === 0) return;
    setSnapsRecalced(true);
    setSnapshots(prev => prev.map(s => recalcSnap(s)));
  }, [loaded, recalcSnap, snapshots.length, snapsRecalced]);

  const BrEd = ({ brackets, onChange }) => (
    <div style={{  }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 20px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span><span /></div>
      {brackets.map((b, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 20px", gap: 3, marginBottom: 2 }}>
          <input type="number" value={b[0]} onChange={e => { const n = [...brackets]; n[i] = [+e.target.value, n[i][1], n[i][2]]; onChange(n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "3px 4px", fontSize: 11, fontFamily: "'DM Sans',sans-serif", minWidth: 0, width: "100%" }} />
          <input type="number" value={b[1] >= 9999999 ? "" : b[1]} placeholder="∞" onChange={e => { const n = [...brackets]; n[i] = [n[i][0], e.target.value === "" ? 9999999 : +e.target.value, n[i][2]]; onChange(n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "3px 4px", fontSize: 11, fontFamily: "'DM Sans',sans-serif", minWidth: 0, width: "100%" }} />
          <input type="number" step="0.01" value={(b[2] * 100).toFixed(2)} onChange={e => { const n = [...brackets]; n[i] = [n[i][0], n[i][1], +e.target.value / 100]; onChange(n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "3px 4px", fontSize: 11, fontFamily: "'DM Sans',sans-serif", minWidth: 0, width: "100%" }} />
          <button onClick={() => onChange(brackets.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc", padding: 0 }}>×</button>
        </div>
      ))}
      <button onClick={() => { const l = brackets[brackets.length - 1]; onChange([...brackets, [l ? l[1] : 0, 9999999, .37]]); }} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Bracket</button>
    </div>
  );

  const StateBrView = ({ abbr, filing, label }) => {
    const st = STATE_BRACKETS[abbr];
    if (!st) return null;
    const br = filing === "mfj" ? (st.mfj && st.mfj.length > 0 ? st.mfj : st.single) : st.single;
    if (!br || br.length === 0) return <Card><h3 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>{label}</h3><div style={{ fontSize: 12, color: "var(--tx3,#999)" }}>No state income tax</div></Card>;
    const sd = filing === "mfj" ? st.stdMFJ : st.stdSingle;
    return (
      <Card>
        <h3 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>{label}</h3>
        {sd > 0 && <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginBottom: 8 }}>Std Deduction: {fmt(sd)}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span></div>
        {br.map((b, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, marginBottom: 2, fontSize: 11, color: "var(--tx2,#555)" }}>
            <span>{fmt(b[0])}</span>
            <span>{b[1] >= 9999999 ? "∞" : fmt(b[1])}</span>
            <span style={{ fontWeight: 600 }}>{(b[2] * 100).toFixed(2)}%</span>
          </div>
        ))}
      </Card>
    );
  };

  const DedEditor = ({ items, setItems, label }) => (
    <Card>
      <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>{label} <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
        {items.map((d, i) => [
          <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...items]; n[i] = { ...n[i], n: v }; setItems(n); }} /></div>,
          <NI key={i + "c"} value={d.c} onChange={v => { const n = [...items]; n[i] = { ...n[i], c: v }; setItems(n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
          <NI key={i + "k"} value={d.k} onChange={v => { const n = [...items]; n[i] = { ...n[i], k: v }; setItems(n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
          <button key={i + "x"} onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
        ])}
      </div>
      <button onClick={() => setItems([...items, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
    </Card>
  );

  /* Custom tooltip for pie charts showing amount + % */
  const PieTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0];
    const base = d.payload?._base;
    const allEntries = d.payload?._allValues;
    const sum = base || (allEntries ? allEntries.reduce((s, v) => s + v, 0) : d.value);
    const pct = sum > 0 ? (d.value / sum * 100).toFixed(1) : "0";
    return <div style={{ background: "var(--card-bg, #fff)", padding: "8px 12px", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.1)", fontSize: 12 }}><strong>{d.name}</strong>: {fmt(d.value)} ({pct}%)</div>;
  };

  const dk = darkMode === "dark" || darkMode === true;
  const waf = darkMode === "waf";
  useEffect(() => { try { localStorage.setItem("budget-theme", darkMode); } catch {} }, [darkMode]);
  useEffect(() => { try { localStorage.setItem("budget-banner", bannerOpen); } catch {} }, [bannerOpen]);
  useEffect(() => { try { localStorage.setItem("budget-toolbar", toolbarOpen); } catch {} }, [toolbarOpen]);
  useEffect(() => { try { localStorage.setItem("budget-cols", JSON.stringify(visCols)); } catch {} }, [visCols]);
  useEffect(() => { try { localStorage.setItem("budget-snap-cols", JSON.stringify(snapVisCols)); } catch {} }, [snapVisCols]);
  useEffect(() => { try { localStorage.setItem("budget-chart-order", JSON.stringify(chartOrder)); } catch {} }, [chartOrder]);
  const chartDragHandlers = useMemo(() => ({
    onDragStart: (id) => setDragChart(id),
    onDrop: (id) => { if (dragChart && dragChart !== id) { setChartOrder(prev => { const n = prev.filter(x => x !== dragChart); const idx = n.indexOf(id); n.splice(idx, 0, dragChart); return [...n]; }); setDragChart(null); } }
  }), [dragChart]);
  const dragWrapRender = (id, children, span) => (
    <div key={id} draggable onDragStart={() => chartDragHandlers.onDragStart(id)} onDragOver={e => e.preventDefault()} onDrop={() => chartDragHandlers.onDrop(id)} style={{ gridColumn: span ? "1 / -1" : undefined, opacity: dragChart === id ? 0.5 : 1, cursor: "grab", position: "relative" }}>
      <div style={{ position: "absolute", top: 6, right: 10, fontSize: 12, color: "var(--tx3, #bbb)", cursor: "grab", userSelect: "none", zIndex: 1 }} title="Drag to reorder">⠿</div>
      {children}
    </div>
  );
  useEffect(() => { window.scrollTo(0, 0); }, [tab, viewingSnap]);
  // Only reset snapTab when entering/leaving snapshot view, not when paging between snapshots
  const prevViewingSnap = useRef(viewingSnap);
  useEffect(() => {
    const wasNull = prevViewingSnap.current === null;
    const isNull = viewingSnap === null;
    if (wasNull !== isNull) setSnapTab("budget");
    prevViewingSnap.current = viewingSnap;
  }, [viewingSnap]);
  const cycleTheme = () => setDarkMode(p => p === "light" || p === false ? "dark" : p === "dark" || p === true ? "waf" : "light");
  const bg = dk ? "#1e1e1e" : waf ? "#d5d0cb" : "linear-gradient(145deg,#f5f0eb 0%,#ede7e0 50%,#e8e2db 100%)";
  const headerBg = dk ? "#1a1a1a" : waf ? "#486b50" : "#1a1a1a";
  const tx = dk ? "#e8e8e8" : "#333";
  const tabAccent = waf ? "#c96b70" : "#E8573A";
  const ts = a => ({ padding: "10px 14px", border: "none", borderBottom: a ? `3px solid ${tabAccent}` : "3px solid transparent", background: "none", color: a ? tabAccent : "#aaa", fontFamily: "'DM Sans',sans-serif", fontWeight: a ? 700 : 500, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" });

  useEffect(() => {
    const r = document.documentElement;
    if (dk) {
      r.style.setProperty("--card-bg", "#2a2a2a"); r.style.setProperty("--card-color", "#e8e8e8");
      r.style.setProperty("--input-bg", "#333"); r.style.setProperty("--input-color", "#e8e8e8"); r.style.setProperty("--input-border", "#555");
      r.style.setProperty("--shadow", "none");
      r.style.setProperty("--tx", "#e8e8e8"); r.style.setProperty("--tx2", "#ccc"); r.style.setProperty("--tx3", "#999");
      r.style.setProperty("--bdr", "#444"); r.style.setProperty("--bdr2", "#3a3a3a");
      r.style.setProperty("--c-pretax", "#e07060"); r.style.setProperty("--c-presav", "#4DE8B8");
      r.style.setProperty("--c-fedtax", "#6CA6E0"); r.style.setProperty("--c-fedtax2", "#8AC0F0");
      r.style.setProperty("--c-sttax", "#D4A050"); r.style.setProperty("--c-sttax2", "#E0BB70");
      r.style.setProperty("--c-totaltax", "#F07060"); r.style.setProperty("--c-posttax", "#C89FE0");
      r.style.setProperty("--c-posttax2", "#D8B8F0");
      r.style.setProperty("--c-taxable", "#8CA8E0");
      r.style.setProperty("--c-nec", "#8CA8E0"); r.style.setProperty("--c-dis", "#F07060"); r.style.setProperty("--c-sav", "#50E898");
      r.style.setProperty("--c-eaip", "#C89FE0"); r.style.setProperty("--c-eaiptax", "#F07060");
    } else if (waf) {
      r.style.setProperty("--card-bg", "#e8e3de"); r.style.setProperty("--card-color", "#2d2d2d");
      r.style.setProperty("--input-bg", "#ddd8d3"); r.style.setProperty("--input-color", "#2d2d2d"); r.style.setProperty("--input-border", "#e0d5d0");
      r.style.setProperty("--shadow", "0 1px 4px rgba(80,60,50,.1),0 4px 12px rgba(80,60,50,.06)");
      r.style.setProperty("--tx", "#3d3d3d"); r.style.setProperty("--tx2", "#6b5c55"); r.style.setProperty("--tx3", "#a89890");
      r.style.setProperty("--bdr", "#e8ddd8"); r.style.setProperty("--bdr2", "#e0d5d0");
      r.style.setProperty("--c-pretax", "#c96b70"); r.style.setProperty("--c-presav", "#5a9e6f");
      r.style.setProperty("--c-fedtax", "#7b8fa8"); r.style.setProperty("--c-fedtax2", "#98adc0");
      r.style.setProperty("--c-sttax", "#b08860"); r.style.setProperty("--c-sttax2", "#c8a070");
      r.style.setProperty("--c-totaltax", "#c96b70"); r.style.setProperty("--c-posttax", "#9b7bb0");
      r.style.setProperty("--c-posttax2", "#b898c8");
      r.style.setProperty("--c-taxable", "#7b8fa8");
      r.style.setProperty("--c-nec", "#7b8fa8"); r.style.setProperty("--c-dis", "#c96b70"); r.style.setProperty("--c-sav", "#5a9e6f");
      r.style.setProperty("--c-eaip", "#9b7bb0"); r.style.setProperty("--c-eaiptax", "#c96b70");
    } else {
      r.style.setProperty("--card-bg", "#fff"); r.style.setProperty("--card-color", "#222");
      r.style.setProperty("--input-bg", "#fafafa"); r.style.setProperty("--input-color", "#222"); r.style.setProperty("--input-border", "#e0e0e0");
      r.style.setProperty("--shadow", "0 1px 4px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.03)");
      r.style.setProperty("--tx", "#333"); r.style.setProperty("--tx2", "#555"); r.style.setProperty("--tx3", "#999");
      r.style.setProperty("--bdr", "#e0e0e0"); r.style.setProperty("--bdr2", "#e0ddd8");
      r.style.setProperty("--c-pretax", "#c0392b"); r.style.setProperty("--c-presav", "#1ABC9C");
      r.style.setProperty("--c-fedtax", "#1a5276"); r.style.setProperty("--c-fedtax2", "#3a7abf");
      r.style.setProperty("--c-sttax", "#8B4513"); r.style.setProperty("--c-sttax2", "#B8860B");
      r.style.setProperty("--c-totaltax", "#E8573A"); r.style.setProperty("--c-posttax", "#9B59B6");
      r.style.setProperty("--c-posttax2", "#C39BD3");
      r.style.setProperty("--c-taxable", "#556FB5");
      r.style.setProperty("--c-nec", "#556FB5"); r.style.setProperty("--c-dis", "#E8573A"); r.style.setProperty("--c-sav", "#2ECC71");
      r.style.setProperty("--c-eaip", "#9B59B6"); r.style.setProperty("--c-eaiptax", "#E8573A");
    }
  }, [dk, waf]);

  const iconRef = useRef(null);
  const headerRef = useRef(null);

  return (
    <VisColsCtx.Provider value={visCols}>
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'DM Sans',sans-serif", color: tx }}>
      <style>{`
        html, body { max-width: 100vw; margin: 0; padding: 0; overflow-x: hidden; }
        * { box-sizing: border-box; }
        input, textarea, select { max-width: 100%; min-width: 0; }
        :root { --card-bg:#fff; --card-color:#222; --input-bg:#fafafa; --input-color:#222; --input-border:#e0e0e0; --tx:#333; --tx2:#555; --tx3:#999; --bdr:#e0e0e0; --bdr2:#e0ddd8; --shadow:0 1px 4px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.03); }
        input, textarea { background: var(--input-bg) !important; color: var(--input-color) !important; border-color: var(--input-border) !important; }
        select { color: var(--input-color) !important; border-color: var(--input-border) !important; }
        select:not(.cat-dd) { background: var(--input-bg) !important; }
        .cat-dd { background: transparent; border: none; font-size: 13px; padding: 1px 4px; color: var(--tx2, #555); cursor: pointer; max-width: 120px; outline: none; }
        .cat-dd:hover, .cat-dd:focus { background: var(--input-bg, #f5f5f5) !important; border-radius: 4px; }
        input::placeholder { color: var(--tx3); }
        .recharts-default-tooltip { background: var(--card-bg) !important; color: var(--card-color) !important; border: none !important; }
        .recharts-legend-item-text { color: var(--card-color) !important; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Fraunces:wght@400;700;800;900&display=swap" rel="stylesheet" />
      {/* Header + Tabs - single sticky block */}
      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 50, background: headerBg, color: "#fff" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: mob ? "6px 12px 0" : "10px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 12, marginBottom: 4 }}>
            <label style={{ cursor: "pointer", flexShrink: 0 }} title="Click to upload custom icon">
              {customIcon
                ? <img src={customIcon} style={{ width: mob ? 28 : 34, height: mob ? 28 : 34, borderRadius: 8, objectFit: "cover" }} />
                : <div style={{ width: mob ? 28 : 34, height: mob ? 28 : 34, borderRadius: 8, background: "linear-gradient(135deg,#E8573A,#F2A93B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: mob ? 14 : 18 }}>💰</div>}
              <input ref={iconRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setCustomIcon(ev.target.result); r.readAsDataURL(f); } }} style={{ display: "none" }} />
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingTitle
                ? <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
                    onBlur={() => { setAppTitle(titleDraft.trim() || appTitle); setEditingTitle(false); }}
                    onKeyDown={e => { if (e.key === "Enter") { setAppTitle(titleDraft.trim() || appTitle); setEditingTitle(false); } if (e.key === "Escape") setEditingTitle(false); }}
                    style={{ margin: 0, fontSize: mob ? 16 : 22, fontFamily: "'Fraunces',serif", fontWeight: 800, background: "transparent", border: "none", borderBottom: "2px solid #E8573A", color: "#fff", outline: "none", width: "100%" }} />
                : <h1 onClick={() => { setTitleDraft(appTitle); setEditingTitle(true); }} style={{ margin: 0, fontSize: mob ? 16 : 22, fontFamily: "'Fraunces',serif", fontWeight: 800, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="Click to rename">{appTitle}</h1>}
              {!mob && <p style={{ margin: 0, fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase" }}>{tax.year} Tax Year • {(tax.p1State || {}).name || "State"}</p>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setDarkMode("light")} style={{ padding: "5px 10px", background: !dk && !waf ? "#E8573A" : "rgba(255,255,255,0.1)", color: !dk && !waf ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>☀️</button>
              <button onClick={() => setDarkMode("dark")} style={{ padding: "5px 10px", background: dk ? "#F2A93B" : "rgba(255,255,255,0.1)", color: dk ? "#1a1a1a" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌙</button>
              <button onClick={() => setDarkMode("waf")} style={{ padding: "5px 10px", background: waf ? "#c96b70" : "rgba(255,255,255,0.1)", color: waf ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌸</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #444", overflowX: "auto" }}>
            <button style={ts(tab === "taxes")} onClick={() => setTab("taxes")}>Tax Rates</button>
            <button style={ts(tab === "settings")} onClick={() => setTab("settings")}>Income</button>
            <button style={ts(tab === "budget")} onClick={() => setTab("budget")}>Budget</button>
            <button style={ts(tab === "charts")} onClick={() => setTab("charts")}>Charts</button>
            <button style={ts(tab === "cats")} onClick={() => setTab("cats")}>Categories</button>
          </div>
        </div>
        {/* Banner + Toolbar - inside sticky header, only on budget tab */}
        {tab === "budget" && viewingSnap === null && <div style={{ maxWidth: 1100, margin: "0 auto", padding: "4px 12px 2px", background: dk ? "#1e1e1e" : waf ? "#d0ccc7" : "#ede7e0", borderTop: `1px solid ${dk ? "#333" : waf ? "#c0bbb5" : "#ddd"}` }}>
          <div onClick={() => setBannerOpen(p => !p)} style={{ cursor: "pointer" }}>
            {bannerOpen ? <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(7, 1fr)", gap: 6, textAlign: "center", padding: "8px 0" }}>
              {[["Net / Week", fmt(C.net), "#4ECDC4"], ["Net / Month", fmt(moC(C.net)), "#F2A93B"], ["Net / Year (48)", fmt(y4(C.net)), "#4ECDC4"], ["Net / Year (52)", fmt(y5(C.net)), "#888"], ["Bonus (net)", fmt(C.eaipNet), "#9B59B6"], ["Savings / Year", fmt(y5(tSavW) + Math.max(0, remY52)), "#2ECC71"], ["Savings + Bonus", fmt(y5(tSavW) + Math.max(0, remY52) + C.eaipNet), "#1ABC9C"]].map(([l, v, c]) => (
                <div key={l}><div style={{ fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: mob ? 12 : 15, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
              ))}
              {mob && <div style={{ gridColumn: "1/-1", fontSize: 9, color: "var(--tx3,#999)", textAlign: "center" }}>tap to collapse ▴</div>}
            </div> : <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#4ECDC4", fontFamily: "'Fraunces',serif" }}>Net: {fmt(C.net)}/wk</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>Savings: {fmt(y5(tSavW) + Math.max(0, remY52))}/yr</span>
              <span style={{ fontSize: 10, color: "var(--tx3,#999)" }}>▾</span>
            </div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", borderTop: "1px solid var(--bdr, #ddd)" }}>
            <span onClick={() => setToolbarOpen(p => !p)} style={{ fontSize: 10, fontWeight: 700, color: toolbarOpen ? "#556FB5" : "var(--tx3, #999)", textTransform: "uppercase", cursor: "pointer", padding: "4px 10px", border: `2px solid ${toolbarOpen ? "#556FB5" : "var(--bdr, #ccc)"}`, borderRadius: 6, background: toolbarOpen ? "#EEF1FA" : "transparent", userSelect: "none" }}>Tools {toolbarOpen ? "▴" : "▾"}</span>
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3, #999)", marginRight: 2 }}>Cols:</span>
              {[["wk", "Wk"], ["mo", "Mo"], ["y48", "Y48"], ["y52", "Y52"]].map(([k, lbl]) =>
                <button key={k} onClick={() => setVisCols(p => ({ ...p, [k]: !p[k] }))}
                  style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, border: visCols[k] ? "2px solid #556FB5" : "2px solid var(--bdr, #ccc)", borderRadius: 6, background: visCols[k] ? "#EEF1FA" : "transparent", color: visCols[k] ? "#556FB5" : "var(--tx3, #aaa)", cursor: "pointer" }}>{lbl}</button>
              )}
            </div>
          </div>
          {toolbarOpen && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 0", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase" }}>Sort:</span>
              {[["default", "Default"], ["amount", "Amount"], ["category", "Category"]].map(([v, l]) => (
                <button key={v} onClick={() => { if (sortBy === v && v === "amount") setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortBy(v); if (v === "amount") setSortDir("desc"); } }}
                  style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: sortBy === v ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: sortBy === v ? "#EEF1FA" : "var(--input-bg, #fafafa)", color: sortBy === v ? "#556FB5" : "var(--tx3, #888)", cursor: "pointer" }}>
                  {l}{sortBy === v && v === "amount" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)" }}>Highlight &gt;</span>
              <NI value={hlThresh} onChange={v => setHlThresh(v)} prefix="$" style={{ width: 90, height: 30 }} />
              <select value={hlPeriod} onChange={e => setHlPeriod(e.target.value)} style={{ fontSize: 11, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, padding: "4px 6px", background: "var(--input-bg, #fafafa)", cursor: "pointer" }}>
                <option value="w">/wk</option><option value="m">/mo</option><option value="y">/yr</option>
              </select>
            </div>
            <button onClick={() => setShowPerPerson(p => !p)} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: showPerPerson ? "2px solid #4ECDC4" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: showPerPerson ? "#E8F8F5" : "var(--input-bg, #fafafa)", color: showPerPerson ? "#4ECDC4" : "var(--tx3, #888)", cursor: "pointer" }}>
              {showPerPerson ? "Hide" : "Show"} Per-Person
            </button>
            {isMixed ? <>
              <button onClick={expandAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, background: "var(--input-bg, #fafafa)", color: "var(--tx3, #888)", cursor: "pointer" }}>
                Expand All
              </button>
              <button onClick={collapseAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, background: "var(--input-bg, #fafafa)", color: "var(--tx3, #888)", cursor: "pointer" }}>
                Collapse All
              </button>
            </> : <button onClick={toggleAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, background: "var(--input-bg, #fafafa)", color: "var(--tx3, #888)", cursor: "pointer" }}>
              {allExpanded ? "Collapse All" : "Expand All"}
            </button>}
            <button onClick={() => setShowAddItem(true)} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #E8573A", borderRadius: 6, background: "#fef5f2", color: "#E8573A", cursor: "pointer" }}>
              + Add Item
            </button>
            <button onClick={() => { setBulkTargets({ current: true }); setBulkName(""); setBulkVal(""); setBulkCat(cats[0]); setShowBulkAdd(true); }} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #9B59B6", borderRadius: 6, background: "#F3E8FF", color: "#9B59B6", cursor: "pointer" }}>
              + Add to Multiple
            </button>
          </div>}
        </div>}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: mob ? "12px 10px 60px" : "24px 20px 60px" }}>

        {/* ═══ TAX RATES ═══ */}
        {tab === "taxes" && (
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, maxWidth: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            <Card>
              <h3 style={{ margin: "0 0 4px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Payroll & State Rates</h3>
              <p style={{ fontSize: 12, color: "#999", margin: "0 0 16px" }}>Update when rates change each year.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Tax Year</label><input value={tax.year} onChange={e => upTax("year", e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>401(k) Base Limit</label><NI value={tax.k401Lim} onChange={v => upTax("k401Lim", +v || 0)} prefix="$" /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} State</label><input list="state-names" value={(tax.p1State || {}).name || ""} onChange={e => upP1State("name", e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /><datalist id="state-names">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} State</label><input list="state-names-2" value={(tax.p2State || {}).name || ""} onChange={e => upP2State("name", e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /><datalist id="state-names-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                <div style={{ gridColumn: "1/-1", padding: "10px 12px", background: "var(--input-bg, #f4f4f4)", borderRadius: 8, fontSize: 11, color: "var(--tx2, #555)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Calculated Rates ({tax.year})</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    <div>{p1Name} ({(tax.p1State || {}).abbr || "ST"}): <strong>{fmt(C.cCO * 52)}/yr</strong> — marginal {(C.cStMR * 100).toFixed(1)}%</div>
                    <div>{p2Name} ({(tax.p2State || {}).abbr || "ST"}): <strong>{fmt(C.kCO * 52)}/yr</strong> — marginal {(C.kStMR * 100).toFixed(1)}%</div>
                    <div>{p1Name} Payroll Tax: <strong>{p2((tax.p1State || {}).famli || 0)}</strong> ({fmt(C.cFL * 52)}/yr)</div>
                    <div>{p2Name} Payroll Tax: <strong>{p2((tax.p2State || {}).famli || 0)}</strong> ({fmt(C.kFL * 52)}/yr)</div>
                    <div>OASDI: <strong>{p2(tax.ssRate)}</strong> — SS Cap: <strong>{fmt(tax.ssCap)}</strong></div>
                    <div>Medicare: <strong>{p2(tax.medRate)}</strong></div>
                    <div>Std Ded (Single): <strong>{fmt(tax.stdSingle)}</strong></div>
                    <div>Std Ded (MFJ): <strong>{fmt(tax.stdMFJ)}</strong></div>
                    <div>401(k) Limit: <strong>{fmt(tax.k401Lim)}</strong></div>
                    <div>HSA Limit: <strong>{fmt(tax.hsaLimit)}</strong></div>
                  </div>
                </div>
              </div>
              <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>{p1Name} — Employer Match</h4>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Base: <input type="number" value={tax.cMatchBase || 0} onChange={e => upTax("cMatchBase", +e.target.value || 0)} style={{ width: 40, border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "center" }} />%</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>Up to EE %</span><span>Match rate</span><span /></div>
              {(tax.cMatchTiers || []).map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, marginBottom: 2 }}>
                  <input type="number" value={t.upTo} onChange={e => { const n = [...(tax.cMatchTiers || [])]; n[i] = { ...n[i], upTo: +e.target.value }; upTax("cMatchTiers", n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                  <input type="number" step="0.1" value={t.rate} onChange={e => { const n = [...(tax.cMatchTiers || [])]; n[i] = { ...n[i], rate: +e.target.value }; upTax("cMatchTiers", n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                  <button onClick={() => upTax("cMatchTiers", (tax.cMatchTiers || []).filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                </div>
              ))}
              <button onClick={() => upTax("cMatchTiers", [...(tax.cMatchTiers || []), { upTo: 10, rate: 0.5 }])} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Tier</button>

              <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>{p2Name} — Employer Match</h4>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Base: <input type="number" value={tax.kMatchBase || 0} onChange={e => upTax("kMatchBase", +e.target.value || 0)} style={{ width: 40, border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "center" }} />%</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>Up to EE %</span><span>Match rate</span><span /></div>
              {(tax.kMatchTiers || []).map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, marginBottom: 2 }}>
                  <input type="number" value={t.upTo} onChange={e => { const n = [...(tax.kMatchTiers || [])]; n[i] = { ...n[i], upTo: +e.target.value }; upTax("kMatchTiers", n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                  <input type="number" step="0.1" value={t.rate} onChange={e => { const n = [...(tax.kMatchTiers || [])]; n[i] = { ...n[i], rate: +e.target.value }; upTax("kMatchTiers", n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                  <button onClick={() => upTax("kMatchTiers", (tax.kMatchTiers || []).filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                </div>
              ))}
              <button onClick={() => upTax("kMatchTiers", [...(tax.kMatchTiers || []), { upTo: 10, rate: 0.5 }])} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Tier</button>
              <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>HSA</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Annual Limit</label><NI value={tax.hsaLimit} onChange={v => upTax("hsaLimit", +v || 0)} prefix="$" /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Employer Annual Match</label><NI value={tax.hsaEmployerMatch} onChange={v => upTax("hsaEmployerMatch", +v || 0)} prefix="$" /></div>
              </div>
              <div style={{ marginTop: 20, padding: 16, background: "var(--input-bg, #f8f8f8)", borderRadius: 10 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Load Tax Year</h4>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <select value={tax.year} onChange={e => loadTaxYear(e.target.value)} style={{ border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: "pointer", minWidth: 90 }}>
                    {Object.keys(allTaxDB).sort((a, b) => b - a).map(yr => <option key={yr} value={yr}>{yr}</option>)}
                  </select>
                  <button onClick={() => setShowTaxPaste(p => !p)} style={{ padding: "8px 16px", fontSize: 12, border: "none", borderRadius: 8, background: "#556FB5", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                    + Add New Year
                  </button>
                  <button onClick={() => setTax(prev => ({ ...DEF_TAX, year: prev.year, p1State: prev.p1State, p2State: prev.p2State, cMatchTiers: prev.cMatchTiers, cMatchBase: prev.cMatchBase, kMatchTiers: prev.kMatchTiers, kMatchBase: prev.kMatchBase, hsaEmployerMatch: prev.hsaEmployerMatch }))} style={{ padding: "8px 16px", fontSize: 12, border: "2px solid #E8573A", borderRadius: 8, background: "none", color: "#E8573A", fontWeight: 600, cursor: "pointer" }}>Reset {tax.year}</button>
                </div>
                <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>
                  {Object.keys(allTaxDB).length} years available (1996–{Object.keys(allTaxDB).sort((a, b) => b - a)[0]}). State rates are always preserved when switching years.
                </div>
                {showTaxPaste && <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--input-border, #ddd)", borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Add a new tax year</div>
                  <div style={{ fontSize: 11, color: "var(--tx3, #999)", marginBottom: 8 }}>
                    Paste JSON from Claude. Use the prompt below to get the right format.
                  </div>
                  <textarea value={taxPaste} onChange={e => setTaxPaste(e.target.value)} placeholder='{"year":"2027","fedSingle":[[0,12500,0.10],...], ...}' rows={5} style={{ width: "100%", border: "1px solid var(--input-border, #ddd)", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button onClick={() => addTaxYear(taxPaste)} disabled={!taxPaste.trim()} style={{ padding: "6px 14px", fontSize: 12, border: "none", borderRadius: 6, background: taxPaste.trim() ? "#2ECC71" : "#ccc", color: "#fff", fontWeight: 700, cursor: taxPaste.trim() ? "pointer" : "default" }}>Add & Load</button>
                    <button onClick={() => { setShowTaxPaste(false); setTaxPaste(""); }} style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #ddd", borderRadius: 6, background: "none", color: "#888", cursor: "pointer" }}>Cancel</button>
                    <button onClick={() => { navigator.clipboard.writeText('Give me the US federal tax rates for tax year [YEAR] formatted exactly like this JSON. Replace ALL values with the correct [YEAR] values, keep the structure, return ONLY the JSON with no markdown or explanation:\n\n{"year":"[YEAR]","fedSingle":[[0,12400,0.10],[12400,50400,0.12],[50400,105700,0.22],[105700,201775,0.24],[201775,256225,0.32],[256225,640600,0.35],[640600,9999999,0.37]],"fedMFJ":[[0,24800,0.10],[24800,100800,0.12],[100800,211400,0.22],[211400,403550,0.24],[403550,512450,0.32],[512450,768700,0.35],[768700,9999999,0.37]],"stdSingle":16100,"stdMFJ":32200,"ssRate":6.2,"ssCap":184500,"medRate":1.45,"k401Lim":24500,"hsaLimit":8300}\n\nFields: fedSingle/fedMFJ = federal income tax brackets [from,to,rate]. stdSingle/stdMFJ = standard deductions. ssRate = OASDI employee rate %. ssCap = Social Security wage cap. medRate = Medicare employee rate %. k401Lim = 401(k) elective deferral limit (not catch-up). hsaLimit = HSA family contribution limit.'); setFetchStatus("📋 Prompt copied! Paste it in a new Claude chat, replace [YEAR], and paste the result back here."); }} style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #556FB5", borderRadius: 6, background: "none", color: "#556FB5", fontWeight: 600, cursor: "pointer" }}>Copy Prompt</button>
                  </div>
                </div>}
                {fetchStatus && <div style={{ fontSize: 12, marginTop: 8, color: fetchStatus.startsWith("✅") ? "#2ECC71" : fetchStatus.startsWith("❌") ? "#E8573A" : "#556FB5", wordBreak: "break-word" }}>{fetchStatus}</div>}
              </div>
            </Card>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
              <Card><h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Federal — Single / MFS</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span></div>
                {tax.fedSingle.map((b, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, marginBottom: 2, fontSize: 11, color: "var(--tx2,#555)" }}><span>{fmt(b[0])}</span><span>{b[1] >= 9999999 ? "∞" : fmt(b[1])}</span><span style={{ fontWeight: 600 }}>{(b[2] * 100).toFixed(2)}%</span></div>))}
              </Card>
              <Card><h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Federal — MFJ</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span></div>
                {tax.fedMFJ.map((b, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, marginBottom: 2, fontSize: 11, color: "var(--tx2,#555)" }}><span>{fmt(b[0])}</span><span>{b[1] >= 9999999 ? "∞" : fmt(b[1])}</span><span style={{ fontWeight: 600 }}>{(b[2] * 100).toFixed(2)}%</span></div>))}
              </Card>
              {(tax.p1State || {}).abbr && STATE_BRACKETS[(tax.p1State || {}).abbr] && <StateBrView abbr={(tax.p1State).abbr} filing={fil} label={`${(tax.p1State).name || (tax.p1State).abbr} — ${p1Name} (${fil === "mfj" ? "MFJ" : "Single"})`} />}
              {(tax.p2State || {}).abbr && STATE_BRACKETS[(tax.p2State || {}).abbr] && <StateBrView abbr={(tax.p2State).abbr} filing={fil} label={`${(tax.p2State).name || (tax.p2State).abbr} — ${p2Name} (${fil === "mfj" ? "MFJ" : "Single"})`} />}
            </div>
            <Card dark style={{ gridColumn: mob ? "1" : "1/-1" }}>
              <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Active Summary</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, fontSize: 13 }}>
                {[["Fed Marginal", fp(C.mr)], ["Std Deduction", fmt(C.sd)], ["OASDI", `${p2(tax.ssRate)} to ${fmt(tax.ssCap)}`], ["Medicare", p2(tax.medRate)], [`${(tax.p1State || {}).abbr || "ST"} ${p1Name}`, `${C.cStMR ? (C.cStMR * 100).toFixed(1) : "0"}% marginal`], [`${(tax.p2State || {}).abbr || "ST"} ${p2Name}`, `${C.kStMR ? (C.kStMR * 100).toFixed(1) : "0"}% marginal`], [`401k ${p1Name}`, fmt(tax.k401Lim + (tax.c401Catch || 0))], [`401k ${p2Name}`, fmt(tax.k401Lim + (tax.k401Catch || 0))], ["HSA Limit", fmt(tax.hsaLimit)]].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                    <span style={{ color: "#aaa" }}>{l}</span><span style={{ color: "#4ECDC4", fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ═══ INCOME ═══ */}
        {tab === "settings" && (
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Income</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Person 1 Name</label><input value={p1Name} onChange={e => setP1Name(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Person 2 Name</label><input value={p2Name} onChange={e => setP2Name(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} Salary</label><NI value={cSal} onChange={setCS} prefix="$" /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} Salary</label><NI value={kSal} onChange={setKS} prefix="$" /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} Bonus %</label><PI value={cEaip} onChange={setCE} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} Bonus %</label><PI value={kEaip} onChange={setKE} /></div>
                </div>
                <div style={{ marginTop: 12 }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Filing Status</label>
                  <select value={fil} onChange={e => setFil(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa" }}><option value="mfj">Married Filing Jointly</option><option value="single">Single / MFS</option></select></div>
              </Card>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>401(k) Contributions</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#556FB5" }}>Pre-Tax 401(k)</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } %</label><PI value={c4pre} onChange={setC4pre} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } %</label><PI value={k4pre} onChange={setK4pre} /></div>
                  <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4, marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#E8573A" }}>Roth 401(k)</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } %</label><PI value={c4ro} onChange={setC4ro} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } %</label><PI value={k4ro} onChange={setK4ro} /></div>
                  <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4, marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#F2A93B" }}>Catch-Up (age 50+)</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } Catch-Up</label><NI value={tax.c401Catch} onChange={v => upTax("c401Catch", +v || 0)} prefix="$" />
                    <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                      <button onClick={() => upTax("c401CatchPreTax", true)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.c401CatchPreTax !== false) ? "2px solid #556FB5" : "2px solid #ddd", borderRadius: 4, background: (tax.c401CatchPreTax !== false) ? "#EEF1FA" : "transparent", color: (tax.c401CatchPreTax !== false) ? "#556FB5" : "#aaa", cursor: "pointer" }}>Pre-Tax</button>
                      <button onClick={() => upTax("c401CatchPreTax", false)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.c401CatchPreTax === false) ? "2px solid #E8573A" : "2px solid #ddd", borderRadius: 4, background: (tax.c401CatchPreTax === false) ? "#fef5f2" : "transparent", color: (tax.c401CatchPreTax === false) ? "#E8573A" : "#aaa", cursor: "pointer" }}>Roth</button>
                    </div>
                  </div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } Catch-Up</label><NI value={tax.k401Catch} onChange={v => upTax("k401Catch", +v || 0)} prefix="$" />
                    <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                      <button onClick={() => upTax("k401CatchPreTax", true)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.k401CatchPreTax !== false) ? "2px solid #556FB5" : "2px solid #ddd", borderRadius: 4, background: (tax.k401CatchPreTax !== false) ? "#EEF1FA" : "transparent", color: (tax.k401CatchPreTax !== false) ? "#556FB5" : "#aaa", cursor: "pointer" }}>Pre-Tax</button>
                      <button onClick={() => upTax("k401CatchPreTax", false)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.k401CatchPreTax === false) ? "2px solid #E8573A" : "2px solid #ddd", borderRadius: 4, background: (tax.k401CatchPreTax === false) ? "#fef5f2" : "transparent", color: (tax.k401CatchPreTax === false) ? "#E8573A" : "#aaa", cursor: "pointer" }}>Roth</button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><span style={{ color: "#999" }}>{p1Name} limit:</span> <strong>{fmt(tax.k401Lim + (tax.c401Catch || 0))}</strong>/yr</div>
                    <div><span style={{ color: "#999" }}>{p2Name} limit:</span> <strong>{fmt(tax.k401Lim + (tax.k401Catch || 0))}</strong>/yr</div>
                    <div><span style={{ color: "#999" }}>{p1Name} total:</span> <strong>{evalF(c4pre) + evalF(c4ro)}%</strong> ({fmt(C.c4w * 52)}/yr)</div>
                    <div><span style={{ color: "#999" }}>{p2Name} total:</span> <strong>{evalF(k4pre) + evalF(k4ro)}%</strong> ({fmt(C.k4w * 52)}/yr)</div>
                    <div><span style={{ color: "#999" }}>{p1Name} employer:</span> <strong>{C.cMP.toFixed(2)}%</strong> ({fmt(C.cs * C.cMP / 100)}/yr)</div>
                    <div><span style={{ color: "#999" }}>{p2Name} employer:</span> <strong>{C.kMP.toFixed(2)}%</strong> ({fmt(C.ks * C.kMP / 100)}/yr)</div>
                  </div>
                </div>
              </Card>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>HSA (Annual)</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } Annual</label><NI value={cHsaAnn} onChange={setCHsaAnn} prefix="$" /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } Annual</label><NI value={kHsaAnn} onChange={setKHsaAnn} prefix="$" /></div>
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>Limit: {fmt(tax.hsaLimit)}/yr. Employer match: {fmt(tax.hsaEmployerMatch)}/yr. This auto-populates the HSA row in pre-tax deductions ({fmt(evalF(cHsaAnn) / 52)}/wk + {fmt(evalF(kHsaAnn) / 52)}/wk).</div>
              </Card>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <DedEditor items={preDed} setItems={setPreDed} label="Pre-Tax Deductions" />
              <DedEditor items={postDed} setItems={setPostDed} label="Post-Tax Deductions" />
            </div>
          </div>
        )}

        {/* ═══ CATEGORIES ═══ */}
        {tab === "cats" && (
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
            <Card>
              <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#E8573A" }}>Expense Categories</h3>
              {cats.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <input value={c} onChange={e => { const n = [...cats]; n[i] = e.target.value; setCats(n); }} style={{ flex: 1, border: "2px solid #f5d5ce", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#fef5f2" }} />
                  <button onClick={() => setCats(cats.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New expense category..." onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(""); } }} style={{ flex: 1, border: "2px solid #f5d5ce", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#fef5f2" }} />
                <button onClick={() => { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(""); } }} style={{ padding: "8px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
              </div>
            </Card>
            <Card>
              <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#2ECC71" }}>Savings Categories</h3>
              {savCats.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <input value={c} onChange={e => { const n = [...savCats]; n[i] = e.target.value; setSavCats(n); }} style={{ flex: 1, border: "2px solid #d5f5e3", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#f0faf5" }} />
                  <button onClick={() => setSavCats(savCats.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input id="newSavCat" placeholder="New savings category..." onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { setSavCats([...savCats, e.target.value.trim()]); e.target.value = ""; } }} style={{ flex: 1, border: "2px solid #d5f5e3", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#f0faf5" }} />
                <button onClick={() => { const el = document.getElementById("newSavCat"); if (el?.value.trim()) { setSavCats([...savCats, el.value.trim()]); el.value = ""; } }} style={{ padding: "8px 18px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
              </div>
            </Card>
          </div>
        )}

        {/* ═══ BUDGET ═══ */}
        {tab === "budget" && viewingSnap !== null && snapshots[viewingSnap] && (() => {
          const snap = snapshots[viewingSnap];
          const items = snap.items || {};
          const necItems = Object.entries(items).filter(([, d]) => d.t === "N").sort((a, b) => a[0].localeCompare(b[0]));
          const disItems = Object.entries(items).filter(([, d]) => d.t === "D").sort((a, b) => a[0].localeCompare(b[0]));
          const savItems = Object.entries(items).filter(([, d]) => d.t === "S").sort((a, b) => a[0].localeCompare(b[0]));
          const necT = necItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const disT = disItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const savT = savItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const expT = necT + disT;

          // Salary-based tax calc for snapshot — includes deductions from fullState
          const snapCS = snap.cSalary !== undefined ? snap.cSalary : (snap.cGrossW || 0) * 52;
          const snapKS = snap.kSalary !== undefined ? snap.kSalary : (snap.kGrossW || 0) * 52;
          const snapYr = snap.date ? snap.date.slice(0, 4) : tax.year;
          const snapTaxData = allTaxDB[snapYr] || allTaxDB[tax.year] || TAX_DB["2026"];
          const snapFil = snap.fil || fil;
          const snapP1s = snap.p1State || (tax.p1State || {});
          const snapP2s = snap.p2State || (tax.p2State || {});
          const scw = snapCS / 52, skw = snapKS / 52;
          // Deductions from fullState
          const sFS = snap.fullState || {};
          const sPreDed = sFS.preDed || [];
          const sPostDed = sFS.postDed || [];
          const scPreW = sPreDed.reduce((s, d) => s + evalF(d.c), 0);
          const skPreW = sPreDed.reduce((s, d) => s + evalF(d.k), 0);
          const sc4preW = snapCS * Math.min(evalF(sFS.c4pre || 0) / 100, 1) / 52;
          const sc4roW = snapCS * Math.min(evalF(sFS.c4ro || 0) / 100, 1) / 52;
          const sk4preW = snapKS * Math.min(evalF(sFS.k4pre || 0) / 100, 1) / 52;
          const sk4roW = snapKS * Math.min(evalF(sFS.k4ro || 0) / 100, 1) / 52;
          const scTxW = scw - scPreW - sc4preW, skTxW = skw - skPreW - sk4preW;
          const sBr = snapFil === "mfj" ? snapTaxData.fedMFJ : snapTaxData.fedSingle;
          const sSd = snapFil === "mfj" ? snapTaxData.stdMFJ : snapTaxData.stdSingle;
          const sCombTxA = (scTxW + skTxW) * 52;
          const sFedTax = snapFil === "mfj" ? calcFed(Math.max(0, sCombTxA - sSd), sBr) : calcFed(Math.max(0, scTxW * 52 - snapTaxData.stdSingle), snapTaxData.fedSingle) + calcFed(Math.max(0, skTxW * 52 - snapTaxData.stdSingle), snapTaxData.fedSingle);
          const sSsR = snapTaxData.ssRate / 100, sMedR = snapTaxData.medRate / 100;
          const sTot = scTxW + skTxW, sCr = sTot > 0 ? scTxW / sTot : 0.5;
          const scFed = (sFedTax / 52) * sCr, skFed = (sFedTax / 52) * (1 - sCr);
          const scSS = Math.min(scw, snapTaxData.ssCap / 52) * sSsR, skSS = Math.min(skw, snapTaxData.ssCap / 52) * sSsR;
          const scMc = scw * sMedR, skMc = skw * sMedR;
          const scSt = calcStateTax(scTxW * 52, snapP1s.abbr || "", snapFil) / 52;
          const skSt = calcStateTax(skTxW * 52, snapP2s.abbr || "", snapFil) / 52;
          const scFL = scw * (snapP1s.famli || 0) / 100, skFL = skw * (snapP2s.famli || 0) / 100;
          const scPostW = sPostDed.reduce((s, d) => s + evalF(d.c), 0);
          const skPostW = sPostDed.reduce((s, d) => s + evalF(d.k), 0);
          const scNet = scw - scPreW - sc4preW - sc4roW - scFed - scSS - scMc - scSt - scFL - scPostW;
          const skNet = skw - skPreW - sk4preW - sk4roW - skFed - skSS - skMc - skSt - skFL - skPostW;
          const snapNetW = scNet + skNet;
          const netY = snapNetW * 48;
          const remY = netY - expT - savT;
          const cNetY = scNet * 48, kNetY = skNet * 48;

          const upSnap = (field, val) => { const n = [...snapshots]; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], [field]: val }); setSnapshots(n); };
          const renameSnapItem = (oldName, newName) => { if (oldName === newName || !newName.trim()) return; const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; it[newName.trim()] = it[oldName]; delete it[oldName]; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it }); setSnapshots(n); };
          const upSnapItem = (name, field, val) => { const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; it[name] = { ...it[name], [field]: val }; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it }); setSnapshots(n); };
          const upSnapVal = (name, rawVal, period) => {
            let yearly = +rawVal || 0;
            if (period === "w") yearly = yearly * 48;
            else if (period === "m") yearly = yearly * 12;
            upSnapItem(name, "v", Math.round(yearly * 100) / 100);
          };
          const rmSnapItem = (name) => { const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; delete it[name]; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it }); setSnapshots(n); };
          const addSnapItem = (type) => {
            const newName = type === "S" ? "New Savings Item" : "New Expense Item";
            let finalName = newName;
            const existing = snap.items || {};
            let counter = 1;
            while (existing[finalName]) { finalName = `${newName} ${counter++}`; }
            const n = [...snapshots];
            const it = { ...(n[viewingSnap].items || {}), [finalName]: { v: 0, t: type, c: "" } };
            n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it });
            setSnapshots(n);
          };
          const SnapItemRow = ({ name, data }) => {
            const yr = data.v || 0, wk = yr / 48, mo = yr / 12;
            const [editPer, setEditPer] = useState(null);
            const allCats = [...cats, ...savCats.filter(sc => !cats.includes(sc))];
            const valFor = p => p === "w" ? wk : p === "m" ? mo : yr;
            const saveEditVal = (v, per) => {
              let yearly = evalF(v);
              if (per === "w") yearly = yearly * 48;
              else if (per === "m") yearly = yearly * 12;
              upSnapItem(name, "v", Math.round(yearly * 100) / 100);
              setEditPer(null);
            };
            const svc = snapVisCols;
            const snapItemCols = ["50px", "1.6fr", "90px", svc.wk && "1fr", svc.mo && "1fr", svc.y48 && "1fr", svc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
            const periods = [svc.wk && "w", svc.mo && "m", svc.y48 && "y"].filter(Boolean);
            return (
              <div style={{ display: "grid", gridTemplateColumns: snapItemCols, gap: 4, padding: "3px 0", alignItems: "center", fontSize: 12 }}>
                <select value={data.t || "N"} onChange={e => upSnapItem(name, "t", e.target.value)} style={{ fontSize: 9, color: "#fff", fontWeight: 700, border: "none", borderRadius: 5, padding: "3px 4px", background: data.t === "N" ? "#556FB5" : data.t === "D" ? "#E8573A" : "#2ECC71", cursor: "pointer" }}>
                  <option value="N">NEC</option><option value="D">DIS</option><option value="S">SAV</option>
                </select>
                <EditTxt value={name} onChange={v => renameSnapItem(name, v)} />
                <select value={data.c || ""} onChange={e => upSnapItem(name, "c", e.target.value)} style={{ fontSize: 10, border: "1px solid #ddd", borderRadius: 4, padding: "2px 3px" }}>
                  <option value="">—</option>
                  {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {periods.map(per => {
                  if (editPer === per) {
                    return <div key={per}><NI value={String(Math.round(valFor(per) * 100) / 100)} onChange={(v) => saveEditVal(v, per)} autoFocus onBlurResolve prefix="$" style={{ height: 28 }} /></div>;
                  }
                  return <div key={per} onClick={() => setEditPer(per)} style={{ textAlign: "right", color: "var(--tx2,#555)", cursor: "text", padding: "4px 2px", borderRadius: 4, fontSize: 11 }}>{fmt(valFor(per))}</div>;
                })}
                {svc.y52 && <div style={{ textAlign: "right", color: "var(--tx3,#888)", fontSize: 11 }}>{fmt(yr)}</div>}
                <button onClick={() => rmSnapItem(name)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
              </div>
            );
          };
          // Build sorted snapshot indices for paging
          const sortedSnapIdx = snapshots.map((s, i) => ({ i, date: s.date || "" })).sort((a, b) => a.date.localeCompare(b.date));
          const curPosInSorted = sortedSnapIdx.findIndex(x => x.i === viewingSnap);
          const prevSnapIdx = curPosInSorted > 0 ? sortedSnapIdx[curPosInSorted - 1].i : null;
          const nextSnapIdx = curPosInSorted < sortedSnapIdx.length - 1 ? sortedSnapIdx[curPosInSorted + 1].i : null;
          return (
            <div>
              <div style={{ background: "#556FB5", color: "#fff", padding: "12px 20px", borderRadius: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, fontFamily: "'Fraunces',serif", flexShrink: 0 }}>Snapshot:</span>
                  <input type="date" value={snap.date || ""} onChange={e => upSnap("date", e.target.value)} style={{ border: "none", borderBottom: "2px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, fontFamily: "'DM Sans',sans-serif", padding: "2px 4px", outline: "none" }} />
                  <input value={snap.label || ""} onChange={e => upSnap("label", e.target.value)} style={{ border: "none", borderBottom: "2px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, fontFamily: "'DM Sans',sans-serif", padding: "2px 4px", outline: "none", flex: 1, minWidth: 120 }} />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button disabled={prevSnapIdx === null} onClick={() => prevSnapIdx !== null && setViewingSnap(prevSnapIdx)} style={{ padding: "6px 10px", background: prevSnapIdx !== null ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", color: prevSnapIdx !== null ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: prevSnapIdx !== null ? "pointer" : "default" }}>◀</button>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", minWidth: 40, textAlign: "center" }}>{curPosInSorted + 1}/{sortedSnapIdx.length}</span>
                  <button disabled={nextSnapIdx === null} onClick={() => nextSnapIdx !== null && setViewingSnap(nextSnapIdx)} style={{ padding: "6px 10px", background: nextSnapIdx !== null ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", color: nextSnapIdx !== null ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: nextSnapIdx !== null ? "pointer" : "default" }}>▶</button>
                  <button onClick={() => setRestoreConfirm(viewingSnap)} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Restore This</button>
                  <button onClick={() => { const clone = JSON.parse(JSON.stringify(snap)); clone.id = Date.now(); clone.label = (clone.label || "Snapshot") + " (copy)"; setSnapshots(prev => { const n = [...prev, clone].sort((a, b) => (a.date || "").localeCompare(b.date || "")); const newIdx = n.findIndex(s => s.id === clone.id); setViewingSnap(newIdx); return n; }); }} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#4ECDC4", border: "1px solid #4ECDC4", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⧉ Clone</button>
                  <button onClick={() => setViewingSnap(null)} style={{ padding: "6px 14px", background: "#fff", color: "#556FB5", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Back to Current</button>
                </div>
              </div>
              {/* Snapshot sub-tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
                {[["budget", "Budget"], ["deductions", "Deductions"], ["tax", "Tax"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSnapTab(k)} style={{ padding: "8px 18px", border: snapTab === k ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 8, background: snapTab === k ? "#EEF1FA" : "transparent", color: snapTab === k ? "#556FB5" : "var(--tx3, #888)", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>{l}</button>
                ))}
              </div>
              {snapTab === "budget" && <>
              <VisColsCtx.Provider value={{ wk: snapVisCols.wk, mo: snapVisCols.mo, y48: snapVisCols.y48, y52: snapVisCols.y52 }}>
              <Card dark style={{ marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, textAlign: "center" }}>
                  {[["Net Income (yr)", fmt(netY), "#4ECDC4"], ["Necessity (yr)", fmt(necT), "#556FB5"], ["Discretionary (yr)", fmt(disT), "#E8573A"], ["Savings (yr)", fmt(savT), "#2ECC71"], ["Remaining (yr)", fmt(remY), remY >= 0 ? "#2ECC71" : "#E74C3C"]].map(([l, v, c]) => (
                    <div key={l}><div style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#aaa", textAlign: "center" }}>{p1Name}: {fmt(cNetY)}/yr • {p2Name}: {fmt(kNetY)}/yr • Tax Year: {snapYr}</div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p1Name} Annual Salary</label>
                    <NI value={String(Math.round(snapCS))} onChange={v => upSnap("cSalary", evalF(v))} onBlurResolve prefix="$" style={{ height: 32, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)" }} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p2Name} Annual Salary</label>
                    <NI value={String(Math.round(snapKS))} onChange={v => upSnap("kSalary", evalF(v))} onBlurResolve prefix="$" style={{ height: 32, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)" }} /></div>
                </div>
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#9B59B6" }}>{p1Name} Bonus %</label>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                      <input type="number" step="0.1" value={snap.cEaipPct !== undefined ? snap.cEaipPct : (snap.fullState?.cEaip !== undefined ? evalF(snap.fullState.cEaip) : 0)} onChange={e => upSnap("cEaipPct", +e.target.value || 0)} style={{ flex: 1, border: "none", outline: "none", padding: "6px 8px", fontSize: 12, background: "transparent", color: "#fff", width: "100%", textAlign: "right" }} />
                      <span style={{ padding: "0 8px 0 2px", color: "#aaa", fontWeight: 600, fontSize: 12 }}>%</span>
                    </div></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#9B59B6" }}>{p2Name} Bonus %</label>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                      <input type="number" step="0.1" value={snap.kEaipPct !== undefined ? snap.kEaipPct : (snap.fullState?.kEaip !== undefined ? evalF(snap.fullState.kEaip) : 0)} onChange={e => upSnap("kEaipPct", +e.target.value || 0)} style={{ flex: 1, border: "none", outline: "none", padding: "6px 8px", fontSize: 12, background: "transparent", color: "#fff", width: "100%", textAlign: "right" }} />
                      <span style={{ padding: "0 8px 0 2px", color: "#aaa", fontWeight: 600, fontSize: 12 }}>%</span>
                    </div></div>
                </div>
                {(snap.eaipNet > 0 || snap.eaipGross > 0) && <div style={{ marginTop: 6, fontSize: 10, color: "#9B59B6", textAlign: "center" }}>Bonus net: {fmt(snap.eaipNet || 0)} ({p1Name}: {fmt(snap.cEaipNet || 0)} • {p2Name}: {fmt(snap.kEaipNet || 0)})</div>}
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p1Name} State</label>
                    <input list="snap-state-names" value={snapP1s.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; upSnap("p1State", { ...snapP1s, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /><datalist id="snap-state-names">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p2Name} State</label>
                    <input list="snap-state-names-2" value={snapP2s.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; upSnap("p2State", { ...snapP2s, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /><datalist id="snap-state-names-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "#777", textAlign: "center" }}>Taxes auto-calculated from {snapYr} rates • Combined gross: {fmt(snapCS + snapKS)}/yr</div>
              </Card>
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#999" }}>Columns:</span>
                  {[["wk", "Wk"], ["mo", "Mo"], ["y48", "Y×48"], ["y52", "Y×52"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSnapVisCols(p => ({ ...p, [k]: !p[k] }))} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: snapVisCols[k] ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 5, background: snapVisCols[k] ? "#EEF1FA" : "transparent", color: snapVisCols[k] ? "#556FB5" : "var(--tx3, #888)", cursor: "pointer" }}>{l}</button>
                  ))}
                </div>
                {(() => {
                  const svc = snapVisCols;
                  const snapCols = ["50px", "1.6fr", "90px", svc.wk && "1fr", svc.mo && "1fr", svc.y48 && "1fr", svc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
                  return <>
                <div style={{ display: "grid", gridTemplateColumns: snapCols, gap: 4, padding: "6px 0", borderBottom: "2px solid #d0cdc8", fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase" }}>
                  <span>Type</span><span>Name</span><span>Category</span>{svc.wk && <span style={{ textAlign: "right" }}>Weekly</span>}{svc.mo && <span style={{ textAlign: "right" }}>Monthly</span>}{svc.y48 && <span style={{ textAlign: "right" }}>Yearly (48)</span>}{svc.y52 && <span style={{ textAlign: "right" }}>Yearly (52)</span>}<span />
                </div>
                {necItems.length > 0 && <SH color="var(--c-taxable, #556FB5)">Necessity</SH>}
                {necItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {necItems.length > 0 && <Row label="Subtotal — Necessity" wk={necT / 48} mo={necT / 12} y48={necT} y52={necT} bold border color="var(--c-taxable, #556FB5)" />}
                <button onClick={() => addSnapItem("N")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Necessity</button>
                {disItems.length > 0 && <SH color="var(--c-totaltax, #E8573A)">Discretionary</SH>}
                {disItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {disItems.length > 0 && <Row label="Subtotal — Discretionary" wk={disT / 48} mo={disT / 12} y48={disT} y52={disT} bold border color="var(--c-totaltax, #E8573A)" />}
                <button onClick={() => addSnapItem("D")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Discretionary</button>
                <Row label="Total Expenses" wk={expT / 48} mo={expT / 12} y48={expT} y52={expT} bold border />
                {savItems.length > 0 && <SH color="#2ECC71">Savings</SH>}
                {savItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {savItems.length > 0 && <Row label="Total Savings" wk={savT / 48} mo={savT / 12} y48={savT} y52={savT * 52 / 48} bold border color="#2ECC71" />}
                <button onClick={() => addSnapItem("S")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Savings</button>
                <div style={{ marginTop: 8, padding: "10px 8px", background: remY >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
                  <Row label="Remaining" wk={remY / 48} mo={remY / 12} y48={remY} y52={remY * 52 / 48} bold color={remY >= 0 ? "#2ECC71" : "#E74C3C"} />
                </div>
              </>; })()}
              </Card>
              </VisColsCtx.Provider>
              </>}
              {/* Snapshot Deductions Tab */}
              {snapTab === "deductions" && (() => {
                const fs = snap.fullState || {};
                const snapPreDed = fs.preDed || DEF_PRE;
                const snapPostDed = fs.postDed || DEF_POST;
                const updateSnapFS = (key, val) => {
                  const n = [...snapshots];
                  const s = { ...n[viewingSnap] };
                  s.fullState = { ...(s.fullState || {}), [key]: val };
                  n[viewingSnap] = recalcSnap(s);
                  setSnapshots(n);
                };
                const snapC4pre = fs.c4pre !== undefined ? fs.c4pre : "0";
                const snapC4ro = fs.c4ro !== undefined ? fs.c4ro : "0";
                const snapK4pre = fs.k4pre !== undefined ? fs.k4pre : "0";
                const snapK4ro = fs.k4ro !== undefined ? fs.k4ro : "0";
                const snapCHsa = fs.cHsaAnn !== undefined ? fs.cHsaAnn : "0";
                const snapKHsa = fs.kHsaAnn !== undefined ? fs.kHsaAnn : "0";
                // Calculate dollar amounts from percentages
                const c4preAnn = snapCS * evalF(snapC4pre) / 100;
                const c4roAnn = snapCS * evalF(snapC4ro) / 100;
                const k4preAnn = snapKS * evalF(snapK4pre) / 100;
                const k4roAnn = snapKS * evalF(snapK4ro) / 100;
                const cPreTotal = snapPreDed.reduce((s, d) => s + evalF(d.c), 0);
                const kPreTotal = snapPreDed.reduce((s, d) => s + evalF(d.k), 0);
                const cPostTotal = snapPostDed.reduce((s, d) => s + evalF(d.c), 0);
                const kPostTotal = snapPostDed.reduce((s, d) => s + evalF(d.k), 0);
                const cTotalDed = cPreTotal * 52 + c4preAnn + c4roAnn + cPostTotal * 52 + evalF(snapCHsa);
                const kTotalDed = kPreTotal * 52 + k4preAnn + k4roAnn + kPostTotal * 52 + evalF(snapKHsa);
                return <>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>401(k) Contributions</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, alignItems: "center" }}>
                      <div />
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)" }}>Pre-Tax %</div>
                      <NI value={String(snapC4pre)} onChange={v => updateSnapFS("c4pre", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <NI value={String(snapK4pre)} onChange={v => updateSnapFS("k4pre", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>Pre-Tax $/yr</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-presav, #1ABC9C)", fontWeight: 600, padding: "4px 8px" }}>{fmt(c4preAnn)}</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-presav, #1ABC9C)", fontWeight: 600, padding: "4px 8px" }}>{fmt(k4preAnn)}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)" }}>Roth %</div>
                      <NI value={String(snapC4ro)} onChange={v => updateSnapFS("c4ro", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <NI value={String(snapK4ro)} onChange={v => updateSnapFS("k4ro", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>Roth $/yr</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-posttax, #9B59B6)", fontWeight: 600, padding: "4px 8px" }}>{fmt(c4roAnn)}</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-posttax, #9B59B6)", fontWeight: 600, padding: "4px 8px" }}>{fmt(k4roAnn)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--tx, #333)", borderTop: "2px solid var(--bdr2, #d0cdc8)", paddingTop: 6 }}>Total 401k/yr</div>
                      <div style={{ fontSize: 12, textAlign: "right", fontWeight: 700, color: "var(--tx, #333)", borderTop: "2px solid var(--bdr2, #d0cdc8)", paddingTop: 6 }}>{fmt(c4preAnn + c4roAnn)}</div>
                      <div style={{ fontSize: 12, textAlign: "right", fontWeight: 700, color: "var(--tx, #333)", borderTop: "2px solid var(--bdr2, #d0cdc8)", paddingTop: 6 }}>{fmt(k4preAnn + k4roAnn)}</div>
                    </div>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>HSA Annual Contributions</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} Annual HSA</label>
                        <NI value={String(snapCHsa)} onChange={v => updateSnapFS("cHsaAnn", v)} onBlurResolve prefix="$" style={{ height: 32 }} />
                        <div style={{ fontSize: 10, color: "var(--tx3, #999)", marginTop: 2 }}>{fmt(evalF(snapCHsa) / 52)}/wk</div></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} Annual HSA</label>
                        <NI value={String(snapKHsa)} onChange={v => updateSnapFS("kHsaAnn", v)} onBlurResolve prefix="$" style={{ height: 32 }} />
                        <div style={{ fontSize: 10, color: "var(--tx3, #999)", marginTop: 2 }}>{fmt(evalF(snapKHsa) / 52)}/wk</div></div>
                    </div>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Pre-Tax Deductions <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
                      {snapPreDed.map((d, i) => [
                        <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...snapPreDed]; n[i] = { ...n[i], n: v }; updateSnapFS("preDed", n); }} /></div>,
                        <NI key={i + "c"} value={d.c} onChange={v => { const n = [...snapPreDed]; n[i] = { ...n[i], c: v }; updateSnapFS("preDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <NI key={i + "k"} value={d.k} onChange={v => { const n = [...snapPreDed]; n[i] = { ...n[i], k: v }; updateSnapFS("preDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <button key={i + "x"} onClick={() => updateSnapFS("preDed", snapPreDed.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                      ])}
                    </div>
                    <button onClick={() => updateSnapFS("preDed", [...snapPreDed, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
                  </Card>
                  <Card>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Post-Tax Deductions <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
                      {snapPostDed.map((d, i) => [
                        <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...snapPostDed]; n[i] = { ...n[i], n: v }; updateSnapFS("postDed", n); }} /></div>,
                        <NI key={i + "c"} value={d.c} onChange={v => { const n = [...snapPostDed]; n[i] = { ...n[i], c: v }; updateSnapFS("postDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <NI key={i + "k"} value={d.k} onChange={v => { const n = [...snapPostDed]; n[i] = { ...n[i], k: v }; updateSnapFS("postDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <button key={i + "x"} onClick={() => updateSnapFS("postDed", snapPostDed.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                      ])}
                    </div>
                    <button onClick={() => updateSnapFS("postDed", [...snapPostDed, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
                  </Card>
                  <Card dark style={{ marginTop: 20 }}>
                    <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Deductions Summary (Annual)</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: "#888" }}>Category</div>
                      <div style={{ fontWeight: 700, color: "#888", textAlign: "right" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, color: "#888", textAlign: "right" }}>{p2Name}</div>
                      <div style={{ fontWeight: 700, color: "#888", textAlign: "right" }}>Total</div>
                      {[
                        ["401k Pre-Tax", c4preAnn, k4preAnn, "#1ABC9C"],
                        ["401k Roth", c4roAnn, k4roAnn, "#9B59B6"],
                        ["HSA", evalF(snapCHsa), evalF(snapKHsa), "#1ABC9C"],
                        ["Pre-Tax Deductions", cPreTotal * 52, kPreTotal * 52, "#c0392b"],
                        ["Post-Tax Deductions", cPostTotal * 52, kPostTotal * 52, "#9B59B6"],
                      ].map(([label, v1, v2, color]) => [
                        <div key={label + "l"} style={{ color, padding: "3px 0" }}>{label}</div>,
                        <div key={label + "1"} style={{ textAlign: "right", color: "#ccc", padding: "3px 0" }}>{fmt(v1)}</div>,
                        <div key={label + "2"} style={{ textAlign: "right", color: "#ccc", padding: "3px 0" }}>{fmt(v2)}</div>,
                        <div key={label + "t"} style={{ textAlign: "right", color: "#fff", fontWeight: 600, padding: "3px 0" }}>{fmt(v1 + v2)}</div>,
                      ])}
                      <div style={{ fontWeight: 700, color: "#fff", borderTop: "1px solid #555", paddingTop: 6 }}>Total Deductions</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#fff", borderTop: "1px solid #555", paddingTop: 6 }}>{fmt(cTotalDed)}</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#fff", borderTop: "1px solid #555", paddingTop: 6 }}>{fmt(kTotalDed)}</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#4ECDC4", borderTop: "1px solid #555", paddingTop: 6 }}>{fmt(cTotalDed + kTotalDed)}</div>
                    </div>
                  </Card>
                </>;
              })()}
              {/* Snapshot Tax Tab */}
              {snapTab === "tax" && (() => {
                const fs = snap.fullState || {};
                const snapTax = fs.tax || tax;
                // Auto-match tax year to snapshot date
                const snapDateYr = snap.date ? snap.date.slice(0, 4) : tax.year;
                const effectiveTaxYr = snapTax.year || snapDateYr;
                const effectiveTD = allTaxDB[effectiveTaxYr] || allTaxDB[snapDateYr] || allTaxDB[tax.year] || TAX_DB["2026"];
                const updateSnapTax = (key, val) => {
                  const n = [...snapshots];
                  const s = { ...n[viewingSnap] };
                  const newTax = { ...(s.fullState?.tax || tax), [key]: val };
                  s.fullState = { ...(s.fullState || {}), tax: newTax };
                  n[viewingSnap] = recalcSnap(s);
                  setSnapshots(n);
                };
                const snapP1 = snapTax.p1State || snap.p1State || (tax.p1State || {});
                const snapP2 = snapTax.p2State || snap.p2State || (tax.p2State || {});
                const snapFiling = snap.fil || fs.fil || fil;
                // Calculate per-person taxes for display
                const p1Sal = snapCS, p2Sal = snapKS;
                const p1w = p1Sal / 52, p2w = p2Sal / 52;
                const eTD = effectiveTD;
                const eBr = snapFiling === "mfj" ? eTD.fedMFJ : eTD.fedSingle;
                const eSd = snapFiling === "mfj" ? eTD.stdMFJ : eTD.stdSingle;
                const combTax = (p1w + p2w) * 52;
                const fedTax = snapFiling === "mfj" ? calcFed(Math.max(0, combTax - eSd), eBr) : calcFed(Math.max(0, p1Sal - eTD.stdSingle), eTD.fedSingle) + calcFed(Math.max(0, p2Sal - eTD.stdSingle), eTD.fedSingle);
                const fedTaxP1 = snapFiling === "mfj" ? fedTax * (combTax > 0 ? p1Sal / combTax : 0.5) : calcFed(Math.max(0, p1Sal - eTD.stdSingle), eTD.fedSingle);
                const fedTaxP2 = snapFiling === "mfj" ? fedTax - fedTaxP1 : calcFed(Math.max(0, p2Sal - eTD.stdSingle), eTD.fedSingle);
                const ssR = eTD.ssRate / 100, mcR = eTD.medRate / 100;
                const p1SS = Math.min(p1Sal, eTD.ssCap) * ssR, p2SS = Math.min(p2Sal, eTD.ssCap) * ssR;
                const p1Mc = p1Sal * mcR, p2Mc = p2Sal * mcR;
                const p1St = calcStateTax(p1Sal, snapP1.abbr || "", snapFiling);
                const p2St = calcStateTax(p2Sal, snapP2.abbr || "", snapFiling);
                const p1FL = p1Sal * (snapP1.famli || 0) / 100, p2FL = p2Sal * (snapP2.famli || 0) / 100;
                const p1Total = fedTaxP1 + p1SS + p1Mc + p1St + p1FL;
                const p2Total = fedTaxP2 + p2SS + p2Mc + p2St + p2FL;
                const grandTotal = p1Total + p2Total;
                const p1EffRate = p1Sal > 0 ? (p1Total / p1Sal * 100).toFixed(1) : "0.0";
                const p2EffRate = p2Sal > 0 ? (p2Total / p2Sal * 100).toFixed(1) : "0.0";
                return <>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Tax Settings</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Tax Year <span style={{ fontSize: 9, color: "#556FB5" }}>(auto: {snapDateYr})</span></label>
                        <select value={effectiveTaxYr} onChange={e => { const yr = e.target.value; const rates = allTaxDB[yr]; if (rates) { const n = [...snapshots]; const s = { ...n[viewingSnap] }; s.fullState = { ...(s.fullState || {}), tax: { ...snapTax, year: yr, ...rates, p1State: snapP1, p2State: snapP2 } }; n[viewingSnap] = recalcSnap(s); setSnapshots(n); } }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>
                          {Object.keys(allTaxDB).sort().map(y => <option key={y} value={y}>{y}</option>)}
                        </select></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Filing Status</label>
                        <select value={snapFiling} onChange={e => { upSnap("fil", e.target.value); const n = [...snapshots]; const s = { ...n[viewingSnap] }; if (s.fullState) s.fullState = { ...s.fullState, fil: e.target.value }; n[viewingSnap] = recalcSnap(s); setSnapshots(n); }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>
                          <option value="mfj">Married Filing Jointly</option><option value="single">Single</option>
                        </select></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} State</label>
                        <input list="snap-tax-states" value={snapP1.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; updateSnapTax("p1State", { ...snapP1, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa", boxSizing: "border-box" }} /><datalist id="snap-tax-states">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} State</label>
                        <input list="snap-tax-states-2" value={snapP2.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; updateSnapTax("p2State", { ...snapP2, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa", boxSizing: "border-box" }} /><datalist id="snap-tax-states-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                    </div>
                  </Card>
                  {/* Per-person tax breakdown */}
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Tax Breakdown — {effectiveTaxYr}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "6px 0", borderBottom: "2px solid var(--bdr2, #d0cdc8)", fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase" }}>
                      <span>Tax</span><span style={{ textAlign: "right" }}>{p1Name}</span><span style={{ textAlign: "right" }}>{p2Name}</span><span style={{ textAlign: "right" }}>Total</span>
                    </div>
                    {[
                      ["Gross Salary", p1Sal, p2Sal, p1Sal + p2Sal, "var(--tx, #333)"],
                      ["Federal Income Tax", -fedTaxP1, -fedTaxP2, -fedTax, "var(--c-fedtax, #1a5276)"],
                      [`OASDI (${p2(eTD.ssRate)})`, -p1SS, -p2SS, -(p1SS + p2SS), "var(--c-fedtax, #1a5276)"],
                      [`Medicare (${p2(eTD.medRate)})`, -p1Mc, -p2Mc, -(p1Mc + p2Mc), "var(--c-fedtax, #1a5276)"],
                      [`${snapP1.abbr || "ST"} State Tax`, -p1St, -p2St, -(p1St + p2St), "var(--c-sttax, #8B4513)"],
                      ["State Payroll", -p1FL, -p2FL, -(p1FL + p2FL), "var(--c-sttax, #8B4513)"],
                    ].map(([label, v1, v2, vt, color]) => (
                      <div key={label} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "5px 0", alignItems: "center", fontSize: 12 }}>
                        <span style={{ color }}>{label}</span>
                        <span style={{ textAlign: "right", color }}>{fmt(v1)}</span>
                        <span style={{ textAlign: "right", color }}>{fmt(v2)}</span>
                        <span style={{ textAlign: "right", color, fontWeight: 600 }}>{fmt(vt)}</span>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "8px 0", alignItems: "center", fontSize: 12, borderTop: "2px solid var(--bdr2, #d0cdc8)", fontWeight: 700 }}>
                      <span style={{ color: "var(--c-totaltax, #E8573A)" }}>Total Taxes</span>
                      <span style={{ textAlign: "right", color: "var(--c-totaltax, #E8573A)" }}>{fmt(-p1Total)}</span>
                      <span style={{ textAlign: "right", color: "var(--c-totaltax, #E8573A)" }}>{fmt(-p2Total)}</span>
                      <span style={{ textAlign: "right", color: "var(--c-totaltax, #E8573A)" }}>{fmt(-grandTotal)}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "5px 0", alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "var(--tx3, #999)" }}>Effective Rate</span>
                      <span style={{ textAlign: "right", color: "var(--tx3, #999)" }}>{p1EffRate}%</span>
                      <span style={{ textAlign: "right", color: "var(--tx3, #999)" }}>{p2EffRate}%</span>
                      <span style={{ textAlign: "right", color: "var(--tx3, #999)", fontWeight: 600 }}>{(p1Sal + p2Sal) > 0 ? (grandTotal / (p1Sal + p2Sal) * 100).toFixed(1) : "0.0"}%</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "5px 0", alignItems: "center", fontSize: 12, fontWeight: 700, color: "#4ECDC4" }}>
                      <span>Net After Tax</span>
                      <span style={{ textAlign: "right" }}>{fmt(p1Sal - p1Total)}</span>
                      <span style={{ textAlign: "right" }}>{fmt(p2Sal - p2Total)}</span>
                      <span style={{ textAlign: "right" }}>{fmt(p1Sal + p2Sal - grandTotal)}</span>
                    </div>
                    <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--input-bg, #f4f4f4)", borderRadius: 8, fontSize: 11, color: "var(--tx2, #555)" }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Rate Details ({effectiveTaxYr})</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                        <div>Std Ded ({snapFiling === "mfj" ? "MFJ" : "Single"}): <strong>{fmt(eSd)}</strong></div>
                        <div>Fed Marginal: <strong>{fp(getMarg(Math.max(0, combTax - eSd), eBr))}</strong></div>
                        <div>SS Cap: <strong>{fmt(eTD.ssCap)}</strong></div>
                        <div>401k Limit: <strong>{fmt(eTD.k401Lim)}</strong></div>
                        <div>{p1Name} ({snapP1.abbr || "ST"}) Payroll: <strong>{p2(snapP1.famli || 0)}</strong></div>
                        <div>{p2Name} ({snapP2.abbr || "ST"}) Payroll: <strong>{p2(snapP2.famli || 0)}</strong></div>
                      </div>
                    </div>
                  </Card>
                  <Card>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Employer Match Tiers</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8 }}>{p1Name} Match</div>
                        <div style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 4 }}>Base: {snapTax.cMatchBase || 0}%</div>
                        {(snapTax.cMatchTiers || []).map((t, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 2 }}>Up to {t.upTo}% → {(t.rate * 100).toFixed(0)}% match</div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8 }}>{p2Name} Match</div>
                        <div style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 4 }}>Base: {snapTax.kMatchBase || 0}%</div>
                        {(snapTax.kMatchTiers || []).map((t, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 2 }}>Up to {t.upTo}% → {(t.rate * 100).toFixed(0)}% match</div>
                        ))}
                      </div>
                    </div>
                  </Card>
                </>;
              })()}
            </div>
          );
        })()}

        {tab === "budget" && viewingSnap === null && (
          <div>

            <Card style={{ overflowX: "auto" }}>
              {(() => { const cols = ["1.8fr", visCols.wk && "1fr", visCols.mo && "1fr", visCols.y48 && "1fr", visCols.y52 && "1fr"].filter(Boolean).join(" "); const hdrs = [""]; if (visCols.wk) hdrs.push("Weekly"); if (visCols.mo) hdrs.push("Monthly"); if (visCols.y48) hdrs.push("Yr (48)"); if (visCols.y52) hdrs.push("Yr (52)"); return (
              <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, padding: "6px 0", borderBottom: "2px solid var(--bdr2, #d0cdc8)", position: "sticky", top: 0, background: "var(--card-bg, #fff)", zIndex: 2 }}>
                {hdrs.map(h => <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3, #999)", textTransform: "uppercase", letterSpacing: 1, textAlign: h === "" ? "left" : "right" }}>{h}</div>)}
              </div>); })()}

              <SH>Income</SH>
              <Row label={p1Name + " Salary"} wk={C.cw} mo={moC(C.cw)} y48={y4(C.cw)} y52={y5(C.cw)} bold />
              <Row label={p2Name + " Salary"} wk={C.kw} mo={moC(C.kw)} y48={y4(C.kw)} y52={y5(C.kw)} bold />
              <Row label="Combined Gross" wk={C.cw + C.kw} mo={moC(C.cw + C.kw)} y48={y4(C.cw + C.kw)} y52={y5(C.cw + C.kw)} bold border />

              <CSH color="var(--c-pretax, #c0392b)" collapsed={collapsed.preTax} onToggle={() => toggleSec("preTax")}>Pre-Tax Deductions</CSH>
              {!collapsed.preTax && <>{preDed.filter(d => !d.n.toLowerCase().includes("hsa")).map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k), v = cv + kv; return <div key={i}><Row label={d.n} wk={-v} mo={-moC(v)} y48={-y4(v)} y52={-y5(v)} color="var(--c-pretax, #c0392b)" />{showPerPerson && (cv > 0 || kv > 0) && <><Row label={`  ↳ ${p1Name}`} wk={-cv} mo={-moC(cv)} y48={-y4(cv)} y52={-y5(cv)} color="var(--c-pretax, #d98880)" /><Row label={`  ↳ ${p2Name}`} wk={-kv} mo={-moC(kv)} y48={-y4(kv)} y52={-y5(kv)} color="var(--c-pretax, #d98880)" /></>}</div>; })}</>}
              {(() => { const t = preDed.filter(d => !d.n.toLowerCase().includes("hsa")).reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0); return t > 0 ? <Row label="Total Pre-Tax Deductions" wk={-t} mo={-moC(t)} y48={-y4(t)} y52={-y5(t)} bold border color="var(--c-pretax, #c0392b)" /> : null; })()}

              {/* Pre-Tax Savings */}
              <CSH color="var(--c-presav, #1ABC9C)" collapsed={collapsed.preSav} onToggle={() => toggleSec("preSav")}>Pre-Tax Savings (not in take-home)</CSH>
              {!collapsed.preSav && <>{preDed.filter(d => d.n.toLowerCase().includes("hsa")).map((d, i) => { const v = evalF(d.c) + evalF(d.k); return <Row key={"hs" + i} label={"💰 " + d.n + (tax.hsaEmployerMatch > 0 ? ` (+ ${fmt(tax.hsaEmployerMatch)}/yr employer)` : "")} wk={v} mo={moC(v)} y48={y4(v)} y52={y5(v)} color="var(--c-presav, #1ABC9C)" />; })}
              {showPerPerson && preDed.filter(d => d.n.toLowerCase().includes("hsa")).map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k); return (cv > 0 || kv > 0) ? <div key={"hsp" + i}><Row label={`  ↳ ${p1Name} HSA`} wk={cv} mo={moC(cv)} y48={y4(cv)} y52={y5(cv)} color="var(--c-presav, #48C9B0)" /><Row label={`  ↳ ${p2Name} HSA`} wk={kv} mo={moC(kv)} y48={y4(kv)} y52={y5(kv)} color="var(--c-presav, #48C9B0)" /></div> : null; })}
              {C.c4preW + C.k4preW > 0 && <Row label="💰 401(k) Pre-Tax" wk={C.c4preW + C.k4preW} mo={moC(C.c4preW + C.k4preW)} y48={y4(C.c4preW + C.k4preW)} y52={y5(C.c4preW + C.k4preW)} color="var(--c-presav, #1ABC9C)" />}
              {showPerPerson && C.c4preW > 0 && <Row label={`  ↳ ${p1Name} Pre-Tax`} wk={C.c4preW} mo={moC(C.c4preW)} y48={y4(C.c4preW)} y52={y5(C.c4preW)} color="var(--c-presav, #48C9B0)" />}
              {showPerPerson && C.k4preW > 0 && <Row label={`  ↳ ${p2Name} Pre-Tax`} wk={C.k4preW} mo={moC(C.k4preW)} y48={y4(C.k4preW)} y52={y5(C.k4preW)} color="var(--c-presav, #48C9B0)" />}</>}
              {(() => { const hsaW = preDed.filter(d => d.n.toLowerCase().includes("hsa")).reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0); const preTax401 = C.c4preW + C.k4preW; const total = hsaW + preTax401; return total > 0 ? <Row label="Total Pre-Tax Savings" wk={total} mo={moC(total)} y48={y4(total)} y52={y5(total)} bold border color="var(--c-presav, #1ABC9C)" /> : null; })()}

              <SH>Taxable Pay</SH>
              <Row label="Combined Taxable" wk={C.cTxW + C.kTxW} mo={moC(C.cTxW + C.kTxW)} y48={y4(C.cTxW + C.kTxW)} y52={y5(C.cTxW + C.kTxW)} bold color="var(--c-taxable, #556FB5)" />

              <CSH color="var(--c-fedtax, #1a5276)" collapsed={collapsed.fedTax} onToggle={() => toggleSec("fedTax")}>Federal Taxes</CSH>
              {!collapsed.fedTax && <><Row label="Fed Withholding" sub={fp(C.mr)} wk={-(C.cFed + C.kFed)} mo={-moC(C.cFed + C.kFed)} y48={-y4(C.cFed + C.kFed)} y52={-y5(C.cFed + C.kFed)} color="var(--c-fedtax, #1a5276)" />
              {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cFed} mo={-moC(C.cFed)} y48={-y4(C.cFed)} y52={-y5(C.cFed)} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kFed} mo={-moC(C.kFed)} y48={-y4(C.kFed)} y52={-y5(C.kFed)} color="var(--c-fedtax2, #3a7abf)" /></>}
              <Row label="OASDI (SS)" sub={p2(tax.ssRate)} wk={-(C.cSS + C.kSS)} mo={-moC(C.cSS + C.kSS)} y48={-y4(C.cSS + C.kSS)} y52={-y5(C.cSS + C.kSS)} color="var(--c-fedtax, #1a5276)" />
              {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cSS} mo={-moC(C.cSS)} y48={-y4(C.cSS)} y52={-y5(C.cSS)} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kSS} mo={-moC(C.kSS)} y48={-y4(C.kSS)} y52={-y5(C.kSS)} color="var(--c-fedtax2, #3a7abf)" /></>}
              <Row label="Medicare" sub={p2(tax.medRate)} wk={-(C.cMc + C.kMc)} mo={-moC(C.cMc + C.kMc)} y48={-y4(C.cMc + C.kMc)} y52={-y5(C.cMc + C.kMc)} color="var(--c-fedtax, #1a5276)" />
              {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cMc} mo={-moC(C.cMc)} y48={-y4(C.cMc)} y52={-y5(C.cMc)} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kMc} mo={-moC(C.kMc)} y48={-y4(C.kMc)} y52={-y5(C.kMc)} color="var(--c-fedtax2, #3a7abf)" /></>}</>}

              <CSH color="var(--c-sttax, #8B4513)" collapsed={collapsed.stTax} onToggle={() => toggleSec("stTax")}>State Taxes ({(tax.p1State || {}).abbr || "ST"}{(tax.p2State || {}).abbr && (tax.p2State || {}).abbr !== (tax.p1State || {}).abbr ? `/${(tax.p2State || {}).abbr}` : ""})</CSH>
              {!collapsed.stTax && (() => {
                const sameState = (tax.p1State || {}).abbr === (tax.p2State || {}).abbr;
                const p1a = (tax.p1State || {}).abbr || "ST", p2a = (tax.p2State || {}).abbr || "ST";
                return <>{sameState ? <>
                  <Row label={`${p1a} State Tax`} wk={-(C.cCO + C.kCO)} mo={-moC(C.cCO + C.kCO)} y48={-y4(C.cCO + C.kCO)} y52={-y5(C.cCO + C.kCO)} color="var(--c-sttax, #8B4513)" />
                  {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cCO} mo={-moC(C.cCO)} y48={-y4(C.cCO)} y52={-y5(C.cCO)} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kCO} mo={-moC(C.kCO)} y48={-y4(C.kCO)} y52={-y5(C.kCO)} color="var(--c-sttax2, #B8860B)" /></>}
                  <Row label={`${p1a} State Payroll Tax`} wk={-(C.cFL + C.kFL)} mo={-moC(C.cFL + C.kFL)} y48={-y4(C.cFL + C.kFL)} y52={-y5(C.cFL + C.kFL)} color="var(--c-sttax, #8B4513)" />
                  {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cFL} mo={-moC(C.cFL)} y48={-y4(C.cFL)} y52={-y5(C.cFL)} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kFL} mo={-moC(C.kFL)} y48={-y4(C.kFL)} y52={-y5(C.kFL)} color="var(--c-sttax2, #B8860B)" /></>}
                </> : <>
                  <Row label={`${p1a} State Tax (${p1Name})`} wk={-C.cCO} mo={-moC(C.cCO)} y48={-y4(C.cCO)} y52={-y5(C.cCO)} color="var(--c-sttax, #8B4513)" />
                  <Row label={`${p2a} State Tax (${p2Name})`} wk={-C.kCO} mo={-moC(C.kCO)} y48={-y4(C.kCO)} y52={-y5(C.kCO)} color="var(--c-sttax, #8B4513)" />
                  <Row label={`${p1a} Payroll Tax (${p1Name})`} wk={-C.cFL} mo={-moC(C.cFL)} y48={-y4(C.cFL)} y52={-y5(C.cFL)} color="var(--c-sttax, #8B4513)" />
                  <Row label={`${p2a} Payroll Tax (${p2Name})`} wk={-C.kFL} mo={-moC(C.kFL)} y48={-y4(C.kFL)} y52={-y5(C.kFL)} color="var(--c-sttax, #8B4513)" />
                </>}</>;
              })()}

              {(() => { const t = C.cTx + C.kTx; return <Row label="Total Taxes" wk={-t} mo={-moC(t)} y48={-y4(t)} y52={-y5(t)} bold border color="var(--c-totaltax, #E8573A)" />; })()}
              {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name} total tax: {fmt(C.cTx)}/wk ({fmt(C.cTx * 52)}/yr) • {p2Name} total tax: {fmt(C.kTx)}/wk ({fmt(C.kTx * 52)}/yr)</div>}

              {(C.cPostW + C.kPostW > 0) && <><CSH color="var(--c-posttax, #9B59B6)" collapsed={collapsed.postTax} onToggle={() => toggleSec("postTax")}>Post-Tax Deductions</CSH>
                {!collapsed.postTax && <>{C.c4roW + C.k4roW > 0 && <><Row label="Roth 401(k)" wk={-(C.c4roW + C.k4roW)} mo={-moC(C.c4roW + C.k4roW)} y48={-y4(C.c4roW + C.k4roW)} y52={-y5(C.c4roW + C.k4roW)} color="var(--c-posttax, #9B59B6)" />{showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.c4roW} mo={-moC(C.c4roW)} y48={-y4(C.c4roW)} y52={-y5(C.c4roW)} color="var(--c-posttax2, #C39BD3)" /><Row label={`  ↳ ${p2Name}`} wk={-C.k4roW} mo={-moC(C.k4roW)} y48={-y4(C.k4roW)} y52={-y5(C.k4roW)} color="var(--c-posttax2, #C39BD3)" /></>}</>}
                {postDed.map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k), v = cv + kv; return v > 0 ? <div key={i}><Row label={d.n} wk={-v} mo={-moC(v)} y48={-y4(v)} y52={-y5(v)} color="var(--c-posttax, #9B59B6)" />{showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-cv} mo={-moC(cv)} y48={-y4(cv)} y52={-y5(cv)} color="var(--c-posttax2, #C39BD3)" /><Row label={`  ↳ ${p2Name}`} wk={-kv} mo={-moC(kv)} y48={-y4(kv)} y52={-y5(kv)} color="var(--c-posttax2, #C39BD3)" /></>}</div> : null; })}</>}
                <Row label="Total Post-Tax Deductions" wk={-(C.cPostW + C.kPostW)} mo={-moC(C.cPostW + C.kPostW)} y48={-y4(C.cPostW + C.kPostW)} y52={-y5(C.cPostW + C.kPostW)} bold border color="var(--c-posttax, #9B59B6)" />
              </>}

              <div style={{ marginTop: 8, padding: "10px 0", borderTop: "3px solid #1a1a1a", borderBottom: "3px solid #1a1a1a" }}>
                <Row label="✦ Combined Net Paycheck" wk={C.net} mo={moC(C.net)} y48={y4(C.net)} y52={y5(C.net)} bold />
                {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name}: {fmt(C.cNet)}/wk ({fmt(C.cNet * 52)}/yr) • {p2Name}: {fmt(C.kNet)}/wk ({fmt(C.kNet * 52)}/yr)</div>}
              </div>

              <CSH color="var(--c-taxable, #556FB5)" collapsed={collapsed.nec} onToggle={() => toggleSec("nec")}>Necessity Expenses</CSH>
              {!collapsed.nec && necI.map(item => <ExpRowInner key={item.n + "_" + item.idx} item={item} cats={cats} onUpdate={u => updExp(item.idx, u)} onRemove={() => rmExp(item.idx)} />)}
              <Row label="Subtotal — Necessity" wk={-tNW} mo={-moC(tNW)} y48={-y4(tNW)} y52={-y4(tNW)} bold border color="var(--c-taxable, #556FB5)" />

              <CSH color="var(--c-totaltax, #E8573A)" collapsed={collapsed.dis} onToggle={() => toggleSec("dis")}>Discretionary Expenses</CSH>
              {!collapsed.dis && disI.map(item => <ExpRowInner key={item.n + "_" + item.idx} item={item} cats={cats} onUpdate={u => updExp(item.idx, u)} onRemove={() => rmExp(item.idx)} />)}
              <Row label="Subtotal — Discretionary" wk={-tDW} mo={-moC(tDW)} y48={-y4(tDW)} y52={-y4(tDW)} bold border color="var(--c-totaltax, #E8573A)" />
              <Row label="Total All Expenses" wk={-tExpW} mo={-moC(tExpW)} y48={-y4(tExpW)} y52={-y4(tExpW)} bold border />

              <CSH color="#2ECC71" collapsed={collapsed.sav} onToggle={() => toggleSec("sav")}>Savings Goals</CSH>
              {!collapsed.sav && savSorted.map(item => <SavRowInner key={item.n + "_" + item.idx} item={item} savCats={savCats} onUpdate={u => updSav(item.idx, u)} onRemove={() => rmSav(item.idx)} />)}
              <Row label="Total Savings" wk={-tSavW} mo={-moC(tSavW)} y48={-y4(tSavW)} y52={-y5(tSavW)} bold border color="#2ECC71" />

              <div style={{ marginTop: 8, padding: "10px 8px", background: remW >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
                <Row label="Remaining to Budget" wk={remW} mo={moC(remW)} y48={remY48} y52={remY52} bold color={remW >= 0 ? "#2ECC71" : "#E74C3C"} />
              </div>
              <div style={{ marginTop: 4, padding: "6px 8px", background: "#f0faf5", borderRadius: 8 }}>
                <Row label="Total Savings + Remaining" wk={totalSavPlusRemW} mo={moC(totalSavPlusRemW)} y48={y4(totalSavPlusRemW)} y52={y5(tSavW) + Math.max(0, remY52)} bold color="#2ECC71" />
              </div>

              {/* Bonus Section */}
              {C.eaipGross > 0 && <>
                <CSH color="var(--c-posttax, #9B59B6)" collapsed={collapsed.eaip} onToggle={() => toggleSec("eaip")}>Bonus — Annual</CSH>
                {!collapsed.eaip && <>
                <Row label={p1Name + " Bonus Gross"} wk={0} mo={0} y48={C.cEaipGross} y52={C.cEaipGross} color="var(--c-posttax, #9B59B6)" />
                <Row label={p2Name + " Bonus Gross"} wk={0} mo={0} y48={C.kEaipGross} y52={C.kEaipGross} color="var(--c-posttax, #9B59B6)" />
                <Row label="Combined Bonus Gross" wk={0} mo={0} y48={C.eaipGross} y52={C.eaipGross} bold border color="var(--c-posttax, #9B59B6)" />

                <CSH color="var(--c-fedtax, #1a5276)" collapsed={collapsed.eaipTax} onToggle={() => toggleSec("eaipTax")}>Bonus Taxes</CSH>
                {!collapsed.eaipTax && <>
                <Row label="Fed Withholding" sub={fp(C.mr)} wk={0} mo={0} y48={-(C.cEaipFed + C.kEaipFed)} y52={-(C.cEaipFed + C.kEaipFed)} color="var(--c-fedtax, #1a5276)" />
                {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipFed} y52={-C.cEaipFed} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipFed} y52={-C.kEaipFed} color="var(--c-fedtax2, #3a7abf)" /></>}
                <Row label="OASDI (SS)" wk={0} mo={0} y48={-(C.cEaipSS + C.kEaipSS)} y52={-(C.cEaipSS + C.kEaipSS)} color="var(--c-fedtax, #1a5276)" />
                {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipSS} y52={-C.cEaipSS} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipSS} y52={-C.kEaipSS} color="var(--c-fedtax2, #3a7abf)" /></>}
                <Row label="Medicare" wk={0} mo={0} y48={-(C.cEaipMc + C.kEaipMc)} y52={-(C.cEaipMc + C.kEaipMc)} color="var(--c-fedtax, #1a5276)" />
                {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipMc} y52={-C.cEaipMc} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipMc} y52={-C.kEaipMc} color="var(--c-fedtax2, #3a7abf)" /></>}
                {(() => { const sameState = (tax.p1State || {}).abbr === (tax.p2State || {}).abbr; const p1a = (tax.p1State || {}).abbr || "ST", p2a = (tax.p2State || {}).abbr || "ST"; return sameState ? <>
                  <Row label={`${p1a} State Tax`} wk={0} mo={0} y48={-(C.cEaipSt + C.kEaipSt)} y52={-(C.cEaipSt + C.kEaipSt)} color="var(--c-sttax, #8B4513)" />
                  {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipSt} y52={-C.cEaipSt} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipSt} y52={-C.kEaipSt} color="var(--c-sttax2, #B8860B)" /></>}
                  <Row label={`${p1a} State Payroll Tax`} wk={0} mo={0} y48={-(C.cEaipFL + C.kEaipFL)} y52={-(C.cEaipFL + C.kEaipFL)} color="var(--c-sttax, #8B4513)" />
                  {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipFL} y52={-C.cEaipFL} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipFL} y52={-C.kEaipFL} color="var(--c-sttax2, #B8860B)" /></>}
                </> : <>
                  <Row label={`${p1a} State Tax (${p1Name})`} wk={0} mo={0} y48={-C.cEaipSt} y52={-C.cEaipSt} color="var(--c-sttax, #8B4513)" />
                  <Row label={`${p2a} State Tax (${p2Name})`} wk={0} mo={0} y48={-C.kEaipSt} y52={-C.kEaipSt} color="var(--c-sttax, #8B4513)" />
                  <Row label={`${p1a} Payroll Tax (${p1Name})`} wk={0} mo={0} y48={-C.cEaipFL} y52={-C.cEaipFL} color="var(--c-sttax, #8B4513)" />
                  <Row label={`${p2a} Payroll Tax (${p2Name})`} wk={0} mo={0} y48={-C.kEaipFL} y52={-C.kEaipFL} color="var(--c-sttax, #8B4513)" />
                </>; })()}
                </>}
                <Row label="Total Bonus Taxes" wk={0} mo={0} y48={-(C.cEaipTax + C.kEaipTax)} y52={-(C.cEaipTax + C.kEaipTax)} bold border color="var(--c-totaltax, #E8573A)" />
                {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name} tax: {fmt(C.cEaipTax)} • {p2Name} tax: {fmt(C.kEaipTax)}</div>}
                </>}

                <div style={{ marginTop: 4, padding: "8px", background: "#F3E8FF", borderRadius: 8 }}>
                  <Row label="Bonus Net (take-home)" wk={0} mo={0} y48={C.eaipNet} y52={C.eaipNet} bold color="var(--c-posttax, #9B59B6)" />
                  {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name}: {fmt(C.cEaipNet)} • {p2Name}: {fmt(C.kEaipNet)}</div>}
                </div>
                <div style={{ marginTop: 4, padding: "8px", background: "#f0faf5", borderRadius: 8 }}>
                  <Row label="Total Savings + Remaining + Bonus" wk={totalSavPlusRemW} mo={moC(totalSavPlusRemW)} y48={y4(totalSavPlusRemW) + C.eaipNet} y52={y5(tSavW) + Math.max(0, remY52) + C.eaipNet} bold color="#2ECC71" />
                </div>
              </>}

            </Card>

            {/* Add item popup */}
            {showAddItem && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAddItem(false)}>
                <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 28, maxWidth: 500, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                  <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Add Budget Item</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Name</label>
                      <input value={niN} onChange={e => setNiN(e.target.value)} placeholder="Item name..." style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Section</label>
                        <select value={niS} onChange={e => setNiS(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="exp">Expense</option><option value="sav">Savings</option></select></div>
                      {niS === "exp" ? <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Type</label>
                        <select value={niT} onChange={e => setNiT(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="N">Necessity</option><option value="D">Discretionary</option></select></div> : <div />}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Category</label>
                        <select value={niC} onChange={e => setNiC(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>{(niS === "sav" ? savCats : cats).map(c => <option key={c}>{c}</option>)}</select></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Period</label>
                        <select value={niP} onChange={e => setNiP(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="w">Weekly</option><option value="m">Monthly</option><option value="y">Yearly</option></select></div>
                    </div>
                    <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Amount</label>
                      <NI value={niV} onChange={setNiV} prefix="$" /></div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                      <button onClick={() => setShowAddItem(false)} style={{ padding: "9px 18px", border: "2px solid #ddd", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                      <button onClick={() => { if (!niN.trim()) return; if (niS === "exp") setExp([...exp, { n: niN.trim(), c: niC || cats[0], t: niT, v: niV || "0", p: niP }]); else setSav([...sav, { n: niN.trim(), c: niC || savCats[0], v: niV || "0", p: niP }]); setNiN(""); setNiV(""); setShowAddItem(false); }}
                        style={{ padding: "9px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bulk add to multiple snapshots + current */}
            {showBulkAdd && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowBulkAdd(false)}>
                <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 28, maxWidth: 560, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", maxHeight: "85vh", overflowY: "auto" }}>
                  <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Add Item to Multiple Budgets</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Name</label>
                      <input value={bulkName} onChange={e => setBulkName(e.target.value)} placeholder="Item name..." style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Section</label>
                        <select value={bulkSec} onChange={e => setBulkSec(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="exp">Expense</option><option value="sav">Savings</option></select></div>
                      {bulkSec === "exp" ? <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Type</label>
                        <select value={bulkType} onChange={e => setBulkType(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="N">Necessity</option><option value="D">Discretionary</option></select></div> : <div />}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Category</label>
                        <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>{(bulkSec === "sav" ? savCats : cats).map(c => <option key={c}>{c}</option>)}</select></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Period</label>
                        <select value={bulkPer} onChange={e => setBulkPer(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="w">Weekly</option><option value="m">Monthly</option><option value="y">Yearly</option></select></div>
                    </div>
                    <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Amount</label>
                      <NI value={bulkVal} onChange={setBulkVal} prefix="$" /></div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "#999", display: "block", marginBottom: 8 }}>Apply to:</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--bdr, #eee)" }}>
                        <input type="checkbox" checked={!!bulkTargets.current} onChange={e => setBulkTargets(p => ({ ...p, current: e.target.checked }))} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Current Budget</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 6 }}>
                        <button onClick={() => { const t = { current: !!bulkTargets.current }; snapshots.forEach(s => { t[s.id] = true; }); setBulkTargets(t); }} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: "1px solid #556FB5", borderRadius: 4, background: "#EEF1FA", color: "#556FB5", cursor: "pointer" }}>Select All Snapshots</button>
                        <button onClick={() => { setBulkTargets({ current: !!bulkTargets.current }); }} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr, #ddd)", borderRadius: 4, background: "transparent", color: "var(--tx3, #888)", cursor: "pointer" }}>Deselect All</button>
                      </div>
                      <div style={{ maxHeight: 200, overflowY: "auto" }}>
                        {[...snapshots].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(s => (
                          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--bdr, #f0f0f0)" }}>
                            <input type="checkbox" checked={!!bulkTargets[s.id]} onChange={e => setBulkTargets(p => ({ ...p, [s.id]: e.target.checked }))} />
                            <span style={{ fontSize: 11, color: "var(--tx3, #888)", minWidth: 70 }}>{s.date}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx, #333)" }}>{s.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                      <button onClick={() => setShowBulkAdd(false)} style={{ padding: "9px 18px", border: "2px solid #ddd", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                      <button onClick={() => {
                        if (!bulkName.trim()) return;
                        const name = bulkName.trim();
                        const val = bulkVal || "0";
                        const numVal = evalF(val);
                        let yearly = numVal;
                        if (bulkPer === "w") yearly = numVal * 48;
                        else if (bulkPer === "m") yearly = numVal * 12;
                        yearly = Math.round(yearly * 100) / 100;
                        if (bulkTargets.current) {
                          if (bulkSec === "exp") setExp(prev => [...prev, { n: name, c: bulkCat || cats[0], t: bulkType, v: val, p: bulkPer }]);
                          else setSav(prev => [...prev, { n: name, c: bulkCat || savCats[0], v: val, p: bulkPer }]);
                        }
                        const selectedIds = Object.entries(bulkTargets).filter(([k, v]) => k !== "current" && v).map(([k]) => +k || k);
                        if (selectedIds.length > 0) {
                          setSnapshots(prev => prev.map(s => {
                            if (!selectedIds.includes(s.id)) return s;
                            const it = { ...(s.items || {}), [name]: { v: yearly, t: bulkSec === "exp" ? bulkType : "S", c: bulkCat || "" } };
                            return recalcSnap({ ...s, items: it });
                          }));
                        }
                        setShowBulkAdd(false);
                        setBulkName(""); setBulkVal("");
                      }} style={{ padding: "9px 18px", background: "#9B59B6", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add to {Object.values(bulkTargets).filter(Boolean).length} budget{Object.values(bulkTargets).filter(Boolean).length !== 1 ? "s" : ""}</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CHARTS ═══ */}
        {tab === "charts" && (
          <div>
            <Card style={{ marginBottom: 20, overflow: "hidden" }}>
              <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Save Budget Snapshot</h3>
              <div style={{ display: "flex", gap: 8, alignItems: mob ? "stretch" : "flex-end", flexDirection: mob ? "column" : "row", flexWrap: mob ? "nowrap" : "wrap" }}>
                <div style={{ flex: mob ? "none" : "0 0 auto", width: mob ? "100%" : 150 }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Date</label>
                  <input type="date" value={snapDate || new Date().toISOString().slice(0, 10)} onChange={e => setSnapDate(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: "8px 6px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box", maxWidth: "100%" }} /></div>
                <div style={{ flex: mob ? "none" : "1 1 120px", minWidth: 0, width: mob ? "100%" : "auto" }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Label</label>
                  <input value={snapLabel} onChange={e => setSnapLabel(e.target.value)} placeholder="What changed?" style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => {
                  // Build per-item snapshot data
                  const itemSnaps = {};
                  ewk.forEach(e => { itemSnaps[e.n] = { v: Math.round(e.wk * 48 * 100) / 100, t: e.t, c: e.c, f: e.f || "" }; });
                  savSorted.forEach(s => { itemSnaps[s.n] = { v: Math.round(s.wk * 48 * 100) / 100, t: "S", f: s.f || "" }; });
                  setSnapshots(prev => [...prev, {
                    id: Date.now(), date: snapDate || new Date().toISOString().slice(0, 10), label: snapLabel || "Snapshot",
                    grossW: C.cw + C.kw, netW: C.net, necW: tNW, disW: tDW, expW: tExpW, savW: tSavW,
                    remW, savRate: C.net > 0 ? (totalSavPlusRemW / C.net * 100) : 0,
                    savRateGross: (C.cw + C.kw) > 0 ? (totalSavPlusRemW / (C.cw + C.kw) * 100) : 0,
                    cNetW: C.cNet, kNetW: C.kNet, cGrossW: C.cw, kGrossW: C.kw,
                    cSalary: evalF(cSal), kSalary: evalF(kSal), fil, p1State: tax.p1State, p2State: tax.p2State,
                    eaipNet: C.eaipNet, eaipGross: C.eaipGross, cEaipNet: C.cEaipNet, kEaipNet: C.kEaipNet,
                    cEaipPct: evalF(cEaip), kEaipPct: evalF(kEaip),
                    items: itemSnaps,
                    fullState: { cSal, kSal, fil, cEaip, kEaip, preDed, postDed, c4pre, c4ro, k4pre, k4ro, cHsaAnn, kHsaAnn, exp, sav, cats, tax },
                  }]);
                  setSnapLabel(""); setSnapDate("");
                }} style={{ padding: "9px 20px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📸 Save</button>
                <label style={{ padding: "9px 16px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📥 Import Snapshots<input type="file" accept=".json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { const d = JSON.parse(ev.target.result); const incoming = d.snapshots || d; if (!Array.isArray(incoming)) { alert("JSON must contain a \"snapshots\" array"); return; } setSnapshots(prev => { const byId = new Map(prev.map(s => [s.id, s])); let updated = 0, added = 0; for (const s of incoming) { if (byId.has(s.id)) { byId.set(s.id, { ...byId.get(s.id), ...s }); updated++; } else { byId.set(s.id, s); added++; } } setTimeout(() => alert(`Imported: ${added} new, ${updated} updated`), 100); return Array.from(byId.values()).sort((a, b) => (a.date || "").localeCompare(b.date || "")); }); } catch(err) { alert("Invalid JSON: " + err.message); } }; r.readAsText(f); e.target.value = ""; }} /></label>
                </div>
              </div>
            </Card>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999" }}>Show as % of:</span>
              <button onClick={() => setSavRateBase("net")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: savRateBase === "net" ? "2px solid #4ECDC4" : "2px solid #ddd", borderRadius: 6, background: savRateBase === "net" ? "#E8F8F5" : "#fafafa", color: savRateBase === "net" ? "#4ECDC4" : "#888", cursor: "pointer" }}>Net Income</button>
              <button onClick={() => setSavRateBase("gross")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: savRateBase === "gross" ? "2px solid #F2A93B" : "2px solid #ddd", borderRadius: 6, background: savRateBase === "gross" ? "#FEF5E7" : "#fafafa", color: savRateBase === "gross" ? "#F2A93B" : "#888", cursor: "pointer" }}>Gross Income</button>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999", marginLeft: 8 }}>Bonus:</span>
              <button onClick={() => setIncludeEaip(p => !p)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: includeEaip ? "2px solid #9B59B6" : "2px solid #ddd", borderRadius: 6, background: includeEaip ? "#F3E8FF" : "#fafafa", color: includeEaip ? "#9B59B6" : "#888", cursor: "pointer" }}>
                {includeEaip ? "Included" : "Excluded"}
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999", marginLeft: 8 }}>Weeks:</span>
              <button onClick={() => setChartWeeks(48)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: chartWeeks === 48 ? "2px solid #556FB5" : "2px solid #ddd", borderRadius: 6, background: chartWeeks === 48 ? "#EEF1FA" : "#fafafa", color: chartWeeks === 48 ? "#556FB5" : "#888", cursor: "pointer" }}>48 wk</button>
              <button onClick={() => setChartWeeks(52)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: chartWeeks === 52 ? "2px solid #556FB5" : "2px solid #ddd", borderRadius: 6, background: chartWeeks === 52 ? "#EEF1FA" : "#fafafa", color: chartWeeks === 52 ? "#556FB5" : "#888", cursor: "pointer" }}>52 wk</button>
            </div>

            {(() => {
              const livePoint = { date: "Now", label: "Current", grossW: C.cw + C.kw, netW: C.net, necW: tNW, disW: tDW, expW: tExpW, savW: tSavW, remW, cNetW: C.cNet, kNetW: C.kNet, cGrossW: C.cw, kGrossW: C.kw, eaipNet: C.eaipNet, eaipGross: C.eaipGross, cEaipNet: C.cEaipNet, kEaipNet: C.kEaipNet };
              const allPoints = [...snapshots, livePoint];
              const sorted = allPoints.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
              const curEaipNet = C.eaipNet, curEaipGross = C.eaipGross;
              const curCEaipNet = C.cEaipNet, curKEaipNet = C.kEaipNet;
              const p1NetKey = `${p1Name} Net`, p2NetKey = `${p2Name} Net`;
              const p1GrossKey = `${p1Name} Gross`, p2GrossKey = `${p2Name} Gross`;
              const trendData = sorted.map(s => {
                const snapEaipNet = s.eaipNet !== undefined ? s.eaipNet : curEaipNet;
                const snapEaipGross = s.eaipGross !== undefined ? s.eaipGross : curEaipGross;
                const eaip = includeEaip ? snapEaipNet : 0;
                const eaipG = includeEaip ? snapEaipGross : 0;
                const cw = chartWeeks; // 48 or 52
                const netInc = (s.netW || 0) * cw + eaip;
                const grossInc = (s.grossW || 0) * cw + eaipG;
                const savBudgeted = Math.round((s.savW || 0) * cw);
                const remBudgeted = Math.round((s.remW || 0) * cw);
                const notBudgeted = Math.max(0, remBudgeted);
                const snapCEaip = s.cEaipNet !== undefined ? s.cEaipNet : curCEaipNet;
                const snapKEaip = s.kEaipNet !== undefined ? s.kEaipNet : curKEaipNet;
                const snapCEaipG = s.eaipGross !== undefined ? ((s.cEaipNet || 0) + ((s.eaipGross || 0) - (s.eaipNet || 0)) * ((s.cEaipNet || 0) / Math.max(s.eaipNet || 1, 1))) : 0;
                // Per-person gross bonus: derive from snapshot data
                const cGrossBonus = includeEaip ? (s.cEaipPct !== undefined ? (s.cSalary || (s.cGrossW || 0) * 52) * (s.cEaipPct / 100) : (curCEaipNet > 0 ? C.cEaipGross : 0)) : 0;
                const kGrossBonus = includeEaip ? (s.kEaipPct !== undefined ? (s.kSalary || (s.kGrossW || 0) * 52) * (s.kEaipPct / 100) : (curKEaipNet > 0 ? C.kEaipGross : 0)) : 0;
                return {
                  date: s.date, label: s.label,
                  Expenses: Math.round((s.expW || 0) * cw),
                  Necessity: Math.round((s.necW || 0) * cw),
                  Discretionary: Math.round((s.disW || 0) * cw),
                  Savings: savBudgeted,
                  "Not Budgeted": notBudgeted,
                  "Net Salary": Math.round(netInc),
                  [p1NetKey]: Math.round(((s.cNetW || 0) * cw) + (includeEaip ? snapCEaip : 0)),
                  [p2NetKey]: Math.round(((s.kNetW || 0) * cw) + (includeEaip ? snapKEaip : 0)),
                  "Gross Salary": Math.round(grossInc),
                  [p1GrossKey]: Math.round((s.cGrossW || 0) * cw + cGrossBonus),
                  [p2GrossKey]: Math.round((s.kGrossW || 0) * cw + kGrossBonus),
                };
              });
              const cs = { borderRadius: 10, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,.1)" };
              const hasPerPerson = sorted.some(s => (s.cNetW && s.kNetW) || (s.cGrossW && s.kGrossW));
              const modeBtn = (cur, val, label, color, setter) => <button onClick={() => setter(val)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, border: cur === val ? `2px solid ${color}` : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: cur === val ? (color === "#556FB5" ? "#EEF1FA" : color + "22") : "transparent", color: cur === val ? color : "var(--tx3, #888)", cursor: "pointer" }}>{label}</button>;
              const xTF = v => v === "Now" ? "Now" : String(v).slice(0, 4);
              const CAT_COLORS_H = ["#E8573A", "#F2A93B", "#4ECDC4", "#556FB5", "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#95A5A6", "#D35400", "#C0392B", "#3498DB", "#8E44AD", "#27AE60", "#F39C12", "#16A085"];
              const histMode = catHistMode, histView = itemHistMode, isCat = histView === "category";
              const allCatsH = new Set(); snapshots.forEach(sn => { if (sn.items) Object.values(sn.items).forEach(d => { if (d.c && d.t !== "S") allCatsH.add(d.c); }); }); ewk.forEach(e => { if (e.c) allCatsH.add(e.c); });
              const catListH = [...allCatsH].sort();
              const allNamesH = new Set(); snapshots.forEach(sn => { if (sn.items) Object.keys(sn.items).forEach(k => allNamesH.add(k)); }); ewk.forEach(e => allNamesH.add(e.n)); savSorted.forEach(sv => allNamesH.add(sv.n));
              const namesH = [...allNamesH].sort();
              const selCat = catHistoryName || catListH[0] || "", selItem = itemHistoryName || namesH[0] || "";
              const ccMap = {}; catListH.forEach((c, i) => { ccMap[c] = CAT_COLORS_H[i % CAT_COLORS_H.length]; });
              const icMap = {}; namesH.forEach((n, i) => { icMap[n] = CAT_COLORS_H[i % CAT_COLORS_H.length]; });
              const sortedH = [...snapshots].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
              const hPts = [...sortedH, { date: "Now", label: "Current", _current: true }];
              const sCatD = hPts.map(sn => { const row = { date: sn.date, label: sn.label }; if (sn._current) { catListH.forEach(c => { row[c] = Math.round(ewk.filter(e => e.c === c).reduce((sm, e) => sm + e.wk * chartWeeks, 0)); }); row._incLine = Math.round(savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks + (includeEaip ? C.eaipGross : 0) : C.net * chartWeeks + (includeEaip ? C.eaipNet : 0)); } else { catListH.forEach(c => { let tot = 0; if (sn.items) Object.values(sn.items).forEach(d => { if (d.c === c && d.t !== "S") tot += d.v || 0; }); row[c] = Math.round(tot); }); const snapEaipN = sn.eaipNet !== undefined ? sn.eaipNet : curEaipNet; const snapEaipG = sn.eaipGross !== undefined ? sn.eaipGross : curEaipGross; row._incLine = Math.round(savRateBase === "gross" ? (sn.grossW || 0) * chartWeeks + (includeEaip ? snapEaipG : 0) : (sn.netW || 0) * chartWeeks + (includeEaip ? snapEaipN : 0)); } return row; });
              const lcp = sCatD[sCatD.length - 1] || {}; const clSorted = [...catListH].sort((a, b) => (lcp[b] || 0) - (lcp[a] || 0));
              const sItemD = hPts.map(sn => { const row = { date: sn.date, label: sn.label }; if (sn._current) { namesH.forEach(n => { const ex = ewk.find(x => x.n === n); const sv = savSorted.find(x => x.n === n); row[n] = Math.round((ex ? ex.wk * chartWeeks : sv ? sv.wk * chartWeeks : 0) * 100) / 100; }); row._incLine = Math.round(savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks + (includeEaip ? C.eaipGross : 0) : C.net * chartWeeks + (includeEaip ? C.eaipNet : 0)); } else { namesH.forEach(n => { row[n] = sn.items?.[n]?.v || 0; }); const snapEaipN = sn.eaipNet !== undefined ? sn.eaipNet : curEaipNet; const snapEaipG = sn.eaipGross !== undefined ? sn.eaipGross : curEaipGross; row._incLine = Math.round(savRateBase === "gross" ? (sn.grossW || 0) * chartWeeks + (includeEaip ? snapEaipG : 0) : (sn.netW || 0) * chartWeeks + (includeEaip ? snapEaipN : 0)); } return row; });
              const lip = sItemD[sItemD.length - 1] || {}; const nlSorted = [...namesH].sort((a, b) => (lip[b] || 0) - (lip[a] || 0)).slice(0, 12);
              const curCatT = ewk.filter(e => e.c === selCat).reduce((sm, e) => sm + e.wk * chartWeeks, 0);
              const catLD = hPts.map(sn => { if (sn._current) return { date: "Now", label: "Current", value: Math.round(curCatT) }; let tot = 0; if (sn.items) Object.values(sn.items).forEach(d => { if (d.c === selCat && d.t !== "S") tot += d.v || 0; }); return { date: sn.date, label: sn.label, value: Math.round(tot) }; });
              const curItemV = (() => { const ex = ewk.find(x => x.n === selItem); const sv = savSorted.find(x => x.n === selItem); return ex ? ex.wk * chartWeeks : sv ? sv.wk * chartWeeks : 0; })();
              const itemLD = hPts.map(sn => { if (sn._current) return { date: "Now", label: "Current", value: Math.round(curItemV * 100) / 100 }; return { date: sn.date, label: sn.label, value: sn.items?.[selItem]?.v || 0 }; });
              const chartComponents = {
                pieCategory: dragWrapRender("pieCategory", <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>By Category <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>(% of {savRateBase} income)</span></h3><div style={{ width: "100%", minHeight: 280 }}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={catTot} cx="50%" cy="50%" outerRadius={95} innerRadius={48} paddingAngle={2} dataKey="value" stroke="none">{catTot.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<PieTooltip />} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></Card>),
                pieNecDis: dragWrapRender("pieNecDis", <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Necessity vs Discretionary <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(% of {savRateBase} income)</span></h3><div style={{ width: "100%", minHeight: 280 }}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={typTot} cx="50%" cy="50%" outerRadius={95} innerRadius={48} paddingAngle={3} dataKey="value" stroke="none">{typTot.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<PieTooltip />} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></Card>),
                budgetVsSalary: dragWrapRender("budgetVsSalary", <Card key={`bvs-${chartWeeks}-${includeEaip}-${savRateBase}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Budget vs {savRateBase === "gross" ? "Gross" : "Net"} Salary <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({chartWeeks}wk)</span></h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><AreaChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area type="monotone" dataKey="Expenses" stackId="1" stroke="#E8573A" fill="#E8573A" fillOpacity={0.6} /><Area type="monotone" dataKey="Savings" stackId="1" stroke="#2ECC71" fill="#2ECC71" fillOpacity={0.6} /><Area type="monotone" dataKey="Not Budgeted" stackId="1" stroke="#95A5A6" fill="#95A5A6" fillOpacity={0.3} /><Line type="monotone" dataKey={savRateBase === "gross" ? "Gross Salary" : "Net Salary"} stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={savRateBase === "gross" ? "Gross Salary" : "Net Salary"} /></AreaChart></ResponsiveContainer></div></Card>),
                necVsDis: dragWrapRender("necVsDis", <Card key={`nvd-${chartWeeks}-${includeEaip}-${savRateBase}-${necDisMode}`}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Necessity vs Discretionary <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({chartWeeks}wk)</span></h3>{modeBtn(necDisMode, "line", "Line", "#556FB5", setNecDisMode)}{modeBtn(necDisMode, "stacked", "Stacked", "#E8573A", setNecDisMode)}</div><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}>{necDisMode === "stacked" ? (<AreaChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area type="monotone" dataKey="Necessity" stackId="1" stroke="#556FB5" fill="#556FB5" fillOpacity={0.6} /><Area type="monotone" dataKey="Discretionary" stackId="1" stroke="#E8573A" fill="#E8573A" fillOpacity={0.6} /><Area type="monotone" dataKey="Savings" stackId="1" stroke="#2ECC71" fill="#2ECC71" fillOpacity={0.6} /><Area type="monotone" dataKey="Not Budgeted" stackId="1" stroke="#95A5A6" fill="#95A5A6" fillOpacity={0.3} /></AreaChart>) : (<LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Necessity" stroke="#556FB5" strokeWidth={2.5} dot={{ r: 4, fill: "#556FB5" }} /><Line type="monotone" dataKey="Discretionary" stroke="#E8573A" strokeWidth={2.5} dot={{ r: 4, fill: "#E8573A" }} /><Line type="monotone" dataKey="Savings" stroke="#2ECC71" strokeWidth={2} dot={{ r: 3, fill: "#2ECC71" }} /><Line type="monotone" dataKey="Not Budgeted" stroke="#95A5A6" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "#95A5A6" }} /></LineChart>)}</ResponsiveContainer></div></Card>),
                netSalary: dragWrapRender("netSalary", <Card key={`ns-${chartWeeks}-${includeEaip}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Net Salary ({chartWeeks}wk){includeEaip && <span style={{ fontSize: 12, fontWeight: 500, color: "#9B59B6" }}> + Bonus</span>}</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Net Salary" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={includeEaip ? "Net Salary + Bonus" : "Net Salary"} />{hasPerPerson && <Line type="monotone" dataKey={p1NetKey} stroke="#556FB5" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#556FB5" }} />}{hasPerPerson && <Line type="monotone" dataKey={p2NetKey} stroke="#E8573A" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#E8573A" }} />}</LineChart></ResponsiveContainer></div></Card>),
                grossSalary: dragWrapRender("grossSalary", <Card key={`gs-${chartWeeks}-${includeEaip}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Gross Salary ({chartWeeks}wk){includeEaip && <span style={{ fontSize: 12, fontWeight: 500, color: "#9B59B6" }}> + Bonus</span>}</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Gross Salary" stroke="#F2A93B" strokeWidth={2.5} dot={{ r: 4, fill: "#F2A93B" }} name={includeEaip ? "Gross + Bonus" : "Gross Salary"} />{hasPerPerson && <Line type="monotone" dataKey={p1GrossKey} stroke="#556FB5" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#556FB5" }} />}{hasPerPerson && <Line type="monotone" dataKey={p2GrossKey} stroke="#E8573A" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#E8573A" }} />}</LineChart></ResponsiveContainer></div></Card>),
                budgetHistory: snapshots.length > 1 ? dragWrapRender("budgetHistory", <Card key={`bh-${chartWeeks}-${includeEaip}-${savRateBase}`}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}><h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Budget History <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({chartWeeks}wk)</span></h3>{modeBtn(histView, "category", "Category", "#556FB5", setItemHistMode)}{modeBtn(histView, "item", "Item", "#E67E22", setItemHistMode)}<span style={{ width: 1, height: 20, background: "var(--bdr, #ddd)" }} />{modeBtn(histMode, "line", "Line", "#4ECDC4", setCatHistMode)}{modeBtn(histMode, "stacked", "Stacked", "#E8573A", setCatHistMode)}{histMode === "line" && isCat && <select value={selCat} onChange={e => setCatHistoryName(e.target.value)} style={{ border: "2px solid #e0e0e0", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa" }}>{catListH.map(c => <option key={c} value={c}>{c}</option>)}</select>}{histMode === "line" && !isCat && <select value={selItem} onChange={e => setItemHistoryName(e.target.value)} style={{ border: "2px solid #e0e0e0", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa" }}>{namesH.map(n => <option key={n} value={n}>{n}</option>)}</select>}</div><div style={{ width: "100%", minHeight: 300 }}><ResponsiveContainer width="100%" height={300}>{histMode === "stacked" ? (isCat ? (<AreaChart data={sCatD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 9 }} />{clSorted.map(c => <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={ccMap[c]} fill={ccMap[c]} fillOpacity={0.6} />)}<Line type="monotone" dataKey="_incLine" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={savRateBase === "gross" ? "Gross Income" : "Net Income"} /></AreaChart>) : (<AreaChart data={sItemD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 9 }} />{nlSorted.map(n => <Area key={n} type="monotone" dataKey={n} stackId="1" stroke={icMap[n]} fill={icMap[n]} fillOpacity={0.6} />)}<Line type="monotone" dataKey="_incLine" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={savRateBase === "gross" ? "Gross Income" : "Net Income"} /></AreaChart>)) : (isCat ? (<LineChart data={catLD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Line type="monotone" dataKey="value" stroke={ccMap[selCat] || "#556FB5"} strokeWidth={2.5} dot={{ r: 4, fill: ccMap[selCat] || "#556FB5" }} name={selCat} /></LineChart>) : (<LineChart data={itemLD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Line type="monotone" dataKey="value" stroke="#556FB5" strokeWidth={2.5} dot={{ r: 4, fill: "#556FB5" }} name={selItem} /></LineChart>))}</ResponsiveContainer></div></Card>, true) : null,
              };
              const validOrder = chartOrder.filter(k => chartComponents[k] !== undefined);
              Object.keys(chartComponents).forEach(k => { if (!validOrder.includes(k)) validOrder.push(k); });
              return (
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
                  {validOrder.filter(k => chartComponents[k]).map(k => chartComponents[k])}
                </div>
              );
            })()}

            {snapshots.length > 0 && (
              <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Snapshot History</h3>
                  <button onClick={() => setSnapHistView(p => p === "years" ? "all" : "years")} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, border: "2px solid #556FB5", borderRadius: 6, background: snapHistView === "all" ? "#EEF1FA" : "transparent", color: "#556FB5", cursor: "pointer" }}>
                    {snapHistView === "years" ? "Show All" : "Group by Year"}
                  </button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "100px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, fontSize: 9, fontWeight: 700, color: "#999", marginBottom: 6, minWidth: 850 }}>
                    <span>Date</span><span>Label</span><span style={{ textAlign: "right" }}>Net Income</span><span style={{ textAlign: "right" }}>Expenses</span><span style={{ textAlign: "right" }}>Savings</span><span style={{ textAlign: "right" }}>Bonus</span><span style={{ textAlign: "right" }}>Sav. Rate</span><span style={{ textAlign: "right" }}>Remaining</span><span />
                  </div>
                  {(() => {
                    const sorted = [...snapshots].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                    // Group by year
                    const years = {};
                    sorted.forEach(s => { const yr = (s.date || "").slice(0, 4) || "Unknown"; if (!years[yr]) years[yr] = []; years[yr].push(s); });
                    const yearKeys = Object.keys(years).sort((a, b) => b.localeCompare(a));
                    // Auto-select first year if none selected
                    const activeYear = snapHistYear || yearKeys[0];
                    const renderRow = (s) => {
                      const ri = snapshots.findIndex(x => x.id === s.id);
                      const dateStr = s.date || "";
                      const dateObj = dateStr ? new Date(dateStr + "T00:00:00") : null;
                      const formattedDate = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : dateStr;
                      return (
                        <div key={s.id} style={{ display: "grid", gridTemplateColumns: "100px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, padding: "6px 0", alignItems: "center", borderTop: "1px solid var(--bdr,#f0f0f0)", fontSize: 11, minWidth: 850 }}>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tx, #333)" }}>{formattedDate}</span>
                            <input type="date" value={s.date} onChange={e => { const n = [...snapshots]; n[ri] = { ...n[ri], date: e.target.value }; setSnapshots(n); }} style={{ fontSize: 9, border: "1px solid var(--bdr,#e0e0e0)", borderRadius: 4, padding: "1px 3px", color: "var(--tx3,#888)", background: "transparent", marginTop: 2 }} />
                          </div>
                          <input value={s.label} onChange={e => { const n = [...snapshots]; n[ri] = { ...n[ri], label: e.target.value }; setSnapshots(n); }} style={{ fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#e0e0e0)", borderRadius: 4, padding: "2px 4px", color: "var(--tx,#333)", background: "transparent" }} />
                          <span style={{ textAlign: "right", color: "#4ECDC4" }}>{fmt((s.netW || 0) * 48)}</span>
                          <span style={{ textAlign: "right", color: "#E8573A" }}>{fmt((s.expW || 0) * 48)}</span>
                          <span style={{ textAlign: "right", color: "#2ECC71" }}>{fmt((s.savW || 0) * 48)}</span>
                          <span style={{ textAlign: "right", color: "#9B59B6" }}>{fmt(s.eaipNet || 0)}</span>
                          <span style={{ textAlign: "right", color: "#556FB5" }}>{(s.savRate || 0).toFixed(1)}%</span>
                          <span style={{ textAlign: "right", color: (s.remW || 0) >= 0 ? "#2ECC71" : "#E74C3C" }}>{fmt((s.remW || 0) * 48)}</span>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            <button onClick={() => { setViewingSnap(ri); setTab("budget"); }} style={{ padding: "3px 8px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>View</button>
                            {(s.fullState || s.items) && <button onClick={() => setRestoreConfirm(ri)} style={{ padding: "3px 6px", background: "none", border: "1px solid #F2A93B", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", color: "#F2A93B" }} title={s.fullState ? "Full restore" : "Restores items only"}>↩</button>}
                            <button onClick={() => setSnapshots(snapshots.filter((_, j) => j !== ri))} style={{ padding: "3px 6px", background: "none", border: "1px solid #ddd", borderRadius: 4, fontSize: 10, cursor: "pointer", color: "#ccc" }}>×</button>
                          </div>
                        </div>
                      );
                    };
                    if (snapHistView === "all") {
                      return sorted.map(renderRow);
                    }
                    return yearKeys.map(yr => (
                      <div key={yr}>
                        <div onClick={() => setSnapHistYear(p => p === yr ? null : yr)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer", borderTop: "2px solid var(--bdr2, #d0cdc8)", userSelect: "none" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "var(--tx, #333)" }}>{yr}</span>
                          <span style={{ fontSize: 11, color: "var(--tx3, #999)" }}>({years[yr].length} snapshot{years[yr].length !== 1 ? "s" : ""})</span>
                          <span style={{ fontSize: 12, color: "var(--tx3, #999)", marginLeft: "auto" }}>{activeYear === yr ? "▾" : "▸"}</span>
                        </div>
                        {activeYear === yr && years[yr].map(renderRow)}
                      </div>
                    ));
                  })()}
                </div>
              </Card>
            )}

            {restoreConfirm !== null && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setRestoreConfirm(null)}>
                <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 32, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                  <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>Restore Snapshot?</h3>
                  <p style={{ fontSize: 14, color: "var(--tx2,#555)", margin: "0 0 8px" }}>This will replace your <strong>entire current budget</strong> with:</p>
                  <div style={{ padding: "10px 14px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: "var(--tx,#333)" }}>{snapshots[restoreConfirm]?.label}</div>
                    <div style={{ fontSize: 12, color: "var(--tx3,#888)" }}>{snapshots[restoreConfirm]?.date}</div>
                  </div>
                  <p style={{ fontSize: 13, color: "#E8573A", margin: "0 0 20px" }}>Consider saving a snapshot of your current budget first.</p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setRestoreConfirm(null)} style={{ padding: "9px 20px", border: "2px solid #ddd", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                    <button onClick={() => {
                      const snap = snapshots[restoreConfirm];
                      const fs = snap?.fullState;
                      if (fs) {
                        if (fs.cSal !== undefined) setCS(fs.cSal); if (fs.kSal !== undefined) setKS(fs.kSal);
                        if (fs.fil) setFil(fs.fil); if (fs.cEaip !== undefined) setCE(fs.cEaip); if (fs.kEaip !== undefined) setKE(fs.kEaip);
                        if (fs.preDed) setPreDed(fs.preDed); if (fs.postDed) setPostDed(fs.postDed);
                        if (fs.c4pre !== undefined) setC4pre(fs.c4pre); if (fs.c4ro !== undefined) setC4ro(fs.c4ro);
                        if (fs.k4pre !== undefined) setK4pre(fs.k4pre); if (fs.k4ro !== undefined) setK4ro(fs.k4ro);
                        if (fs.cHsaAnn !== undefined) setCHsaAnn(fs.cHsaAnn); if (fs.kHsaAnn !== undefined) setKHsaAnn(fs.kHsaAnn);
                        if (fs.exp) setExp(fs.exp); if (fs.sav) setSav(fs.sav);
                        if (fs.cats) setCats(fs.cats); if (fs.tax) setTax(fs.tax);
                      } else if (snap?.items) {
                        // Rebuild exp/sav from snapshot items
                        const newExp = []; const newSav = []; const newCats = new Set(cats);
                        Object.entries(snap.items).forEach(([name, data]) => {
                          if (data.c) newCats.add(data.c);
                          if (data.t === "S") { newSav.push({ n: name, v: String(Math.round((data.v || 0) / 12 * 100) / 100), p: "m", c: data.c || "Other" }); }
                          else { newExp.push({ n: name, c: data.c || "General", t: data.t || "N", v: String(Math.round((data.v || 0) / 12 * 100) / 100), p: "m" }); }
                        });
                        setExp(newExp); setSav(newSav); setCats([...newCats]);
                        if (snap.cSalary) setCS(String(snap.cSalary));
                        if (snap.kSalary) setKS(String(snap.kSalary));
                      }
                      setRestoreConfirm(null); setTab("budget");
                    }} style={{ padding: "9px 20px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Restore</button>
                  </div>
                </div>
              </div>
            )}

            {snapshots.length === 0 && <Card style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 14, color: "#999" }}>No snapshots yet. Save your first above to start tracking trends.</div></Card>}
          </div>
        )}
      </div>
    </div>
    </VisColsCtx.Provider>
  );
}
