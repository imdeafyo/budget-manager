/* src/lib/requestId.js — request-id middleware.

   Accepts X-Request-Id from the client (if it's a sane shape — UUID-ish or
   short alphanumeric, capped length so we can't be log-flooded with garbage).
   Generates a UUID if absent. Echoes the resolved id back in the response
   header so the client can correlate logs across the round trip. Attaches a
   per-request child logger as req.log so every downstream handler can log
   with the id automatically tagged.
*/

const crypto = require('crypto');
const { logger } = require('./logger');

// Allow short, sane request ids only. UUIDs (with dashes) pass, as do plain
// alphanumeric ids up to 64 chars. Anything else gets replaced.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeId(s) {
  return typeof s === 'string' && ID_RE.test(s);
}

function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  const id = isSafeId(incoming) ? incoming : crypto.randomUUID();
  req.reqId = id;
  res.setHeader('X-Request-Id', id);
  req.log = logger.child({ reqId: id });
  next();
}

module.exports = { requestId, isSafeId };
