/* ══════════════════════════ Income aggregation — pure helpers ══════════════════════════
   Income history is pulled from transactions (not from snapshots, which only
   reflect salary + bonus). "Income" here means any positive-amount transaction
   that isn't a transfer between the user's own accounts. That intentionally
   includes securities trades for now — realized P&L handling is out of scope
   for this pass (deferred; sell/buy pairing would need its own module).

   The helpers here produce month-by-month time series suitable for Recharts.
   Pure functions, no React / state / date mutation.

   Callers:
   - ChartsTab's incomeHistory card (this session)
   - Future spent-vs-income overlay chart
   - Future per-category budget-vs-actual chart (will use buildMonthlyCategorySpend,
     which is parallel to buildMonthlyIncomeSeries but for expense-category rows)
*/

import { hasSplits, categoryContribution } from "./splits.js";

/* ── What counts as income ──
   A row is an "income" row if it passes all of:
   1. Positive amount (money in)
   2. Not marked as a transfer (_is_transfer or in a transfer category)
   3. The row's category (or its split categories) aren't in the expense/savings
      lists — those positive amounts are refunds, not income, and refund
      netting is handled separately.
   Uncategorized positive rows DO count as income (the user hasn't told us
   they're anything else — treat conservatively as money in).
*/
export function isIncomeTx(tx, opts = {}) {
  if (!tx) return false;
  const { transferCatSet, expenseCatSet, savingsCatSet } = opts;

  // Hard transfer exclusions apply regardless of shape.
  if (tx.custom_fields?._is_transfer) return false;
  if (transferCatSet && tx.category && transferCatSet.has(tx.category)) return false;

  // Splits take precedence: a split row can carry income slices even when
  // the parent amount nets negative (e.g. -$40 grocery row with a +$50 side
  // gig slice on the same line).
  if (hasSplits(tx)) {
    let hasIncomeSplit = false;
    for (const sp of tx.splits) {
      const n = Number(sp.amount) || 0;
      if (n <= 0) continue;
      const cat = sp.category || "";
      if (transferCatSet?.has(cat)) continue;
      if (expenseCatSet?.has(cat)) continue;  // refund slice
      if (savingsCatSet?.has(cat)) continue;  // savings-target slice
      hasIncomeSplit = true;
      break;
    }
    return hasIncomeSplit;
  }

  // Non-split row: must have a positive amount…
  const amt = Number(tx.amount);
  if (!isFinite(amt) || amt <= 0) return false;

  // …and if categorized, must not sit in an expense or savings category.
  if (tx.category) {
    if (expenseCatSet?.has(tx.category)) return false;
    if (savingsCatSet?.has(tx.category)) return false;
  }
  return true;
}

/* Per-row income contributions by category.
   Returns Map<category, amount> of positive dollars attributable to income.
   Uncategorized rows get bucketed under the literal string "Uncategorized"
   so they show up on the chart as a distinct line rather than being dropped. */
export function incomeContribution(tx, opts = {}) {
  const out = new Map();
  if (!isIncomeTx(tx, opts)) return out;
  const { transferCatSet, expenseCatSet, savingsCatSet } = opts;

  if (hasSplits(tx)) {
    for (const sp of tx.splits) {
      const n = Number(sp.amount) || 0;
      if (n <= 0) continue;
      const cat = sp.category || "";
      if (transferCatSet?.has(cat)) continue;
      if (expenseCatSet?.has(cat)) continue;
      if (savingsCatSet?.has(cat)) continue;
      const key = cat || "Uncategorized";
      out.set(key, roundCents((out.get(key) || 0) + n));
    }
    return out;
  }

  const key = tx.category || "Uncategorized";
  out.set(key, roundCents(Number(tx.amount) || 0));
  return out;
}

/* Parse ISO yyyy-mm-dd → { year, month (1-12) }. Returns null for invalid. */
function parseYearMonth(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  if (!isFinite(y) || !isFinite(mo) || mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}

/* yyyy-mm bucket key (zero-padded). Chart x-axis uses this, plus a display label. */
export function monthKey(iso) {
  const ym = parseYearMonth(iso);
  if (!ym) return null;
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

function fmtMonthLabel(ym) {
  // "Jan '25" for readability on a narrow x-axis.
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = ym.split("-").map(n => parseInt(n, 10));
  return `${names[m - 1]} '${String(y).slice(-2)}`;
}

function roundCents(n) { return Math.round(n * 100) / 100; }

/* ── buildMonthlyIncomeSeries ──
   Returns an array of points, one per month in the range, ready for Recharts:
     [{ date: "2025-01", label: "Jan '25", Total: 4200, Interest: 120, ... }, ...]

   Behavior:
   - Months with no income get a zero row so the line doesn't disappear
     between sparse months. Turn this off via opts.dropZeros=true.
   - Includes a "Total" key summing all categories for that month.
   - Always includes per-category keys for every category observed across the
     filtered set, so Recharts can render a line per category.
   - opts.categoryFilter: optional Set<string>; when provided, only those
     categories appear in output. "Uncategorized" is a valid filter entry.
   - opts.from / opts.to: ISO yyyy-mm-dd bounds (inclusive). If either is
     omitted, the series starts at the earliest/latest income transaction.
*/
export function buildMonthlyIncomeSeries(transactions, opts = {}) {
  const {
    transferCatSet, expenseCatSet, savingsCatSet,
    categoryFilter,
    from, to,
    dropZeros = false,
  } = opts;

  if (!Array.isArray(transactions) || !transactions.length) return [];

  const fromKey = from ? monthKey(from) : null;
  const toKey   = to   ? monthKey(to)   : null;

  // month key → category → total
  const buckets = new Map();
  const catSet = new Set();

  for (const tx of transactions) {
    const mk = monthKey(tx.date);
    if (!mk) continue;
    if (fromKey && mk < fromKey) continue;
    if (toKey && mk > toKey) continue;
    const contrib = incomeContribution(tx, { transferCatSet, expenseCatSet, savingsCatSet });
    if (!contrib.size) continue;
    let bucket = buckets.get(mk);
    if (!bucket) { bucket = new Map(); buckets.set(mk, bucket); }
    for (const [cat, amt] of contrib) {
      if (categoryFilter && !categoryFilter.has(cat)) continue;
      catSet.add(cat);
      bucket.set(cat, roundCents((bucket.get(cat) || 0) + amt));
    }
  }

  if (!buckets.size) return [];

  // Sort month keys asc, fill gaps if dropZeros is false.
  const keys = [...buckets.keys()].sort();
  const filled = dropZeros ? keys : fillMonthGaps(keys);

  const cats = [...catSet].sort();
  return filled.map(mk => {
    const row = { date: mk, label: fmtMonthLabel(mk) };
    const bucket = buckets.get(mk);
    let total = 0;
    for (const cat of cats) {
      const v = bucket ? (bucket.get(cat) || 0) : 0;
      row[cat] = v;
      total += v;
    }
    row.Total = roundCents(total);
    return row;
  });
}

/* Fill in missing yyyy-mm keys between the earliest and latest in the list.
   Input/output: sorted arrays of "yyyy-mm" strings. */
function fillMonthGaps(sortedKeys) {
  if (sortedKeys.length < 2) return sortedKeys.slice();
  const [startY, startM] = sortedKeys[0].split("-").map(Number);
  const [endY, endM] = sortedKeys[sortedKeys.length - 1].split("-").map(Number);
  const out = [];
  let y = startY, m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/* ── Category list for UI toggles ──
   Returns a sorted array of distinct income categories observed across the
   transaction set. Used to populate the "by type" selector in the Charts tab. */
export function incomeCategories(transactions, opts = {}) {
  const set = new Set();
  if (!Array.isArray(transactions)) return [];
  for (const tx of transactions) {
    const c = incomeContribution(tx, opts);
    for (const k of c.keys()) set.add(k);
  }
  return [...set].sort();
}

/* ── Time-window helper ──
   Converts a window name → { from, to } pair of ISO date strings relative to
   a reference date (defaults to today). Used by the global chart time-window
   toggle so every chart applies the same lens.

   Supported names: "all", "ytd", "1y", "5y", "10y".
   "all" returns { from: null, to: null }. */
export function windowRange(name, refIso) {
  const ref = refIso ? new Date(refIso) : new Date();
  if (isNaN(ref.getTime())) return { from: null, to: null };
  const toIso = ref.toISOString().slice(0, 10);
  switch ((name || "").toLowerCase()) {
    case "ytd": {
      const start = new Date(Date.UTC(ref.getUTCFullYear(), 0, 1));
      return { from: start.toISOString().slice(0, 10), to: toIso };
    }
    case "1y":  return { from: shiftYears(ref, -1), to: toIso };
    case "5y":  return { from: shiftYears(ref, -5), to: toIso };
    case "10y": return { from: shiftYears(ref, -10), to: toIso };
    default:    return { from: null, to: null }; // "all"
  }
}

function shiftYears(d, yearsDelta) {
  const n = new Date(d.getTime());
  n.setUTCFullYear(n.getUTCFullYear() + yearsDelta);
  return n.toISOString().slice(0, 10);
}
