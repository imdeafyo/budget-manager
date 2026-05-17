/* utils/apiFetch.js — fetch wrapper that closes the request-id correlation loop.

   Every API call gets a fresh UUID in the X-Request-Id header. The server's
   requestId middleware echoes it back; we read that echoed ID and stash it
   on the resolved response object as `reqId` so callers can include it in
   their log lines.

   Usage:
     const res = await apiFetch("/api/state");
     log.info("state.load", { reqId: res.reqId, ... });

   Falls back gracefully:
   - If crypto.randomUUID isn't available, builds an ID from Date.now() + random.
   - If the server doesn't echo the header, res.reqId is null (no throw).
   - Same Response shape as fetch() — drop-in replacement.

   Headers passed in via options.headers are merged with the X-Request-Id;
   caller headers win on conflict (lets tests override the ID).
*/

import log from "./log.js";

function newReqId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  // Fallback: not crypto-strong, but adequate for correlation.
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function apiFetch(input, options = {}) {
  const reqId = newReqId();
  const headers = new Headers(options.headers || {});
  // Caller-supplied X-Request-Id wins (useful for retries that want to keep
  // the same id, or tests).
  if (!headers.has("X-Request-Id")) headers.set("X-Request-Id", reqId);

  const opts = { ...options, headers };

  let res;
  try {
    res = await fetch(input, opts);
  } catch (err) {
    // Network-level failure. Log with the id we *tried* to use so logs can
    // be searched even when the server never saw the request.
    log.warn("apiFetch.network.fail", {
      url: typeof input === "string" ? input : String(input),
      reqId: headers.get("X-Request-Id"),
      message: String(err?.message || err),
    });
    throw err;
  }

  // Read echoed id (server may have generated its own if ours was rejected;
  // we trust the server's echo over our local copy).
  let echoedId = null;
  try { echoedId = res.headers.get("X-Request-Id"); } catch { /* opaque response */ }

  // Stash on the Response so callers can pull it without re-reading headers.
  // Response objects are extensible, but a property may collide; use a
  // namespaced name to be safe.
  try { res.reqId = echoedId || headers.get("X-Request-Id"); }
  catch { /* frozen response (unlikely in browsers) — just skip */ }

  return res;
}

export default apiFetch;
