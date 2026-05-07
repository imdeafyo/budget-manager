import { useMemo, useState, useEffect, useRef } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine, AreaChart, Area, Line, ComposedChart } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { fmt, fmtCompact, evalF, forecastGrowthAccounts, yearsToHitPoolLimit, calcMatch } from "../utils/calc.js";
import { actualAnnualContribution } from "../utils/forecastActuals.js";
import { getPoolLimit, ACCOUNT_TYPE_TO_POOL, defaultForecastAccounts } from "../data/taxDB.js";

/* ── Account type display metadata ──
   Account `type` strings map to (a) IRS pool for limit checking
   (ACCOUNT_TYPE_TO_POOL in taxDB.js) and (b) display label + pool color
   for the chart legend. Keep the type list in sync with both maps.
   Order in this object also drives the order of the "+ add" chips and
   the type <select> dropdown. */
const ACCOUNT_TYPE_LABELS = {
  "401k_pretax":     "401(k) — Pre-tax",
  "401k_roth":       "401(k) — Roth",
  "401k_match":      "401(k) — Employer Match",
  "ira_traditional": "IRA — Traditional",
  "ira_roth":        "IRA — Roth",
  "hsa_cash":        "HSA — Cash",
  "hsa_invested":    "HSA — Invested",
  "hsa":             "HSA (legacy)", // kept for backward compat with existing saved accounts
  "taxable":         "Taxable / Brokerage",
  "cash":            "Cash / Savings",
  "custom":          "Other",
};
/* Pool-level color palette (Color by: Type). Each pool gets a base hue;
   individual accounts within a pool are shades of that hue. Recharts handles
   continuous color from a discrete list — keep these in the same visual
   family per pool. */
const POOL_COLORS = {
  "401k_employee": ["#556FB5", "#7B91C9", "#3D5499", "#9CABD8"],
  "ira":           ["#2ECC71", "#5EDC8C", "#1FAA5F", "#7FE3A1"],
  "hsa":           ["#9B59B6", "#B57BCC", "#7E45A0", "#C99FD8"],
  "_other":        ["#888888", "#A8A8A8", "#666666", "#BFBFBF"],
};
/* Owner color palette (Color by: Owner). One color per owner, intentionally —
   "Color by Owner" means the user wants to see total share by person, not
   per-account variation. Multiple P1 accounts all paint the same blue and
   visually merge into a single P1 block in the stacked area chart. The
   tertiary entries are kept as fallbacks if more owners are ever added
   (e.g., "kids"). */
const OWNER_COLORS = {
  "p1":    "#2C5F8D",
  "p2":    "#1A8B91",
  "joint": "#A06236",
};

function poolForType(type) {
  return ACCOUNT_TYPE_TO_POOL[type] || "_other";
}
function colorForAccountByPool(account, idxInPool) {
  const pool = poolForType(account.type);
  const palette = POOL_COLORS[pool] || POOL_COLORS._other;
  return palette[idxInPool % palette.length];
}
function colorForAccountByOwner(account) {
  return OWNER_COLORS[account.owner] || OWNER_COLORS.joint;
}

/* Derive display name from owner + type, with optional user nickname.
   Format: "<Owner> <TypeLabel>" with nickname prefixed if present.
   Example: "Corey 401(k) — Pre-tax" or "Megacorp Corey 401(k) — Pre-tax".
   The "joint" owner drops its prefix on HSA-family accounts because "Joint
   HSA — Cash" reads worse than "HSA — Cash". */
function deriveAccountName(account, p1Name, p2Name) {
  const typeLabel = ACCOUNT_TYPE_LABELS[account.type] || account.type;
  const ownerLabel = account.owner === "p1" ? p1Name : account.owner === "p2" ? p2Name : "";
  const baseLabel = ownerLabel ? `${ownerLabel} ${typeLabel}` : typeLabel;
  const nick = (account.nickname || "").trim();
  return nick ? `${nick} ${baseLabel}` : baseLabel;
}

/* Migration: pre-round-2 saves stored a free-text `name` field. When loaded,
   compare to the auto-derived name; any difference becomes the nickname. */
function migrateAccountName(account, p1Name, p2Name) {
  if (account.nickname !== undefined && !("name" in account)) return account;
  const expected = deriveAccountName({ ...account, nickname: "" }, p1Name, p2Name);
  if (!account.name || account.name === expected) {
    const { name, ...rest } = account;
    return { ...rest, nickname: rest.nickname || "" };
  }
  // Try stripping the expected suffix to recover an original nickname
  let nickname = "";
  if (account.name.endsWith(expected)) {
    nickname = account.name.slice(0, account.name.length - expected.length).trim();
  } else {
    // Couldn't reconcile — preserve user's free-text label as nickname so info isn't lost
    nickname = account.name;
  }
  const { name, ...rest } = account;
  return { ...rest, nickname };
}

/* ── Advanced (account-based) Forecast tab ──
   Promoted from a nested mode of ForecastTab to its own Charts subtab.
   Manages horizon / inflation / FIRE locally via the same localStorage keys
   the Simple Forecast uses, so the two views stay in sync without a
   parent-level state lift. tExpW (weekly expense total) flows in from
   useAppState so we can derive `fireAnnualExpenses` consistently with Simple.
   TODO: lift these to useAppState if/when we add live cross-tab sync.
*/
export default function AdvancedForecastTab({
  mob, forecast = {}, setForecast, tax = {}, setTax, p1Name = "Person 1", p2Name = "Person 2",
  cSal = "0", kSal = "0", c4pre = "0", c4ro = "0", k4pre = "0", k4ro = "0",
  // IRA dollar amounts from Income tab — used to auto-derive IRA account
  // contributions so users don't enter the same number twice.
  cIraTrad = "0", cIraRoth = "0", kIraTrad = "0", kIraRoth = "0",
  preDed = [], hsaEmployerMatchAnnual = 0, tExpW = 0,
  // Transactions + category sets enable the "from actual spending (last N
  // months)" contribution source on cash/savings accounts.
  transactions = [], cats = [], savCats = [], transferCats = [],
}) {
  // Cross-view shared state — read/written via the same keys Simple uses so
  // toggling between subtabs keeps the user's last horizon / FIRE settings.
  const [horizon, setHorizonRaw] = useState(() => { try { return Number(localStorage.getItem("forecast-horizon")) || 30; } catch { return 30; } });
  const setHorizon = (v) => { setHorizonRaw(v); try { localStorage.setItem("forecast-horizon", String(v)); } catch {} };

  const [inflationPctRaw] = useState(() => { try { return localStorage.getItem("forecast-inflation") || "3"; } catch { return "3"; } });
  const inflationPct = inflationPctRaw;

  const [fireEnabled, setFireEnabledRaw] = useState(() => { try { return localStorage.getItem("forecast-fire-enabled") === "1"; } catch { return false; } });
  const setFireEnabled = (v) => { setFireEnabledRaw(v); try { localStorage.setItem("forecast-fire-enabled", v ? "1" : "0"); } catch {} };

  // FIRE multiplier (× annual expenses). Editable on this tab so scenario
  // planning is possible without bouncing back to Simple. Persists to the
  // same localStorage key Simple reads from, so changes round-trip.
  const [fireMultiplier, setFireMultiplierRaw] = useState(() => { try { return localStorage.getItem("forecast-fire-multiplier") || "25"; } catch { return "25"; } });
  const setFireMultiplier = (v) => { setFireMultiplierRaw(v); try { localStorage.setItem("forecast-fire-multiplier", String(v)); } catch {} };

  // FIRE derivations — minimal version of Simple's logic. Uses tExpW × 48
  // (paycheck-basis annual expenses) as the FIRE expense baseline; the
  // contribSource / actuals override Simple offers will land later if
  // wanted here too.
  const fireMultiplierNum = useMemo(() => {
    const v = evalF(fireMultiplier);
    return isFinite(v) && v > 0 ? v : 25;
  }, [fireMultiplier]);
  const fireAnnualExpenses = useMemo(() => tExpW * 48, [tExpW]);
  const fireTarget = useMemo(() => fireAnnualExpenses * fireMultiplierNum, [fireAnnualExpenses, fireMultiplierNum]);

  const accountsRaw = (forecast && Array.isArray(forecast.accounts)) ? forecast.accounts : [];

  /* One-shot migration: drop legacy `name` field, recover nickname from any
     diff vs. derived format. Memoized on the raw accounts so renames flow. */
  const accounts = useMemo(
    () => accountsRaw.map(a => migrateAccountName(a, p1Name, p2Name)),
    [accountsRaw, p1Name, p2Name]
  );

  /* Sort/drag state must be declared BEFORE displayedAccounts and the drag
     handlers below — those reference sortMode/dragId, and Temporal Dead Zone
     rules mean accessing them above their declaration line throws on the
     first render's dependency-array evaluation. (This caused the Advanced
     tab to render as a blank page.) */
  const [sortMode, setSortMode] = useState(() => {
    try { return localStorage.getItem("forecast-sort-mode") || "manual"; } catch { return "manual"; }
  });
  useEffect(() => { try { localStorage.setItem("forecast-sort-mode", sortMode); } catch {} }, [sortMode]);

  /* Drag-and-drop state. dragId = id of the row currently being dragged.
     Only meaningful when sortMode === "manual". */
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  /* "+ Add account" menu. Replaces the previous wall of one-button-per-type
     chips with a single button that opens a popover. addMenuRef is on the
     wrapper so an outside click closes the menu. */
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDocClick = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setAddMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === "Escape") setAddMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

  /* Sorted view for rendering. `manual` keeps the persisted index order;
     otherwise produce a fresh sorted copy each render. The underlying
     `accounts` array is never reordered by sorting — only by user drag. */
  const displayedAccounts = useMemo(() => {
    if (sortMode === "manual") return accounts;
    const list = [...accounts];
    if (sortMode === "name") {
      list.sort((a, b) => deriveAccountName(a, p1Name, p2Name).localeCompare(deriveAccountName(b, p1Name, p2Name)));
    } else if (sortMode === "balance") {
      list.sort((a, b) => (Number(b.startBalance) || 0) - (Number(a.startBalance) || 0));
    }
    return list;
  }, [accounts, sortMode, p1Name, p2Name]);

  /* Drag-and-drop reordering. Persists the new order back into
     forecast.accounts so it survives reloads. Only enabled in manual sort
     mode. */
  const onDragStart = (id) => (e) => {
    if (sortMode !== "manual") { e.preventDefault(); return; }
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    // Some browsers require setData for drag to register at all.
    try { e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const onDragOver = (id) => (e) => {
    if (sortMode !== "manual" || !dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  };
  const onDragLeave = () => setDragOverId(null);
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (sortMode !== "manual" || !dragId || dragId === id) {
      setDragId(null); setDragOverId(null);
      return;
    }
    const fromIdx = accounts.findIndex(a => a.id === dragId);
    const toIdx = accounts.findIndex(a => a.id === id);
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setDragOverId(null); return; }
    const next = [...accounts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setForecast({ ...forecast, accounts: next });
    setDragId(null); setDragOverId(null);
  };
  const onDragEnd = () => { setDragId(null); setDragOverId(null); };

  const hsaCoverage = (forecast && forecast.hsaCoverage) || "family";
  const limitGrowthPct = forecast && forecast.limitGrowthPct !== undefined ? forecast.limitGrowthPct : 2.5;
  const baseYear = new Date().getFullYear();

  /* Color mode (per-device, per-tab — short-lived UI preference). */
  const [colorBy, setColorBy] = useState(() => {
    try { return localStorage.getItem("forecast-color-by") || "type"; } catch { return "type"; }
  });
  useEffect(() => { try { localStorage.setItem("forecast-color-by", colorBy); } catch {} }, [colorBy]);

  /* Summary-card order — separate DnD state from the account list. Stored as
     a list of card ids: "pool:<poolName>", "total", "fire". When new cards
     appear (e.g. user enables FIRE, or adds an account in a new pool), they
     get appended to the end so the user's drag order is preserved.
     Invalidates from the bottom: cards that no longer exist are filtered. */
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const raw = localStorage.getItem("forecast-card-order");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem("forecast-card-order", JSON.stringify(cardOrder || [])); } catch {}
  }, [cardOrder]);
  const [cardDragId, setCardDragId] = useState(null);
  const [cardDragOverId, setCardDragOverId] = useState(null);
  const onCardDragStart = (id) => (e) => {
    setCardDragId(id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const onCardDragOver = (id) => (e) => {
    if (!cardDragId || cardDragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setCardDragOverId(id);
  };
  const onCardDragLeave = () => setCardDragOverId(null);
  const onCardDrop = (id, allIds) => (e) => {
    e.preventDefault();
    if (!cardDragId || cardDragId === id) {
      setCardDragId(null); setCardDragOverId(null);
      return;
    }
    const ids = [...allIds];
    const fromIdx = ids.indexOf(cardDragId);
    const toIdx   = ids.indexOf(id);
    if (fromIdx < 0 || toIdx < 0) { setCardDragId(null); setCardDragOverId(null); return; }
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setCardOrder(ids);
    setCardDragId(null); setCardDragOverId(null);
  };
  const onCardDragEnd = () => { setCardDragId(null); setCardDragOverId(null); };

  /* Per-account expand/collapse. Default: all collapsed for compactness. */
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const expandAll = () => setExpanded(Object.fromEntries(accounts.map(a => [a.id, true])));
  const collapseAll = () => setExpanded({});
  const expandedCount = accounts.filter(a => expanded[a.id]).length;
  const allExpanded = accounts.length > 0 && expandedCount === accounts.length;
  const allCollapsed = expandedCount === 0;
  const expandMixed = !allExpanded && !allCollapsed;

  const updateAccount = (id, patch) => {
    const next = accounts.map(a => a.id === id ? { ...a, ...patch } : a);
    setForecast({ ...forecast, accounts: next });
  };
  const addAccount = (type) => {
    const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newAcc = {
      id,
      nickname: "",
      owner: "p1",
      type,
      startBalance: 0,
      annualReturn: 7,
      contribOverride: false,
      contribAmount: 0,
      annualIncrease: 0,
      capAtLimit: !["taxable","cash","custom","401k_match"].includes(type),
    };
    setForecast({ ...forecast, accounts: [...accounts, newAcc] });
    setExpanded(p => ({ ...p, [id]: true }));
  };
  const removeAccount = (id) => {
    if (!window.confirm("Remove this account from the forecast? This only affects projections — no transaction data is touched.")) return;
    setForecast({ ...forecast, accounts: accounts.filter(a => a.id !== id) });
  };
  const resetToDefaults = () => {
    if (!window.confirm("Reset to the default account list? This replaces your current account configuration with the starter accounts. Cannot be undone.")) return;
    setForecast({ ...forecast, accounts: defaultForecastAccounts() });
  };

  /* Cap-at-limit master toggle. Tristate: all-on / all-off / mixed.
     Click flips: any-off → all-on, all-on → all-off. */
  const eligibleAccounts = accounts.filter(a => ACCOUNT_TYPE_TO_POOL[a.type]); // limit applies
  const allCapped = eligibleAccounts.length > 0 && eligibleAccounts.every(a => a.capAtLimit);
  const noneCapped = eligibleAccounts.every(a => !a.capAtLimit);
  const capMixed = !allCapped && !noneCapped;
  const flipAllCap = () => {
    const target = !allCapped; // off → on, on → off, mixed → on
    const next = accounts.map(a => ACCOUNT_TYPE_TO_POOL[a.type] ? { ...a, capAtLimit: target } : a);
    setForecast({ ...forecast, accounts: next });
  };

  /* ── Auto-derived annual contributions from the Income tab ──
     For derivable account types we can compute today's annual contribution
     directly from the live state. The user can flip `contribOverride` per
     account to switch between auto and manual. When auto, the contribution
     input is read-only and reflects the derived value.

     Match auto-derivation uses calcMatch with the per-person tier/base.
     The match-lump toggle works at this layer: when c401MatchLump is on,
     the P1 match account auto-contributes 0 and the P1 pre-tax account's
     auto-contribution INCLUDES the match. Same for P2. */
  const cSalNum = useMemo(() => evalF(cSal), [cSal]);
  const kSalNum = useMemo(() => evalF(kSal), [kSal]);
  const c4preNum = useMemo(() => evalF(c4pre), [c4pre]);
  const c4roNum = useMemo(() => evalF(c4ro), [c4ro]);
  const k4preNum = useMemo(() => evalF(k4pre), [k4pre]);
  const k4roNum = useMemo(() => evalF(k4ro), [k4ro]);
  const cMatchAnnual = useMemo(() => {
    const tot = c4preNum + c4roNum;
    if (cSalNum <= 0 || tot <= 0) return 0;
    /* calcMatch returns the EMPLOYER % directly (base + tiered match on
       employee deferral %). Multiply by salary and divide by 100 for $. */
    const matchPct = calcMatch(tot, tax?.cMatchTiers || [], tax?.cMatchBase || 0);
    return cSalNum * matchPct / 100;
  }, [cSalNum, c4preNum, c4roNum, tax?.cMatchTiers, tax?.cMatchBase]);
  const kMatchAnnual = useMemo(() => {
    const tot = k4preNum + k4roNum;
    if (kSalNum <= 0 || tot <= 0) return 0;
    const matchPct = calcMatch(tot, tax?.kMatchTiers || [], tax?.kMatchBase || 0);
    return kSalNum * matchPct / 100;
  }, [kSalNum, k4preNum, k4roNum, tax?.kMatchTiers, tax?.kMatchBase]);
  /* HSA employee weekly contribution: same convention as BudgetTab/simple-mode
     (preDed rows whose name contains "hsa"). c+k summed × 52 for annual. */
  const hsaEmployeeAnnualByOwner = useMemo(() => {
    if (!Array.isArray(preDed)) return { p1: 0, p2: 0 };
    let p1 = 0, p2 = 0;
    for (const d of preDed) {
      if (!d || typeof d.n !== "string") continue;
      if (!d.n.toLowerCase().includes("hsa")) continue;
      p1 += evalF(d.c) * 52;
      p2 += evalF(d.k) * 52;
    }
    return { p1, p2 };
  }, [preDed]);
  const hsaTotalAnnual = useMemo(() => {
    return hsaEmployeeAnnualByOwner.p1 + hsaEmployeeAnnualByOwner.p2 + (Number(hsaEmployerMatchAnnual) || 0);
  }, [hsaEmployeeAnnualByOwner, hsaEmployerMatchAnnual]);

  const cLump = !!tax?.c401MatchLump;
  const kLump = !!tax?.k401MatchLump;

  // Pre-evaluate IRA dollar amounts so autoContribFor stays sync.
  const cIraTradNum = useMemo(() => evalF(cIraTrad), [cIraTrad]);
  const cIraRothNum = useMemo(() => evalF(cIraRoth), [cIraRoth]);
  const kIraTradNum = useMemo(() => evalF(kIraTrad), [kIraTrad]);
  const kIraRothNum = useMemo(() => evalF(kIraRoth), [kIraRoth]);

  /* Cash-from-actuals: for cash/savings accounts whose `contribSource` is set
     to a "last N months" mode, compute net savings (income − expenses) over
     that window from the transaction history. Returns a { [accountId]: $/yr }
     map. Cached so the per-row `autoContribFor` lookup is O(1).
     Returns 0 when the result is null (no data, or insufficient history) to
     avoid surprising the user with a "nothing applied" silent fallback —
     the row's tooltip explains the source. */
  const cashActualByAccount = useMemo(() => {
    const out = {};
    if (!Array.isArray(transactions) || transactions.length === 0) return out;
    for (const a of accounts) {
      if (a.type !== "cash") continue;
      const src = a.contribSource;
      if (!src || src === "manual") continue;
      const months = src === "actual3" ? 3 : src === "actual6" ? 6 : src === "actual12" ? 12 : null;
      if (!months) continue;
      const result = actualAnnualContribution({
        transactions,
        months,
        cats,
        savCats,
        transferCats,
        mode: "net",
      });
      out[a.id] = result && isFinite(result.annual) ? Math.max(0, result.annual) : 0;
    }
    return out;
  }, [transactions, accounts, cats, savCats, transferCats]);

  const autoContribFor = (a) => {
    if (a.owner === "p1") {
      if (a.type === "401k_pretax") {
        const base = cSalNum * c4preNum / 100;
        return base + (cLump ? cMatchAnnual : 0);
      }
      if (a.type === "401k_roth")  return cSalNum * c4roNum / 100;
      if (a.type === "401k_match") return cLump ? 0 : cMatchAnnual;
      // IRA fields are person-scoped; "joint" IRAs aren't a thing legally so
      // we only auto-derive when owner is p1/p2 (joint IRA accounts fall
      // through to manual entry).
      // GUARD: only auto-derive when the user has actually entered a non-zero
      // IRA value on the Income tab. If the field is still at its default of
      // "0", returning 0 here would shadow any pre-existing manual
      // `contribAmount` on the account — silently zeroing out the user's
      // retirement projection. Returning null falls through to the manual
      // amount, preserving existing data. Once the user enters a real number
      // on Income, auto-derivation kicks in.
      if (a.type === "ira_traditional") return cIraTradNum > 0 ? cIraTradNum : null;
      if (a.type === "ira_roth")        return cIraRothNum > 0 ? cIraRothNum : null;
    }
    if (a.owner === "p2") {
      if (a.type === "401k_pretax") {
        const base = kSalNum * k4preNum / 100;
        return base + (kLump ? kMatchAnnual : 0);
      }
      if (a.type === "401k_roth")  return kSalNum * k4roNum / 100;
      if (a.type === "401k_match") return kLump ? 0 : kMatchAnnual;
      if (a.type === "ira_traditional") return kIraTradNum > 0 ? kIraTradNum : null;
      if (a.type === "ira_roth")        return kIraRothNum > 0 ? kIraRothNum : null;
    }
    /* Joint HSA accounts: lump everything into "cash" by default. The user
       can flip individual rows to manual to allocate a portion to invested
       (most institutions hold contributions in cash until a minimum is
       reached, then sweep to invested).
       TODO: HSA contributions live in preDed (string-matched on "hsa") for
       historical reasons. A first-class field on the Income tab would be
       cleaner — needs a one-time migration to move existing snapshot data. */
    if (a.type === "hsa_cash" && a.owner === "joint") return hsaTotalAnnual;
    if (a.type === "hsa_invested" && a.owner === "joint") return 0;
    if (a.type === "hsa" && a.owner === "joint") return hsaTotalAnnual;
    // Cash account with "actual spending" source — auto-derived from the
    // transactions cache. Only kicks in when contribSource is explicitly
    // set; manual cash accounts fall through to the manual contribAmount.
    if (a.type === "cash" && a.contribSource && a.contribSource !== "manual") {
      const v = cashActualByAccount[a.id];
      return typeof v === "number" ? v : 0;
    }
    return null; // not auto-derivable
  };

  const isAutoDerivable = (a) => autoContribFor(a) !== null;

  /* The contribution amount actually flowing into the projection: auto when
     not overridden and derivable, else the manual `contribAmount`. */
  const effectiveContribFor = (a) => {
    if (!a.contribOverride && isAutoDerivable(a)) return autoContribFor(a) || 0;
    return Number(a.contribAmount) || 0;
  };

  /* The accounts list passed to the projection, with effective contributions
     baked in. Keep `contribAmount` field name for compatibility with the
     pure calc function. */
  const projAccounts = useMemo(
    () => accounts.map(a => ({ ...a, contribAmount: effectiveContribFor(a) })),
    [accounts, cSalNum, kSalNum, c4preNum, c4roNum, k4preNum, k4roNum, cLump, kLump, cMatchAnnual, kMatchAnnual, hsaTotalAnnual]
  );

  /* Run the projection. */
  const projection = useMemo(() => {
    return forecastGrowthAccounts(projAccounts, horizon, {
      baseYear,
      inflationPct,
      p1BirthYear: tax?.p1BirthYear || null,
      p2BirthYear: tax?.p2BirthYear || null,
      hsaCoverage,
      getPoolLimit,
      accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
      limitGrowthPct,
    });
  }, [projAccounts, horizon, baseYear, inflationPct, tax?.p1BirthYear, tax?.p2BirthYear, hsaCoverage, limitGrowthPct]);

  /* Chart data: stacked area, one series per account. We use account ids
     for the dataKey so renames don't break Recharts' internal series state.
     Also includes:
       - `total` / `totalReal` — totals in nominal and real dollars
       - `fireThresh` — the nominal-dollars FI target for that year, which is
         `fireTarget × (1 + inflation)^y`. Plotted as a Line on the chart so
         it visually matches the calc (nominal balance vs inflation-adjusted
         target). Set to `null` when FIRE is off so the line doesn't render.
  */
  const chartData = useMemo(() => {
    const inflRate = (Number(inflationPct) || 0) / 100;
    const showFire = fireEnabled && fireTarget > 0;
    return projection.years.map(row => {
      const point = {
        year: row.year,
        calendarYear: row.calendarYear,
        total: row.totals.nominal,
        totalReal: row.totals.real,
        fireThresh: showFire ? fireTarget * Math.pow(1 + inflRate, row.year) : null,
      };
      for (const a of accounts) {
        point[a.id] = row.byAccount[a.id]?.nominal || 0;
      }
      return point;
    });
  }, [projection, accounts, fireEnabled, fireTarget, inflationPct]);

  /* Color assignment per account. With Color by Owner the index is per-owner;
     with Color by Type the index is per-pool. */
  const accountColors = useMemo(() => {
    const colors = {};
    if (colorBy === "owner") {
      // One color per owner (intentional flat coloring — all P1 accounts paint
      // the same blue so the stacked chart reads as "P1's share / P2's share /
      // joint share").
      for (const a of accounts) {
        colors[a.id] = colorForAccountByOwner(a);
      }
    } else {
      const byPool = {};
      for (const a of accounts) {
        const p = poolForType(a.type);
        byPool[p] = byPool[p] || [];
        colors[a.id] = colorForAccountByPool(a, byPool[p].length);
        byPool[p].push(a);
      }
    }
    return colors;
  }, [accounts, colorBy]);

  /* Per-pool ending-balance summary for the cards row. */
  const poolSummary = useMemo(() => {
    const last = projection.years[projection.years.length - 1];
    if (!last) return [];
    const pools = {};
    for (const a of accounts) {
      const pool = poolForType(a.type);
      pools[pool] = pools[pool] || { nominal: 0, real: 0, contributions: 0, count: 0 };
      pools[pool].nominal += last.byAccount[a.id]?.nominal || 0;
      pools[pool].real += last.byAccount[a.id]?.real || 0;
      pools[pool].contributions += last.byAccount[a.id]?.contribCum || 0;
      pools[pool].count += 1;
    }
    return Object.entries(pools).map(([pool, v]) => ({ pool, ...v }));
  }, [projection, accounts]);

  const POOL_LABELS = {
    "401k_employee": "401(k) Total",
    "ira": "IRA Total",
    "hsa": "HSA",
    "_other": "Cash / Taxable",
  };

  /* FIRE crossover: when does the nominal total cross the inflation-adjusted
     FIRE target?
     Why nominal-vs-inflated rather than real-vs-flat: the user's eye reads
     the stacked-area chart as "when does my account balance reach my FI
     number?" — but the chart shows nominal balances and the FI ReferenceLine
     in this branch is a series of inflation-adjusted target values. Comparing
     nominal balance to an inflation-adjusted target is mathematically
     equivalent to comparing real balance to a flat target (the inflation
     factor cancels), but it makes the chart and the math agree visually:
     when the stack crosses the target line, "Years to FIRE" reflects exactly
     that intersection. Returns null if not reached, 0 if already there, else
     fractional year. */
  const yearsToFireAdv = useMemo(() => {
    if (!fireEnabled || !fireTarget || fireTarget <= 0) return null;
    const series = projection.years;
    if (!series.length) return null;
    const inflRate = (Number(inflationPct) || 0) / 100;
    const targetAt = (y) => fireTarget * Math.pow(1 + inflRate, y);
    if (series[0].totals.nominal >= targetAt(0)) return 0;
    for (let y = 1; y < series.length; y++) {
      const tgt = targetAt(y);
      if (series[y].totals.nominal >= tgt) {
        const prev = series[y - 1].totals.nominal;
        const cur = series[y].totals.nominal;
        // Linear interpolate the crossover within the year. Use the year-y
        // target for the threshold — it's close enough since target also
        // grows smoothly within the year.
        const frac = cur > prev ? (tgt - prev) / (cur - prev) : 0;
        return (y - 1) + Math.max(0, Math.min(1, frac));
      }
    }
    return null;
  }, [projection, fireEnabled, fireTarget, inflationPct]);

  /* Look up the per-account current-year limit + ramp years for each
     account that participates in a pool. Used in the input row UI. */
  const accountInsight = (a) => {
    const pool = ACCOUNT_TYPE_TO_POOL[a.type];
    if (!pool) return null;
    const ageNow = (() => {
      if (a.owner === "p1" && tax?.p1BirthYear) return baseYear - tax.p1BirthYear;
      if (a.owner === "p2" && tax?.p2BirthYear) return baseYear - tax.p2BirthYear;
      if (a.owner === "joint") {
        if (tax?.p1BirthYear && tax?.p2BirthYear) return baseYear - Math.min(tax.p1BirthYear, tax.p2BirthYear);
        if (tax?.p1BirthYear) return baseYear - tax.p1BirthYear;
        if (tax?.p2BirthYear) return baseYear - tax.p2BirthYear;
      }
      return null;
    })();
    const limit = getPoolLimit(pool, baseYear, ageNow, hsaCoverage);
    const eff = effectiveContribFor(a);
    const incr = Number(a.annualIncrease) || 0;
    const yearsToHit = yearsToHitPoolLimit(eff, incr, limit);
    return { pool, limit, ageNow, yearsToHit, eff };
  };

  const horizonOpts = [1, 5, 10, 20, 30];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Shared horizon at top of advanced — same state as simple. */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Horizon:</span>
          {horizonOpts.map(h => (
            <button key={h} onClick={() => setHorizon(h)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: horizon === h ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: horizon === h ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{h}y</button>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 8px" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>FIRE:</span>
          <button onClick={() => setFireEnabled(!fireEnabled)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: fireEnabled ? "#F39C12" : "var(--input-bg,#f5f5f5)", color: fireEnabled ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Toggles FIRE mode in both Simple and Advanced views.">{fireEnabled ? "ON" : "OFF"}</button>
          {fireEnabled && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              title={"Multiplier × annual expenses = FI target (in today's $).\n\n• 25× = 4% rule (~30yr retirement)\n• 28-33× = 3-3.5% rule (50+yr horizon)\n• 20× = 5% (aggressive)\n\nLowering = larger target = safer but takes longer."}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>×</span>
              <input
                type="text"
                value={fireMultiplier}
                onChange={e => setFireMultiplier(e.target.value)}
                onBlur={e => {
                  // Snap to a sane number on blur. Empty string → reset to 25.
                  const v = evalF(e.target.value);
                  if (!isFinite(v) || v <= 0) setFireMultiplier("25");
                  else setFireMultiplier(String(v));
                }}
                style={{ width: 50, padding: "3px 6px", fontSize: 12, fontWeight: 700, textAlign: "center", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)", fontFamily: "'DM Sans',sans-serif" }} />
            </span>
          )}
          {fireEnabled && fireTarget > 0 && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }} title={`${fireMultiplierNum}× annual expenses (${fmt(fireAnnualExpenses)}/yr)`}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Target:</span>
              <strong style={{ fontSize: 17, fontWeight: 800, color: "#F39C12", fontFamily: "'Fraunces',serif" }}>{fmt(fireTarget)}</strong>
            </span>
          )}
        </div>
      </Card>

      {/* Account list */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Accounts</h3>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Sort:</span>
            {[
              { k: "manual",  label: "Manual",   title: "Drag rows by the ⠿ handle to reorder. Persists." },
              { k: "name",    label: "A–Z",      title: "Alphabetical by account name. Drag is disabled." },
              { k: "balance", label: "Balance",  title: "By starting balance, largest first. Drag is disabled." },
            ].map(o => (
              <button key={o.k} onClick={() => setSortMode(o.k)} title={o.title}
                style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "none", borderRadius: 5, background: sortMode === o.k ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: sortMode === o.k ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>
                {o.label}
              </button>
            ))}
            <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 4px" }} />
            <button
              onClick={flipAllCap}
              title={allCapped ? "All accounts capped — click to uncap all" : noneCapped ? "No accounts capped — click to cap all" : "Some accounts capped — click to cap all"}
              style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "transparent", color: "var(--tx2,#555)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: allCapped ? "#2ECC71" : capMixed ? "#F39C12" : "#888" }} />
              Cap all at IRS limits
            </button>
            <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 4px" }} />
            <button onClick={expandAll} disabled={allExpanded} style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "transparent", color: allExpanded ? "var(--tx3,#bbb)" : "var(--tx2,#555)", cursor: allExpanded ? "default" : "pointer" }}>Expand all</button>
            <button onClick={collapseAll} disabled={allCollapsed} style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "transparent", color: allCollapsed ? "var(--tx3,#bbb)" : "var(--tx2,#555)", cursor: allCollapsed ? "default" : "pointer" }}>Collapse all</button>
            <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 4px" }} />
            <button onClick={resetToDefaults} style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "transparent", color: "var(--tx3,#888)", cursor: "pointer" }} title="Replace all accounts with the default starter list.">Reset</button>
          </div>
        </div>

        {/* Projection assumptions: limit growth %. Small inline mini-section. */}
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--input-bg,#fafafa)", borderRadius: 6, fontSize: 11, color: "var(--tx2,#555)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>IRS limit growth:</span>
          <div style={{ width: 90 }}>
            <NI value={String(limitGrowthPct)} onChange={v => setForecast({ ...forecast, limitGrowthPct: evalF(v) })} onBlurResolve />
          </div>
          <span style={{ fontSize: 10, color: "var(--tx3,#888)" }}>
            % per year applied to today's IRS limits for future projection years (rounded to nearest $500). Default 2.5%. Set to 0 to freeze limits at today's values.
          </span>
        </div>

        {(!tax?.p1BirthYear && !tax?.p2BirthYear) && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 6, fontSize: 12, color: "#8A6D3B" }}>
            <strong>No birth years set.</strong> Catch-up contributions (50+ standard, 60-63 super, 55+ HSA) won't apply to projections. Add birth years on the Income tab to enable.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {accounts.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--tx3,#888)", fontSize: 12 }}>No accounts. Add one below.</div>
          )}
          {displayedAccounts.map(a => {
            const insight = accountInsight(a);
            const eff = effectiveContribFor(a);
            const isOver = insight && eff > insight.limit;
            const color = accountColors[a.id] || "#888";
            const isExp = !!expanded[a.id];
            const baseLabel = deriveAccountName({ ...a, nickname: "" }, p1Name, p2Name);
            const auto = isAutoDerivable(a);
            const isAutoMode = auto && !a.contribOverride;
            const isMatchAcct = a.type === "401k_match";
            const matchLumpForOwner = a.owner === "p1" ? cLump : a.owner === "p2" ? kLump : false;
            const matchOwnerName = a.owner === "p1" ? p1Name : a.owner === "p2" ? p2Name : "";
            const isHSA = a.type === "hsa_cash" || a.type === "hsa_invested" || a.type === "hsa";
            const isDragging = dragId === a.id;
            const isDragOver = dragOverId === a.id && dragId !== a.id;
            const dragEnabled = sortMode === "manual";
            return (
              <div key={a.id}
                onDragOver={dragEnabled ? onDragOver(a.id) : undefined}
                onDragLeave={dragEnabled ? onDragLeave : undefined}
                onDrop={dragEnabled ? onDrop(a.id) : undefined}
                style={{
                  border: "1px solid var(--bdr,#e0e0e0)",
                  borderTop: isDragOver ? "2px solid #556FB5" : "1px solid var(--bdr,#e0e0e0)",
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 8, overflow: "hidden",
                  opacity: isMatchAcct && matchLumpForOwner ? 0.55 : (isDragging ? 0.4 : 1),
                  transition: "opacity 0.15s",
                }}>
                {/* Header row — always visible */}
                <div onClick={() => toggleExpand(a.id)} style={{ display: "flex", alignItems: "center", padding: "10px 12px", cursor: "pointer", gap: 10, background: "var(--input-bg,#fafafa)", flexWrap: "wrap" }}>
                  {/* Drag handle. Only draggable in manual sort mode. The ⠿
                      handle is the drag source — the rest of the header row
                      stays clickable for expand/collapse. */}
                  <span
                    draggable={dragEnabled}
                    onDragStart={dragEnabled ? onDragStart(a.id) : undefined}
                    onDragEnd={dragEnabled ? onDragEnd : undefined}
                    onClick={e => e.stopPropagation()}
                    title={dragEnabled ? "Drag to reorder" : `Reordering disabled while sorted by ${sortMode === "name" ? "name" : "balance"} — switch Sort to Manual to drag.`}
                    style={{
                      cursor: dragEnabled ? "grab" : "not-allowed",
                      color: dragEnabled ? "var(--tx3,#888)" : "var(--tx3,#ddd)",
                      fontSize: 14, lineHeight: 1, userSelect: "none",
                      padding: "0 2px",
                    }}
                  >⠿</span>
                  <span style={{ fontSize: 11, color: "var(--tx3,#888)", width: 12 }}>{isExp ? "▾" : "▸"}</span>
                  <input
                    value={a.nickname || ""}
                    onChange={e => updateAccount(a.id, { nickname: e.target.value })}
                    onClick={e => e.stopPropagation()}
                    placeholder="+ nickname"
                    style={{ width: 110, border: "1px dashed var(--bdr,#ddd)", borderRadius: 4, background: "transparent", fontSize: 11, fontWeight: 600, color: "var(--card-color,#222)", padding: "3px 6px" }}
                  />
                  <span style={{ flex: "1 1 200px", fontSize: 13, fontWeight: 700, color: "var(--card-color,#222)", padding: 4 }}>
                    {baseLabel}
                    {isMatchAcct && matchLumpForOwner && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--tx3,#888)", fontStyle: "italic" }}>(combined into pre-tax)</span>
                    )}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--tx3,#888)", padding: "2px 6px", background: "var(--card-bg,#fff)", borderRadius: 4, fontWeight: 600 }}>{ACCOUNT_TYPE_LABELS[a.type] || a.type}</span>
                  <span style={{ fontSize: 10, color: "var(--tx3,#888)" }}>{a.owner === "p1" ? p1Name : a.owner === "p2" ? p2Name : "Joint"}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--card-color,#222)", minWidth: 90, textAlign: "right" }}>{fmt(Number(a.startBalance) || 0)}</span>
                  <button onClick={e => { e.stopPropagation(); removeAccount(a.id); }} title="Remove account" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#ccc", padding: "0 4px" }}>×</button>
                </div>

                {/* Expanded inputs */}
                {isExp && (
                  <div style={{ padding: 12, display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Type</label>
                      <select value={a.type} onChange={e => updateAccount(a.id, { type: e.target.value, capAtLimit: !["taxable","cash","custom","401k_match"].includes(e.target.value) })} style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
                        {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Owner</label>
                      <select value={a.owner} onChange={e => updateAccount(a.id, { owner: e.target.value })} style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
                        <option value="p1">{p1Name}</option>
                        <option value="p2">{p2Name}</option>
                        <option value="joint">Joint</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Starting Balance</label>
                      <NI value={String(a.startBalance)} onChange={v => updateAccount(a.id, { startBalance: evalF(v) })} onBlurResolve prefix="$" />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Annual Return %</label>
                      <NI value={String(a.annualReturn)} onChange={v => updateAccount(a.id, { annualReturn: evalF(v) })} onBlurResolve />
                    </div>
                    <div style={{ gridColumn: mob ? "1/-1" : "auto" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: isOver ? "#E8573A" : "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        <span>Annual Contribution {isOver && "⚠"}</span>
                        {/* Status pill: shows whether the value below comes
                            from auto-derivation or a manual override. Click to
                            switch back/forth. Always rendered when the type
                            HAS an auto source (401k, HSA, IRA with Income
                            value, cash w/ source). For unsupported types it's
                            hidden — there's nothing to "auto" to. */}
                        {auto && (
                          <button
                            onClick={() => updateAccount(a.id, { contribOverride: !a.contribOverride })}
                            title={isAutoMode ? "Auto: derived from Income tab (or recent transaction history for cash accounts). Click to switch to manual override." : "Manual: your typed value. Click to switch back to auto."}
                            style={{ padding: "1px 6px", fontSize: 9, fontWeight: 700, border: "none", borderRadius: 4, background: isAutoMode ? "#4ECDC4" : "#F39C12", color: "#fff", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5 }}
                          >
                            {isAutoMode ? "Auto" : "Manual"}
                          </button>
                        )}
                        {/* Reset-to-Income button — only shows when (a) the
                            row has an auto source available AND (b) the user
                            has actively overridden it. One click flips off
                            override AND copies the auto value into
                            contribAmount, so re-flipping back to Manual later
                            doesn't lose the snapshot in the input. */}
                        {auto && !isAutoMode && (
                          <button
                            onClick={() => {
                              const autoVal = autoContribFor(a) || 0;
                              updateAccount(a.id, { contribOverride: false, contribAmount: autoVal });
                            }}
                            title="Reset to the auto-derived value from the Income tab."
                            style={{ padding: "1px 6px", fontSize: 9, fontWeight: 700, border: "1px solid #4ECDC4", borderRadius: 4, background: "transparent", color: "#4ECDC4", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5 }}
                          >
                            ↺ Reset
                          </button>
                        )}
                      </label>
                      {/* Cash-account-only source picker. Switches the auto
                          value between manual entry and "net savings over the
                          last N months from your transaction history." When
                          set to a non-manual mode, autoContribFor returns the
                          computed value and Auto-mode displays it. */}
                      {a.type === "cash" && (
                        <div style={{ marginBottom: 4 }}>
                          <select
                            value={a.contribSource || "manual"}
                            onChange={e => {
                              const v = e.target.value;
                              const patch = { contribSource: v };
                              if (v !== "manual") patch.contribOverride = false;
                              updateAccount(a.id, patch);
                            }}
                            title="Pick the contribution source for this cash account. 'Last N months' uses your transaction history (income − expenses, transfer rows excluded) annualized to a yearly amount."
                            style={{ width: "100%", padding: "4px 6px", fontSize: 11, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)", marginBottom: 4 }}
                          >
                            <option value="manual">Source: Manual entry</option>
                            <option value="actual3">Source: Last 3 months actual</option>
                            <option value="actual6">Source: Last 6 months actual</option>
                            <option value="actual12">Source: Last 12 months actual</option>
                          </select>
                        </div>
                      )}
                      {/* Always-editable contribution input. In Auto mode the
                          input shows the derived value (read-only feel — typing
                          immediately switches the row to Manual). In Manual
                          mode the input is the override.

                          Why the input is always rendered (vs the previous
                          read-only chip when in Auto mode): scenario planning
                          on this tab needs to be one-edit-away. The user can
                          tweak any number to test a what-if without
                          ceremony, and the ↺ Reset button takes them back
                          to the Income-tab anchor. */}
                      <NI
                        value={isAutoMode ? String(autoContribFor(a) || 0) : String(a.contribAmount)}
                        onChange={v => {
                          // Typing in Auto mode flips to Manual automatically.
                          // The patch sets both override + amount in one update
                          // so Recharts/projection re-render once, not twice.
                          const numeric = evalF(v);
                          if (isAutoMode) {
                            updateAccount(a.id, { contribOverride: true, contribAmount: numeric });
                          } else {
                            updateAccount(a.id, { contribAmount: numeric });
                          }
                        }}
                        onBlurResolve
                        prefix="$"
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Annual Increase %</label>
                      <NI value={String(a.annualIncrease)} onChange={v => updateAccount(a.id, { annualIncrease: evalF(v) })} onBlurResolve />
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--tx2,#555)", cursor: insight ? "pointer" : "not-allowed", opacity: insight ? 1 : 0.4 }}>
                        <input type="checkbox" checked={!!a.capAtLimit} disabled={!insight} onChange={e => updateAccount(a.id, { capAtLimit: e.target.checked })} />
                        Cap at IRS limit
                      </label>
                    </div>
                    {/* HSA coverage selector — only on HSA accounts. Used to
                        be a global toolbar chip but it's really an HSA-specific
                        setting (other account types ignore it), so the input
                        lives on the HSA row that needs it. Still persists in
                        forecast.hsaCoverage (single household-level setting,
                        unchanged for backward-compat with snapshots). */}
                    {isHSA && (
                      <div style={{ gridColumn: mob ? "1/-1" : "auto" }}>
                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}
                          title="HSA contribution limit depends on health-plan coverage. Family limit (~$8,300 in 2025) is roughly 2× self-only.">
                          HSA Coverage
                        </label>
                        <select
                          value={hsaCoverage}
                          onChange={e => setForecast({ ...forecast, hsaCoverage: e.target.value })}
                          style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                        >
                          <option value="family">Family</option>
                          <option value="self">Self-only</option>
                          <option value="both-self">Both self-only (split household)</option>
                        </select>
                      </div>
                    )}
                    {/* Per-person match-lump toggle, only shown on 401k_match accounts */}
                    {isMatchAcct && (a.owner === "p1" || a.owner === "p2") && setTax && (
                      <div style={{ gridColumn: "1/-1", padding: "8px 10px", background: matchLumpForOwner ? "#E8F4F8" : "var(--input-bg,#f8f8f8)", border: matchLumpForOwner ? "1px solid #B3D9E0" : "1px solid var(--bdr,#eee)", borderRadius: 6 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--tx2,#555)", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={matchLumpForOwner}
                            onChange={e => setTax(prev => ({ ...prev, [a.owner === "p1" ? "c401MatchLump" : "k401MatchLump"]: e.target.checked }))}
                          />
                          <span>Combine {matchOwnerName}'s match with {matchOwnerName}'s pre-tax 401(k)</span>
                        </label>
                        <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 4, marginLeft: 22 }}>
                          When ON, this match account contributes 0 and the match is folded into {matchOwnerName}'s pre-tax 401(k) auto-contribution. Reflects how some plans report combined contributions; off keeps them visually separate.
                        </div>
                      </div>
                    )}
                    {insight && (
                      <div style={{ gridColumn: "1/-1", padding: "8px 10px", background: "var(--input-bg,#f8f8f8)", borderRadius: 6, fontSize: 11, color: "var(--tx2,#555)", lineHeight: 1.6 }}>
                        <span style={{ color: "var(--tx3,#888)" }}>Pool limit ({baseYear}, {a.owner === "joint" ? "household" : a.owner === "p1" ? p1Name : p2Name}{insight.ageNow ? `, age ${insight.ageNow}` : ""}):</span> <strong>{fmt(insight.limit)}/yr</strong>
                        {isOver && (
                          <span style={{ color: "#E8573A", marginLeft: 8 }}>
                            ⚠ Over by {fmt(eff - insight.limit)}{a.capAtLimit ? " — will be capped in projection" : ""}
                          </span>
                        )}
                        {!isOver && insight.yearsToHit !== null && insight.yearsToHit > 0 && (
                          <span style={{ marginLeft: 8 }}>At {a.annualIncrease}%/yr increase, hits limit in <strong>year {insight.yearsToHit}</strong></span>
                        )}
                        {(insight.pool === "401k_employee" || insight.pool === "ira") && (
                          <div style={{ color: "var(--tx3,#888)", fontSize: 10, marginTop: 4 }}>
                            Pool shared with other {insight.pool === "401k_employee" ? "401(k)" : "IRA"} accounts owned by {a.owner === "p1" ? p1Name : a.owner === "p2" ? p2Name : "this person"}.
                          </div>
                        )}
                        {insight.pool === "hsa" && (
                          <div style={{ color: "var(--tx3,#888)", fontSize: 10, marginTop: 4 }}>
                            Household HSA pool — limit shared across all HSA accounts (cash + invested + legacy).
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Single "+ Add account" button → popover with all type options.
            Replaces the old flat chip row (one button per type) which got
            unwieldy as the type list grew. The menu groups types by IRS pool
            so 401(k), IRA, HSA, and "Other" are visually clustered. */}
        <div style={{ marginTop: 12, position: "relative" }} ref={addMenuRef}>
          <button
            onClick={() => setAddMenuOpen(o => !o)}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "1px dashed var(--bdr,#ccc)", borderRadius: 6, background: addMenuOpen ? "var(--input-bg,#f5f5f5)" : "transparent", cursor: "pointer", color: "var(--tx2,#555)" }}
            title="Pick an account type to add to the projection."
          >
            + Add account {addMenuOpen ? "▴" : "▾"}
          </button>
          {addMenuOpen && (() => {
            // Group types by display group so the menu has visible structure.
            // "hsa" (legacy) is hidden — only the explicit cash/invested split
            // is exposed for new accounts.
            const groups = [
              { label: "401(k)",   types: ["401k_pretax", "401k_roth", "401k_match"] },
              { label: "IRA",      types: ["ira_traditional", "ira_roth"] },
              { label: "HSA",      types: ["hsa_cash", "hsa_invested"] },
              { label: "Other",    types: ["taxable", "cash", "custom"] },
            ];
            return (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, minWidth: 240, padding: 8, background: "var(--card-bg,#fff)", border: "1px solid var(--bdr,#ddd)", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.12)" }}>
                {groups.map((g, gi) => (
                  <div key={g.label} style={{ marginBottom: gi < groups.length - 1 ? 6 : 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 0.5, padding: "4px 8px 2px" }}>{g.label}</div>
                    {g.types.map(t => (
                      <button
                        key={t}
                        onClick={() => { addAccount(t); setAddMenuOpen(false); }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, border: "none", borderRadius: 4, background: "transparent", color: "var(--tx,#222)", cursor: "pointer" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--input-bg,#f5f5f5)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {ACCOUNT_TYPE_LABELS[t] || t}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Card>

      {/* Per-pool summary cards — moved above the chart so the headline
          numbers anchor the visualization that follows. Cards are draggable
          (drag handle ⠿ in each card's top-right corner); order is persisted
          per-device. New cards appear at the end. */}
      {poolSummary.length > 0 && (() => {
        // Build the card definitions first so the same id schema is shared
        // between the order-resolver and the renderer.
        const cardDefs = [];
        for (const p of poolSummary) {
          cardDefs.push({
            id: `pool:${p.pool}`,
            render: () => (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{POOL_LABELS[p.pool] || p.pool}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--card-color,#222)", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(p.nominal))}</div>
                <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4 }}>Real: {fmt(Math.round(p.real))}</div>
                <div style={{ fontSize: 11, color: "var(--tx3,#888)" }}>Contributed: {fmt(Math.round(p.contributions))}</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#bbb)", marginTop: 2 }}>{p.count} account{p.count === 1 ? "" : "s"}</div>
              </>
            ),
          });
        }
        cardDefs.push({
          id: "total",
          render: () => (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Total at Year {horizon}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(poolSummary.reduce((s, p) => s + p.nominal, 0)))}</div>
              <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4 }}>Real: {fmt(Math.round(poolSummary.reduce((s, p) => s + p.real, 0)))}</div>
            </>
          ),
        });
        if (fireEnabled && fireTarget > 0) {
          cardDefs.push({
            id: "fire",
            render: () => (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Years to FIRE</div>
                {yearsToFireAdv === null ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#E8573A", fontFamily: "'Fraunces',serif" }}>Unreachable</div>
                    <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>within {horizon}y horizon</div>
                  </>
                ) : yearsToFireAdv === 0 ? (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>Already FI ✓</div>
                    <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>{fmt(fireTarget)} target hit</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#F39C12", fontFamily: "'Fraunces',serif" }}>{yearsToFireAdv.toFixed(1)} yr</div>
                    <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>target: {fmt(fireTarget)}</div>
                  </>
                )}
              </>
            ),
          });
        }
        // Resolve order: take user's saved order, drop ids that no longer
        // exist, append any new ids at the end.
        const defIds = cardDefs.map(c => c.id);
        const saved = Array.isArray(cardOrder) ? cardOrder.filter(id => defIds.includes(id)) : [];
        const missing = defIds.filter(id => !saved.includes(id));
        const finalIds = [...saved, ...missing];
        const finalCards = finalIds.map(id => cardDefs.find(c => c.id === id)).filter(Boolean);
        const cols = mob ? "1fr 1fr" : `repeat(${Math.min(finalCards.length, 6)}, 1fr)`;
        return (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12 }}>
            {finalCards.map(c => {
              const isCardDragging = cardDragId === c.id;
              const isCardDragOver = cardDragOverId === c.id && cardDragId !== c.id;
              return (
                <div key={c.id}
                  onDragOver={onCardDragOver(c.id)}
                  onDragLeave={onCardDragLeave}
                  onDrop={onCardDrop(c.id, finalIds)}
                  style={{
                    position: "relative",
                    outline: isCardDragOver ? "2px solid #556FB5" : "none",
                    outlineOffset: 2,
                    borderRadius: 10,
                    opacity: isCardDragging ? 0.4 : 1,
                    transition: "opacity 0.15s",
                  }}>
                  <Card>
                    {c.render()}
                    <span
                      draggable
                      onDragStart={onCardDragStart(c.id)}
                      onDragEnd={onCardDragEnd}
                      title="Drag to reorder cards"
                      style={{
                        position: "absolute", top: 6, right: 8,
                        cursor: "grab", color: "var(--tx3,#bbb)",
                        fontSize: 14, lineHeight: 1, userSelect: "none",
                      }}
                    >⠿</span>
                  </Card>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Stacked area chart — totals over time */}
      {accounts.length > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Projected Balance by Account</h3>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, marginLeft: "auto" }}>Color by:</span>
            <button onClick={() => setColorBy("type")} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5, background: colorBy === "type" ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: colorBy === "type" ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>Type</button>
            <button onClick={() => setColorBy("owner")} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5, background: colorBy === "owner" ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: colorBy === "owner" ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>Owner</button>
          </div>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#e0e0e0)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} label={{ value: "Years from now", position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--tx3,#888)" }} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} width={80} />
                <Tooltip
                  contentStyle={{ background: "var(--card-bg,#fff)", border: "1px solid var(--bdr,#ddd)", borderRadius: 6, fontSize: 12 }}
                  formatter={(v, k) => {
                    if (k === "fireThresh") return [fmt(v), "FI target (year-y $)"];
                    if (k === "total") return [fmt(v), "Total (nominal)"];
                    if (k === "totalReal") return [fmt(v), "Total (today's $)"];
                    const a = accounts.find(x => x.id === k);
                    return [fmt(v), a ? deriveAccountName(a, p1Name, p2Name) : k];
                  }}
                  labelFormatter={(y) => `Year ${y} (${baseYear + Number(y)})`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {accounts.map(a => (
                  <Area key={a.id} type="monotone" dataKey={a.id} name={deriveAccountName(a, p1Name, p2Name)} stackId="1" fill={accountColors[a.id]} stroke={accountColors[a.id]} fillOpacity={0.7} />
                ))}
                {/* FI threshold as a rising line, not a flat ReferenceLine.
                    The line value at year y is the FI target inflated to
                    that year's dollars — same comparison the years-to-FI
                    calc uses, so chart and text always agree. When the
                    nominal stack crosses this line, the text card
                    confirms the same crossover. */}
                {fireEnabled && fireTarget > 0 && (
                  <Line type="monotone" dataKey="fireThresh" name="FI target" stroke="#F39C12" strokeWidth={2.5} strokeDasharray="6 3" dot={false} activeDot={{ r: 5, fill: "#F39C12", stroke: "#F39C12" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {fireEnabled && fireTarget > 0 && (
            <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 8, lineHeight: 1.4, fontStyle: "italic" }}>
              The orange dashed line is your FI target rising with inflation ({Number(inflationPct) || 0}%/yr) — that's how much your account needs in <em>that year's</em> dollars to deliver today's purchasing power. When the stacked total crosses this line, you're FI.
            </div>
          )}
        </Card>
      )}

      {/* Year-by-year table with per-account contribution columns */}
      {accounts.length > 0 && (
        <Card>
          <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Year-by-Year Breakdown</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--input-bg,#f8f8f8)" }}>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Year</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Total</th>
                  {accounts.map(a => (
                    <th key={a.id} style={{ padding: 8, textAlign: "right", fontWeight: 700, color: accountColors[a.id], borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>{deriveAccountName(a, p1Name, p2Name)}</th>
                  ))}
                  {accounts.map(a => (
                    <th key={a.id + "_c"} style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#aaa)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap", fontStyle: "italic" }}>{deriveAccountName(a, p1Name, p2Name)} Contrib.</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projection.years.map(row => (
                  <tr key={row.year} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                    <td style={{ padding: 6, fontWeight: 700, color: "var(--card-color,#222)" }}>{row.year} <span style={{ color: "var(--tx3,#aaa)", fontWeight: 400 }}>({row.calendarYear})</span></td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 700, color: "var(--card-color,#222)" }}>{fmt(Math.round(row.totals.nominal))}</td>
                    {accounts.map(a => (
                      <td key={a.id} style={{ padding: 6, textAlign: "right", color: "var(--tx2,#555)" }}>{fmt(Math.round(row.byAccount[a.id]?.nominal || 0))}</td>
                    ))}
                    {accounts.map(a => {
                      const c = row.byAccount[a.id]?.contribution || 0;
                      const series = projection.accountSeries[a.id]?.[row.year];
                      const wasCapped = series?.capped;
                      return (
                        <td key={a.id + "_c"} style={{ padding: 6, textAlign: "right", color: wasCapped ? "#E8573A" : "var(--tx3,#888)", fontStyle: "italic", fontSize: 11 }}>
                          {row.year === 0 ? "—" : fmt(Math.round(c))}{wasCapped ? " ⚠" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {projection.poolWarnings.length > 0 && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "#FFF3F0", border: "1px solid #FFCDC2", borderRadius: 6, fontSize: 11, color: "#8A4A3F" }}>
              <strong>⚠ Capped {projection.poolWarnings.length} time{projection.poolWarnings.length === 1 ? "" : "s"}.</strong> Some contributions were reduced to fit within IRS pool limits. Toggle "Cap at IRS limit" off on individual accounts to model over-contribution scenarios.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
