/* ══════════════════════════ Splits — pure helpers ══════════════════════════
   Transactions can optionally be split into multiple category allocations whose
   amounts sum to the parent transaction's amount. The parent row retains its
   own `category` field for display purposes (backward compat with every chart,
   filter, and sort path in the app), but when splits are present they are the
   authoritative source for totals.

   Split shape:
   {
     id:       string     (uuid — for stable React keys across edits)
     category: string     (any value from cats / savCats / transferCats)
     amount:   number     (signed to match parent — if parent is -100, splits
                            are all negative summing to -100)
     notes:    string?    (optional per-split note)
   }

   Stored on transactions as:
   tx.splits: Split[]   (presence of a non-empty array = "has splits")

   Invariants:
   - sum(splits.amount) === tx.amount  (within 1¢ rounding tolerance)
   - Every split's sign matches tx.amount's sign — mixing refunds inside an
     expense split is deferred to Phase 5c's refund handling.
*/

const CENT = 0.01;
const TOL  = 0.005; // half-cent tolerance for float comparison

export function newSplitId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += hex[(Math.random() * 4) | 0 | 8];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
}

/* Round to cents — avoids float drift when summing */
export function roundCents(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function hasSplits(tx) {
  return Array.isArray(tx?.splits) && tx.splits.length > 0;
}

/* Sum of split amounts, rounded to cents. */
export function sumSplits(splits) {
  if (!Array.isArray(splits) || !splits.length) return 0;
  let s = 0;
  for (const sp of splits) s += Number(sp.amount) || 0;
  return roundCents(s);
}

/* Difference between a target total and the current split sum.
   Positive = need to add to splits; negative = need to subtract. */
export function splitRemainder(targetAmount, splits) {
  return roundCents(Number(targetAmount || 0) - sumSplits(splits));
}

/* Validate a set of splits against a parent amount.
   Returns { valid, errors: string[], remainder }. */
export function validateSplits(splits, parentAmount) {
  const errors = [];
  const remainder = splitRemainder(parentAmount, splits);
  if (!Array.isArray(splits) || !splits.length) {
    errors.push("At least one split is required.");
    return { valid: false, errors, remainder };
  }
  const parentSign = Math.sign(Number(parentAmount) || 0);
  splits.forEach((sp, i) => {
    if (!sp.category || !String(sp.category).trim()) {
      errors.push(`Split ${i + 1}: category is required.`);
    }
    const n = Number(sp.amount);
    if (!isFinite(n) || n === 0) {
      errors.push(`Split ${i + 1}: amount must be non-zero.`);
    } else if (parentSign !== 0 && Math.sign(n) !== parentSign) {
      errors.push(`Split ${i + 1}: amount sign must match the parent (${parentSign < 0 ? "negative" : "positive"}).`);
    }
  });
  if (Math.abs(remainder) > TOL) {
    const actual = sumSplits(splits);
    errors.push(`Splits sum to ${actual.toFixed(2)} but parent is ${Number(parentAmount || 0).toFixed(2)} (off by ${remainder.toFixed(2)}).`);
  }
  return { valid: errors.length === 0, errors, remainder };
}

/* Construct a fresh split with defaults. */
export function newSplit(partial = {}) {
  return {
    id: partial.id || newSplitId(),
    category: partial.category || "",
    amount: typeof partial.amount === "number" ? roundCents(partial.amount) : (partial.amount === "" ? "" : roundCents(parseFloat(partial.amount) || 0)),
    notes: partial.notes || "",
  };
}

/* Seed the split editor when a user opens it for the first time.
   Two rows: one with the parent's current category + full amount, and one empty
   row for the user to fill in. This ensures every edit is a reduction of an
   existing allocation, which is the mental model most users have. */
export function seedSplits(tx) {
  const amt = roundCents(Number(tx?.amount) || 0);
  return [
    newSplit({ category: tx?.category || "", amount: amt }),
    newSplit({ category: "", amount: 0 }),
  ];
}

/* Auto-balance: set the last split's amount to whatever makes the sum match.
   If the last split has no category yet, we still fill in the amount — the
   user can pick the category next. */
export function autoBalance(splits, parentAmount) {
  if (!Array.isArray(splits) || !splits.length) return splits;
  const remainder = splitRemainder(parentAmount, splits.slice(0, -1));
  const next = splits.slice();
  next[next.length - 1] = {
    ...next[next.length - 1],
    amount: roundCents(remainder),
  };
  return next;
}

/* Scale all splits proportionally to match a new parent amount. Used when the
   user edits the parent's total on a row that already has splits.
   Preserves categories + notes, re-rounds amounts to cents, and corrects any
   sub-cent drift by pushing the delta onto the largest-magnitude split so the
   invariant holds exactly. */
export function scaleSplits(splits, oldParentAmount, newParentAmount) {
  if (!Array.isArray(splits) || !splits.length) return splits;
  const oldA = Number(oldParentAmount) || 0;
  const newA = Number(newParentAmount) || 0;
  if (oldA === 0) {
    // Can't scale a zero parent — divide evenly as a fallback
    const per = roundCents(newA / splits.length);
    const scaled = splits.map(sp => ({ ...sp, amount: per }));
    // Dump drift onto the last row
    const drift = roundCents(newA - sumSplits(scaled));
    if (Math.abs(drift) > TOL) {
      scaled[scaled.length - 1] = {
        ...scaled[scaled.length - 1],
        amount: roundCents(scaled[scaled.length - 1].amount + drift),
      };
    }
    return scaled;
  }
  const ratio = newA / oldA;
  const scaled = splits.map(sp => ({ ...sp, amount: roundCents(Number(sp.amount || 0) * ratio) }));
  // Correct drift by pushing onto the largest-magnitude split
  const drift = roundCents(newA - sumSplits(scaled));
  if (Math.abs(drift) > TOL) {
    let maxIdx = 0;
    let maxMag = Math.abs(scaled[0].amount);
    for (let i = 1; i < scaled.length; i++) {
      if (Math.abs(scaled[i].amount) > maxMag) { maxIdx = i; maxMag = Math.abs(scaled[i].amount); }
    }
    scaled[maxIdx] = { ...scaled[maxIdx], amount: roundCents(scaled[maxIdx].amount + drift) };
  }
  return scaled;
}

/* ── Category-view helpers ──
   When splits are present, the "effective" categories for a transaction are
   its split categories, not the parent. Used by filter/match logic. */
export function effectiveCategories(tx) {
  if (hasSplits(tx)) {
    const s = new Set();
    for (const sp of tx.splits) {
      if (sp.category) s.add(sp.category);
    }
    return s;
  }
  return new Set(tx?.category ? [tx.category] : []);
}

/* Does the transaction have any allocation (parent or split) to a given
   category? Case-sensitive to match the rest of the codebase. */
export function matchesCategory(tx, category) {
  if (!category) return false;
  return effectiveCategories(tx).has(category);
}

/* ── Per-category contribution ──
   Returns a Map<category, amount> representing how much of this transaction's
   amount is attributed to each category. For unsplit rows this is a single
   entry {parent.category → parent.amount}; for split rows it's the sum per
   category (in case the same category appears on multiple splits). */
export function categoryContribution(tx) {
  const out = new Map();
  if (hasSplits(tx)) {
    for (const sp of tx.splits) {
      const c = sp.category || "";
      if (!c) continue;
      out.set(c, roundCents((out.get(c) || 0) + (Number(sp.amount) || 0)));
    }
  } else if (tx?.category) {
    out.set(tx.category, roundCents(Number(tx.amount) || 0));
  }
  return out;
}

/* ── Sanitize before persist ──
   Strip empty / zero-amount splits; trim category strings. If nothing is left,
   return null so the caller knows to drop the `splits` field from the tx. */
export function sanitizeSplits(splits) {
  if (!Array.isArray(splits)) return null;
  const cleaned = splits
    .map(sp => ({
      id: sp.id || newSplitId(),
      category: String(sp.category || "").trim(),
      amount: roundCents(Number(sp.amount) || 0),
      notes: (sp.notes || "").trim(),
    }))
    .filter(sp => sp.category && sp.amount !== 0);
  return cleaned.length ? cleaned : null;
}
