/* utils/log.js — diagnostic ring buffer logger.

   Design goals:
   - Cheap calls everywhere: when disabled, log.info/warn/error are near-no-ops.
   - In-memory ring buffer, FIFO eviction once cap is hit.
   - Optional persistence to localStorage, debounced to ~1s so a burst of events
     during an import doesn't trigger a write per call.
   - Errors flush immediately, bypassing the debounce, so a crash doesn't lose
     the last second of context.
   - beforeunload listener does a sync flush on tab close / reload.
   - Console mirror is always on (cheap, gives DevTools live feed in dev).

   Configuration lives in app state (st.diagnostics). useAppState calls
   configure() whenever those values change. Tests can call _resetForTests().
*/

const STORAGE_KEY = "budget-mgr-diagnostic-log";
const STORAGE_BYTE_BUDGET = 1_000_000; // ~1MB localStorage safety net
const FLUSH_DEBOUNCE_MS = 1000;
const LEVEL_RANK = { info: 0, warn: 1, error: 2 };

const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  maxEvents: 500,
  minLevel: "info",
};

let _buffer = [];
let _config = { ...DEFAULT_CONFIG };
let _flushTimer = null;
let _beforeUnloadAttached = false;

function hasStorage() {
  return typeof localStorage !== "undefined";
}

function _loadFromStorage() {
  if (!hasStorage()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      _buffer = parsed.slice(-_config.maxEvents);
    }
  } catch {
    // Corrupted or quota-exceeded read — start fresh, don't crash app load.
  }
}

function _writeToStorage() {
  if (!hasStorage() || !_config.persist) return;
  try {
    let serialized = JSON.stringify(_buffer);
    // If we somehow exceeded the byte budget (large `data` payloads), drop the
    // oldest 20% and retry once. Tests cap at ~5000 events so this is rare.
    if (serialized.length > STORAGE_BYTE_BUDGET) {
      const dropCount = Math.floor(_buffer.length * 0.2) || 1;
      _buffer = _buffer.slice(dropCount);
      serialized = JSON.stringify(_buffer);
    }
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Quota exceeded or storage disabled — silently drop the persistence
    // attempt; in-memory buffer still works.
  }
}

function _scheduleFlush() {
  if (!_config.persist) return;
  if (_flushTimer != null) return;
  if (typeof setTimeout === "undefined") return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    _writeToStorage();
  }, FLUSH_DEBOUNCE_MS);
}

function _flushNow() {
  if (_flushTimer != null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  _writeToStorage();
}

function _attachBeforeUnload() {
  if (_beforeUnloadAttached) return;
  if (typeof window === "undefined") return;
  try {
    window.addEventListener("beforeunload", () => { _flushNow(); });
    _beforeUnloadAttached = true;
  } catch {
    // jsdom or non-browser env — ignore.
  }
}

function _push(level, event, data) {
  if (!_config.enabled) return;
  if (LEVEL_RANK[level] < LEVEL_RANK[_config.minLevel]) return;

  const entry = {
    ts: Date.now(),
    level,
    event: String(event || ""),
    data: data == null ? null : data,
  };

  _buffer.push(entry);
  if (_buffer.length > _config.maxEvents) {
    // Evict oldest — slice is O(n) but n ≤ 5000 and pushes are infrequent
    // relative to render work, so this is fine.
    _buffer = _buffer.slice(_buffer.length - _config.maxEvents);
  }

  // Console mirror — always on so dev tools see events live regardless of
  // persistence settings. Cheap; ignore in tests via spy if needed.
  try {
    const fn = level === "error" ? console.error
             : level === "warn"  ? console.warn
             : console.log;
    fn(`[log:${level}] ${entry.event}`, data ?? "");
  } catch { /* nothing */ }

  if (level === "error") {
    _flushNow(); // never lose the last error before a crash
  } else {
    _scheduleFlush();
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

export function configure(partial) {
  const prev = _config;
  _config = {
    ..._config,
    ...partial,
  };
  // Coerce / sanitize.
  _config.enabled = !!_config.enabled;
  _config.persist = !!_config.persist;
  const rawMax = Number(_config.maxEvents);
  _config.maxEvents = Number.isFinite(rawMax)
    ? Math.max(1, Math.min(5000, rawMax))
    : DEFAULT_CONFIG.maxEvents;
  if (!LEVEL_RANK.hasOwnProperty(_config.minLevel)) {
    _config.minLevel = DEFAULT_CONFIG.minLevel;
  }

  // If maxEvents shrank, trim the buffer.
  if (_buffer.length > _config.maxEvents) {
    _buffer = _buffer.slice(_buffer.length - _config.maxEvents);
  }

  // First time we got configured: load persisted events and attach unload hook.
  if (!prev._initialized) {
    _config._initialized = true;
    if (_config.persist) _loadFromStorage();
    _attachBeforeUnload();
  }

  // If persistence was just turned off, clear the storage slot so old data
  // doesn't reappear if it's turned back on later.
  if (prev.persist && !_config.persist && hasStorage()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export function info(event, data)  { _push("info",  event, data); }
export function warn(event, data)  { _push("warn",  event, data); }
export function error(event, data) { _push("error", event, data); }

export function getEvents(filter = {}) {
  const { level, sinceMs, limit } = filter;
  let out = _buffer;
  if (level) {
    const minRank = LEVEL_RANK[level] ?? 0;
    out = out.filter(e => LEVEL_RANK[e.level] >= minRank);
  }
  if (sinceMs) {
    const cutoff = Date.now() - sinceMs;
    out = out.filter(e => e.ts >= cutoff);
  }
  if (limit && limit > 0 && out.length > limit) {
    out = out.slice(out.length - limit);
  }
  return out;
}

export function clear() {
  _buffer = [];
  _flushNow();
  if (hasStorage()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export function exportAll() {
  // Returns a JSON string suitable for clipboard paste.
  return JSON.stringify(_buffer, null, 2);
}

export function getConfig() {
  // Caller-visible snapshot (drops internal _initialized flag).
  const { _initialized, ...rest } = _config;
  return rest;
}

/* ── Test helpers ──────────────────────────────────────────────────────── */

export function _resetForTests() {
  _buffer = [];
  _config = { ...DEFAULT_CONFIG };
  if (_flushTimer != null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  _beforeUnloadAttached = false;
  if (hasStorage()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export function _flushNowForTests() { _flushNow(); }
export const _STORAGE_KEY = STORAGE_KEY;

const log = { configure, info, warn, error, getEvents, clear, exportAll, getConfig };
export default log;
