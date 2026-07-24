/* Tax parameter indexing.

   The IRS adjusts bracket thresholds and the standard deduction upward each
   year for inflation. TAX_DB only holds real, published values (through the
   latest year the table has been updated). For projection years beyond that,
   holding the table row flat while income inflates produces artificial
   bracket creep: projected income climbs into brackets that, in reality,
   would have moved up with it. That overstates future tax and inflates the
   FIRE target.

   This module compounds a base-year tax row forward at a caller-supplied
   rate, mirroring the `limitFor` helper in calc.js that already does the
   same for IRS contribution limits. The same `limitGrowthPct` forecast field
   drives both — federal indexing uses chained CPI and contribution limits
   use CPI-U, but the gap between them is a few tenths of a percent, far
   below the uncertainty in any 30-year projection. One knob, one assumption.

   Bracket shape is [min, max, rate] tuples (see TAX_DB), and calcFed walks
   them assuming CONTIGUITY: each tuple's min equals the previous tuple's
   max. Indexing each boundary independently and rounding would open gaps or
   overlaps at the seams, silently mis-taxing income that falls in one. So we
   index each distinct boundary ONCE and rebuild the tuples from the indexed
   boundary list, which makes contiguity structural rather than incidental.

   Rounding: the IRS rounds bracket thresholds to the nearest $25 and the
   standard deduction to the nearest $50.

   NOTE: indexes only federal ordinary-income brackets and the standard
   deduction. State brackets are left alone — state indexing rules vary
   widely (some states don't index at all), and that's a separate problem.
   The SS wage cap is also left alone: it indexes to average wage growth,
   not CPI, so it should not ride this knob. */

/* The top bracket in TAX_DB uses a large sentinel rather than Infinity.
   Anything at or above this is treated as "no ceiling" and left unindexed —
   scaling it would be meaningless and could overflow past what callers
   expect to see as the open-ended top. */
const OPEN_TOP = 9999999;

function roundTo(value, step) {
  if (!isFinite(value) || !isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/* Compound factor for `years` forward at `pct` percent per year.
   Returns 1 for non-positive years or a zero/invalid rate, so callers get
   the unmodified base values back. */
export function indexFactor(pct, years) {
  const r = (Number(pct) || 0) / 100;
  const y = Number(years) || 0;
  if (r === 0 || y <= 0) return 1;
  return Math.pow(1 + r, y);
}

/* Index a bracket array of [min, max, rate] tuples forward.

   Rates never index — only thresholds move. The leading 0 stays 0 and the
   open-ended top stays at its sentinel. Contiguity is preserved because
   each boundary is computed once and shared by the tuples on both sides. */
export function indexBrackets(brackets, pct, years) {
  if (!Array.isArray(brackets) || brackets.length === 0) return brackets;
  const f = indexFactor(pct, years);
  if (f === 1) return brackets;

  const scale = v => {
    if (!isFinite(v)) return v;
    if (v <= 0) return 0;
    if (v >= OPEN_TOP) return v;
    return roundTo(v * f, 25);
  };

  /* Index every max once; each tuple's min is the previous tuple's max. */
  const maxes = brackets.map(b => scale(b[1]));
  return brackets.map((b, idx) => [
    idx === 0 ? scale(b[0]) : maxes[idx - 1],
    maxes[idx],
    b[2],
  ]);
}

/* Index a standard deduction amount forward. */
export function indexStdDed(amount, pct, years) {
  const a = Number(amount);
  if (!isFinite(a)) return amount;
  const f = indexFactor(pct, years);
  if (f === 1) return a;
  return roundTo(a * f, 50);
}

/* Index a whole TAX_DB row forward `years` from its base year.

   Returns a new row with fedMFJ, fedSingle, stdMFJ, and stdSingle indexed;
   all other fields pass through untouched. Returns the ORIGINAL row object
   when no indexing applies, so callers can use referential equality to
   detect a no-op. */
export function indexTaxRow(row, pct, years) {
  if (!row) return row;
  const f = indexFactor(pct, years);
  if (f === 1) return row;
  const next = { ...row };
  if (Array.isArray(row.fedMFJ)) next.fedMFJ = indexBrackets(row.fedMFJ, pct, years);
  if (Array.isArray(row.fedSingle)) next.fedSingle = indexBrackets(row.fedSingle, pct, years);
  if (row.stdMFJ !== undefined) next.stdMFJ = indexStdDed(row.stdMFJ, pct, years);
  if (row.stdSingle !== undefined) next.stdSingle = indexStdDed(row.stdSingle, pct, years);
  return next;
}
