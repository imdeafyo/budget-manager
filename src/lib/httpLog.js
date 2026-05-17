/* src/lib/httpLog.js — access-log middleware.

   Wraps res.end so every request emits a single `request.complete` log line
   with method, path, status, duration, and payload sizes. Uses `req.log`
   from requestId middleware so reqId is on every line.

   Skips the static-asset path: matched routes log normally, but bundle/
   font/image GETs would drown the log. Filter on req.path.

   The `/api/health` endpoint is also skipped because Kubernetes liveness/
   readiness probes hit it every few seconds.
*/

const SKIP_PATHS = new Set(['/api/health']);
// Bundle / asset extensions that aren't worth logging.
const SKIP_EXT_RE = /\.(js|css|map|ico|png|jpg|jpeg|svg|woff2?|ttf|otf)$/i;

function httpLog() {
  return function httpLogMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const reqBytes = parseContentLength(req.headers['content-length']);

    // Skip noisy paths. Still attach the no-op finish handler so we don't
    // leave a half-set timer dangling, but don't actually log.
    const path = req.path || req.url || '';
    const skip = SKIP_PATHS.has(path) || SKIP_EXT_RE.test(path);

    const finalize = () => {
      if (skip) return;
      const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      const resBytes = parseContentLength(res.getHeader('content-length'));
      // For 304 short-circuits there's no body; that's fine, resBytes will be 0.
      const log = req.log || console;
      const entry = {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Math.round(ms),
        reqBytes,
        resBytes,
      };
      // 4xx → warn, 5xx → error, everything else → info. Lets ops grep cleanly.
      if (res.statusCode >= 500) log.error(entry, 'request.complete');
      else if (res.statusCode >= 400) log.warn(entry, 'request.complete');
      else log.info(entry, 'request.complete');
    };

    // Use 'finish' (headers sent + body flushed) so duration includes the
    // full response. 'close' fires on aborted connections; log those too so
    // dropped requests aren't invisible.
    let logged = false;
    const once = () => { if (!logged) { logged = true; finalize(); } };
    res.on('finish', once);
    res.on('close', once);
    next();
  };
}

function parseContentLength(value) {
  if (value == null) return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { httpLog };
