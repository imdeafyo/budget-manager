import { useMemo, useState, useEffect } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, Area, Line, ComposedChart, ReferenceLine } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { fmt, fmtCompact, evalF, forecastGrowthAccounts, yearsToHitPoolLimit, calcMatch, cashBudgetContribution, poolHeadroom, toWk } from "../utils/calc.js";
import { actualAnnualContribution } from "../utils/forecastActuals.js";
import { getPoolLimit, ACCOUNT_TYPE_TO_POOL, defaultForecastAccounts } from "../data/taxDB.js";
import { newEndingItemId, computeLoanEndsOn, resolveEndingEvents, findItemRefConflicts } from "../utils/endingItems.js";
import { newOneTimeEventId, resolveOneTimeEvents, monthIndexToChartYear } from "../utils/oneTimeEvents.js";

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
    // Adding an HSA account with no existing HSA in the forecast:
    // default coverage to self-only because the new account also defaults
    // to a single-person owner (p1). Family coverage only makes sense when
    // the HDHP itself is joint; we'd rather under-estimate the limit and
    // let the user opt up via the per-row Coverage dropdown.
    const isAddingHSA = type === "hsa_cash" || type === "hsa_invested" || type === "hsa";
    setForecast(prev => {
      const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
      const hasExistingHSA = prevAccounts.some(a => a.type === "hsa_cash" || a.type === "hsa_invested" || a.type === "hsa");
      const next = { ...prev, accounts: [...prevAccounts, newAcc] };
      if (isAddingHSA && !hasExistingHSA && !prev?.hsaCoverage) {
        next.hsaCoverage = "self-only";
      }
      return next;
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
      itemRef: null, // user picks via dropdown
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
     recurring redirects of freed cash flow. See utils/oneTimeEvents.js. */
  const oneTimeEvents = Array.isArray(forecast?.oneTimeEvents) ? forecast.oneTimeEvents : [];

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

  /* Build the linked-item dropdown options. Single dropdown grouped by
     section (Expenses then Savings) so the user picks "Mortgage P&I"
     without first picking a section. Items with $0 amounts are still
     listed — the user might be setting up an obligation for an item
     they're about to start funding. We mark itemRefs that are already
     consumed by another ending item so the dropdown can disable them
     (one-ending-per-item invariant — also enforced on save via
     findItemRefConflicts as a backstop). */
  const linkedItemOptions = useMemo(() => {
    const out = [];
    for (let idx = 0; idx < (Array.isArray(exp) ? exp.length : 0); idx++) {
      const e = exp[idx];
      if (!e) continue;
      out.push({ section: "exp", idx, name: e.n || `Expense ${idx + 1}`, key: `exp::${idx}` });
    }
    for (let idx = 0; idx < (Array.isArray(sav) ? sav.length : 0); idx++) {
      const s = sav[idx];
      if (!s) continue;
      out.push({ section: "sav", idx, name: s.n || `Savings ${idx + 1}`, key: `sav::${idx}` });
    }
    return out;
  }, [exp, sav]);

  /* Set of itemRef keys (section::idx) already claimed by an ending item.
     Each item maps to the ids that claim it, so we can keep the *current*
     row's own selection enabled even when it's "taken." */
  const claimedRefKeys = useMemo(() => {
    const m = new Map(); // key -> Set of ending-item ids
    for (const ei of endingItems) {
      if (!ei?.itemRef) continue;
      const k = `${ei.itemRef.section}::${ei.itemRef.idx}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(ei.id);
    }
    return m;
  }, [endingItems]);

  /* Look up the live monthly amount for a budget line by reference.
     Uses toWk to convert the item's value+period to weekly, then ×(48/12)
     to get a per-paycheck-monthly amount. budgetCompare's calendar-vs-
     paycheck wrinkle doesn't apply here — the math layer is running a
     monthly forecast based on budget intent, not reconciling against
     transactions. Returns null when the linked item is missing (e.g.
     renamed/deleted/reordered away). */
  const monthlyAmountFor = (ref) => {
    if (!ref || typeof ref.idx !== "number") return null;
    const arr = ref.section === "sav" ? sav : exp;
    if (!Array.isArray(arr)) return null;
    const item = arr[ref.idx];
    if (!item) return null;
    // Sanity check: if the user reordered items, the idx may point at a
    // different item now. We compare snapshot name as a soft check —
    // when the name doesn't match, we trust the idx still (most reorders
    // shift everything in lockstep) and surface the rename via the
    // dropdown display rather than failing. The orphan path catches the
    // hard case where idx is out of range entirely.
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
  const resolvedEnding = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    return resolveEndingEvents(endingItems, monthlyAmountFor, baseYearMonth, horizonMonths);
    // monthlyAmountFor closes over exp/sav, so list those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endingItems, exp, sav, baseYearMonth, horizon]);

  /* Resolve one-time events. resolveOneTimeEvents wants baseYearMonth as
     { year, month } (numeric), distinct from endingItems' "YYYY-MM" string
     shape. Recompute on event/horizon change — events depend only on their
     own date + the account list + horizon, not on budget content. */
  const resolvedOneTime = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    const [yStr, mStr] = baseYearMonth.split("-");
    const baseYM = { year: Number(yStr), month: Number(mStr) };
    return resolveOneTimeEvents(oneTimeEvents, accounts, baseYM, horizonMonths);
  }, [oneTimeEvents, accounts, baseYearMonth, horizon]);

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
       cleaner — needs a one-time migration to move existing snapshot data.
       Carrying this forward to a later phase per user request.

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
    if (a.type === "hsa_cash" && a.owner === "joint") return hsaTotalAnnual;
    if (a.type === "hsa_invested" && a.owner === "joint") return 0;
    if (a.type === "hsa" && a.owner === "joint") return hsaTotalAnnual;
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
     pure calc function. */
  const projAccounts = useMemo(
    () => accounts.map(a => ({ ...a, contribAmount: effectiveContribFor(a) })),
    // All inputs read by autoContribFor / effectiveContribFor must be listed
    // here, otherwise the projection silently goes stale when the user edits
    // an upstream value (IRA $ on Income tab, transactions for cash-actuals,
    // tSavW/remW for cash-budget source). C.net and C.eaipNet drive the
    // cash-budget variants; tExpW is the expense baseline.
    [accounts, cSalNum, kSalNum, c4preNum, c4roNum, k4preNum, k4roNum, cLump, kLump, cMatchAnnual, kMatchAnnual, hsaTotalAnnual, cIraTradNum, cIraRothNum, kIraTradNum, kIraRothNum, cashActualByAccount, tSavW, remW, tExpW, C?.net, C?.eaipNet]
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
          {/* FIRE controls grouped into a single visually-bound chunk:
              toggle + multiplier + target. Border + tinted background ties
              them together so they don't read as three independent items
              strung across the toolbar. Today's-$ check shows underneath
              when reachable so the user can sanity-check the future-$
              number. */}
          <span style={{ display: "inline-flex", flexDirection: "column", padding: fireEnabled ? "6px 10px" : "4px 8px", borderRadius: 8, background: fireEnabled ? "rgba(243,156,18,0.08)" : "transparent", border: fireEnabled ? "1px solid rgba(243,156,18,0.25)" : "1px solid transparent", gap: 3 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>FIRE:</span>
              <button onClick={() => setFireEnabled(!fireEnabled)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: fireEnabled ? "#F39C12" : "var(--input-bg,#f5f5f5)", color: fireEnabled ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Toggles FIRE mode in both Simple and Advanced views.">{fireEnabled ? "ON" : "OFF"}</button>
              {fireEnabled && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  title={"Multiplier × annual expenses = FI target.\n\n• 25× = 4% rule (~30yr retirement)\n• 28-33× = 3-3.5% rule (50+yr horizon)\n• 20× = 5% (aggressive)\n\nLowering = larger target = safer but takes longer."}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>×</span>
                  <input
                    type="text"
                    value={fireMultiplier}
                    onChange={e => setFireMultiplier(e.target.value)}
                    onBlur={e => {
                      const v = evalF(e.target.value);
                      if (!isFinite(v) || v <= 0) setFireMultiplier("25");
                      else setFireMultiplier(String(v));
                    }}
                    style={{ width: 50, padding: "3px 6px", fontSize: 12, fontWeight: 700, textAlign: "center", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)", fontFamily: "'DM Sans',sans-serif" }} />
                </span>
              )}
              {fireEnabled && fireTarget > 0 && (() => {
                const inflRate = (Number(inflationPct) || 0) / 100;
                const refYear = (yearsToFireAdv != null && yearsToFireAdv > 0) ? yearsToFireAdv : horizon;
                const futureTarget = fireTarget * Math.pow(1 + inflRate, refYear);
                const yearLabel = (yearsToFireAdv != null && yearsToFireAdv > 0)
                  ? `at FI (year ${refYear.toFixed(1)})`
                  : `at year ${horizon}`;
                return (
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}
                    title={`${fireMultiplierNum}× ${fmt(fireAnnualExpenses)}/yr today, inflated to year ${refYear.toFixed(1)}.\nTarget grows with inflation each year — that's the orange dashed line on the chart.`}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Target {yearLabel}:</span>
                    <strong style={{ fontSize: 17, fontWeight: 800, color: "#F39C12", fontFamily: "'Fraunces',serif" }}>{fmt(futureTarget)}</strong>
                  </span>
                );
              })()}
            </span>
            {/* Today's-$ check — shows the FI target in today's purchasing
                power as a stable cross-reference. Number changes very slowly
                (only when expenses or multiplier change), unlike the
                future-$ display which jumps with inflation/year. Helpful
                sanity check. */}
            {fireEnabled && fireTarget > 0 && (
              <span style={{ fontSize: 11, color: "var(--tx3,#888)", paddingLeft: 38 }}
                title="FI target in today's purchasing power. Does not depend on inflation rate. Useful as a stable check while you're tuning the future-$ number above.">
                Today's $: <strong style={{ color: "var(--tx2,#555)" }}>{fmt(fireTarget)}</strong>
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
                        // Flip hsaCoverage automatically so the IRS limit
                        // recalculates to the lower self-only ceiling.
                        // The user can override via the per-account
                        // Coverage dropdown below if their setup is
                        // unusual. Going joint → person is the common
                        // case we're catching here.
                        // Both the owner change and the optional coverage
                        // flip happen in a single functional setForecast so
                        // they atomically read+write the latest state — the
                        // earlier setTimeout(0) workaround was masking the
                        // stale-closure bug rather than fixing it.
                        setForecast(prev => {
                          const prevAccounts = Array.isArray(prev?.accounts) ? prev.accounts : [];
                          const nextAccounts = prevAccounts.map(x => x.id === a.id ? { ...x, owner: newOwner } : x);
                          const next = { ...prev, accounts: nextAccounts };
                          if (isHSA && a.owner === "joint" && newOwner !== "joint" && (prev?.hsaCoverage || "family") === "family") {
                            next.hsaCoverage = "self-only";
                          }
                          return next;
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
                          onChange={e => setForecast(prev => ({ ...prev, hsaCoverage: e.target.value }))}
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

        {endingItems.length === 0 ? (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--tx3,#888)", fontStyle: "italic", textAlign: "center", background: "var(--input-bg,#fafafa)", borderRadius: 6, border: "1px dashed var(--bdr,#ddd)" }}>
            No ending obligations configured. Click <strong>+ Add</strong> to model a finite expense or savings line.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {endingItems.map((ei) => {
              /* Per-row derived state — lots of small bits so we compute
                 them once at the top of the row for readability below. */
              const refKey = ei.itemRef ? `${ei.itemRef.section}::${ei.itemRef.idx}` : null;
              const linkedItem = ei.itemRef
                ? (ei.itemRef.section === "sav" ? sav[ei.itemRef.idx] : exp[ei.itemRef.idx])
                : null;
              const isOrphan = ei.itemRef && !linkedItem;
              const liveMonthly = monthlyAmountFor(ei.itemRef);
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
                 layer trusts (resolveEndingEvents reads ei.endsOn). */
              let loanResult = null;
              if (isLoanMode && liveMonthly != null) {
                loanResult = computeLoanEndsOn(ei.balance, ei.annualRate, liveMonthly, baseYearMonth);
              }

              const conflictsHere = endingItemConflicts.some(c => c.ids.includes(ei.id));

              return (
                <div key={ei.id} style={{
                  padding: 10,
                  border: `1px solid ${conflictsHere ? "rgba(232,87,58,0.5)" : isOrphan ? "rgba(232,87,58,0.5)" : "var(--bdr,#ddd)"}`,
                  borderRadius: 8,
                  background: "var(--card-bg,#fff)",
                  display: "grid",
                  gridTemplateColumns: mob ? "1fr" : "1.6fr 1fr 1.4fr auto",
                  gap: 10,
                  alignItems: "start",
                }}>
                  {/* Linked budget item */}
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Linked Budget Item</label>
                    <select
                      value={refKey || ""}
                      onChange={e => {
                        const v = e.target.value;
                        if (!v) {
                          updateEndingItem(ei.id, { itemRef: null });
                          return;
                        }
                        const opt = linkedItemOptions.find(o => o.key === v);
                        if (!opt) return;
                        updateEndingItem(ei.id, { itemRef: { section: opt.section, idx: opt.idx, name: opt.name } });
                      }}
                      style={{ width: "100%", padding: 6, fontSize: 12, border: `1px solid ${isOrphan ? "#E8573A" : "var(--bdr,#ddd)"}`, borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}
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
                    {/* Live monthly + status hints */}
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--tx3,#888)" }}>
                      {isOrphan ? (
                        <span style={{ color: "#E8573A", fontWeight: 600 }}>
                          ⚠ Linked item missing (was "{ei.itemRef?.name || "?"}")
                        </span>
                      ) : liveMonthly == null ? (
                        <span style={{ fontStyle: "italic" }}>Pick a budget line above</span>
                      ) : liveMonthly === 0 ? (
                        <span style={{ color: "#E8573A" }}>Item amount is $0 — set a value on the Budget tab</span>
                      ) : (
                        <span>Currently: <strong style={{ color: "var(--card-color,#222)" }}>{fmt(liveMonthly)}/mo</strong></span>
                      )}
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
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 2 }}>Balance</label>
                          <NI
                            value={String(ei.balance ?? 0)}
                            onChange={v => {
                              const num = evalF(v);
                              const patch = { balance: num };
                              /* Recompute endsOn live so the math layer
                                 sees the new payoff date without a save
                                 step. We only update when the result is
                                 valid; invalid (zero-payment, neg-am)
                                 leaves the old endsOn alone and the UI
                                 shows the error below. */
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
                                const r = computeLoanEndsOn(ei.balance, num, liveMonthly, baseYearMonth);
                                if (r.ok) patch.endsOn = r.endsOn;
                              }
                              updateEndingItem(ei.id, patch);
                            }}
                            onBlurResolve
                          />
                        </div>
                      </div>
                    )}
                    {/* Computed-endsOn display for loan mode */}
                    {ei.mode === "loan" && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--tx3,#888)" }}>
                        {loanResult?.ok ? (
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
                      </div>
                    )}
                  </div>

                  {/* Destination account */}
                  <div>
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
                    {/* Status hints under destination */}
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
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--input-bg,#f8f8f8)" }}>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Date</th>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)" }}>Label</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Amount</th>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)" }}>Account</th>
                  <th style={{ padding: 8, textAlign: "center", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Status</th>
                  <th style={{ padding: 8, textAlign: "center", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}></th>
                </tr>
              </thead>
              <tbody>
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
                    /* Catch-all — shouldn't happen but defensive */
                    status = "Inactive";
                    statusColor = "#888";
                  }
                  return (
                    <tr key={ev.id} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                      <td style={{ padding: 6 }}>
                        <input
                          type="date"
                          value={ev.date || ""}
                          onChange={(e) => updateOneTimeEvent(ev.id, { date: e.target.value })}
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: 140 }}
                        />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input
                          type="text"
                          value={ev.label || ""}
                          onChange={(e) => updateOneTimeEvent(ev.id, { label: e.target.value })}
                          placeholder="e.g. car down payment"
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 140 }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {/* Native numeric input, commits on every change.
                            We deliberately don't use the shared NI here:
                            NI only commits on blur, and mobile browsers
                            (iOS Safari especially) don't always fire blur
                            when the user dismisses the keyboard or taps a
                            non-input area. That caused the entered amount
                            to silently stay at 0 in state — "doesn't seem
                            to change FIRE" symptom. inputMode="decimal"
                            also gets the numeric keyboard on mobile. */}
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
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: 130, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ padding: 6 }}>
                        <select
                          value={ev.accountId || ""}
                          onChange={(e) => updateOneTimeEvent(ev.id, { accountId: e.target.value })}
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", minWidth: 140 }}
                        >
                          <option value="">— pick —</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>{deriveAccountName(a, p1Name, p2Name)}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6, textAlign: "center", fontSize: 11, color: statusColor, fontWeight: 600 }}>
                        {status}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <button
                          onClick={() => removeOneTimeEvent(ev.id)}
                          title="Delete event"
                          style={{ padding: "2px 8px", fontSize: 12, fontWeight: 700, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "#C0392B", cursor: "pointer" }}
                        >×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
              Negative balances stay flat in the projection (no fake interest at the savings return rate). Contributions reduce the debt dollar-for-dollar. The plan needs adjustment — move the event later, scale it back, or fund it from another account.
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
                      target year {yearsToFireAdv.toFixed(1)}: {fmt(fireTarget * Math.pow(1 + (Number(inflationPct) || 0) / 100, yearsToFireAdv))}
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
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#e0e0e0)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} label={{ value: "Years from now", position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--tx3,#888)" }} />
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
                        position: "top",
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
                    {accounts.map(a => {
                      const series = projection.accountSeries[a.id]?.[row.year];
                      const isUnderwater = series?.underwater;
                      return (
                        <td key={a.id} style={{ padding: 6, textAlign: "right", color: isUnderwater ? "#C0392B" : "var(--tx2,#555)", fontWeight: isUnderwater ? 600 : 400 }}>
                          {fmt(Math.round(row.byAccount[a.id]?.nominal || 0))}
                        </td>
                      );
                    })}
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
