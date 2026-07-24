/* Itemized vs. standard deduction — working-years tax.

   `calc.js` and `useAppState.jsx` previously applied the standard deduction
   unconditionally, so a household that itemizes had its federal tax (and
   therefore its take-home, and therefore everything downstream that feeds
   off net pay) overstated.

   Taxpayers take whichever is LARGER: the standard deduction, or the sum of
   their itemized deductions. That's the "auto" mode here and the default.
   "standard" and "itemized" force one side, which matters for planning —
   you may want to see what a mortgage does to your tax before the itemized
   total actually clears the standard deduction.

   SALT (state and local tax) is capped, and the cap schedule is statutory
   rather than inflation-indexed, so it does NOT ride the IRS indexing knob
   used for brackets and contribution limits. Under OBBBA the cap itself is
   permanent but the EXPANDED AMOUNT is temporary:
     2025          $40,000
     2026          $40,400
     2027-2029     prior year + 1%
     2030 onward   $10,000  (snapback)
   The cap is also reduced for high earners: 30% of MAGI above a threshold
   ($500,000 for 2025, $505,000 for 2026, +1%/yr through 2029), with a hard
   $10,000 floor — the phase-out can never push the cap below $10,000.

   Note the 2030 snapback is politically live and was the largest
   revenue-raiser in the provision; it may well be extended again. This
   models CURRENT law. Users who expect an extension can enter a SALT figure
   that already reflects their own assumption, or force "itemized" mode.

   Medical expenses are only deductible above 7.5% of AGI. Callers pass AGI
   so this module applies the floor rather than making the user pre-subtract
   it. Pass agi = 0 to skip the floor (medical then counts in full), which is
   what callers without a meaningful AGI figure should do. */

const SALT_BASE_YEAR = 2026;
const SALT_BASE_CAP = 40400;          // 2026 statutory cap
const SALT_SNAPBACK_YEAR = 2030;
const SALT_SNAPBACK_CAP = 10000;
const SALT_FLOOR = 10000;             // phase-out can't go below this
const SALT_STEP = 0.01;               // 1% per year, 2027-2029
const SALT_PHASEOUT_RATE = 0.30;      // 30% of MAGI over threshold
const SALT_BASE_THRESHOLD = 505000;   // 2026 MFJ MAGI threshold
const MEDICAL_AGI_FLOOR = 0.075;

/* Statutory SALT cap for a calendar year, before any MAGI phase-out.
   Years before the base year fall back to the base cap — the app's tax table
   only carries recent years and back-projecting the cap isn't meaningful. */
export function saltCap(year) {
  const y = Number(year);
  if (!isFinite(y)) return SALT_BASE_CAP;
  if (y >= SALT_SNAPBACK_YEAR) return SALT_SNAPBACK_CAP;
  if (y <= SALT_BASE_YEAR) return SALT_BASE_CAP;
  // 2027, 2028, 2029: compound 1% from the 2026 base.
  return Math.round(SALT_BASE_CAP * Math.pow(1 + SALT_STEP, y - SALT_BASE_YEAR));
}

/* MAGI threshold at which the SALT cap starts phasing down. */
export function saltPhaseoutThreshold(year) {
  const y = Number(year);
  if (!isFinite(y) || y <= SALT_BASE_YEAR) return SALT_BASE_THRESHOLD;
  if (y >= SALT_SNAPBACK_YEAR) return Infinity; // no phase-out once snapped back
  return Math.round(SALT_BASE_THRESHOLD * Math.pow(1 + SALT_STEP, y - SALT_BASE_YEAR));
}

/* Effective SALT cap for a year at a given MAGI, after phase-out.
   Never returns less than the $10,000 floor. */
export function effectiveSaltCap(year, magi) {
  const cap = saltCap(year);
  if (cap <= SALT_FLOOR) return cap;
  const threshold = saltPhaseoutThreshold(year);
  const m = Number(magi) || 0;
  if (!isFinite(threshold) || m <= threshold) return cap;
  const reduction = (m - threshold) * SALT_PHASEOUT_RATE;
  return Math.max(SALT_FLOOR, cap - reduction);
}

/* Sum the itemized components, applying the SALT cap and the medical floor.
   Returns the total plus the pieces, so the UI can show what was actually
   allowed vs. what was entered (the SALT haircut is otherwise invisible). */
export function computeItemized(items, opts) {
  const it = items || {};
  const o = opts || {};
  const year = o.year !== undefined ? Number(o.year) : SALT_BASE_YEAR;
  const magi = Number(o.magi) || 0;
  const agi = Number(o.agi) || 0;

  const saltEntered = Math.max(0, Number(it.salt) || 0);
  const cap = effectiveSaltCap(year, magi);
  const saltAllowed = Math.min(saltEntered, cap);

  const mortgage = Math.max(0, Number(it.mortgageInterest) || 0);
  const charitable = Math.max(0, Number(it.charitable) || 0);

  const medicalEntered = Math.max(0, Number(it.medical) || 0);
  const medicalFloor = agi > 0 ? agi * MEDICAL_AGI_FLOOR : 0;
  const medicalAllowed = Math.max(0, medicalEntered - medicalFloor);

  const total = saltAllowed + mortgage + charitable + medicalAllowed;

  return {
    total,
    saltEntered,
    saltAllowed,
    saltCap: cap,
    saltDisallowed: Math.max(0, saltEntered - saltAllowed),
    mortgage,
    charitable,
    medicalEntered,
    medicalAllowed,
    medicalFloor,
  };
}

/* Resolve the deduction actually used.

   mode: "auto" (default) | "standard" | "itemized"
   Returns { amount, used, itemized, standard } where `used` is "standard" or
   "itemized" so the UI can show which won without recomputing.

   Defaults are chosen so a household that has never touched these inputs
   gets exactly today's behavior: no itemized components means a zero
   itemized total, which never beats a positive standard deduction in auto
   mode. */
export function resolveDeduction(standardDeduction, items, opts) {
  const std = Math.max(0, Number(standardDeduction) || 0);
  const o = opts || {};
  const mode = o.mode === "standard" || o.mode === "itemized" ? o.mode : "auto";
  const itemized = computeItemized(items, o);

  if (mode === "standard") {
    return { amount: std, used: "standard", itemized, standard: std };
  }
  if (mode === "itemized") {
    return { amount: itemized.total, used: "itemized", itemized, standard: std };
  }
  const useItemized = itemized.total > std;
  return {
    amount: useItemized ? itemized.total : std,
    used: useItemized ? "itemized" : "standard",
    itemized,
    standard: std,
  };
}
