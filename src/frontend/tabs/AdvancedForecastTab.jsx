import { useMemo, useState, useEffect } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, Area, Line, ComposedChart, ReferenceLine } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { fmt, fmtCompact, evalF, forecastGrowthAccounts, yearsToHitPoolLimit, calcMatch, cashBudgetContribution, poolHeadroom, toWk, rollAccountForward } from "../utils/calc.js";
import { actualAnnualContribution } from "../utils/forecastActuals.js";
import { getPoolLimit, ACCOUNT_TYPE_TO_POOL, defaultForecastAccounts } from "../data/taxDB.js";
import { newEndingItemId, getItemRefs, computeLoanEndsOn, resolveEndingEvents, applyPayoffLinks, aggregateObligationDebt, findItemRefConflicts, resolveItemRef, rollForwardBalance, debtPrincipalByMonth, addMonths, monthsSinceAsOf, routedTotalsBySubLoan, reducesFire, fireSpendingReductionByYear } from "../utils/endingItems.js";
import { resolveSubLoanGroup, aggregateSubLoanBalances } from "../utils/subLoans.js";
import { newOneTimeEventId, resolveOneTimeEvents, monthIndexToChartYear, eventMonthIndex } from "../utils/oneTimeEvents.js";
import { resolveLoans, aggregateDebt } from "../utils/loans.js";
import { firstHsaAccountByOwner as computeFirstHsaByOwner, resolveHsaContribution, hsaShareSumByOwner, isHsaType } from "../utils/hsaAllocation.js";
import { computeFireTarget, extractMixFromProjection } from "../utils/fireTarget.js";

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

/* ── FIRE rate/multiplier input ──
   Tiny controlled input for the FIRE row in the Advanced toolbar. Lets the
   user enter EITHER a safe withdrawal rate (e.g. "4" for 4%) OR a spending
   multiplier (e.g. "25" for 25× annual spending). Internally we always
   store SWR as the source of truth; multiplier mode converts via
   swr = 1 / mult and displays mult = 1 / swr.

   Why this exists as its own component (vs inline `NI`):
   - Toolbar has its own tight visual style (small text, 50–60px wide,
     compact padding) that doesn't fit `NI`'s 8px-pad / 2px-border / icon
     prefix look. Keeping toolbar inputs visually consistent matters more
     than DRY here.
   - The old inline `<input>` had a fully-controlled `value` driven by
     `(swr * 100).toFixed(2)` PLUS an onChange that ran `setSwr` on every
     keystroke. That made it impossible to backspace ("4.00" → backspace
     gives "4.0", parseFloat=4, setSwr(0.04), re-renders to "4.00" — no
     visible change), impossible to type sub-1% values ("0.5" never gets
     past "0"), and impossible to enter decimals at all ("4.5" snaps back
     to "4.00" after "4."). The local-while-focused pattern from `NI` is
     the standard fix in this codebase.

   Props:
   - swr: current SWR as decimal (0.04 = 4%)
   - setSwr: setter accepting a decimal
   - mode: "rate" or "multiplier" — controls what the user enters
*/
function FireRateInput({ swr, setSwr, mode }) {
  const isMult = mode === "multiplier";
  const displayFromSwr = (s) => {
    if (!isFinite(s) || s <= 0) return isMult ? "25.0" : "4.00";
    return isMult ? (1 / s).toFixed(1) : (s * 100).toFixed(2);
  };
  const [local, setLocal] = useState(() => displayFromSwr(swr));
  const [focused, setFocused] = useState(false);
  /* Resync the local string from `swr` whenever the user is NOT typing.
     This covers: mode toggle (rate ↔ multiplier), preset button clicks
     elsewhere, milestone restore, JSON import — anything that updates
     `swr` from outside this component. Without the !focused guard, every
     keystroke would re-trigger this effect and snap the cursor back. */
  useEffect(() => { if (!focused) setLocal(displayFromSwr(swr)); }, [swr, focused, isMult]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onFocus={e => { setFocused(true); e.target.select(); }}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = evalF(local);
        if (!isFinite(v) || v <= 0) { setSwr(0.04); return; }
        if (isMult) {
          /* Multiplier: clamp to sensible range. 5×–200× covers 20% SWR
             down to 0.5% SWR. Anything outside is almost certainly a
             typo. */
          const mult = Math.max(5, Math.min(200, v));
          setSwr(1 / mult);
        } else {
          /* Rate: 0.1%–50%. Same reasoning. */
          const rate = Math.max(0.1, Math.min(50, v));
          setSwr(rate / 100);
        }
      }}
      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
      style={{ width: isMult ? 50 : 54, padding: "3px 6px", fontSize: 12, fontWeight: 700, textAlign: "center", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)", fontFamily: "'DM Sans',sans-serif" }}
    />
  );
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
  // HSA per-person ANNUAL dollar amounts from the Income tab (Session 1 made
  // HSA a first-class field). Employee amounts drive the budget/taxes; here
  // they auto-fill the Advanced HSA account contributions so the same dollars
  // aren't entered twice. Employer amounts are free money — forecast growth
  // only, never in the budget. preDed/hsaEmployerMatchAnnual kept in the
  // signature for back-compat with any caller that still passes them, but are
  // no longer read for HSA.
  cHsa = "0", kHsa = "0", cHsaEmployer = "0", kHsaEmployer = "0",
  preDed = [], hsaEmployerMatchAnnual = 0, tExpW = 0, tSavW = 0, remW = 0,
  // Budget items — used by the Ending Obligations section to enumerate
  // candidate budget lines in a single dropdown grouped by section, and
  // to compute live monthly amounts at projection time. Shape matches
  // useAppState's exp/sav arrays: { n, c, t, v, p } (savings rows omit t).
  exp = [], sav = [],
  // Transactions + category sets enable the "from actual spending (last N
  // months)" contribution source on cash/savings accounts.
  transactions = [], cats = [], savCats = [], transferCats = [],
  // C bundle (from useAppState) — needs `net` (weekly paycheck net) and
  // C bundle (from useAppState) — needs `net` (weekly paycheck net) and
  // `eaipNet` (annual net bonus across both people) to drive the cash-budget
  // contribution source on cash/savings accounts. The per-account
  // contribSource dropdown (e.g., "budget-52-bonus") picks the math.
  C = {},
}) {
  /* Scenario inputs (horizon, inflation, FIRE) live on st.forecast.* so
     they sync across devices and round-trip with the Simple tab via the
     same fields rather than via localStorage. Display-only prefs
     (sortMode, colorBy, showChartLegend, cardOrder) stay in localStorage —
     those are per-device UI choices. */
  const setFc = (key, v) => setForecast && setForecast(prev => ({ ...(prev || {}), [key]: v }));
  const horizon = (forecast && Number.isFinite(Number(forecast.horizon))) ? Number(forecast.horizon) : 30;
  const setHorizon = (v) => setFc("horizon", v);

  const inflationPct = (forecast && forecast.inflationPct != null) ? forecast.inflationPct : "3";
  const setInflationPct = (v) => setFc("inflationPct", v);

  const fireEnabled = !!(forecast && forecast.fireEnabled);
  const setFireEnabled = (v) => setFc("fireEnabled", v);

  const fireMultiplier = (forecast && forecast.fireMultiplier != null) ? forecast.fireMultiplier : "25";
  const setFireMultiplier = (v) => setFc("fireMultiplier", v);

  /* Phase 15 — Tax-aware FIRE config, shared with Simple tab via
     forecast.fireConfig. See ForecastTab.jsx for the full doc; Advanced has
     a structural advantage: the user's actual account list with projected
     balances is right here, so the tax-character mix is derived live from
     the projection (extractMixFromProjection on the result year) rather
     than a one-shot estimate. */
  const fireConfig = (forecast && typeof forecast.fireConfig === "object" && forecast.fireConfig) ? forecast.fireConfig : {};
  const setFireCfg = (key, v) => setFc("fireConfig", { ...fireConfig, [key]: v });
  const swr = (typeof fireConfig.swr === "number" && fireConfig.swr > 0) ? fireConfig.swr : 0.04;
  const setSwr = (v) => setFireCfg("swr", v);
  const useSimpleMultiplier = !!fireConfig.useSimpleMultiplier;
  const setUseSimpleMultiplier = (v) => setFireCfg("useSimpleMultiplier", v);
  const retirementSpendingOverride = (typeof fireConfig.retirementSpendingOverride === "number") ? fireConfig.retirementSpendingOverride : null;
  const setRetirementSpendingOverride = (v) => setFireCfg("retirementSpendingOverride", v);
  const ltcgRate = (typeof fireConfig.ltcgRate === "number" && fireConfig.ltcgRate >= 0) ? fireConfig.ltcgRate : 0.15;
  const setLtcgRate = (v) => setFireCfg("ltcgRate", v);
  /* Input mode for the FIRE rate control: "rate" (default, e.g. 4%) or
     "multiplier" (e.g. 25×). Stored on fireConfig so it persists with
     state and is shared with the Simple tab if it ever adopts the same
     toggle. SWR remains the source of truth — this just picks how the
     user enters it. */
  const fireInputMode = (fireConfig.fireInputMode === "multiplier") ? "multiplier" : "rate";
  const setFireInputMode = (v) => setFireCfg("fireInputMode", v === "multiplier" ? "multiplier" : "rate");
  const [showFireBreakdown, setShowFireBreakdown] = useState(() => { try { return localStorage.getItem("forecast-adv-fire-breakdown") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("forecast-adv-fire-breakdown", showFireBreakdown ? "1" : "0"); } catch {} }, [showFireBreakdown]);

  const fireAnnualExpenses = useMemo(() => tExpW * 48, [tExpW]);
  const fireSpending = useMemo(() => {
    return retirementSpendingOverride != null ? retirementSpendingOverride : fireAnnualExpenses;
  }, [retirementSpendingOverride, fireAnnualExpenses]);

  const taxConfig = useMemo(() => ({
    year: String(tax?.year || "2026"),
    filing: "mfj",
    stateAbbr: tax?.p1State?.abbr || tax?.p2State?.abbr || "",
    ltcgRate,
    stateTaxesLTCG: true,
  }), [tax, ltcgRate]);

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

  /* "+ Add account" modal. Renders as a fixed overlay so it isn't clipped
     by the Card's overflow. Escape closes it; backdrop click closes it
     (handled inside the modal itself). */
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  useEffect(() => {
    if (!addMenuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setAddMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      const fromIdx = prevAccounts.findIndex(a => a.id === dragId);
      const toIdx = prevAccounts.findIndex(a => a.id === id);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prevAccounts];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, accounts: next };
    });
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

  /* Legend visibility on the projection chart. Per-device, persisted —
     once you hide it, it stays hidden across sessions. Default ON for
     discoverability (people don't know the colors at first). */
  const [showChartLegend, setShowChartLegend] = useState(() => {
    try { return localStorage.getItem("forecast-adv-legend") !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("forecast-adv-legend", showChartLegend ? "1" : "0"); } catch {} }, [showChartLegend]);

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

  /* ── Year-by-Year table: custom column order ──
     Lets the user drag any column header (except the pinned Year column)
     into any position, so e.g. a specific account's balance can sit right
     next to Year. Mirrors the card-order pattern: persist a flat array of
     column ids, append newly-appeared columns at the end, filter vanished
     ones. Column ids are stable:
       "total", "debt", "<accId>" (balance), "<accId>__c" (contribution).
     Year is NOT in the order list — it's always rendered first as a fixed
     anchor (a table with no stable left label column is disorienting). */
  const [colOrder, setColOrder] = useState(() => {
    try {
      const raw = localStorage.getItem("forecast-yby-col-order");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem("forecast-yby-col-order", JSON.stringify(colOrder || [])); } catch {}
  }, [colOrder]);
  const [colDragId, setColDragId] = useState(null);
  const [colDragOverId, setColDragOverId] = useState(null);
  const onColDragStart = (id) => (e) => {
    setColDragId(id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const onColDragOver = (id) => (e) => {
    if (!colDragId || colDragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setColDragOverId(id);
  };
  const onColDragLeave = () => setColDragOverId(null);
  const onColDrop = (id, allIds) => (e) => {
    e.preventDefault();
    if (!colDragId || colDragId === id) { setColDragId(null); setColDragOverId(null); return; }
    const ids = [...allIds];
    const fromIdx = ids.indexOf(colDragId);
    const toIdx   = ids.indexOf(id);
    if (fromIdx < 0 || toIdx < 0) { setColDragId(null); setColDragOverId(null); return; }
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setColOrder(ids);
    setColDragId(null); setColDragOverId(null);
  };
  const onColDragEnd = () => { setColDragId(null); setColDragOverId(null); };
  const resetColOrder = () => setColOrder([]);

  /* Per-account expand/collapse. Default: all collapsed for compactness. */
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));
  const expandAll = () => setExpanded(Object.fromEntries(accounts.map(a => [a.id, true])));
  const collapseAll = () => setExpanded({});
  const expandedCount = accounts.filter(a => expanded[a.id]).length;
  const allExpanded = accounts.length > 0 && expandedCount === accounts.length;
  const allCollapsed = expandedCount === 0;
  const expandMixed = !allExpanded && !allCollapsed;

  /* Functional updater: derive `next` from the latest forecast.accounts
     inside the setter, not from the closure-captured `accounts`. This
     prevents stale-state writes when a render is in flight (e.g. the user
     blurs an input while a prior setForecast hasn't flushed yet, or when
     the HSA-coverage setTimeout below fires between renders). Earlier code
     used `setForecast({ ...forecast, accounts: next })` which spread a
     stale `forecast` and could overwrite an in-flight account-amount
     update — manifesting as edits "resetting" right after the user typed
     them. Same pattern is applied to every setForecast call in this file. */
  const updateAccount = (id, patch) => {
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      return { ...prev, accounts: prevAccounts.map(a => a.id === id ? { ...a, ...patch } : a) };
    });
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
    // HSA accounts carry per-account coverage (self vs family) since the
    // limit is per-person. Default self-only — the safer under-estimate;
    // the user opts up to family via the per-row Coverage dropdown.
    const isAddingHSA = type === "hsa_cash" || type === "hsa_invested" || type === "hsa";
    if (isAddingHSA) newAcc.hsaCoverage = "self";
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      // If this owner already has an HSA account, inherit its coverage so the
      // two halves of one person's HSA stay in sync.
      if (isAddingHSA) {
        const sibling = prevAccounts.find(a =>
          (a.type === "hsa_cash" || a.type === "hsa_invested" || a.type === "hsa") && a.owner === newAcc.owner
        );
        if (sibling && (sibling.hsaCoverage === "self" || sibling.hsaCoverage === "family")) {
          newAcc.hsaCoverage = sibling.hsaCoverage;
        }
      }
      return { ...prev, accounts: [...prevAccounts, newAcc] };
    });
    setExpanded(p => ({ ...p, [id]: true }));
  };
  const removeAccount = (id) => {
    if (!window.confirm("Remove this account from the forecast? This only affects projections — no transaction data is touched.")) return;
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      return { ...prev, accounts: prevAccounts.filter(a => a.id !== id) };
    });
  };
  const resetToDefaults = () => {
    if (!window.confirm("Reset to the default account list? This replaces your current account configuration with the starter accounts. Cannot be undone.")) return;
    setForecast(prev => ({ ...prev, accounts: defaultForecastAccounts() }));
  };

  /* ── Ending Obligations (Phase X-A) ──
     Models budget lines that will stop at some future point (paid-off
     loans, fixed-term subscriptions, term insurance reaching end of
     premium). When the obligation ends, the freed monthly cash flow is
     redirected into a designated forecast account from that point on.
     See utils/endingItems.js for the data model. */
  const endingItems = Array.isArray(forecast?.endingItems) ? forecast.endingItems : [];
  /* Declared up here (not next to its mutators below) because the
     loan-endsOn auto-recompute effect references it in its body AND its
     dependency array. A dependency array is evaluated during render,
     before later `const` declarations execute — declaring oneTimeEvents
     below the effect would put it in the temporal dead zone and crash the
     whole tab on render ("Cannot access ... before initialization").
     Sibling of endingItems anyway — both are plain forecast reads. */
  const oneTimeEvents = Array.isArray(forecast?.oneTimeEvents) ? forecast.oneTimeEvents : [];
  /* baseYearMonth is the projection's "today" — anchored to the current
     month, not January-of-current-year. Loan amortization output like
     "Pays off: 2028-05 (24 mo)" needs to be honestly 24 months from
     where the user is right now. The forecast math itself buckets by
     calendar year, so a sub-year shift here only affects display +
     monthIndex math inside resolveEndingEvents (still month-precise). */
  const baseYearMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const updateEndingItem = (id, patch) => {
    setForecast(prev => {
      const cur = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      return { ...prev, endingItems: cur.map(ei => ei.id === id ? { ...ei, ...patch } : ei) };
    });
  };
  const removeEndingItem = (id) => {
    setForecast(prev => {
      const cur = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      return { ...prev, endingItems: cur.filter(ei => ei.id !== id) };
    });
  };

  /* Stable-IDs phase: auto-heal legacy itemRefs. Any ref that lacks an
     `id` but resolves to a budget item (by name or idx fallback) gets
     the matched item's id written into it, so the next save persists a
     stable reference. Idempotent: once every ref carries an id (or is a
     true orphan with no id to assign), this no-ops and stops firing.

     Runs whenever endingItems or the budget arrays change. The setForecast
     short-circuits to `prev` when nothing was upgraded, so steady-state
     renders don't churn. We only upgrade refs whose RESOLVED item has an
     id — orphans and items-without-ids are left untouched. */
  useEffect(() => {
    if (!Array.isArray(endingItems) || endingItems.length === 0) return;
    let anyUpgrade = false;
    const healed = endingItems.map(ei => {
      const refs = getItemRefs(ei);
      if (refs.length === 0) return ei;
      let refChanged = false;
      const nextRefs = refs.map(ref => {
        if (!ref || typeof ref.section !== "string") return ref;
        // Already has an id that resolves? Leave it.
        const { item, matchedBy, upgradeTo } = resolveItemRef(ref, exp, sav);
        if (!item) return ref; // orphan — nothing to heal
        if (matchedBy === "id") return ref; // already pinned
        if (!upgradeTo) return ref; // matched but target has no id yet
        refChanged = true;
        return { ...ref, id: upgradeTo.id, idx: upgradeTo.idx, name: upgradeTo.name };
      });
      if (!refChanged) return ei;
      anyUpgrade = true;
      // Preserve whichever field the obligation actually used.
      if (Array.isArray(ei.itemRefs)) return { ...ei, itemRefs: nextRefs };
      // Legacy single-itemRef obligations: write back as itemRefs (the
      // canonical shape) so future reads go through the array path.
      return { ...ei, itemRefs: nextRefs, itemRef: undefined };
    });
    if (!anyUpgrade) return;
    setForecast(prev => {
      const cur = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      // Re-map against the freshly-healed list by id to avoid clobbering
      // any concurrent edit that landed between render and effect.
      const healedById = new Map(healed.map(ei => [ei.id, ei]));
      let changed = false;
      const next = cur.map(ei => {
        const h = healedById.get(ei.id);
        if (h && h !== ei) { changed = true; return h; }
        return ei;
      });
      return changed ? { ...prev, endingItems: next } : prev;
    });
  }, [endingItems, exp, sav]);

  /* Heal stale loan-mode `endsOn` (roll-forward drift).
     ---------------------------------------------------------------
     A loan obligation stores `endsOn` (the payoff "YYYY-MM"), which the
     math layer AND the FIRE step-down both read. The displayed payoff
     date, however, is computed live from the ROLLED-FORWARD balance —
     `ei.balance` advanced from `ei.balanceAsOf` to today's baseYearMonth
     using the linked monthly payment. As real calendar time passes,
     baseYearMonth moves forward, the rolled balance shrinks, and the
     displayed payoff date moves earlier — but the stored `endsOn` only
     gets rewritten when the user edits balance/rate. So a mortgage could
     DISPLAY "pays off 2050" while the persisted endsOn still says 2055,
     and the FIRE target would step down on the stale (later) date.

     This effect re-derives endsOn from the rolled balance and writes it
     back when it drifts, so the stored value matches what's displayed.
     Scoped to single (non-sub-loan) loan obligations — the case the UI
     shows as "Pays off: <date>". Sub-loan groups have the same drift but
     a more involved recompute (routed payments); that's tracked
     separately and left untouched here rather than half-recomputed.

     Idempotent: short-circuits once every loan's stored endsOn equals its
     rolled-forward value (the common steady state). */
  useEffect(() => {
    if (!Array.isArray(endingItems) || endingItems.length === 0) return;
    /* Obligations currently claimed by a payoff event: their end date is
       owned by the linked event (applyPayoffLinks overrides it), so the
       loan-mode auto-recompute must NOT fight it. Skipping them here keeps
       the stored loan fields (balance/rate/mode) intact so that unlinking
       cleanly restores the natural loan payoff date — no race with the
       override, no stale frame. */
    const payoffLinkedIds = new Set(
      (Array.isArray(oneTimeEvents) ? oneTimeEvents : [])
        .filter(ev => ev && ev.linkedEndingId)
        .map(ev => ev.linkedEndingId)
    );
    const updates = [];
    for (const ei of endingItems) {
      if (!ei || typeof ei !== "object") continue;
      if (ei.mode !== "loan") continue;
      if (payoffLinkedIds.has(ei.id)) continue; // payoff event owns this date
      if (Array.isArray(ei.subLoans) && ei.subLoans.length > 0) continue; // sub-loan path handled elsewhere
      if (!baseYearMonth) continue;

      // Summed monthly across linked refs (mirrors liveMonthly in render).
      const refs = getItemRefs(ei);
      if (refs.length === 0) continue;
      let monthly = 0, anyBad = false;
      for (const ref of refs) {
        const m = monthlyAmountFor(ref);
        if (m == null || !isFinite(m) || m <= 0) { anyBad = true; break; }
        monthly += m;
      }
      if (anyBad || monthly <= 0) continue;

      // Roll the stated balance forward to base, exactly as the display does.
      let rolled = Number(ei.balance) || 0;
      if (ei.balanceAsOf) {
        const roll = rollForwardBalance(ei.balance, ei.annualRate, monthly, ei.balanceAsOf, baseYearMonth);
        if (roll.ok) rolled = roll.rolledBalance;
      }
      if (rolled <= 0) continue; // paid off pre-base; leave endsOn (orphan/out-of-horizon handles it)

      const r = computeLoanEndsOn(rolled, ei.annualRate, monthly, baseYearMonth);
      if (!r.ok) continue;
      if (r.endsOn !== ei.endsOn) {
        updates.push({ id: ei.id, endsOn: r.endsOn });
      }
    }
    if (updates.length === 0) return;
    setForecast(prev => {
      const cur = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      const byId = new Map(updates.map(u => [u.id, u.endsOn]));
      let changed = false;
      const next = cur.map(ei => {
        const newEndsOn = byId.get(ei.id);
        if (newEndsOn != null && newEndsOn !== ei.endsOn) { changed = true; return { ...ei, endsOn: newEndsOn }; }
        return ei;
      });
      return changed ? { ...prev, endingItems: next } : prev;
    });
    // monthlyAmountFor closes over exp/sav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endingItems, oneTimeEvents, exp, sav, baseYearMonth]);
  const addEndingItem = () => {
    /* Default destination: the first taxable/cash account in the list,
       or any non-capped account, or the first account overall. The user
       can change it immediately via the dropdown — this just keeps the
       UI in a coherent initial state without forcing a destAccountId of
       "" which would fail validation on resolve. */
    const firstUncapped = accounts.find(a => !ACCOUNT_TYPE_TO_POOL[a.type]);
    const defaultDest = (firstUncapped?.id) || accounts[0]?.id || "";
    /* Default endsOn: 12 months out. Far enough that the user doesn't
       see an immediate event in month 1; close enough that they can
       see it on the chart. */
    const defaultEndsOn = (() => {
      const [y, m] = baseYearMonth.split("-").map(Number);
      const total = y * 12 + (m - 1) + 12;
      return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    })();
    const newItem = {
      id: newEndingItemId(),
      itemRefs: [], // user picks via dropdown (Phase 14a: multi-item)
      destAccountId: defaultDest,
      effect: "ends",
      mode: "date",
      endsOn: defaultEndsOn,
      balance: 0,
      annualRate: 0,
    };
    setForecast(prev => {
      const cur = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      return { ...prev, endingItems: [...cur, newItem] };
    });
  };

  /* === One-time Events ===
     Dated lump-sum events on a single account. Independent from
     ending items — these are one-shot balance adjustments, not
     recurring redirects of freed cash flow. See utils/oneTimeEvents.js.
     (The `oneTimeEvents` const itself is declared higher up, next to
     endingItems, to keep it out of the TDZ for the loan-recompute effect.) */
  const updateOneTimeEvent = (id, patch) => {
    setForecast(prev => {
      const cur = Array.isArray(prev?.oneTimeEvents) ? prev.oneTimeEvents : [];
      return { ...prev, oneTimeEvents: cur.map(ev => ev.id === id ? { ...ev, ...patch } : ev) };
    });
  };
  const removeOneTimeEvent = (id) => {
    setForecast(prev => {
      const cur = Array.isArray(prev?.oneTimeEvents) ? prev.oneTimeEvents : [];
      return { ...prev, oneTimeEvents: cur.filter(ev => ev.id !== id) };
    });
  };
  const addOneTimeEvent = () => {
    /* Default account: first "cash" type if any, else first account. Cash
       is the most likely target for the canonical use case (large planned
       purchase out of savings). */
    const firstCash = accounts.find(a => a.type === "cash");
    const defaultAccountId = (firstCash?.id) || accounts[0]?.id || "";
    /* Default date: 12 months from today, first of that month. Far enough
       to be obviously a planned-future event, not "happening now." */
    const defaultDate = (() => {
      const d = new Date();
      const total = d.getFullYear() * 12 + d.getMonth() + 12;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      return `${year}-${String(month).padStart(2, "0")}-01`;
    })();
    const newEvent = {
      id: newOneTimeEventId(),
      date: defaultDate,
      amount: 0,
      accountId: defaultAccountId,
      label: "",
    };
    setForecast(prev => {
      const cur = Array.isArray(prev?.oneTimeEvents) ? prev.oneTimeEvents : [];
      return { ...prev, oneTimeEvents: [...cur, newEvent] };
    });
  };

  /* === Loans (Phase 14) ===
     First-class debt modeling. Each loan amortizes over its term:
     monthly payment debits sourceAccount; principal optionally credits
     targetAccount at origination; on payoff, freed payment optionally
     redirects to overflowAccount. Empty by default — UI surfaces a
     section between One-time Events and the chart. See utils/loans.js
     for shape + resolveLoans semantics. */
  /* loans is still read here to drive the year-by-year "Debt Remaining"
     column. Loan CRUD + the Loans table/chart moved to LoansTab.jsx
     (Charts → Loans subtab); forecast.loans remains the source of truth. */
  const loans = Array.isArray(forecast?.loans) ? forecast.loans : [];

  /* Build the linked-item dropdown options. Single dropdown grouped by
     section (Expenses then Savings) so the user picks "Mortgage P&I"
     without first picking a section. Items with $0 amounts are still
     listed — the user might be setting up an obligation for an item
     they're about to start funding. We mark itemRefs that are already
     consumed by another ending item so the dropdown can disable them
     (one-ending-per-item invariant — also enforced on save via
     findItemRefConflicts as a backstop).

     Stable-IDs phase: each option carries the item's `id` (when present)
     so refs created from this list pin to a stable identifier. The
     `key` used for claimed-ref deduplication also prefers id, falling
     back to section::idx for items without an id yet (first-render
     edge before backfill writes back). */
  const linkedItemOptions = useMemo(() => {
    const out = [];
    for (let idx = 0; idx < (Array.isArray(exp) ? exp.length : 0); idx++) {
      const e = exp[idx];
      if (!e) continue;
      const id = typeof e.id === "string" && e.id.length > 0 ? e.id : null;
      out.push({
        section: "exp",
        idx,
        id,
        name: e.n || `Expense ${idx + 1}`,
        key: id ? `exp::id::${id}` : `exp::${idx}`,
      });
    }
    for (let idx = 0; idx < (Array.isArray(sav) ? sav.length : 0); idx++) {
      const s = sav[idx];
      if (!s) continue;
      const id = typeof s.id === "string" && s.id.length > 0 ? s.id : null;
      out.push({
        section: "sav",
        idx,
        id,
        name: s.n || `Savings ${idx + 1}`,
        key: id ? `sav::id::${id}` : `sav::${idx}`,
      });
    }
    return out;
  }, [exp, sav]);

  /* Set of itemRef keys already claimed by an ending item. Each key maps
     to the set of ending-item ids that claim it, so we can keep the
     *current* row's own selections enabled even when they're "taken."
     Multi-ref aware (Phase 14a): walks every ref in every obligation,
     so an obligation linking to [A, B] claims both keys.

     Stable-IDs phase: keys by `ref.id` when present, falls back to
     `section::idx` for legacy refs. This matches the keying scheme in
     `linkedItemOptions` above so dropdown disable logic lines up. */
  const claimedRefKeys = useMemo(() => {
    const m = new Map(); // key -> Set of ending-item ids
    for (const ei of endingItems) {
      const refs = getItemRefs(ei);
      for (const ref of refs) {
        if (!ref || typeof ref.section !== "string") continue;
        let k;
        if (typeof ref.id === "string" && ref.id.length > 0) {
          k = `${ref.section}::id::${ref.id}`;
        } else if (typeof ref.idx === "number") {
          k = `${ref.section}::${ref.idx}`;
        } else {
          continue;
        }
        if (!m.has(k)) m.set(k, new Set());
        m.get(k).add(ei.id);
      }
    }
    return m;
  }, [endingItems]);

  /* Look up the live monthly amount for a budget line by reference.
     Uses toWk to convert the item's value+period to weekly, then ×(48/12)
     to get a per-paycheck-monthly amount. budgetCompare's calendar-vs-
     paycheck wrinkle doesn't apply here — the math layer is running a
     monthly forecast based on budget intent, not reconciling against
     transactions. Returns null when the linked item is missing (e.g.
     renamed/deleted/reordered away).

     Stable-IDs phase: uses `resolveItemRef` which prefers id matching
     (rock-solid across reorders/renames) and falls back to name/idx
     for legacy refs that predate ids. The orphan case still surfaces
     as null from this function. */
  const monthlyAmountFor = (ref) => {
    const { item } = resolveItemRef(ref, exp, sav);
    if (!item) return null;
    const wk = toWk(item.v, item.p);
    if (!isFinite(wk)) return null;
    return wk * 48 / 12; // weekly → monthly
  };

  /* Resolve ending items to applied events for the forecast math.
     baseYearMonth + horizonMonths anchor the month-index math. The
     output `resolvedEnding` includes orphan + out-of-horizon lists so
     the UI can surface warnings beside the relevant rows.

     This memo intentionally depends on the live `exp`/`sav` arrays —
     editing a budget line's monthly amount or period updates the
     forecast in real time without the user re-saving the ending item. */
  /* Resolve one-time events. resolveOneTimeEvents wants baseYearMonth as
     { year, month } (numeric), distinct from endingItems' "YYYY-MM" string
     shape. Recompute on event/horizon change — events depend only on their
     own date + the account list + horizon, not on budget content.
     (Declared before resolvedEnding because the debt aggregation and the
     payoff-link override both consume it.) */
  const resolvedOneTime = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    const [yStr, mStr] = baseYearMonth.split("-");
    const baseYM = { year: Number(yStr), month: Number(mStr) };
    return resolveOneTimeEvents(oneTimeEvents, accounts, baseYM, horizonMonths);
  }, [oneTimeEvents, accounts, baseYearMonth, horizon]);

  /* Real "Debt Remaining" from loan-mode ENDING OBLIGATIONS — the debts
     in the actual plan, NOT the standalone Loans-tab scratchpad
     (forecast.loans), which stays hypothetical. Lump-sum paydowns come
     from one-time events linked to each obligation (linkedEndingId): each
     becomes a paydown of |amount| at the event's resolved month index
     (read off resolvedOneTime by id so the month math never diverges).
     Returns { byYear, payoffById }; payoffById feeds the freed-cash
     timing below so the debt curve and the freed payment agree on when a
     loan retires. */
  const obligationDebtByYear = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    const yMax = Number(horizon) || 0;
    // Single-loan obligations (no sub-loans) via the pure aggregator.
    const singleLoans = endingItems.filter(ei => ei && ei.mode === "loan" && !(Array.isArray(ei.subLoans) && ei.subLoans.length > 0));
    const result = aggregateObligationDebt(singleLoans, {
      baseYearMonth,
      horizonMonths,
      monthlyFor: (ei) => {
        const refs = getItemRefs(ei);
        if (refs.length === 0) return null;
        let monthly = 0;
        for (const ref of refs) {
          const m = monthlyAmountFor(ref);
          if (m == null || !isFinite(m) || m <= 0) return null;
          monthly += m;
        }
        return monthly;
      },
      startBalanceFor: (ei) => {
        let startBalance = Number(ei.balance) || 0;
        const refs = getItemRefs(ei);
        let monthly = 0;
        for (const ref of refs) { const m = monthlyAmountFor(ref); if (m != null && isFinite(m)) monthly += m; }
        if (ei.balanceAsOf && baseYearMonth) {
          const roll = rollForwardBalance(ei.balance, ei.annualRate, monthly, ei.balanceAsOf, baseYearMonth);
          if (roll.ok) startBalance = roll.rolledBalance;
        }
        return startBalance;
      },
      lumpSumsFor: (ei) => {
        const lumps = [];
        const [byStr, bmStr] = baseYearMonth.split("-");
        const bY = Number(byStr), bM = Number(bmStr);
        for (const ev of oneTimeEvents) {
          if (!ev || ev.linkedEndingId !== ei.id) continue;
          /* debtPrincipalByMonth indexes months from the BASE MONTH
             (index 0 = base, k = after k monthly steps), which is a
             different convention from the forecast loop's resolved
             monthIndex (1 = Jan of baseYear+1). Compute the engine index
             straight from the event date so the two never diverge:
                engineIdx = (Y - baseYear)*12 + (M - baseMonth)
             A past/base-month event clamps to 0 (paid down immediately). */
          const m = /^(\d{4})-(\d{1,2})/.exec(ev.date || "");
          if (!m) continue;
          const evY = Number(m[1]), evM = Number(m[2]);
          let mi = (evY - bY) * 12 + (evM - bM);
          if (mi < 0) mi = 0;
          if (mi > horizonMonths) continue;
          const amt = Math.abs(Number(ev.amount) || 0);
          if (amt > 0) lumps.push({ monthIndex: mi, amount: amt });
        }
        return lumps;
      },
    });

    /* Sub-loan obligations: the aggregator skips them (their balance is the
       sum of their sub-loans). Fold each one in here using the same
       sub-loan group resolution the row UI uses. Lump-sum paydowns against
       sub-loan groups aren't modeled yet — these contribute their natural
       combined amortization. The per-month combined balance comes from
       aggregateSubLoanBalances; we sample it at each year boundary. */
    const subLoanObligations = endingItems.filter(ei => ei && ei.mode === "loan" && Array.isArray(ei.subLoans) && ei.subLoans.length > 0);
    const [byStrSL, bmStrSL] = baseYearMonth.split("-");
    const bYSL = Number(byStrSL), bMSL = Number(bmStrSL);
    for (const ei of subLoanObligations) {
      const resolved = resolveSubLoanGroup(ei.subLoans, ei.graduation || { enabled: false }, baseYearMonth);
      if (!resolved || resolved.anyError) continue;

      /* Lump-sum paydowns from one-time events linked to THIS obligation
         (same linkedEndingId match + engine-index math the single-loan
         path uses). aggregateSubLoanBalances applies these to the combined
         balance so a mortgage-payoff event actually drops the debt curve
         instead of only draining cash. Engine index: 0 = base month, k =
         after k monthly steps; perMonth[i] is the balance AFTER month i+1,
         so a lump at engine index mi maps to perMonth index mi-1, and a
         lump at the base month (mi=0) reduces the year-0 left edge too. */
      const lumps = [];
      for (const ev of oneTimeEvents) {
        if (!ev || ev.linkedEndingId !== ei.id) continue;
        const m = /^(\d{4})-(\d{1,2})/.exec(ev.date || "");
        if (!m) continue;
        const evY = Number(m[1]), evM = Number(m[2]);
        let mi = (evY - bYSL) * 12 + (evM - bMSL);
        if (mi < 0) mi = 0;
        if (mi > horizonMonths) continue;
        const amt = Math.abs(Number(ev.amount) || 0);
        if (amt > 0) lumps.push({ monthIndex: mi, amount: amt });
      }
      // perMonth is keyed "after month i" (index i = engine month i+1), so
      // shift each lump's engine index down by one for the aggregator.
      const aggLumps = lumps.map(l => ({ monthIndex: Math.max(0, l.monthIndex - 1), amount: l.amount }));
      const lumpAtBase = lumps.reduce((s, l) => s + (l.monthIndex <= 0 ? l.amount : 0), 0);

      const agg = aggregateSubLoanBalances(resolved, { lumpSums: aggLumps });
      // perMonth[i] = balance after month i. Year y end = month y*12.
      // Year 0 = sum of starting balances (perMonth[0] is after 1 month, so
      // use the sub-loan starting balances directly for the left edge),
      // minus any lump that lands at the base month.
      const y0Total = Math.max(0, ei.subLoans.reduce((s, sl) => s + (Number(sl.balance) || 0), 0) - lumpAtBase);
      for (let y = 0; y <= yMax; y++) {
        let bal;
        if (y === 0) bal = y0Total;
        else {
          const row = agg.perMonth[y * 12 - 1]; // month index y*12 → array idx y*12-1
          bal = row ? row.total : 0;
        }
        result.byYear[y].perLoan[ei.id] = bal;
        result.byYear[y].total += bal;
      }
      /* Payoff date: prefer the lump-adjusted payoff when a lump retires the
         debt early; otherwise fall back to the natural group payoff. agg
         payoffMonth is a perMonth index (after that many months), so the
         absolute month count is payoffMonth+1 from base. */
      if (lumps.length > 0 && agg.payoffMonth !== null && agg.payoffMonth !== undefined) {
        result.payoffById[ei.id] = addMonths(baseYearMonth, agg.payoffMonth + 1);
      } else if (resolved.groupEndsOn) {
        result.payoffById[ei.id] = resolved.groupEndsOn;
      }
    }

    return result;
    // monthlyAmountFor closes over exp/sav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endingItems, oneTimeEvents, resolvedOneTime.events, exp, sav, baseYearMonth, baseYear, horizon]);

  /* Ending obligations resolved to freed-cash events. Early-payoff links
     (one-time event with linkedEndingId) are applied first: for a
     loan-mode obligation the lump sum is handled by the debt engine and
     the obligation's end date is set to the COMPUTED post-paydown payoff
     (obligationDebtByYear.payoffById) so the freed payment and the debt
     curve agree; for a date-mode obligation the event date wins. Live
     because monthlyAmountFor closes over the budget — editing a line's
     monthly updates the forecast without re-saving. */
  const resolvedEnding = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    const linkedItems = applyPayoffLinks(endingItems, oneTimeEvents, obligationDebtByYear.payoffById);
    return resolveEndingEvents(linkedItems, monthlyAmountFor, baseYearMonth, horizonMonths);
    // monthlyAmountFor closes over exp/sav, so list those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endingItems, oneTimeEvents, obligationDebtByYear.payoffById, exp, sav, baseYearMonth, horizon]);


  /* Resolve loans. Mirrors the one-time-events shape — { loans, orphans,
     inPast, outOfHorizon }. Recompute on loan/horizon change; loan
     resolution doesn't depend on accounts (Phase 14b: loans are pure
     amortization records, decoupled from forecast accounts). Same
     baseYearMonth split convention as resolveOneTimeEvents. */
  const resolvedLoans = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    const [yStr, mStr] = baseYearMonth.split("-");
    const baseYM = { year: Number(yStr), month: Number(mStr) };
    return resolveLoans(loans, baseYM, horizonMonths);
  }, [loans, baseYearMonth, horizon]);

  /* Phase 14b: derived debt aggregates. Drives the per-row Monthly /
     Payoff / Interest cells, the summary card under the Loans table,
     the Debt Paydown chart, and the per-year "Debt Remaining" column
     in the year-by-year table.

     aggregateDebt produces one row per absolute month with totalRemaining,
     perLoanRemaining, and the totals of interest/principal/payment that
     month. We sample at end-of-year (monthIndex multiples of 12) for the
     chart + table. */
  const debtAggregate = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    return aggregateDebt(resolvedLoans.loans, horizonMonths);
  }, [resolvedLoans.loans, horizon]);

  /* Year-end debt snapshots: index by row.year (0..horizon).
     year 0 = base date itself (no payments yet). year N = balance after
     month N*12 (end of year N). Used by both the chart and the
     year-by-year "Debt Remaining" column. */
  const debtByYear = useMemo(() => {
    const out = {};
    // Year 0 = sum of remainingAtBase across all resolved loans.
    let y0Total = 0;
    const y0PerLoan = {};
    for (const ln of resolvedLoans.loans) {
      // For a future-origination loan, remainingAtBase === principal,
      // but the loan hasn't STARTED yet at year 0 — we still show the
      // principal as "what you'll owe once it kicks in", which matches
      // what a user would expect at the chart's left edge. Pre-base
      // loans show their actual remaining-at-base.
      y0PerLoan[ln.id] = ln.remainingAtBase;
      y0Total += ln.remainingAtBase;
    }
    out[0] = { total: y0Total, perLoan: y0PerLoan };
    // Years 1..horizon: end-of-year balance from the monthly aggregate.
    const yMax = Number(horizon) || 0;
    for (let y = 1; y <= yMax; y++) {
      const row = debtAggregate[y * 12 - 1]; // monthIndex y*12 → array idx y*12-1
      if (row) {
        out[y] = { total: row.totalRemaining, perLoan: { ...row.perLoanRemaining } };
      } else {
        out[y] = { total: 0, perLoan: {} };
      }
    }
    return out;
  }, [resolvedLoans.loans, debtAggregate, horizon]);

  /* Real "Debt Remaining" from loan-mode ENDING OBLIGATIONS.
     ===============================================================
     This is the source of truth for the year-by-year "Debt Remaining"
     column and the debt total — NOT the standalone Loans-tab scratchpad
     (forecast.loans), which is hypothetical planning only.

     For each loan-mode obligation we:
       1. roll its stated balance forward to baseYearMonth (same as the
          row render does),
       2. collect lump-sum paydowns from any one-time events linked to it
          (linkedEndingId) — each linked event becomes a paydown of
          |amount| at the event's resolved month index, matching the rest
          of the system's month math exactly (we read monthIndex off the
          resolved event by id so there's no divergence),
       3. run debtPrincipalByMonth to get the month-by-month principal,
          honoring the obligation's recastMode ("shorten" default),
       4. snapshot the balance at each year end.

     Aggregated across all loan-mode obligations into the same shape
     debtByYear used ({ [year]: { total, perLoan } }) so the column +
     chart consume it unchanged. */

  /* Detect duplicate itemRef assignments (one-ending-per-item invariant).
     UI prevents creating duplicates via dropdown disabling; this is a
     defensive recompute for the warning banner in case the invariant
     was broken via JSON import or a save migration. */
  const endingItemConflicts = useMemo(() => findItemRefConflicts(endingItems), [endingItems]);

  /* Cap-at-limit master toggle. Tristate: all-on / all-off / mixed.
     Click flips: any-off → all-on, all-on → all-off. */
  const eligibleAccounts = accounts.filter(a => ACCOUNT_TYPE_TO_POOL[a.type]); // limit applies
  const allCapped = eligibleAccounts.length > 0 && eligibleAccounts.every(a => a.capAtLimit);
  const noneCapped = eligibleAccounts.every(a => !a.capAtLimit);
  const capMixed = !allCapped && !noneCapped;
  const flipAllCap = () => {
    const target = !allCapped; // off → on, on → off, mixed → on
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      return { ...prev, accounts: prevAccounts.map(a => ACCOUNT_TYPE_TO_POOL[a.type] ? { ...a, capAtLimit: target } : a) };
    });
  };

  /* Global "apply annual increase % to all accounts" control.
     Most accounts move proportionally with salary increases (401(k)
     contributions, HSA, IRA contributions, even taxable savings
     typically scale up as raises arrive). Defaulting per-account
     `annualIncrease` to 0 understates long-horizon balances; this
     one-click action sets every account's `annualIncrease` to the
     entered value. Local input state — not persisted — because this
     is an action, not a setting. Default 3% to match Simple's
     income-growth default. */
  const [globalIncrease, setGlobalIncrease] = useState("3");
  const applyIncreaseToAll = () => {
    const v = evalF(globalIncrease);
    if (!isFinite(v)) return;
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      return { ...prev, accounts: prevAccounts.map(a => ({ ...a, annualIncrease: v })) };
    });
  };

  /* Master "accurate as of" control — lives in the top scenario toolbar
     next to Inflation, since it governs the whole projection's start-clock
     (accounts + obligations + sub-loans), not just accounts. One month
     input + "Apply" stamps balanceAsOf everywhere; a sync dot shows whether
     items currently share one as-of date. Default seed: current month, so
     the common "everything is current" case is one click. */
  const [globalAsOf, setGlobalAsOf] = useState(() => {
    try {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } catch { return ""; }
  });
  const applyAsOfToAll = () => {
    if (!globalAsOf || !/^\d{4}-\d{2}$/.test(globalAsOf)) return;
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      const prevItems = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      return {
        ...prev,
        accounts: prevAccounts.map(a => ({ ...a, balanceAsOf: globalAsOf })),
        endingItems: prevItems.map(ei => {
          const subLoans = Array.isArray(ei.subLoans) ? ei.subLoans : [];
          return { ...ei, balanceAsOf: globalAsOf, subLoans: subLoans.map(sl => ({ ...sl, balanceAsOf: globalAsOf })) };
        }),
      };
    });
  };
  const clearAsOfAll = () => {
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      const prevItems = Array.isArray(prev?.endingItems) ? prev.endingItems : [];
      return {
        ...prev,
        accounts: prevAccounts.map(a => ({ ...a, balanceAsOf: undefined })),
        endingItems: prevItems.map(ei => {
          const subLoans = Array.isArray(ei.subLoans) ? ei.subLoans : [];
          return { ...ei, balanceAsOf: undefined, subLoans: subLoans.map(sl => ({ ...sl, balanceAsOf: undefined })) };
        }),
      };
    });
  };
  /* Shared as-of state across everything the master control governs
     (accounts + obligations + sub-loans): null = nothing to compare,
     "" = all blank (no roll-forward), undefined = mixed, else common
     "YYYY-MM". Considering obligations too keeps the toolbar sync dot
     honest — it won't read green while obligations are out of sync. */
  const sharedAsOf = (() => {
    const dates = [];
    for (const a of accounts) dates.push(a.balanceAsOf || "");
    for (const ei of endingItems) {
      dates.push(ei.balanceAsOf || "");
      const subLoans = Array.isArray(ei.subLoans) ? ei.subLoans : [];
      for (const sl of subLoans) dates.push(sl.balanceAsOf || "");
    }
    if (dates.length === 0) return null;
    const first = dates[0];
    return dates.every(d => d === first) ? first : undefined;
  })();

  /* Derive whether all accounts currently share a single annualIncrease
     value (and what it is). Used to subtly indicate "in sync" vs "mixed."
     null = no accounts, undefined = mixed. */
  const sharedIncrease = (() => {
    if (accounts.length === 0) return null;
    const first = Number(accounts[0].annualIncrease) || 0;
    return accounts.every(a => (Number(a.annualIncrease) || 0) === first) ? first : undefined;
  })();

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
  /* HSA employee + employer annual contributions, per owner. Reads the
     first-class Income fields (cHsa/kHsa employee, cHsaEmployer/kHsaEmployer
     employer) instead of the old preDed string-match. Employer dollars count
     toward forecast balance growth (and the pool cap) but never the budget. */
  const hsaAnnualByOwner = useMemo(() => {
    const p1 = (evalF(cHsa) || 0) + (evalF(cHsaEmployer) || 0);
    const p2 = (evalF(kHsa) || 0) + (evalF(kHsaEmployer) || 0);
    return { p1, p2 };
  }, [cHsa, kHsa, cHsaEmployer, kHsaEmployer]);
  const hsaTotalAnnual = useMemo(() => {
    return hsaAnnualByOwner.p1 + hsaAnnualByOwner.p2;
  }, [hsaAnnualByOwner]);

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

  /* For the 100%-to-first-account rule: find each owner's first HSA account
     (cash/invested/legacy) in account order. That account receives the owner's
     entire HSA total; sibling HSA accounts for the same owner get 0 so the
     contribution isn't counted multiple times. A per-account split UI is a
     planned follow-up; until then this is the unambiguous default. Joint HSA
     accounts are bucketed under a "joint" key (legacy default behavior). */
  const firstHsaAccountByOwner = useMemo(() => computeFirstHsaByOwner(accounts), [accounts]);

  /* Per-owner HSA split warnings: when an owner has set explicit shares on
     their HSA accounts but those shares don't sum to ~100%, surface it. Only
     owners actually using share mode (count > 0) are checked; legacy
     100%-to-first owners are silent. Small float tolerance so 33.33×3 passes. */
  const hsaShareWarnings = useMemo(() => {
    const sums = hsaShareSumByOwner(accounts);
    const ownerName = o => o === "joint" ? "Joint" : o === "p1" ? p1Name : p2Name;
    const out = [];
    for (const owner of Object.keys(sums)) {
      const { sum, count } = sums[owner];
      if (count === 0) continue;
      if (Math.abs(sum - 100) > 0.5) {
        out.push({ owner, name: ownerName(owner), sum, count });
      }
    }
    return out;
  }, [accounts, p1Name, p2Name]);

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
      if (a.type === "hsa_cash" || a.type === "hsa_invested" || a.type === "hsa") {
        return resolveHsaContribution(a, hsaAnnualByOwner.p1, firstHsaAccountByOwner, accounts);
      }
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
      if (a.type === "hsa_cash" || a.type === "hsa_invested" || a.type === "hsa") {
        return resolveHsaContribution(a, hsaAnnualByOwner.p2, firstHsaAccountByOwner, accounts);
      }
    }
    /* Joint HSA accounts: lump everything into "cash" by default. The user
       can flip individual rows to manual to allocate a portion to invested
       (most institutions hold contributions in cash until a minimum is
       reached, then sweep to invested).
       HSA contributions now read first-class per-person Income fields
       (cHsa/kHsa employee + cHsaEmployer/kHsaEmployer employer) via
       hsaAnnualByOwner. Each owner's full HSA total auto-fills their FIRST
       HSA account (siblings get 0) to avoid double-counting. A per-account
       split UI (let the user send X% to cash, Y% to invested) is the planned
       follow-up; until then, flip a sibling row to manual to allocate by hand.

       TODO: pre-tax accounts (401k pretax, IRA traditional) don't account
       for withdrawal tax in the FIRE calculation. A pre-tax dollar in
       these accounts is worth less than 1× post-tax in retirement. The
       FIRE target should arguably be:
         (post-tax goal) + (pre-tax balance × effective_retirement_tax)
       Punting this — needs a tax-rate input + clearer UX around what's
       pre-tax vs post-tax. Worth a separate session.

       Bonus contributions (cEaip / kEaip): cash/savings accounts can pick
       a "+ bonus" budget variant in the contribSource dropdown, which adds
       C.eaipNet to that account's annual contribution. Retirement accounts
       (401k, IRA, HSA) here are salary-deferral / annual-amount driven and
       don't model per-account bonus deferrals — designing a per-account
       bonus allocation UI (e.g., "send X% of bonus to 401k, rest to
       taxable") is a future backlog item. Today, choosing a "+ bonus"
       budget variant on a cash account only adds bonus dollars to that
       cash account. */
    // Joint HSA accounts: route the full household HSA total to the first
    // joint HSA account (siblings 0), consistent with the per-person rule.
    // Guard against zero so existing manual amounts aren't silently wiped.
    if (a.owner === "joint" && (a.type === "hsa_cash" || a.type === "hsa_invested" || a.type === "hsa")) {
      // Joint HSA: route the full household total to the first joint HSA account.
      return resolveHsaContribution(a, hsaTotalAnnual, firstHsaAccountByOwner, accounts);
    }
    /* Cash account contribution source — four "budget" variants and three
       "actual" windows besides manual:
         • "budget-48"            = (C.net × 48) − (tExpW × 48), the prior
                                    hard-coded formula. Algebra check:
                                    cNet − tExpW = tSavW + remW, so this
                                    reduces to (tSavW + remW) × 48.
         • "budget-48-bonus"      = budget-48 + C.eaipNet
         • "budget-52"            = (C.net × 52) − (tExpW × 48). The 4
                                    "extra" calendar weeks of paychecks at
                                    52wk don't have offsetting budgeted
                                    expenses, so they flow to cash.
         • "budget-52-bonus"      = budget-52 + C.eaipNet
         • "actual3/6/12"         = net savings over the last N months
                                    from transactions, annualized. The
                                    transactions log already reflects what
                                    happened (bonus paychecks included or
                                    not), so there's no bonus variant here.

       Legacy: pre-rename saves stored "budget" (no weeks/bonus suffix).
       That value behaves identically to "budget-48" — read-only shim, no
       write-back, same pattern used for snapshots → milestones.

       Note: each cash account with a budget source gets the SAME number,
       which is wrong if the user has multiple cash accounts. Documented
       in the dropdown title; allocation-aware variant is a backlog item. */
    if (a.type === "cash" && a.contribSource && a.contribSource !== "manual") {
      const src = a.contribSource;
      // Budget variants — parse the source string to drive the helper.
      // Legacy "budget" reads as "budget-48" (no bonus, paycheck cadence).
      if (src === "budget" || src.startsWith("budget-")) {
        const weeks = src === "budget" ? 48
                    : src.startsWith("budget-52") ? 52
                    : 48;
        const includeBonus = src.endsWith("-bonus");
        return cashBudgetContribution({
          cNet: C?.net,
          tExpW,
          forecastWeeks: weeks,
          eaipNet: C?.eaipNet,
          includeBonus,
        });
      }
      // Actuals — annualized net savings from transactions over N months.
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
     pure calc function.

     Roll-forward: if an account has a `balanceAsOf` in the past, its
     startBalance is aged forward to today (baseYearMonth) at its own return
     rate, so year 0 represents TODAY — consistent with how loans roll
     forward along their schedule. Growth only (no contributions over the
     gap — the entered balance already includes past contributions). This
     keeps the chart's accounts and loans on the same clock. */
  const projAccounts = useMemo(
    () => accounts.map(a => {
      const seed = (() => {
        if (!a.balanceAsOf) return Number(a.startBalance) || 0;
        const gap = monthsSinceAsOf(a.balanceAsOf, baseYearMonth);
        if (gap == null || gap <= 0) return Number(a.startBalance) || 0;
        return rollAccountForward(a.startBalance, a.annualReturn, gap);
      })();
      return { ...a, startBalance: seed, contribAmount: effectiveContribFor(a) };
    }),
    // All inputs read by autoContribFor / effectiveContribFor must be listed
    // here, otherwise the projection silently goes stale when the user edits
    // an upstream value (IRA $ on Income tab, transactions for cash-actuals,
    // tSavW/remW for cash-budget source). C.net and C.eaipNet drive the
    // cash-budget variants; tExpW is the expense baseline. baseYearMonth
    // drives the as-of roll-forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, cSalNum, kSalNum, c4preNum, c4roNum, k4preNum, k4roNum, cLump, kLump, cMatchAnnual, kMatchAnnual, hsaTotalAnnual, hsaAnnualByOwner, firstHsaAccountByOwner, cIraTradNum, cIraRothNum, kIraTradNum, kIraRothNum, cashActualByAccount, tSavW, remW, tExpW, C?.net, C?.eaipNet, baseYearMonth]
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
      appliedEndingEvents: resolvedEnding.events,
      appliedOneTimeEvents: resolvedOneTime.events,
    });
  }, [projAccounts, horizon, baseYear, inflationPct, tax?.p1BirthYear, tax?.p2BirthYear, hsaCoverage, limitGrowthPct, resolvedEnding.events, resolvedOneTime.events]);

  /* Phase 15 — derive tax-aware FIRE target from the live projection.
     We extract the account mix at the FINAL projection year (horizon) as
     the "at-FI" balance composition. This is conservative: if the user
     reaches FI earlier, the mix is roughly similar (proportions don't
     swing wildly year-to-year). Using horizon means the target reflects
     the user's currently-projected end-state portfolio. */
  const fireAccountMix = useMemo(() => {
    if (useSimpleMultiplier) return { ordinary: 0, ltcg: 0, taxfree: 0 };
    return extractMixFromProjection(accounts, projection.accountSeries, horizon);
  }, [useSimpleMultiplier, accounts, projection, horizon]);

  const fireResult = useMemo(() => {
    return computeFireTarget(fireSpending, fireAccountMix, taxConfig, swr, useSimpleMultiplier);
  }, [fireSpending, fireAccountMix, taxConfig, swr, useSimpleMultiplier]);

  const fireTarget = fireResult.target;
  const fireMultiplierNum = fireResult.multiplierEquivalent || 25;

  /* Per-year FIRE spending reduction from ending obligations.
     ---------------------------------------------------------------
     When an obligation marked reducesFire ends, the user no longer needs
     to fund that expense in retirement, so the FIRE target should step
     DOWN from that year forward. reductionByYear[y] is the annual
     (today's-$) reduction in effect once every qualifying obligation that
     has ended by year y is counted.

     Unit coherence: monthlyAmountFor returns wk*48/12 (budget 48-paycheck
     basis → monthly). fireSpendingReductionByYear annualizes ×12, giving
     wk*48 — the SAME annual basis as fireAnnualExpenses (tExpW*48). So a
     reduction subtracts cleanly from the spend that drives the target.

     A manual retirementSpendingOverride disables the auto step-down: if
     the user has typed an explicit retirement spend, that's their final
     word and obligations shouldn't second-guess it. */
  const fireReduction = useMemo(() => {
    const yrs = Math.max(0, Math.floor(Number(horizon) || 0));
    /* Apply payoff links first so a loan-mode obligation paid down by a
       one-time event uses its COMPUTED post-paydown payoff date — the
       FIRE target then steps down when the loan actually retires, not on
       the original schedule. Same mechanism as resolvedEnding. */
    const linkedItems = applyPayoffLinks(endingItems, oneTimeEvents, obligationDebtByYear.payoffById);
    return fireSpendingReductionByYear(linkedItems, monthlyAmountFor, baseYearMonth, yrs);
    // monthlyAmountFor closes over exp/sav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endingItems, oneTimeEvents, obligationDebtByYear.payoffById, exp, sav, baseYearMonth, horizon]);

  /* Today's-$ FIRE target for a given integer projection year, after
     subtracting obligations ended by that year. Reuses computeFireTarget
     so the tax gross-up applies to the reduced spend too — a smaller
     ordinary-income withdrawal can land in lower brackets, so the target
     drop is slightly more than the raw spend drop / swr. When the override
     is set, or when reductions don't apply, this collapses to fireTarget. */
  const fireBaseTargetForYear = useMemo(() => {
    const reductions = fireReduction.reductionByYear;
    const overridden = retirementSpendingOverride != null;
    return (y) => {
      if (!fireEnabled) return 0;
      const yi = Math.max(0, Math.min(reductions.length - 1, Math.round(y)));
      const cut = overridden ? 0 : (reductions[yi] || 0);
      if (cut <= 0) return fireTarget;
      const reducedSpend = Math.max(0, fireSpending - cut);
      return computeFireTarget(reducedSpend, fireAccountMix, taxConfig, swr, useSimpleMultiplier).target;
    };
  }, [fireReduction, retirementSpendingOverride, fireEnabled, fireTarget, fireSpending, fireAccountMix, taxConfig, swr, useSimpleMultiplier]);

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
        fireThresh: showFire ? fireBaseTargetForYear(row.year) * Math.pow(1 + inflRate, row.year) : null,
      };
      for (const a of accounts) {
        point[a.id] = row.byAccount[a.id]?.nominal || 0;
      }
      return point;
    });
  }, [projection, accounts, fireEnabled, fireTarget, fireBaseTargetForYear, inflationPct]);

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

  /* Per-pool ending-balance summary for the cards row.
     `contributions` here is `contribCumReal` (each year's contribution
     discounted to today's $ and summed), NOT nominal contribCum. This is
     the unit-coherent counterpart to `real` (today's-$ balance), so the
     "Contributed" row in the card uses the same purchasing-power frame as
     "Today's $". Earlier versions used nominal contribCum, which produced
     "Contributed > Today's $" displays on low-return / high-inflation
     accounts that were mathematically right but misleading. */
  const poolSummary = useMemo(() => {
    const last = projection.years[projection.years.length - 1];
    if (!last) return [];
    const pools = {};
    for (const a of accounts) {
      const pool = poolForType(a.type);
      pools[pool] = pools[pool] || { nominal: 0, real: 0, contributions: 0, count: 0 };
      pools[pool].nominal += last.byAccount[a.id]?.nominal || 0;
      pools[pool].real += last.byAccount[a.id]?.real || 0;
      pools[pool].contributions += last.byAccount[a.id]?.contribCumReal || 0;
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
    const targetAt = (y) => fireBaseTargetForYear(y) * Math.pow(1 + inflRate, y);
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
  }, [projection, fireEnabled, fireTarget, fireBaseTargetForYear, inflationPct]);

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
    // Per-person HSA (self / both-self coverage): each person has their own
    // self-only limit, so the displayed pool limit is the single self amount —
    // consistent with the per-person pool capping in forecastGrowthAccounts.
    // Family coverage uses the shared household limit.
    const hsaPerPerson = hsaCoverage === "self" || hsaCoverage === "both-self";
    const hsaCoverageForLimit = pool === "hsa" && hsaPerPerson ? "self" : hsaCoverage;
    const limit = getPoolLimit(pool, baseYear, ageNow, hsaCoverageForLimit);
    const eff = effectiveContribFor(a);
    const incr = Number(a.annualIncrease) || 0;
    const yearsToHit = yearsToHitPoolLimit(eff, incr, limit);
    return { pool, limit, ageNow, yearsToHit, eff };
  };

  const horizonOpts = [1, 5, 10, 20, 30, 40, 50];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Shared horizon at top of advanced — same state as simple.
          Sticks to the top of the viewport while scrolling so it's always
          reachable while you're looking at the chart or any account row.
          The z-index keeps it above the chart's tooltip/legend layer. */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, marginBottom: 16 }}>
        <Card style={{ borderTop: "3px solid #556FB5" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Horizon:</span>
            {horizonOpts.map(h => (
              <button key={h} onClick={() => setHorizon(h)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: horizon === h ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: horizon === h ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{h}y</button>
            ))}
            <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 8px" }} />
          {/* Inflation rate — round-trips with Simple via the same
              localStorage key. Drives the FI threshold line on the chart and
              the deflation of the projection's "today's $" totals. */}
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }} title="Annual inflation %. Used to compute the FI target line (which rises year by year) and to deflate future balances back to today's purchasing power.">Inflation:</span>
          <input
            type="text"
            value={inflationPct}
            onChange={e => setInflationPct(e.target.value)}
            onBlur={e => {
              const v = evalF(e.target.value);
              if (!isFinite(v) || v < 0) setInflationPct("3");
              else setInflationPct(String(v));
            }}
            style={{ width: 50, padding: "3px 6px", fontSize: 12, fontWeight: 700, textAlign: "center", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }} />
          <span style={{ fontSize: 11, color: "var(--tx3,#888)" }}>%</span>
          <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 8px" }} />
          {/* Master "Accurate as of" — global scenario control. Stamps the
              as-of date on every account, obligation, and sub-loan at once;
              accounts/loans then age forward to today (accounts at their
              return, loans along their schedule). Lives here next to the
              other global scenario knobs rather than inside the Accounts
              card, since it governs the whole projection's start-clock.
              Sync dot: green all-share-one-date, orange mixed, gray none. */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title={sharedAsOf === null
              ? "No accounts to compare"
              : sharedAsOf === undefined
                ? `Items have different as-of dates. Set one here + Apply to sync them.`
                : sharedAsOf === ""
                  ? "All balances treated as current (no roll-forward). Set a date + Apply to age them forward to today."
                  : `All balances accurate as of ${sharedAsOf}, aged forward to today.`}>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
              background: sharedAsOf === null ? "#888" : sharedAsOf === undefined ? "#F39C12" : sharedAsOf === "" ? "#888" : "#2ECC71",
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>As of:</span>
          </span>
          <input
            type="month"
            value={globalAsOf}
            onChange={e => setGlobalAsOf(e.target.value)}
            style={{ padding: "3px 6px", fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
          />
          <button
            onClick={applyAsOfToAll}
            disabled={accounts.length === 0 && endingItems.length === 0}
            title="Set the as-of date on every account, obligation, and sub-loan to this month. Balances then age forward to today (accounts at their return rate, loans along their schedule) so everything shares one start-clock. Balance numbers aren't edited."
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5,
              background: (accounts.length === 0 && endingItems.length === 0) ? "var(--input-bg,#f5f5f5)" : "#556FB5",
              color: (accounts.length === 0 && endingItems.length === 0) ? "var(--tx3,#aaa)" : "#fff",
              cursor: (accounts.length === 0 && endingItems.length === 0) ? "not-allowed" : "pointer",
            }}
          >Apply</button>
          {sharedAsOf !== null && sharedAsOf !== undefined && sharedAsOf !== "" && (
            <button
              onClick={clearAsOfAll}
              title="Clear the as-of date everywhere — treats all balances as current (no roll-forward)."
              style={{ padding: "4px 8px", fontSize: 10.5, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "transparent", color: "var(--tx2,#555)", cursor: "pointer" }}
            >Clear</button>
          )}
          <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 8px" }} />
          {/* FIRE controls grouped into a single visually-bound chunk:
              toggle + withdrawal rate + target. Border + tinted background ties
              them together so they don't read as three independent items
              strung across the toolbar. Today's-$ check shows underneath
              when reachable so the user can sanity-check the future-$
              number. Full configuration (spending override, tax breakdown,
              etc.) lives on the Simple Forecast tab card. */}
          <span style={{ display: "inline-flex", flexDirection: "column", padding: fireEnabled ? "6px 10px" : "4px 8px", borderRadius: 8, background: fireEnabled ? "rgba(243,156,18,0.08)" : "transparent", border: fireEnabled ? "1px solid rgba(243,156,18,0.25)" : "1px solid transparent", gap: 3, maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>FIRE:</span>
              <button onClick={() => setFireEnabled(!fireEnabled)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: fireEnabled ? "#F39C12" : "var(--input-bg,#f5f5f5)", color: fireEnabled ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Toggles FIRE mode in both Simple and Advanced views.">{fireEnabled ? "ON" : "OFF"}</button>
              {fireEnabled && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  title={fireInputMode === "multiplier"
                    ? "Spending multiplier — portfolio size as a multiple of annual spending.\n\n• 33× ≈ 3% withdrawal, very conservative, 50+ yr retirement\n• 28× ≈ 3.5%, conservative, FIRE-typical\n• 25× = 4%, Trinity standard, 30 yr horizon\n• 20× = 5%, aggressive\n\nClick the % / × pill to switch to withdrawal rate.\n\nFull config (spending override, tax breakdown) on the Simple Forecast tab."
                    : "Withdrawal rate — how much of the portfolio you withdraw each year in retirement.\n\n• 3% = very conservative, 50+ yr retirement\n• 3.5% = conservative, FIRE-typical\n• 4% = Trinity standard, 30 yr horizon\n• 5% = aggressive\n\nClick the % / × pill to switch to spending multiplier.\n\nFull config (spending override, tax breakdown) on the Simple Forecast tab."}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>{fireInputMode === "multiplier" ? "Mult" : "SWR"}</span>
                  <FireRateInput swr={swr} setSwr={setSwr} mode={fireInputMode} />
                  {/* Mode pill — clickable %/× toggle. Active side is
                      highlighted; click the inactive side to switch. */}
                  <button
                    onClick={() => setFireInputMode(fireInputMode === "multiplier" ? "rate" : "multiplier")}
                    title={fireInputMode === "multiplier" ? "Switch to withdrawal rate (e.g. 4%)" : "Switch to spending multiplier (e.g. 25×)"}
                    style={{ padding: "2px 6px", fontSize: 11, fontWeight: 700, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--tx2,#555)", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.2 }}>
                    {fireInputMode === "multiplier" ? "×" : "%"}
                  </button>
                  {/* Equivalent in the other unit — small grey hint. */}
                  <span style={{ fontSize: 10, color: "var(--tx3,#888)", fontStyle: "italic" }}
                    title={fireInputMode === "multiplier" ? "Equivalent safe withdrawal rate" : "Equivalent spending multiplier"}>
                    ≈ {fireInputMode === "multiplier" ? `${(swr * 100).toFixed(2)}%` : `${(1 / swr).toFixed(1)}×`}
                  </span>
                </span>
              )}
              {fireEnabled && fireTarget > 0 && (() => {
                const inflRate = (Number(inflationPct) || 0) / 100;
                const refYear = (yearsToFireAdv != null && yearsToFireAdv > 0) ? yearsToFireAdv : horizon;
                const futureTarget = fireBaseTargetForYear(refYear) * Math.pow(1 + inflRate, refYear);
                const yearLabel = (yearsToFireAdv != null && yearsToFireAdv > 0)
                  ? `at FI (year ${refYear.toFixed(1)})`
                  : `at year ${horizon}`;
                return (
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}
                    title={`${fireMultiplierNum.toFixed(1)}× effective multiplier${useSimpleMultiplier ? "" : " (after tax gross-up)"} on ${fmt(fireSpending)}/yr spending.\nInflated from today to year ${refYear.toFixed(1)} for the chart.\nFull breakdown on Simple Forecast tab.`}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Target {yearLabel}:</span>
                    <strong style={{ fontSize: 17, fontWeight: 800, color: "#F39C12", fontFamily: "'Fraunces',serif" }}>{fmt(futureTarget)}</strong>
                  </span>
                );
              })()}
            </span>
            {/* Today's-$ check — shows the FI target in today's purchasing
                power as a stable cross-reference. Number changes very slowly
                (only when expenses or SWR change), unlike the future-$
                display which jumps with inflation/year. Helpful sanity check. */}
            {fireEnabled && fireTarget > 0 && (
              <span style={{ fontSize: 11, color: "var(--tx3,#888)", paddingLeft: 38 }}
                title={`FI target in today's purchasing power. ${useSimpleMultiplier ? "Classic rule — tax estimate disabled." : `Tax-adjusted: ${((fireResult.tax?.effectiveRate || 0) * 100).toFixed(1)}% effective on withdrawals.`}\nDoes not depend on inflation rate.`}>
                Today's $: <strong style={{ color: "var(--tx2,#555)" }}>{fmt(fireTarget)}</strong>
                {!useSimpleMultiplier && fireResult.tax && fireResult.tax.totalTax > 0 && (
                  <span style={{ marginLeft: 6, fontStyle: "italic" }}>· {fireMultiplierNum.toFixed(1)}× spending (tax-adj.)</span>
                )}
              </span>
            )}
            {/* Annual withdrawal — the actual $ being withdrawn each year
                at FI. In classic mode this equals spending (no tax gross-up,
                so "withdrawal" = "spending need" by definition). In tax-aware
                mode this is `grossNeed` = spending + estimated retirement
                tax, i.e. what you actually pull from the portfolio before
                tax is paid. Useful sanity check: at 4% SWR, this should
                equal 4% of the today's-$ target. */}
            {fireEnabled && fireTarget > 0 && (
              <span style={{ fontSize: 11, color: "var(--tx3,#888)", paddingLeft: 38 }}
                title={useSimpleMultiplier
                  ? `Annual withdrawal = spending = ${fmt(fireSpending)}. Classic rule applies no tax gross-up.`
                  : `Annual gross withdrawal in retirement: ${fmt(fireSpending)} net spending + ${fmt(fireResult.tax?.totalTax || 0)} estimated tax = ${fmt(fireResult.grossNeed)} pulled from the portfolio each year.`}>
                Annual withdrawal: <strong style={{ color: "var(--tx2,#555)" }}>{fmt(fireResult.grossNeed || fireSpending)}</strong>
                <span style={{ marginLeft: 6, fontStyle: "italic" }}>
                  · {(swr * 100).toFixed(2)}% of {fmt(fireTarget)}
                </span>
              </span>
            )}
          </span>
          </div>
        </Card>
      </div>

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

        {/* Projection assumptions: limit growth + global annual increase.
            Small inline mini-section. Both fields tied to projection-wide
            behavior, distinct from per-account fine-tuning below. */}
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--input-bg,#fafafa)", borderRadius: 6, fontSize: 11, color: "var(--tx2,#555)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>IRS limit growth:</span>
          <div style={{ width: 90 }}>
            <NI value={String(limitGrowthPct)} onChange={v => setForecast(prev => ({ ...prev, limitGrowthPct: evalF(v) }))} onBlurResolve />
          </div>
          <span style={{ fontSize: 10, color: "var(--tx3,#888)" }}>
            % per year applied to today's IRS limits for future projection years (rounded to nearest $500). Default 2.5%. Set to 0 to freeze limits at today's values.
          </span>
        </div>

        {/* Global annual-increase apply control. Most accounts grow with
            salary increases — this is the one-click way to set the same
            % across all of them without editing each account row. Also
            shows current state: in-sync (green dot) vs mixed (orange). */}
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--input-bg,#fafafa)", borderRadius: 6, fontSize: 11, color: "var(--tx2,#555)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            <span
              style={{
                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: sharedIncrease === null ? "#888" : sharedIncrease === undefined ? "#F39C12" : "#2ECC71",
              }}
              title={sharedIncrease === null
                ? "No accounts to compare"
                : sharedIncrease === undefined
                  ? `Accounts have different annual increase values. Click "Apply to all" to sync.`
                  : `All accounts at ${sharedIncrease}%/yr`}
            />
            Annual increase:
          </span>
          <div style={{ width: 90 }}>
            <NI value={globalIncrease} onChange={setGlobalIncrease} onBlurResolve />
          </div>
          <button
            onClick={applyIncreaseToAll}
            disabled={accounts.length === 0}
            title="Set every account's Annual Increase % to this value. Most accounts grow proportionally with salary increases — this is the one-click way to apply that without editing each account row."
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5,
              background: accounts.length === 0 ? "var(--input-bg,#f5f5f5)" : "#556FB5",
              color: accounts.length === 0 ? "var(--tx3,#aaa)" : "#fff",
              cursor: accounts.length === 0 ? "not-allowed" : "pointer",
            }}
          >Apply to all</button>
          <span style={{ fontSize: 10, color: "var(--tx3,#888)" }}>
            % per year that contributions grow — proxies salary raises. Per-account values can still be tuned individually below.
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
                      <select value={a.owner} onChange={e => {
                        const newOwner = e.target.value;
                        // HSA coverage tracks the underlying HDHP coverage,
                        // not the account ownership directly — but in
                        // practice changing an HSA from joint to a single
                        // person almost always implies a self-only HDHP.
                        // Flip this account's per-account hsaCoverage to "self"
                        // so the per-person IRS limit recalculates to the lower
                        // self-only ceiling. The user can override via the
                        // Coverage dropdown below. Both writes happen in one
                        // functional setForecast for stale-closure safety.
                        setForecast(prev => {
                          const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
                          const flipToSelf = isHSA && a.owner === "joint" && newOwner !== "joint" && a.hsaCoverage !== "self";
                          const nextAccounts = prevAccounts.map(x => x.id === a.id
                            ? { ...x, owner: newOwner, ...(flipToSelf ? { hsaCoverage: "self" } : {}) }
                            : x);
                          return { ...prev, accounts: nextAccounts };
                        });
                      }} style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
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
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Balance As-of
                        <span title={"When this balance was last accurate (e.g. your statement date).\n\nThe projection ages this balance forward to TODAY at the account's return rate before projecting — so accounts stay on the same clock as loans (which also roll forward). Growth only; contributions aren't re-added over the gap since your entered balance already includes them.\n\nIt's a model estimate for the gap months — tune the return rate so it tracks reality, and refresh the balance when you re-check.\n\nLeave blank to treat the balance as accurate as of today (no roll-forward)."} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, borderRadius: "50%", background: "var(--tx3,#888)", color: "#fff", fontSize: 8, fontWeight: 700, cursor: "help" }}>?</span>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="month"
                          value={a.balanceAsOf || ""}
                          onChange={e => updateAccount(a.id, { balanceAsOf: e.target.value || undefined })}
                          style={{ flex: 1, minWidth: 0, padding: "5px 6px", fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                        />
                        {a.balanceAsOf && (
                          <button
                            type="button"
                            onClick={() => updateAccount(a.id, { balanceAsOf: undefined })}
                            title="Clear as-of date"
                            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc", padding: "0 2px", lineHeight: 1 }}
                          >×</button>
                        )}
                      </div>
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
                            // Legacy "budget" entries (pre-rename) map to
                            // "budget-48" for display so React doesn't warn
                            // about an unmatched <option>. The math layer
                            // also accepts the legacy value (read shim) —
                            // no migration write needed.
                            value={a.contribSource === "budget" ? "budget-48" : (a.contribSource || "manual")}
                            onChange={e => {
                              const v = e.target.value;
                              const patch = { contribSource: v };
                              if (v !== "manual") patch.contribOverride = false;
                              updateAccount(a.id, patch);
                            }}
                            title="Pick the contribution source for this cash account. Budget variants annualize budgeted income (48 paychecks or 52 calendar weeks) minus budgeted expenses, optionally adding net bonus. Last N months uses your transaction history (income − expenses, transfer rows excluded) annualized."
                            style={{ width: "100%", padding: "4px 6px", fontSize: 11, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)", marginBottom: 4 }}
                          >
                            <option value="manual">Manual entry</option>
                            <option value="budget-48">Budget — 48 weeks of income</option>
                            <option value="budget-48-bonus">Budget — 48 weeks of income + bonus</option>
                            <option value="budget-52">Budget — 52 weeks of income</option>
                            <option value="budget-52-bonus">Budget — 52 weeks of income + bonus</option>
                            <option value="actual3">Last 3 months actual</option>
                            <option value="actual6">Last 6 months actual</option>
                            <option value="actual12">Last 12 months actual</option>
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
                    {/* HSA coverage selector — per-account, but synced across
                        all HSA accounts of the same owner (Corey's cash +
                        invested are the same HSA dollar, so they share one
                        coverage). HSA limits are per-person regardless of
                        coverage; this just picks the self-only vs family
                        dollar ceiling for THIS person. */}
                    {isHSA && (
                      <div style={{ gridColumn: mob ? "1/-1" : "auto" }}>
                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}
                          title="HSA contribution limit is per person. Self-only (~$4,400 in 2026) if this person is on a self-only HDHP; Family (~$8,300) if on a family HDHP.">
                          HSA Coverage
                        </label>
                        <select
                          value={a.hsaCoverage === "self" ? "self" : "family"}
                          onChange={e => {
                            const cov = e.target.value;
                            // Sync across all HSA accounts of the same owner so
                            // the two halves of one HSA can't disagree.
                            setForecast(prev => {
                              const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
                              const isHSAType = t => t === "hsa_cash" || t === "hsa_invested" || t === "hsa";
                              return { ...prev, accounts: prevAccounts.map(acc =>
                                (isHSAType(acc.type) && acc.owner === a.owner) ? { ...acc, hsaCoverage: cov } : acc
                              ) };
                            });
                          }}
                          style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                        >
                          <option value="self">Self-only</option>
                          <option value="family">Family</option>
                        </select>
                      </div>
                    )}
                    {/* HSA split share — percent of this owner's total HSA
                        (employee + employer) that lands in THIS account. Only
                        meaningful when the account is auto-filled from the
                        Income HSA fields. Leaving every HSA account's share
                        blank keeps the default "100% to the first account"
                        behavior; setting a share on any of an owner's HSA
                        accounts switches that owner to explicit-split mode,
                        where blank siblings get 0. The per-owner warning below
                        the accounts table fires if the shares don't sum to
                        100%. */}
                    {isHSA && (
                      <div>
                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}
                          title="Percent of this owner's total annual HSA (employee + employer) to put in this account. Leave blank on all of an owner's HSA accounts to send 100% to the first one. The shares for one owner should add up to 100%.">
                          Split Share % <span style={{ textTransform: "none", fontWeight: 500, color: "var(--tx3,#aaa)" }}>(blank = auto)</span>
                        </label>
                        <NI
                          value={a.hsaShare === undefined || a.hsaShare === null ? "" : String(a.hsaShare)}
                          onChange={(v, raw) => {
                            // Blank clears the share (back to default mode for
                            // this account); a number stores the percent.
                            const src = (raw ?? v ?? "").toString().trim();
                            if (src === "") {
                              updateAccount(a.id, { hsaShare: undefined });
                            } else {
                              // A share only takes effect in auto mode (it
                              // directs how the Income-derived HSA total is
                              // split). If the account was on a manual amount,
                              // flip it to auto so the share is actually used —
                              // otherwise setting a share appears to do nothing.
                              updateAccount(a.id, { hsaShare: evalF(v), contribOverride: false });
                            }
                          }}
                          onBlurResolve
                          prefix="%"
                        />
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

        {/* Single "+ Add account" button → modal picker. Was a popover that
            got clipped by the Card's `overflow: hidden`. The modal version
            renders into a fixed overlay so it's always fully visible, and
            also has more room to show grouped options + descriptions. */}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setAddMenuOpen(true)}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "1px dashed var(--bdr,#ccc)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "var(--tx2,#555)" }}
            title="Pick an account type to add to the projection."
          >
            + Add account
          </button>
        </div>
        {addMenuOpen && (() => {
          // Same groups as before. "hsa" (legacy) is hidden — only the
          // explicit cash/invested split is exposed for new accounts.
          const groups = [
            { label: "401(k)",   types: ["401k_pretax", "401k_roth", "401k_match"] },
            { label: "IRA",      types: ["ira_traditional", "ira_roth"] },
            { label: "HSA",      types: ["hsa_cash", "hsa_invested"] },
            { label: "Other",    types: ["taxable", "cash", "custom"] },
          ];
          return (
            <div onClick={(e) => { if (e.target === e.currentTarget) setAddMenuOpen(false); }}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div style={{ background: "var(--card-bg, #fff)", color: "var(--card-color, #222)", borderRadius: 12, padding: 20, maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Add account</h3>
                  <button onClick={() => setAddMenuOpen(false)} style={{ border: "none", background: "transparent", fontSize: 22, color: "var(--tx3,#888)", cursor: "pointer", padding: "0 4px", lineHeight: 1 }} title="Close">×</button>
                </div>
                {groups.map((g, gi) => (
                  <div key={g.label} style={{ marginBottom: gi < groups.length - 1 ? 12 : 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 0.5, padding: "0 0 4px" }}>{g.label}</div>
                    {g.types.map(t => (
                      <button
                        key={t}
                        onClick={() => { addAccount(t); setAddMenuOpen(false); }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13, border: "1px solid transparent", borderRadius: 6, background: "transparent", color: "var(--tx,#222)", cursor: "pointer", marginBottom: 2 }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--input-bg,#f5f5f5)"; e.currentTarget.style.borderColor = "var(--bdr,#ddd)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
                      >
                        {ACCOUNT_TYPE_LABELS[t] || t}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {hsaShareWarnings.length > 0 && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(232,87,58,0.08)", border: "1px solid rgba(232,87,58,0.35)", borderRadius: 8, fontSize: 12, color: "var(--tx2,#555)" }}>
            <strong style={{ color: "#E8573A" }}>⚠ HSA split doesn't add up to 100%</strong>
            <div style={{ marginTop: 4 }}>
              {hsaShareWarnings.map(w => (
                <div key={w.owner}>{w.name}'s HSA shares total {Math.round(w.sum * 10) / 10}% across {w.count} account{w.count === 1 ? "" : "s"}. {w.sum < 100 ? `${Math.round((100 - w.sum) * 10) / 10}% of the HSA total won't be allocated to any account.` : `That's ${Math.round((w.sum - 100) * 10) / 10}% more than the HSA total — accounts will be over-funded.`}</div>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: "var(--tx3,#888)", fontStyle: "italic" }}>
              Set each HSA account's Split Share % so an owner's shares sum to 100%, or clear them all to send 100% to the first account.
            </div>
          </div>
        )}
      </Card>

      {/* ── Ending Obligations (Phase X-A) ──
          Models budget lines that will stop at a future date (paid-off
          loans, fixed-term subscriptions, premium phase-outs). When an
          obligation ends, the freed monthly cash flow redirects into a
          destination forecast account from that point forward. Designed
          to be light-touch — most users will have 0 of these, a handful
          will have 1–3. We collapse the card by default if empty to
          avoid visual noise on the tab. */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>
              Ending Obligations
              {endingItems.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)" }}>
                  ({endingItems.length})
                </span>
              )}
            </h3>
            <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4, maxWidth: 540 }}>
              Budget lines that will end at a future date (paid-off loans, finite subscriptions).
              When they end, the freed monthly cash redirects to the destination account.
            </div>
          </div>
          <button
            onClick={addEndingItem}
            disabled={accounts.length === 0 || linkedItemOptions.length === 0}
            title={accounts.length === 0
              ? "Add at least one forecast account first"
              : linkedItemOptions.length === 0
                ? "No budget items found — add expense or savings rows on the Budget tab"
                : "Add a new ending obligation"}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              border: "none",
              borderRadius: 6,
              background: (accounts.length === 0 || linkedItemOptions.length === 0) ? "var(--input-bg,#f5f5f5)" : "#556FB5",
              color: (accounts.length === 0 || linkedItemOptions.length === 0) ? "var(--tx3,#aaa)" : "#fff",
              cursor: (accounts.length === 0 || linkedItemOptions.length === 0) ? "not-allowed" : "pointer",
            }}
          >+ Add</button>
        </div>

        {endingItemConflicts.length > 0 && (
          <div style={{ padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#92400E", background: "rgba(243,156,18,0.12)", border: "1px solid rgba(243,156,18,0.35)", borderRadius: 6 }}>
            ⚠ {endingItemConflicts.length} budget item{endingItemConflicts.length === 1 ? " is" : "s are"} referenced by multiple ending obligations.
            Only one obligation per budget line is supported — please remove duplicates below.
          </div>
        )}

        {/* As-of dates are stamped from the master "Accurate as of" control
           at the top of the Accounts card (covers accounts + obligations +
           sub-loans). Per-obligation dates remain editable on each row. */}

        {endingItems.length === 0 ? (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--tx3,#888)", fontStyle: "italic", textAlign: "center", background: "var(--input-bg,#fafafa)", borderRadius: 6, border: "1px dashed var(--bdr,#ddd)" }}>
            No ending obligations configured. Click <strong>+ Add</strong> to model a finite expense or savings line.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {endingItems.map((ei) => {
              /* Per-row derived state — lots of small bits so we compute
                 them once at the top of the row for readability below.

                 Phase 14a: every obligation owns N refs (0..many). Each
                 ref renders its own dropdown; missing/orphaned refs are
                 flagged individually; the combined monthly is the sum
                 of resolved refs (or null if any ref is unresolved). */
              const refs = getItemRefs(ei);
              /* Per-ref resolution. Each entry parallel to `refs`:
                   { ref, key, linkedItem, monthly, isOrphan, matchedBy }
                 isOrphan ↔ the ref no longer resolves to any budget item
                 (renamed/deleted/reordered out, and id+name+idx all
                 failed to match).

                 Stable-IDs phase: uses `resolveItemRef` which prefers id
                 matching. The `key` used for claim-checking matches the
                 keying scheme in `claimedRefKeys` / `linkedItemOptions`
                 above — id-based when available, falls back to
                 section::idx. */
              const refResolutions = refs.map((ref) => {
                if (!ref || typeof ref.section !== "string") {
                  return { ref, key: null, linkedItem: null, monthly: null, isOrphan: false, matchedBy: null };
                }
                const { item: linkedItem, matchedBy } = resolveItemRef(ref, exp, sav);
                /* Key must align with `linkedItemOptions` keying so the
                   <select value> shows the current selection. We derive
                   it from the RESOLVED item (id-based when the item has
                   an id), not from the raw ref — otherwise a legacy
                   idx-keyed ref pointing at an item that now has an id
                   wouldn't line up with the dropdown option. Falls back
                   to section::idx when the resolved item lacks an id, or
                   to the raw ref when nothing resolved (orphan). */
                let key;
                if (linkedItem && typeof linkedItem.id === "string" && linkedItem.id.length > 0) {
                  key = `${ref.section}::id::${linkedItem.id}`;
                } else if (linkedItem) {
                  const arr = ref.section === "sav" ? sav : exp;
                  const resolvedIdx = Array.isArray(arr) ? arr.indexOf(linkedItem) : -1;
                  key = resolvedIdx >= 0 ? `${ref.section}::${resolvedIdx}` : null;
                } else if (typeof ref.id === "string" && ref.id.length > 0) {
                  key = `${ref.section}::id::${ref.id}`;
                } else if (typeof ref.idx === "number") {
                  key = `${ref.section}::${ref.idx}`;
                } else {
                  key = null;
                }
                const monthly = linkedItem ? monthlyAmountFor(ref) : null;
                return { ref, key, linkedItem, monthly, isOrphan: !linkedItem, matchedBy };
              });
              /* Whole-obligation aggregates. */
              const anyOrphan = refResolutions.some(r => r.isOrphan);
              const noRefs = refs.length === 0;
              /* Combined monthly: only meaningful when EVERY ref resolves
                 to a positive number — otherwise we show "—" since
                 resolveEndingEvents will orphan the obligation. */
              let liveMonthly = null;
              if (refs.length > 0 && !anyOrphan) {
                let sum = 0;
                let allOk = true;
                for (const r of refResolutions) {
                  if (r.monthly == null || !isFinite(r.monthly) || r.monthly <= 0) {
                    allOk = false;
                    break;
                  }
                  sum += r.monthly;
                }
                liveMonthly = allOk ? sum : null;
              }
              const destAcct = accounts.find(a => a.id === ei.destAccountId);
              /* Pool-headroom-aware capping warning. The prior implementation
                 fired whenever the destination was in any capped pool with
                 capAtLimit enabled — false alarm for the common case where
                 the pool is nowhere near its IRS limit (e.g. $5k Roth IRA
                 against a $7k limit). Now: only warn when the freed cash,
                 combined with existing pool contributions, would push the
                 pool over its limit. See poolHeadroom in calc.js + tests. */
              const freedAnnual = (Number(liveMonthly) || 0) * 12;
              const headroom = poolHeadroom({
                destAccount: destAcct,
                accounts,
                effectiveContribFor,
                accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
                getPoolLimit,
                baseYear,
                hsaCoverage,
                ageOf: (owner) => {
                  if (owner === "p1" && tax?.p1BirthYear) return baseYear - tax.p1BirthYear;
                  if (owner === "p2" && tax?.p2BirthYear) return baseYear - tax.p2BirthYear;
                  if (owner === "joint") {
                    if (tax?.p1BirthYear && tax?.p2BirthYear) return baseYear - Math.min(tax.p1BirthYear, tax.p2BirthYear);
                    if (tax?.p1BirthYear) return baseYear - tax.p1BirthYear;
                    if (tax?.p2BirthYear) return baseYear - tax.p2BirthYear;
                  }
                  return null;
                },
                freedAnnual,
              });
              const destIsCapped = headroom.atRisk;
              const isOutOfHorizon = resolvedEnding.outOfHorizon.some(o => o.id === ei.id);
              const isLoanMode = ei.mode === "loan";

              /* Compute loan endsOn on the fly for display + persist via
                 useEffect-equivalent on input blur. We compute every render
                 for live preview; the persisted value is what the math
                 layer trusts (resolveEndingEvents reads ei.endsOn).
                 Loan-mode uses the SUMMED monthly across all linked items
                 (e.g. mortgage P&I + extra principal payment combined).

                 Roll-forward: if `ei.balanceAsOf` predates `baseYearMonth`,
                 we advance the stated balance to today using the linked
                 monthly payment before amortizing. This keeps the projection
                 honest when the user typed the balance N months ago and
                 hasn't refreshed it. */
              let loanResult = null;
              let rolledLoanBalance = Number(ei.balance) || 0;
              let loanRollMonths = 0;
              if (isLoanMode && liveMonthly != null) {
                if (ei.balanceAsOf && baseYearMonth) {
                  const roll = rollForwardBalance(ei.balance, ei.annualRate, liveMonthly, ei.balanceAsOf, baseYearMonth);
                  if (roll.ok) {
                    rolledLoanBalance = roll.rolledBalance;
                    loanRollMonths = roll.monthsRolled;
                  }
                }
                loanResult = (rolledLoanBalance > 0)
                  ? computeLoanEndsOn(rolledLoanBalance, ei.annualRate, liveMonthly, baseYearMonth)
                  : { ok: false, reason: "paid-off-pre-base" };
              }
              /* Paydown-aware payoff: if a one-time event is linked to this
                 obligation (paying down principal), obligationDebtByYear has
                 already computed the real post-paydown payoff date. Surface
                 that instead of the naive computeLoanEndsOn result, which
                 ignores lump sums. hasLinkedPaydown gates the "(after
                 paydown)" note so unpaid loans read exactly as before. */
              const hasLinkedPaydown = oneTimeEvents.some(
                ev => ev && ev.linkedEndingId === ei.id && Math.abs(Number(ev.amount) || 0) > 0
              );
              const paydownPayoff = obligationDebtByYear.payoffById[ei.id] || null;
              const loanStaleMonths = ei.balanceAsOf
                ? (monthsSinceAsOf(ei.balanceAsOf, baseYearMonth) || 0)
                : 0;

              /* Sub-loans (Phase 14 follow-up): when present, the single
                 balance/rate is REPLACED by per-rate sub-loans, each
                 amortizing independently. The math lives in subLoans.js;
                 here we just resolve the group for display. Graduation
                 entry + freed-payment indicator are later sessions, so we
                 pass graduation:{enabled:false} for now (flat per-loan). */
              const subLoans = Array.isArray(ei.subLoans) ? ei.subLoans : [];
              const hasSubLoans = subLoans.length > 0;
              /* Per-item routing (Phase 14b follow-up): each linked ref
                 may carry { routedTo: { subLoanId, slot } }. Aggregate
                 those into per-sub-loan totals, then BUILD an "effective"
                 sub-loan list whose Payment/Extra come from routed
                 totals (when any ref routes to that sub-loan) or fall
                 back to the stored payments[0]/extraMonthly. The
                 effective list is what we hand to resolveSubLoanGroup
                 and what the UI reads back when rendering — the stored
                 values stay untouched (so unrouted obligations behave
                 exactly as they always did, and a user removing all
                 routings reverts to manual entry). */
              const subLoanIds = subLoans.map(s => s.id);
              const routedTotalsForRefs = hasSubLoans
                ? routedTotalsBySubLoan(refs, refResolutions, subLoanIds)
                : { byId: {}, unallocated: 0, unallocatedSources: [], orphanRoutings: [] };
              const effectiveSubLoans = hasSubLoans
                ? subLoans.map(sl => {
                    const t = routedTotalsForRefs.byId[sl.id];
                    if (!t) return sl;
                    /* Only override the field the user routed something
                       into. If only "required" got routed, we override
                       payments[0] but leave extraMonthly as the stored
                       value (so a user could route required from the
                       budget but still type extras manually). Same the
                       other way. */
                    const next = { ...sl };
                    if (t.requiredSources.length > 0) {
                      next.payments = [Math.round(t.required * 100) / 100];
                    }
                    if (t.extraSources.length > 0) {
                      next.extraMonthly = Math.round(t.extra * 100) / 100;
                    }
                    return next;
                  })
                : subLoans;
              const subResult = (isLoanMode && hasSubLoans)
                ? resolveSubLoanGroup(effectiveSubLoans, { enabled: false }, baseYearMonth)
                : null;
              /* Balance-weighted average rate + combined balance for the
                 read-only summary that replaces the single-rate display. */
              const subSummary = hasSubLoans ? (() => {
                let bal = 0, weighted = 0;
                for (const s of subLoans) {
                  const b = Number(s.balance) || 0;
                  bal += b;
                  weighted += b * (Number(s.annualRate) || 0);
                }
                return { totalBalance: bal, avgRate: bal > 0 ? weighted / bal : 0 };
              })() : null;

              const updateSubLoanAt = (slIdx, patch) => {
                const next = subLoans.map((s, i) => i === slIdx ? { ...s, ...patch } : s);
                updateEndingItem(ei.id, withGroupEndsOn(next));
              };
              const removeSubLoanAt = (slIdx) => {
                const next = subLoans.slice();
                next.splice(slIdx, 1);
                updateEndingItem(ei.id, withGroupEndsOn(next));
              };
              const addSubLoan = () => {
                /* Seed a new sub-loan. If this is the FIRST one, fold the
                   existing single balance/rate (and as-of date) in as the
                   seed so the user doesn't lose what they typed. */
                const seed = subLoans.length === 0
                  ? {
                      balance: Number(ei.balance) || 0,
                      annualRate: Number(ei.annualRate) || 0,
                      balanceAsOf: ei.balanceAsOf || baseYearMonth,
                    }
                  : { balance: 0, annualRate: 0, balanceAsOf: baseYearMonth };
                const sl = {
                  id: `sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                  label: `Sub-loan ${subLoans.length + 1}`,
                  balance: seed.balance,
                  annualRate: seed.annualRate,
                  balanceAsOf: seed.balanceAsOf,
                  payments: [0],     // single flat payment for now (graduation later)
                  extraMonthly: 0,
                };
                updateEndingItem(ei.id, withGroupEndsOn([...subLoans, sl]));
              };
              /* Build a patch that includes the recomputed group payoff
                 date so resolveEndingEvents (which reads ei.endsOn) fires
                 the freed-cash event when the LAST sub-loan clears. When a
                 sub-loan can't amortize we leave endsOn untouched and the
                 summary surfaces the error. Removing all sub-loans reverts
                 to the single-rate balance/rate path. */
              function withGroupEndsOn(nextSubLoans) {
                const patch = { subLoans: nextSubLoans };
                if (nextSubLoans.length > 0) {
                  /* Apply the same routed-override pass we use for
                     display, so the persisted endsOn matches what the
                     math layer will actually see at projection time.
                     Without this, editing balance/rate while routings
                     are active would re-stamp endsOn using the stored
                     (possibly zero) payment fields and silently drift
                     the freed-cash event off-date. */
                  const nextIds = nextSubLoans.map(s => s.id);
                  const t = routedTotalsBySubLoan(refs, refResolutions, nextIds);
                  const effective = nextSubLoans.map(sl => {
                    const bucket = t.byId[sl.id];
                    if (!bucket) return sl;
                    const out = { ...sl };
                    if (bucket.requiredSources.length > 0) {
                      out.payments = [Math.round(bucket.required * 100) / 100];
                    }
                    if (bucket.extraSources.length > 0) {
                      out.extraMonthly = Math.round(bucket.extra * 100) / 100;
                    }
                    return out;
                  });
                  const g = resolveSubLoanGroup(effective, { enabled: false }, baseYearMonth);
                  if (g.groupEndsOn && !g.anyError) patch.endsOn = g.groupEndsOn;
                }
                return patch;
              }

              const conflictsHere = endingItemConflicts.some(c => c.ids.includes(ei.id));

              /* Ref-list mutation helpers (Phase 14a). Each operates on
                 ei.itemRefs; they patch into updateEndingItem so the
                 whole flow goes through the standard update path.

                 Phase 14b follow-up: when sub-loans exist, refs carry a
                 routedTo field that drives effective sub-loan payments.
                 Any change to refs (or to routedTo) must re-derive
                 endsOn so the persisted group payoff date stays in
                 sync with what the math layer will compute. The helper
                 below recomputes endsOn given a candidate refs array,
                 using current sub-loans. Mirrors withGroupEndsOn but
                 for the refs side of the same equation. */
              function endsOnPatchForRefs(nextRefs) {
                if (!isLoanMode || !hasSubLoans) return {};
                /* Build a synthetic refResolutions parallel to nextRefs:
                   monthly stays the same per-ref since we're not
                   changing budget items here, only routing. We resolve
                   each candidate ref through resolveItemRef the same
                   way the live render does. */
                const nextResolutions = nextRefs.map(ref => {
                  if (!ref || typeof ref.section !== "string") {
                    return { ref, monthly: null };
                  }
                  const { item } = resolveItemRef(ref, exp, sav);
                  const monthly = item ? monthlyAmountFor(ref) : null;
                  return { ref, monthly };
                });
                const ids = subLoans.map(s => s.id);
                const t = routedTotalsBySubLoan(nextRefs, nextResolutions, ids);
                const effective = subLoans.map(sl => {
                  const bucket = t.byId[sl.id];
                  if (!bucket) return sl;
                  const out = { ...sl };
                  if (bucket.requiredSources.length > 0) {
                    out.payments = [Math.round(bucket.required * 100) / 100];
                  }
                  if (bucket.extraSources.length > 0) {
                    out.extraMonthly = Math.round(bucket.extra * 100) / 100;
                  }
                  return out;
                });
                const g = resolveSubLoanGroup(effective, { enabled: false }, baseYearMonth);
                if (g.groupEndsOn && !g.anyError) return { endsOn: g.groupEndsOn };
                return {};
              }

              const setRefAt = (slotIdx, newRef) => {
                const next = refs.slice();
                next[slotIdx] = newRef;
                updateEndingItem(ei.id, { itemRefs: next, ...endsOnPatchForRefs(next) });
              };
              const removeRefAt = (slotIdx) => {
                const next = refs.slice();
                next.splice(slotIdx, 1);
                updateEndingItem(ei.id, { itemRefs: next, ...endsOnPatchForRefs(next) });
              };
              const setRoutingAt = (slotIdx, routedTo) => {
                /* Patch only the routedTo field on the targeted ref.
                   Pass null to clear. Re-derive endsOn since the
                   effective sub-loan payment streams have shifted. */
                const next = refs.slice();
                if (!next[slotIdx]) return;
                next[slotIdx] = { ...next[slotIdx], routedTo: routedTo || null };
                updateEndingItem(ei.id, { itemRefs: next, ...endsOnPatchForRefs(next) });
              };
              const appendRef = () => {
                /* Find the first option not already claimed by anyone
                   (including this obligation) as the default for the
                   new slot. If everything's claimed, leave it null and
                   let the user pick. */
                const claimedKeys = new Set(
                  refResolutions.filter(r => r.key).map(r => r.key)
                );
                const firstAvailable = linkedItemOptions.find(o => {
                  if (claimedKeys.has(o.key)) return false;
                  const taken = claimedRefKeys.get(o.key);
                  return !(taken && !taken.has(ei.id)); // not taken by another obligation
                });
                const newRef = firstAvailable
                  ? { section: firstAvailable.section, id: firstAvailable.id || undefined, idx: firstAvailable.idx, name: firstAvailable.name }
                  : null;
                const nextRefs = [...refs, newRef];
                updateEndingItem(ei.id, { itemRefs: nextRefs, ...endsOnPatchForRefs(nextRefs) });
              };

              /* Row-level "has any issue" flag for the border. Includes
                 conflicts, orphaned refs, AND empty-refs case (which
                 silently orphans without a per-ref marker). */
              const rowProblem = conflictsHere || anyOrphan || noRefs;

              return (
                <div key={ei.id} style={{
                  padding: 10,
                  border: `1px solid ${rowProblem ? "rgba(232,87,58,0.5)" : "var(--bdr,#ddd)"}`,
                  borderRadius: 8,
                  background: "var(--card-bg,#fff)",
                  display: "grid",
                  gridTemplateColumns: mob ? "1fr" : "1.6fr 2.4fr auto",
                  gap: 10,
                  alignItems: "start",
                }}>
                  {/* Linked budget items (multi-select via stacked dropdowns) */}
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Linked Budget {refs.length === 1 ? "Item" : "Items"}
                      {refs.length > 1 && (
                        <span style={{ marginLeft: 6, color: "var(--tx3,#aaa)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                          ({refs.length})
                        </span>
                      )}
                    </label>
                    {refs.length === 0 ? (
                      /* No refs yet — single "pick" placeholder dropdown
                         that immediately appends on selection. This keeps
                         the empty-state path looking like one dropdown
                         (familiar) without forcing the user to click
                         "+ Add" before picking the first item. */
                      <select
                        value=""
                        onChange={e => {
                          const v = e.target.value;
                          if (!v) return;
                          const opt = linkedItemOptions.find(o => o.key === v);
                          if (!opt) return;
                          updateEndingItem(ei.id, {
                            itemRefs: [{ section: opt.section, id: opt.id || undefined, idx: opt.idx, name: opt.name }],
                          });
                        }}
                        style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid #E8573A", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                      >
                        <option value="">— pick a budget line —</option>
                        <optgroup label="Expenses">
                          {linkedItemOptions.filter(o => o.section === "exp").map(o => {
                            const taken = claimedRefKeys.get(o.key);
                            const takenByOther = taken && !taken.has(ei.id);
                            return (
                              <option key={o.key} value={o.key} disabled={takenByOther}>
                                {o.name}{takenByOther ? " — already used" : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                        <optgroup label="Savings">
                          {linkedItemOptions.filter(o => o.section === "sav").map(o => {
                            const taken = claimedRefKeys.get(o.key);
                            const takenByOther = taken && !taken.has(ei.id);
                            return (
                              <option key={o.key} value={o.key} disabled={takenByOther}>
                                {o.name}{takenByOther ? " — already used" : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                      </select>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {refResolutions.map((rr, slotIdx) => {
                          /* Per-slot disable rules: an option is disabled
                             if claimed by another obligation, or claimed
                             by a DIFFERENT slot in THIS obligation. The
                             slot's own current value is always enabled. */
                          const ownKey = rr.key;
                          const otherSlotKeys = new Set(
                            refResolutions
                              .map((r, i) => (i === slotIdx ? null : r.key))
                              .filter(Boolean)
                          );
                          const onlyOneRef = refs.length === 1;
                          return (
                            <div key={slotIdx} style={{ display: "flex", gap: 4, alignItems: "stretch", flexWrap: "wrap" }}>
                              <select
                                value={ownKey || ""}
                                onChange={e => {
                                  const v = e.target.value;
                                  if (!v) {
                                    /* Clear-this-slot — only meaningful if
                                       there are sibling refs. With only
                                       one ref left, force at least one
                                       (delete the whole obligation if
                                       you want none). UI also disables
                                       the empty option in that case. */
                                    if (onlyOneRef) return;
                                    removeRefAt(slotIdx);
                                    return;
                                  }
                                  const opt = linkedItemOptions.find(o => o.key === v);
                                  if (!opt) return;
                                  setRefAt(slotIdx, { section: opt.section, id: opt.id || undefined, idx: opt.idx, name: opt.name });
                                }}
                                style={{ flex: 1, minWidth: 0, padding: 6, fontSize: 12, border: `1px solid ${rr.isOrphan ? "#E8573A" : "var(--bdr,#ddd)"}`, borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                              >
                                <option value="" disabled={onlyOneRef}>
                                  {onlyOneRef ? "— must have at least one —" : "— remove this item —"}
                                </option>
                                <optgroup label="Expenses">
                                  {linkedItemOptions.filter(o => o.section === "exp").map(o => {
                                    const taken = claimedRefKeys.get(o.key);
                                    const takenByOtherObligation = taken && !taken.has(ei.id);
                                    const takenByOtherSlot = otherSlotKeys.has(o.key);
                                    const disabled = (takenByOtherObligation || takenByOtherSlot) && o.key !== ownKey;
                                    return (
                                      <option key={o.key} value={o.key} disabled={disabled}>
                                        {o.name}
                                        {takenByOtherObligation && o.key !== ownKey ? " — already used" : ""}
                                        {takenByOtherSlot && o.key !== ownKey ? " — used above" : ""}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                                <optgroup label="Savings">
                                  {linkedItemOptions.filter(o => o.section === "sav").map(o => {
                                    const taken = claimedRefKeys.get(o.key);
                                    const takenByOtherObligation = taken && !taken.has(ei.id);
                                    const takenByOtherSlot = otherSlotKeys.has(o.key);
                                    const disabled = (takenByOtherObligation || takenByOtherSlot) && o.key !== ownKey;
                                    return (
                                      <option key={o.key} value={o.key} disabled={disabled}>
                                        {o.name}
                                        {takenByOtherObligation && o.key !== ownKey ? " — already used" : ""}
                                        {takenByOtherSlot && o.key !== ownKey ? " — used above" : ""}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                              </select>
                              {/* Per-item routing dropdown (Phase 14b
                                 follow-up). Only meaningful when sub-
                                 loans exist — otherwise the obligation
                                 is a single-loan or date-mode and there's
                                 nothing to route to. Each option pins
                                 this ref's monthly to a specific sub-
                                 loan/slot; unallocated cash falls into
                                 the reconciliation line below. */}
                              {isLoanMode && hasSubLoans && (() => {
                                const currentRouted = rr.ref?.routedTo;
                                const validSlots = currentRouted
                                  && typeof currentRouted === "object"
                                  && (currentRouted.slot === "required" || currentRouted.slot === "extra");
                                const isOrphanRouted = !!validSlots
                                  && typeof currentRouted.subLoanId === "string"
                                  && currentRouted.subLoanId.length > 0
                                  && !subLoanIds.includes(currentRouted.subLoanId);
                                const currentValue = (validSlots && !isOrphanRouted && subLoanIds.includes(currentRouted.subLoanId))
                                  ? `${currentRouted.subLoanId}::${currentRouted.slot}`
                                  : "";
                                return (
                                  <select
                                    value={isOrphanRouted ? "__orphan__" : currentValue}
                                    onChange={e => {
                                      const v = e.target.value;
                                      if (!v || v === "__orphan__") {
                                        setRoutingAt(slotIdx, null);
                                        return;
                                      }
                                      const [subLoanId, slot] = v.split("::");
                                      setRoutingAt(slotIdx, { subLoanId, slot });
                                    }}
                                    title={isOrphanRouted
                                      ? "This routing points at a sub-loan that was deleted. Pick a new destination or leave unallocated."
                                      : "Route this linked item to a sub-loan as required payment or extra principal."}
                                    style={{
                                      flex: "0 0 auto",
                                      maxWidth: 165,
                                      padding: 6,
                                      fontSize: 11,
                                      border: `1px solid ${isOrphanRouted ? "#E8573A" : (currentValue ? "var(--bdr,#bbb)" : "var(--bdr,#ddd)")}`,
                                      borderRadius: 6,
                                      background: "var(--input-bg,#fafafa)",
                                      color: "var(--input-color,#222)",
                                    }}
                                  >
                                    <option value="">— unallocated —</option>
                                    {isOrphanRouted && (
                                      <option value="__orphan__" disabled>
                                        ⚠ routing to deleted sub-loan
                                      </option>
                                    )}
                                    <optgroup label="Required">
                                      {subLoans.map(sl => (
                                        <option key={`req-${sl.id}`} value={`${sl.id}::required`}>
                                          {sl.label || sl.id}
                                        </option>
                                      ))}
                                    </optgroup>
                                    <optgroup label="Extras">
                                      {subLoans.map(sl => (
                                        <option key={`ext-${sl.id}`} value={`${sl.id}::extra`}>
                                          {sl.label || sl.id}
                                        </option>
                                      ))}
                                    </optgroup>
                                  </select>
                                );
                              })()}
                              {/* Per-slot remove button (only when >1 ref) */}
                              {!onlyOneRef && (
                                <button
                                  type="button"
                                  onClick={() => removeRefAt(slotIdx)}
                                  title="Remove this linked item from the obligation"
                                  style={{ border: "1px solid var(--bdr,#ddd)", background: "var(--input-bg,#fafafa)", color: "var(--tx3,#888)", cursor: "pointer", fontSize: 14, padding: "0 8px", borderRadius: 6, lineHeight: 1 }}
                                >×</button>
                              )}
                            </div>
                          );
                        })}
                        {/* + Add another item — disabled when nothing left
                           to pick (all options claimed elsewhere or here). */}
                        {(() => {
                          const claimedHere = new Set(
                            refResolutions.filter(r => r.key).map(r => r.key)
                          );
                          const hasAvailable = linkedItemOptions.some(o => {
                            if (claimedHere.has(o.key)) return false;
                            const taken = claimedRefKeys.get(o.key);
                            if (taken && !taken.has(ei.id)) return false;
                            return true;
                          });
                          return (
                            <button
                              type="button"
                              onClick={appendRef}
                              disabled={!hasAvailable}
                              title={hasAvailable
                                ? "Link another budget item to this obligation (sums monthly amounts)"
                                : "No remaining budget items to link"}
                              style={{
                                marginTop: 2,
                                padding: "4px 8px",
                                fontSize: 11,
                                fontWeight: 600,
                                border: `1px dashed ${hasAvailable ? "var(--bdr,#ccc)" : "var(--bdr,#eee)"}`,
                                borderRadius: 6,
                                background: "transparent",
                                color: hasAvailable ? "var(--tx2,#555)" : "var(--tx3,#bbb)",
                                cursor: hasAvailable ? "pointer" : "not-allowed",
                                alignSelf: "flex-start",
                              }}
                            >+ Add item</button>
                          );
                        })()}
                      </div>
                    )}
                    {/* Combined live monthly + per-obligation status hints.
                       Per-ref orphans are flagged inline on the dropdown
                       border; this line shows the aggregate. */}
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--tx3,#888)" }}>
                      {noRefs ? (
                        <span style={{ fontStyle: "italic" }}>Pick a budget line above</span>
                      ) : anyOrphan ? (
                        <span style={{ color: "#E8573A", fontWeight: 600 }}>
                          ⚠ {refResolutions.filter(r => r.isOrphan).length === 1
                            ? "1 linked item is missing"
                            : `${refResolutions.filter(r => r.isOrphan).length} linked items are missing`}
                          {(() => {
                            const orphans = refResolutions.filter(r => r.isOrphan);
                            if (orphans.length === 0) return null;
                            const names = orphans.map(r => `"${r.ref?.name || "?"}"`).join(", ");
                            return <span style={{ fontWeight: 400 }}> (was {names})</span>;
                          })()}
                        </span>
                      ) : liveMonthly == null ? (
                        <span style={{ fontStyle: "italic" }}>Awaiting valid amounts</span>
                      ) : liveMonthly === 0 ? (
                        <span style={{ color: "#E8573A" }}>Combined amount is $0 — set values on the Budget tab</span>
                      ) : (
                        <span>
                          {refs.length > 1 ? "Combined: " : "Currently: "}
                          <strong style={{ color: "var(--card-color,#222)" }}>{fmt(liveMonthly)}/mo</strong>
                          {refs.length > 1 && (
                            <span style={{ color: "var(--tx3,#aaa)" }}>
                              {" "}({refResolutions.map(r => fmt(r.monthly)).join(" + ")})
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Destination account — sits in the linked-items column,
                       stacked under the combined-monthly hint, so the mode
                       column has full horizontal room for sub-loan cards. */}
                    <div style={{ marginTop: 10 }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Redirect To</label>
                      <select
                        value={ei.destAccountId || ""}
                        onChange={e => updateEndingItem(ei.id, { destAccountId: e.target.value })}
                        style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                      >
                        <option value="">— pick destination —</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {deriveAccountName(a, p1Name, p2Name)}
                          </option>
                        ))}
                      </select>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--tx3,#888)" }}>
                        {!ei.destAccountId ? (
                          <span style={{ color: "#E8573A" }}>Pick a destination account</span>
                        ) : destIsCapped ? (
                          <span style={{ color: "#92400E" }} title="Pool caps apply to the base annual contribution only — the freed monthly cash flows through uncapped in X-A. If you're hitting a 401(k)/IRA/HSA ceiling, the math may overstate.">
                            ⚠ Capped pool — caps may understate effect
                          </span>
                        ) : isOutOfHorizon ? (
                          <span style={{ color: "var(--tx3,#888)", fontStyle: "italic" }}>
                            Past {horizon}y horizon — no visible effect
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Mode toggle + date or loan inputs */}
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Mode</label>
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      {["date", "loan"].map(m => (
                        <button
                          key={m}
                          onClick={() => updateEndingItem(ei.id, { mode: m })}
                          style={{
                            flex: 1,
                            padding: "5px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                            border: "none",
                            borderRadius: 5,
                            background: ei.mode === m ? "#556FB5" : "var(--input-bg,#f5f5f5)",
                            color: ei.mode === m ? "#fff" : "var(--tx2,#555)",
                            cursor: "pointer",
                          }}
                          title={m === "date"
                            ? "Pick the month the obligation ends. Use this for fixed-term subscriptions or known payoff dates."
                            : "Enter loan balance + interest rate. The end date is computed from the linked item's monthly payment using standard amortization."}
                        >
                          {m === "date" ? "Date" : "Loan"}
                        </button>
                      ))}
                    </div>
                    {ei.mode === "date" ? (
                      <input
                        type="month"
                        value={ei.endsOn || ""}
                        onChange={e => updateEndingItem(ei.id, { endsOn: e.target.value })}
                        style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                      />
                    ) : hasSubLoans ? (
                      /* === Sub-loan breakdown (multi-rate) === */
                      <div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {subLoans.map((sl, slIdx) => {
                            const r = subResult?.results.find(x => x.id === sl.id);
                            return (
                              <div key={sl.id} style={{ border: "1px solid var(--bdr,#e2e2e2)", borderRadius: 6, padding: 6, background: "var(--input-bg,#fafafa)" }}>
                                <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                                  <input
                                    type="text"
                                    value={sl.label || ""}
                                    onChange={e => updateSubLoanAt(slIdx, { label: e.target.value })}
                                    placeholder={`Sub-loan ${slIdx + 1}`}
                                    style={{ flex: 1, padding: 4, fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--card-bg,#fff)", color: "var(--input-color,#222)" }}
                                  />
                                  <button onClick={() => removeSubLoanAt(slIdx)} title="Remove sub-loan"
                                    style={{ border: "none", background: "transparent", color: "var(--tx3,#999)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px" }}>×</button>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                                  <div>
                                    <label style={{ display: "block", fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 1 }}>Balance</label>
                                    <NI
                                      value={String(sl.balance ?? 0)}
                                      onChange={v => {
                                        /* Editing balance is a refresh: bump
                                           balanceAsOf to today so the new
                                           number isn't compounded forward. */
                                        updateSubLoanAt(slIdx, { balance: evalF(v), balanceAsOf: baseYearMonth });
                                      }}
                                      onBlurResolve
                                      prefix="$"
                                    />
                                  </div>
                                  <div>
                                    <label style={{ display: "block", fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 1 }}>Rate %</label>
                                    <NI value={String(sl.annualRate ?? 0)} onChange={v => updateSubLoanAt(slIdx, { annualRate: evalF(v) })} onBlurResolve />
                                  </div>
                                  <div>
                                    <label style={{ display: "block", fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 1 }}>Payment</label>
                                    {(() => {
                                      /* Routed when ANY linked ref has
                                         routedTo {subLoanId: sl.id, slot:"required"}.
                                         When routed, the field is a read-
                                         only display of the sum, with a
                                         "(from: <names>)" caption. When
                                         unrouted, the field is the same
                                         editable NI as before — back-
                                         compat with obligations that
                                         never set up per-item routing. */
                                      const bucket = routedTotalsForRefs.byId[sl.id];
                                      const routed = bucket && bucket.requiredSources.length > 0;
                                      if (routed) {
                                        return (
                                          <>
                                            <div
                                              style={{
                                                padding: "4px 6px",
                                                fontSize: 11,
                                                border: "1px dashed var(--bdr,#bbb)",
                                                borderRadius: 4,
                                                background: "var(--card-bg,#f0f4ee)",
                                                color: "var(--input-color,#222)",
                                                fontFamily: "var(--num-font, inherit)",
                                                lineHeight: 1.4,
                                              }}
                                              title={`Routed from linked item${bucket.requiredSources.length === 1 ? "" : "s"}: ${bucket.requiredSources.join(", ")}`}
                                            >
                                              {fmt(bucket.required)}
                                            </div>
                                            <div style={{ fontSize: 8.5, color: "var(--tx3,#888)", marginTop: 1, lineHeight: 1.2 }}>
                                              from: {bucket.requiredSources.join(", ")}
                                            </div>
                                          </>
                                        );
                                      }
                                      return (
                                        <NI value={String((sl.payments && sl.payments[0]) ?? 0)} onChange={v => updateSubLoanAt(slIdx, { payments: [evalF(v)] })} onBlurResolve prefix="$" />
                                      );
                                    })()}
                                  </div>
                                </div>
                                {/* Row 2: As of date + Extra principal.
                                   As-of anchors the balance to a calendar
                                   month so the roll-forward knows how far
                                   to advance. Extra is the directed extra
                                   principal — when a linked item is routed
                                   here as "Extras", Extra is read-only
                                   and displays the routed total. When
                                   nothing routes here as Extras, Extra is
                                   editable (back-compat with obligations
                                   that don't use per-item routing). */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
                                  <div>
                                    <label
                                      style={{ display: "block", fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 1 }}
                                      title="The month this balance was accurate. Editing the balance auto-sets this to the current month."
                                    >As of</label>
                                    <input
                                      type="month"
                                      value={sl.balanceAsOf || baseYearMonth}
                                      onChange={e => updateSubLoanAt(slIdx, { balanceAsOf: e.target.value })}
                                      style={{ width: "100%", padding: 4, fontSize: 10.5, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--card-bg,#fff)", color: "var(--input-color,#222)" }}
                                    />
                                  </div>
                                  <div>
                                    <label
                                      style={{ display: "block", fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 1 }}
                                      title="Extra monthly principal directed to this sub-loan, on top of the Payment. Route a linked budget item here as 'Extras' on the left to auto-fill from the budget, or type a value directly when nothing is routed."
                                    >Extra</label>
                                    {(() => {
                                      const bucket = routedTotalsForRefs.byId[sl.id];
                                      const routed = bucket && bucket.extraSources.length > 0;
                                      if (routed) {
                                        return (
                                          <>
                                            <div
                                              style={{
                                                padding: "4px 6px",
                                                fontSize: 11,
                                                border: "1px dashed var(--bdr,#bbb)",
                                                borderRadius: 4,
                                                background: "var(--card-bg,#f0f4ee)",
                                                color: "var(--input-color,#222)",
                                                fontFamily: "var(--num-font, inherit)",
                                                lineHeight: 1.4,
                                              }}
                                              title={`Routed from linked item${bucket.extraSources.length === 1 ? "" : "s"}: ${bucket.extraSources.join(", ")}`}
                                            >
                                              {fmt(bucket.extra)}
                                            </div>
                                            <div style={{ fontSize: 8.5, color: "var(--tx3,#888)", marginTop: 1, lineHeight: 1.2 }}>
                                              from: {bucket.extraSources.join(", ")}
                                            </div>
                                          </>
                                        );
                                      }
                                      return (
                                        <NI value={String(sl.extraMonthly ?? 0)} onChange={v => updateSubLoanAt(slIdx, { extraMonthly: evalF(v) })} onBlurResolve prefix="$" />
                                      );
                                    })()}
                                  </div>
                                </div>
                                <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--tx3,#888)" }}>
                                  {r?.ok ? (
                                    <>
                                      Pays off <strong style={{ color: "var(--card-color,#222)" }}>{r.endsOn}</strong> ({r.months} mo)
                                      {r.rolledFrom && r.rolledFrom.monthsRolled > 0 && (() => {
                                        /* The remaining balance at base = the
                                           balance at the start of schedule[0],
                                           i.e. before the first payment is
                                           applied. schedule[0].remaining is
                                           AFTER payment, so add back interest
                                           + payment - extra to get the start.
                                           Easier: compute interest + principal
                                           = payment on row 0, so
                                           start = remaining + principal. */
                                        const row0 = r.schedule[0];
                                        const startBal = row0 ? Math.max(0, row0.remaining + row0.principal) : 0;
                                        return (
                                          <span style={{ color: "var(--tx3,#aaa)" }}>
                                            {" "}· rolled {r.rolledFrom.monthsRolled}mo to <strong style={{ color: "var(--card-color,#666)" }}>{fmt(Math.round(startBal))}</strong>
                                          </span>
                                        );
                                      })()}
                                    </>
                                  ) : r?.reason === "negative-amortization" ? (
                                    <span style={{ color: "#E8573A" }}>⚠ payment below interest</span>
                                  ) : r?.reason === "no-payment" ? (
                                    <span style={{ color: "#E8573A" }}>set a payment</span>
                                  ) : r?.reason === "horizon-exceeded" ? (
                                    <span style={{ color: "#E8573A" }}>&gt;50yr — check inputs</span>
                                  ) : r?.reason === "paid-off-pre-base" ? (
                                    <span style={{ color: "#888" }}>paid off — refresh balance or remove</span>
                                  ) : (
                                    <span style={{ fontStyle: "italic" }}>—</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <button onClick={addSubLoan}
                          style={{ marginTop: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, border: "1px dashed var(--bdr,#bbb)", borderRadius: 6, background: "transparent", color: "var(--tx2,#666)", cursor: "pointer" }}>
                          + Add sub-loan
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 2 }}>Balance</label>
                          <NI
                            value={String(ei.balance ?? 0)}
                            onChange={v => {
                              const num = evalF(v);
                              /* Editing the balance is treated as a refresh:
                                 the new number is the user's current truth,
                                 so `balanceAsOf` snaps to base. This keeps
                                 the roll-forward from compounding interest
                                 on a value the user just typed. */
                              const patch = { balance: num, balanceAsOf: baseYearMonth };
                              if (liveMonthly != null && liveMonthly > 0) {
                                const r = computeLoanEndsOn(num, ei.annualRate, liveMonthly, baseYearMonth);
                                if (r.ok) patch.endsOn = r.endsOn;
                              }
                              updateEndingItem(ei.id, patch);
                            }}
                            onBlurResolve
                            prefix="$"
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 2 }}>Rate %</label>
                          <NI
                            value={String(ei.annualRate ?? 0)}
                            onChange={v => {
                              const num = evalF(v);
                              const patch = { annualRate: num };
                              if (liveMonthly != null && liveMonthly > 0) {
                                /* Recompute endsOn using the rolled balance —
                                   not the raw `ei.balance` — so the displayed
                                   payoff date matches what the user sees. */
                                const r = computeLoanEndsOn(rolledLoanBalance, num, liveMonthly, baseYearMonth);
                                if (r.ok) patch.endsOn = r.endsOn;
                              }
                              updateEndingItem(ei.id, patch);
                            }}
                            onBlurResolve
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 2 }} title="The month this balance was accurate. Editing the balance auto-sets this to the current month.">As of</label>
                          <input
                            type="month"
                            value={ei.balanceAsOf || baseYearMonth}
                            onChange={e => {
                              const v = e.target.value;
                              updateEndingItem(ei.id, { balanceAsOf: v });
                            }}
                            style={{ width: "100%", padding: 6, fontSize: 11, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
                          />
                        </div>
                      </div>
                    )}
                    {/* Roll-forward summary line for single-loan mode */}
                    {ei.mode === "loan" && !hasSubLoans && loanRollMonths > 0 && (
                      <div style={{ marginTop: 4, fontSize: 10, color: loanStaleMonths >= 3 ? "#92400E" : "var(--tx3,#888)" }}>
                        Rolled forward {loanRollMonths} mo: {fmt(Math.round(Number(ei.balance) || 0))} → <strong>{fmt(Math.round(rolledLoanBalance))}</strong>
                        {loanStaleMonths >= 3 && <span> · refresh suggested</span>}
                      </div>
                    )}
                    {/* Lump-sum recast behavior. Only meaningful for loan
                        mode, where a linked payoff event pays down principal.
                        "shorten" keeps the payment and ends the loan sooner;
                        "lower" keeps the original payoff date and drops the
                        payment. Default shorten (the realistic prepayment). */}
                    {ei.mode === "loan" && !hasSubLoans && (
                      <div style={{ marginTop: 8 }}>
                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          On lump-sum paydown
                          <span title="When a one-time payoff event pays down this loan's principal: 'Shorten term' keeps your monthly payment the same and pays the loan off earlier (saves interest). 'Lower payment' keeps the original payoff date and reduces the monthly payment instead." style={{ marginLeft: 5, cursor: "help", color: "var(--tx3,#aaa)" }}>ⓘ</span>
                        </label>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[["shorten", "Shorten term"], ["lower", "Lower payment"]].map(([val, lbl]) => {
                            const active = (ei.recastMode || "shorten") === val;
                            return (
                              <button
                                key={val}
                                onClick={() => updateEndingItem(ei.id, { recastMode: val })}
                                title={val === "shorten" ? "Keep the payment; the loan ends sooner." : "Keep the payoff date; the payment drops."}
                                style={{ flex: 1, padding: "4px 8px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5, background: active ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: active ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}
                              >{lbl}</button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Computed-endsOn display for loan mode */}
                    {ei.mode === "loan" && hasSubLoans && (
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--tx3,#888)", borderTop: "1px solid var(--bdr,#eee)", paddingTop: 5 }}>
                        <div>Combined: <strong style={{ color: "var(--card-color,#222)" }}>{fmt(Math.round(subSummary.totalBalance))}</strong> @ <strong style={{ color: "var(--card-color,#222)" }}>{subSummary.avgRate.toFixed(2)}%</strong> avg</div>

                        {/* === Reconciliation (Phase 14b follow-up):
                             with per-item routing, the budget is the
                             source of truth. We tally three things:
                               - Linked: the live monthly from the
                                 linked budget items (was already shown)
                               - Routed: how much of that is claimed by
                                 a sub-loan (required + extras combined)
                               - Unallocated: linked - routed — cash
                                 from the budget that isn't claimed by
                                 any sub-loan, surfaced amber so the
                                 user can either route it or shrink the
                                 linked items.
                             We additionally surface "needs more cash
                             than budget supplies" when the effective
                             sub-loan totals (which factor in any user-
                             typed unrouted values) exceed the linked
                             amount. Mirrors the deficit-case warning
                             from the prior design — the old surplus
                             picker is gone, replaced by per-item
                             routing dropdowns above. */}
                        {(() => {
                          /* Sum effective payments + extras across sub-
                             loans. effectiveSubLoans is what the math
                             layer sees (routed overrides applied). */
                          let effectiveTotal = 0;
                          for (const sl of effectiveSubLoans) {
                            effectiveTotal += Number(sl.payments && sl.payments[0]) || 0;
                            effectiveTotal += Math.max(0, Number(sl.extraMonthly) || 0);
                          }
                          /* Routed total = sum of all per-sub-loan
                             buckets the helper built. This is the cash
                             that flows from budget to debt. */
                          let routedTotal = 0;
                          for (const id of Object.keys(routedTotalsForRefs.byId)) {
                            const b = routedTotalsForRefs.byId[id];
                            routedTotal += b.required + b.extra;
                          }
                          const linked = Number(liveMonthly) || 0;
                          const unallocated = routedTotalsForRefs.unallocated;
                          /* "Deficit" = sub-loans demand more total cash
                             than the budget supplies via linked items.
                             Computed from effective totals so it
                             includes both routed-from-budget and
                             user-typed-unrouted contributions. */
                          const deficit = effectiveTotal - linked > 0.005
                            ? effectiveTotal - linked
                            : 0;
                          const matched = Math.abs(linked - routedTotal) < 0.005 && deficit === 0;
                          return (
                            <div style={{ marginTop: 4 }}>
                              <div>
                                Linked: <strong style={{ color: "var(--card-color,#222)" }}>{fmt(linked)}</strong>
                                {" · "}Routed: <strong style={{ color: "var(--card-color,#222)" }}>{fmt(routedTotal)}</strong>
                                {matched ? (
                                  <span style={{ color: "#3F8F3F", marginLeft: 4 }}>✓</span>
                                ) : unallocated > 0.005 ? (
                                  <span style={{ color: "#92400E", marginLeft: 4 }} title="Cash from linked budget items that isn't routed to any sub-loan. Use the routing dropdowns above to direct it.">
                                    · unallocated {fmt(unallocated)}
                                  </span>
                                ) : null}
                              </div>
                              {deficit > 0 && (
                                <div style={{ marginTop: 2, fontSize: 10, color: "#E8573A" }}>
                                  Sub-loan Payment/Extra fields demand {fmt(deficit)} beyond what the budget supplies.
                                  Lower a typed value or raise the linked budget line.
                                </div>
                              )}
                              {routedTotalsForRefs.orphanRoutings.length > 0 && (
                                <div style={{ marginTop: 2, fontSize: 10, color: "#92400E" }}>
                                  ⚠ {routedTotalsForRefs.orphanRoutings.length === 1
                                    ? "1 linked item is routed to a deleted sub-loan"
                                    : `${routedTotalsForRefs.orphanRoutings.length} linked items are routed to deleted sub-loans`}
                                  {" — "}re-pick destinations above or set to unallocated.
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div style={{ marginTop: 4 }}>
                          {subResult?.groupEndsOn && !subResult.anyError ? (
                            <>All paid off <strong style={{ color: "var(--card-color,#222)" }}>{subResult.groupEndsOn}</strong> <span style={{ color: "var(--tx3,#aaa)" }}>({subResult.groupMonths} mo)</span></>
                          ) : subResult?.anyError ? (
                            <span style={{ color: "#E8573A" }}>⚠ one or more sub-loans don't pay off — check inputs</span>
                          ) : (
                            <span style={{ fontStyle: "italic" }}>Awaiting valid inputs</span>
                          )}
                        </div>
                      </div>
                    )}
                    {ei.mode === "loan" && !hasSubLoans && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--tx3,#888)" }}>
                        {hasLinkedPaydown && paydownPayoff ? (
                          <>Pays off: <strong style={{ color: "#27AE60" }}>{paydownPayoff}</strong> <span style={{ color: "var(--tx3,#aaa)" }}>(after paydown)</span></>
                        ) : hasLinkedPaydown && !paydownPayoff ? (
                          <>Pays off: <strong style={{ color: "var(--tx3,#aaa)" }}>beyond horizon</strong> <span style={{ color: "var(--tx3,#aaa)" }}>(after paydown)</span></>
                        ) : loanResult?.ok ? (
                          <>Pays off: <strong style={{ color: "var(--card-color,#222)" }}>{loanResult.endsOn}</strong> <span style={{ color: "var(--tx3,#aaa)" }}>({loanResult.months} mo)</span></>
                        ) : loanResult?.reason === "zero-payment" ? (
                          <span style={{ color: "#E8573A" }}>Need a non-zero monthly payment</span>
                        ) : loanResult?.reason === "zero-balance" ? (
                          <span style={{ color: "#E8573A" }}>Need a non-zero balance</span>
                        ) : loanResult?.reason === "negative-amortization" ? (
                          <span style={{ color: "#E8573A" }}>⚠ Payment doesn't cover interest — loan never pays off</span>
                        ) : loanResult?.reason === "horizon-exceeded" ? (
                          <span style={{ color: "#E8573A" }}>Pays off beyond 50yr — check inputs</span>
                        ) : (
                          <span style={{ fontStyle: "italic" }}>Awaiting valid inputs</span>
                        )}
                        <button onClick={addSubLoan}
                          style={{ marginLeft: 8, padding: "2px 7px", fontSize: 9.5, fontWeight: 700, border: "1px dashed var(--bdr,#bbb)", borderRadius: 6, background: "transparent", color: "var(--tx2,#666)", cursor: "pointer" }}>
                          Break into sub-loans
                        </button>
                      </div>
                    )}

                    {/* Reduce-FIRE toggle: once this obligation ends, drop its
                        amount from the retirement-spending figure that drives
                        the FIRE target (the target steps down from that year).
                        Default ON; disabled/greyed when a manual retirement-
                        spending override is set, since the override is the
                        user's final word on retirement spend. */}
                    {(() => {
                      const on = reducesFire(ei);
                      const overridden = retirementSpendingOverride != null;
                      return (
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7, opacity: overridden ? 0.5 : 1 }}>
                          <button
                            onClick={() => updateEndingItem(ei.id, { reducesFire: !on })}
                            disabled={overridden}
                            title={overridden
                              ? "Disabled: a manual Retirement Spending override is set on the FIRE card, which takes precedence. Clear it to use per-obligation reductions."
                              : "When ON, the FIRE target drops once this obligation ends — you won't be funding this expense in retirement. When OFF, the target ignores that this expense goes away (conservative)."}
                            style={{
                              position: "relative", width: 32, height: 18, borderRadius: 9, border: "none",
                              background: on && !overridden ? "#27AE60" : "var(--bdr,#ccc)",
                              cursor: overridden ? "default" : "pointer", flexShrink: 0, transition: "background 0.15s", padding: 0,
                            }}
                          >
                            <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
                          </button>
                          <span style={{ fontSize: 10.5, color: "var(--tx2,#666)" }}>
                            Reduces FIRE target when it ends
                          </span>
                          <span
                            title={"Once this obligation's end date passes, its monthly amount (×12) is subtracted from your retirement spending, so the FIRE target steps down from that year forward.\n\nLeave ON for expenses you genuinely won't have in retirement (mortgage, car loan). Turn OFF if the spending continues in some other form."}
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 13, height: 13, borderRadius: "50%", background: "var(--tx3,#888)", color: "#fff", fontSize: 8.5, fontWeight: 700, cursor: "help", flexShrink: 0 }}
                          >?</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Remove button */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => {
                        if (!window.confirm("Remove this ending obligation?")) return;
                        removeEndingItem(ei.id);
                      }}
                      title="Remove this ending obligation"
                      style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc", padding: "2px 6px", lineHeight: 1 }}
                    >×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── One-time Events ──
          Discrete dated cash events on a single account. Distinct from
          Ending Obligations: those are recurring monthly redirects of
          freed budget cash. These are lump sums. */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>
              One-time Events
              {oneTimeEvents.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)" }}>
                  ({oneTimeEvents.length})
                </span>
              )}
            </h3>
            <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4, maxWidth: 580 }}>
              Dated lump-sum cash events on a specific account: a car purchase from cash, an inheritance, a 401(k) rollover. Type a <strong>negative</strong> amount for outflows (money out) or a positive amount for inflows. Events bypass contribution caps and can drive a balance negative — a warning appears in this section flagging which accounts went underwater. Negative balances stay flat (no fake interest accrues at the savings return rate); contributions pay them down dollar-for-dollar.
            </div>
          </div>
          <button
            onClick={addOneTimeEvent}
            disabled={accounts.length === 0}
            title={accounts.length === 0 ? "Add at least one forecast account first" : "Add a one-time event"}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              border: "none",
              borderRadius: 6,
              background: accounts.length === 0 ? "var(--input-bg,#f5f5f5)" : "#556FB5",
              color: accounts.length === 0 ? "var(--tx3,#aaa)" : "#fff",
              cursor: accounts.length === 0 ? "not-allowed" : "pointer",
            }}
          >+ Add</button>
        </div>

        {(resolvedOneTime.orphans.length > 0 || resolvedOneTime.inPast.length > 0 || resolvedOneTime.outOfHorizon.length > 0) && (
          <div style={{ padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#92400E", background: "rgba(243,156,18,0.12)", border: "1px solid rgba(243,156,18,0.35)", borderRadius: 6 }}>
            {resolvedOneTime.orphans.length > 0 && <div>⚠ {resolvedOneTime.orphans.length} event{resolvedOneTime.orphans.length === 1 ? "" : "s"} can't be applied (missing account or invalid date).</div>}
            {resolvedOneTime.inPast.length > 0 && <div>ℹ {resolvedOneTime.inPast.length} event{resolvedOneTime.inPast.length === 1 ? " is" : "s are"} in the past — not applied to the projection.</div>}
            {resolvedOneTime.outOfHorizon.length > 0 && <div>ℹ {resolvedOneTime.outOfHorizon.length} event{resolvedOneTime.outOfHorizon.length === 1 ? " is" : "s are"} beyond the forecast horizon — extend the horizon to include {resolvedOneTime.outOfHorizon.length === 1 ? "it" : "them"}.</div>}
          </div>
        )}

        {oneTimeEvents.length === 0 ? (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--tx3,#888)", fontStyle: "italic", textAlign: "center", background: "var(--input-bg,#fafafa)", borderRadius: 6, border: "1px dashed var(--bdr,#ddd)" }}>
            No one-time events configured. Click <strong>+ Add</strong> to model a planned cash event.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {oneTimeEvents.map(ev => {
              /* Per-row status — derived from the resolved arrays so the
                 row reflects what the math layer will actually do with it. */
              const inEvents = resolvedOneTime.events.some(e => e.id === ev.id);
              const inOrphans = resolvedOneTime.orphans.find(e => e.id === ev.id);
              const inPast = resolvedOneTime.inPast.some(e => e.id === ev.id);
              const outHz = resolvedOneTime.outOfHorizon.some(e => e.id === ev.id);
              let status = "Active";
              let statusColor = "#27AE60";
              if (inOrphans) {
                status = inOrphans.reason === "bad-date" ? "Bad date" : "No account";
                statusColor = "#C0392B";
              } else if (inPast) {
                status = "In past";
                statusColor = "#888";
              } else if (outHz) {
                status = "Past horizon";
                statusColor = "#888";
              } else if (!inEvents) {
                status = "Inactive";
                statusColor = "#888";
              }
              const fieldLabel = { fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3, display: "block" };
              const inputStyle = { fontSize: 12, padding: "5px 7px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", boxSizing: "border-box" };
              const endsObligations = endingItems.filter(ei => ei && (ei.effect ?? "ends") === "ends");
              const labelForEi = (ei) => {
                const refs = getItemRefs(ei);
                const names = refs.map(r => r.name).filter(Boolean);
                return names.length ? names.join(" + ") : "(unlinked obligation)";
              };
              /* How many OTHER events already point at this obligation.
                 Multiple lump-sum prepayments against the same loan over
                 the years is a real workflow (e.g. annual extra principal),
                 so we no longer BLOCK a second link — we just surface the
                 count so it's clear the loan already has paydowns attached.
                 The debt engine sums all linked lumps; the freed-cash /
                 payoff date come from the combined paydown. */
              const otherLinkCount = (eiId) => oneTimeEvents.filter(o => o.id !== ev.id && o.linkedEndingId === eiId).length;
              return (
                <div key={ev.id} style={{ border: "1px solid var(--bdr,#e6e6e6)", borderRadius: 8, padding: 10, background: "var(--input-bg,#fafafa)" }}>
                  {/* Fields flow with flex-wrap: they sit side by side when
                      there's width, and stack vertically when there isn't —
                      no horizontal scroll. Each field has a minWidth so it
                      wraps to the next line rather than shrinking illegibly. */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                    <div style={{ flex: "1 1 120px", minWidth: 120 }}>
                      <label style={fieldLabel}>Date</label>
                      <input
                        type="date"
                        value={ev.date || ""}
                        onChange={(e) => updateOneTimeEvent(ev.id, { date: e.target.value })}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: "2 1 160px", minWidth: 140 }}>
                      <label style={fieldLabel}>Label</label>
                      <input
                        type="text"
                        value={ev.label || ""}
                        onChange={(e) => updateOneTimeEvent(ev.id, { label: e.target.value })}
                        placeholder="e.g. car down payment"
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ flex: "1 1 120px", minWidth: 110 }}>
                      <label style={fieldLabel}>Amount</label>
                      {/* Native numeric input commits on every change (NI's
                          blur-only commit drops values on mobile). */}
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={ev.amount === 0 ? "" : ev.amount}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = raw === "" || raw === "-" ? 0 : Number(raw);
                          updateOneTimeEvent(ev.id, { amount: Number.isFinite(n) ? n : 0 });
                        }}
                        placeholder="$ amount"
                        style={{
                          ...inputStyle,
                          textAlign: "right",
                          /* Red for outflows (negative), green for inflows
                             (positive), neutral for empty/zero. Makes the
                             sign obvious at a glance.
                             WebkitTextFillColor is required: on WebKit/Blink
                             (Safari/Chrome), number inputs honor
                             -webkit-text-fill-color over `color`, so OS
                             dark-mode form styling was winning and forcing
                             white text. Setting both makes the color stick. */
                          ...(() => {
                            const n = Number(ev.amount);
                            const c = !Number.isFinite(n) || n === 0
                              ? inputStyle.color
                              : n < 0 ? "#C0392B" : "#1E8449";
                            return { color: c, WebkitTextFillColor: c, fontWeight: Number.isFinite(n) && n !== 0 ? 600 : 400 };
                          })(),
                        }}
                      />
                    </div>
                    <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                      <label style={fieldLabel}>Account</label>
                      <select
                        value={ev.accountId || ""}
                        onChange={(e) => updateOneTimeEvent(ev.id, { accountId: e.target.value })}
                        style={inputStyle}
                      >
                        <option value="">— pick —</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{deriveAccountName(a, p1Name, p2Name)}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: "1 1 150px", minWidth: 140 }}>
                      <label style={fieldLabel} title="Link to an ending obligation to set its end date from this event's date — the freed monthly payment starts right after the payoff.">Pays off</label>
                      {endsObligations.length === 0 ? (
                        <div style={{ fontSize: 11, color: "var(--tx3,#bbb)", fontStyle: "italic", padding: "6px 0" }}>no obligations yet</div>
                      ) : (
                        <select
                          value={ev.linkedEndingId || ""}
                          onChange={(e) => updateOneTimeEvent(ev.id, { linkedEndingId: e.target.value || undefined })}
                          style={inputStyle}
                        >
                          <option value="">— none —</option>
                          {endsObligations.map(ei => {
                            const n = otherLinkCount(ei.id);
                            return (
                              <option key={ei.id} value={ei.id}>
                                {labelForEi(ei)}{n > 0 ? ` (${n} other paydown${n > 1 ? "s" : ""})` : ""}
                              </option>
                            );
                          })}
                        </select>
                      )}
                    </div>
                    <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 10, paddingBottom: 2 }}>
                      <span style={{ fontSize: 11, color: statusColor, fontWeight: 600, whiteSpace: "nowrap" }}>{status}</span>
                      <button
                        onClick={() => removeOneTimeEvent(ev.id)}
                        title="Delete event"
                        style={{ padding: "4px 10px", fontSize: 13, fontWeight: 700, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--card-bg,#fff)", color: "#C0392B", cursor: "pointer" }}
                      >×</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Underwater warning — placed at the SOURCE of the problem (the
            One-time Events section, where the user just typed a negative
            amount) rather than far down under the year-by-year table.
            Surfaces immediately on entry of an event that drives any
            account below zero. */}
        {projection.underwaterWarnings && projection.underwaterWarnings.length > 0 && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#FBEAE7", border: "1px solid #E8B5A8", borderRadius: 6, fontSize: 12, color: "#6B2C1F" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              ⚠ {projection.underwaterWarnings.length} account{projection.underwaterWarnings.length === 1 ? "" : "s"} went underwater
            </div>
            <div style={{ fontSize: 11, marginBottom: 8, color: "#8A4A3F" }}>
              Negative balances stay flat in the projection (no fake interest at the savings return rate). Contributions reduce the debt dollar-for-dollar. If this account is underwater because of a planned debt, model the debt in <strong>Loans</strong> below and budget the monthly payment to keep this forecast accurate. Otherwise the plan needs adjustment: move the event later, scale it back, or fund it from another account.
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
              {projection.underwaterWarnings.map(w => {
                const acct = accounts.find(a => a.id === w.accountId);
                const label = (acct?.nickname || "").trim() || (acct ? `${acct.owner} ${acct.type}` : w.accountId);
                return (
                  <li key={w.accountId} style={{ marginBottom: 2 }}>
                    <strong>{label}</strong> — first underwater in year {w.firstNegativeYear}.
                    {w.endedNegative
                      ? <> Still <strong style={{ color: "#C0392B" }}>{fmt(Math.round(w.finalBalance))}</strong> short at end of {horizon}y horizon.</>
                      : <> Recovered to <strong style={{ color: "#2ECC71" }}>{fmt(Math.round(w.finalBalance))}</strong> by end of {horizon}y horizon.</>
                    }
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
                <div style={{ fontSize: 22, fontWeight: 800, color: p.nominal < 0 ? "#C0392B" : "var(--card-color,#222)", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(p.nominal))}</div>
                <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4 }}>Today's $: {fmt(Math.round(p.real))}</div>
                <div style={{ fontSize: 11, color: "var(--tx3,#888)" }}>Contributed (today's $): {fmt(Math.round(p.contributions))}</div>
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
              {(() => {
                const totalNom = poolSummary.reduce((s, p) => s + p.nominal, 0);
                return (
                  <div style={{ fontSize: 22, fontWeight: 800, color: totalNom < 0 ? "#C0392B" : "#2ECC71", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(totalNom))}</div>
                );
              })()}
              <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4 }}>Today's $: {fmt(Math.round(poolSummary.reduce((s, p) => s + p.real, 0)))}</div>
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
                    {/* Two-line target display: today's $ baseline (the
                        25× expenses number the user enters / sees on
                        the FIRE controls), plus the inflation-adjusted
                        nominal target the chart actually crosses in
                        year `yearsToFireAdv`. Without the second line
                        the box duplicates the headline pool-summary
                        card above; with it, the user can see how much
                        the FIRE goal has grown in nominal dollars by
                        the time they hit it. */}
                    <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>target today: {fmt(fireTarget)}</div>
                    <div style={{ fontSize: 10, color: "var(--tx3,#888)" }}>
                      target year {yearsToFireAdv.toFixed(1)}: {fmt(fireBaseTargetForYear(yearsToFireAdv) * Math.pow(1 + (Number(inflationPct) || 0) / 100, yearsToFireAdv))}
                    </div>
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
        /* Card grid layout: previously hardcoded `repeat(N, 1fr)` up to 6
           columns on desktop, which forced all cards into a single row
           regardless of viewport width — cards overflowed off-screen
           when content exceeded the shrunk column width.
           `auto-fit, minmax(180px, 1fr)` lets the browser decide how
           many columns fit at the current width, wrapping naturally to
           a second row when needed. 180px is the floor that keeps card
           text legible (typical content: 22px headline number + 11px
           subtitle lines). Mobile retains the explicit 2-col layout so
           cards don't shrink to one column on narrow phones. */
        const cols = mob ? "1fr 1fr" : `repeat(auto-fit, minmax(180px, 1fr))`;
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
                    /* Make every summary card the same visual height so the
                       row doesn't stagger when content varies (some cards
                       have 'X accounts', others don't; FI status has 2-3
                       lines depending on reachable vs not). 110px holds the
                       worst case (4 lines) without clipping; shorter cards
                       just have empty space at the bottom which reads
                       cleaner than the previous shifting. */
                    minHeight: 130,
                    display: "flex",
                  }}>
                  <Card style={{ flex: 1 }}>
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
            <button onClick={() => setShowChartLegend(v => !v)}
              title={showChartLegend ? "Hide the legend below the chart" : "Show the legend below the chart"}
              style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5, background: showChartLegend ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: showChartLegend ? "#fff" : "var(--tx2,#555)", cursor: "pointer", marginLeft: 4 }}>
              Legend
            </button>
          </div>
          <div style={{ width: "100%", height: mob ? 380 : 520 }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 28, right: 24, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#e0e0e0)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} label={{ value: "Years from now", position: "insideBottom", offset: -12, fontSize: 12, fill: "var(--tx3,#888)" }} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} width={80} />
                <Tooltip
                  contentStyle={{ background: "var(--card-bg,#fff)", border: "1px solid var(--bdr,#ddd)", borderRadius: 6, fontSize: 12 }}
                  /* Custom content (not formatter) — we need to:
                     1. Sort items top-down to match the visual stack
                        (was the old itemSorter's job).
                     2. Append a "Total" row + "Today's $" row at the
                        bottom. Recharts doesn't expose a hook for
                        injected rows from formatter, so we own the
                        whole render. The `total` and `totalReal` keys
                        already exist in chartData (see chartData memo)
                        — we read them from the payload's first item's
                        full `payload` object, not from the items list
                        itself (they're not declared as <Area>s, so they
                        wouldn't appear there even if we wanted them to). */
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const row = payload[0]?.payload || {};
                    // Sort items top-down: invert displayedAccounts order
                    // (first in displayedAccounts = bottom of stack), and
                    // park the FI threshold last.
                    const items = [...payload].sort((a, b) => {
                      if (a.dataKey === "fireThresh") return 1;
                      if (b.dataKey === "fireThresh") return -1;
                      const ai = displayedAccounts.findIndex(x => x.id === a.dataKey);
                      const bi = displayedAccounts.findIndex(x => x.id === b.dataKey);
                      return (bi >= 0 ? bi : 1e9) - (ai >= 0 ? ai : 1e9);
                    });
                    const labelFor = (k) => {
                      if (k === "fireThresh") return "FI target (year-y $)";
                      const a = accounts.find(x => x.id === k);
                      return a ? deriveAccountName(a, p1Name, p2Name) : k;
                    };
                    return (
                      <div style={{ background: "var(--card-bg,#fff)", border: "1px solid var(--bdr,#ddd)", borderRadius: 6, fontSize: 12, padding: "8px 10px", lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--tx,#222)" }}>{`Year ${label} (${baseYear + Number(label)})`}</div>
                        {items.map((it, idx) => (
                          <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, background: it.color || it.stroke || "#888", borderRadius: 2 }} />
                            <span style={{ color: "var(--tx2,#555)", flex: 1 }}>{labelFor(it.dataKey)}</span>
                            <span style={{ color: "var(--tx,#222)", fontVariantNumeric: "tabular-nums" }}>{fmt(it.value)}</span>
                          </div>
                        ))}
                        {/* Total rows — added because clicking through
                            the tooltip to read the sum was the annoying
                            part. Pull from chartData's `total` /
                            `totalReal` keys (defined in the chartData
                            memo above), not from summing items, so
                            rounding stays consistent with the cards.
                            Colors use --tx (theme primary text) not the
                            phantom --tx1 — there's no --tx1 in the theme
                            CSS so it was always falling back to #222
                            and rendering near-black on every theme, which
                            was illegible in dark mode. */}
                        {typeof row.total === "number" && (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--bdr,#e0e0e0)" }}>
                            <span style={{ display: "inline-block", width: 8, height: 8 }} />
                            <span style={{ color: "var(--tx,#222)", fontWeight: 700, flex: 1 }}>Total (future $)</span>
                            <span style={{ color: "var(--tx,#222)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(row.total)}</span>
                          </div>
                        )}
                        {typeof row.totalReal === "number" && (
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ display: "inline-block", width: 8, height: 8 }} />
                            <span style={{ color: "var(--tx2,#555)", flex: 1 }}>Total (today's $)</span>
                            <span style={{ color: "var(--tx2,#555)", fontVariantNumeric: "tabular-nums" }}>{fmt(row.totalReal)}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {showChartLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {/* Stack order follows the user's sort selection above (manual /
                    A-Z / by balance) so the chart's visual order matches the
                    account list. Recharts stacks first-declared at the bottom,
                    so the first row in displayedAccounts ends up on the bottom
                    of the stack and the last row on top. The tooltip's
                    itemSorter inverts this so the tooltip reads top-down. */}
                {displayedAccounts.map(a => (
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
                {/* One-time event ReferenceLines. Stroke color signals
                    direction: red for outflow (negative), green for
                    inflow (positive). Label shows truncated user label
                    + amount; full text is on hover via the data table
                    below the chart. We snap x to the integer year via
                    `monthIndexToChartYear` because Recharts v3 silently
                    drops ReferenceLines whose x is a fractional value
                    on a category axis — that was the "doesn't always
                    show on graph" bug. Snapping costs sub-year visual
                    precision but guarantees the marker renders. */}
                {resolvedOneTime.events.map(ev => {
                  const x = monthIndexToChartYear(ev.monthIndex);
                  const isInflow = ev.amount >= 0;
                  const color = isInflow ? "#27AE60" : "#C0392B";
                  const labelText = ev.label
                    ? `${ev.label} ${isInflow ? "+" : "−"}${fmtCompact(Math.abs(ev.amount))}`
                    : `${isInflow ? "+" : "−"}${fmtCompact(Math.abs(ev.amount))}`;
                  return (
                    <ReferenceLine
                      key={ev.id}
                      x={x}
                      stroke={color}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      label={{
                        value: labelText,
                        position: "insideTop",
                        dy: 6,
                        fill: color,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    />
                  );
                })}
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

      {/* Year-by-year table with per-account contribution columns.
          Columns (except the pinned Year column) are user-reorderable via
          drag-and-drop on the header; order persists per-device. */}
      {accounts.length > 0 && (() => {
        /* Build column descriptors. Each: { id, label, color, italic,
           cell(row) -> JSX/string, cellStyle(row) -> style }. Year is NOT
           here — it's rendered as a fixed first column. */
        /* "Debt Remaining" reflects real loan-mode ending OBLIGATIONS
           (the debts in your actual plan), driven by obligationDebtByYear
           — which honors lump-sum paydowns from linked payoff events. The
           standalone Loans-tab scratchpad (forecast.loans) is hypothetical
           and intentionally does NOT feed this column. */
        const hasDebt = Object.values(obligationDebtByYear.byYear).some(y => (y?.total || 0) > 0);
        const colDefs = {};
        const baseColIds = [];

        colDefs.total = {
          id: "total", label: "Total", color: "var(--tx3,#888)",
          cell: (row) => fmt(Math.round(row.totals.nominal)),
          cellStyle: () => ({ padding: 6, textAlign: "right", fontWeight: 700, color: "var(--card-color,#222)" }),
        };
        baseColIds.push("total");

        if (hasDebt) {
          colDefs.debt = {
            id: "debt", label: "Debt Remaining", color: "#C0392B",
            cell: (row) => {
              const d = obligationDebtByYear.byYear[row.year]?.total || 0;
              return d > 0 ? fmt(Math.round(d)) : "—";
            },
            cellStyle: (row) => {
              const d = obligationDebtByYear.byYear[row.year]?.total || 0;
              return { padding: 6, textAlign: "right", color: d > 0 ? "#C0392B" : "var(--tx3,#bbb)", fontWeight: d > 0 ? 600 : 400, fontSize: 11 };
            },
          };
          baseColIds.push("debt");
        }

        for (const a of accounts) {
          colDefs[a.id] = {
            id: a.id, label: deriveAccountName(a, p1Name, p2Name), color: accountColors[a.id],
            cell: (row) => fmt(Math.round(row.byAccount[a.id]?.nominal || 0)),
            cellStyle: (row) => {
              const series = projection.accountSeries[a.id]?.[row.year];
              const uw = series?.underwater;
              return { padding: 6, textAlign: "right", color: uw ? "#C0392B" : "var(--tx2,#555)", fontWeight: uw ? 600 : 400 };
            },
          };
          baseColIds.push(a.id);
        }
        for (const a of accounts) {
          const cid = a.id + "__c";
          colDefs[cid] = {
            id: cid, label: deriveAccountName(a, p1Name, p2Name) + " Contrib.", color: "var(--tx3,#aaa)", italic: true,
            cell: (row) => {
              if (row.year === 0) return "—";
              const c = row.byAccount[a.id]?.contribution || 0;
              const series = projection.accountSeries[a.id]?.[row.year];
              return fmt(Math.round(c)) + (series?.capped ? " ⚠" : "");
            },
            cellStyle: (row) => {
              const series = projection.accountSeries[a.id]?.[row.year];
              return { padding: 6, textAlign: "right", color: series?.capped ? "#E8573A" : "var(--tx3,#888)", fontStyle: "italic", fontSize: 11 };
            },
          };
          baseColIds.push(cid);
        }

        /* Resolve the render order: take the saved order, keep only ids
           that still exist, then append any new columns (in their natural
           baseColIds order) that aren't in the saved order yet. Empty/null
           saved order → natural order. */
        const saved = Array.isArray(colOrder) ? colOrder : [];
        const existing = new Set(baseColIds);
        const ordered = saved.filter(id => existing.has(id));
        const inOrder = new Set(ordered);
        for (const id of baseColIds) if (!inOrder.has(id)) ordered.push(id);

        const isCustom = saved.filter(id => existing.has(id)).length > 0
          && JSON.stringify(ordered) !== JSON.stringify(baseColIds);

        return (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Year-by-Year Breakdown</h3>
            <span style={{ fontSize: 11, color: "var(--tx3,#aaa)" }}>Drag column headers to reorder</span>
            {isCustom && (
              <button onClick={resetColOrder}
                title="Reset columns to default order"
                style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "var(--input-bg,#f5f5f5)", color: "var(--tx2,#555)", cursor: "pointer" }}>
                Reset order
              </button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--input-bg,#f8f8f8)" }}>
                  {/* Pinned Year column — not draggable */}
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Year</th>
                  {ordered.map(id => {
                    const def = colDefs[id];
                    if (!def) return null;
                    const isDragging = colDragId === id;
                    const isOver = colDragOverId === id;
                    return (
                      <th key={id}
                        draggable
                        onDragStart={onColDragStart(id)}
                        onDragOver={onColDragOver(id)}
                        onDragLeave={onColDragLeave}
                        onDrop={onColDrop(id, ordered)}
                        onDragEnd={onColDragEnd}
                        title="Drag to reorder this column"
                        style={{
                          padding: 8, textAlign: "right", fontWeight: 700, color: def.color,
                          borderBottom: "1px solid var(--bdr,#ddd)",
                          borderLeft: isOver ? "2px solid #556FB5" : "2px solid transparent",
                          whiteSpace: "nowrap", fontStyle: def.italic ? "italic" : "normal",
                          cursor: "grab", userSelect: "none",
                          opacity: isDragging ? 0.4 : 1,
                          background: isOver ? "rgba(85,111,181,0.08)" : "transparent",
                        }}>
                        <span style={{ color: "var(--tx3,#ccc)", marginRight: 4, fontWeight: 400 }}>⠿</span>{def.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {projection.years.map(row => (
                  <tr key={row.year} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                    <td style={{ padding: 6, fontWeight: 700, color: "var(--card-color,#222)" }}>{row.year} <span style={{ color: "var(--tx3,#aaa)", fontWeight: 400 }}>({row.calendarYear})</span></td>
                    {ordered.map(id => {
                      const def = colDefs[id];
                      if (!def) return null;
                      return <td key={id} style={def.cellStyle(row)}>{def.cell(row)}</td>;
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
        );
      })()}
    </div>
  );
}
