/* startup.test.js — boot-sequence smoke test.

   Pins the prod-crash that 6.5b-A shipped with: the pool wrapper threw on
   `pool.connect()` returning undefined, and `node -c server.js` (a syntax
   check) didn't catch it because boot only crashes when the wrapper actually
   runs. A real boot smoke test would have caught it.

   What this test covers, in sequence:
     1. Construct a Pool (mocked — we don't want CI to need a real Postgres).
     2. Run wrapPoolWithSlowQueryLog on it. Must not throw.
     3. Execute SELECT 1 through the wrapped pool, with a 5s timeout. Must
        return a result within timeout.
     4. Acquire a client via pool.connect() (promise form). Must return a
        usable client.

   What this test deliberately does NOT cover:
     - End-to-end Express bootstrap (would need to mock pg + bind a port +
       hit /api/health). That's a docker-run smoke check, not a node:test.
     - Real Postgres connectivity. The boot crash was wrapper logic, not
       network/auth. A real-DB check belongs in a deploy-time probe.

   This file lives in src/lib/ so it gets picked up by the existing
   `node --test src/lib/*.test.js` glob in CI.
*/

const { test } = require('node:test');
const assert = require('node:assert');
const { wrapPoolWithSlowQueryLog } = require('./logger');

const silentLog = {
  warn: () => {},
  error: () => {},
  info: () => {},
  child: () => silentLog,
};

// Mock pool: shaped like a pg Pool but backed by in-memory state.
// Behaves correctly for the SELECT 1 path (both pool.query and client.query)
// and exposes a release() on clients.
function makeMockPool() {
  return {
    query: async (sql) => {
      if (/^\s*SELECT\s+1\b/i.test(sql)) {
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      }
      return { rowCount: 0, rows: [] };
    },
    connect: () => Promise.resolve({
      query: async (sql) => {
        if (/^\s*SELECT\s+1\b/i.test(sql)) {
          return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    }),
  };
}

// Helper: run a promise with a hard timeout. Boot smoke test: if any step
// hangs more than 5s, fail loudly rather than letting CI time out silently.
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

test('boot sequence: pool wrap + SELECT 1 completes within 5s', async () => {
  const pool = makeMockPool();
  // Step 1+2: construct + wrap. Both must not throw.
  assert.doesNotThrow(() => wrapPoolWithSlowQueryLog(pool, silentLog),
    'wrapPoolWithSlowQueryLog must not throw on a fresh pool');

  // Step 3: SELECT 1 with 5s timeout.
  const result = await withTimeout(pool.query('SELECT 1 AS ok'), 5000, 'SELECT 1 via pool');
  assert.strictEqual(result.rowCount, 1, 'SELECT 1 should return one row');
});

test('boot sequence: pool.connect() promise form returns usable client', async () => {
  const pool = makeMockPool();
  wrapPoolWithSlowQueryLog(pool, silentLog);

  const client = await withTimeout(pool.connect(), 5000, 'pool.connect()');
  assert.ok(client, 'pool.connect() must return a client');
  assert.strictEqual(typeof client.query, 'function', 'client must have query()');
  assert.strictEqual(typeof client.release, 'function', 'client must have release()');

  const result = await withTimeout(client.query('SELECT 1'), 5000, 'client.query SELECT 1');
  assert.strictEqual(result.rowCount, 1);
  client.release();
});

test('boot sequence: real pg module loads without crashing', () => {
  // Belt-and-braces: just requiring pg shouldn't throw. This catches the
  // case where someone removes pg from package.json or breaks the install.
  // We don't construct a real Pool here (would need DATABASE_URL); we just
  // confirm the import resolves.
  assert.doesNotThrow(() => {
    const pg = require('pg');
    assert.ok(typeof pg.Pool === 'function', 'pg.Pool should be a constructor');
  });
});
