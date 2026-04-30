/* ══════════════════════════ Backup History ══════════════════════════
   Pure helpers for the periodic state-history feature. Server (server.js)
   imports the same logic via a small CommonJS shim below; the frontend
   imports the ES exports directly for the Settings panel preview/summary.

   Design notes:
   - History snapshots are sampled, not change-tracked. We don't write a
     row on every save — we tick once a minute and decide.
   - Each tier (hourly/daily/weekly/monthly) has an interval. A tier is
     "due" when (now - lastSnapshotAt[tier]) >= interval.
   - When multiple tiers fire on the same tick, we insert ONE row with a
     "+" -joined label (e.g. "hourly+daily") instead of multiple rows.
     Retention checks tier membership via `label.split("+")`.
   - De-dup: compare against the most recent history row regardless of
     label. If state is byte-identical, skip the insert entirely. */

export const DEFAULT_HISTORY_CONFIG = {
  enabled: true,
  hourly: { intervalMs: 60 * 60 * 1000,             keep: 24 },
  daily:  { intervalMs: 24 * 60 * 60 * 1000,        keep: 30 },
  weekly: { intervalMs: 7 * 24 * 60 * 60 * 1000,    keep: 12 },
  monthly:{ intervalMs: 30 * 24 * 60 * 60 * 1000,   keep: 12 },
};

export const TIER_NAMES = ["hourly", "daily", "weekly", "monthly"];

/* ── dueTiers — return list of tier names whose interval has elapsed.
   `lastSnapshotAt` is a map { hourly: tsString|null, daily: ..., ... }.
   Missing/null entries are treated as "infinitely old" → tier is due.
   Pure function, suitable for cheap repeated calls in a tick loop. */
export function dueTiers(now, lastSnapshotAt, config = DEFAULT_HISTORY_CONFIG) {
  const t = (now instanceof Date) ? now.getTime() : new Date(now).getTime();
  const last = lastSnapshotAt || {};
  const due = [];
  for (const tier of TIER_NAMES) {
    const cfg = config[tier];
    if (!cfg) continue;
    const prev = last[tier];
    if (!prev) { due.push(tier); continue; }
    const prevT = (prev instanceof Date) ? prev.getTime() : new Date(prev).getTime();
    if (Number.isNaN(prevT)) { due.push(tier); continue; }
    if (t - prevT >= cfg.intervalMs) due.push(tier);
  }
  return due;
}

/* ── mergeLabels — combine an array of tier names into a single label.
   Stable, sorted order so "hourly+daily" never differs from "daily+hourly". */
export function mergeLabels(tiers) {
  if (!tiers || tiers.length === 0) return "";
  const order = { hourly: 0, daily: 1, weekly: 2, monthly: 3, manual: 4 };
  const sorted = [...new Set(tiers)].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));
  return sorted.join("+");
}

/* ── labelHasTier — does a label string include a given tier?
   "hourly+daily" includes "hourly" and "daily". "manual" includes only "manual". */
export function labelHasTier(label, tier) {
  if (!label) return false;
  return label.split("+").includes(tier);
}

/* ── pruneRetention — given rows and config, return ids to delete.
   Retention is per-tier: keep the N most recent rows whose label
   includes that tier. A row labeled "hourly+daily" counts toward both
   hourly and daily caps; it's only deletable if it's outside the
   retention of EVERY tier it belongs to. Manual snapshots are never
   auto-pruned (user-initiated, user-deleted only). */
export function pruneRetention(rows, config = DEFAULT_HISTORY_CONFIG) {
  if (!rows || rows.length === 0) return [];
  // Sort newest first; rows is expected to come from SQL ORDER BY saved_at DESC.
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a.saved_at).getTime();
    const tb = new Date(b.saved_at).getTime();
    return tb - ta;
  });

  // For each tier, compute the set of row ids within retention.
  const keepIds = new Set();
  for (const tier of TIER_NAMES) {
    const keep = config[tier]?.keep ?? 0;
    const matches = sorted.filter(r => labelHasTier(r.label, tier));
    matches.slice(0, keep).forEach(r => keepIds.add(r.id));
  }
  // Manual rows are always kept.
  sorted.filter(r => labelHasTier(r.label, "manual")).forEach(r => keepIds.add(r.id));

  // Anything not in keepIds is deletable.
  return sorted.filter(r => !keepIds.has(r.id)).map(r => r.id);
}

/* ── summarizeState — produce a small object the History panel uses
   for preview cards. Counts arrays/snapshots and pulls a few headline
   numbers. Defensive against missing fields. */
export function summarizeState(state) {
  if (!state || typeof state !== "object") {
    return { exp: 0, sav: 0, snapshots: 0, transactions: 0, cSal: 0, kSal: 0, sizeBytes: 0 };
  }
  const sizeBytes = (() => {
    try { return new Blob([JSON.stringify(state)]).size; } catch { return JSON.stringify(state).length; }
  })();
  return {
    exp: Array.isArray(state.exp) ? state.exp.length : 0,
    sav: Array.isArray(state.sav) ? state.sav.length : 0,
    snapshots: Array.isArray(state.snapshots) ? state.snapshots.length : 0,
    transactions: Array.isArray(state.transactions) ? state.transactions.length : 0,
    cSal: Number(state.cSal) || 0,
    kSal: Number(state.kSal) || 0,
    sizeBytes,
  };
}

/* ── diffSummaries — compare two summaries, return per-field deltas.
   Used by the restore-preview modal so the user sees what changes. */
export function diffSummaries(current, candidate) {
  const c = summarizeState(current);
  const x = summarizeState(candidate);
  return {
    exp:          { current: c.exp,          candidate: x.exp,          delta: x.exp - c.exp },
    sav:          { current: c.sav,          candidate: x.sav,          delta: x.sav - c.sav },
    snapshots:    { current: c.snapshots,    candidate: x.snapshots,    delta: x.snapshots - c.snapshots },
    transactions: { current: c.transactions, candidate: x.transactions, delta: x.transactions - c.transactions },
    cSal:         { current: c.cSal,         candidate: x.cSal,         delta: x.cSal - c.cSal },
    kSal:         { current: c.kSal,         candidate: x.kSal,         delta: x.kSal - c.kSal },
    sizeBytes:    { current: c.sizeBytes,    candidate: x.sizeBytes,    delta: x.sizeBytes - c.sizeBytes },
  };
}
