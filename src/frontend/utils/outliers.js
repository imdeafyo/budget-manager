/* ══════════════════════════ Outlier detection ══════════════════════════
   Flags transactions whose absolute amount is unusually large for their
   category, using a per-category median + MAD (median absolute deviation).

   Why MAD instead of mean + standard deviation?
   - SD is itself blown up by the outliers we're trying to find — one
     monster transaction in a category drags the SD up enough to mask
     itself.
   - MAD is robust: a few extreme values don't move the median or the
     median absolute deviation around it.

   Threshold: |amount| > max(median + k * MAD, median + minAbsoluteDelta).
   This is a one-sided check on magnitude — we only flag transactions that
   are larger than typical, not smaller. A $5 grocery run isn't notable;
   a $500 one is.

   The absolute floor (minAbsoluteDelta, default $50) prevents noise in
   low-dollar categories: a $120 grocery run might be statistically extreme
   if the median is $80, but $40 above median isn't actionable.

   Edge cases handled here:
   - Categories with fewer than `minSampleSize` transactions are skipped
     (no meaningful baseline to compare against).
   - Refunds — positive amounts in a category that's mostly expenses, or
     vice versa — are excluded from the baseline so they don't drag the
     median toward zero. Refunds themselves are never flagged as outliers.
   - Transfer categories are skipped entirely (transfers aren't spending
     and their amounts span a different scale than expenses).
   - Split parent rows are skipped (a $1000 row split across two
     categories isn't really a $1000 transaction in either).
   - When MAD = 0 (all amounts in the category are identical) we fall
     back to 5% of the median so a meaningful outlier in a perfectly
     consistent category still gets caught. If median and MAD are both
     0, the category has no signal and nothing is flagged.

   Returns a Map keyed by transaction id, so callers can do an O(1)
   lookup when rendering individual rows.
*/

import { hasSplits } from "./splits.js";

/* Median of a numeric array. Returns 0 for empty input. */
export function median(values) {
  if (!values || !values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/* Median absolute deviation around `med`. */
export function mad(values, med) {
  if (!values || !values.length) return 0;
  const m = med === undefined ? median(values) : med;
  const deviations = values.map(v => Math.abs(v - m));
  return median(deviations);
}

/* Sensitivity → k mapping. The user-facing dial is a three-level choice
   (Low / Normal / High) rather than a raw number, because "k" is meaningless
   to most people. Higher sensitivity = lower k = flag more transactions.
   Numbers chosen so Normal matches the prior hardcoded default. */
export const SENSITIVITY_K = {
  low: 5.0,     // catches only the wildest outliers
  normal: 3.5,  // sensible default (matches old behavior)
  high: 2.5,    // catches more borderline cases
};

export function kFromSensitivity(sensitivity) {
  return SENSITIVITY_K[sensitivity] ?? SENSITIVITY_K.normal;
}

const DEFAULT_OPTS = {
  k: 3.5,
  minSampleSize: 5,
  madFloorRatio: 0.05,   // when MAD = 0, fall back to 5% of the median
  // Absolute floor: a transaction must exceed median by at LEAST this many
  // dollars to be flagged, regardless of how many MADs out it is. Defaults
  // to $50 — keeps the algorithm from getting noisy in low-dollar
  // categories where a $120 grocery run technically clears the statistical
  // bar but doesn't actually warrant attention.
  minAbsoluteDelta: 50,
};

/* Detect outliers across a transaction array.

   Options:
   - k:                threshold multiplier on MAD. Default 3.5.
                       Prefer setting via `sensitivity` for user-facing UI.
   - sensitivity:      "low" | "normal" | "high" — convenience alternative to
                       `k`. Takes precedence over `k` if provided.
   - minSampleSize:    skip categories with fewer than N transactions. Default 5.
   - madFloorRatio:    when MAD = 0, use this fraction of the median as the
                       MAD fallback. Default 0.05 (5%).
   - minAbsoluteDelta: absolute-dollar floor — txn must exceed median by at
                       least this many dollars to flag. Default 50.
                       Set to 0 to use pure statistical detection.
   - transferCatSet:   Set<string> of category names to skip entirely.

   Returns: Map<txId, { score, median, mad, threshold, amount, sampleSize, category }>
*/
export function detectOutliers(transactions, opts = {}) {
  const merged = { ...DEFAULT_OPTS, ...opts };
  if (opts.sensitivity) merged.k = kFromSensitivity(opts.sensitivity);
  const { k, minSampleSize, madFloorRatio, minAbsoluteDelta } = merged;
  const transferCatSet = opts.transferCatSet instanceof Set
    ? opts.transferCatSet
    : new Set(opts.transferCatSet || []);

  const out = new Map();
  if (!Array.isArray(transactions) || transactions.length === 0) return out;

  // Group eligible transactions by category. Eligibility = unsplit, has a
  // category, not a transfer. We also stash sign so we can detect refunds.
  const groups = new Map(); // category → [{ tx, abs, sign }]
  for (const tx of transactions) {
    if (!tx || hasSplits(tx)) continue;
    const cat = tx.category || "";
    if (!cat) continue;
    if (transferCatSet.has(cat)) continue;
    const amt = Number(tx.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const sign = Math.sign(amt);
    const abs = Math.abs(amt);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({ tx, abs, sign });
  }

  for (const [cat, rows] of groups) {
    if (rows.length < minSampleSize) continue;

    // Determine the "primary sign" of the category — the direction the
    // majority of transactions point. Anything pointing the other way
    // is treated as a refund and excluded from the baseline AND from
    // outlier flagging (a $50 refund in a category averaging -$200
    // shouldn't be called an outlier).
    let pos = 0, neg = 0;
    for (const r of rows) { if (r.sign > 0) pos++; else if (r.sign < 0) neg++; }
    const primarySign = pos >= neg ? 1 : -1;

    const baseline = rows.filter(r => r.sign === primarySign);
    if (baseline.length < minSampleSize) continue;

    const absValues = baseline.map(r => r.abs);
    const med = median(absValues);
    let madValue = mad(absValues, med);

    // MAD floor: in extremely consistent categories (e.g. flat-rate
    // subscriptions where every transaction is identical) MAD = 0 means
    // any deviation at all would technically clear the threshold. Use a
    // floor proportional to the median so only meaningful jumps flag.
    if (madValue === 0) madValue = med * madFloorRatio;

    // No signal at all — both centre and spread are zero.
    if (med === 0 && madValue === 0) continue;

    const statThreshold = med + k * madValue;
    // Apply absolute floor: even if a value is statistically extreme, don't
    // flag it unless it's at least `minAbsoluteDelta` above the median in
    // raw dollars. This is what keeps a $120 grocery transaction from being
    // flagged when the typical grocery run is $80 — yes, it's MADs out, but
    // $40 over isn't actionable.
    const absFloorThreshold = med + (minAbsoluteDelta || 0);
    const threshold = Math.max(statThreshold, absFloorThreshold);

    for (const r of baseline) {
      if (r.abs > threshold) {
        // Score = how many MADs above the median the value sits.
        // Useful for sorting "most extreme first" if a UI ever wants it.
        const score = madValue > 0 ? (r.abs - med) / madValue : Infinity;
        out.set(r.tx.id, {
          score,
          median: med,
          mad: madValue,
          threshold,
          amount: r.abs,
          sampleSize: baseline.length,
          category: cat,
        });
      }
    }
  }

  return out;
}

/* Convenience: filter a transaction list down to just the outliers. */
export function filterOutliers(transactions, opts = {}) {
  const map = detectOutliers(transactions, opts);
  if (map.size === 0) return [];
  return transactions.filter(tx => map.has(tx?.id));
}
