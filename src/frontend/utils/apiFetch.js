/* utils/apiFetch.js — wrapper around fetch() that closes the request-id
   correlation loop with the server.

   On the way out:    sets X-Request-Id (UUID, generated client-side)
   On the way back:   reads X-Request-Id off the response (server echoes it,
                      or generates its own if ours wasn't sane) and stashes
                      it on res.reqId so callers can include it in log lines.

   Drop-in replacement for fetch(input, init).
*/

// crypto.randomUUID() is available in all modern browsers + Node 19+.
// Fall back to a Math.random-based UUID for the rare case it's missing —
// this is only used for log correlation, not security.
function makeId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function apiFetch(input, init = {}) {
  const reqId = makeId();
  // Headers can come in as Headers / array / plain object. Normalize to a
  // Headers instance so .set() and .get() work uniformly.
  const headers = new Headers(init.headers || {});
  if (!headers.has("X-Request-Id")) headers.set("X-Request-Id", reqId);

  let res;
  try {
    res = await fetch(input, { ...init, headers });
  } catch (err) {
    // Network-level failure (DNS, abort, TLS). Re-throw, but attach the id
    // so callers can correlate the failed attempt.
    err.reqId = headers.get("X-Request-Id");
    throw err;
  }

  // Read echoed id off the response. The server may have generated its own
  // if ours was rejected; we trust the server's echo over our local copy.
  let echoed = null;
  try { echoed = res.headers.get("X-Request-Id"); } catch { /* opaque response */ }

  try { res.reqId = echoed || headers.get("X-Request-Id"); }
  catch { /* frozen Response (unlikely in browsers) — just skip */ }

  return res;
}

export default apiFetch;
