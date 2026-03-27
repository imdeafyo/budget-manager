const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));

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
    res.json({
      exportDate: new Date().toISOString(), userId,
      budgetState: state.rows[0]?.state || null,
      customTaxYears: years.rows.reduce((db, r) => { db[r.year] = r.data; return db; }, {}),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/import/:userId?', async (req, res) => {
  const userId = req.params.userId || 'default';
  const { budgetState, customTaxYears } = req.body;
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
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Budget Manager running on port ${PORT}`));
