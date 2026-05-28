/* ══════════════════════════ Milestone comparison — pure helpers ══════════════════════════
   Phase 8a. Diffs two "milestone-shaped" inputs (A and B) into a structured
   comparison the UI can render. Either side can be a saved milestone or the
   live budget wrapped via `liveAsCompareInput()`.

   The diff is intentionally shallow and budget-focused — it surfaces what
   changed at the line-item and aggregate level, NOT what changed in tax
   brackets, deduction rows, or any other plumbing. The "Show unchanged"
   toggle in the UI is a render concern; the math always returns everything
   so the toggle can be done in the component without recomputing.

   ── Input shape ──
   Each side passes a "compare input" object:
     {
       label, date,                       // for display
       exp:    [{n, c, t, v, p}, ...],    // expense items — same shape as live st.exp
       sav:    [{n, c, v, p}, ...],       // savings items — same shape as live st.sav
       income: {                           // income inputs (Phase 8a Q3)
         cSalary, kSalary,                 // annual gross
         cEaipPct, kEaipPct,               // bonus percentages
         p1Name, p2Name,                   // for labeling
       },
       aggregates: {                       // pre-computed aggregate fields (weekly)
         netW, expW, savW, remW, savRate,
       },
     }

   For milestones, `liveAsCompareInput()` builds this from a recalc'd milestone
   object. For the live budget, the caller (useAppState or the tab itself)
   constructs it from current state.

   ── Matching ──
   Items match by stable `id` first, then fall back to (section,
   normalized-name) when one or both sides lack ids (legacy milestones).
   Section is the expense type ("N" / "D" for necessities/discretionary)
   or "S" for savings; name is trimmed + lowercased. Renames look like
   "changed" once both sides have ids — until then they look like
   add + remove.

   When two items in the same section share a normalized name AND
   neither has a matching id, they match by array order (1st A with 1st
   B, 2nd A with 2nd B). This is uncommon in practice but the tiebreak
   is deterministic.

   Each diff row carries a `matchedBy: "id" | "name" | null` field so
   the UI can surface match-method information if desired (currently
   informational only).

   ── Output shape ──
   See `compareMilestones()` JSDoc below.
*/

import { toWk, fromWk, evalF } from "./calc.js";

/* Normalize a name for matching: trim + lowercase. Empty becomes "". */
function normName(name) {
  return String(name || "").trim().toLowerCase();
}

/* Build the comparison key for an item. Section is "N", "D", or "S".
   The key locks matching to within the same section — moving a row from
   Necessities to Discretionary looks like add+remove, which is what we want
   because the meaning of the row changed. */
function itemKey(section, name) {
  return `${section}::${normName(name)}`;
}

/* Annual dollar amount for an item, using its declared period. Rounds to
   cents to keep equality stable across float drift. */
function annualDollars(item) {
  if (!item) return 0;
  const wk = toWk(item.v, item.p);
  return Math.round(wk * 48 * 100) / 100;
}

/* Display value for an item under a given visCol period.
   period: "w" weekly | "m" monthly | "y48" annual48 | "y52" annual52.
   Returns a number (dollars), or null if the period isn't visible. */
export function periodValue(item, period) {
  if (!item) return 0;
  const wk = toWk(item.v, item.p);
  if (period === "w") return wk;
  if (period === "m") return fromWk(wk, "m");
  if (period === "y48") return wk * 48;
  if (period === "y52") return wk * 52;
  return wk;
}

/* Compare two arrays of items by stable id (preferred) then by
   (section, normalized name) as fallback. Returns:
     {
       rows: [{
         section: "N" | "D" | "S",
         name: string,                  // display name — falls back to A's, then B's
         category: string | null,       // A's category, or B's if A missing
         aItem: item | null,            // raw item from A
         bItem: item | null,            // raw item from B
         aAnnual: number,               // annual48 dollars (A side)
         bAnnual: number,               // annual48 dollars (B side)
         delta: number,                 // bAnnual - aAnnual
         status: "added" | "removed" | "changed" | "unchanged",
         matchedBy: "id" | "name" | null,
       }, ...]
     }

   Matching strategy:
     Pass 1 — id match: items on both sides carrying the same stable
       `id` are paired regardless of name or position. Renames look
       like "changed" (because the value can still differ), and they
       no longer look like add+remove.
     Pass 2 — name fallback: any A-side item not yet matched is paired
       with a B-side item of the same normalized name in the same
       section. Ordered: first A with first remaining B of that name.
       This handles legacy milestones that predate stable ids on one
       or both sides.

   Cross-pass consumption: an item paired in pass 1 is removed from
   the candidate pool for pass 2, so name collisions across renames
   don't cause double-matching.

   Order: matches A's order first (so visible diff respects the user's
   original ordering), then any B-only rows appended at the end. */
function diffItems(aExp, aSav, bExp, bSav) {
  // Build per-section maps. Each map: key → array of items (for tiebreak).
  const sectionsA = { N: [], D: [], S: [] };
  const sectionsB = { N: [], D: [], S: [] };
  for (const it of aExp || []) {
    const t = it?.t === "D" ? "D" : "N";
    sectionsA[t].push(it);
  }
  for (const it of aSav || []) sectionsA.S.push(it);
  for (const it of bExp || []) {
    const t = it?.t === "D" ? "D" : "N";
    sectionsB[t].push(it);
  }
  for (const it of bSav || []) sectionsB.S.push(it);

  // For each A item we record either { bItem, matchedBy } or null
  // (no match yet). We do pass 1 (id) over all sections first to
  // claim id-pairs before name fallback runs.
  const rows = [];
  const consumedB = { N: new Set(), D: new Set(), S: new Set() };
  // matches[section][aIndex] = { bIdx, matchedBy } | null
  const matches = { N: [], D: [], S: [] };

  // Pass 1: id matching.
  for (const section of ["N", "D", "S"]) {
    const aList = sectionsA[section];
    const bList = sectionsB[section];
    // Index B by id.
    const bById = new Map();
    bList.forEach((it, i) => {
      const id = typeof it?.id === "string" && it.id.length > 0 ? it.id : null;
      if (id && !bById.has(id)) bById.set(id, i);
    });
    aList.forEach((aIt, ai) => {
      const aId = typeof aIt?.id === "string" && aIt.id.length > 0 ? aIt.id : null;
      if (aId && bById.has(aId)) {
        const bIdx = bById.get(aId);
        if (!consumedB[section].has(bIdx)) {
          matches[section][ai] = { bIdx, matchedBy: "id" };
          consumedB[section].add(bIdx);
        } else {
          matches[section][ai] = null;
        }
      } else {
        matches[section][ai] = null;
      }
    });
  }

  // Pass 2: name fallback for unmatched A items.
  for (const section of ["N", "D", "S"]) {
    const aList = sectionsA[section];
    const bList = sectionsB[section];
    // Index B by name → list of indices still available, in order.
    const bByName = new Map();
    bList.forEach((it, i) => {
      if (consumedB[section].has(i)) return;
      const k = normName(it?.n);
      if (!bByName.has(k)) bByName.set(k, []);
      bByName.get(k).push(i);
    });
    aList.forEach((aIt, ai) => {
      if (matches[section][ai]) return; // already matched by id
      const k = normName(aIt?.n);
      const candidates = bByName.get(k) || [];
      if (candidates.length === 0) return;
      const bIdx = candidates.shift();
      matches[section][ai] = { bIdx, matchedBy: "name" };
      consumedB[section].add(bIdx);
    });
  }

  // Build rows. A-side first (preserves user's ordering), then B-only orphans.
  for (const section of ["N", "D", "S"]) {
    const aList = sectionsA[section];
    const bList = sectionsB[section];
    aList.forEach((aIt, ai) => {
      const m = matches[section][ai];
      const bIt = m ? bList[m.bIdx] : null;
      const matchedBy = m ? m.matchedBy : null;
      const aAnnual = annualDollars(aIt);
      const bAnnual = annualDollars(bIt);
      let status;
      if (!bIt) status = "removed";
      else if (Math.abs(aAnnual - bAnnual) < 0.005) status = "unchanged";
      else status = "changed";
      rows.push({
        section,
        // Display name prefers B side when matched (so the post-rename
        // name is shown for id-matched renames), falls back to A's name
        // when removed.
        name: (bIt?.n) || aIt?.n || "",
        category: aIt?.c || bIt?.c || null,
        aItem: aIt,
        bItem: bIt,
        aAnnual,
        bAnnual,
        delta: bAnnual - aAnnual,
        status,
        matchedBy,
      });
    });

    // B-only orphans = items not consumed by an A match.
    bList.forEach((bIt, i) => {
      if (consumedB[section].has(i)) return;
      const bAnnual = annualDollars(bIt);
      rows.push({
        section,
        name: bIt?.n || "",
        category: bIt?.c || null,
        aItem: null,
        bItem: bIt,
        aAnnual: 0,
        bAnnual,
        delta: bAnnual,
        status: "added",
        matchedBy: null,
      });
    });
  }

  return { rows };
}

/* Diff the income side. Returns an array of comparison rows for salaries +
   bonus %. The income side is small and fixed — two salaries + two bonus
   percentages — so we just emit four rows in a known order. */
function diffIncome(aIncome, bIncome) {
  const a = aIncome || {};
  const b = bIncome || {};
  // Salaries: both sides default 0 if missing. A row is "changed" when the
  // delta is non-zero, "unchanged" otherwise. We never emit add/removed for
  // income — both sides always have the four slots.
  const mkSalary = (aVal, bVal, label) => {
    const av = Number(aVal || 0);
    const bv = Number(bVal || 0);
    return {
      kind: "salary",
      name: label,
      aValue: Math.round(av * 100) / 100,
      bValue: Math.round(bv * 100) / 100,
      delta: Math.round((bv - av) * 100) / 100,
      status: Math.abs(bv - av) < 0.005 ? "unchanged" : "changed",
    };
  };
  const mkBonus = (aPct, bPct, label) => {
    const av = Number(aPct || 0);
    const bv = Number(bPct || 0);
    return {
      kind: "bonus",
      name: label,
      aValue: Math.round(av * 100) / 100,
      bValue: Math.round(bv * 100) / 100,
      delta: Math.round((bv - av) * 100) / 100,
      status: Math.abs(bv - av) < 0.005 ? "unchanged" : "changed",
      // Bonus is a percent — UI formats it differently.
      isPct: true,
    };
  };
  const p1Label = a.p1Name || b.p1Name || "Person 1";
  const p2Label = a.p2Name || b.p2Name || "Person 2";
  return [
    mkSalary(a.cSalary, b.cSalary, `${p1Label} salary`),
    mkSalary(a.kSalary, b.kSalary, `${p2Label} salary`),
    mkBonus(a.cEaipPct, b.cEaipPct, `${p1Label} bonus %`),
    mkBonus(a.kEaipPct, b.kEaipPct, `${p2Label} bonus %`),
  ];
}

/* Compute the summary deltas for the aggregate cards.
   Inputs are the pre-recalc aggregates (weekly) from each side.
   Annualizes via × 48 for net/exp/sav/rem.
   Savings rate is already a percentage; delta is in percentage points. */
function summarizeAggregates(a, b) {
  const ag = (v) => Math.round(((v || 0) * 48) * 100) / 100;
  const aNet = ag(a?.netW);
  const bNet = ag(b?.netW);
  const aExp = ag(a?.expW);
  const bExp = ag(b?.expW);
  const aSav = ag(a?.savW);
  const bSav = ag(b?.savW);
  const aRem = ag(a?.remW);
  const bRem = ag(b?.remW);
  const aRate = Number(a?.savRate || 0);
  const bRate = Number(b?.savRate || 0);
  return {
    netIncome:    { a: aNet,  b: bNet,  delta: Math.round((bNet - aNet) * 100) / 100 },
    totalExpense: { a: aExp,  b: bExp,  delta: Math.round((bExp - aExp) * 100) / 100 },
    totalSavings: { a: aSav,  b: bSav,  delta: Math.round((bSav - aSav) * 100) / 100 },
    remaining:    { a: aRem,  b: bRem,  delta: Math.round((bRem - aRem) * 100) / 100 },
    savRate:      { a: aRate, b: bRate, delta: Math.round((bRate - aRate) * 100) / 100 },
  };
}

/**
 * Compare two compare-input objects A and B.
 * Returns { summary, items, income, aLabel, bLabel }.
 *
 * @param {Object} a — compare input (A side)
 * @param {Object} b — compare input (B side)
 * @returns {{
 *   summary: { netIncome: {a,b,delta}, totalExpense, totalSavings, remaining, savRate },
 *   items:   { rows: Array<{section, name, category, aItem, bItem, aAnnual, bAnnual, delta, status}> },
 *   income:  Array<{kind, name, aValue, bValue, delta, status, isPct?}>,
 *   aLabel:  string,
 *   bLabel:  string,
 * }}
 */
export function compareMilestones(a, b) {
  const safeA = a || {};
  const safeB = b || {};
  return {
    summary: summarizeAggregates(safeA.aggregates, safeB.aggregates),
    items: diffItems(safeA.exp, safeA.sav, safeB.exp, safeB.sav),
    income: diffIncome(safeA.income, safeB.income),
    aLabel: safeA.label || "(A)",
    bLabel: safeB.label || "(B)",
  };
}

/* ── Adapters ──
   Build a compare-input object from a milestone or from live state. The diff
   function only knows about its own input shape; these adapters keep the
   caller code on both sides simple. */

/* Build a compare-input from a milestone object. The milestone should already
   have been through recalcMilestonePure so its aggregate fields (netW, expW,
   savW, remW, savRate) are populated.

   Falls back to reconstructing exp/sav from legacy `items` dict when the
   milestone lacks fullState.exp/sav (matches what budgetCompare does for
   legacy milestones). */
export function milestoneAsCompareInput(milestone, reconstructFromItems) {
  if (!milestone) {
    return {
      label: "(empty)",
      date: "",
      exp: [],
      sav: [],
      income: { cSalary: 0, kSalary: 0, cEaipPct: 0, kEaipPct: 0, p1Name: "Person 1", p2Name: "Person 2" },
      aggregates: { netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 },
    };
  }
  const fs = milestone.fullState || {};
  let exp = Array.isArray(fs.exp) ? fs.exp : null;
  let sav = Array.isArray(fs.sav) ? fs.sav : null;
  if ((!exp || !sav) && milestone.items && typeof reconstructFromItems === "function") {
    const rebuilt = reconstructFromItems(milestone.items);
    if (!exp) exp = rebuilt.exp;
    if (!sav) sav = rebuilt.sav;
  }
  exp = exp || [];
  sav = sav || [];

  // cEaipPct and kEaipPct are the canonical bonus percentages on a recalc'd
  // milestone (recalcMilestonePure writes them). Fall back to fullState
  // legacy fields if missing.
  const cEaipPct = milestone.cEaipPct !== undefined
    ? Number(milestone.cEaipPct)
    : (fs.cEaip !== undefined ? evalF(fs.cEaip) : 0);
  const kEaipPct = milestone.kEaipPct !== undefined
    ? Number(milestone.kEaipPct)
    : (fs.kEaip !== undefined ? evalF(fs.kEaip) : 0);
  // Salaries can live at the top level (milestone.cSalary) or be derived from
  // cGrossW × 52. recalcMilestonePure preserves whichever was on the input.
  const cSalary = milestone.cSalary !== undefined
    ? Number(milestone.cSalary)
    : Number((milestone.cGrossW || 0) * 52);
  const kSalary = milestone.kSalary !== undefined
    ? Number(milestone.kSalary)
    : Number((milestone.kGrossW || 0) * 52);

  return {
    label: milestone.label || milestone.date || "(milestone)",
    date: milestone.date || "",
    exp,
    sav,
    income: {
      cSalary, kSalary, cEaipPct, kEaipPct,
      p1Name: fs.p1Name || milestone.p1Name || "Person 1",
      p2Name: fs.p2Name || milestone.p2Name || "Person 2",
    },
    aggregates: {
      netW: Number(milestone.netW || 0),
      expW: Number(milestone.expW || 0),
      savW: Number(milestone.savW || 0),
      remW: Number(milestone.remW || 0),
      savRate: Number(milestone.savRate || 0),
    },
  };
}

/* Build a compare-input from live state. Caller passes the current values
   directly; we just package them up. */
export function liveAsCompareInput({
  exp, sav,
  cSal, kSal, cEaip, kEaip,
  p1Name, p2Name,
  // weekly aggregates (already computed by useAppState)
  netW, tExpW, tSavW, remW,
  // savings rate as % — caller computes this once
  savRate,
} = {}) {
  return {
    label: "Current",
    date: new Date().toISOString().slice(0, 10),
    exp: Array.isArray(exp) ? exp : [],
    sav: Array.isArray(sav) ? sav : [],
    income: {
      cSalary: Number(cSal || 0),
      kSalary: Number(kSal || 0),
      // cEaip / kEaip live in raw state as either numbers or strings; evalF
      // tolerates both.
      cEaipPct: evalF(cEaip || 0),
      kEaipPct: evalF(kEaip || 0),
      p1Name: p1Name || "Person 1",
      p2Name: p2Name || "Person 2",
    },
    aggregates: {
      netW: Number(netW || 0),
      expW: Number(tExpW || 0),
      savW: Number(tSavW || 0),
      remW: Number(remW || 0),
      savRate: Number(savRate || 0),
    },
  };
}
