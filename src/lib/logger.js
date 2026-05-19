/* src/lib/logger.js — Pino logger + slow-query pool wrapper.

   Phase 6.5b-A. Pretty output is the default — no env var needed. The goal is
   debugging in general, so the friendlier format wins. Set LOG_FORMAT=json to
   flip to raw JSON if a log shipper ever needs structured input.

   Slow-query wrapper: any pool.query() (or client.query() from pool.connect())
   that runs longer than SLOW_QUERY_MS gets a warn log with the SQL text +
   duration. Bind parameter values are NOT logged — too easy to leak PII (notes,
   descriptions, account names). The SQL alone is enough to identify the call
   site and reproduce locally.
*/

const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const usePretty = process.env.LOG_FORMAT !== 'json';

const logger = pino({
  level,
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname,service',
            singleLine: false,
          },
        },
      }
    : {}),
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[redacted]',
  },
  base: { service: 'budget-manager' },
});

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 500;

/** Truncate SQL for log output so a giant IN-list doesn't blow up a log line. */
function truncSql(sql, max = 500) {
  if (typeof sql !== 'string') return String(sql);
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

/** Wrap a pg Pool so .query() logs slow queries. .connect()'s returned client
 *  also gets its .query() wrapped, so transaction blocks are covered too. */
function wrapPoolWithSlowQueryLog(pool, log = logger) {
  const origQuery = pool.query.bind(pool);
  pool.query = function patchedQuery(...args) {
    const started = Date.now();
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    const result = origQuery(...args);
    // pool.query may return a Promise or accept a callback. The promise branch
    // covers all current call sites in server.js.
    if (result && typeof result.then === 'function') {
      result.then(
        (r) => {
          const dur = Date.now() - started;
          if (dur >= SLOW_QUERY_MS) {
            log.warn({ event: 'db.slow', durMs: dur, sql: truncSql(sql), rowCount: r?.rowCount }, 'slow query');
          }
          return r;
        },
        (err) => {
          const dur = Date.now() - started;
          log.error({ event: 'db.error', durMs: dur, sql: truncSql(sql), err: err?.message }, 'query failed');
          throw err;
        }
      );
    }
    return result;
  };

  // Wrap a client.query so slow queries inside a transaction block also log.
  function wrapClient(client) {
    if (!client || typeof client.query !== 'function' || client.__sqlWrapped) return client;
    const cQuery = client.query.bind(client);
    client.query = function patchedClientQuery(...qa) {
      const started = Date.now();
      const sql = typeof qa[0] === 'string' ? qa[0] : qa[0]?.text;
      const result = cQuery(...qa);
      if (result && typeof result.then === 'function') {
        result.then(
          (r) => {
            const dur = Date.now() - started;
            if (dur >= SLOW_QUERY_MS) {
              log.warn({ event: 'db.slow', durMs: dur, sql: truncSql(sql), rowCount: r?.rowCount }, 'slow query (client)');
            }
            return r;
          },
          (err) => {
            const dur = Date.now() - started;
            log.error({ event: 'db.error', durMs: dur, sql: truncSql(sql), err: err?.message }, 'client query failed');
            throw err;
          }
        );
      }
      return result;
    };
    client.__sqlWrapped = true;
    return client;
  }

  const origConnect = pool.connect.bind(pool);
  pool.connect = function patchedConnect(...args) {
    // Callback form: pool.connect((err, client, release) => {…}).
    // Intercept the callback so we can wrap the client before user code sees it.
    if (typeof args[0] === 'function') {
      const userCb = args[0];
      return origConnect((err, client, release) => {
        if (!err) wrapClient(client);
        return userCb(err, client, release);
      });
    }
    // Promise form: returns a Promise<Client>. Wrap the client when it resolves.
    // If the underlying call returns undefined (some pg variants under specific
    // conditions), pass that through unchanged rather than crashing.
    const ret = origConnect(...args);
    if (ret && typeof ret.then === 'function') {
      return ret.then((client) => wrapClient(client));
    }
    return ret;
  };

  return pool;
}

module.exports = { logger, wrapPoolWithSlowQueryLog, SLOW_QUERY_MS };
