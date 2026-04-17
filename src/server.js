const express = require('express');
const path = require('path');
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


// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Budget Manager running on port ${PORT}`));
