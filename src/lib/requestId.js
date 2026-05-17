/* src/lib/requestId.js — request-id middleware + per-request child logger.

   - Accepts X-Request-Id from client, generates a UUID if absent.
   - Echoes the ID back in the response header so the client can correlate.
   - Attaches `req.id` and `req.log` (Pino child logger bound to { reqId }).

   The client's apiFetch wrapper injects a UUID per request and reads the
   echoed header back. Together that closes the correlation loop: a state.save
   log line on the client carries the same reqId as the request.complete log
   line on the server.
*/

const crypto = require('crypto');

function requestId(logger) {
  return function requestIdMiddleware(req, res, next) {
    const incoming = req.headers['x-request-id'];
    // Accept incoming IDs as long as they're sane (no log injection). Cap
    // length and strip control chars. Otherwise generate a fresh UUID.
    const reqId = isSafeId(incoming) ? incoming : crypto.randomUUID();
    req.id = reqId;
    res.setHeader('X-Request-Id', reqId);
    req.log = logger.child({ reqId });
    next();
  };
}

function isSafeId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 100) return false;
  // Allow only printable ASCII (no CR/LF/control chars that would let a
  // request smuggle a fake log line into stdout).
  return /^[\x20-\x7E]+$/.test(value);
}

module.exports = { requestId, isSafeId };
