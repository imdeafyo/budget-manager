/* ══════════════════════════ Stable IDs for budget line items ══════════════════════════
   The `exp[]` and `sav[]` arrays in app state are positional — the only
   "identifier" any item carries by default is its array index, computed
   at render time in useAppState. That means *any* cross-edit reference
   to a row (Ending Obligation `itemRefs`, Milestone Compare matching)
   breaks the moment a row above it is deleted, reordered, or renamed.

   This module assigns each item a stable string `id` that survives
   delete-above, reorder, and rename. Two helpers:

   - `newItemId()` — fresh random id, 8 hex-ish chars with an "i_" prefix.
   - `ensureIds(arr)` — returns a new array with `id` set on every item
     that's missing one. Idempotent: items that already have an id are
     left strictly equal (===) to their input, so React identity is
     preserved across no-op migration runs.

   Collision math: 36^8 ≈ 2.8 × 10^12 keyspace. Even with 10k items in
   a single budget, the per-pair birthday probability is ~10^-5. For a
   real budget (< 200 items), collisions are negligible.

   Notes:

   - The `id` is opaque to the user — never rendered, never typed in.
   - Existing items get ids assigned at load time in useAppState (one-time
     backfill, persisted on next auto-save).
   - Milestone `fullState.exp/sav` arrays also get ids backfilled so
     Compare can match across milestones by id.

   See also: `utils/oneTimeEvents.js` (newOneTimeEventId), `utils/loans.js`
   (newLoanId), `utils/endingItems.js` (newEndingItemId). Same pattern.
   ─────────────────────────────────────────────────────────────────────── */

const ID_PREFIX = "i_";

/* Generate a fresh item id.
   ---------------------------------------------------------------
   8 characters of base36 randomness. The prefix lets us spot a
   budget-item id in logs / debugger without ambiguity with the
   other id namespaces in the app.

   `crypto.randomUUID` would be tidier, but we only need 8 chars
   and `Math.random()` is faster and dependency-free. Two items
   added in the same tick collide with probability ~10^-10. */
export function newItemId() {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/* Ensure every item in the array has an `id` field.
   ---------------------------------------------------------------
   Idempotent. Items that already have a truthy string `id` are
   returned strictly equal (===) to their input — so React keys
   stay stable across no-op migration calls. Only items missing
   an id are replaced with a fresh spread.

   The returned array itself is always a new array (so callers
   can safely treat the result as immutable and trust referential
   equality at the array level to mean "no migration was needed"
   only when EVERY item had an id, which we report via the
   second return value).

   Args:
     arr — input array (may be null/undefined/non-array — returns [])

   Returns:
     The new array (or the input array if no changes were needed,
     for referential-equality preservation).

   Examples:
     ensureIds(undefined)                  // → []
     ensureIds([{ n: "a" }])               // → [{ n: "a", id: "i_…" }]
     ensureIds([{ n: "a", id: "i_x" }])    // → same array ref (no-op)
     ensureIds([{ n: "a", id: "" }])       // → [{ n: "a", id: "i_…" }]
                                           //   (empty/falsy id treated as missing) */
export function ensureIds(arr) {
  if (!Array.isArray(arr)) return [];
  // Fast path: scan once to see if anything needs assigning.
  let needsChange = false;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (!it || typeof it !== "object" || typeof it.id !== "string" || it.id.length === 0) {
      needsChange = true;
      break;
    }
  }
  if (!needsChange) return arr;

  // Slow path: replace just the items missing an id, keep the rest by ref.
  return arr.map(it => {
    if (!it || typeof it !== "object") return it;
    if (typeof it.id === "string" && it.id.length > 0) return it;
    return { ...it, id: newItemId() };
  });
}

/* Internal-use helper: assign ids in place (mutates array entries).
   ---------------------------------------------------------------
   Tests and one-off migration scripts can use this when they don't
   need React-friendly identity preservation. Production code paths
   should prefer `ensureIds()`. */
export function ensureIdsInPlace(arr) {
  if (!Array.isArray(arr)) return;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (!it || typeof it !== "object") continue;
    if (typeof it.id !== "string" || it.id.length === 0) {
      it.id = newItemId();
    }
  }
}

/* Decide what the first post-load auto-save should do.
   ---------------------------------------------------------------
   Extracted as a pure function so the migration-persistence bug has a
   regression test. The bug: the auto-save effect stamps a no-op
   baseline on the first run after load and skips the network write
   (correct, for the state-wipe guard). But when the load-time stable-IDs
   migration assigns new ids, the in-memory state diverges from the
   server's copy — and the baseline-skip would swallow that divergence,
   so the ids would never persist. A passive load (open app, touch
   nothing) must still write the migrated ids back.

   Args:
     baselineNull   — true when lastSavedHashRef.current === null (first run)
     migrationDirty — true when the load-time backfill assigned ids that
                      weren't on the server copy

   Returns one of:
     "skip-stamp-baseline" — first run, nothing migrated: stamp & skip PUT
     "put-migration"       — first run, migration dirty: PUT then stamp
     "normal"              — not the first run: fall through to hash compare

   Truth table:
     baselineNull=false                       → "normal"
     baselineNull=true,  migrationDirty=false → "skip-stamp-baseline"
     baselineNull=true,  migrationDirty=true  → "put-migration" */
export function firstSaveAction(baselineNull, migrationDirty) {
  if (!baselineNull) return "normal";
  if (migrationDirty) return "put-migration";
  return "skip-stamp-baseline";
}
