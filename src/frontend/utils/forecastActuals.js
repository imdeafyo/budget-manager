/* ══════════════════════════ Forecast from actuals — Phase 7 ══════════════════════════
   The Forecast tab's compound-growth chart needs an annual contribution figure.
   By default that figure comes from the budget: (savings + remaining) × 48
   paychecks. This module produces an alternative figure derived from actual
   transactions over the last N months, so the projection reflects how much
   the user is *actually* setting aside, not how much the budget plans for.

   Formula:
     window         = last `months` calendar months ending at `todayIso`
     income_in_w    = sum of income-category transactions in window
     expenses_in_w  = sum of expense-category actuals in window (refund-netted,
                       transfer-excluded, splits respected)
     monthly_net    = (income_in_w − expenses_in_w) / months
     annual         = monthly_net × 12

   Why monthly × 12 (not weekly × 48)?
   The actual measurement window IS calendar-based — transactions are dated
   by calendar day. Monthly averaging is the natural reduction. The budget
   path uses × 48 because the budget itself is paycheck-denominated. They
   measure different things; the forecast just needs an annual figure to
   feed compound growth.

   Savings deposits are treated as expenses for this calculation — money
   moving from checking into a 401k/HYSA category counts as money leaving
   the spending pool. From the forecast's perspective those dollars are
   already "saved" and don't need to be projected forward as additional
   contributions on top of the chart's starting balance. (The starting
   balance input is the user's current investable assets.)

   Wait — that's wrong for THIS app. In this app's mental model, savings-
   category transactions are exactly the contribution we're projecting.
   When the user sees "Annual contribution: $36,000," they expect that to
   include their 401k deposits and brokerage transfers, not exclude them.

   So the calculation is actually:
     monthly_net = (income − non-savings_expenses) / months

   which is equivalent to:
     monthly_net = (savings + leftover_income) / months

   matching the budget formula's `(tSavW + remW) × 48`.

   Implementation: compute income total and expense total separately, then
   net them. Savings deposits are *not* in the expense set used here —
   they're income's flip-side, money the user kept rather than spent.

   ── Edge cases ──
   - Window with no income: returns 0 contribution (not negative — we don't
     project a sinking balance from missing data).
   - Window with no transactions at all: returns null so the caller can
     fall back to the budget number. UI surfaces "No transactions in
     window — using budget" in this case.
   - Negative net (spent more than earned): returned as-is. The user will
     see a negative annual contribution and probably want to fix it; the
     forecast chart treats it as a withdrawal.
*/

import { isIncomeTx, incomeContribution } from "./income.js";
import { netCategorySpend } from "./refunds.js";
import { isMarkedTransfer } from "./transfers.js";

/* Build a yyyy-mm-dd ISO string for `daysBack` days before `todayIso`. */
function shiftDays(todayIso, daysBack) {
  const t = new Date(todayIso + "T00:00:00Z");
  if (isNaN(t)) return null;
  t.setUTCDate(t.getUTCDate() - daysBack);
  return t.toISOString().slice(0, 10);
}

/* Approximate days in N calendar months — 30.44 × N. The forecast's annual
   reduction (× 12) makes this approximation immaterial for any reasonable
   window choice (3, 6, 12 months). */
function approxDaysInMonths(months) {
  return Math.round(months * 30.44);
}

/* Filter transactions to [fromIso, toIso] inclusive, using lex string compare
   on ISO yyyy-mm-dd dates. Mirrors filterByDateRange in budgetCompare.js but
   inlined here to keep this module independent. */
function filterToWindow(transactions, fromIso, toIso) {
  if (!Array.isArray(transactions)) return [];
  return transactions.filter(tx => {
    if (!tx || !tx.date) return false;
    if (fromIso && tx.date < fromIso) return false;
    if (toIso && tx.date > toIso) return false;
    return true;
  });
}

/* Sum income-side dollars in the window. Uses isIncomeTx so refund slices,
   savings withdrawals, and transfer rows are correctly excluded. */
function sumIncome(transactions, opts) {
  const { transferCatSet, expenseCatSet, savingsCatSet } = opts;
  let total = 0;
  for (const tx of transactions) {
    if (!isIncomeTx(tx, { transferCatSet, expenseCatSet, savingsCatSet })) continue;
    const contrib = incomeContribution(tx, { transferCatSet, expenseCatSet, savingsCatSet });
    for (const [, amt] of contrib) total += amt;
  }
  return Math.round(total * 100) / 100;
}

/* Sum non-savings expense dollars in the window. Reuses netCategorySpend
   (refund-aware, transfer-excluded). Savings categories are deliberately
   NOT in the expense set — savings deposits should fall through to "income
   minus expenses = savings + leftover" arithmetic. */
function sumNonSavingsExpenses(transactions, opts) {
  const { expenseCatSet } = opts;
  if (!expenseCatSet || expenseCatSet.size === 0) return 0;
  const map = netCategorySpend(transactions, {
    expenseCategorySet: expenseCatSet,
    treatRefundsAsNetting: true,
    clampNegativeToZero: true,
    excludeTransfers: true,
  });
  let total = 0;
  for (const v of map.values()) total += v;
  return Math.round(total * 100) / 100;
}

/* ── Main entry point ──
   Returns a structured result the Forecast tab can render alongside the
   budget number, or null when the window has no usable data.

   opts:
     transactions: required tx array
     months:       number of calendar months in the window (3, 6, 12, ...)
     todayIso:     anchor date — defaults to today
     cats:         expense category names (used as expenseCatSet)
     savCats:      savings category names (used as savingsCatSet)
     transferCats: transfer-only category names (excluded)
     incomeCats:   income-only category names (currently informational —
                   isIncomeTx detects income via positive-amount + non-
                   expense/savings, so this list is reserved for future use
                   when we want stricter income detection)
*/
export function actualAnnualContribution(opts) {
  const {
    transactions,
    months = 6,
    todayIso = new Date().toISOString().slice(0, 10),
    cats = [],
    savCats = [],
    transferCats = [],
    // incomeCats reserved (see note above)
  } = opts || {};

  if (!Array.isArray(transactions) || transactions.length === 0) return null;
  const m = Number(months);
  if (!isFinite(m) || m <= 0) return null;

  const fromIso = shiftDays(todayIso, approxDaysInMonths(m));
  if (!fromIso) return null;

  // Drop transfer rows up front — neither side counts.
  const inWindow = filterToWindow(transactions, fromIso, todayIso)
    .filter(tx => tx && !isMarkedTransfer(tx));

  if (inWindow.length === 0) return null;

  const expenseCatSet  = new Set(cats);
  const savingsCatSet  = new Set(savCats);
  const transferCatSet = new Set(transferCats);

  const income   = sumIncome(inWindow, { transferCatSet, expenseCatSet, savingsCatSet });
  const expenses = sumNonSavingsExpenses(inWindow, { expenseCatSet });

  const monthlyNet = (income - expenses) / m;
  const annual = monthlyNet * 12;

  return {
    annual: Math.round(annual * 100) / 100,
    monthlyNet: Math.round(monthlyNet * 100) / 100,
    income: Math.round(income * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    months: m,
    fromIso,
    toIso: todayIso,
    txCount: inWindow.length,
  };
}
