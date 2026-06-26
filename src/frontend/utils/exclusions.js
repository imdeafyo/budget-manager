/* ══════════════════════════ Transaction exclusions — pure helpers ══════════════════════════
   The duplicate scan can "exclude" a row instead of deleting it. An excluded
   duplicate is kept in the data (so the delete is reversible — you can always
   un-exclude it) but is treated as not-real for two purposes:

   1. It's HIDDEN from the Transactions list by default. A Settings toggle
      ("Show excluded duplicates") reveals them again so the user can review or
      un-exclude.
   2. It's DROPPED from all spending / budget / chart / forecast-actuals totals,
      exactly the way a marked transfer is. This is the whole point: excluding a
      duplicate has to actually remove its double-count, not just hide it.

   Flag field stored on a transaction's `custom_fields`:
   - `_is_duplicate` : boolean — this row is an excluded duplicate. Hidden from
                       the list (unless the show-toggle is on) and excluded from
                       every total.

   Why a separate flag from `_is_transfer` (transfers.js):
   - Different meaning. A transfer is money moving between your own accounts; a
     duplicate is the same charge imported twice. Conflating them would mislabel
     the row in the UI and pollute transfer-only views.
   - Different un-action. Un-pairing a transfer sets `_transfer_dismissed`;
     un-excluding a duplicate just clears `_is_duplicate` with no dismissed
     bookkeeping.
   - Different default visibility. Transfers stay visible in the list (just
     excluded from totals); excluded duplicates are hidden from the list too.

   All functions here are pure. The caller persists the returned rows. */

import { isMarkedTransfer } from "./transfers.js";

/* Is this row an excluded duplicate? */
export function isExcludedDuplicate(tx) {
  return !!(tx?.custom_fields?._is_duplicate);
}

/* Should this row be left OUT of spending / budget / chart / forecast totals?
   True for marked transfers OR excluded duplicates. This is the single
   predicate every totals path should consult so a new exclusion reason only
   has to be added in one place. */
export function isExcludedFromTotals(tx) {
  return isMarkedTransfer(tx) || isExcludedDuplicate(tx);
}

/* Mark a row as an excluded duplicate. */
export function markExcludedDuplicate(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  cf._is_duplicate = true;
  return { ...tx, custom_fields: cf };
}

/* Clear the excluded-duplicate flag — row returns to a normal transaction,
   visible in the list and counted in totals again. */
export function unmarkExcludedDuplicate(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  delete cf._is_duplicate;
  return { ...tx, custom_fields: cf };
}

/* Bulk-mark a set of ids as excluded duplicates. Returns a new array with the
   matched rows flagged; unmatched ids are ignored. */
export function applyExclusions(transactions, ids) {
  if (!Array.isArray(transactions)) return transactions;
  const set = ids instanceof Set ? ids : new Set(ids || []);
  if (!set.size) return transactions;
  return transactions.map(t => (t && set.has(t.id) ? markExcludedDuplicate(t) : t));
}

/* Bulk-clear the excluded-duplicate flag for a set of ids. */
export function clearExclusions(transactions, ids) {
  if (!Array.isArray(transactions)) return transactions;
  const set = ids instanceof Set ? ids : new Set(ids || []);
  if (!set.size) return transactions;
  return transactions.map(t => (t && set.has(t.id) ? unmarkExcludedDuplicate(t) : t));
}

/* ── "Not a duplicate" dismissal ──
   Distinct from exclusion. Excluding says "this IS a duplicate, hide it and
   drop it from totals." Dismissing says "this is NOT a duplicate — stop
   flagging it." A dismissed row stays fully visible and fully counted in every
   total; it is only skipped by FUTURE duplicate scans so the same legitimate
   group (e.g. a recurring contribution that looks identical week to week)
   doesn't resurface every time.

   Flag: `_dup_dismissed` on custom_fields. scanForDuplicates filters these out
   before clustering, mirroring how it already skips marked transfers and
   excluded duplicates. */

export function isDuplicateDismissed(tx) {
  return !!(tx?.custom_fields?._dup_dismissed);
}

export function markDuplicateDismissed(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  cf._dup_dismissed = true;
  return { ...tx, custom_fields: cf };
}

export function unmarkDuplicateDismissed(tx) {
  if (!tx) return tx;
  const cf = { ...(tx.custom_fields || {}) };
  delete cf._dup_dismissed;
  return { ...tx, custom_fields: cf };
}

/* Bulk-mark a set of ids as "not a duplicate" (dismissed from future scans). */
export function applyDuplicateDismissals(transactions, ids) {
  if (!Array.isArray(transactions)) return transactions;
  const set = ids instanceof Set ? ids : new Set(ids || []);
  if (!set.size) return transactions;
  return transactions.map(t => (t && set.has(t.id) ? markDuplicateDismissed(t) : t));
}

/* Bulk-clear the dismissed flag for a set of ids (re-eligible for scanning). */
export function clearDuplicateDismissals(transactions, ids) {
  if (!Array.isArray(transactions)) return transactions;
  const set = ids instanceof Set ? ids : new Set(ids || []);
  if (!set.size) return transactions;
  return transactions.map(t => (t && set.has(t.id) ? unmarkDuplicateDismissed(t) : t));
}
