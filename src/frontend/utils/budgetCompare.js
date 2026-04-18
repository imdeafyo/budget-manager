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
   everything the chart + cards need in one pass. */
export function compareBudgetToActual(opts) {
  const {
    transactions = [],
    exp = [],                 // expense budget line items
    sav = [],                 // savings budget line items
    cats = [],                // string[] of expense category names
    savCats = [],             // string[] of savings category names
    transferCats = [],        // string[] of transfer-only category names (excluded)
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

  // Per-category period budgets
  const expBudget = budgetByCategory(exp, days, basis);
  const savBudget = budgetByCategory(sav, days, basis);

  // Filter transactions to range + drop transfer-category rows up front (belt
  // and suspenders with the refunds module's own exclusion).
  const inRange = filterByDateRange(transactions, fromIso, toIso).filter(tx => {
    if (!tx) return false;
    if (isMarkedTransfer(tx)) return false;
    // A row's primary category being a transfer-only category = skip
    if (tx.category && xferSet.has(tx.category)) return false;
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

/* ── Internal helpers ── */
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function sum(arr)  { let s = 0; for (const x of arr) s += Number(x) || 0; return s; }
