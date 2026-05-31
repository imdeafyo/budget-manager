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

/* Does this obligation reduce the FIRE retirement-spending target once it
   ends? (Phase: ending-obligations → FIRE step-down.)
   ---------------------------------------------------------------
   When an obligation ends, the freed cash flow already redirects to a
   forecast account (the contribution side). This flag governs the OTHER
   half: whether the ended expense should also be subtracted from the
   retirement-spending figure that drives the FIRE target — i.e. "I won't
   be paying this in retirement, so I don't need to fund it."

   Default ON. The reducesFire field is opt-OUT. The shim below treats a
   missing field as true so that (a) obligations saved before this feature
   existed and (b) the natural-intuition default both reduce the target.
   Only an explicit `reducesFire === false` opts out. */
export function reducesFire(ei) {
  if (!ei || typeof ei !== "object") return true;
  return ei.reducesFire !== false;
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

/* Convert a base-relative month index (the output of yearMonthToIndex,
   where index 0 == the base month) to the ABSOLUTE simulated month
   index that the forecast loop in calc.js uses.

   The loop's convention is:

       absMonth = (y - 1) * 12 + m + 1   // y = loop year ≥ 1, m = 0..11
       calendarYear = baseYear + y

   i.e. loop year 0 is the entire base calendar year (starting-balance
   snapshot, no simulation) and simulated month 1 is January of
   baseYear + 1. yearMonthToIndex, by contrast, measures months from the
   base month itself, so for a base of "2026-01" it maps 2027-01 → 12,
   while the loop expects that same month at absMonth 1.

   The offset between the two is a constant `baseMonth - 12` for a given
   base (derived: absMonth - baseRelIdx = baseMonth - 12, independent of
   the target date). Applying it here keeps yearMonthToIndex usable as a
   general "months between two YYYY-MM" primitive while the event
   resolvers feed the loop correctly.

   Without this conversion, ending obligations (and one-time events,
   which had the analogous bug in oneTimeEvents.js) fired a full year
   late — a mortgage ending 2030-06 freed its cash in 2031 instead of
   2030. */
export function baseRelativeToLoopMonth(baseRelIdx, baseYearMonth) {
  if (baseRelIdx == null) return null;
  const mB = Number(String(baseYearMonth).split("-")[1]);
  if (!isFinite(mB)) return null;
  return baseRelIdx + (mB - 12);
}

/* Convert a one-time event date ("YYYY-MM-DD" or "YYYY-MM") to the
   "YYYY-MM" shape ending obligations use for `endsOn`. Returns null on
   malformed input. Day component is discarded — obligations are
   month-precise. */
export function eventDateToYearMonth(dateStr) {
  if (typeof dateStr !== "string") return null;
  const m = dateStr.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/* Apply early-payoff links from one-time events onto ending obligations.
   ---------------------------------------------------------------
   A one-time event may carry `linkedEndingId` pointing at an ending
   obligation. Semantics ("event date wins while linked"):

     - The event itself still drains its own (manually-entered) `amount`
       from its own `accountId` on its own `date` — this function does
       NOT touch the events, only the obligations.
     - The linked obligation's effective end date is OVERRIDDEN to the
       event's month. The obligation's stored `endsOn`/`mode` are ignored
       while a link is active, so the freed monthly payment starts the
       month after the early payoff rather than the original schedule.

   Returns a NEW ending-items array (originals untouched — pure). Linked
   obligations get `endsOn` set to the event's YYYY-MM and `mode` forced
   to "date" so loan-mode recomputation can't fight the override. An
   `_payoffLinkedFrom` field (the event id) is stamped for UI/debug; it's
   inert in the resolver.

   Conflict handling: if two events link the same obligation, the EARLIER
   event date wins (you can't pay the same thing off twice; the first
   payoff is the one that frees the cash). Events with a missing/unparseable
   date, or pointing at an obligation that doesn't exist, are ignored here
   — they're surfaced elsewhere (the event still drains its account; a
   dangling link just means no override happens).

   This runs BEFORE resolveEndingEvents in the tab, so the override flows
   through the normal resolution path with no special-casing downstream. */
export function applyPayoffLinks(endingItems, oneTimeEvents, computedPayoffById = null) {
  if (!Array.isArray(endingItems) || endingItems.length === 0) return endingItems || [];
  if (!Array.isArray(oneTimeEvents) || oneTimeEvents.length === 0) return endingItems;

  // Build endingId -> earliest overriding YYYY-MM (+ source event id).
  const overrides = {};
  for (const ev of oneTimeEvents) {
    if (!ev || typeof ev !== "object") continue;
    const linkedId = ev.linkedEndingId;
    if (!linkedId) continue;
    const ym = eventDateToYearMonth(ev.date);
    if (!ym) continue;
    const prev = overrides[linkedId];
    // Earlier date wins on conflict (string compare works for YYYY-MM).
    if (!prev || ym < prev.endsOn) {
      overrides[linkedId] = { endsOn: ym, eventId: ev.id };
    }
  }
  if (Object.keys(overrides).length === 0) return endingItems;

  return endingItems.map(ei => {
    if (!ei || typeof ei !== "object") return ei;
    const ov = overrides[ei.id];
    if (!ov) return ei;

    /* Loan-mode obligation with a computed payoff date supplied:
       the lump-sum paydown is handled by the debt engine
       (debtPrincipalByMonth) which already accounts for the principal
       reduction and recomputes when the loan retires. We keep the
       obligation in LOAN mode and set endsOn to that COMPUTED payoff
       month, so the freed-cash resolver and the debt curve agree on
       when the loan ends. We do NOT force date mode here — that was the
       old behavior that left a loan stuck showing "Date" after linking.
       A partial paydown therefore correctly ends the loan later than the
       event date; a full payoff ends it at (or near) the event date. */
    if (ei.mode === "loan" && computedPayoffById && computedPayoffById[ei.id]) {
      return {
        ...ei,
        endsOn: computedPayoffById[ei.id],
        _payoffLinkedFrom: ov.eventId,
      };
    }

    /* Date-mode obligation (or loan-mode without a computed payoff):
       the event date wins and the obligation behaves as a fixed-date
       ending at the event's month. */
    return {
      ...ei,
      endsOn: ov.endsOn,
      mode: "date",
      _payoffLinkedFrom: ov.eventId,
    };
  });
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

    /* Freed cash starts flowing the month AFTER the last payment.
       Convert from base-relative (yearMonthToIndex) to the loop's
       absolute month index before adding 1, so the freed cash lands in
       the correct calendar year (see baseRelativeToLoopMonth). */
    let fireIdx = baseRelativeToLoopMonth(endsOnIdx, baseYearMonth) + 1;
    if (fireIdx < 1) fireIdx = 1; // never fire before year-1 (year-0 row is starting state)

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

/* Months between two "YYYY-MM" strings, asOf -> base.
   Positive when base is later than asOf (the typical case — balance was
   entered N months ago). Zero when equal. Negative when asOf is in the
   future relative to base (caller should treat as "no roll needed").
   Returns null if either input is malformed. */
export function monthsSinceAsOf(asOfYearMonth, baseYearMonth) {
  if (!asOfYearMonth || !baseYearMonth) return null;
  const [yA, mA] = String(asOfYearMonth).split("-").map(Number);
  const [yB, mB] = String(baseYearMonth).split("-").map(Number);
  if (![yA, mA, yB, mB].every((n) => isFinite(n))) return null;
  return (yB - yA) * 12 + (mB - mA);
}

/* Roll a loan balance forward in time. Given a balance stated as-of
   some past month, advance it month-by-month to `baseYearMonth` using
   standard amortization: each month, interest accrues at annualRatePct
   on the balance, then the monthlyPayment is applied.

   Returns:
     { ok: true, rolledBalance, monthsRolled, paidOffDuringRoll }
       paidOffDuringRoll is true if the balance hit zero during the roll
       (rolledBalance will be 0). monthsRolled is the count of months
       actually simulated (may be less than the as-of -> base distance
       if the loan paid off early).
     { ok: false, reason }
       "invalid-input"     bad rates/dates
       "no-roll-needed"    asOf >= base (rolledBalance = balance)

   Notes:
     - Annual rate is in PERCENT (5.25 means 5.25%).
     - Neg-am during the roll is allowed (balance grows; we don't fail).
       The downstream amortization will surface neg-am as its own error.
     - This is the same math the user's lender uses month-to-month, so
       the rolled balance should match the lender's current statement to
       within a few dollars (closer if the as-of date matches a statement
       cycle). */
export function rollForwardBalance(balance, annualRatePct, monthlyPayment, asOfYearMonth, baseYearMonth) {
  const bal0 = Number(balance);
  const rPct = Number(annualRatePct);
  const pay = Number(monthlyPayment);

  if (!isFinite(bal0) || bal0 <= 0) return { ok: false, reason: "invalid-input" };
  if (!isFinite(rPct) || rPct < 0) return { ok: false, reason: "invalid-input" };
  if (!isFinite(pay) || pay < 0) return { ok: false, reason: "invalid-input" };

  const n = monthsSinceAsOf(asOfYearMonth, baseYearMonth);
  if (n === null) return { ok: false, reason: "invalid-input" };
  if (n <= 0) {
    /* No-op: as-of is current or in the future. Treat as "balance is
       already correct as of base". */
    return { ok: true, rolledBalance: bal0, monthsRolled: 0, paidOffDuringRoll: false };
  }

  const r = (rPct / 100) / 12;
  let bal = bal0;
  let paidOff = false;
  let i = 0;
  for (; i < n; i++) {
    const interest = bal * r;
    const next = bal + interest - pay;
    if (next <= 0) {
      bal = 0;
      paidOff = true;
      i++;
      break;
    }
    bal = next;
  }
  return { ok: true, rolledBalance: bal, monthsRolled: i, paidOffDuringRoll: paidOff };
}

/* Outstanding principal of a loan-mode obligation, month by month,
   with lump-sum paydowns applied.
   ===============================================================
   This is the engine behind the Advanced tab's "Debt Remaining" column
   for loan-mode ending obligations (NOT the standalone Loans-tab
   scratchpad). It walks standard amortization from `startBalance` at the
   obligation's monthly payment, applying any lump-sum payments at their
   month, and returns the principal owed at every month index 0..N.

   Lump sums (e.g. from one-time payoff events) reduce principal directly.
   How the schedule reacts is controlled by `recastMode`:

     "shorten" (default) — keep the same monthly payment; the loan simply
                           amortizes to zero sooner, saving interest. This
                           is the realistic mortgage-prepayment behavior.
     "lower"             — keep the original payoff month; the monthly
                           payment is recomputed downward after each lump
                           sum so the (now smaller) balance still retires
                           on the original schedule. Models a formal recast.

   Index convention matches the forecast loop / the rest of this module:
   index 0 is the base month (starting principal, before any payment),
   index k is the balance after k monthly steps. Lump sums are keyed by
   the SAME absolute month index the forecast loop uses, so a payoff event
   resolved to monthIndex M pays down principal between step M-1 and M
   (i.e. it lands "at" month M, before that month's interest accrues — a
   prepayment, the lender-favorable-to-borrower timing).

   Args:
     params = {
       startBalance,        // principal at base month (already rolled
                            //   forward to base if the loan predates it)
       annualRatePct,       // e.g. 6.5
       monthlyPayment,      // the obligation's summed linked monthly $
       horizonMonths,       // how many months to project (inclusive of 0)
       lumpSums,            // [{ monthIndex, amount }] — amount > 0 pays
                            //   DOWN principal. monthIndex is absolute
                            //   (loop convention). Multiple allowed; they
                            //   stack. Sorted internally.
       recastMode,          // "shorten" | "lower"  (default "shorten")
       originalPayoffMonth, // required for "lower": the month index the
                            //   loan would retire WITHOUT paydowns, used
                            //   as the recast target. Ignored for "shorten".
     }

   Returns:
     {
       ok: true,
       balanceByMonth: number[],   // length horizonMonths+1, principal at
                                   //   each index (0 once paid off)
       payoffMonth: number|null,   // first index where balance hits 0
                                   //   (null if still owing at horizon)
       totalInterest: number,      // interest paid across the horizon
       lumpSumTotal: number,       // sum of applied paydowns
       paymentByMonth: number[],   // monthly payment in force each month
                                   //   (constant in "shorten"; steps down
                                   //   after each lump in "lower")
     }
     { ok: false, reason }         // bad inputs / negative amortization

   Notes:
     - A lump sum >= current balance fully retires the loan that month;
       remaining months are 0. Excess is NOT carried to other loans here
       (the caller decides what an over-payment means).
     - Negative-amortization (payment doesn't cover interest) on the
       starting balance returns ok:false — the same guard monthsToPayoff
       uses — UNLESS lump sums bring it back into amortizing territory,
       which the per-month walk handles naturally.
     - "lower" recast recomputes payment via monthsToPayoff's closed form
       so the recast is exact, not iterative. */
export function debtPrincipalByMonth(params) {
  const {
    startBalance,
    annualRatePct,
    monthlyPayment,
    horizonMonths,
    lumpSums = [],
    recastMode = "shorten",
    originalPayoffMonth = null,
  } = params || {};

  const P0 = Number(startBalance);
  const rPct = Number(annualRatePct);
  const N = Number(horizonMonths);

  if (!isFinite(P0) || P0 < 0) return { ok: false, reason: "invalid-balance" };
  if (!isFinite(rPct) || rPct < 0) return { ok: false, reason: "invalid-rate" };
  if (!isFinite(N) || N < 0) return { ok: false, reason: "invalid-horizon" };

  const r = (rPct / 100) / 12;

  // Group lump sums by month index (stacking same-month entries).
  const lumpByMonth = new Map();
  for (const ls of (Array.isArray(lumpSums) ? lumpSums : [])) {
    if (!ls || typeof ls !== "object") continue;
    const mi = Math.round(Number(ls.monthIndex));
    const amt = Number(ls.amount);
    if (!isFinite(mi) || mi < 0) continue;
    if (!isFinite(amt) || amt <= 0) continue;
    lumpByMonth.set(mi, (lumpByMonth.get(mi) || 0) + amt);
  }

  let payment = Number(monthlyPayment);
  if (!isFinite(payment) || payment < 0) return { ok: false, reason: "invalid-payment" };

  /* Recompute the level payment that retires `bal` by `targetMonth`,
     starting from `fromMonth`. Closed-form annuity payment. Used by the
     "lower" recast after each lump sum. Returns the original payment if
     the target is unreachable/degenerate (defensive — never raises it). */
  const recastPayment = (bal, fromMonth, targetMonth) => {
    const monthsLeft = targetMonth - fromMonth;
    if (monthsLeft <= 0 || bal <= 0) return payment;
    if (r === 0) return bal / monthsLeft;
    const factor = Math.pow(1 + r, monthsLeft);
    const newPay = (bal * r * factor) / (factor - 1);
    return isFinite(newPay) && newPay > 0 ? newPay : payment;
  };

  const balanceByMonth = new Array(N + 1).fill(0);
  const paymentByMonth = new Array(N + 1).fill(0);
  let bal = P0;
  let totalInterest = 0;
  let lumpSumTotal = 0;
  let payoffMonth = (P0 <= 0) ? 0 : null;

  // Apply any lump sum keyed to month 0 before recording the starting point.
  if (lumpByMonth.has(0) && bal > 0) {
    const pay = Math.min(lumpByMonth.get(0), bal);
    bal -= pay;
    lumpSumTotal += pay;
    if (bal <= 0) { bal = 0; payoffMonth = 0; }
    else if (recastMode === "lower" && originalPayoffMonth != null) {
      payment = recastPayment(bal, 0, originalPayoffMonth);
    }
  }
  balanceByMonth[0] = bal;
  paymentByMonth[0] = bal > 0 ? payment : 0;

  for (let m = 1; m <= N; m++) {
    if (bal <= 0) {
      balanceByMonth[m] = 0;
      paymentByMonth[m] = 0;
      continue;
    }

    // Lump sum lands at the start of month m (prepayment, pre-interest).
    if (lumpByMonth.has(m)) {
      const pay = Math.min(lumpByMonth.get(m), bal);
      bal -= pay;
      lumpSumTotal += pay;
      if (bal <= 0) {
        bal = 0;
        balanceByMonth[m] = 0;
        paymentByMonth[m] = 0;
        if (payoffMonth === null) payoffMonth = m;
        continue;
      }
      if (recastMode === "lower" && originalPayoffMonth != null) {
        payment = recastPayment(bal, m, originalPayoffMonth);
      }
    }

    const interest = bal * r;
    paymentByMonth[m] = payment;
    let next = bal + interest - payment;

    if (next <= 0.005) {
      // Final partial payment — interest still accrues on the last stub.
      // The 0.005 epsilon catches loans that retire exactly on schedule
      // where float drift would otherwise leave a sub-cent balance and
      // report payoffMonth = null forever.
      totalInterest += interest;
      bal = 0;
      balanceByMonth[m] = 0;
      if (payoffMonth === null) payoffMonth = m;
      continue;
    }

    // Neg-am guard: only an error if NO lump sum will ever rescue it.
    // We don't fail the whole call here — we cap interest accrual and let
    // the balance grow, surfacing the problem as "never pays off"
    // (payoffMonth stays null). Callers already warn on that.
    totalInterest += interest;
    bal = next;
    balanceByMonth[m] = bal;
  }

  return {
    ok: true,
    balanceByMonth,
    payoffMonth,
    totalInterest,
    lumpSumTotal,
    paymentByMonth,
  };
}

/* Aggregate loan-mode obligation debt across the horizon, applying
   linked one-time payoff events as lump-sum paydowns.
   ===============================================================
   Pure orchestration over debtPrincipalByMonth so the Advanced tab (and
   tests) get a single entry point. The tab supplies resolved monthly
   amounts and rolled balances via callbacks, keeping this decoupled from
   budget-item resolution.

   Args:
     loanObligations  — ending items with mode === "loan" (caller filters)
     opts = {
       monthlyFor(ei)        -> summed monthly $ across linked refs, or
                                null/<=0 if unresolved (obligation skipped)
       startBalanceFor(ei)   -> principal rolled forward to base, or <=0
                                to skip (already paid off / no balance)
       lumpSumsFor(ei)       -> [{ monthIndex, amount }] paydowns for this
                                obligation (from linked payoff events)
       baseYearMonth         -> "YYYY-MM"
       horizonMonths         -> integer
     }

   Returns:
     {
       byYear: { [year]: { total, perLoan: { [id]: bal } } },  // year 0..H/12
       payoffById: { [id]: "YYYY-MM" },  // computed post-paydown payoff month
     }

   Each obligation's recastMode ("shorten" default | "lower") is honored;
   for "lower" the original (no-paydown) payoff month is computed first to
   serve as the recast target. */
export function aggregateObligationDebt(loanObligations, opts) {
  const { monthlyFor, startBalanceFor, lumpSumsFor, baseYearMonth, horizonMonths } = opts || {};
  const yMax = Math.floor((Number(horizonMonths) || 0) / 12);
  const byYear = {};
  const payoffById = {};
  for (let y = 0; y <= yMax; y++) byYear[y] = { total: 0, perLoan: {} };
  if (!Array.isArray(loanObligations)) return { byYear, payoffById };

  for (const ei of loanObligations) {
    if (!ei || ei.mode !== "loan") continue;
    if (Array.isArray(ei.subLoans) && ei.subLoans.length > 0) continue;

    const monthly = monthlyFor ? monthlyFor(ei) : null;
    if (monthly == null || !isFinite(monthly) || monthly <= 0) continue;

    const startBalance = startBalanceFor ? startBalanceFor(ei) : Number(ei.balance) || 0;
    if (!isFinite(startBalance) || startBalance <= 0) continue;

    const lumpSums = (lumpSumsFor ? lumpSumsFor(ei) : []) || [];

    let originalPayoffMonth = null;
    if ((ei.recastMode || "shorten") === "lower") {
      const baseRun = debtPrincipalByMonth({
        startBalance, annualRatePct: ei.annualRate, monthlyPayment: monthly, horizonMonths,
      });
      if (baseRun.ok) originalPayoffMonth = baseRun.payoffMonth;
    }

    const run = debtPrincipalByMonth({
      startBalance,
      annualRatePct: ei.annualRate,
      monthlyPayment: monthly,
      horizonMonths,
      lumpSums,
      recastMode: ei.recastMode || "shorten",
      originalPayoffMonth,
    });
    if (!run.ok) continue;

    for (let y = 0; y <= yMax; y++) {
      const bal = run.balanceByMonth[y * 12] || 0;
      byYear[y].perLoan[ei.id] = bal;
      byYear[y].total += bal;
    }
    if (run.payoffMonth != null) {
      const ym = addMonths(baseYearMonth, run.payoffMonth);
      if (ym) payoffById[ei.id] = ym;
    }
  }
  return { byYear, payoffById };
}

/* Aggregate routed linked-item monthly amounts by sub-loan and slot.
   ---------------------------------------------------------------
   In the per-item routing model (Phase 14b follow-up), each linked
   budget-item ref carries a `routedTo: { subLoanId, slot }` field.
   `slot` is "required" or "extra". `routedTo: null` (or missing)
   means the ref is unallocated — its cash flows into the obligation
   but isn't claimed by any sub-loan.

   This helper walks parallel `refs` and `refResolutions` arrays and
   returns a per-sub-loan map of the routed monthly totals.

   Inputs:
     refs              — array from getItemRefs(ei); each may carry
                         a `routedTo: { subLoanId, slot }` field
     refResolutions    — parallel array as built by AdvancedForecastTab:
                         each element has { ref, monthly, isOrphan, ... }.
                         An orphaned (or null-monthly) row is skipped.
     subLoanIds        — array of currently-existing sub-loan ids.
                         Used to detect orphan routings (the user
                         deleted a sub-loan but a ref still routes
                         to its old id).

   Returns:
     {
       byId: {
         [subLoanId]: {
           required: number,
           extra: number,
           requiredSources: string[],  // names of refs routing here as required
           extraSources: string[],     // names of refs routing here as extra
         }
       },
       unallocated: number,            // sum of monthly amounts whose routedTo is null
                                       //   or has an orphan subLoanId
       unallocatedSources: string[],   // names of refs in the unallocated pool
       orphanRoutings: [{ refName, subLoanId, slot }]  // routings pointing at
                                                       //   deleted sub-loan ids
     }

   Behavior notes:
     - Resolutions where `monthly` is null/non-finite/<=0 are SILENTLY
       SKIPPED. They show up elsewhere (orphan banner on the obligation
       row). The whole-obligation orphan signal stays the source of
       truth for "this obligation isn't pulling anything"; this helper
       just keeps the routed-totals map clean of NaNs.
     - A ref with `routedTo: { subLoanId: "X", slot: "required" }`
       where "X" isn't in subLoanIds → goes to orphanRoutings AND its
       monthly contributes to `unallocated`. We treat the routing
       as broken and the cash as no-longer-claimed (consistent with
       how a deleted-sub-loan would behave).
     - A ref with malformed routedTo (missing subLoanId, or slot not
       in {"required","extra"}) is also treated as unallocated. */
export function routedTotalsBySubLoan(refs, refResolutions, subLoanIds) {
  const byId = {};
  const orphanRoutings = [];
  const unallocatedSources = [];
  let unallocated = 0;

  const validSlots = new Set(["required", "extra"]);
  const slIdSet = new Set(Array.isArray(subLoanIds) ? subLoanIds : []);

  const safeRefs = Array.isArray(refs) ? refs : [];
  const safeRes = Array.isArray(refResolutions) ? refResolutions : [];
  const n = Math.min(safeRefs.length, safeRes.length);

  for (let i = 0; i < n; i++) {
    const ref = safeRefs[i];
    const rr = safeRes[i];
    if (!ref || !rr) continue;
    const m = Number(rr.monthly);
    if (!isFinite(m) || m <= 0) continue;

    const refName = (ref && typeof ref.name === "string") ? ref.name : "(unnamed)";
    const rt = ref.routedTo;

    const routedOk = rt
      && typeof rt === "object"
      && typeof rt.subLoanId === "string"
      && rt.subLoanId.length > 0
      && validSlots.has(rt.slot);

    if (!routedOk) {
      unallocated += m;
      unallocatedSources.push(refName);
      continue;
    }

    if (!slIdSet.has(rt.subLoanId)) {
      /* Routing points at a sub-loan that no longer exists. Surface
         the orphan AND push the cash into unallocated — the user
         needs to either remove the routing or re-route to an
         existing sub-loan. */
      orphanRoutings.push({ refName, subLoanId: rt.subLoanId, slot: rt.slot });
      unallocated += m;
      unallocatedSources.push(refName);
      continue;
    }

    if (!byId[rt.subLoanId]) {
      byId[rt.subLoanId] = {
        required: 0,
        extra: 0,
        requiredSources: [],
        extraSources: [],
      };
    }
    if (rt.slot === "required") {
      byId[rt.subLoanId].required += m;
      byId[rt.subLoanId].requiredSources.push(refName);
    } else {
      byId[rt.subLoanId].extra += m;
      byId[rt.subLoanId].extraSources.push(refName);
    }
  }

  return { byId, unallocated, unallocatedSources, orphanRoutings };
}

/* Per-year FIRE retirement-spending reduction.
   ---------------------------------------------------------------
   For the FIRE step-down: returns an array of length `years + 1` where
   index y is the ANNUAL reduction (today's dollars) to subtract from
   retirement spending once every obligation that (a) reduces FIRE and
   (b) has ended by year y is accounted for.

   "Ended by year y" uses the same endsOn index as resolveEndingEvents:
   freed the month after the last payment (endsOnIdx + 1). We convert
   that fire month index to a fractional year and treat the obligation
   as reducing spend from the first projection year boundary at or after
   it. Concretely: an obligation freeing at month index `fireIdx` reduces
   spending for every year y where y*12 >= fireIdx — i.e. once a full
   projection year has reached the freeing point. This keeps the step
   aligned with the integer-year crossover grid the chart/target use.

   Monthly amount → annual is ×12 here (calendar months), matching the
   retirement-spending frame (annual after-tax spend), NOT the 48-paycheck
   budget basis. The linked budget amounts arrive already-monthly from
   `monthlyAmountFor`, so a $2,000/mo mortgage reduces annual spend by
   $24,000 once it ends.

   Only `effect === "ends"` obligations with `reducesFire(ei)` true and a
   resolvable, in-range endsOn contribute. Orphaned / out-of-horizon /
   opted-out / starts-effect obligations contribute zero (they leave the
   target unchanged), which is the safe direction — a broken link should
   never silently LOWER the target and make FIRE look closer than it is.

   Args mirror resolveEndingEvents:
     endingItems     — the obligations array
     monthlyAmountFor— (ref) => monthly amount or null
     baseYearMonth   — "YYYY-MM" of projection year 0
     years           — integer projection horizon in years

   Returns:
     {
       reductionByYear: number[],   // length years+1, cumulative annual reduction
       contributors: [{ id, annualReduction, freesAtYear }],  // for UI/debug
     }
*/
export function fireSpendingReductionByYear(endingItems, monthlyAmountFor, baseYearMonth, years) {
  const n = Math.max(0, Math.floor(Number(years) || 0));
  const reductionByYear = new Array(n + 1).fill(0);
  const contributors = [];

  if (!Array.isArray(endingItems) || endingItems.length === 0) {
    return { reductionByYear, contributors };
  }

  const horizonMonths = n * 12;

  for (const ei of endingItems) {
    if (!ei || typeof ei !== "object") continue;
    if (!reducesFire(ei)) continue;
    // A "starts" obligation raises future spend, not lowers it; it must
    // never reduce the FIRE target. UI only exposes "ends" today, but be
    // explicit so scaffolding can't leak a wrong-signed reduction.
    if (ei.effect === "starts") continue;

    const refs = getItemRefs(ei);
    if (refs.length === 0) continue;

    let monthly = 0;
    let anyBad = false;
    for (const ref of refs) {
      const m = monthlyAmountFor(ref);
      if (m == null || !isFinite(m) || m <= 0) { anyBad = true; break; }
      monthly += m;
    }
    if (anyBad) continue;

    const endsOnIdx = yearMonthToIndex(ei.endsOn, baseYearMonth);
    if (endsOnIdx == null) continue;

    // Same base-relative → loop-absolute conversion as resolveEndingEvents,
    // so the FIRE-target reduction steps down in the right calendar year.
    let fireIdx = baseRelativeToLoopMonth(endsOnIdx, baseYearMonth) + 1;
    if (fireIdx < 1) fireIdx = 1;
    if (fireIdx > horizonMonths) continue; // out of horizon: no step within chart

    const annualReduction = monthly * 12;
    // First integer projection year at/after the freeing month.
    const freesAtYear = Math.ceil(fireIdx / 12);
    contributors.push({ id: ei.id, annualReduction, freesAtYear });

    for (let y = freesAtYear; y <= n; y++) {
      reductionByYear[y] += annualReduction;
    }
  }

  contributors.sort((a, b) => a.freesAtYear - b.freesAtYear);
  return { reductionByYear, contributors };
}
