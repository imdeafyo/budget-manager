const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
});

// Auto-create tables
pool.query(`
  CREATE TABLE IF NOT EXISTS budget_state (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL DEFAULT 'default',
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_user ON budget_state(user_id);
  CREATE TABLE IF NOT EXISTS budget_state_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL DEFAULT 'default',
    state JSONB NOT NULL,
    state_size_bytes INTEGER NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    label VARCHAR(200)
  );
  CREATE INDEX IF NOT EXISTS idx_bsh_user_time ON budget_state_history(user_id, saved_at DESC);
  CREATE TABLE IF NOT EXISTS custom_tax_years (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL DEFAULT 'default',
    year VARCHAR(4) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, year)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    amount NUMERIC(14, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    description TEXT NOT NULL DEFAULT '',
    category TEXT,
    account TEXT NOT NULL DEFAULT '',
    notes TEXT,
    import_batch_id UUID,
    import_source TEXT,
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_user_category ON transactions(user_id, category);
  CREATE INDEX IF NOT EXISTS idx_tx_user_account ON transactions(user_id, account);
  CREATE INDEX IF NOT EXISTS idx_tx_user_batch ON transactions(user_id, import_batch_id);
`).then(() => console.log('Schema ready')).catch(err => console.error('Schema error:', err.message));

// API routes
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/state/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    const r = await pool.query('SELECT state, updated_at FROM budget_state WHERE user_id = $1', [userId]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/state/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    const r = await pool.query(
      `INSERT INTO budget_state (user_id, state, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET state = $2, updated_at = NOW() RETURNING updated_at`,
      [userId, JSON.stringify(req.body.state)]
    );
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tax-years/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    const r = await pool.query('SELECT year, data FROM custom_tax_years WHERE user_id = $1 ORDER BY year', [userId]);
    const db = {};
    r.rows.forEach(row => { db[row.year] = row.data; });
    res.json(db);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/tax-years/:year/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    await pool.query(
      `INSERT INTO custom_tax_years (user_id, year, data) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, year) DO UPDATE SET data = $3`,
      [userId, req.params.year, JSON.stringify(req.body.data)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    const state = await pool.query('SELECT state FROM budget_state WHERE user_id = $1', [userId]);
    const years = await pool.query('SELECT year, data FROM custom_tax_years WHERE user_id = $1', [userId]);
    const txs = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC',
      [userId]
    );
    res.json({
      exportDate: new Date().toISOString(), userId,
      budgetState: state.rows[0]?.state || null,
      customTaxYears: years.rows.reduce((db, r) => { db[r.year] = r.data; return db; }, {}),
      transactions: txs.rows.map(rowToTx),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/import/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const { budgetState, customTaxYears, transactions } = req.body;
  try {
    if (budgetState) {
      await pool.query(
        `INSERT INTO budget_state (user_id, state, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET state = $2, updated_at = NOW()`,
        [userId, JSON.stringify(budgetState)]
      );
    }
    if (customTaxYears) {
      for (const [year, data] of Object.entries(customTaxYears)) {
        await pool.query(
          `INSERT INTO custom_tax_years (user_id, year, data) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, year) DO UPDATE SET data = $3`,
          [userId, year, JSON.stringify(data)]
        );
      }
    }
    if (Array.isArray(transactions)) {
      // Replace-all semantics: wipe and rewrite. Matches generic-HTML behavior.
      await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
      for (const tx of transactions) {
        await insertTransaction(userId, tx);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════ Transactions API ══════════════════════════ */
async function insertTransaction(userId, tx) {
  return pool.query(
    `INSERT INTO transactions
      (id, user_id, date, amount, currency, description, category, account, notes,
       import_batch_id, import_source, custom_fields, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       date = EXCLUDED.date, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
       description = EXCLUDED.description, category = EXCLUDED.category,
       account = EXCLUDED.account, notes = EXCLUDED.notes,
       import_batch_id = EXCLUDED.import_batch_id, import_source = EXCLUDED.import_source,
       custom_fields = EXCLUDED.custom_fields, updated_at = EXCLUDED.updated_at`,
    [
      tx.id, userId, tx.date, tx.amount, tx.currency || 'USD',
      tx.description || '', tx.category || null, tx.account || '', tx.notes || null,
      tx.import_batch_id || null, tx.import_source || null,
      JSON.stringify(tx.custom_fields || {}),
      tx.created_at || new Date().toISOString(),
      tx.updated_at || new Date().toISOString(),
    ]
  );
}

function rowToTx(r) {
  return {
    id: r.id,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    amount: Number(r.amount),
    currency: r.currency,
    description: r.description,
    category: r.category,
    account: r.account,
    notes: r.notes,
    import_batch_id: r.import_batch_id,
    import_source: r.import_source,
    custom_fields: r.custom_fields || {},
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

// GET all transactions for a user (Phase 4a: load-all model)
app.get('/api/transactions/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    const r = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC`,
      [userId]
    );
    res.json({ transactions: r.rows.map(rowToTx), count: r.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — bulk insert (used by CSV import in Phase 4b; also manual add for single row)
app.post('/api/transactions/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const { transactions } = req.body;
  if (!Array.isArray(transactions)) {
    return res.status(400).json({ error: 'transactions must be an array' });
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const tx of transactions) {
        await client.query(
          `INSERT INTO transactions
            (id, user_id, date, amount, currency, description, category, account, notes,
             import_batch_id, import_source, custom_fields, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
           ON CONFLICT (id) DO NOTHING`,
          [
            tx.id, userId, tx.date, tx.amount, tx.currency || 'USD',
            tx.description || '', tx.category || null, tx.account || '', tx.notes || null,
            tx.import_batch_id || null, tx.import_source || null,
            JSON.stringify(tx.custom_fields || {}),
            tx.created_at || new Date().toISOString(),
            tx.updated_at || new Date().toISOString(),
          ]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, inserted: transactions.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT — update single transaction
app.put('/api/transactions/:id/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const id = req.params.id;
  const tx = req.body.transaction;
  if (!tx || tx.id !== id) return res.status(400).json({ error: 'transaction.id must match url id' });
  try {
    await insertTransaction(userId, { ...tx, updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — one, or a batch, or all (via ?batch=id or ?all=1)
app.delete('/api/transactions/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const { ids, batch_id } = req.body || {};
  try {
    if (batch_id) {
      const r = await pool.query(
        `DELETE FROM transactions WHERE user_id = $1 AND import_batch_id = $2`,
        [userId, batch_id]
      );
      return res.json({ ok: true, deleted: r.rowCount });
    }
    if (Array.isArray(ids) && ids.length) {
      const r = await pool.query(
        `DELETE FROM transactions WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, ids]
      );
      return res.json({ ok: true, deleted: r.rowCount });
    }
    return res.status(400).json({ error: 'provide ids[] or batch_id' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Query builder endpoint — Phase 4c. Stub returns a helpful error for now.
app.post('/api/transactions/query/:userId?', (req, res) => {
  res.status(501).json({ error: 'Query builder lands in Phase 4c.' });
});

/* ══════════════════════════ Backup History ══════════════════════════
   Periodic full-state snapshots of budget_state. The cron runs in-process
   on a 1-minute setInterval; cheap because most ticks exit early after a
   pure arithmetic check. pg_try_advisory_lock guards against accidental
   multi-replica double-snapshots — this deployment is single-replica, but
   the lock costs nothing if you scale to 1.

   Policy lives in budget_state.state.historyConfig (per user). If absent,
   defaults are used. Tier semantics, dedup rules, and retention logic are
   documented in src/frontend/utils/history.js — kept in sync here. */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const ADVISORY_LOCK_KEY = 8675309; // arbitrary; just needs to be unique-per-feature

const DEFAULT_HISTORY_CONFIG = {
  enabled: true,
  hourly:  { intervalMs: HOUR_MS,  keep: 24 },
  daily:   { intervalMs: DAY_MS,   keep: 30 },
  weekly:  { intervalMs: WEEK_MS,  keep: 12 },
  monthly: { intervalMs: MONTH_MS, keep: 12 },
};
const TIER_NAMES = ['hourly', 'daily', 'weekly', 'monthly'];

function dueTiers(now, lastSnapshotAt, cfg) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const last = lastSnapshotAt || {};
  const due = [];
  for (const tier of TIER_NAMES) {
    const c = cfg[tier];
    if (!c) continue;
    const prev = last[tier];
    if (!prev) { due.push(tier); continue; }
    const prevT = new Date(prev).getTime();
    if (Number.isNaN(prevT)) { due.push(tier); continue; }
    if (t - prevT >= c.intervalMs) due.push(tier);
  }
  return due;
}

function mergeLabels(tiers) {
  if (!tiers || tiers.length === 0) return '';
  const order = { hourly: 0, daily: 1, weekly: 2, monthly: 3, manual: 4 };
  return [...new Set(tiers)].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99)).join('+');
}

function labelHasTier(label, tier) {
  if (!label) return false;
  return label.split('+').includes(tier);
}

function pruneRetention(rows, cfg) {
  if (!rows || rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
  const keep = new Set();
  for (const tier of TIER_NAMES) {
    const k = cfg[tier]?.keep ?? 0;
    sorted.filter(r => labelHasTier(r.label, tier)).slice(0, k).forEach(r => keep.add(r.id));
  }
  sorted.filter(r => labelHasTier(r.label, 'manual')).forEach(r => keep.add(r.id));
  return sorted.filter(r => !keep.has(r.id)).map(r => r.id);
}

function hashState(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function effectiveConfig(stateHistoryConfig) {
  // Shallow-merge user config over defaults; per-tier objects are replaced wholesale if present.
  if (!stateHistoryConfig || typeof stateHistoryConfig !== 'object') return DEFAULT_HISTORY_CONFIG;
  const out = { ...DEFAULT_HISTORY_CONFIG, ...stateHistoryConfig };
  for (const tier of TIER_NAMES) {
    if (stateHistoryConfig[tier]) out[tier] = { ...DEFAULT_HISTORY_CONFIG[tier], ...stateHistoryConfig[tier] };
  }
  return out;
}

/* ── takeSnapshot — core write path. Used by both cron and manual endpoint.
   Pass an explicit `forcedLabel` ("manual") to bypass the dueness check.
   Returns { inserted: bool, reason: string } for logging. */
async function takeSnapshot(userId, { forcedLabel = null } = {}) {
  const client = await pool.connect();
  try {
    // Try-advisory-lock so concurrent ticks (or accidental multi-replica) don't double-write.
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS got', [ADVISORY_LOCK_KEY]);
    if (!lockRes.rows[0].got) return { inserted: false, reason: 'lock-held' };

    try {
      const stateRes = await client.query(
        'SELECT state FROM budget_state WHERE user_id = $1', [userId]
      );
      if (stateRes.rows.length === 0) return { inserted: false, reason: 'no-state' };
      const state = stateRes.rows[0].state;
      const cfg = effectiveConfig(state?.historyConfig);
      if (!forcedLabel && cfg.enabled === false) return { inserted: false, reason: 'disabled' };

      // Determine label
      let label;
      if (forcedLabel) {
        label = forcedLabel;
      } else {
        const lastRes = await client.query(
          `SELECT label, saved_at FROM budget_state_history
           WHERE user_id = $1 ORDER BY saved_at DESC LIMIT 100`,
          [userId]
        );
        // Build lastSnapshotAt map: latest saved_at per tier the row's label includes.
        const lastSnap = {};
        for (const tier of TIER_NAMES) {
          const found = lastRes.rows.find(r => labelHasTier(r.label, tier));
          if (found) lastSnap[tier] = found.saved_at;
        }
        const due = dueTiers(new Date(), lastSnap, cfg);
        if (due.length === 0) return { inserted: false, reason: 'not-due' };
        label = mergeLabels(due);
      }

      // De-dup against the most recent history row regardless of label.
      const recentRes = await client.query(
        `SELECT state FROM budget_state_history
         WHERE user_id = $1 ORDER BY saved_at DESC LIMIT 1`,
        [userId]
      );
      if (recentRes.rows.length > 0) {
        const prevHash = hashState(recentRes.rows[0].state);
        const curHash = hashState(state);
        if (prevHash === curHash && !forcedLabel) {
          return { inserted: false, reason: 'duplicate' };
        }
      }

      const sizeBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
      await client.query(
        `INSERT INTO budget_state_history (user_id, state, state_size_bytes, label)
         VALUES ($1, $2, $3, $4)`,
        [userId, JSON.stringify(state), sizeBytes, label]
      );

      // Prune. Pull all rows (id, saved_at, label) — ids only, not full state.
      const allRes = await client.query(
        `SELECT id, saved_at, label FROM budget_state_history
         WHERE user_id = $1 ORDER BY saved_at DESC`,
        [userId]
      );
      const toDelete = pruneRetention(allRes.rows, cfg);
      if (toDelete.length > 0) {
        await client.query(
          `DELETE FROM budget_state_history WHERE id = ANY($1::int[])`,
          [toDelete]
        );
      }

      return { inserted: true, label, pruned: toDelete.length };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

// Cron tick — every 60s. Currently single-tenant (user_id='default'); generalize when multi-user lands.
const CRON_INTERVAL_MS = 60 * 1000;
const CRON_USERS = ['default'];
function startHistoryCron() {
  setInterval(async () => {
    for (const userId of CRON_USERS) {
      try {
        const r = await takeSnapshot(userId);
        if (r.inserted) console.log(`[history] snapshot user=${userId} label=${r.label} pruned=${r.pruned}`);
      } catch (err) {
        console.error('[history] cron error:', err.message);
      }
    }
  }, CRON_INTERVAL_MS);
  // Also fire once shortly after startup so a fresh deploy gets an immediate baseline.
  setTimeout(() => takeSnapshot('default').catch(e => console.error('[history] startup snapshot:', e.message)), 5000);
}

/* ── History API endpoints ── */

// List with pagination. Returns row metadata only (no state JSONB), keeps response small.
app.get('/api/history/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  try {
    const r = await pool.query(
      `SELECT id, label, saved_at, state_size_bytes
       FROM budget_state_history WHERE user_id = $1
       ORDER BY saved_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const totalRes = await pool.query(
      'SELECT COUNT(*)::int AS n FROM budget_state_history WHERE user_id = $1',
      [userId]
    );
    res.json({ rows: r.rows, total: totalRes.rows[0].n, limit, offset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch a single history row's full state (for preview).
app.get('/api/history/:id/state/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = await pool.query(
      'SELECT id, label, saved_at, state_size_bytes, state FROM budget_state_history WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual snapshot.
app.post('/api/history/snapshot/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  try {
    const r = await takeSnapshot(userId, { forcedLabel: 'manual' });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Restore. Takes a "pre-restore" labeled snapshot first so the restore is itself reversible.
app.post('/api/history/:id/restore/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    // Pre-restore safety snapshot. Best-effort — if it fails, log but proceed.
    try { await takeSnapshot(userId, { forcedLabel: 'pre-restore' }); }
    catch (e) { console.error('[history] pre-restore snapshot failed:', e.message); }

    const r = await pool.query(
      'SELECT state FROM budget_state_history WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not found' });
    await pool.query(
      `INSERT INTO budget_state (user_id, state, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET state = $2, updated_at = NOW()`,
      [userId, JSON.stringify(r.rows[0].state)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a history row (lets the user clear out a manual snapshot they don't want).
app.delete('/api/history/:id/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = await pool.query(
      'DELETE FROM budget_state_history WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Budget Manager running on port ${PORT}`);
  startHistoryCron();
});
