/* src/lib/logger.js — Pino logger setup + slow-query pool wrapper.

   Phase 6.5b-A. Always emits raw JSON to stdout. (The original implementation
   ran pino-pretty in dev via a worker-thread transport, which hung every
   request when the worker failed to init inside the slim container — see
   2026-05-17 incident. Pipe `kubectl logs` through pino-pretty on the CLI if
   you want colorized local output.) File rotation / PVC plumbing lands in
   6.5b-B.

   Slow-query wrapper: any pool.query() (or client.query() from pool.connect())
   that runs longer than SLOW_QUERY_MS gets a warn log with the SQL text +
   duration. Bind parameter values are NOT logged — too easy to leak PII (notes,
   descriptions, account names). The SQL itself is enough to identify the call
   site and reproduce locally.
*/

const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';

const logger = pino({
  level,
  // Always emit raw JSON to stdout. The pino-pretty transport runs in a worker
  // thread and pipes log lines over a socket; if that worker fails to init
  // inside a slim container, every log call from the main thread hangs and
  // every middleware-logging request hangs with it. JSON is grep-friendly and
  // works in every environment — readability in dev terminals isn't worth the
  // failure mode. Pipe to `pino-pretty` on the CLI locally if needed.
  redact: {
    // Redact common credential paths if they ever appear in metadata.
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[redacted]',
  },
  base: { service: 'budget-manager' },
});

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 500;

/** Wrap a pg Pool so .query() logs slow queries. .connect()'s returned client
 *  also gets its .query() wrapped, so transaction blocks are covered too. */
function wrapPoolWithSlowQueryLog(pool, log) {
  // Hold onto the original methods. We replace the methods on the same Pool
  // instance rather than returning a proxy so existing code keeps working
  // (server.js stores `pool` in module scope and references it everywhere).
  const origQuery = pool.query.bind(pool);
  const origConnect = pool.connect.bind(pool);

  pool.query = async function loggedQuery(...args) {
    const start = process.hrtime.bigint();
    try {
      const result = await origQuery(...args);
      const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      if (ms >= SLOW_QUERY_MS) {
        const sql = extractSql(args);
        log.warn({ ms: Math.round(ms), sql: truncate(sql, 500), rows: result?.rowCount }, 'slow query');
      }
      return result;
    } catch (err) {
      const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      log.error({ ms: Math.round(ms), sql: truncate(extractSql(args), 500), err: err.message }, 'query failed');
      throw err;
    }
  };

  pool.connect = async function loggedConnect() {
    const client = await origConnect();
    const clientOrigQuery = client.query.bind(client);
    client.query = async function clientLoggedQuery(...args) {
      const start = process.hrtime.bigint();
      try {
        const result = await clientOrigQuery(...args);
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        if (ms >= SLOW_QUERY_MS) {
          const sql = extractSql(args);
          log.warn({ ms: Math.round(ms), sql: truncate(sql, 500), rows: result?.rowCount }, 'slow query (txn)');
        }
        return result;
      } catch (err) {
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        log.error({ ms: Math.round(ms), sql: truncate(extractSql(args), 500), err: err.message }, 'query failed (txn)');
        throw err;
      }
    };
    return client;
  };

  return pool;
}

function extractSql(args) {
  // pg accepts either query(text, values, cb), query({text, values}, cb), or
  // a prepared-statement config. We just want the SQL text for logging.
  if (!args || args.length === 0) return '';
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof first.text === 'string') return first.text;
  return '';
}

function truncate(str, max) {
  if (!str) return '';
  // Collapse whitespace runs so the SQL fits on one log line.
  const cleaned = String(str).replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
}

module.exports = {
  logger,
  wrapPoolWithSlowQueryLog,
  SLOW_QUERY_MS,
};
