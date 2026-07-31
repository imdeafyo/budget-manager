/* ══════════════════════════ Savings target math ══════════════════════════
   Pure helpers for the Budget → Live "savings targets" boxes:

   - Emergency reserve: N months of monthly expenses. Monthly expenses are a
     *calendar* figure (weekly × 52 / 12), because a cash reserve is a
     calendar-time question — "if income stops, how many real months does this
     cover" — not a paycheck-cadence (48) question. This mirrors the decision
     made for the Forecast tab's time-to-X-months calculator.

   - House fund: home value × maintenance percent. Rule-of-thumb annual home
     maintenance runs ~1–3% of home value; default 1.5%.

   Item selection for the emergency reserve is stored as an *exclusion set* of
   stable item ids (see utils/itemIds.js). Default behaviour is "all necessity
   expenses included"; the user unchecks items to drop them. Storing exclusions
   (rather than inclusions) means a freshly-added necessity item is included by
   default, which is the safer default for a reserve number.

   All helpers are pure and id-keyed, so they survive row delete / reorder /
   rename. Nothing here reads component state or the DOM.
   ─────────────────────────────────────────────────────────────────────── */

/* Convert a weekly amount to a calendar-monthly amount. */
export function weeklyToMonthly(wk) {
  const n = Number(wk);
  if (!isFinite(n)) return 0;
  return n * 52 / 12;
}

/* Sum the calendar-monthly expense for a set of budget items, skipping any
   whose id is in `excluded`. Items are expected to carry `id` (stable) and
   `wk` (weekly amount), which is exactly the shape of necI / disI.

   `excluded` may be a Set or an array of ids; anything falsy means "nothing
   excluded". Items without an id fall back to being keyed by their `n`+`wk`
   signature only for exclusion matching — but since necI carries ids in the
   live app, this is just defensive. */
/* Resolve a stable key for a budget item's inclusion state. Prefers the
   stable `id` (utils/itemIds.js); falls back to a name-based key when an item
   predates the stable-IDs migration or comes from an in-code default that was
   never id-backfilled (e.g. DEF_EXP). The `n:` prefix keeps the fallback from
   ever colliding with a real id. Name is used (not name+amount) so the key
   survives an amount edit — the picker should not silently re-include an item
   just because its dollar value changed. */
export function itemKey(it) {
  if (!it) return "";
  return it.id != null ? String(it.id) : `n:${it.n}`;
}

/* Sum the calendar-monthly expense for a set of budget items, skipping any
   whose key is in `excluded`. Items are expected to carry `id` (stable, from
   itemIds.js) and `wk` (weekly amount) — the shape of necI / disI. Falls back
   to a name-based key for pre-migration / default items (see itemKey).

   `excluded` may be a Set or an array of keys; anything falsy means "nothing
   excluded". */
export function monthlyExpenseForItems(items, excluded) {
  if (!Array.isArray(items)) return 0;
  const ex = excluded instanceof Set ? excluded : new Set(excluded || []);
  let wkTotal = 0;
  for (const it of items) {
    if (!it) continue;
    if (ex.has(itemKey(it))) continue;
    const wk = Number(it.wk);
    if (isFinite(wk)) wkTotal += wk;
  }
  return weeklyToMonthly(wkTotal);
}

/* Emergency reserve target = monthly expenses × months.
   `monthly` is a calendar-monthly figure (from monthlyExpenseForItems, or a
   manual override). `months` defaults to 6. Negative / non-finite inputs
   clamp to 0. */
export function emergencyTarget(monthly, months = 6) {
  const m = Number(monthly), n = Number(months);
  if (!isFinite(m) || !isFinite(n) || m <= 0 || n <= 0) return 0;
  return m * n;
}

/* Toggle an item key in an exclusion list. Pure: takes the current list (or
   Set), returns a NEW array with `key` added if absent or removed if present.
   Empty/null keys are a no-op — an item that can't produce a key must never
   enter the set, or it would silently match other keyless items. Keys come
   from itemKey(): a stable id, or an `n:`-prefixed name fallback. Keeping this
   pure lets the component call it inside a functional state updater, avoiding
   the stale-snapshot bug where a second click rebuilt the set from an
   out-of-date render value. */
export function toggleExcluded(excludedIds, key) {
  const next = new Set(excludedIds instanceof Set ? excludedIds : (excludedIds || []));
  if (key == null || key === "") return [...next];
  if (next.has(key)) next.delete(key); else next.add(key);
  return [...next];
}

/* House maintenance fund target = home value × (percent / 100).
   Default percent 1.5 (mid-point of the 1–3% rule of thumb). Negative /
   non-finite inputs clamp to 0. */
export function houseFundTarget(homeValue, percent = 1.5) {
  const v = Number(homeValue), p = Number(percent);
  if (!isFinite(v) || !isFinite(p) || v <= 0 || p <= 0) return 0;
  return v * p / 100;
}
