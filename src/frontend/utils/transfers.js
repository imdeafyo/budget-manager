/* ══════════════════════════ Transfer detection — pure helpers ══════════════════════════
   When money moves between your own accounts (checking → savings, paydown to a
   credit card, HYSA shuffling), your bank exports the event as *two* transaction
   rows — one negative on the source account, one positive on the destination.
   Neither is real spending or real income. If left un-flagged, both halves show
   up in the Phase 6 budget-vs-actual chart and distort every number.

   Rule-based marking (via the `mark_transfer` rule action in utils/rules.js)
   already handles the easy case — rows whose description literally contains
   "Transfer". This module handles the harder case: finding the *paired* rows
   in the data by their shape (opposing amounts, close dates, different
   accounts) even when the descriptions don't match.

   Flag fields stored on a transaction's `custom_fields`:
   - `_is_transfer`        : boolean — this row should be excluded from spending/income totals.
                             Can be set by rules OR by pairing. Presence alone is enough.
   - `_transfer_pair_id`   : string — the id of the *other* row in the pair. Optional;
                             only set when pairing found a partner. Rule-based marking
                             leaves this undefined. Removing the pair flag without
                             clearing this field is a soft bug — callers should use
                             `unpair(tx)` which clears both together.
   - `_transfer_dismissed` : boolean — user has explicitly said "these are not a transfer,
                             stop suggesting them." Excludes the row from future pairing
                             passes so dismissed candidates don't keep resurfacing.

   All functions in this module are pure — no side effects, no state reads. The
   caller is responsible for persisting the returned transactions.
*/

const DAY_MS = 24 * 60 * 60 * 1000;

/* Parse an ISO yyyy-mm-dd date into a UTC Date. Returns null for invalid input. */
function parseDate(s) {
  if (!s || typeof s !== "string") return null;
  // Accept "yyyy-mm-dd" strictly — times and timezones would complicate the
  // "within N days" check. Our transaction rows are always date-only.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
  const t = Date.UTC(y, mo, d);
  if (isNaN(t)) return null;
  return new Date(t);
}

/* Absolute day difference between two ISO dates, integer. Returns Infinity if either is invalid. */
export function dayDiff(aIso, bIso) {
  const a = parseDate(aIso);
  const b = parseDate(bIso);
  if (!a || !b) return Infinity;
  return Math.round(Math.abs((a.getTime() - b.getTime()) / DAY_MS));
}

/* Can this row participate in pairing at all?
   Excluded:
   - already marked _is_transfer (rule-based or previously paired)
   - already dismissed (user said don't suggest)
   - has splits (splits mean the user has broken this into multiple allocations;
     we don't try to pair them — if one side of a transfer needs splitting, the
     user can unsplit it first)
   - amount is zero or missing
   - date is missing/invalid
*/
export function isPairEligible(tx) {
  if (!tx || typeof tx !== "object") return false;
  const cf = tx.custom_fields || {};
  if (cf._is_transfer) return false;
  if (cf._transfer_dismissed) return false;
  if (Array.isArray(tx.splits) && tx.splits.length > 0) return false;
  const amt = Number(tx.amount);
  if (!isFinite(amt) || amt === 0) return false;
  if (!parseDate(tx.date)) return false;
  return true;
}

/* Does this pair of rows look like two sides of the same transfer?
   Caller is responsible for eligibility — this only compares shape. */
export function isCandidatePair(a, b, opts = {}) {
  const {
    amountTolerance = 0.01,
    dayTolerance = 2,
    requireDifferentAccounts = true,
  } = opts;

  if (!a || !b || a.id === b.id) return false;

  // Opposing amounts: a.amount + b.amount ≈ 0 (within tolerance).
  const aAmt = Number(a.amount) || 0;
  const bAmt = Number(b.amount) || 0;
  if (Math.sign(aAmt) === Math.sign(bAmt)) return false; // same sign = not a pair
  if (Math.abs(aAmt + bAmt) > amountTolerance) return false;

  // Date within tolerance.
  if (dayDiff(a.date, b.date) > dayTolerance) return false;

  // Different accounts (by default — some users might only have one tagged account).
  if (requireDifferentAccounts) {
    const aAcct = (a.account || "").trim();
    const bAcct = (b.account || "").trim();
    if (aAcct && bAcct && aAcct === bAcct) return false;
  }

  // Different currencies are never a transfer for our purposes — FX pairing
  // would need a separate amount-compare strategy. Treat missing currency as
  // matching (defaults to USD elsewhere in the app).
  const aCur = (a.currency || "USD").toUpperCase();
  const bCur = (b.currency || "USD").toUpperCase();
  if (aCur !== bCur) return false;

  return true;
}

/* Build a human-readable explanation for why two rows were paired.
   Surfaced in the confirmation modal so the user can sanity-check each pair. */
export function pairReason(a, b) {
  const dd = dayDiff(a.date, b.date);
  const sameAcct = (a.account || "").trim() && (a.account || "").trim() === (b.account || "").trim();
  const parts = [];
  parts.push("opposing amounts");
  if (dd === 0) parts.push("same day");
  else if (dd === 1) parts.push("1 day apart");
  else parts.push(`${dd} days apart`);
  if (sameAcct) parts.push("same account");
  else if (a.account && b.account) parts.push("different accounts");
  return parts.join(", ");
}

/* A simple confidence heuristic — closer dates and exactly-matching amounts
   score higher. Same-day + penny-exact is 1.0; 2 days apart with a 1¢ diff
   is lower. Used only to break ties when the same row has multiple candidate
   partners, and to sort the modal (best matches first). */
export function pairConfidence(a, b, opts = {}) {
  const { amountTolerance = 0.01, dayTolerance = 2 } = opts;
  const aAmt = Number(a.amount) || 0;
  const bAmt = Number(b.amount) || 0;
  const amtDiff = Math.abs(aAmt + bAmt);
  const dd = dayDiff(a.date, b.date);
  const amtScore = 1 - Math.min(1, amtDiff / Math.max(amountTolerance, 0.0001));
  const dateScore = 1 - Math.min(1, dd / Math.max(dayTolerance, 1));
  // Weight date and amount equally. Same-account gets a small penalty so that
  // if the same row has two candidates with equal score but one is cross-account,
  // the cross-account wins.
  let score = 0.5 * amtScore + 0.5 * dateScore;
  const aAcct = (a.account || "").trim();
  const bAcct = (b.account || "").trim();
  if (aAcct && bAcct && aAcct === bAcct) score -= 0.05;
  return Math.max(0, Math.min(1, score));
}

/* Find all candidate transfer pairs in a transaction list.

   Strategy:
   1. Filter to eligible rows only.
   2. Sort by date (stable — earliest first).
   3. For each eligible row, scan forward up to `dayTolerance` days ahead for
      any other eligible row it can pair with.
   4. Build the full candidate edge list with confidence scores.
   5. Greedy assignment: sort edges by confidence desc, then by earliest date
      asc as a tiebreaker. For each edge, claim both endpoints if neither is
      already claimed. First match wins. This guarantees each row ends up in
      at most one pair.

   Returns: [{ a, b, confidence, reason }] — the full pairs the user can
   review, pre-sorted by confidence (best first). */
export function findTransferCandidates(transactions, opts = {}) {
  const {
    amountTolerance = 0.01,
    dayTolerance = 2,
    requireDifferentAccounts = true,
  } = opts;

  if (!Array.isArray(transactions) || transactions.length < 2) return [];

  const eligible = transactions.filter(isPairEligible);
  if (eligible.length < 2) return [];

  // Stable sort by date asc, then by id for deterministic tiebreak.
  const sorted = eligible.slice().sort((x, y) => {
    if (x.date < y.date) return -1;
    if (x.date > y.date) return 1;
    return (x.id || "") < (y.id || "") ? -1 : 1;
  });

  // Build candidate edges.
  const edges = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      // sorted by date asc — once b is past a's window, stop scanning this row.
      if (dayDiff(a.date, b.date) > dayTolerance) break;
      if (!isCandidatePair(a, b, { amountTolerance, dayTolerance, requireDifferentAccounts })) continue;
      edges.push({
        a, b,
        confidence: pairConfidence(a, b, { amountTolerance, dayTolerance }),
        reason: pairReason(a, b),
      });
    }
  }

  // Greedy assignment — highest confidence first, then earliest date, then id order.
  edges.sort((e1, e2) => {
    if (e2.confidence !== e1.confidence) return e2.confidence - e1.confidence;
    const d1 = e1.a.date < e1.b.date ? e1.a.date : e1.b.date;
    const d2 = e2.a.date < e2.b.date ? e2.a.date : e2.b.date;
    if (d1 !== d2) return d1 < d2 ? -1 : 1;
    return (e1.a.id || "") < (e2.a.id || "") ? -1 : 1;
  });

  const claimed = new Set();
  const pairs = [];
  for (const edge of edges) {
    if (claimed.has(edge.a.id) || claimed.has(edge.b.id)) continue;
    claimed.add(edge.a.id);
    claimed.add(edge.b.id);
    pairs.push(edge);
  }

  return pairs;
}

/* Mark a transaction as paired. Sets _is_transfer and _transfer_pair_id.
   Also clears _transfer_dismissed if it was set — if the user is actively
   pairing a row, it's no longer dismissed. */
export function markPaired(tx, partnerId) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  cf._is_transfer = true;
  cf._transfer_pair_id = partnerId;
  delete cf._transfer_dismissed;
  return { ...tx, custom_fields: cf };
}

/* Remove pairing from a transaction. Clears _is_transfer and _transfer_pair_id.
   Sets _transfer_dismissed=true so the detection algorithm won't re-suggest
   this row on a future pass. (Per design decision: unpairing should leave a
   record that the user made an active choice.)

   If the user wants a row to resurface for pairing later, they can clear the
   dismissed flag explicitly via the UI (or `undismiss()` below). */
export function unpair(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  delete cf._is_transfer;
  delete cf._transfer_pair_id;
  cf._transfer_dismissed = true;
  return { ...tx, custom_fields: cf };
}

/* Dismiss a row without pairing it — "these are not a transfer, stop asking."
   Used by the "Dismiss" button on a candidate pair in the detection modal.
   The row stays as a regular expense/income; future detection runs will skip it. */
export function dismiss(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  cf._transfer_dismissed = true;
  // Don't touch _is_transfer here — dismissed is independent of marked.
  return { ...tx, custom_fields: cf };
}

/* Clear the dismissed flag so the row is eligible for pairing again.
   Exposed for an eventual "make this row detectable again" UI action. */
export function undismiss(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  delete cf._transfer_dismissed;
  return { ...tx, custom_fields: cf };
}

/* Is this row currently flagged as a transfer? Checks both the custom_fields
   flag (set by rules or by pairing) — for convenience in filter/chart code. */
export function isMarkedTransfer(tx) {
  return !!(tx?.custom_fields?._is_transfer);
}

/* Is this row flagged as dismissed? */
export function isDismissed(tx) {
  return !!(tx?.custom_fields?._transfer_dismissed);
}

/* Bulk commit a set of confirmed pairs.
   Input: existing transaction array + array of {aId, bId} pair ids to commit.
   Returns: a new transaction array with both rows marked in each pair.

   Unknown ids are silently ignored (caller shouldn't pass them but we
   defend against stale modal state). */
export function applyPairs(transactions, pairIds) {
  if (!Array.isArray(transactions) || !Array.isArray(pairIds) || !pairIds.length) {
    return transactions;
  }
  const byId = new Map(transactions.map(t => [t.id, t]));
  const updates = new Map();
  for (const { aId, bId } of pairIds) {
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;
    updates.set(aId, markPaired(a, bId));
    updates.set(bId, markPaired(b, aId));
  }
  if (!updates.size) return transactions;
  return transactions.map(t => updates.get(t.id) || t);
}

/* Bulk dismiss a set of candidate pairs. Marks both rows in each pair as
   dismissed without pairing them — they stay as regular transactions. */
export function applyDismissals(transactions, pairIds) {
  if (!Array.isArray(transactions) || !Array.isArray(pairIds) || !pairIds.length) {
    return transactions;
  }
  const ids = new Set();
  for (const { aId, bId } of pairIds) {
    if (aId) ids.add(aId);
    if (bId) ids.add(bId);
  }
  if (!ids.size) return transactions;
  return transactions.map(t => ids.has(t.id) ? dismiss(t) : t);
}
