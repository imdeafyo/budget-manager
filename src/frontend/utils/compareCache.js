/* ══════════════════════════ compareBudgetToActual cache — Phase 7b Part B ══════════════════════════
   Persists the most recent `compareBudgetToActual` result to localStorage so
   the Transactions tab's Budget vs Actual chart can paint instantly on tab
   switch / reload, before the actual aggregation finishes.

   Pattern in TransactionsTab:
     const cacheKey = computeCacheKey({...inputs});
     const [cached, setCached]  = useState(() => readCache(cacheKey));
     const fresh                = useMemo(() => compareBudgetToActual({...}), [deps]);
     const displayCompare       = fresh || cached;
     useEffect(() => { if (fresh) writeCache(cacheKey, fresh); }, [fresh, cacheKey]);

   The cache is best-effort: any localStorage failure (quota, private mode,
   serialization error) is swallowed silently. The chart will just compute
   from scratch the next time. We never throw from these helpers.

   ── What goes into the key ──
   The cache must invalidate whenever the result would change. Inputs that
   affect compareBudgetToActual:
     - transactions (specifically: count + max updated_at — see spec note)
     - exp / sav budget items (count + per-item amount/period/category)
     - cats / savCats / transferCats / incomeCats lists
     - milestones (id + date — full state stripped for size)
     - fromIso, toIso, todayIso
     - basis (48 vs 52)

   We hash all of these into a single short string. Hash collisions are
   essentially harmless here — worst case is one stale paint, immediately
   corrected by the fresh useMemo result. We're not relying on the cache
   for correctness, only for perceived perf.

   ── Storage ──
   Single key in localStorage: "budget-compare-cache".
   Value shape: { key: string, compare: <result>, savedAt: <iso ts> }.
   Single-slot (not LRU) — the hot path is "tab switch with same inputs",
   so one slot is enough. If the user changes filters, the next compute
   evicts the old entry. Anything older than CACHE_TTL_MS is also evicted
   on read so the cache doesn't survive across many days of inactivity
   when the data has likely shifted.
*/

const STORAGE_KEY = "budget-compare-cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* cyrb53 — fast 53-bit string hash, returns a hex string. Good enough for
   "did the inputs change" — not cryptographic. */
function hashString(str) {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* Stable signature for an array of budget items — concat name|cat|amount|period.
   Order-sensitive on purpose: re-ordering items doesn't change the result,
   but it's cheap to recompute, and order changes are rare. */
function itemsSignature(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map(it => {
      if (!it) return "";
      const n = it.n ?? "";
      const c = it.c ?? "";
      const v = it.v ?? "";
      const p = it.p ?? "";
      const t = it.t ?? "";
      const s = it.s ?? "";
      return `${n}|${c}|${v}|${p}|${t}|${s}`;
    })
    .join(";");
}

/* Stable signature for milestones — id + date is enough. The full state
   inside each milestone changes when items change, but we don't need to
   replay every line item; the date drives which era pickBudgetForDate
   selects, and the count guarantees added/removed milestones invalidate. */
function milestonesSignature(milestones) {
  if (!Array.isArray(milestones)) return "";
  return milestones
    .map(m => `${m?.id ?? ""}|${m?.date ?? ""}`)
    .join(";");
}

/* Per-spec note in the project docs: invalidate on transaction edits, not
   just count changes. We use max(updated_at) over the list. If updated_at
   is missing on a row, we fall back to id|date|amount as a content proxy. */
function transactionsSignature(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return "0|";
  }
  let maxUpdated = "";
  let fallbackHash = 0;
  for (const tx of transactions) {
    if (!tx) continue;
    const u = tx.updated_at || tx.updatedAt || "";
    if (u && u > maxUpdated) maxUpdated = u;
    if (!u) {
      // Cheap rolling content fingerprint for rows without timestamps
      // (generic mode, older data). XOR a few fields together.
      const id = String(tx.id ?? "");
      const dt = String(tx.date ?? "");
      const am = String(tx.amount ?? "");
      const cat = String(tx.category ?? "");
      for (let i = 0; i < id.length; i++) fallbackHash = (fallbackHash ^ id.charCodeAt(i)) >>> 0;
      for (let i = 0; i < dt.length; i++) fallbackHash = (fallbackHash ^ dt.charCodeAt(i)) >>> 0;
      for (let i = 0; i < am.length; i++) fallbackHash = (fallbackHash ^ am.charCodeAt(i)) >>> 0;
      for (let i = 0; i < cat.length; i++) fallbackHash = (fallbackHash ^ cat.charCodeAt(i)) >>> 0;
    }
  }
  return `${transactions.length}|${maxUpdated}|${fallbackHash}`;
}

/* Build a cache key from the inputs to compareBudgetToActual. */
export function computeCacheKey(opts) {
  const {
    transactions = [],
    exp = [],
    sav = [],
    cats = [],
    savCats = [],
    transferCats = [],
    incomeCats = [],
    milestones = [],
    fromIso = "",
    toIso = "",
    todayIso = "",
    basis = 48,
    treatRefundsAsNetting = true,
  } = opts || {};

  const parts = [
    transactionsSignature(transactions),
    itemsSignature(exp),
    itemsSignature(sav),
    (cats || []).join(","),
    (savCats || []).join(","),
    (transferCats || []).join(","),
    (incomeCats || []).join(","),
    milestonesSignature(milestones),
    fromIso,
    toIso,
    todayIso,
    String(basis),
    treatRefundsAsNetting ? "r1" : "r0",
  ];
  return hashString(parts.join("¦"));
}

/* Read the cached result for `key`. Returns null on miss, expiry, or any
   localStorage / parse error. Safe to call from any environment — falls
   through gracefully if localStorage isn't available (SSR, sandbox). */
export function readCache(key, opts = {}) {
  if (!key) return null;
  const { now = Date.now(), storage = defaultStorage() } = opts;
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (obj.key !== key) return null;
    if (typeof obj.savedAt === "number" && now - obj.savedAt > CACHE_TTL_MS) return null;
    return obj.compare ?? null;
  } catch {
    return null;
  }
}

/* Write a result to the cache under `key`. Best-effort; any error is
   swallowed. We don't bother updating the timestamp on read-hits — the
   write side handles freshness on the next compute. */
export function writeCache(key, compare, opts = {}) {
  if (!key) return false;
  const { now = Date.now(), storage = defaultStorage() } = opts;
  if (!storage) return false;
  try {
    const payload = JSON.stringify({ key, compare, savedAt: now });
    storage.setItem(STORAGE_KEY, payload);
    return true;
  } catch {
    // Quota, JSON cycle, private mode, serialization size — ignore.
    return false;
  }
}

/* Wipe the cache. Used by tests; could also be called from a debug menu. */
export function clearCache(opts = {}) {
  const { storage = defaultStorage() } = opts;
  if (!storage) return;
  try { storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch { /* access denied (e.g. some private modes) */ }
  return null;
}

/* Exported for tests. */
export const __INTERNALS__ = { STORAGE_KEY, CACHE_TTL_MS, hashString, itemsSignature, transactionsSignature, milestonesSignature };
