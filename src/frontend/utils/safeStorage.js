/* ══════════════════════════ safeStorage — make storage work in every browser ══════════════════════════
   THE PROBLEM
   The generic build is a single .html file people open straight from disk
   (file://). Browsers disagree — sharply — about what a local file is allowed
   to do:

     Safari    : grants file:// documents a usable localStorage. Everything works.
     Chromium  : treats EVERY file:// document as its own unique opaque origin
                 (Chrome, Edge, Vivaldi, Brave, Arc...). Storage is denied. Worse,
                 in some versions merely *touching* window.localStorage throws a
                 SecurityError rather than returning null — so even a defensive
                 `if (window.localStorage)` check can blow up.
     Firefox   : generally permits it, but can be locked down by config/private mode.

   Symptom this caused: in Vivaldi the app looked like it worked but silently
   remembered nothing, and the update check re-fetched on every load because its
   cache never persisted. Worst possible failure for a budget tool — you type
   real data into something that quietly forgets it.

   WHAT THIS DOES
   Probe once for a working Storage. If there is one, use it. If not, fall back
   to an in-memory Map with the identical Storage interface. The app then behaves
   the same everywhere; the only difference is whether state outlives the tab.

   WHY A SHIM AND NOT A REFACTOR
   There are ~94 raw localStorage call sites across 9 files, several shared with
   the K8s deploy build (compareCache.js, log.js, TransactionsTab.jsx). Rewriting
   all of them would be a large, risky diff to fix a generic-only problem. Instead
   the generic build installs this over window.localStorage before the app boots,
   so every existing call site keeps working untouched — including any added later.

   IMPORTANT — what this does NOT do
   It cannot make file:// Chromium persist across reloads. No API can: localStorage,
   sessionStorage, IndexedDB and Cache API are all denied to opaque origins. In that
   mode data lives in the tab and the 💾 button (which writes a real file to disk) is
   the persistence mechanism. This shim's job is to keep the app fully functional and
   let the file be the store — not to fake durability that isn't there.
*/

/* probeStorage(candidate): does this Storage actually work?
   Must survive three distinct failure modes:
     1. Accessing the property throws (Chromium file:// SecurityError)
     2. The object exists but setItem throws (Safari Private, quota exhausted)
     3. It silently no-ops (some embedded webviews accept writes and drop them)
   The round-trip write/read/remove catches all three. */
export function probeStorage(candidate) {
  try {
    const s = candidate;
    if (!s) return false;
    const k = "__bm_probe__";
    s.setItem(k, "1");
    const ok = s.getItem(k) === "1"; // catches the silent-no-op case
    s.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

/* createMemoryStorage(): a Storage-compatible in-memory store.
   Implements the full interface the app (and any library) may touch, including
   `length` and `key(i)`, so it is a drop-in for the real thing. */
export function createMemoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => { m.clear(); },
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
    // Marker so callers can tell durable storage from the fallback.
    __isMemoryFallback: true,
  };
}

/* getWorkingStorage(win): pick the best available store.
   Returns { storage, durable }. `durable` is false when we fell back to memory,
   i.e. data will not survive a reload. Reading win.localStorage is itself inside
   the try, because that access is what throws in Chromium file://. */
export function getWorkingStorage(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return { storage: createMemoryStorage(), durable: false };
  let ls = null;
  try { ls = win.localStorage; } catch { ls = null; }
  if (probeStorage(ls)) return { storage: ls, durable: true };
  return { storage: createMemoryStorage(), durable: false };
}

/* installSafeStorage(win): make win.localStorage always safe to call.
   When the real thing works, leave it alone. When it doesn't, redefine the
   property to point at the memory fallback so all ~94 existing call sites keep
   working without modification.
   Returns { durable } so the caller can adapt behaviour (e.g. the generic build
   makes the file the source of truth when storage isn't durable).
   Idempotent: safe to call more than once. */
export function installSafeStorage(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return { durable: false };
  if (win.__bmStorageInstalled) return { durable: !!win.__bmStorageDurable };

  const { storage, durable } = getWorkingStorage(win);
  if (!durable) {
    try {
      Object.defineProperty(win, "localStorage", {
        configurable: true,
        get() { return storage; },
      });
    } catch {
      // Some engines refuse to redefine it. Fall back to a plain assignment;
      // if that also fails there is nothing more to try, but the app still runs
      // because every call site in this codebase is already try/catch-wrapped.
      try { win.localStorage = storage; } catch {}
    }
  }
  try {
    win.__bmStorageInstalled = true;
    win.__bmStorageDurable = durable;
  } catch {}
  return { durable };
}
