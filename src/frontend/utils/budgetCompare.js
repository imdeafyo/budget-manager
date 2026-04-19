/* ══════════════════════════ Budget comparison — pure helpers ══════════════════════════
   Phase 6a. Turns three things —
     1. Your weekly-denominated budget (exp[] + sav[] line items, stored as 48-
        paycheck weekly equivalents via toWk)
     2. Your category lists (cats, savCats, transferCats)
     3. A transaction list + a date range
   — into a per-category "budgeted vs actual" view that the bar chart and the
   summary cards consume.

   All functions are pure. No React, no state — just data in, data out. Wiring
   into the TransactionsTab happens in the component; the math lives here so
   Phase 6b (line chart, outliers, drill-down) can reuse the same aggregator.

   ── Weekly vs calendar — the conversion problem ──
   The app's budget is denominated in 48 paychecks per year (see toWk). A
   weeklyBudget of $150 means "$150 × 48 = $7,200/yr" — NOT "$150 × 52 = $7,800".
   Transactions, by contrast, are calendar dates. To compare apples-to-apples
   for an October 2026 chart we need a conversion:

     basis = 48  → spend target for a period = weeklyBudget × (days / 7) × (48/52)
                    = weeklyBudget × days / 7.583
                    ≈ weeklyBudget × 4.0 for a 30.4-day month
                    (matches "I budgeted $600/mo for groceries" because
                     $150/wk × 48 ÷ 12 = $600)

     basis = 52  → spend target = weeklyBudget × (days / 7)
                    ≈ weeklyBudget × 4.333 for a 30.4-day month
                    (spreads the 48-paycheck budget across all 52 calendar
                     weeks — the 4 "extra" paychecks become buffer that
                     gets dripped into every monthly target)

   48 is the default because it matches the mental model. Toggling to 52 shows
   the calendar-spread view for people who prefer comparing "did I spend 1/52
   of my annual each week."

   Formula unified:   periodBudget = weeklyBudget × (days / 7) × (basis / 52)

   For a month, days ≈ 30.44:
     basis 48 → × 4.01 ≈ "monthly budget as you entered it"
     basis 52 → × 4.35 ≈ "monthly target if spread across 52 calendar weeks"

   For YTD on April 18: days = 108 → basis 48 → × 14.23, basis 52 → × 15.43
*/

import { toWk } from "./calc.js";
import { netCategorySpend, refundTotals } from "./refunds.js";
import { isMarkedTransfer } from "./transfers.js";
import { categoryContribution } from "./splits.js";

export const UNCATEGORIZED = "__uncategorized__"; // sentinel key for unmatched tx

/* ── Date helpers ──
   Work in ISO yyyy-mm-dd strings to match transaction.date format and avoid
   TZ drift. All comparisons are string lexicographic, which is correct for ISO. */

/* Number of whole days in the [fromIso, toIso] range, inclusive.
   Returns 1 for same-day ranges, 0 if `to` precedes `from`. */
export function daysInRange(fromIso, toIso) {
  if (!fromIso || !toIso) return 0;
  const f = new Date(fromIso + "T00:00:00Z");
  const t = new Date(toIso   + "T00:00:00Z");
  if (isNaN(f) || isNaN(t)) return 0;
  const diff = Math.round((t - f) / 86_400_000);
  return diff < 0 ? 0 : diff + 1;
}

/* Days remaining in the period relative to `today` (also ISO).
   Returns 0 if today is past the end, max(days) if before the start. */
export function daysRemaining(fromIso, toIso, todayIso) {
  if (!toIso) return 0;
  const total = daysInRange(fromIso, toIso);
  if (!total) return 0;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  if (today < fromIso) return total;
  if (today > toIso)   return 0;
  return daysInRange(today, toIso);
}

/* Days elapsed in the period relative to `today`.
   Used for the "projected end-of-period spend" math: if we're 15/30 days in
   and spent $300, projection is $600. */
export function daysElapsed(fromIso, toIso, todayIso) {
  if (!fromIso) return 0;
  const total = daysInRange(fromIso, toIso);
  if (!total) return 0;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  if (today < fromIso) return 0;
  if (today > toIso)   return total;
  return daysInRange(fromIso, today);
}

/* ── Budget conversion ──
   Convert an exp[] or sav[] item's weekly budget to the equivalent target for
   a date range, given a basis (48 or 52). */
export function itemWeeklyBudget(item) {
  if (!item) return 0;
  const wk = toWk(item.v, item.p);
  return isFinite(wk) ? wk : 0;
}

/* ── Snapshot-aware budget selection ──
   Given the live budget, a list of snapshots, and an ISO date, return the
   budget array that was "in effect" on that date. Rules:
     • Sort snapshots ascending by date. A snapshot is "eligible" if it either
       has a `fullState.exp` array (newer shape) or an `items` dict (legacy
       shape) — we reconstruct a live-shape array from `items` for legacy rows.
     • If `date` is on or after a snapshot's date, carry that snapshot's budget
       forward. The latest snapshot ≤ date wins (the one "last set before").
     • If `date` predates the earliest snapshot, carry that earliest snapshot
       backward (symmetric with carry-forward — we'd rather guess with what we
       do have than show zero budget).
     • If no snapshots are eligible at all, fall back to the live budget. This
       is also the behavior for callers that pass no snapshots.
   Returns the `liveExp` array unchanged (same reference) when falling back,
   so callers can cheaply detect "nothing changed". */
export function pickBudgetForDate(liveExp, snapshots, iso) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return liveExp;
  // Eligible = has any usable budget shape. Attach a `.exp` alias (normalized
  // to live-shape) so downstream code doesn't branch on the two variants.
  const eligible = [];
  for (const s of snapshots) {
    if (!s || !s.date) continue;
    const fsExp = s?.fullState?.exp;
    if (Array.isArray(fsExp) && fsExp.length > 0) {
      eligible.push({ date: s.date, exp: fsExp });
      continue;
    }
    // Legacy shape — reconstruct from items. items[x].v is stored as
    // monthly × 12 (= weekly × 48). Dividing by 12 recovers the monthly value,
    // which together with p:"m" matches the live exp shape used elsewhere.
    // Savings items (t === "S") are skipped — they belong to `sav`, not `exp`.
    const items = s?.items;
    if (items && typeof items === "object") {
      const reconstructed = [];
      for (const [name, data] of Object.entries(items)) {
        if (!data || data.t === "S") continue;
        const monthly = Math.round(((Number(data.v) || 0) / 12) * 100) / 100;
        reconstructed.push({
          n: name,
          c: data.c || "General",
          t: data.t || "N",
          v: String(monthly),
          p: "m",
        });
      }
      if (reconstructed.length > 0) {
        eligible.push({ date: s.date, exp: reconstructed });
      }
    }
  }
  if (eligible.length === 0) return liveExp;
  eligible.sort((a, b) => a.date.localeCompare(b.date));
  if (!iso) return liveExp;

  // Latest snapshot on or before the date
  let chosen = null;
  for (const s of eligible) {
    if (s.date <= iso) chosen = s;
    else break;
  }
  // Before earliest snapshot → carry earliest backward
  if (!chosen) chosen = eligible[0];
  return chosen.exp;
}

export function weeklyToPeriod(weeklyBudget, days, basis = 48) {
  if (!isFinite(weeklyBudget) || !isFinite(days) || days <= 0) return 0;
  const b = basis === 52 ? 52 : 48; // guard
  return weeklyBudget * (days / 7) * (b / 52);
}

/* Aggregate a budget array (exp or sav) into a Map<category, periodBudget>.
   Line items sharing a category are summed. */
export function budgetByCategory(items, days, basis = 48) {
  const out = new Map();
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    const cat = (it?.c || "").trim();
    if (!cat) continue;
    const wk = itemWeeklyBudget(it);
    const periodAmt = weeklyToPeriod(wk, days, basis);
    out.set(cat, (out.get(cat) || 0) + periodAmt);
  }
  // Round to cents to keep display math stable
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100);
  return out;
}

/* ── Transaction filtering ──
   Date-range filter that's budget-aware: transfer rows are excluded (they're
   not spending), and we carry through the split-aware contribution logic by
   delegating to netCategorySpend / categoryContribution downstream. */
export function filterByDateRange(transactions, fromIso, toIso) {
  if (!Array.isArray(transactions)) return [];
  if (!fromIso && !toIso) return transactions.slice();
  return transactions.filter(tx => {
    const d = tx?.date || "";
    if (!d) return false;
    if (fromIso && d < fromIso) return false;
    if (toIso   && d > toIso)   return false;
    return true;
  });
}

/* ── Actuals per category ──
   Two buckets: expense spend (uses refund netting) and savings contributions.
   Transfers are excluded in both. Uncategorized transactions are collected
   under the UNCATEGORIZED sentinel so the chart can show them as their own
   bar with no paired budget target. */
export function actualsByCategory(transactions, opts = {}) {
  const {
    expenseCategorySet,          // Set<string>
    savingsCategorySet,          // Set<string>
    treatRefundsAsNetting = true,
  } = opts;

  const expSet = expenseCategorySet instanceof Set ? expenseCategorySet : new Set();
  const savSet = savingsCategorySet instanceof Set ? savingsCategorySet : new Set();

  // Expense actuals via the refund-aware aggregator. Returns positive spend $.
  const expActual = netCategorySpend(transactions, {
    expenseCategorySet: expSet,
    treatRefundsAsNetting,
    clampNegativeToZero: true,
    excludeTransfers: true,
  });

  // Savings actuals: sum positive-direction contributions per savings category.
  // We don't want refund netting here — a savings deposit is a deposit.
  const savActual = new Map();
  const uncategorized = { count: 0, total: 0 };

  for (const tx of transactions || []) {
    if (!tx || isMarkedTransfer(tx)) continue;
    const contrib = categoryContribution(tx);
    if (contrib.size === 0) {
      // No category at all — whole row is uncategorized.
      const amt = Math.abs(Number(tx.amount) || 0);
      if (amt > 0) {
        uncategorized.count += 1;
        uncategorized.total += amt;
      }
      continue;
    }
    for (const [cat, amt] of contrib) {
      if (savSet.has(cat)) {
        // Savings: only count money going IN to the bucket (positive side of
        // contribution). Withdrawals from savings are handled by the budget
        // tab, not tracked here as negative "spend."
        const n = Number(amt) || 0;
        if (n > 0) {
          savActual.set(cat, round2((savActual.get(cat) || 0) + n));
        }
      } else if (!expSet.has(cat)) {
        // Category exists on the row but isn't in expense OR savings sets.
        // That means it was deleted from the budget but lingered on a tx.
        // Show it as uncategorized so the user sees something's off.
        const n = Math.abs(Number(amt) || 0);
        if (n > 0) {
          uncategorized.count += 1; // count per-contribution, not per-row
          uncategorized.total += n;
        }
      }
      // else: expense category — already handled by netCategorySpend above
    }
  }

  return {
    expense: expActual,
    savings: savActual,
    uncategorized: {
      count: uncategorized.count,
      total: round2(uncategorized.total),
    },
  };
}

/* ── The main aggregator ──
   Given the period, category sets, budget arrays, and transactions, produce
   everything the chart + cards need in one pass.
   `incomeCats` (if provided) identifies categories representing money coming in
   (paychecks, interest, dividends, gifts). Rows in those categories are excluded
   from spending and savings totals the same way transfer rows are, so they
   don't distort budget comparisons. */
export function compareBudgetToActual(opts) {
  const {
    transactions = [],
    exp = [],                 // expense budget line items
    sav = [],                 // savings budget line items
    cats = [],                // string[] of expense category names
    savCats = [],             // string[] of savings category names
    transferCats = [],        // string[] of transfer-only category names (excluded)
    incomeCats = [],          // string[] of income-only category names (excluded)
    snapshots = [],           // optional — enables per-era historical budgets
    fromIso,
    toIso,
    todayIso,
    basis = 48,
    treatRefundsAsNetting = true,
  } = opts || {};

  const days = daysInRange(fromIso, toIso);
  const elapsed = daysElapsed(fromIso, toIso, todayIso);
  const remaining = daysRemaining(fromIso, toIso, todayIso);

  const expSet = new Set(cats);
  const savSet = new Set(savCats);
  const xferSet = new Set(transferCats);
  const incSet = new Set(incomeCats);

  // Per-category period budgets. When snapshots are supplied, the range may
  // span multiple budget "eras" (live vs. one or more historical snapshots),
  // so we accumulate each era's contribution separately and sum per category.
  // When no snapshots are supplied, this reduces to the original single-era
  // budgetByCategory(exp, days, basis) call.
  const expBudget = eraAwareBudget(exp, snapshots, fromIso, toIso, basis);
  const savBudget = budgetByCategory(sav, days, basis);

  // Filter transactions to range + drop transfer-category rows up front (belt
  // and suspenders with the refunds module's own exclusion). Income-category
  // rows are dropped here too — they're money coming in, not spending.
  const inRange = filterByDateRange(transactions, fromIso, toIso).filter(tx => {
    if (!tx) return false;
    if (isMarkedTransfer(tx)) return false;
    // A row's primary category being a transfer-only category = skip
    if (tx.category && xferSet.has(tx.category)) return false;
    // Income categories are excluded from spending/savings comparison
    if (tx.category && incSet.has(tx.category)) return false;
    return true;
  });

  const actuals = actualsByCategory(inRange, {
    expenseCategorySet: expSet,
    savingsCategorySet: savSet,
    treatRefundsAsNetting,
  });

  // Refund totals for the "X refunded" badge under each expense bar
  const refunds = refundTotals(inRange, {
    expenseCategorySet: expSet,
    excludeTransfers: true,
  });

  // Merge into row structures keyed by category for the chart
  const expRows = [];
  const allExpCats = new Set([...expBudget.keys(), ...actuals.expense.keys()]);
  for (const c of allExpCats) {
    const budgeted = expBudget.get(c) || 0;
    const actual   = actuals.expense.get(c) || 0;
    const refunded = refunds.get(c) || 0;
    expRows.push({
      category: c,
      kind: "expense",
      budgeted: round2(budgeted),
      actual:   round2(actual),
      refunded: round2(refunded),
      delta:    round2(actual - budgeted),
      over:     actual > budgeted + 0.005,
      pct:      budgeted > 0 ? actual / budgeted : (actual > 0 ? Infinity : 0),
    });
  }
  expRows.sort((a, b) => b.actual - a.actual);

  const savRows = [];
  const allSavCats = new Set([...savBudget.keys(), ...actuals.savings.keys()]);
  for (const c of allSavCats) {
    const budgeted = savBudget.get(c) || 0;
    const actual   = actuals.savings.get(c) || 0;
    // For savings, "over budget" (= saved more than planned) is a *good* thing
    // — we still surface it but don't color it red in the UI.
    savRows.push({
      category: c,
      kind: "savings",
      budgeted: round2(budgeted),
      actual:   round2(actual),
      refunded: 0,
      delta:    round2(actual - budgeted),
      over:     actual > budgeted + 0.005,
      pct:      budgeted > 0 ? actual / budgeted : (actual > 0 ? Infinity : 0),
    });
  }
  savRows.sort((a, b) => b.actual - a.actual);

  // Uncategorized row (expense-side visualization only — no paired budget)
  const uncatRow = actuals.uncategorized.total > 0 ? {
    category: UNCATEGORIZED,
    kind: "uncategorized",
    budgeted: 0,
    actual:   round2(actuals.uncategorized.total),
    refunded: 0,
    delta:    round2(actuals.uncategorized.total),
    over:     false,
    pct:      Infinity,
    count:    actuals.uncategorized.count,
  } : null;

  // Summary totals
  const totalExpBudget = sum(expRows.map(r => r.budgeted));
  const totalExpActual = sum(expRows.map(r => r.actual));
  const totalSavBudget = sum(savRows.map(r => r.budgeted));
  const totalSavActual = sum(savRows.map(r => r.actual));

  // Projected end-of-period spend, expense side only.
  // If we're 15 days into a 30-day period with $300 spent, project $600.
  // If the period is entirely in the past or future, projection = actual.
  let projectedExpense = totalExpActual;
  if (days > 0 && elapsed > 0 && elapsed < days) {
    projectedExpense = round2(totalExpActual * (days / elapsed));
  }

  return {
    period: {
      fromIso, toIso, todayIso,
      days, elapsed, remaining,
      basis,
    },
    expense: {
      rows: expRows,
      totalBudget: round2(totalExpBudget),
      totalActual: round2(totalExpActual),
      totalRefunds: round2(sum(expRows.map(r => r.refunded))),
      pctUsed: totalExpBudget > 0 ? totalExpActual / totalExpBudget : (totalExpActual > 0 ? Infinity : 0),
      projected: projectedExpense,
      projectedOver: projectedExpense > totalExpBudget + 0.005,
    },
    savings: {
      rows: savRows,
      totalBudget: round2(totalSavBudget),
      totalActual: round2(totalSavActual),
      pctUsed: totalSavBudget > 0 ? totalSavActual / totalSavBudget : (totalSavActual > 0 ? Infinity : 0),
    },
    uncategorized: uncatRow,
  };
}

/* ── Monthly bucketing for the trends line chart ──
   Produces one row per calendar month that overlaps [fromIso, toIso]. For each
   bucket we compute:
     - actual: expense spend in that month (refund-netted, transfer-excluded,
       income-cat-excluded — same filter the bar chart uses, so the two views
       stay honest to each other).
     - budgeted: the sum of weekly budgets for the matching scope, scaled by the
       bucket's day count and the caller's basis (48 / 52).
   Optionally filters to a single category; when `category` is null/undefined,
   aggregates across all expense categories ("all spending vs. all budgeted").
   The returned rows are safe to feed to Recharts as-is. */
export function monthlyBuckets(opts) {
  const {
    transactions = [],
    exp = [],
    cats = [],                // expense category names
    savCats = [],             // reserved; we don't plot savings on this chart yet
    transferCats = [],
    incomeCats = [],
    fromIso,
    toIso,
    basis = 48,
    category = null,          // null = all; otherwise single expense category name
    snapshots = [],           // optional — enables per-era historical budgets
    treatRefundsAsNetting = true,
  } = opts || {};

  if (!fromIso || !toIso) return [];

  const expSet  = new Set(cats);
  const xferSet = new Set(transferCats);
  const incSet  = new Set(incomeCats);

  // If a specific category was picked, narrow the expense set so
  // actualsByCategory only attributes spend to that one.
  const scopedExpSet = category ? new Set([category]) : expSet;

  // Same top-level row filter as the bar chart: drop transfers + income rows.
  const scopedRows = (transactions || []).filter(tx => {
    if (!tx) return false;
    if (isMarkedTransfer(tx)) return false;
    if (tx.category && xferSet.has(tx.category)) return false;
    if (tx.category && incSet.has(tx.category)) return false;
    return true;
  });

  // Enumerate calendar months from fromIso's month start to toIso's month end.
  // Using UTC to keep the math TZ-stable (matches daysInRange's convention).
  const start = new Date(fromIso + "T00:00:00Z");
  const end   = new Date(toIso   + "T00:00:00Z");
  if (isNaN(start) || isNaN(end) || end < start) return [];

  const buckets = [];
  // Walk month-by-month. first = first day of fromIso's month.
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth(); // 0-11
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();

  // Clip the first bucket's start to the user's fromIso (so partial first
  // months show only the days actually in range). Same for the last bucket's
  // end with toIso. This matches what users expect when picking e.g. "Apr 15
  // → Jun 30": April should be 16 days, May a full month, June 30 days.
  while (y < endY || (y === endY && m <= endM)) {
    const monthFirst = new Date(Date.UTC(y, m, 1));
    const monthLast  = new Date(Date.UTC(y, m + 1, 0)); // last day of month
    const bucketFromDate = monthFirst < start ? start : monthFirst;
    const bucketToDate   = monthLast  > end   ? end   : monthLast;
    const bucketFromIso  = bucketFromDate.toISOString().slice(0, 10);
    const bucketToIso    = bucketToDate.toISOString().slice(0, 10);
    const days = daysInRange(bucketFromIso, bucketToIso);

    // Transactions inside this bucket (reuses the same string comparison the
    // main aggregator uses).
    const inBucket = filterByDateRange(scopedRows, bucketFromIso, bucketToIso);

    // Actual via the shared aggregator so refund-netting + split attribution
    // match the bar chart exactly.
    const actuals = actualsByCategory(inBucket, {
      expenseCategorySet: scopedExpSet,
      savingsCategorySet: new Set(savCats),
      treatRefundsAsNetting,
    });

    // Sum across whichever categories are in scope (one or all).
    let actual = 0;
    for (const [, amt] of actuals.expense) actual += amt;
    // If category is null, we also want uncategorized rolled in for the "all"
    // view since they're real spend that didn't make it into a named bucket.
    // When a specific category is picked, uncategorized doesn't apply.
    if (!category && actuals.uncategorized) actual += actuals.uncategorized.total;

    // Budget for this bucket: weeklyToPeriod scaled to this month's days.
    // Snapshot-aware: select whichever exp was "in effect" at the bucket's
    // start. When no snapshots are provided (or none carry fullState.exp),
    // this returns `exp` unchanged, preserving previous behavior.
    const bucketExp = pickBudgetForDate(exp, snapshots, bucketFromIso);
    let budgeted = 0;
    if (category) {
      // Budget for just the picked category. Sum all line items with that cat.
      const filtered = (bucketExp || []).filter(it => (it?.c || "").trim() === category);
      const byCat = budgetByCategory(filtered, days, basis);
      budgeted = byCat.get(category) || 0;
    } else {
      // Total budget across all expense categories.
      const byCat = budgetByCategory(bucketExp, days, basis);
      for (const [, v] of byCat) budgeted += v;
    }

    buckets.push({
      monthLabel: monthFirst.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      monthStart: bucketFromIso,
      monthEnd:   bucketToIso,
      days,
      actual: round2(actual),
      budgeted: round2(budgeted),
    });

    // advance to next month
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }

  return buckets;
}

/* ── Internal helpers ── */

/* Sum budget contributions across whichever snapshot "eras" intersect the
   [fromIso, toIso] range. Splits the range at each snapshot date where a
   different budget takes effect, and for each sub-range uses the budget that
   pickBudgetForDate selects (carry-forward from nearest-on-or-before, with
   carry-backward for pre-earliest). When no snapshots are supplied (or none
   are eligible), this reduces to one call to budgetByCategory over the full
   range. */
function eraAwareBudget(liveExp, snapshots, fromIso, toIso, basis) {
  const totalDays = daysInRange(fromIso, toIso);
  if (!totalDays) return new Map();

  // Collect snapshot dates that could mark era boundaries. A snapshot is a
  // boundary if pickBudgetForDate would select a different budget for dates
  // ≥ its date versus just before. We simplify by treating any snapshot with
  // either fullState.exp or a non-trivial items dict as a potential boundary.
  const eligibleDates = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => {
      if (!s || !s.date) return false;
      if (Array.isArray(s?.fullState?.exp) && s.fullState.exp.length > 0) return true;
      if (s?.items && typeof s.items === "object") {
        for (const v of Object.values(s.items)) {
          if (v && v.t !== "S") return true;
        }
      }
      return false;
    })
    .map(s => s.date)
    .sort((a, b) => a.localeCompare(b));

  // No eligible snapshots → single era, full range, live budget.
  if (eligibleDates.length === 0) {
    return budgetByCategory(liveExp, totalDays, basis);
  }

  // Determine era boundaries inside [fromIso, toIso]. A new era starts on each
  // eligible snapshot date that falls strictly after fromIso.
  const cutoffs = [fromIso];
  for (const d of eligibleDates) {
    if (d > fromIso && d <= toIso) cutoffs.push(d);
  }
  // Build [start, end] pairs for each era; end is the day before next cutoff
  // (or toIso for the last pair).
  const eras = [];
  for (let i = 0; i < cutoffs.length; i++) {
    const startIso = cutoffs[i];
    const endIso = i + 1 < cutoffs.length
      ? isoDayBefore(cutoffs[i + 1])
      : toIso;
    if (!startIso || !endIso || startIso > endIso) continue;
    eras.push({ startIso, endIso });
  }

  // Sum era-by-era into a single category → amount map.
  const out = new Map();
  for (const era of eras) {
    const eraDays = daysInRange(era.startIso, era.endIso);
    if (!eraDays) continue;
    const eraExp = pickBudgetForDate(liveExp, snapshots, era.startIso);
    const partial = budgetByCategory(eraExp, eraDays, basis);
    for (const [c, v] of partial) {
      out.set(c, (out.get(c) || 0) + v);
    }
  }
  // Round to cents to match single-era behavior
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100);
  return out;
}

/* Given an ISO yyyy-mm-dd, return the ISO for the day before. Used to form
   inclusive [start, end] ranges from a cutoff list. UTC-safe. */
function isoDayBefore(iso) {
  if (!iso) return iso;
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d)) return iso;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function sum(arr)  { let s = 0; for (const x of arr) s += Number(x) || 0; return s; }
