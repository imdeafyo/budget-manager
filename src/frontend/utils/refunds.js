/* ══════════════════════════ Refund handling — pure helpers ══════════════════════════
   A refund is a positive-amount transaction in an *expense* category. Without
   special handling, that $40 Amazon return would either count as +$40 of income
   (badly wrong) or pollute the category's spending total by adding instead of
   subtracting. Neither matches a user's mental model — a refund should *buy
   back* some of the category's budget.

   This module provides two concerns:

   1. Classification: is a given transaction a refund? Defaults to "positive
      amount AND category is in the expense-categories list." Rule-based
      overrides (via the Phase 5a rules engine) can set custom flags to force
      or suppress refund treatment, but for v1 the classification is purely
      automatic from amount sign + category.

   2. Aggregation: given a list of transactions and a setting for whether to
      treat refunds as netting, compute the net spend per category. A refund
      inside an expense category reduces that category's spend; it does NOT
      count as income to the household.

   All functions are pure. Works with both simple rows and split rows, via the
   existing `categoryContribution` helper from splits.js.
*/

import { categoryContribution } from "./splits.js";

/* Is this transaction a refund?
   opts.expenseCategorySet: Set<string> of expense-category names (from st.cats).
     Required — we don't want to default to "all categories are expenses" because
     that would wrongly net refunds against savings/transfer categories too.
   opts.includeSplitEntries: when a split row has positive amounts that land in
     expense categories, treat those specific entries as refunds even if the
     parent's overall amount is negative. Defaults to true — users do mix
     charge+refund on the same bank row occasionally. */
export function isRefund(tx, opts = {}) {
  if (!tx) return false;
  const { expenseCategorySet } = opts;
  if (!expenseCategorySet || typeof expenseCategorySet.has !== "function") {
    return false;
  }
  // Splits take precedence: a split row can carry refund activity even when
  // the parent sums to a negative total (e.g. a $100 charge + $40 return on
  // the same bank row, net -$60). The classifier returns true; the aggregator
  // (netCategorySpend) decides per-entry how to treat each split.
  if (Array.isArray(tx.splits) && tx.splits.length > 0) {
    return tx.splits.some(sp => {
      const spAmt = Number(sp.amount);
      return isFinite(spAmt) && spAmt > 0 && sp.category && expenseCategorySet.has(sp.category);
    });
  }
  // Non-split row: positive amount in an expense category.
  const amt = Number(tx.amount);
  if (!isFinite(amt) || amt <= 0) return false;
  return !!(tx.category && expenseCategorySet.has(tx.category));
}

/* Sum of spending (absolute dollars) per expense category.
   When treatRefundsAsNetting is true (default), a positive entry in an expense
   category subtracts from that category's spend total. The resulting number
   is the *net* spending for the period — what the user actually spent.

   Returns a Map<category, number> where values are positive dollars of spend.
   A category whose refunds exceed its charges will show 0 (clamped). A
   negative net is suppressed because "spent -$10 on groceries" confuses more
   than it clarifies — use the raw contribution map for arithmetic work.

   opts:
     expenseCategorySet : Set<string>  — which categories are expenses
     treatRefundsAsNetting : boolean   — defaults to true
     clampNegativeToZero : boolean     — defaults to true
     excludeTransfers : boolean        — defaults to true; skips rows where
                                         custom_fields._is_transfer is set */
export function netCategorySpend(transactions, opts = {}) {
  const {
    expenseCategorySet,
    treatRefundsAsNetting = true,
    clampNegativeToZero = true,
    excludeTransfers = true,
  } = opts;

  const out = new Map();
  if (!Array.isArray(transactions) || !transactions.length) return out;
  if (!expenseCategorySet || typeof expenseCategorySet.has !== "function") return out;

  for (const tx of transactions) {
    if (!tx) continue;
    if (excludeTransfers && tx.custom_fields?._is_transfer) continue;

    const contrib = categoryContribution(tx);
    for (const [cat, amt] of contrib) {
      // Only net amounts that are attributable to expense categories. Savings-
      // category inflows (e.g., deposit to savings) aren't refunds and aren't
      // spending — skip them entirely.
      if (!expenseCategorySet.has(cat)) continue;
      const n = Number(amt) || 0;
      // Expense contributions are normally negative (money out). We flip the
      // sign so the map contains positive spend dollars.
      //   n = -100  →  +100 spend
      //   n = +40   →  -40 (refund reduces spend, only if netting is on)
      let delta;
      if (n < 0) {
        delta = -n; // charge
      } else if (n > 0) {
        if (!treatRefundsAsNetting) continue; // treat refund as income (skip here)
        delta = -n; // refund reduces net spend
      } else {
        delta = 0;
      }
      out.set(cat, round2((out.get(cat) || 0) + delta));
    }
  }

  if (clampNegativeToZero) {
    for (const [cat, v] of out) {
      if (v < 0) out.set(cat, 0);
    }
  }
  return out;
}

/* Per-category refund totals — the positive dollars that were netted OUT of
   spending. Useful for the Phase 6 budget chart to display "$40 refunded"
   next to "$600 spent (net $560)".

   Returns a Map<category, number> of positive refund dollars. Unlike
   netCategorySpend, this doesn't flip signs — the values are the raw positive
   amounts that were classified as refunds. */
export function refundTotals(transactions, opts = {}) {
  const { expenseCategorySet, excludeTransfers = true } = opts;
  const out = new Map();
  if (!Array.isArray(transactions) || !transactions.length) return out;
  if (!expenseCategorySet || typeof expenseCategorySet.has !== "function") return out;

  for (const tx of transactions) {
    if (!tx) continue;
    if (excludeTransfers && tx.custom_fields?._is_transfer) continue;
    const contrib = categoryContribution(tx);
    for (const [cat, amt] of contrib) {
      if (!expenseCategorySet.has(cat)) continue;
      const n = Number(amt) || 0;
      if (n > 0) out.set(cat, round2((out.get(cat) || 0) + n));
    }
  }
  return out;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
