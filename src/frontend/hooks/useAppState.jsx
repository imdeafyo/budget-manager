import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TAX_DB, DEF_TAX, STATE_ABBR, STATE_TAX, STATE_PAYROLL, DEF_CATS, DEF_PRE, DEF_POST, DEF_EXP, DEF_SAV_CATS, DEF_SAV, DEF_TRANSFER_CATS, DEF_INCOME_CATS, defaultForecastAccounts } from "../data/taxDB.js";
import { evalF, resolveFormula, calcMatch, calcFed, getMarg, calcStateTax, getStateMarg, toWk, fromWk, fmt, fp, p2, pctOf, recalcMilestonePure } from "../utils/calc.js";
import { BUILTIN_COLUMNS, newTransaction } from "../utils/transactions.js";
import { reconstructFromItems, compareBudgetToActual } from "../utils/budgetCompare.js";
import { ensureIds, newItemId, firstSaveAction } from "../utils/itemIds.js";
import log from "../utils/log.js";
import { apiFetch } from "../utils/apiFetch.js";
import { useM } from "../components/ui.jsx";

/* ── Runtime mode. "deploy" uses /api/transactions; "generic" bundles
   transactions into localStorage via the main st blob. The build-generic
   script rewrites this constant to "generic" when assembling the single-file HTML. */
const MODE = "deploy";

/* ══════════════════════════ useAppState ══════════════════════════ */
export default function useAppState() {
  const mob = useM();
  const VALID_TABS = ["budget","taxes","settings","charts","cats","transactions","prefs"];
  // Subtabs per top-level tab. Only Budget and Charts have subtabs; others are ignored.
  // Defaults: budget→live, charts→trends. Forecast is now charts/forecast (no longer top-level).
  // Hash format:
  //   #<tab>                           — default subtab
  //   #<tab>/<sub>                     — non-default subtab
  //   #budget/milestones/<idx>         — viewing a milestone in the milestones subtab
  // Back-compat: pre-restructure used #budget/ms/N and bare #budget for the live view; both still parse.
  // Pre-restructure top-level #forecast redirects to #charts/forecast.
  const VALID_SUBTABS = { budget: ["live", "milestones", "compare"], charts: ["trends", "forecast", "advanced"] };
  const DEFAULT_SUBTAB = { budget: "live", charts: "trends" };
  const parseHash = () => {
    const h = location.hash.replace("#","");
    const parts = h.split("/");
    let t = parts[0];
    if (t === "forecast") return { tab: "charts", sub: "forecast", ms: null };
    if (!VALID_TABS.includes(t)) return { tab: "budget", sub: DEFAULT_SUBTAB.budget, ms: null };
    let sub = DEFAULT_SUBTAB[t];
    let ms = null;
    if (t === "budget") {
      // #budget/ms/N (legacy) or #budget/milestones/N → milestones subtab, viewing N
      if (parts[1] === "ms" || parts[1] === "milestones") {
        sub = "milestones";
        if (parts[2] !== undefined && parts[2] !== "") {
          const n = parseInt(parts[2], 10);
          if (!isNaN(n)) ms = n;
        }
      } else if (parts[1] && VALID_SUBTABS.budget.includes(parts[1])) {
        sub = parts[1];
      }
    } else if (t === "charts") {
      if (parts[1] && VALID_SUBTABS.charts.includes(parts[1])) sub = parts[1];
    }
    return { tab: t, sub, ms };
  };
  const initialHash = parseHash();
  const [tab, setTabRaw] = useState(initialHash.tab);
  const [budgetSubtab, setBudgetSubtabRaw] = useState(initialHash.tab === "budget" ? initialHash.sub : "live");
  const [chartsSubtab, setChartsSubtabRaw] = useState(initialHash.tab === "charts" ? initialHash.sub : "trends");
  const skipPush = useRef(false);
  const [viewingMs, setViewingMsRaw] = useState(initialHash.ms);
  const buildHash = (t, bSub, cSub, ms) => {
    if (t === "budget") {
      if (bSub === "milestones") {
        return ms !== null && ms !== undefined ? `#budget/milestones/${ms}` : "#budget/milestones";
      }
      if (bSub === "compare") return "#budget/compare";
      return "#budget";
    }
    if (t === "charts") return cSub === "trends" ? "#charts" : `#charts/${cSub}`;
    return "#" + t;
  };
  const setTab = useCallback((t) => {
    setTabRaw(t);
    if (!skipPush.current) {
      // Reset subtabs to default and clear ms when switching tabs.
      const bSub = t === "budget" ? budgetSubtab : "live";
      const cSub = t === "charts" ? chartsSubtab : "trends";
      // When switching away from budget, drop viewingMs.
      const ms = t === "budget" && bSub === "milestones" ? viewingMs : null;
      if (t !== "budget") setViewingMsRaw(null);
      const newHash = buildHash(t, bSub, cSub, ms);
      log.info("route.setTab", { from: location.hash, to: newHash });
      history.pushState({ tab: t, sub: t === "budget" ? bSub : cSub, ms }, "", newHash);
    }
    skipPush.current = false;
  }, [budgetSubtab, chartsSubtab, viewingMs]);
  const setBudgetSubtab = useCallback((sub) => {
    setBudgetSubtabRaw(sub);
    // Leaving the milestones subtab clears any milestone detail view.
    const ms = sub === "milestones" ? viewingMs : null;
    if (sub !== "milestones") setViewingMsRaw(null);
    if (!skipPush.current) {
      const newHash = buildHash("budget", sub, chartsSubtab, ms);
      log.info("route.budgetSub", { from: location.hash, to: newHash });
      history.pushState({ tab: "budget", sub, ms }, "", newHash);
    }
    skipPush.current = false;
  }, [chartsSubtab, viewingMs]);
  const setChartsSubtab = useCallback((sub) => {
    setChartsSubtabRaw(sub);
    if (!skipPush.current) {
      const newHash = buildHash("charts", budgetSubtab, sub, null);
      log.info("route.chartsSub", { from: location.hash, to: newHash });
      history.pushState({ tab: "charts", sub, ms: null }, "", newHash);
    }
    skipPush.current = false;
  }, [budgetSubtab]);
  const setViewingMs = useCallback((v) => {
    setViewingMsRaw(v);
    // Viewing a milestone implies budget→milestones subtab.
    if (v !== null) setBudgetSubtabRaw("milestones");
    if (!skipPush.current) {
      const t = v !== null ? "budget" : tab;
      const bSub = v !== null ? "milestones" : budgetSubtab;
      const newHash = buildHash(t, bSub, chartsSubtab, v);
      log.info("route.viewingMs", { from: location.hash, to: newHash, ms: v });
      history.pushState({ tab: t, sub: t === "budget" ? bSub : chartsSubtab, ms: v }, "", newHash);
    }
    skipPush.current = false;
  }, [tab, budgetSubtab, chartsSubtab]);
  useEffect(() => {
    // set initial history entry so first back works
    const init = parseHash();
    if (!location.hash) {
      history.replaceState({ tab: "budget", sub: "live", ms: null }, "", "#budget");
    } else {
      history.replaceState({ tab: init.tab, sub: init.sub, ms: init.ms }, "", buildHash(init.tab, init.tab === "budget" ? init.sub : "live", init.tab === "charts" ? init.sub : "trends", init.ms));
    }
    const onPop = (e) => {
      const s = e.state;
      log.info("route.popstate", { hash: location.hash, hasState: !!s, tab: s?.tab, sub: s?.sub, ms: s?.ms });
      skipPush.current = true;
      if (s && VALID_TABS.includes(s.tab)) {
        setTabRaw(s.tab);
        // Back-compat: pre-rename pushStates used `snap`; pre-restructure used flat ms.
        const msVal = s.ms !== undefined ? s.ms : s.snap;
        setViewingMsRaw(msVal !== null && msVal !== undefined ? msVal : null);
        // Restore subtabs from popstate
        if (s.tab === "budget") {
          const bSub = s.sub && VALID_SUBTABS.budget.includes(s.sub) ? s.sub
            : (msVal !== null && msVal !== undefined ? "milestones" : "live");
          setBudgetSubtabRaw(bSub);
        } else if (s.tab === "charts") {
          setChartsSubtabRaw(s.sub && VALID_SUBTABS.charts.includes(s.sub) ? s.sub : "trends");
        }
      } else {
        // Fallback: re-parse from URL
        const p = parseHash();
        setTabRaw(p.tab);
        setViewingMsRaw(p.ms);
        if (p.tab === "budget") setBudgetSubtabRaw(p.sub);
        else if (p.tab === "charts") setChartsSubtabRaw(p.sub);
      }
      skipPush.current = false;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
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
  // IRA annual contributions in dollars (NOT percent of salary, unlike 401(k)).
  // IRA limits aren't payroll-deducted so a flat-dollar input matches how
  // people actually plan IRA contributions ("I put $7000/yr in my Roth").
  // Used by AdvancedForecastTab → autoContribFor for ira_traditional / ira_roth
  // account types so users don't have to type the same number twice.
  const [cIraTrad, setCIraTrad] = useState("0"); const [cIraRoth, setCIraRoth] = useState("0");
  const [kIraTrad, setKIraTrad] = useState("0"); const [kIraRoth, setKIraRoth] = useState("0");
  const [exp, setExp] = useState(DEF_EXP);
  const [sav, setSav] = useState(DEF_SAV);
  const [cats, setCats] = useState(DEF_CATS);
  const [savCats, setSavCats] = useState(DEF_SAV_CATS);
  const [transferCats, setTransferCats] = useState(DEF_TRANSFER_CATS);
  const [incomeCats, setIncomeCats] = useState(DEF_INCOME_CATS);
  const [newCat, setNewCat] = useState("");
  /* The block below converts ephemeral UI toggles into per-device prefs.
     Pattern (matches bannerOpen/toolbarOpen above): useState(() => read from
     localStorage with try/catch and a default), paired with a write effect
     in the persistence section at the bottom of this hook. Keys are all
     prefixed with `budget-` so they're easy to spot/clear in DevTools.
     If you add a NEW UI toggle that should persist, follow the same pattern
     and add a write effect — easy to miss the writer and silently regress. */
  const [sortBy, setSortBy] = useState(() => { try { return localStorage.getItem("budget-sort-by") || "default"; } catch { return "default"; } });
  const [sortDir, setSortDir] = useState(() => { try { return localStorage.getItem("budget-sort-dir") || "desc"; } catch { return "desc"; } });
  const [hlThresh, setHlThresh] = useState(() => { try { return localStorage.getItem("budget-hl-thresh") || "200"; } catch { return "200"; } });
  const [hlPeriod, setHlPeriod] = useState(() => { try { return localStorage.getItem("budget-hl-period") || "w"; } catch { return "w"; } });
  const [niN, setNiN] = useState(""); const [niC, setNiC] = useState(DEF_CATS[0]);
  const [niT, setNiT] = useState("N"); const [niS, setNiS] = useState("exp"); const [niP, setNiP] = useState("m"); const [niV, setNiV] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [customIcon, setCustomIcon] = useState(null);
  const [bannerOpen, setBannerOpen] = useState(() => { try { const v = localStorage.getItem("budget-banner"); return v !== null ? v === "true" : (!window.innerWidth || window.innerWidth >= 700); } catch { return true; } });
  const [toolbarOpen, setToolbarOpen] = useState(() => { try { const v = localStorage.getItem("budget-toolbar"); return v !== null ? v === "true" : (!window.innerWidth || window.innerWidth >= 700); } catch { return true; } });
  const [visCols, setVisCols] = useState(() => { try { const v = localStorage.getItem("budget-cols"); return v ? JSON.parse(v) : { wk: true, mo: !window.innerWidth || window.innerWidth >= 700, y48: true, y52: !window.innerWidth || window.innerWidth >= 700 }; } catch { return { wk: true, mo: true, y48: true, y52: true }; } });
  const [showPerPerson, setShowPerPerson] = useState(() => { try { return localStorage.getItem("budget-show-per-person") === "true"; } catch { return false; } });
  const [milestones, setMilestones] = useState([]);
  const [msLabel, setMsLabel] = useState("");
  const [msDate, setMsDate] = useState("");
  const [editMsIdx, setEditMsIdx] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState(null);
  const [itemHistoryName, setItemHistoryName] = useState("");
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkVal, setBulkVal] = useState("");
  const [bulkPer, setBulkPer] = useState("m");
  const [bulkType, setBulkType] = useState("N");
  const [bulkSec, setBulkSec] = useState("exp");
  const [bulkCat, setBulkCat] = useState("");
  const [bulkTargets, setBulkTargets] = useState({});
  const [catChartMode, setCatChartMode] = useState(() => { try { return localStorage.getItem("budget-cat-chart-mode") || "stacked"; } catch { return "stacked"; } });
  const [catHistoryName, setCatHistoryName] = useState("");
  const [catHistMode, setCatHistMode] = useState(() => { try { return localStorage.getItem("budget-cat-hist-mode") || "line"; } catch { return "line"; } });
  const [itemHistMode, setItemHistMode] = useState(() => { try { return localStorage.getItem("budget-item-hist-mode") || "category"; } catch { return "category"; } });
  const [necDisMode, setNecDisMode] = useState(() => { try { return localStorage.getItem("budget-nec-dis-mode") || "line"; } catch { return "line"; } });
  const [msHistView, setMsHistView] = useState(() => { try { return localStorage.getItem("budget-ms-hist-view") || "years"; } catch { return "years"; } });
  /* msHistYear is nullable (year string or null) — JSON-encode so null survives.
     The filter resets to "all years" if storage is unparseable. */
  const [msHistYear, setMsHistYear] = useState(() => { try { const v = localStorage.getItem("budget-ms-hist-year"); return v ? JSON.parse(v) : null; } catch { return null; } });
  const [savRateBase, setSavRateBase] = useState(() => { try { return localStorage.getItem("budget-sav-rate-base") || "net"; } catch { return "net"; } });
  const [chartWeeks, setChartWeeks] = useState(() => { try { const v = localStorage.getItem("budget-chart-weeks"); const n = v ? parseInt(v, 10) : 48; return (n === 48 || n === 52) ? n : 48; } catch { return 48; } });
  // Chart time window: "all" | "ytd" | "1y" | "5y" | "10y"
  // Used by chart date-range filtering. Persisted per-device (layout choice).
  const [chartTimeWindow, setChartTimeWindow] = useState(() => {
    try { return localStorage.getItem("budget-chart-window") || "all"; } catch { return "all"; }
  });
  useEffect(() => { try { localStorage.setItem("budget-chart-window", chartTimeWindow); } catch {} }, [chartTimeWindow]);
  const [msVisCols, setMsVisCols] = useState(() => { try { const v = localStorage.getItem("budget-milestone-cols") || localStorage.getItem("budget-snap-cols"); return v ? JSON.parse(v) : { wk: true, mo: true, y48: true, y52: true }; } catch { return { wk: true, mo: true, y48: true, y52: true }; } });
  const DEF_CHART_ORDER = ["pieCategory", "pieNecDis", "budgetVsSalary", "necVsDis", "netSalary", "grossSalary", "incomeHistory", "budgetHistory"];
  const [chartOrder, setChartOrder] = useState(() => { try { const v = localStorage.getItem("budget-chart-order"); return v ? JSON.parse(v) : DEF_CHART_ORDER; } catch { return DEF_CHART_ORDER; } });
  const [dragChart, setDragChart] = useState(null);
  /* Section collapsed state — persisted per-device because it's a UI layout
     preference, not budget data. The keys must mirror what toggleSec() writes
     (nec, dis, sav, preTax, postTax, postSav, fedTax, stTax, preSav, eaip,
     eaipTax). New section keys should be added to expandAll/collapseAll below
     so the "all" buttons stay accurate. Stored as JSON; parse failures fall
     back to {} (everything expanded). */
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem("budget-collapsed"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("budget-collapsed", JSON.stringify(collapsed)); } catch {} }, [collapsed]);
  const toggleSec = s => setCollapsed(p => ({ ...p, [s]: !p[s] }));
  const allExpanded = !collapsed.nec && !collapsed.dis && !collapsed.sav && !collapsed.preTax && !collapsed.postTax && !collapsed.postSav && !collapsed.fedTax && !collapsed.stTax && !collapsed.preSav && !collapsed.eaip && !collapsed.eaipTax;
  const allCollapsed = collapsed.nec && collapsed.dis && collapsed.sav && collapsed.preTax && collapsed.postTax && collapsed.postSav && collapsed.fedTax && collapsed.stTax && collapsed.preSav && collapsed.eaip && collapsed.eaipTax;
  const isMixed = !allExpanded && !allCollapsed;
  const expandAll = () => setCollapsed({ nec: false, dis: false, sav: false, preTax: false, postTax: false, postSav: false, fedTax: false, stTax: false, preSav: false, eaip: false, eaipTax: false });
  const collapseAll = () => setCollapsed({ nec: true, dis: true, sav: true, preTax: true, postTax: true, postSav: true, fedTax: true, stTax: true, preSav: true, eaip: true, eaipTax: true });
  const toggleAll = () => { if (allExpanded) collapseAll(); else expandAll(); };
  const [includeEaip, setIncludeEaip] = useState(() => { try { return localStorage.getItem("budget-include-eaip") === "true"; } catch { return false; } });

  /* ── Transactions state ──
     transactions: the row array
     transactionColumns: user-defined custom columns (builtins live in BUILTIN_COLUMNS)
     importProfiles: saved CSV mapping profiles (keyed by a user-chosen name)
     categoryAliases: global alias map (per-profile aliases live inside each profile)
     rowCapWarn / rowCapThreshold: user-configurable warning when tx count gets large
     hiddenColumns: ids of built-in or custom columns hidden from the table (toggle-able) */
  const [transactions, setTransactions] = useState([]);
  const [transactionColumns, setTransactionColumns] = useState([]);
  const [importProfiles, setImportProfiles] = useState([]);
  const [categoryAliases, setCategoryAliases] = useState({});
  const [transactionRules, setTransactionRules] = useState([]);
  const [rowCapWarn, setRowCapWarn] = useState(true);
  const [rowCapThreshold, setRowCapThreshold] = useState(10000);
  const [hiddenColumns, setHiddenColumns] = useState([]);
  // Default page size for the transactions table. localStorage takes precedence
  // per device, but this gives users a way to set a sensible cross-device default.
  const [defaultTxPageSize, setDefaultTxPageSize] = useState(100);
  // Phase 5c — transfer detection + refund handling settings.
  const [transferToleranceAmount, setTransferToleranceAmount] = useState(0.01);
  const [transferToleranceDays, setTransferToleranceDays] = useState(2);
  // Confidence threshold (0–1): pairs scoring below this are filtered out of
  // the detection modal. 0 = show every candidate, 1 = perfect match only.
  // Default 0 keeps existing behavior (review everything).
  const [transferConfidenceThreshold, setTransferConfidenceThreshold] = useState(0);
  const [treatRefundsAsNetting, setTreatRefundsAsNetting] = useState(true);

  /* Duplicate-scan settings — used by Transactions toolbar's "🔍 Scan
     duplicates" action. Defaults are conservative: ±3 days catches the
     common posting-date drift case (card processing delays, shared cards),
     $0.01 tolerance is penny-precision, "exact" description requires the
     normalized desc to match (case + whitespace ignored, but reference
     numbers in the description matter — flip to "first-words" to ignore
     them). dupScanFirstWordCount only applies when mode is first-words. */
  const [dupScanDayWindow, setDupScanDayWindow] = useState(0);
  const [dupScanAmountTolerance, setDupScanAmountTolerance] = useState(0.01);
  const [dupScanDescriptionMode, setDupScanDescriptionMode] = useState("exact");
  const [dupScanFirstWordCount, setDupScanFirstWordCount] = useState(2);

  /* Outlier detection settings. `enabled` is the master switch (shows the ⚠
     badge + filter on the Transactions toolbar). `sensitivity` maps to the
     statistical k via kFromSensitivity in utils/outliers.js. `minAbsoluteDelta`
     is the dollar floor — a transaction must exceed its category median by
     at least this many dollars to flag, which kills false positives in
     low-dollar categories (a $120 grocery on an $80 median is statistically
     extreme but not actionable). */
  const [outlierSettings, setOutlierSettings] = useState({
    enabled: true,
    sensitivity: "normal",
    minAbsoluteDelta: 50,
  });

  /* Diagnostics — controls the in-app ring buffer logger (utils/log.js).
     `enabled` gates whether log.* calls actually capture. `persist` writes
     the buffer to localStorage so reloads + crashes preserve recent events.
     `maxEvents` caps buffer size (1–5000). `minLevel` drops events below
     the threshold at the source. Settings → Diagnostics exposes all four. */
  const [diagnostics, setDiagnostics] = useState({
    enabled: true,
    persist: true,
    maxEvents: 500,
    minLevel: "info",
  });

  /* Keep utils/log.js in sync with the user's diagnostics settings. Runs on
     mount with defaults, then on every change. The first call also triggers
     the localStorage load + beforeunload attach inside log.js. */
  useEffect(() => { log.configure(diagnostics); }, [diagnostics]);

  /* Forecast advanced-mode state. `accounts` is the user-defined account
     list (see defaultForecastAccounts in taxDB.js for shape and defaults).
     `hsaCoverage` is the household-level HSA coverage type used by the
     pool-limit calc: "family" (default), "self", or "both-self".
     Simple-mode forecast inputs (return %, horizon, etc.) live in
     localStorage on the Forecast tab; this state field only carries the
     account list and coverage type because those are real data worth
     server-syncing in the deploy build. */
  const [forecast, setForecast] = useState(() => ({
    accounts: defaultForecastAccounts(),
    hsaCoverage: "family",
    /* Annual % growth applied to IRS contribution limits for projection
       years past today. Default 2.5% — the rough long-run nominal pace
       at which the IRS has actually raised 401(k) and HSA limits. Set
       to 0 to freeze limits at today's values. */
    limitGrowthPct: 2.5,
    /* Phase X-A: ending obligations. Array of { id, itemRef, destAccountId,
       effect, mode, endsOn, balance?, annualRate? } describing budget
       lines that will end at a future date, with the freed-up cash
       redirected to a forecast account. Empty by default — UI surfaces
       a section in AdvancedForecastTab to add/edit/delete. See
       utils/endingItems.js for shape and resolveEndingEvents semantics. */
    endingItems: [],
    /* One-time Events: dated lump-sum cash events that hit a single
       account balance at a specific month (car purchase, inheritance,
       rollover, etc). Array of { id, date "YYYY-MM-DD", amount, accountId,
       label }. Empty by default. See utils/oneTimeEvents.js for shape
       + resolveOneTimeEvents semantics. */
    oneTimeEvents: [],
    /* Loans (Phase 14b): amortization tracking on the per-account
       forecast. Each loan is a pure debt record — does NOT debit any
       account directly. The monthly payment is assumed to already be
       in the user's budget (which is what funds Advanced contributions
       via the savings rate). Loans surface remaining balance, payoff
       date, total interest, and amortization curves so the user can
       see when debt clears and how much interest is committed.
       Array of { id, label, principal, originationDate (YYYY-MM-DD
       or YYYY-MM), interestRate (annual %), termMonths,
       extraMonthlyPrincipal (optional, default 0) }.
       Empty by default. See utils/loans.js for shape + resolveLoans
       semantics. */
    loans: [],
    /* === Scenario inputs (moved from localStorage so they sync across devices) ===
       Both Simple and Advanced forecast tabs read/write these through
       setForecast. Display-only prefs (sortMode, colorBy, showChartLegend,
       cardOrder) stay in localStorage — those are per-device UI choices,
       not scenario data.

       Migration: on the first load after this deploy, if `migrated` is
       false/missing, the load handler seeds these fields from this
       device's localStorage and flips the flag. Whichever device is
       opened first wins; subsequent loads ignore localStorage. */
    horizon: 30,
    inflationPct: "3",
    fireEnabled: false,
    fireMultiplier: "25",
    // Simple-only fields
    returnPct: "7",
    incomeGrowthPct: "3",
    initialBalance: "0",
    valueMode: "both",          // both | nominal | real
    targetMonths: "12",
    contribSource: "budget",    // budget | actual
    actualMode: "net",          // net | gross
    forecastWeeks: 52,          // 48 or 52
    forecastBonus: false,
    include401k: true,
    includeMatch: true,
    includeHsa: true,
    migrated: false,
  }));
  const [txLoaded, setTxLoaded] = useState(false);

  // Load
  const [loaded, setLoaded] = useState(false);
  /* lastSavedHash — tracks the JSON of `st` that's currently considered "in
     sync with the server." Set on successful load (so the first auto-save
     after load is suppressed unless something genuinely changed) and
     refreshed on every successful PUT.

     Why this exists: on version-bump deploys, the user's forecast.accounts
     amounts were resetting to zero. The most plausible mechanism is that
     during a brief window (load fail, partial state, render-cycle glitch),
     `forecast` ends up referencing the useState-initializer defaults
     (zero balances), and the auto-save effect — which fires on any `st`
     reference change — pushes those zeros to the server, overwriting good
     data. By comparing JSON of the outgoing payload against the
     last-known-good hash, we refuse to PUT a state we haven't actually
     mutated since the last sync. Combined with the load gate (loaded must
     be true) and the silent-wipe fix (load failures don't set loaded=true),
     this means: a save only happens when the user has demonstrably changed
     state relative to what the server gave us.

     Storing as a ref (not state) so updating it doesn't re-render or
     re-fire the save effect. */
  const lastSavedHashRef = useRef(null);
  /* Stable-IDs phase: when the load-time backfill assigns ids that
     weren't on the server's copy, the state in memory diverges from
     what's persisted. The first-save baseline-stamp (which normally
     skips the PUT because loaded state == server state) would swallow
     that divergence and the ids would never persist. This ref flags
     "the migration changed something, so the first save MUST go through
     instead of just stamping the baseline." */
  const migrationDirtyRef = useRef(false);
  useEffect(() => { (async () => {
    try {
      const res = await apiFetch("/api/state");
      if (!res.ok) {
        console.error("State load failed:", res.status);
        log.error("state.load.fail", { status: res.status, reqId: res.reqId });
        return;
      }
      const r = await res.json();
      if (r?.state) {
        const d = r.state;
        /* snapshots→milestones rename shim: pre-rename saves wrote `snapshots`. Read either; next save writes only `milestones`. */
        if (d.milestones === undefined && d.snapshots !== undefined) { d.milestones = d.snapshots; }
        /* Stable-IDs backfill: ensure every exp/sav item carries a stable
           `id` so Ending Obligation refs and Milestone Compare can match
           by identity rather than name/position. Idempotent — items that
           already have an id pass through untouched. `ensureIds` returns
           the SAME array reference when nothing needed assigning, so a
           reference change is a reliable "the migration did something"
           signal. When it fires, we mark migrationDirtyRef so the first
           auto-save persists the new ids instead of just stamping the
           no-op baseline. */
        if (Array.isArray(d.exp)) {
          const next = ensureIds(d.exp);
          if (next !== d.exp) migrationDirtyRef.current = true;
          d.exp = next;
        }
        if (Array.isArray(d.sav)) {
          const next = ensureIds(d.sav);
          if (next !== d.sav) migrationDirtyRef.current = true;
          d.sav = next;
        }
        if (Array.isArray(d.milestones)) {
          d.milestones = d.milestones.map(ms => {
            if (!ms || typeof ms !== "object" || !ms.fullState) return ms;
            const fs = ms.fullState;
            const nextExp = Array.isArray(fs.exp) ? ensureIds(fs.exp) : fs.exp;
            const nextSav = Array.isArray(fs.sav) ? ensureIds(fs.sav) : fs.sav;
            if (nextExp === fs.exp && nextSav === fs.sav) return ms; // no-op fast path
            migrationDirtyRef.current = true;
            return { ...ms, fullState: { ...fs, exp: nextExp, sav: nextSav } };
          });
        }
        log.info("state.load", {
          source: "api",
          size: JSON.stringify(d).length,
          milestoneCount: Array.isArray(d.milestones) ? d.milestones.length : 0,
          ruleCount: Array.isArray(d.transactionRules) ? d.transactionRules.length : 0,
          legacySnapshotsField: d.snapshots !== undefined,
          reqId: res.reqId,
        });
        const m = { cSal:setCS,kSal:setKS,fil:setFil,cEaip:setCE,kEaip:setKE,preDed:setPreDed,postDed:setPostDed,c4pre:setC4pre,c4ro:setC4ro,k4pre:setK4pre,k4ro:setK4ro,cIraTrad:setCIraTrad,cIraRoth:setCIraRoth,kIraTrad:setKIraTrad,kIraRoth:setKIraRoth,exp:setExp,sav:setSav,cats:setCats,savCats:setSavCats,transferCats:setTransferCats,incomeCats:setIncomeCats,tax:setTax,sortBy:setSortBy,sortDir:setSortDir,hlThresh:setHlThresh,hlPeriod:setHlPeriod,appTitle:setAppTitle,customIcon:setCustomIcon,customTaxDB:setCustomTaxDB,milestones:setMilestones,p1Name:setP1Name,p2Name:setP2Name,transactionColumns:setTransactionColumns,importProfiles:setImportProfiles,categoryAliases:setCategoryAliases,transactionRules:setTransactionRules,rowCapWarn:setRowCapWarn,rowCapThreshold:setRowCapThreshold,hiddenColumns:setHiddenColumns,defaultTxPageSize:setDefaultTxPageSize,transferToleranceAmount:setTransferToleranceAmount,transferToleranceDays:setTransferToleranceDays,transferConfidenceThreshold:setTransferConfidenceThreshold,treatRefundsAsNetting:setTreatRefundsAsNetting,dupScanDayWindow:setDupScanDayWindow,dupScanAmountTolerance:setDupScanAmountTolerance,dupScanDescriptionMode:setDupScanDescriptionMode,dupScanFirstWordCount:setDupScanFirstWordCount,outlierSettings:setOutlierSettings,diagnostics:setDiagnostics };
        /* Skip-undefined: a saved state may have a key set explicitly to
           `undefined` from an earlier serialization quirk. Calling
           `setForecast(undefined)` would wipe the defaults; same risk for
           any other setter. Object.entries returns only own keys, but
           nothing prevents one of them being undefined — so guard. */
        Object.entries(d).forEach(([k,v]) => { if (m[k] && v !== undefined) m[k](v); });
        /* Forecast deserves special handling: deep-merge instead of replace.
           If the saved `forecast` predates Advanced (no `accounts`), or
           predates a newly-added field, the missing pieces fall back to the
           current defaults rather than overwriting them with undefined.
           This is the version-bump robustness piece — newer code that
           expects more shape than older saves provided won't see holes. */
        if (d.forecast && typeof d.forecast === "object") {
          setForecast(prev => {
            const merged = { ...prev, ...d.forecast };
            // Only override accounts if the saved value is a non-empty array.
            // An empty/missing array means "fall back to whatever was there"
            // — which on first render is the defaults seed. Without this
            // clause, a partial save would zero the Advanced tab.
            if (!Array.isArray(d.forecast.accounts) || d.forecast.accounts.length === 0) {
              merged.accounts = prev?.accounts || defaultForecastAccounts();
            }
            /* endingItems (Phase X-A): if saved value is missing or not
               an array, fall back to []. Saves predating Phase X-A
               simply won't have this field — the shallow spread above
               keeps prev's [] in that case, but we add this guard so a
               malformed (non-array) saved value can't poison state. */
            if (!Array.isArray(d.forecast.endingItems)) {
              merged.endingItems = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
            }
            /* oneTimeEvents: same guard as endingItems above. Saves
               predating One-time Events won't have this field; the
               shallow spread keeps prev's [] there. A malformed
               (non-array) saved value falls back to []. */
            if (!Array.isArray(d.forecast.oneTimeEvents)) {
              merged.oneTimeEvents = Array.isArray(prev?.oneTimeEvents) ? prev.oneTimeEvents : [];
            }
            /* loans (Phase 14): same guard. Saves predating Loans won't
               have this field; the shallow spread keeps prev's [] there.
               A malformed (non-array) saved value falls back to []. */
            if (!Array.isArray(d.forecast.loans)) {
              merged.loans = Array.isArray(prev?.loans) ? prev.loans : [];
            }
            /* fireConfig (Phase 15): tax-aware FIRE config object. Saves
               predating Phase 15 won't have this key — reads in
               ForecastTab/AdvancedForecastTab default each field. If a
               saved value is present but not a plain object, drop to {}.
               (Future-proof: per-key validation happens at the read
               site, so we don't need shape validation here.) */
            if (d.forecast.fireConfig != null && typeof d.forecast.fireConfig !== "object") {
              merged.fireConfig = (prev && typeof prev.fireConfig === "object") ? prev.fireConfig : {};
            }
            /* === One-time localStorage → st.forecast migration (DISABLED) ===
               This shim seeds st.forecast.* from this device's localStorage
               on first load after the migration deploy. It's now disabled
               because the migration has run on Corey's primary device and
               the seeded shape is on the server.

               LEFT IN PLACE INSTEAD OF DELETED so that if a forgotten device
               surfaces (work laptop, etc.) with localStorage values worth
               keeping, the shim can be revived by removing the `&& false`
               guard below. After ~3 months with no need, delete this block
               and its sibling under the `else` branch entirely.

               History: see commit log around the "Forecast scenario inputs
               sync across devices via st.forecast" change. */
            if (!merged.migrated && false) {
              try {
                const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
                const num = (k, fallback) => { const v = ls(k); const n = Number(v); return (v != null && Number.isFinite(n)) ? n : fallback; };
                const bool01 = (k, fallback) => { const v = ls(k); if (v === "1") return true; if (v === "0") return false; return fallback; };
                const boolNotZero = (k, fallback) => { const v = ls(k); if (v === "0") return false; if (v === "1") return true; return fallback; };
                const str = (k, fallback) => { const v = ls(k); return (v != null && v !== "") ? v : fallback; };

                // Shared (both tabs read these same keys today)
                merged.horizon = num("forecast-horizon", merged.horizon);
                merged.inflationPct = str("forecast-inflation", merged.inflationPct);
                merged.fireEnabled = bool01("forecast-fire-enabled", merged.fireEnabled);
                merged.fireMultiplier = str("forecast-fire-multiplier", merged.fireMultiplier);

                // Simple-only
                merged.returnPct = str("forecast-return", merged.returnPct);
                merged.incomeGrowthPct = str("forecast-income-growth", merged.incomeGrowthPct);
                merged.initialBalance = str("forecast-initial", merged.initialBalance);
                merged.valueMode = str("forecast-value-mode", merged.valueMode);
                merged.targetMonths = str("forecast-target-months", merged.targetMonths);
                merged.contribSource = str("forecast-contrib-source", merged.contribSource);
                merged.actualMode = str("forecast-actual-mode", merged.actualMode);
                const wks = num("forecast-weeks", merged.forecastWeeks);
                merged.forecastWeeks = (wks === 48 || wks === 52) ? wks : merged.forecastWeeks;
                merged.forecastBonus = bool01("forecast-bonus", merged.forecastBonus);
                merged.include401k = boolNotZero("forecast-include-401k", merged.include401k);
                merged.includeMatch = boolNotZero("forecast-include-match", merged.includeMatch);
                merged.includeHsa = boolNotZero("forecast-include-hsa", merged.includeHsa);

                merged.migrated = true;
                log.info("forecast.migrate", { source: "localStorage" });
                /* Cleanup: drop the now-dead localStorage keys. After
                   migration these are never read again, so leaving them
                   around is just clutter / future footgun. Display-only
                   prefs (forecast-simple-legend, forecast-sort-mode,
                   forecast-color-by, forecast-adv-legend, forecast-card-order)
                   intentionally NOT wiped — those still live in
                   localStorage by design. */
                try {
                  [
                    "forecast-horizon","forecast-inflation","forecast-fire-enabled","forecast-fire-multiplier",
                    "forecast-return","forecast-income-growth","forecast-initial","forecast-value-mode",
                    "forecast-target-months","forecast-contrib-source","forecast-actual-mode",
                    "forecast-weeks","forecast-bonus","forecast-include-401k","forecast-include-match","forecast-include-hsa",
                  ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
                } catch {}
              } catch (e) {
                // Failing the migration shouldn't block load. Just flip the
                // flag so we don't retry forever, and log it.
                merged.migrated = true;
                log.warn("forecast.migrate.fail", { message: String(e?.message || e) });
              }
            }
            return merged;
          });
        } else {
          /* No saved forecast at all — migration shim DISABLED. See sibling
             block above for context and revival instructions. */
          // eslint-disable-next-line no-constant-condition
          if (false) {
          setForecast(prev => {
            if (prev?.migrated) return prev;
            const merged = { ...prev };
            try {
              const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
              const num = (k, fallback) => { const v = ls(k); const n = Number(v); return (v != null && Number.isFinite(n)) ? n : fallback; };
              const bool01 = (k, fallback) => { const v = ls(k); if (v === "1") return true; if (v === "0") return false; return fallback; };
              const boolNotZero = (k, fallback) => { const v = ls(k); if (v === "0") return false; if (v === "1") return true; return fallback; };
              const str = (k, fallback) => { const v = ls(k); return (v != null && v !== "") ? v : fallback; };
              merged.horizon = num("forecast-horizon", merged.horizon);
              merged.inflationPct = str("forecast-inflation", merged.inflationPct);
              merged.fireEnabled = bool01("forecast-fire-enabled", merged.fireEnabled);
              merged.fireMultiplier = str("forecast-fire-multiplier", merged.fireMultiplier);
              merged.returnPct = str("forecast-return", merged.returnPct);
              merged.incomeGrowthPct = str("forecast-income-growth", merged.incomeGrowthPct);
              merged.initialBalance = str("forecast-initial", merged.initialBalance);
              merged.valueMode = str("forecast-value-mode", merged.valueMode);
              merged.targetMonths = str("forecast-target-months", merged.targetMonths);
              merged.contribSource = str("forecast-contrib-source", merged.contribSource);
              merged.actualMode = str("forecast-actual-mode", merged.actualMode);
              const wks = num("forecast-weeks", merged.forecastWeeks);
              merged.forecastWeeks = (wks === 48 || wks === 52) ? wks : merged.forecastWeeks;
              merged.forecastBonus = bool01("forecast-bonus", merged.forecastBonus);
              merged.include401k = boolNotZero("forecast-include-401k", merged.include401k);
              merged.includeMatch = boolNotZero("forecast-include-match", merged.includeMatch);
              merged.includeHsa = boolNotZero("forecast-include-hsa", merged.includeHsa);
              merged.migrated = true;
              log.info("forecast.migrate", { source: "localStorage", noSavedForecast: true });
              try {
                [
                  "forecast-horizon","forecast-inflation","forecast-fire-enabled","forecast-fire-multiplier",
                  "forecast-return","forecast-income-growth","forecast-initial","forecast-value-mode",
                  "forecast-target-months","forecast-contrib-source","forecast-actual-mode",
                  "forecast-weeks","forecast-bonus","forecast-include-401k","forecast-include-match","forecast-include-hsa",
                ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
              } catch {}
            } catch (e) {
              merged.migrated = true;
              log.warn("forecast.migrate.fail", { message: String(e?.message || e) });
            }
            return merged;
          });
          } // end if (false) — migration disabled
        }
      }
      setLoaded(true);
    } catch(e) {
      console.error("State load threw:", e);
      log.error("state.load.throw", { message: String(e?.message || e), reqId: e?.reqId });
    }
  })(); }, []);
  const st = useMemo(() => ({cSal,kSal,fil,cEaip,kEaip,preDed,postDed,c4pre,c4ro,k4pre,k4ro,cIraTrad,cIraRoth,kIraTrad,kIraRoth,exp,sav,cats,savCats,transferCats,incomeCats,tax,sortBy,sortDir,hlThresh,hlPeriod,appTitle,customIcon,customTaxDB,milestones,p1Name,p2Name,transactionColumns,importProfiles,categoryAliases,transactionRules,rowCapWarn,rowCapThreshold,hiddenColumns,defaultTxPageSize,transferToleranceAmount,transferToleranceDays,transferConfidenceThreshold,treatRefundsAsNetting,dupScanDayWindow,dupScanAmountTolerance,dupScanDescriptionMode,dupScanFirstWordCount,outlierSettings,diagnostics,forecast}), [cSal,kSal,fil,cEaip,kEaip,preDed,postDed,c4pre,c4ro,k4pre,k4ro,cIraTrad,cIraRoth,kIraTrad,kIraRoth,exp,sav,cats,savCats,transferCats,incomeCats,tax,sortBy,sortDir,hlThresh,hlPeriod,appTitle,customIcon,customTaxDB,milestones,p1Name,p2Name,transactionColumns,importProfiles,categoryAliases,transactionRules,rowCapWarn,rowCapThreshold,hiddenColumns,defaultTxPageSize,transferToleranceAmount,transferToleranceDays,transferConfidenceThreshold,treatRefundsAsNetting,dupScanDayWindow,dupScanAmountTolerance,dupScanDescriptionMode,dupScanFirstWordCount,outlierSettings,diagnostics,forecast]);
  /* Auto-save with hash-based no-op guard.
     - Gated on `loaded` (silent-wipe fix from earlier session — don't push
       defaults if the load hasn't completed).
     - First post-load run: stamps lastSavedHashRef with the JSON of the
       just-loaded state and skips the PUT. The state matches the server,
       so writing it back is unnecessary AND risky (it's the dangerous
       moment when defaults could leak in via a render glitch).
     - Subsequent runs: compute JSON of `st`, compare to lastSavedHashRef.
       If equal, skip — nothing has actually changed. If different, PUT
       and update the ref on success.
     - This is the "hashes for current state" guard: it physically prevents
       the auto-save from clobbering server data with content equal to
       what's already there, and — more importantly — protects against
       transient bad states where `st` momentarily references defaults
       (because that wouldn't match the loaded hash, but it ALSO wouldn't
       match any user-typed state, so the user would see the glitch in
       the UI but at least the server wouldn't get the bad write... wait,
       that part doesn't hold; see note below). */
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        const payload = JSON.stringify({ state: st });
        // First save after load: lastSavedHashRef is null. Stamp it with
        // the loaded state's JSON and skip the network call. This both
        // saves a redundant round-trip AND establishes the baseline for
        // future skip-comparisons.
        if (lastSavedHashRef.current === null) {
          /* Stable-IDs phase: if the load-time migration assigned new
             ids, the in-memory state diverges from the server copy and
             we MUST persist it. Otherwise stamp the no-op baseline and
             skip the PUT (state-wipe guard). Decision extracted to
             firstSaveAction() in utils/itemIds.js for regression testing. */
          const action = firstSaveAction(true, migrationDirtyRef.current);
          if (action === "skip-stamp-baseline") {
            lastSavedHashRef.current = payload;
            log.info("state.save.baseline", { size: payload.length });
            return;
          }
          // action === "put-migration": persist the migrated ids.
          migrationDirtyRef.current = false;
          log.info("state.save.migration", { size: payload.length });
          const res = await apiFetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: payload });
          if (res.ok) {
            lastSavedHashRef.current = payload;
            log.info("state.save", { size: payload.length, reqId: res.reqId, migration: true });
          } else {
            log.warn("state.save.fail", { status: res.status, size: payload.length, reqId: res.reqId });
          }
          return;
        }
        // Subsequent saves: skip if payload identical to last sync.
        if (payload === lastSavedHashRef.current) return;
        const sizeDelta = payload.length - lastSavedHashRef.current.length;
        const res = await apiFetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: payload });
        if (res.ok) {
          lastSavedHashRef.current = payload;
          log.info("state.save", { size: payload.length, delta: sizeDelta, reqId: res.reqId });
        } else {
          log.warn("state.save.fail", { status: res.status, size: payload.length, reqId: res.reqId });
        }
      } catch(e) {
        log.warn("state.save.throw", { message: String(e?.message || e), reqId: e?.reqId });
        /* network errors are recoverable on next change */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [st, loaded]);

  /* ── Transactions: load from /api/transactions on mount (deploy).
       Generic mode patches this block to read transactions from st during
       the main load, so this effect is replaced there. */
  useEffect(() => {
    if (MODE !== "deploy") { setTxLoaded(true); return; }
    (async () => {
      try {
        const res = await apiFetch("/api/transactions");
        const r = await res.json();
        if (r?.transactions) {
          setTransactions(r.transactions);
          log.info("tx.load", { count: r.transactions.length, reqId: res.reqId });
        } else {
          log.warn("tx.load.empty", { responseShape: Object.keys(r || {}), reqId: res.reqId });
        }
      } catch(e) {
        log.warn("tx.load.fail", { message: String(e?.message || e), reqId: e?.reqId });
        /* offline or no backend — fall back to empty */
      }
      setTxLoaded(true);
    })();
  }, []);

  /* ── Transactions CRUD (deploy: push to /api/transactions; generic: state-only).
       We expose helper functions so tabs don't need to know about the mode. */
  const addTransactions = useCallback(async (newRows) => {
    const rows = newRows.map(r => newTransaction(r));
    setTransactions(prev => [...rows, ...prev]);
    if (MODE === "deploy") {
      try {
        const res = await apiFetch("/api/transactions", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: rows }),
        });
        if (!res.ok) log.warn("tx.add.fail", { status: res.status, count: rows.length, reqId: res.reqId });
        else log.info("tx.add", { count: rows.length, reqId: res.reqId });
      } catch(e) {
        log.warn("tx.add.throw", { message: String(e?.message || e), count: rows.length, reqId: e?.reqId });
        /* keep local state even if backend save failed */
      }
    } else {
      log.info("tx.add", { count: rows.length, mode: "generic" });
    }
    return rows;
  }, []);

  const updateTransaction = useCallback(async (tx) => {
    const updated = { ...tx, updated_at: new Date().toISOString() };
    setTransactions(prev => prev.map(t => t.id === tx.id ? updated : t));
    if (MODE === "deploy") {
      try {
        const res = await apiFetch(`/api/transactions/${tx.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: updated }),
        });
        if (!res.ok) log.warn("tx.update.fail", { status: res.status, id: tx.id, reqId: res.reqId });
      } catch(e) {
        log.warn("tx.update.throw", { message: String(e?.message || e), id: tx.id, reqId: e?.reqId });
      }
    }
  }, []);

  const deleteTransactions = useCallback(async (idSet) => {
    const ids = Array.from(idSet);
    setTransactions(prev => prev.filter(t => !idSet.has(t.id)));
    if (MODE === "deploy" && ids.length) {
      try {
        const res = await apiFetch("/api/transactions", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) log.warn("tx.delete.fail", { status: res.status, count: ids.length, reqId: res.reqId });
        else log.info("tx.delete", { count: ids.length, reqId: res.reqId });
      } catch(e) {
        log.warn("tx.delete.throw", { message: String(e?.message || e), count: ids.length, reqId: e?.reqId });
      }
    } else if (ids.length) {
      log.info("tx.delete", { count: ids.length, mode: "generic" });
    }
  }, []);

  const deleteImportBatch = useCallback(async (batchId) => {
    setTransactions(prev => prev.filter(t => t.import_batch_id !== batchId));
    if (MODE === "deploy") {
      try {
        const res = await apiFetch("/api/transactions", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch_id: batchId }),
        });
        if (!res.ok) log.warn("tx.deleteBatch.fail", { status: res.status, batchId, reqId: res.reqId });
        else log.info("tx.deleteBatch", { batchId, reqId: res.reqId });
      } catch(e) {
        log.warn("tx.deleteBatch.throw", { message: String(e?.message || e), batchId, reqId: e?.reqId });
      }
    } else {
      log.info("tx.deleteBatch", { batchId, mode: "generic" });
    }
  }, []);


  /* ── Tax calculations ── */
  const C = useMemo(() => {
    const cs = evalF(cSal), ks = evalF(kSal), cw = cs / 52, kw = ks / 52;
    const cPreW = preDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPreW = preDed.reduce((s, d) => s + evalF(d.k), 0);
    const cLim = tax.k401Lim + (tax.c401Catch || 0), kLim = tax.k401Lim + (tax.k401Catch || 0);
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
    // IRA contributions are entered as annual dollars on the Income tab.
    // Trad IRA flows alongside HSA/Pre-Tax 401(k) — reduces taxable income
    // AND net paycheck (parallel to HSA: the money is committed to savings,
    // so it's "not in take-home" for budgeting purposes). Roth IRA only
    // reduces net paycheck (post-tax cash outflow into a planned savings
    // bucket). Both are intentionally not subject to FICA reduction since
    // IRAs aren't payroll-deducted.
    const cIraTradW = evalF(cIraTrad) / 52, cIraRothW = evalF(cIraRoth) / 52;
    const kIraTradW = evalF(kIraTrad) / 52, kIraRothW = evalF(kIraRoth) / 52;
    const cTxW = cw - cPreW - c4preW - cIraTradW, kTxW = kw - kPreW - k4preW - kIraTradW;
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
    // Post-tax bucket is split into two display groups: "Post-Tax Deductions"
    // (postDed items only) and "Post-Tax Savings" (Roth 401(k) + Roth IRA).
    // cPostW retains its legacy meaning (everything that reduces net beyond
    // taxes), for any consumer that needs the lump. cPostDedW / cPostSavW
    // expose the split for BudgetTab to render the new section structure.
    const cPostDedW = postDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPostDedW = postDed.reduce((s, d) => s + evalF(d.k), 0);
    const cPostSavW = c4roW + cIraRothW;
    const kPostSavW = k4roW + kIraRothW;
    const cPostW = cPostDedW + cPostSavW;
    const kPostW = kPostDedW + kPostSavW;
    // Net = gross − pre-tax deductions − all 401(k) (pre + roth) − Trad IRA
    //       − taxes − post-tax deductions − Roth IRA. Trad IRA already lowered
    //       cTxW so its tax effect flows through cTx automatically; we still
    //       subtract it as a cash outflow because the money is committed.
    const cNet = cw - cPreW - c4w - cIraTradW - cTx - cPostDedW - cIraRothW;
    const kNet = kw - kPreW - k4w - kIraTradW - kTx - kPostDedW - kIraRothW;
    const cTotalPct = evalF(c4pre) + evalF(c4ro), kTotalPct = evalF(k4pre) + evalF(k4ro);
    const cMP = calcMatch(cTotalPct, tax.cMatchTiers || [], tax.cMatchBase || 0);
    const kMP = calcMatch(kTotalPct, tax.kMatchTiers || [], tax.kMatchBase || 0);
    const cEaipGross = cs * (evalF(cEaip) / 100);
    const kEaipGross = ks * (evalF(kEaip) / 100);
    const eaipGross = cEaipGross + kEaipGross;
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
    return { cs, ks, cw, kw, cPreW, kPreW, c4w, k4w, c4preW, k4preW, c4roW, k4roW, cIraTradW, cIraRothW, kIraTradW, kIraRothW, cTxW, kTxW, fTax, mr, sd, cFed, kFed, cSS, kSS, cMc, kMc, cCO, kCO, cStMR, kStMR, cFL, kFL, cTx, kTx, cPostW, kPostW, cPostDedW, kPostDedW, cPostSavW, kPostSavW, cNet, kNet, net: cNet + kNet, cMP, kMP, ssR, medR, eaipGross, eaipNet, cEaipGross, kEaipGross, cEaipNet, kEaipNet, cEaipTax, kEaipTax, cEaipFed, kEaipFed, cEaipSS, kEaipSS, cEaipMc, kEaipMc, cEaipSt, kEaipSt, cEaipFL, kEaipFL };
  }, [cSal, kSal, fil, preDed, postDed, c4pre, c4ro, k4pre, k4ro, tax, cEaip, kEaip, cIraTrad, cIraRoth, kIraTrad, kIraRoth]);

  const moC = v => v * 48 / 12, y4 = v => v * 48, y5 = v => v * 52;
  const hlW = evalF(hlThresh);
  const hlWk = hlPeriod === "m" ? hlW * 12 / 48 : hlPeriod === "y" ? hlW / 48 : hlW;

  // ── Over-budget flag ──
  // Compares current-month actual spend vs. the monthly budget per category,
  // producing a Set of over-budget category names. The Budget tab uses this
  // to tint line items red so the user sees which categories blew through
  // their budget for the period. Cheap early exit when there are no
  // transactions yet.
  const overBudgetCats = useMemo(() => {
    if (!Array.isArray(transactions) || transactions.length === 0) return new Set();
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const last  = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    try {
      const cmp = compareBudgetToActual({
        transactions,
        exp, sav,
        cats, savCats, transferCats, incomeCats,
        milestones,
        fromIso: first,
        toIso: last,
        todayIso: today,
        basis: 48,
        treatRefundsAsNetting,
      });
      const out = new Set();
      for (const row of cmp.expense.rows) {
        // Only flag rows with a real budget target AND spending past it. We
        // deliberately skip budget-less uncategorized rows — those belong in
        // their own callout, not as a red tint on real categories.
        if (row.budgeted > 0 && row.over) out.add(row.category);
      }
      return out;
    } catch {
      return new Set();
    }
  }, [transactions, exp, sav, cats, savCats, transferCats, incomeCats, milestones, treatRefundsAsNetting]);

  const applySort = items => {
    const s = [...items];
    if (sortBy === "amount") s.sort((a, b) => sortDir === "desc" ? b.wk - a.wk : a.wk - b.wk);
    else if (sortBy === "category") s.sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));
    return s;
  };
  const ewk = useMemo(() => exp.map((e, i) => ({ ...e, idx: i, wk: toWk(e.v, e.p), hl: toWk(e.v, e.p) >= hlWk && hlWk > 0, ov: overBudgetCats.has(e.c) })), [exp, hlW, hlPeriod, overBudgetCats]);
  const necI = useMemo(() => applySort(ewk.filter(e => e.t === "N")), [ewk, sortBy, sortDir]);
  const disI = useMemo(() => applySort(ewk.filter(e => e.t === "D")), [ewk, sortBy, sortDir]);
  const savSorted = useMemo(() => { const items = sav.map((s, i) => ({ ...s, idx: i, wk: toWk(s.v, s.p), hl: toWk(s.v, s.p) >= hlWk && hlWk > 0 })); if (sortBy === "amount") items.sort((a, b) => sortDir === "desc" ? b.wk - a.wk : a.wk - b.wk); return items; }, [sav, sortBy, sortDir, hlW]);

  const tNW = necI.reduce((s, e) => s + e.wk, 0), tDW = disI.reduce((s, e) => s + e.wk, 0);
  const tExpW = tNW + tDW, tSavW = savSorted.reduce((s, e) => s + e.wk, 0);
  const remW = C.net - tExpW - tSavW;
  const remY48 = C.net * 48 - tExpW * 48 - tSavW * 48;
  const remY52 = C.net * 52 - tExpW * 48 - tSavW * 52;
  // Total Savings + Remaining = budget-tab Savings Goals + leftover after expenses.
  // No floor on remW: if expenses exceed net, some of the budgeted `sav` lines
  // are aspirational and the combined row should reflect that (it can go below
  // tSavW, even negative). Hiding overspend with Math.max(0, remW) was wrong —
  // it made the "+ Remaining" row stay flat while the dedicated Remaining row
  // showed red, contradicting each other.
  const totalSavPlusRemW = tSavW + remW;
  // Sum of all weekly retirement contributions already subtracted from C.net.
  // 401(k) pre + Roth for both partners (C.c4w / C.k4w include both legs each),
  // plus IRA Trad + Roth for both partners. Employer match (C.cMP / C.kMP) is
  // not included — it's compensation, not "what I am contributing." If a future
  // need wants household-savings-including-match, add it explicitly there.
  const retirementW = C.c4w + C.k4w + (C.cIraTradW || 0) + (C.cIraRothW || 0) + (C.kIraTradW || 0) + (C.kIraRothW || 0);
  // Total Annual Savings = budget-tab savings + leftover + all retirement.
  // This is the "what am I actually saving per year" number. Roth IRA / Roth 401(k)
  // / Trad IRA / Trad 401(k) all lower C.net (so they're invisible in tSavW + remW)
  // but they ARE savings; this field adds them back. Bonus net is layered on top
  // of this at the row level when present.
  const totalAllSavingsW = totalSavPlusRemW + retirementW;

  const budgetTotal = (savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks : C.net * chartWeeks) + (includeEaip ? (savRateBase === "gross" ? C.eaipGross : C.eaipNet) : 0);
  const allocatedTotal = (tExpW + tSavW) * 48;
  const unallocatedPct = budgetTotal > 0 ? ((budgetTotal - allocatedTotal) / budgetTotal * 100).toFixed(1) : "0";

  const catTot = useMemo(() => { const m = {}; ewk.forEach(e => { if (e.wk > 0) m[e.c] = (m[e.c] || 0) + e.wk * 48; }); return Object.entries(m).map(([k, v], i) => ({ name: k, value: Math.round(v), _allValues: [budgetTotal], _base: budgetTotal, color: ["#E8573A", "#F2A93B", "#4ECDC4", "#556FB5", "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#95A5A6", "#D35400", "#C0392B", "#3498DB"][i % 12] })); }, [ewk, budgetTotal, chartWeeks]);

  const typTot = useMemo(() => {
    let n = 0, d = 0, s = 0;
    ewk.forEach(e => { e.t === "N" ? n += e.wk * 48 : d += e.wk * 48; });
    savSorted.forEach(e => s += e.wk * 48);
    s += Math.max(0, remW) * 48;
    if (includeEaip) s += C.eaipNet;
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

  // recalcMilestone — thin wrapper around pure recalcMilestonePure in calc.js (so it's testable)
  const recalcMilestone = useCallback((mObj) => {
    return recalcMilestonePure(mObj, { tax, allTaxDB, fil, TAX_DB_FALLBACK: TAX_DB["2026"] });
  }, [tax, fil, allTaxDB]);

  // Recalculate all milestone aggregate fields on load
  const [msRecalced, setMsRecalced] = useState(false);
  useEffect(() => {
    if (!loaded || msRecalced || milestones.length === 0) return;
    setMsRecalced(true);
    setMilestones(prev => prev.map(s => recalcMilestone(s)));
  }, [loaded, recalcMilestone, milestones.length, msRecalced]);

  // One-time migration: backfill fullState.exp/sav on legacy milestones that
  // only have `items`. The charts already reconstruct on the fly, but
  // persisting the reconstructed shape makes milestones self-descriptive and
  // lets future code rely on fullState without constantly reaching for
  // reconstructFromItems. Runs exactly once per load; skipped if nothing
  // needs backfilling.
  const [msBackfilled, setMsBackfilled] = useState(false);
  useEffect(() => {
    if (!loaded || msBackfilled || milestones.length === 0) return;
    setMsBackfilled(true);
    setMilestones(prev => {
      let changed = false;
      const next = prev.map(s => {
        // Already has a live-shape budget? Leave alone.
        if (Array.isArray(s?.fullState?.exp) && s.fullState.exp.length > 0) return s;
        // No items to reconstruct from? Leave alone — nothing to do.
        if (!s?.items || typeof s.items !== "object") return s;
        const { exp, sav } = reconstructFromItems(s.items);
        if (exp.length === 0 && sav.length === 0) return s;
        // Stable-IDs phase: assign ids to the freshly reconstructed
        // items so milestone Compare can match them by id later.
        const expWithIds = ensureIds(exp);
        const savWithIds = ensureIds(sav);
        changed = true;
        return { ...s, fullState: { ...(s.fullState || {}), exp: expWithIds, sav: savWithIds } };
      });
      return changed ? next : prev;
    });
  }, [loaded, msBackfilled, milestones.length]);

  /* Stable-IDs phase: backfill ids on milestone fullState.exp/sav arrays
     whenever new milestones arrive without ids (e.g. JSON import path,
     which bypasses the load-time backfill). Runs on every milestones
     change but no-ops cheaply when everything already has ids — the
     `ensureIds` calls return the input array by reference when nothing
     needs assignment, and `setMilestones` short-circuits to `prev` when
     nothing changed, so React doesn't re-render in the steady state. */
  useEffect(() => {
    if (!loaded || milestones.length === 0) return;
    setMilestones(prev => {
      let changed = false;
      const next = prev.map(s => {
        if (!s || typeof s !== "object" || !s.fullState) return s;
        const fs = s.fullState;
        const nextExp = Array.isArray(fs.exp) ? ensureIds(fs.exp) : fs.exp;
        const nextSav = Array.isArray(fs.sav) ? ensureIds(fs.sav) : fs.sav;
        if (nextExp === fs.exp && nextSav === fs.sav) return s;
        changed = true;
        return { ...s, fullState: { ...fs, exp: nextExp, sav: nextSav } };
      });
      return changed ? next : prev;
    });
  }, [loaded, milestones]);

  const restoreFullState = useCallback((idx) => {
    const m = milestones[idx];
    const fs = m?.fullState;
    if (fs) {
      log.info("milestone.restore", { idx, id: m.id, label: m.label, mode: "fullState" });
      if (fs.cSal !== undefined) setCS(fs.cSal); if (fs.kSal !== undefined) setKS(fs.kSal);
      if (fs.fil) setFil(fs.fil); if (fs.cEaip !== undefined) setCE(fs.cEaip); if (fs.kEaip !== undefined) setKE(fs.kEaip);
      if (fs.preDed) setPreDed(fs.preDed); if (fs.postDed) setPostDed(fs.postDed);
      if (fs.c4pre !== undefined) setC4pre(fs.c4pre); if (fs.c4ro !== undefined) setC4ro(fs.c4ro);
      if (fs.k4pre !== undefined) setK4pre(fs.k4pre); if (fs.k4ro !== undefined) setK4ro(fs.k4ro);
      // IRA fields landed after the snapshot/milestone format was settled.
      // Older milestones won't have them — just leave the live values untouched
      // in that case (don't reset to 0). Only restore when the milestone
      // actually carries the fields.
      if (fs.cIraTrad !== undefined) setCIraTrad(fs.cIraTrad);
      if (fs.cIraRoth !== undefined) setCIraRoth(fs.cIraRoth);
      if (fs.kIraTrad !== undefined) setKIraTrad(fs.kIraTrad);
      if (fs.kIraRoth !== undefined) setKIraRoth(fs.kIraRoth);
      if (fs.exp) setExp(ensureIds(fs.exp)); if (fs.sav) setSav(ensureIds(fs.sav));
      if (fs.cats) setCats(fs.cats);
      if (fs.savCats) setSavCats(fs.savCats);
      if (fs.transferCats) setTransferCats(fs.transferCats);
      if (fs.incomeCats) setIncomeCats(fs.incomeCats);
      if (fs.tax) setTax(fs.tax);
    } else if (m?.items) {
      log.info("milestone.restore", { idx, id: m.id, label: m.label, mode: "itemsOnly", itemCount: Object.keys(m.items).length });
      const newExp = []; const newSav = []; const newCats = new Set(cats);
      Object.entries(m.items).forEach(([name, data]) => {
        if (data.c) newCats.add(data.c);
        if (data.t === "S") { newSav.push({ n: name, v: String(Math.round((data.v || 0) / 12 * 100) / 100), p: "m", c: data.c || "Other" }); }
        else { newExp.push({ n: name, c: data.c || "General", t: data.t || "N", v: String(Math.round((data.v || 0) / 12 * 100) / 100), p: "m" }); }
      });
      // Stable-IDs phase: items reconstructed from the legacy `items`
      // shape have no ids; assign them now so downstream consumers
      // (EO refs, Compare) get stable identity from the restore.
      setExp(ensureIds(newExp)); setSav(ensureIds(newSav)); setCats([...newCats]);
      if (m.cSalary) setCS(String(m.cSalary));
      if (m.kSalary) setKS(String(m.kSalary));
    }
  }, [milestones, cats]);

  const restoreLiveState = useCallback((ls) => {
    if (!ls || typeof ls !== "object") return;
    if (ls.cSal !== undefined) setCS(ls.cSal); if (ls.kSal !== undefined) setKS(ls.kSal);
    if (ls.fil) setFil(ls.fil); if (ls.cEaip !== undefined) setCE(ls.cEaip); if (ls.kEaip !== undefined) setKE(ls.kEaip);
    if (ls.preDed) setPreDed(ls.preDed); if (ls.postDed) setPostDed(ls.postDed);
    if (ls.c4pre !== undefined) setC4pre(ls.c4pre); if (ls.c4ro !== undefined) setC4ro(ls.c4ro);
    if (ls.k4pre !== undefined) setK4pre(ls.k4pre); if (ls.k4ro !== undefined) setK4ro(ls.k4ro);
    if (ls.cIraTrad !== undefined) setCIraTrad(ls.cIraTrad);
    if (ls.cIraRoth !== undefined) setCIraRoth(ls.cIraRoth);
    if (ls.kIraTrad !== undefined) setKIraTrad(ls.kIraTrad);
    if (ls.kIraRoth !== undefined) setKIraRoth(ls.kIraRoth);
    if (ls.exp) setExp(ensureIds(ls.exp)); if (ls.sav) setSav(ensureIds(ls.sav));
    if (ls.cats) setCats(ls.cats); if (ls.savCats) setSavCats(ls.savCats); if (ls.transferCats) setTransferCats(ls.transferCats); if (ls.incomeCats) setIncomeCats(ls.incomeCats);
    if (ls.tax) setTax(ls.tax);
    if (ls.p1Name) setP1Name(ls.p1Name); if (ls.p2Name) setP2Name(ls.p2Name);
    if (ls.appTitle) setAppTitle(ls.appTitle); if (ls.customIcon !== undefined) setCustomIcon(ls.customIcon);
    if (ls.sortBy) setSortBy(ls.sortBy); if (ls.sortDir) setSortDir(ls.sortDir);
    if (ls.hlThresh !== undefined) setHlThresh(ls.hlThresh); if (ls.hlPeriod) setHlPeriod(ls.hlPeriod);
    if (ls.customTaxDB) setCustomTaxDB(ls.customTaxDB);
    if (ls.forecast) setForecast(ls.forecast);
  }, []);
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

  // localStorage persistence effects
  useEffect(() => { try { localStorage.setItem("budget-theme", darkMode); } catch {} }, [darkMode]);
  useEffect(() => { try { localStorage.setItem("budget-banner", bannerOpen); } catch {} }, [bannerOpen]);
  useEffect(() => { try { localStorage.setItem("budget-toolbar", toolbarOpen); } catch {} }, [toolbarOpen]);
  useEffect(() => { try { localStorage.setItem("budget-cols", JSON.stringify(visCols)); } catch {} }, [visCols]);
  useEffect(() => { try { localStorage.setItem("budget-milestone-cols", JSON.stringify(msVisCols)); } catch {} }, [msVisCols]);
  useEffect(() => { try { localStorage.setItem("budget-chart-order", JSON.stringify(chartOrder)); } catch {} }, [chartOrder]);
  /* UI toggles persisted per-device. Keep paired with the read-initializers
     near the top of this hook; both halves must move together if a key
     changes. JSON-encode anything nullable (msHistYear) — string fields use
     bare setItem since the read side defaults a missing key correctly. */
  useEffect(() => { try { localStorage.setItem("budget-sort-by", sortBy); } catch {} }, [sortBy]);
  useEffect(() => { try { localStorage.setItem("budget-sort-dir", sortDir); } catch {} }, [sortDir]);
  useEffect(() => { try { localStorage.setItem("budget-hl-thresh", hlThresh); } catch {} }, [hlThresh]);
  useEffect(() => { try { localStorage.setItem("budget-hl-period", hlPeriod); } catch {} }, [hlPeriod]);
  useEffect(() => { try { localStorage.setItem("budget-show-per-person", showPerPerson); } catch {} }, [showPerPerson]);
  useEffect(() => { try { localStorage.setItem("budget-include-eaip", includeEaip); } catch {} }, [includeEaip]);
  useEffect(() => { try { localStorage.setItem("budget-sav-rate-base", savRateBase); } catch {} }, [savRateBase]);
  useEffect(() => { try { localStorage.setItem("budget-chart-weeks", chartWeeks); } catch {} }, [chartWeeks]);
  useEffect(() => { try { localStorage.setItem("budget-cat-chart-mode", catChartMode); } catch {} }, [catChartMode]);
  useEffect(() => { try { localStorage.setItem("budget-cat-hist-mode", catHistMode); } catch {} }, [catHistMode]);
  useEffect(() => { try { localStorage.setItem("budget-item-hist-mode", itemHistMode); } catch {} }, [itemHistMode]);
  useEffect(() => { try { localStorage.setItem("budget-nec-dis-mode", necDisMode); } catch {} }, [necDisMode]);
  useEffect(() => { try { localStorage.setItem("budget-ms-hist-view", msHistView); } catch {} }, [msHistView]);
  useEffect(() => { try { localStorage.setItem("budget-ms-hist-year", JSON.stringify(msHistYear)); } catch {} }, [msHistYear]);

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

  // Scroll to top on tab/ms change
  useEffect(() => { window.scrollTo(0, 0); }, [tab, viewingMs]);

  // CSS custom properties for theme
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

  const cycleTheme = () => setDarkMode(p => p === "light" || p === false ? "dark" : p === "dark" || p === true ? "waf" : "light");
  const bg = dk ? "#1e1e1e" : waf ? "#d5d0cb" : "linear-gradient(145deg,#f5f0eb 0%,#ede7e0 50%,#e8e2db 100%)";
  const headerBg = dk ? "#1a1a1a" : waf ? "#486b50" : "#1a1a1a";
  const tx = dk ? "#e8e8e8" : "#333";
  const tabAccent = waf ? "#c96b70" : "#E8573A";
  const ts = a => ({ padding: "10px 14px", border: "none", borderBottom: a ? `3px solid ${tabAccent}` : "3px solid transparent", background: "none", color: a ? tabAccent : "#aaa", fontFamily: "'DM Sans',sans-serif", fontWeight: a ? 700 : 500, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" });

  return {
    // mobile
    mob,
    // tabs
    tab, setTab,
    budgetSubtab, setBudgetSubtab, chartsSubtab, setChartsSubtab,
    // theme
    darkMode, setDarkMode, dk, waf, cycleTheme, bg, headerBg, tx, tabAccent, ts,
    // title
    appTitle, setAppTitle, editingTitle, setEditingTitle, titleDraft, setTitleDraft,
    // tax
    tax, setTax, upTax, upP1State, upP2State,
    fetchStatus, setFetchStatus, showTaxPaste, setShowTaxPaste, taxPaste, setTaxPaste,
    customTaxDB, setCustomTaxDB, allTaxDB, loadTaxYear, addTaxYear,
    // income
    cSal, setCS, kSal, setKS, p1Name, setP1Name, p2Name, setP2Name,
    fil, setFil, cEaip, setCE, kEaip, setKE,
    preDed, setPreDed, postDed, setPostDed,
    c4pre, setC4pre, c4ro, setC4ro, k4pre, setK4pre, k4ro, setK4ro,
    cIraTrad, setCIraTrad, cIraRoth, setCIraRoth,
    kIraTrad, setKIraTrad, kIraRoth, setKIraRoth,
    // budget items
    exp, setExp, sav, setSav,
    cats, setCats, savCats, setSavCats, transferCats, setTransferCats, incomeCats, setIncomeCats, newCat, setNewCat,
    sortBy, setSortBy, sortDir, setSortDir,
    hlThresh, setHlThresh, hlPeriod, setHlPeriod,
    niN, setNiN, niC, setNiC, niT, setNiT, niS, setNiS, niP, setNiP, niV, setNiV,
    showAddItem, setShowAddItem,
    customIcon, setCustomIcon,
    // layout
    bannerOpen, setBannerOpen, toolbarOpen, setToolbarOpen,
    visCols, setVisCols, showPerPerson, setShowPerPerson,
    // collapse
    collapsed, toggleSec, allExpanded, allCollapsed, isMixed, expandAll, collapseAll, toggleAll,
    // milestones
    milestones, setMilestones, msLabel, setMsLabel, msDate, setMsDate,
    editMsIdx, setEditMsIdx, restoreConfirm, setRestoreConfirm,
    viewingMs, setViewingMs,
    msVisCols, setMsVisCols,
    recalcMilestone, restoreFullState, restoreLiveState, st,
    // bulk add
    showBulkAdd, setShowBulkAdd, bulkName, setBulkName, bulkVal, setBulkVal,
    bulkPer, setBulkPer, bulkType, setBulkType, bulkSec, setBulkSec,
    bulkCat, setBulkCat, bulkTargets, setBulkTargets,
    // charts
    chartOrder, setChartOrder, chartWeeks, setChartWeeks,
    chartTimeWindow, setChartTimeWindow,
    savRateBase, setSavRateBase, includeEaip, setIncludeEaip,
    catChartMode, setCatChartMode, catHistoryName, setCatHistoryName,
    catHistMode, setCatHistMode, itemHistMode, setItemHistMode,
    necDisMode, setNecDisMode, msHistView, setMsHistView, msHistYear, setMsHistYear,
    itemHistoryName, setItemHistoryName,
    dragChart, chartDragHandlers, dragWrapRender,
    PieTooltip,
    // calculations
    C, moC, y4, y5,
    ewk, necI, disI, savSorted,
    tNW, tDW, tExpW, tSavW, remW, remY48, remY52, totalSavPlusRemW, retirementW, totalAllSavingsW,
    budgetTotal, allocatedTotal, unallocatedPct,
    catTot, typTot,
    // CRUD
    updExp, updSav, rmExp, rmSav,
    // transactions
    transactions, setTransactions,
    transactionColumns, setTransactionColumns,
    importProfiles, setImportProfiles,
    categoryAliases, setCategoryAliases,
    transactionRules, setTransactionRules,
    rowCapWarn, setRowCapWarn,
    rowCapThreshold, setRowCapThreshold,
    hiddenColumns, setHiddenColumns,
    defaultTxPageSize, setDefaultTxPageSize,
    transferToleranceAmount, setTransferToleranceAmount,
    transferToleranceDays, setTransferToleranceDays,
    transferConfidenceThreshold, setTransferConfidenceThreshold,
    treatRefundsAsNetting, setTreatRefundsAsNetting,
    dupScanDayWindow, setDupScanDayWindow,
    dupScanAmountTolerance, setDupScanAmountTolerance,
    dupScanDescriptionMode, setDupScanDescriptionMode,
    dupScanFirstWordCount, setDupScanFirstWordCount,
    outlierSettings, setOutlierSettings,
    diagnostics, setDiagnostics,
    forecast, setForecast,
    txLoaded,
    addTransactions, updateTransaction, deleteTransactions, deleteImportBatch,
    MODE,
  };
}
