import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TAX_DB, DEF_TAX, STATE_ABBR, STATE_TAX, STATE_PAYROLL, DEF_CATS, DEF_PRE, DEF_POST, DEF_EXP, DEF_SAV_CATS, DEF_SAV } from "./data/taxDB.js";
import { evalF, resolveFormula, calcMatch, calcFed, getMarg, calcStateTax, getStateMarg, toWk, fromWk, fmt, fp, p2, pctOf } from "./utils/calc.js";
import { useM, Card, SH, CSH, NI, PI, EditTxt, VisColsCtx, Row, ExpRowInner, SavRowInner } from "./components/ui.jsx";
import CategoriesTab from "./tabs/CategoriesTab.jsx";
import IncomeTab from "./tabs/IncomeTab.jsx";
import TaxRatesTab from "./tabs/TaxRatesTab.jsx";
import BudgetTab, { BudgetToolbar } from "./tabs/BudgetTab.jsx";
import ChartsTab from "./tabs/ChartsTab.jsx";
import SnapshotViewTab from "./tabs/SnapshotViewTab.jsx";




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

  const budgetTotal = (savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks : C.net * chartWeeks) + (includeEaip ? (savRateBase === "gross" ? C.eaipGross : C.eaipNet) : 0);
  const allocatedTotal = (tExpW + tSavW) * 48;
  const unallocatedPct = budgetTotal > 0 ? ((budgetTotal - allocatedTotal) / budgetTotal * 100).toFixed(1) : "0";

  const catTot = useMemo(() => { const m = {}; ewk.forEach(e => { if (e.wk > 0) m[e.c] = (m[e.c] || 0) + e.wk * 48; }); return Object.entries(m).map(([k, v], i) => ({ name: k, value: Math.round(v), _allValues: [budgetTotal], _base: budgetTotal, color: ["#E8573A", "#F2A93B", "#4ECDC4", "#556FB5", "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#95A5A6", "#D35400", "#C0392B", "#3498DB"][i % 12] })); }, [ewk, budgetTotal, chartWeeks]);

  const typTot = useMemo(() => {
    let n = 0, d = 0, s = 0;
    ewk.forEach(e => { e.t === "N" ? n += e.wk * 48 : d += e.wk * 48; });
    savSorted.forEach(e => s += e.wk * 48);
    s += Math.max(0, remW) * 48; // add remaining to savings
    if (includeEaip) s += C.eaipNet; // add Bonus to savings
    const base = savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks + (includeEaip ? C.eaipGross : 0) : C.net * chartWeeks + (includeEaip ? C.eaipNet : 0);
    const vals = [n, d, s, Math.max(0, base - n - d - s)];
    return [
      { name: "Necessity", value: Math.round(n), _allValues: vals, color: "#556FB5" },
      { name: "Discretionary", value: Math.round(d), _allValues: vals, color: "#E8573A" },
      { name: "Savings" + (includeEaip ? " + Bonus" : ""), value: Math.round(s), _allValues: vals, color: "#2ECC71" },
    ].filter(x => x.value > 0);
  }, [ewk, savSorted, savRateBase, C, includeEaip, remW, chartWeeks]);

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

  const restoreFullState = useCallback((idx) => {
    const snap = snapshots[idx];
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
  }, [snapshots, cats]);



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
        {tab === "budget" && viewingSnap === null && <BudgetToolbar mob={mob} dk={dk} waf={waf} C={C} moC={moC} y4={y4} y5={y5} tSavW={tSavW} remY52={remY52} bannerOpen={bannerOpen} setBannerOpen={setBannerOpen} toolbarOpen={toolbarOpen} setToolbarOpen={setToolbarOpen} visCols={visCols} setVisCols={setVisCols} sortBy={sortBy} setSortBy={setSortBy} sortDir={sortDir} setSortDir={setSortDir} hlThresh={hlThresh} setHlThresh={setHlThresh} hlPeriod={hlPeriod} setHlPeriod={setHlPeriod} showPerPerson={showPerPerson} setShowPerPerson={setShowPerPerson} isMixed={isMixed} allExpanded={allExpanded} expandAll={expandAll} collapseAll={collapseAll} toggleAll={toggleAll} setShowAddItem={setShowAddItem} setShowBulkAdd={setShowBulkAdd} cats={cats} setBulkTargets={setBulkTargets} setBulkName={setBulkName} setBulkVal={setBulkVal} setBulkCat={setBulkCat} snapshots={snapshots} />}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: mob ? "12px 10px 60px" : "24px 20px 60px" }}>

        {/* ═══ TAX RATES ═══ */}
        {tab === "taxes" && <TaxRatesTab mob={mob} tax={tax} upTax={upTax} upP1State={upP1State} upP2State={upP2State} setTax={setTax} p1Name={p1Name} p2Name={p2Name} fil={fil} C={C} allTaxDB={allTaxDB} loadTaxYear={loadTaxYear} showTaxPaste={showTaxPaste} setShowTaxPaste={setShowTaxPaste} taxPaste={taxPaste} setTaxPaste={setTaxPaste} addTaxYear={addTaxYear} fetchStatus={fetchStatus} setFetchStatus={setFetchStatus} />}

        {/* ═══ INCOME ═══ */}
        {tab === "settings" && <IncomeTab mob={mob} p1Name={p1Name} setP1Name={setP1Name} p2Name={p2Name} setP2Name={setP2Name} cSal={cSal} setCS={setCS} kSal={kSal} setKS={setKS} cEaip={cEaip} setCE={setCE} kEaip={kEaip} setKE={setKE} fil={fil} setFil={setFil} c4pre={c4pre} setC4pre={setC4pre} c4ro={c4ro} setC4ro={setC4ro} k4pre={k4pre} setK4pre={setK4pre} k4ro={k4ro} setK4ro={setK4ro} tax={tax} upTax={upTax} cHsaAnn={cHsaAnn} setCHsaAnn={setCHsaAnn} kHsaAnn={kHsaAnn} setKHsaAnn={setKHsaAnn} preDed={preDed} setPreDed={setPreDed} postDed={postDed} setPostDed={setPostDed} C={C} />}

        {/* ═══ CATEGORIES ═══ */}
        {tab === "cats" && <CategoriesTab mob={mob} cats={cats} setCats={setCats} newCat={newCat} setNewCat={setNewCat} savCats={savCats} setSavCats={setSavCats} />}

        {/* ═══ BUDGET SNAPSHOT VIEW ═══ */}
        {tab === "budget" && viewingSnap !== null && snapshots[viewingSnap] && <SnapshotViewTab mob={mob} viewingSnap={viewingSnap} setViewingSnap={setViewingSnap} snapshots={snapshots} setSnapshots={setSnapshots} recalcSnap={recalcSnap} snapVisCols={snapVisCols} setSnapVisCols={setSnapVisCols} snapTab={snapTab} setSnapTab={setSnapTab} p1Name={p1Name} p2Name={p2Name} tax={tax} allTaxDB={allTaxDB} fil={fil} cats={cats} savCats={savCats} />}

        {tab === "budget" && viewingSnap === null && <BudgetTab mob={mob} C={C} moC={moC} y4={y4} y5={y5} visCols={visCols} p1Name={p1Name} p2Name={p2Name} tax={tax} preDed={preDed} postDed={postDed} showPerPerson={showPerPerson} collapsed={collapsed} toggleSec={toggleSec} necI={necI} disI={disI} savSorted={savSorted} cats={cats} savCats={savCats} updExp={updExp} updSav={updSav} rmExp={rmExp} rmSav={rmSav} tNW={tNW} tDW={tDW} tExpW={tExpW} tSavW={tSavW} remW={remW} remY48={remY48} remY52={remY52} totalSavPlusRemW={totalSavPlusRemW} showAddItem={showAddItem} setShowAddItem={setShowAddItem} niN={niN} setNiN={setNiN} niC={niC} setNiC={setNiC} niT={niT} setNiT={setNiT} niS={niS} setNiS={setNiS} niP={niP} setNiP={setNiP} niV={niV} setNiV={setNiV} exp={exp} setExp={setExp} sav={sav} setSav={setSav} showBulkAdd={showBulkAdd} setShowBulkAdd={setShowBulkAdd} bulkName={bulkName} setBulkName={setBulkName} bulkVal={bulkVal} setBulkVal={setBulkVal} bulkPer={bulkPer} setBulkPer={setBulkPer} bulkType={bulkType} setBulkType={setBulkType} bulkSec={bulkSec} setBulkSec={setBulkSec} bulkCat={bulkCat} setBulkCat={setBulkCat} bulkTargets={bulkTargets} setBulkTargets={setBulkTargets} snapshots={snapshots} setSnapshots={setSnapshots} recalcSnap={recalcSnap} />}

        {/* ═══ CHARTS ═══ */}
        {tab === "charts" && <ChartsTab mob={mob} C={C} p1Name={p1Name} p2Name={p2Name} tax={tax} snapshots={snapshots} setSnapshots={setSnapshots} snapDate={snapDate} setSnapDate={setSnapDate} snapLabel={snapLabel} setSnapLabel={setSnapLabel} cSal={cSal} kSal={kSal} cEaip={cEaip} kEaip={kEaip} fil={fil} preDed={preDed} postDed={postDed} c4pre={c4pre} c4ro={c4ro} k4pre={k4pre} k4ro={k4ro} cHsaAnn={cHsaAnn} kHsaAnn={kHsaAnn} exp={exp} sav={sav} cats={cats} ewk={ewk} savSorted={savSorted} tNW={tNW} tDW={tDW} tExpW={tExpW} tSavW={tSavW} remW={remW} totalSavPlusRemW={totalSavPlusRemW} savRateBase={savRateBase} setSavRateBase={setSavRateBase} includeEaip={includeEaip} setIncludeEaip={setIncludeEaip} chartWeeks={chartWeeks} setChartWeeks={setChartWeeks} catTot={catTot} typTot={typTot} PieTooltip={PieTooltip} dragWrapRender={dragWrapRender} chartOrder={chartOrder} necDisMode={necDisMode} setNecDisMode={setNecDisMode} catHistMode={catHistMode} setCatHistMode={setCatHistMode} itemHistMode={itemHistMode} setItemHistMode={setItemHistMode} catHistoryName={catHistoryName} setCatHistoryName={setCatHistoryName} itemHistoryName={itemHistoryName} setItemHistoryName={setItemHistoryName} snapHistView={snapHistView} setSnapHistView={setSnapHistView} snapHistYear={snapHistYear} setSnapHistYear={setSnapHistYear} setViewingSnap={setViewingSnap} setTab={setTab} restoreConfirm={restoreConfirm} setRestoreConfirm={setRestoreConfirm} restoreFullState={restoreFullState} />}
      </div>
    </div>
    </VisColsCtx.Provider>
  );
}
