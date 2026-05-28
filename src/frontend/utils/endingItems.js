/* Ending obligations — Advanced Forecast Phase X-A.
   ---------------------------------------------------------------
   Models the scenario where a budgeted expense or savings line ENDS at
   a future point (paid-off loan, fixed-term subscription, etc.), and
   the freed-up cash flow redirects to a designated forecast account
   from that point forward.

   The data structure stores one "ending item" per budget line that
   will eventually stop. The forecast math layer consumes a resolved
   list of monthly events (see resolveEndingEvents) and applies them
   in-place during projection.

   See Phase X-A in the project instructions for full design rationale.
   ---------------------------------------------------------------

   Shape (Phase 14a — multi-item):

     {
       id: "ei_<random>",
       itemRefs: [{ section: "exp" | "sav", id?: string, idx: number, name: string }, ...],
       destAccountId: "<account id>",       // where freed cash flows
       effect: "ends" | "starts",            // scaffolding; UI only exposes "ends"
       mode: "date" | "loan",
       endsOn: "YYYY-MM",                    // user-entered if mode=date,
                                             //   computed-and-stored if mode=loan
       balance: number,                      // mode=loan only
       annualRate: number,                   // mode=loan only, percent
     }

   `endsOn` for loan mode is always derived from balance/rate/payment;
   the stored value is a cache. Recomputation happens in the UI on save
   (and on any input change for live preview). Math layer just trusts it.

   The linked budget items' amounts are read live from the budget at
   projection time. `id` is the stable budget-item identifier (added
   in the stable-IDs phase) and is the preferred match key — it survives
   reorders, renames, and delete-above. `idx` and `name` are kept as
   fallback for resolving legacy refs that predate stable ids (the
   resolver auto-upgrades any successful name/idx fallback by writing
   the matched item's `id` back into the ref on next save). `name` is
   also used as a snapshot to display "Linked item missing" if the
   underlying item was renamed or deleted.

   Back-compat: Phase X-A persisted a single `itemRef` per obligation.
   Loads with `itemRef` and no `itemRefs` are still accepted — the
   `getItemRefs(ei)` helper wraps the legacy field in a one-element
   array. New writes from the UI always use `itemRefs`. */

const NEW_ID_PREFIX = "ei_";
const MAX_LOAN_MONTHS = 50 * 12; // 50 years — beyond that we consider it non-amortizing

/* Generate a new ending-item id. Random-suffixed so two items added in
   the same tick don't collide. */
export function newEndingItemId() {
  return NEW_ID_PREFIX + Math.random().toString(36).slice(2, 10);
}

/* Normalize the linked-budget-item list for an ending obligation.
   ---------------------------------------------------------------
   Phase 14a extended the data model from a single `itemRef` to an
   array `itemRefs`. This helper hides the read shim: callers always
   get back an array (possibly empty) without caring which version
   the data was persisted as.

   Precedence: if `itemRefs` is a real array, use it (even if empty —
   an empty array means "all refs were removed" and should orphan,
   distinct from "legacy single-ref" which lives on `itemRef`).
   Otherwise fall back to wrapping `itemRef` in a one-element array.

   The fall-through (no itemRefs, no itemRef) returns []. */
export function getItemRefs(ei) {
  if (!ei || typeof ei !== "object") return [];
  if (Array.isArray(ei.itemRefs)) return ei.itemRefs;
  if (ei.itemRef && typeof ei.itemRef === "object") return [ei.itemRef];
  return [];
}

/* Normalize a name for fallback matching: trim + lowercase. */
function _normName(name) {
  return String(name || "").trim().toLowerCase();
}

/* Resolve an itemRef to an actual budget-item, with fallback layers.
   ---------------------------------------------------------------
   Stable-IDs phase: prefer the ref's `id` (rock-solid across reorders,
   deletes, and renames). Fall back to (section, normalized-name) for
   refs persisted before ids existed. Fall back further to (section,
   idx) for very old data where the name was also stale.

   Args:
     ref — { section, id?, idx?, name? } — the persisted reference
     exp — the live exp[] array (each item ideally has an `id`)
     sav — the live sav[] array (each item ideally has an `id`)

   Returns:
     {
       item: <budget item>|null,
       matchedBy: "id"|"name"|"idx"|null,
       upgradeTo: { id, idx, name }|null   // suggested ref upgrade
                                           //   if matched by fallback
     }

   `upgradeTo` is set when the resolver matched by name or idx and
   the matched item has an `id` we can pin the ref to going forward.
   Callers (typically AdvancedForecastTab) can write this back into
   the ref so the next persistence layer captures the upgrade.

   Resolution rules:
     1. If ref.id is present and matches an item's id → match by id.
     2. Else if (section, normalized name) matches exactly ONE item
        → match by name. (Multiple matches: ambiguous, skip to step 3.)
     3. Else if ref.idx is in-range AND the item at that idx has the
        same normalized name as ref.name → match by idx.
        (Both checks required so a deleted-above + same-name-coincidence
        doesn't silently point at the wrong row.)
     4. Else: orphan. */
export function resolveItemRef(ref, exp, sav) {
  if (!ref || typeof ref !== "object" || typeof ref.section !== "string") {
    return { item: null, matchedBy: null, upgradeTo: null };
  }
  const arr = ref.section === "sav" ? (sav || []) : (exp || []);
  if (!Array.isArray(arr)) {
    return { item: null, matchedBy: null, upgradeTo: null };
  }

  // 1. ID match — preferred.
  if (typeof ref.id === "string" && ref.id.length > 0) {
    const byId = arr.find(it => it && it.id === ref.id);
    if (byId) {
      return { item: byId, matchedBy: "id", upgradeTo: null };
    }
    // ref carries an id but it doesn't exist in the live arr —
    // fall through to name match (item may have been renamed-then-
    // re-added without an id sync, unlikely but harmless).
  }

  // 2. Name match — fallback for pre-id refs.
  const norm = _normName(ref.name);
  if (norm.length > 0) {
    const candidates = arr.filter(it => it && _normName(it.n) === norm);
    if (candidates.length === 1) {
      const m = candidates[0];
      const upgrade = (typeof m.id === "string" && m.id.length > 0)
        ? { id: m.id, idx: arr.indexOf(m), name: m.n }
        : null;
      return { item: m, matchedBy: "name", upgradeTo: upgrade };
    }
    // Multiple name matches: ambiguous. Don't guess — fall to idx.
  }

  // 3. Idx match — last-resort fallback. Both idx-in-range AND
  // matching normalized name required to avoid silent mis-pointing.
  if (typeof ref.idx === "number" && ref.idx >= 0 && ref.idx < arr.length) {
    const m = arr[ref.idx];
    if (m && _normName(m.n) === norm) {
      const upgrade = (typeof m.id === "string" && m.id.length > 0)
        ? { id: m.id, idx: ref.idx, name: m.n }
        : null;
      return { item: m, matchedBy: "idx", upgradeTo: upgrade };
    }
  }

  // 4. Orphan.
  return { item: null, matchedBy: null, upgradeTo: null };
}

/* Loan amortization — months to pay off.
   ---------------------------------------------------------------
   Standard fixed-rate amortization formula:
     n = -ln(1 - r·P/M) / ln(1 + r)
   where P = principal, M = monthly payment, r = monthly rate.

   Returns:
     { ok: true, months: integer }      — pays off successfully
     { ok: false, reason: "..." }       — non-amortizing or invalid input

   Reasons (stable strings — UI may render messaging from them):
     "zero-payment"      monthlyPayment <= 0
     "zero-balance"      balance <= 0
     "negative-amortization"
                         monthly interest >= payment (loan grows forever)
     "horizon-exceeded"  amortizes but takes longer than MAX_LOAN_MONTHS
                         (interpret: rate so low + balance so high that
                         payoff is effectively never within reason)

   Notes:
     - Annual rate is in PERCENT (so 5.25 means 5.25%, not 0.0525).
     - Zero-interest loans are handled directly: months = ceil(P / M).
     - Result is rounded UP to whole months (a partial final payment
       still consumes a calendar month for projection purposes). */
export function monthsToPayoff(balance, annualRatePct, monthlyPayment) {
  const P = Number(balance);
  const M = Number(monthlyPayment);
  const rPct = Number(annualRatePct);

  if (!isFinite(P) || P <= 0) return { ok: false, reason: "zero-balance" };
  if (!isFinite(M) || M <= 0) return { ok: false, reason: "zero-payment" };
  if (!isFinite(rPct) || rPct < 0) return { ok: false, reason: "negative-rate" };

  // Zero-interest shortcut.
  if (rPct === 0) {
    const months = Math.ceil(P / M);
    if (months > MAX_LOAN_MONTHS) return { ok: false, reason: "horizon-exceeded" };
    return { ok: true, months };
  }

  const r = (rPct / 100) / 12; // monthly rate as decimal
  const monthlyInterest = P * r;

  /* Neg-am check: if the payment doesn't cover interest, the balance
     grows every month and the loan never amortizes. We catch this
     before evaluating the log expression (which would produce
     NaN/Infinity). */
  if (M <= monthlyInterest) {
    return { ok: false, reason: "negative-amortization" };
  }

  // Standard amortization formula.
  const ratio = (r * P) / M; // always in (0, 1) here since M > P*r
  const months = -Math.log(1 - ratio) / Math.log(1 + r);

  if (!isFinite(months) || months <= 0) {
    return { ok: false, reason: "negative-amortization" };
  }
  const whole = Math.ceil(months);
  if (whole > MAX_LOAN_MONTHS) return { ok: false, reason: "horizon-exceeded" };
  return { ok: true, months: whole };
}

/* Convert an offset of N months from a base "YYYY-MM" to a "YYYY-MM".
   Pure date math — no Date object weirdness. */
export function addMonths(baseYearMonth, monthsToAdd) {
  const [yStr, mStr] = String(baseYearMonth).split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1..12
  if (!isFinite(y) || !isFinite(m) || m < 1 || m > 12) return null;
  const total = y * 12 + (m - 1) + Number(monthsToAdd);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/* Compute "endsOn" for a loan-mode ending item, given the budget
   monthly payment and base "YYYY-MM" (typically the projection's
   start month, e.g. baseYear-current-month).

   Returns:
     { ok: true, endsOn: "YYYY-MM", months: number }
     { ok: false, reason: "..." }      — propagates monthsToPayoff reasons */
export function computeLoanEndsOn(balance, annualRatePct, monthlyPayment, startYearMonth) {
  const result = monthsToPayoff(balance, annualRatePct, monthlyPayment);
  if (!result.ok) return result;
  const endsOn = addMonths(startYearMonth, result.months);
  if (!endsOn) return { ok: false, reason: "invalid-start" };
  return { ok: true, endsOn, months: result.months };
}

/* Convert "YYYY-MM" to a month index relative to a base year/month.
   Index 0 == base. Indices are 0..(years*12) for a projection of
   `years` years starting at base.

   Returns null if input is malformed. */
export function yearMonthToIndex(yearMonth, baseYearMonth) {
  const [yA, mA] = String(yearMonth).split("-").map(Number);
  const [yB, mB] = String(baseYearMonth).split("-").map(Number);
  if (!isFinite(yA) || !isFinite(mA) || !isFinite(yB) || !isFinite(mB)) return null;
  return (yA - yB) * 12 + (mA - mB);
}

/* Resolve a list of ending items to a flat array of monthly events
   that the forecast math layer can apply.
   ---------------------------------------------------------------
   Each event represents "starting at this month index, add `monthlyDelta`
   to `accountId`'s monthly contribution stream."

   Each ending obligation may link to one or more budget items
   (see getItemRefs). The `monthlyDelta` is the SUM of monthly amounts
   across all linked items. If ANY linked item fails to resolve to a
   positive monthly amount, the whole obligation orphans — partial
   summing would silently understate the obligation, which is worse
   than surfacing the broken link.

   For mode=ends + effect=ends: delta is +sum(monthlyAmount) of linked
                                items (the freed cash now flows to
                                destAccountId)
   For mode=ends + effect=starts (scaffolding, not user-exposed):
                                delta is -sum(monthlyAmount) until that
                                month, then 0 after — i.e. the
                                contribution only kicks in at endsOn.
                                Implementation: emit a negative-base
                                + positive-event.

   Inputs:
     endingItems       — array from st.forecast.endingItems
     monthlyAmountFor  — fn(itemRef) -> monthly $ amount, or null if linked
                         item is missing/orphaned. Called once per ref.
     baseYearMonth     — "YYYY-MM" of projection year 0 (e.g. "2026-01")
     horizonMonths     — total projection length in months

   Returns:
     {
       events: [{ accountId, monthIndex, monthlyDelta }, ...]
                — sorted ascending by monthIndex; events past horizon are dropped
       orphaned: [endingItem, ...]
                — items where any linked budget row could not be resolved
                  (or the refs list was empty)
       outOfHorizon: [endingItem, ...]
                — items whose endsOn falls past the horizon (skipped, but
                  surface in UI to clarify why nothing happened)
     }

   Notes on "ends" semantics:
     The freed cash flows from the FIRST FULL MONTH AFTER endsOn. If
     a loan ends in "2028-07" (paid off during July), the diversion
     starts in August. This matches intuition — you only get the cash
     back the month AFTER the last payment goes out. Index = endsOnIdx + 1.

     Edge case: if endsOn is exactly the base month or earlier, the
     event fires at month 1 (we treat the item as "already ending" but
     still requiring at least one month of forecast latency for safety).
*/
export function resolveEndingEvents(endingItems, monthlyAmountFor, baseYearMonth, horizonMonths) {
  const events = [];
  const orphaned = [];
  const outOfHorizon = [];

  if (!Array.isArray(endingItems) || endingItems.length === 0) {
    return { events, orphaned, outOfHorizon };
  }

  for (const ei of endingItems) {
    if (!ei || typeof ei !== "object") continue;
    if (!ei.destAccountId) continue;

    /* Resolve all linked refs. Sum their monthly amounts. If ANY ref
       fails (null/non-finite/<=0) we orphan the entire obligation —
       partial summing would silently misstate the obligation. An
       empty refs list also orphans (nothing to consume). */
    const refs = getItemRefs(ei);
    if (refs.length === 0) {
      orphaned.push(ei);
      continue;
    }
    let monthly = 0;
    let anyBad = false;
    for (const ref of refs) {
      const m = monthlyAmountFor(ref);
      if (m == null || !isFinite(m) || m <= 0) {
        anyBad = true;
        break;
      }
      monthly += m;
    }
    if (anyBad) {
      orphaned.push(ei);
      continue;
    }

    const endsOnIdx = yearMonthToIndex(ei.endsOn, baseYearMonth);
    if (endsOnIdx == null) {
      orphaned.push(ei);
      continue;
    }

    /* Freed cash starts flowing the month AFTER the last payment. */
    let fireIdx = endsOnIdx + 1;
    if (fireIdx < 1) fireIdx = 1; // never fire at index 0 (year-0 row is starting state)

    if (fireIdx > horizonMonths) {
      outOfHorizon.push(ei);
      continue;
    }

    const effect = ei.effect === "starts" ? "starts" : "ends";

    if (effect === "ends") {
      events.push({
        accountId: ei.destAccountId,
        monthIndex: fireIdx,
        monthlyDelta: monthly,
        sourceId: ei.id,
      });
    } else {
      /* "starts" scaffolding: the contribution only begins at endsOn.
         We emit a negative delta at month 1 (so the base stream is
         suppressed) and a positive delta at fireIdx (so it kicks in).
         This only makes sense if the caller has folded the obligation
         into the base contribution to begin with — which the UI for
         "starts" would do explicitly. For X-A we just emit both
         events; if no one is producing "starts" items, this branch
         is inert. */
      events.push({
        accountId: ei.destAccountId,
        monthIndex: 1,
        monthlyDelta: -monthly,
        sourceId: ei.id,
      });
      events.push({
        accountId: ei.destAccountId,
        monthIndex: fireIdx,
        monthlyDelta: monthly,
        sourceId: ei.id,
      });
    }
  }

  events.sort((a, b) => a.monthIndex - b.monthIndex);
  return { events, orphaned, outOfHorizon };
}

/* Helper: given a per-account event list, return a map
   { accountId -> [{ monthIndex, monthlyDelta }, ...] } sorted by monthIndex.
   Convenient for the math layer's inner loop. */
export function eventsByAccount(events) {
  const out = {};
  for (const e of events || []) {
    if (!out[e.accountId]) out[e.accountId] = [];
    out[e.accountId].push({ monthIndex: e.monthIndex, monthlyDelta: e.monthlyDelta });
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => a.monthIndex - b.monthIndex);
  }
  return out;
}

/* Validate that no two ending items reference the same budget line.
   The UI enforces this on save; this helper exists so the math layer
   (and any tests) can also assert the invariant.

   Multi-ref aware (Phase 14a): walks every ref in every obligation.
   If obligation A links to refs [X, Y] and B links to [Y], the
   conflict is on Y between A and B.

   Stable-IDs phase: keys by `ref.id` when present (preferred), falls
   back to `section::idx` for legacy refs. Mixing both within one
   data set is supported — a ref-with-id and a ref-without-id pointing
   at the same row by name/idx will NOT detect as conflicting (would
   require a resolution pass to compare). Migration eventually
   converges all refs to ids, after which conflict detection is exact.

   Returns array of conflict descriptions, empty if clean. */
export function findItemRefConflicts(endingItems) {
  const seen = new Map(); // key -> first ending-item id that claimed it
  const conflicts = [];
  for (const ei of endingItems || []) {
    if (!ei) continue;
    const refs = getItemRefs(ei);
    for (const ref of refs) {
      if (!ref || typeof ref.section !== "string") continue;
      // Prefer id-based key when ref has an id. Falls back to section::idx
      // for legacy refs without ids (key format preserved for back-compat
      // with callers that have inspected the conflict key string).
      let k;
      if (typeof ref.id === "string" && ref.id.length > 0) {
        k = `${ref.section}::id::${ref.id}`;
      } else if (typeof ref.idx === "number") {
        k = `${ref.section}::${ref.idx}`;
      } else {
        continue;
      }
      if (seen.has(k)) {
        conflicts.push({ key: k, ids: [seen.get(k), ei.id] });
      } else {
        seen.set(k, ei.id);
      }
    }
  }
  return conflicts;
}
