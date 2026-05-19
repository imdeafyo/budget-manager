/* src/lib/httpLog.js — HTTP access log middleware.

   Logs every request on finish: method, path, status, duration, payload size
   in/out. Uses req.log (the per-request child logger from requestId middleware)
   so each line is tagged with the request id automatically.

   Skips static asset requests (/assets/*, .js/.css/.png/etc.) so the log isn't
   buried under bundle requests on every page load. API + HTML routes always
   log.
*/

const STATIC_RE = /\.(?:js|css|map|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|webp)(?:\?|$)/i;

function httpLog(req, res, next) {
  const started = Date.now();

  // Best-effort request size: content-length from the client.
  const reqBytes = Number(req.get('content-length')) || 0;

  res.on('finish', () => {
    const path = req.originalUrl || req.url || '';
    // Skip static assets — high volume, low diagnostic value.
    if (req.method === 'GET' && STATIC_RE.test(path)) return;
    // Skip the html shell fallback (matches /*splat) too — but only if it
    // looks like a non-API path. API errors still want logging even if they
    // somehow fall through to the static handler.
    if (req.method === 'GET' && !path.startsWith('/api/') && req.route === undefined && res.statusCode === 200) {
      // It's the SPA shell — leave it unlogged to keep noise down.
      return;
    }

    const dur = Date.now() - started;
    // Response size: Content-Length if set (it usually is after compression
    // middleware finalizes it). Falls back to 0.
    const resBytes = Number(res.get('content-length')) || 0;

    const log = req.log || require('./logger').logger;
    const payload = {
      event: 'http',
      method: req.method,
      path,
      status: res.statusCode,
      durMs: dur,
      reqBytes,
      resBytes,
    };

    // Bucket by status: 5xx is an error, 4xx is a warn, everything else info.
    if (res.statusCode >= 500) log.error(payload, 'http');
    else if (res.statusCode >= 400) log.warn(payload, 'http');
    else log.info(payload, 'http');
  });

  next();
}

module.exports = { httpLog };
