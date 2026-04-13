import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TAX_DB, DEF_TAX, STATE_ABBR, STATE_TAX, STATE_PAYROLL, STATE_BRACKETS, DEF_CATS, DEF_PRE, DEF_POST, DEF_EXP, DEF_SAV_CATS, DEF_SAV } from "./data/taxDB.js";
import { evalF, resolveFormula, calcMatch, calcFed, getMarg, calcStateTax, getStateMarg, toWk, fromWk, fmt, fp, p2, pctOf } from "./utils/calc.js";
import { useM, Card, SH, CSH, NI, PI, EditTxt, VisColsCtx, Row, ExpRowInner, SavRowInner } from "./components/ui.jsx";
import ChartsTab from "./tabs/ChartsTab.jsx";
import SnapshotEdit from "./tabs/SnapshotEdit.jsx";
import BudgetTab from "./tabs/BudgetTab.jsx";




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

  const dk = darkMode === "dark" || darkMode === true;
  const waf = darkMode === "waf";
  useEffect(() => { try { localStorage.setItem("budget-theme", darkMode); } catch {} }, [darkMode]);
  useEffect(() => { try { localStorage.setItem("budget-banner", bannerOpen); } catch {} }, [bannerOpen]);
  useEffect(() => { try { localStorage.setItem("budget-toolbar", toolbarOpen); } catch {} }, [toolbarOpen]);
  useEffect(() => { try { localStorage.setItem("budget-cols", JSON.stringify(visCols)); } catch {} }, [visCols]);
  useEffect(() => { try { localStorage.setItem("budget-snap-cols", JSON.stringify(snapVisCols)); } catch {} }, [snapVisCols]);
  useEffect(() => { try { localStorage.setItem("budget-chart-order", JSON.stringify(chartOrder)); } catch {} }, [chartOrder]);
  /* Snapshot restore handler — passed to ChartsTab */
  const handleRestore = useCallback((snap) => {
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
  }, [cats]);
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

        {/* ═══ BUDGET (Snapshot Edit) ═══ */}
        {tab === "budget" && viewingSnap !== null && snapshots[viewingSnap] && <SnapshotEdit
          viewingSnap={viewingSnap} setViewingSnap={setViewingSnap}
          snapshots={snapshots} setSnapshots={setSnapshots} recalcSnap={recalcSnap}
          p1Name={p1Name} p2Name={p2Name} mob={mob} cats={cats} savCats={savCats}
          snapVisCols={snapVisCols} setSnapVisCols={setSnapVisCols}
          snapTab={snapTab} setSnapTab={setSnapTab}
          restoreConfirm={restoreConfirm} setRestoreConfirm={setRestoreConfirm} setTab={setTab}
          tax={tax} fil={fil} allTaxDB={allTaxDB}
        />}

        {tab === "budget" && viewingSnap === null && <BudgetTab
          C={C} ewk={ewk} necI={necI} disI={disI} savSorted={savSorted}
          tNW={tNW} tDW={tDW} tExpW={tExpW} tSavW={tSavW} remW={remW} remY48={remY48} remY52={remY52} totalSavPlusRemW={totalSavPlusRemW}
          moC={moC} y4={y4} y5={y5}
          updExp={updExp} updSav={updSav} rmExp={rmExp} rmSav={rmSav} setExp={setExp} setSav={setSav}
          p1Name={p1Name} p2Name={p2Name} visCols={visCols} cats={cats} savCats={savCats} exp={exp} sav={sav}
          preDed={preDed} postDed={postDed} c4pre={c4pre} c4ro={c4ro} k4pre={k4pre} k4ro={k4ro} cEaip={cEaip} kEaip={kEaip} fil={fil} tax={tax}
          collapsed={collapsed} toggleSec={toggleSec} showPerPerson={showPerPerson}
          showBulkAdd={showBulkAdd} setShowBulkAdd={setShowBulkAdd} bulkName={bulkName} setBulkName={setBulkName}
          bulkVal={bulkVal} setBulkVal={setBulkVal} bulkTargets={bulkTargets} setBulkTargets={setBulkTargets}
          snapshots={snapshots} setSnapshots={setSnapshots} recalcSnap={recalcSnap}
        />}

        {/* ═══ CHARTS ═══ */}
        {tab === "charts" && <ChartsTab C={C} ewk={ewk} savSorted={savSorted} catTot={catTot} typTot={typTot}
          snapshots={snapshots} setSnapshots={setSnapshots}
          tNW={tNW} tDW={tDW} tExpW={tExpW} tSavW={tSavW} remW={remW} totalSavPlusRemW={totalSavPlusRemW}
          chartWeeks={chartWeeks} setChartWeeks={setChartWeeks} includeEaip={includeEaip} setIncludeEaip={setIncludeEaip}
          savRateBase={savRateBase} setSavRateBase={setSavRateBase}
          chartOrder={chartOrder} setChartOrder={setChartOrder} dragChart={dragChart} setDragChart={setDragChart}
          catHistMode={catHistMode} setCatHistMode={setCatHistMode} catHistoryName={catHistoryName} setCatHistoryName={setCatHistoryName}
          itemHistMode={itemHistMode} setItemHistMode={setItemHistMode} itemHistoryName={itemHistoryName} setItemHistoryName={setItemHistoryName}
          necDisMode={necDisMode} setNecDisMode={setNecDisMode}
          snapDate={snapDate} setSnapDate={setSnapDate} snapLabel={snapLabel} setSnapLabel={setSnapLabel}
          snapHistView={snapHistView} setSnapHistView={setSnapHistView} snapHistYear={snapHistYear} setSnapHistYear={setSnapHistYear}
          restoreConfirm={restoreConfirm} setRestoreConfirm={setRestoreConfirm}
          p1Name={p1Name} p2Name={p2Name} mob={mob} evalF={evalF}
          cSal={cSal} kSal={kSal} fil={fil} cEaip={cEaip} kEaip={kEaip}
          preDed={preDed} postDed={postDed} c4pre={c4pre} c4ro={c4ro} k4pre={k4pre} k4ro={k4ro}
          cHsaAnn={cHsaAnn} kHsaAnn={kHsaAnn} exp={exp} sav={sav} cats={cats} tax={tax}
          setViewingSnap={setViewingSnap} setTab={setTab} onRestore={handleRestore}
        />}
      </div>
    </div>
    </VisColsCtx.Provider>
  );
}
