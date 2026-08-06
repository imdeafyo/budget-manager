/* lib/insights.js — LLM Financial Insights backend.
 *
 * This module is the server-side brain for the Insights chat feature. It is
 * deliberately provider-agnostic: the route in server.js talks only to
 * runInsightsChat(), and the provider (Claude today; OpenAI / Ollama later)
 * is selected behind a small adapter interface. Adding a provider = adding an
 * adapter, not editing the route or the tool loop.
 *
 * Design invariants (see project scope):
 *   - The API KEY never leaves the server. It is read from process.env here
 *     and never returned to the client. The frontend picks a provider *name*,
 *     never a key.
 *   - The LLM never computes financial math. It calls tools that run real SQL
 *     against the transactions table; all arithmetic lives in SQL / calc.js.
 *   - Tools return only the rows/aggregates asked for — we never prompt-dump
 *     the whole 24k-row table.
 *
 * The adapter interface (one method):
 *   adapter.createMessage({ system, messages, tools }) ->
 *     { content: [ {type:'text',text} | {type:'tool_use',id,name,input} ],
 *       stopReason: 'tool_use' | 'end_turn' | ... }
 * Each adapter is responsible for translating that neutral shape to/from its
 * provider's wire format. Only the Claude adapter is implemented in this slice.
 */

'use strict';

const { logger } = require('./logger');

/* ─────────────────────────── Config ─────────────────────────── */

// Per-provider API keys. Each provider has its own env var, so you can wire
// every key you have once and switch providers from Settings without
// re-pasting keys. Ollama needs no key (local). Keys are read here on the
// server and NEVER returned to the client.
//   Claude  -> INSIGHTS_ANTHROPIC_API_KEY
//   OpenAI  -> INSIGHTS_OPENAI_API_KEY   (used when the OpenAI adapter lands)
//   Ollama  -> (no key; uses INSIGHTS_OLLAMA_URL when that adapter lands)
const PROVIDER_KEYS = {
  claude: process.env.INSIGHTS_ANTHROPIC_API_KEY || '',
  openai: process.env.INSIGHTS_OPENAI_API_KEY || '',
};
// Providers that don't need a key to be considered "configured".
const KEYLESS_PROVIDERS = new Set(['ollama']);

// Per-provider model strings. Each provider names its models differently, so
// a single shared model string would break on switch. Each has its own env
// override with a sensible default (Ollama has no universal default — it
// depends on what the user has pulled locally, so it must be set).
//   Claude  -> INSIGHTS_ANTHROPIC_MODEL
//   OpenAI  -> INSIGHTS_OPENAI_MODEL   (used when the OpenAI adapter lands)
//   Ollama  -> INSIGHTS_OLLAMA_MODEL   (used when the Ollama adapter lands)
const PROVIDER_MODELS = {
  claude: process.env.INSIGHTS_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  openai: process.env.INSIGHTS_OPENAI_MODEL || 'gpt-4o',
  ollama: process.env.INSIGHTS_OLLAMA_MODEL || 'llama3.1',
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOOL_ROUNDS = 6; // hard ceiling on tool-use round-trips per question

function keyFor(provider) {
  return PROVIDER_KEYS[provider] || '';
}

function modelFor(provider) {
  return PROVIDER_MODELS[provider] || PROVIDER_MODELS.claude;
}

// A provider is configured if it's keyless (Ollama) or has its key wired.
function insightsConfigured(provider = 'claude') {
  if (KEYLESS_PROVIDERS.has(provider)) return true;
  return keyFor(provider).length > 0;
}

/* ─────────────────────── Transaction query tools ───────────────────────
 * Two tools share one filter builder:
 *   - query_transactions: list matching rows (bounded, but honest about the
 *     true total — never silently truncates).
 *   - get_aggregates: exact MIN/MAX/SUM/COUNT/AVG computed in SQL over ALL
 *     matching rows, so superlatives ("biggest purchase") and totals are
 *     exact and unlimited — the database does the math, not the model.
 *
 * `pool` is injected so this module has no direct DB dependency and stays
 * unit-testable with a fake pool.
 */

// Generous cap on how many rows we hand the model at once. This bounds only
// row *listing* (to protect the context window / cost), never aggregate
// answers, which are computed over the full table. When a list is truncated,
// the result says so loudly and the model is told to surface it.
const QUERY_ROW_CAP = 500;

/* ─────────────────────── Savings-category exclusion ───────────────────────
 * Savings contributions live in the transactions table like any other row, but
 * they are NOT spending — folding them into "expenses" / "top merchants" /
 * "recurring" answers overstates outflow and buries real discretionary spend.
 * A "savings" transaction is one whose category is a savings category.
 *
 * Which categories are savings is read from saved state, never hardcoded: the
 * budget's savings line items (state.sav) each carry a category tag `c`, and
 * the distinct set of those tags is exactly the household's savings categories.
 * (There is no account signal for savings — deliberately skipped.) The server
 * extracts these once via savingsCategoriesFromState and passes them on ctx;
 * the chat loop threads them onto every tool call as ctx.savingsCategories.
 *
 * Enforcement reuses the existing excludeCategories machinery, so savings
 * exclusion inherits the same NOT-IN SQL and the same loud unmatched-name
 * warning path — no parallel filter to drift. It is applied by DEFAULT and
 * opted out per call with includeSavings:true (set by the model only when the
 * user explicitly asks about saving / contributions).
 */

// Distinct savings category names from the budget's savings line items.
// Defensive about state shape: state.sav may be absent or malformed.
function savingsCategoriesFromState(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.sav)) return [];
  const seen = new Set();
  const out = [];
  for (const item of state.sav) {
    const c = item && typeof item.c === 'string' ? item.c.trim() : '';
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

// Merge the standing savings categories into a filter's excludeCategories,
// unless the caller opted in with includeSavings:true. Returns a NEW filter
// object (never mutates the model-supplied input). De-dupes case-insensitively
// against any excludeCategories the model already passed so we don't double-add.
// Because it feeds excludeCategories, the unmatched-name warning path applies
// automatically — a savings category that matches nothing gets flagged too.
function withSavingsExclusion(filters = {}, savingsCategories = []) {
  if (filters.includeSavings === true) return filters;
  const sav = Array.isArray(savingsCategories)
    ? savingsCategories.filter(c => typeof c === 'string' && c.length)
    : [];
  if (!sav.length) return filters;
  const existing = Array.isArray(filters.excludeCategories)
    ? filters.excludeCategories.filter(c => typeof c === 'string' && c.length)
    : [];
  const lower = new Set(existing.map(c => c.toLowerCase()));
  const merged = [...existing];
  for (const c of sav) {
    if (!lower.has(c.toLowerCase())) { lower.add(c.toLowerCase()); merged.push(c); }
  }
  return { ...filters, excludeCategories: merged };
}

// Build the shared WHERE clause + params from a filter object. Returns
// { whereSql, params, nextIndex } so callers can append their own clauses
// (e.g. LIMIT) continuing the $N numbering.
function buildWhere(userId, filters = {}) {
  const where = ['user_id = $1'];
  const params = [userId];
  let i = 2;

  if (filters.startDate) { where.push(`date >= $${i++}`); params.push(filters.startDate); }
  if (filters.endDate)   { where.push(`date <= $${i++}`); params.push(filters.endDate); }
  if (filters.category)  { where.push(`category = $${i++}`); params.push(filters.category); }
  if (filters.account)   { where.push(`account = $${i++}`); params.push(filters.account); }
  if (filters.descriptionContains) {
    where.push(`description ILIKE $${i++}`);
    params.push('%' + filters.descriptionContains + '%');
  }
  if (filters.notesContains) {
    // notes is nullable; ILIKE on NULL is NULL (row excluded), which is right —
    // a row with no note cannot match a note substring.
    where.push(`notes ILIKE $${i++}`);
    params.push('%' + filters.notesContains + '%');
  }
  // Multi-value inclusion (IN lists) — the OR mirror of the single `category` /
  // `account` exact match. Lets "Dining or Groceries" be one query instead of
  // two the model would be tempted to add up by hand.
  const inCats = Array.isArray(filters.categories)
    ? filters.categories.filter(c => typeof c === 'string' && c.length)
    : [];
  if (inCats.length) {
    const ph = inCats.map(() => `$${i++}`).join(', ');
    where.push(`category IN (${ph})`);
    params.push(...inCats);
  }
  const inAccts = Array.isArray(filters.accounts)
    ? filters.accounts.filter(a => typeof a === 'string' && a.length)
    : [];
  if (inAccts.length) {
    const ph = inAccts.map(() => `$${i++}`).join(', ');
    where.push(`account IN (${ph})`);
    params.push(...inAccts);
  }
  // Uncategorized: rows with no category. Postgres stores these as NULL; some
  // imports use empty string, so treat both as uncategorized.
  if (filters.uncategorized === true) {
    where.push(`(category IS NULL OR category = '')`);
  }
  // Exclusion filters — the inverse of category / descriptionContains. Let the
  // model answer "... that are NOT transfers or securities trades" by naming
  // categories to drop and/or description substrings to exclude. Without these
  // an exclusion request is unexpressible and silently returns the wrong set.
  const excludeCats = Array.isArray(filters.excludeCategories)
    ? filters.excludeCategories.filter(c => typeof c === 'string' && c.length)
    : [];
  if (excludeCats.length) {
    // NOT IN drops the named categories. NULL categories are kept (NULL is
    // never IN a list), which is the intended behavior — an untagged row is
    // not "a transfer" just because it lacks a category.
    const ph = excludeCats.map(() => `$${i++}`).join(', ');
    where.push(`(category IS NULL OR category NOT IN (${ph}))`);
    params.push(...excludeCats);
  }
  const excludeDesc = Array.isArray(filters.descriptionExcludes)
    ? filters.descriptionExcludes.filter(s => typeof s === 'string' && s.length)
    : [];
  for (const sub of excludeDesc) {
    where.push(`description NOT ILIKE $${i++}`);
    params.push('%' + sub + '%');
  }
  const excludeAccts = Array.isArray(filters.excludeAccounts)
    ? filters.excludeAccounts.filter(a => typeof a === 'string' && a.length)
    : [];
  if (excludeAccts.length) {
    // account is NOT NULL (defaults to '') so a plain NOT IN is safe here.
    const ph = excludeAccts.map(() => `$${i++}`).join(', ');
    where.push(`account NOT IN (${ph})`);
    params.push(...excludeAccts);
  }
  // amount filters. Transactions store signed amounts; callers can ask by
  // absolute magnitude via minAbsAmount (useful for "large" spend/income).
  if (typeof filters.minAmount === 'number') { where.push(`amount >= $${i++}`); params.push(filters.minAmount); }
  if (typeof filters.maxAmount === 'number') { where.push(`amount <= $${i++}`); params.push(filters.maxAmount); }
  if (typeof filters.minAbsAmount === 'number') { where.push(`ABS(amount) >= $${i++}`); params.push(filters.minAbsAmount); }
  // Restrict to expenses (amount < 0) or income (amount > 0) when asked.
  if (filters.sign === 'expense') { where.push(`amount < 0`); }
  else if (filters.sign === 'income') { where.push(`amount > 0`); }

  return { whereSql: where.join(' AND '), params, nextIndex: i };
}

function rowToLite(r) {
  const lite = {
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    amount: Number(r.amount),
    description: r.description,
    category: r.category,
    account: r.account,
  };
  // Only surface notes when present — keeps the row compact and avoids feeding
  // the model a wall of nulls. Rows are selected with notes below.
  if (r.notes != null && r.notes !== '') lite.notes = r.notes;
  return lite;
}

// Whitelist for the sort column so nothing user/model-supplied reaches SQL.
const SORT_COLUMNS = {
  date: 'date',
  amount: 'amount',
  absamount: 'ABS(amount)',
};

/* Detect exclude-filter values that don't correspond to any real category or
 * account for this user. The model sometimes guesses a name ("Brokerage") that
 * isn't literally what's stored; a NOT IN on a non-existent value silently
 * excludes nothing, so the answer looks like it honored the exclusion when it
 * didn't. We check existence up front and, for any value that matches zero
 * rows, return a loud note so the caller/model can't quietly ignore it.
 *
 * One cheap query per dimension that was actually used. Case-insensitive so a
 * casing mismatch ("dining" vs "Dining") is treated as a match, not a miss —
 * the SQL filters are exact/ILIKE and this is only about "does such a value
 * exist at all", not re-implementing the filter.
 */
async function unmatchedExclusions(pool, userId, filters = {}) {
  const warnings = [];

  async function checkColumn(values, column, label) {
    const list = Array.isArray(values)
      ? values.filter(v => typeof v === 'string' && v.length)
      : [];
    if (!list.length) return;
    // Existing distinct values in this column for this user (lower-cased).
    const res = await pool.query(
      `SELECT DISTINCT lower(${column}) AS v FROM transactions
         WHERE user_id = $1 AND ${column} IS NOT NULL AND ${column} <> ''`,
      [userId]
    );
    const existing = new Set(res.rows.map(r => r.v));
    for (const val of list) {
      if (!existing.has(val.toLowerCase())) {
        warnings.push(
          `You asked to exclude the ${label} "${val}", but no ${label} by that ` +
          `name exists in the data — nothing was excluded on that value. Call ` +
          `get_aggregates with groupBy "${label}" to see the real ${label} ` +
          `names, then retry with an exact one.`
        );
      }
    }
  }

  await checkColumn(filters.excludeCategories, 'category', 'category');
  await checkColumn(filters.excludeAccounts, 'account', 'account');
  return warnings;
}

async function queryTransactions(pool, userId, filters = {}) {
  const { whereSql, params, nextIndex } = buildWhere(userId, filters);

  // Total count + sum over ALL matching rows (cheap aggregate, always exact).
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS total
       FROM transactions WHERE ${whereSql}`,
    params
  );
  const totalCount = countRes.rows[0].n;
  const totalAmount = countRes.rows[0].total;

  // Sort: whitelisted column + direction. Default date DESC (most recent).
  const col = SORT_COLUMNS[String(filters.sortBy || 'date').toLowerCase()] || 'date';
  const dir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(Number(filters.limit) || 50, QUERY_ROW_CAP);
  const rowsRes = await pool.query(
    `SELECT date, amount, description, category, account, notes
       FROM transactions WHERE ${whereSql}
       ORDER BY ${col} ${dir}, created_at DESC
       LIMIT $${nextIndex}`,
    [...params, limit]
  );

  const rows = rowsRes.rows.map(rowToLite);
  const truncated = totalCount > rows.length;

  const result = {
    totalMatching: totalCount,
    sumOfMatching: Math.round(totalAmount * 100) / 100,
    returned: rows.length,
    truncated,
    transactions: rows,
  };
  // Loud, explicit note when the list is partial — the model is instructed to
  // relay this rather than imply it saw everything. For superlatives/totals it
  // should use get_aggregates instead of a row list.
  if (truncated) {
    result.note =
      `Only ${rows.length} of ${totalCount} matching transactions are shown ` +
      `(sorted by ${col} ${dir}). This is NOT the full set. For an exact ` +
      `largest/smallest/total/average answer, call get_aggregates instead of ` +
      `reasoning over this partial list.`;
  }
  // Loud warning if an exclusion value matched nothing (guessed a bad name) —
  // otherwise the exclusion silently no-ops and the answer looks honored.
  const exWarnings = await unmatchedExclusions(pool, userId, filters);
  if (exWarnings.length) {
    result.warnings = exWarnings;
    result.note = [result.note, ...exWarnings].filter(Boolean).join(' ');
  }
  return result;
}

/* get_aggregates — exact math over ALL matching rows. No row cap applies; the
 * database computes the answer and returns a compact summary. For min/max it
 * also returns the actual extreme transaction so "biggest purchase" yields the
 * full row, not just a number. Optionally groups by a dimension. */
const GROUP_COLUMNS = {
  category: 'category',
  account: 'account',
  merchant: 'description',
};

// Time buckets for trend questions ("spending each month"). Maps the requested
// grain to a date_trunc unit; the grouped SELECT formats the bucket as an ISO
// day string so the model gets stable, sortable period labels. Whitelisted so
// nothing user/model-supplied reaches date_trunc.
const TIME_GROUPS = {
  month: 'month',
  week: 'week',
  year: 'year',
  day: 'day',
};

async function getAggregates(pool, userId, args = {}) {
  const { whereSql, params } = buildWhere(userId, args);

  // Loud warning if an exclusion value matched nothing (guessed a bad name).
  // Computed once and attached to whichever result path returns.
  const exWarnings = await unmatchedExclusions(pool, userId, args);
  const attach = (obj) => {
    if (exWarnings.length) {
      obj.warnings = exWarnings;
      obj.note = [obj.note, ...exWarnings].filter(Boolean).join(' ');
    }
    return obj;
  };

  // Time-grouped path: totals per period ("spending each month"), ordered
  // chronologically (NOT by spend — a trend needs time order). Takes priority
  // when groupBy names a time grain.
  const gkey = String(args.groupBy || '').toLowerCase();
  if (args.groupBy && TIME_GROUPS[gkey]) {
    const unit = TIME_GROUPS[gkey];
    const limit = Math.min(Number(args.groupLimit) || 60, 366);
    const res = await pool.query(
      `SELECT to_char(date_trunc('${unit}', date), 'YYYY-MM-DD') AS grp,
              COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS sum,
              COALESCE(AVG(amount), 0)::float AS avg,
              COALESCE(MIN(amount), 0)::float AS min,
              COALESCE(MAX(amount), 0)::float AS max
         FROM transactions WHERE ${whereSql}
         GROUP BY date_trunc('${unit}', date)
         ORDER BY date_trunc('${unit}', date) ASC
         LIMIT ${limit}`,
      params
    );
    return attach({
      groupedBy: gkey,
      groups: res.rows.map(r => ({
        period: r.grp,
        count: r.count,
        sum: Math.round(r.sum * 100) / 100,
        avg: Math.round(r.avg * 100) / 100,
        min: Math.round(r.min * 100) / 100,
        max: Math.round(r.max * 100) / 100,
      })),
    });
  }

  // Grouped path: totals per category/account/merchant, ordered by spend.
  if (args.groupBy && GROUP_COLUMNS[String(args.groupBy).toLowerCase()]) {
    const gcol = GROUP_COLUMNS[String(args.groupBy).toLowerCase()];
    const limit = Math.min(Number(args.groupLimit) || 20, 100);
    // minCount: HAVING COUNT(*) > N — answers "groups with more than N rows"
    // ("merchants I visited more than 5 times"). The threshold is strict (>),
    // matching "more than N". Ordered by count DESC when a count floor is set
    // (the question is about frequency, not spend); otherwise by spend.
    const minCount = Number.isFinite(Number(args.minCount)) && Number(args.minCount) > 0
      ? Math.floor(Number(args.minCount))
      : null;
    const havingSql = minCount != null ? `HAVING COUNT(*) > ${minCount}` : '';
    const orderSql = minCount != null ? 'ORDER BY COUNT(*) DESC' : 'ORDER BY SUM(amount) ASC';
    const res = await pool.query(
      `SELECT ${gcol} AS grp,
              COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS sum,
              COALESCE(AVG(amount), 0)::float AS avg,
              COALESCE(MIN(amount), 0)::float AS min,
              COALESCE(MAX(amount), 0)::float AS max
         FROM transactions WHERE ${whereSql}
         GROUP BY ${gcol}
         ${havingSql}
         ${orderSql}
         LIMIT ${limit}`,
      params
    );
    return attach({
      groupedBy: String(args.groupBy).toLowerCase(),
      groups: res.rows.map(r => ({
        group: r.grp,
        count: r.count,
        sum: Math.round(r.sum * 100) / 100,
        avg: Math.round(r.avg * 100) / 100,
        min: Math.round(r.min * 100) / 100,
        max: Math.round(r.max * 100) / 100,
      })),
    });
  }

  // Ungrouped path: scalar aggregates over the whole matching set.
  const aggRes = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(amount), 0)::float AS sum,
            COALESCE(AVG(amount), 0)::float AS avg,
            MIN(amount)::float AS min,
            MAX(amount)::float AS max
       FROM transactions WHERE ${whereSql}`,
    params
  );
  const a = aggRes.rows[0];

  // Also fetch the actual min (most negative = biggest expense) and max
  // (most positive = biggest income) rows, so the model can name them.
  const minRowRes = await pool.query(
    `SELECT date, amount, description, category, account, notes FROM transactions
       WHERE ${whereSql} ORDER BY amount ASC, created_at DESC LIMIT 1`,
    params
  );
  const maxRowRes = await pool.query(
    `SELECT date, amount, description, category, account, notes FROM transactions
       WHERE ${whereSql} ORDER BY amount DESC, created_at DESC LIMIT 1`,
    params
  );

  return attach({
    count: a.count,
    sum: a.sum == null ? 0 : Math.round(a.sum * 100) / 100,
    avg: a.avg == null ? 0 : Math.round(a.avg * 100) / 100,
    min: a.min == null ? null : Math.round(a.min * 100) / 100,
    max: a.max == null ? null : Math.round(a.max * 100) / 100,
    largestExpense: minRowRes.rows[0] ? rowToLite(minRowRes.rows[0]) : null,
    largestIncome: maxRowRes.rows[0] ? rowToLite(maxRowRes.rows[0]) : null,
  });
}

/* find_recurring — surface likely recurring charges / subscriptions
 * ("what am I paying for every month?"). A recurring charge is a merchant that
 * hits at a REGULAR cadence and is STILL active — distinct from a merchant you
 * simply visit at random (Starbucks, whose gaps are erratic) and from a charge
 * that recurred years ago and stopped (an old loan, a cancelled service).
 *
 * Cadence, not amount, is the recurrence signal. The old detector keyed on
 * amount stability and so (a) missed non-monthly cadences — a bimonthly /
 * semi-monthly mortgage never looked "monthly" — and (b) dropped genuinely
 * recurring bills whose amount legitimately varies (a utility bill that swings
 * with usage). This version detects ANY regular spacing via gap analysis and
 * never uses amount to exclude anything.
 *
 * All discrimination happens in SQL so the model never eyeballs rows:
 *   - consecutive gaps    LAG(date) over each merchant's date-ordered charges
 *                         gives the day-gap between successive charges.
 *   - regular spacing     the MEDIAN gap must fall in a known cadence band
 *                         (~14 biweekly, ~15 semi-monthly, ~30 monthly,
 *                         ~90 quarterly) AND the gaps must be consistent
 *                         (low gap coefficient-of-variation). This is what
 *                         separates a real cadence from random visits.
 *   - recency             last charge within activeWithinMonths of today, so
 *                         "what am I paying for" means CURRENTLY, not in 2017.
 *
 * Amount is used ONLY to SPLIT the survivors (never to exclude):
 *   - fixed     amount coefficient of variation < 5% — flat-price subs.
 *   - variable  amount CV ≥ 5% — clearly-recurring but variable bills, returned
 *               with a min–max range and a note.
 * One tool, one SQL pass; the two lists are split on the way out.
 * estimatedMonthlyCost normalizes the typical charge by its cadence (a
 * semi-monthly charge counts twice a month, a quarterly one a third of a month).
 * Defaults to expenses (sign 'expense'); callers can override.
 */

// Cadence bands keyed by the median day-gap between successive charges. Each
// band has an inclusive [min,max] gap window, a label, and how many times per
// month it lands (used to normalize estimatedMonthlyCost). Bands are chosen not
// to overlap; a merchant's median gap picks exactly one, else it is not a
// recognized cadence and is dropped. Weekly is included so a weekly bill counts.
const CADENCE_BANDS = [
  { label: 'weekly',       min: 5,   max: 10,  perMonth: 52 / 12 },
  { label: 'biweekly',     min: 11,  max: 14,  perMonth: 26 / 12 },
  { label: 'semi-monthly', min: 15,  max: 18,  perMonth: 2 },
  { label: 'monthly',      min: 25,  max: 35,  perMonth: 1 },
  { label: 'bimonthly',    min: 50,  max: 70,  perMonth: 0.5 },
  { label: 'quarterly',    min: 80,  max: 100, perMonth: 1 / 3 },
];

function cadenceForGap(medianGap) {
  if (medianGap == null) return null;
  for (const b of CADENCE_BANDS) {
    if (medianGap >= b.min && medianGap <= b.max) return b;
  }
  return null;
}

async function findRecurring(pool, userId, args = {}) {
  // Default to expenses unless the caller explicitly overrides sign.
  const filters = { ...args };
  if (filters.sign !== 'income') filters.sign = 'expense';
  const { whereSql, params, nextIndex } = buildWhere(userId, filters);

  const minOccurrences = Math.max(2, Math.min(Number(args.minOccurrences) || 3, 60));
  const limit = Math.min(Number(args.limit) || 40, 100);

  // Recency window: the last charge must be within this many months of today
  // for the merchant to count as still-active. Default 3 months. 0 disables the
  // recency gate (for "what did I USED to pay for" style questions). Anchored to
  // args.today when provided (tests pin it) else real server time — same pattern
  // as the system-prompt date anchor, never letting the model guess the year.
  const rawWithin = args.activeWithinMonths;
  const activeWithinMonths = rawWithin === 0 || rawWithin === '0'
    ? 0
    : Math.max(0, Math.min(Number(rawWithin) || 3, 120));
  const today = args.today || new Date().toISOString().slice(0, 10);
  // Compute the cutoff date in JS (not SQL interval math on interpolated N) and
  // pass it as a bound param so nothing numeric reaches SQL as text.
  let recencyClause = '';
  const outerParams = [...params];
  if (activeWithinMonths > 0) {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - activeWithinMonths);
    const cutoff = d.toISOString().slice(0, 10);
    recencyClause = `AND last_date >= $${nextIndex}`;
    outerParams.push(cutoff);
  }

  // Gap regularity tolerance: the coefficient of variation of the day-gaps
  // between successive charges (stddev/mean of the gaps). A truly regular
  // cadence has near-zero gap-CV; random visits have high gap-CV. Default 0.35
  // tolerates a few days of drift (weekends, month-length differences) without
  // waving through erratic spending. This replaces amount CV as the filter —
  // amount NEVER excludes anything now, it only splits fixed vs variable below.
  const gapCvMax = Math.max(0.05, Math.min(Number(args.maxGapVariation) || 0.35, 1.5));

  // Amount CV boundary between the "fixed" and "variable" output lists. Not a
  // filter — every survivor lands in exactly one list. 5% by default: Netflix
  // (flat) is fixed; a usage-driven utility bill is variable.
  const amountCvSplit = Math.max(0.01, Math.min(Number(args.fixedAmountThreshold) || 0.05, 1));

  // Gap analysis. `gaps` gets the day-gap to the previous charge for each row
  // (NULL for a merchant's first charge). `merchant_gaps` aggregates per
  // merchant: occurrence count, first/last date, amount stats (for the SPLIT,
  // not a filter), and gap stats — the MEDIAN gap (cadence band) and the gap
  // mean/stddev (regularity). Median is percentile_cont(0.5) so one freak gap
  // (a skipped month) doesn't distort the cadence read the way a mean would.
  const res = await pool.query(
    `WITH gaps AS (
       SELECT description AS merchant, date, amount,
              (date - LAG(date) OVER (PARTITION BY description ORDER BY date))::int AS gap_days
         FROM transactions
        WHERE ${whereSql} AND description <> ''
     ),
     merchant_gaps AS (
       SELECT merchant,
              COUNT(*)::int AS occurrences,
              MIN(date) AS first_date,
              MAX(date) AS last_date,
              COALESCE(AVG(amount), 0)::float AS avg_amount,
              COALESCE(STDDEV_POP(amount), 0)::float AS std_amount,
              MIN(amount)::float AS min_amount,
              MAX(amount)::float AS max_amount,
              -- percentile_cont ignores NULL gaps (the first charge) natively;
              -- ordered-set aggregates don't take a FILTER clause.
              percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_days)::float AS median_gap,
              COALESCE(AVG(gap_days) FILTER (WHERE gap_days IS NOT NULL), 0)::float AS mean_gap,
              COALESCE(STDDEV_POP(gap_days) FILTER (WHERE gap_days IS NOT NULL), 0)::float AS std_gap
         FROM gaps
        GROUP BY merchant
       HAVING COUNT(*) >= ${minOccurrences}
     )
     SELECT * FROM merchant_gaps
      WHERE median_gap IS NOT NULL
        -- regular spacing: consistent gaps (low gap coefficient of variation).
        -- Amount is NOT used here — a variable-but-regular bill still passes.
        AND ABS(std_gap) <= GREATEST(mean_gap, 1) * ${gapCvMax}
        -- recency: last charge recent enough to still be "what I'm paying for".
        ${recencyClause}
      ORDER BY ABS(avg_amount) * occurrences DESC
      LIMIT ${limit}`,
    outerParams
  );

  const fixed = [];
  const variable = [];
  for (const r of res.rows) {
    const band = cadenceForGap(r.median_gap);
    // A survivor with a regular gap that doesn't map to a known cadence band
    // (e.g. every ~45 days) is not a cadence we name — skip it rather than
    // mislabel. The gap-CV filter already ensured regularity.
    if (!band) continue;

    const typical = Math.round(r.avg_amount * 100) / 100;
    const amountCv = Math.abs(r.avg_amount) > 0
      ? Math.abs(r.std_amount) / Math.abs(r.avg_amount)
      : 0;
    // estimatedMonthlyCost normalizes the typical charge by cadence: a
    // semi-monthly charge costs ~2× its per-charge amount each month, a
    // quarterly one ~1/3. Magnitude, for readability regardless of sign.
    const estimatedMonthlyCost = Math.round(Math.abs(typical) * band.perMonth * 100) / 100;

    const entry = {
      merchant: r.merchant,
      cadence: band.label,
      occurrences: r.occurrences,
      medianGapDays: Math.round(r.median_gap),
      typicalAmount: typical,
      estimatedMonthlyCost,
      firstDate: r.first_date instanceof Date ? r.first_date.toISOString().slice(0, 10) : r.first_date,
      lastDate: r.last_date instanceof Date ? r.last_date.toISOString().slice(0, 10) : r.last_date,
    };

    if (amountCv < amountCvSplit) {
      fixed.push(entry);
    } else {
      // Variable bills carry the observed amount range + a note so the model
      // presents them as "varies" rather than quoting a false single price.
      const min = Math.round(r.min_amount * 100) / 100;
      const max = Math.round(r.max_amount * 100) / 100;
      variable.push({
        ...entry,
        amountRange: { min, max },
        note: `Amount varies (${Math.abs(min)}–${Math.abs(max)}); typicalAmount is the average.`,
      });
    }
  }

  return {
    minOccurrences,
    activeWithinMonths,
    maxGapVariation: gapCvMax,
    fixedAmountThreshold: amountCvSplit,
    fixed,
    variable,
  };
}

// Tool schemas advertised to the model. Provider-neutral (Anthropic tool
// format; adapters translate the shape per provider).
const TOOLS = [
  {
    name: 'query_transactions',
    description:
      'List the user\'s real transactions matching filters. Amounts are signed: ' +
      'expenses negative, income positive. Returns matching rows plus the exact ' +
      'total count and sum over ALL matches. Use sortBy to order (e.g. sortBy ' +
      '"amount" sortDir "asc" surfaces the biggest expenses first). If the ' +
      'result says truncated:true, you did NOT receive every row — say so, and ' +
      'for any largest/smallest/total/average question call get_aggregates ' +
      'instead of reasoning over a partial list.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive lower bound' },
        endDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive upper bound' },
        category: { type: 'string', description: 'Exact category match (single). For several, use categories.' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these categories (OR), e.g. ["Dining","Groceries"].' },
        excludeCategories: { type: 'array', items: { type: 'string' }, description: 'Categories to EXCLUDE, e.g. ["Transfers","Securities Trades"] for "not transfers or trades". Rows with no category are kept.' },
        uncategorized: { type: 'boolean', description: 'When true, only rows with NO category (NULL or empty) — for "what is uncategorized".' },
        account: { type: 'string', description: 'Exact account match (single). For several, use accounts.' },
        accounts: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these accounts (OR).' },
        excludeAccounts: { type: 'array', items: { type: 'string' }, description: 'Accounts to EXCLUDE, e.g. a brokerage account.' },
        descriptionContains: { type: 'string', description: 'Case-insensitive substring of the description/merchant' },
        descriptionExcludes: { type: 'array', items: { type: 'string' }, description: 'Description/merchant substrings to EXCLUDE (case-insensitive). Use to drop e.g. "transfer" or a broker name.' },
        notesContains: { type: 'string', description: 'Case-insensitive substring of the transaction note. Rows without a note never match. Returned rows include notes when present.' },
        minAmount: { type: 'number', description: 'Signed amount lower bound' },
        maxAmount: { type: 'number', description: 'Signed amount upper bound' },
        minAbsAmount: { type: 'number', description: 'Absolute-value lower bound, for "large" transactions of either sign' },
        sign: { type: 'string', enum: ['expense', 'income'], description: 'Restrict to expenses (amount<0) or income (amount>0)' },
        sortBy: { type: 'string', enum: ['date', 'amount', 'absamount'], description: 'Sort column (default date)' },
        sortDir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default desc). For biggest expense use amount asc.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, hard cap 500)' },
        includeSavings: { type: 'boolean', description: 'By default, savings-category transactions (contributions to savings buckets) are EXCLUDED, since they are not spending. Set true ONLY when the user explicitly asks about saving / contributions.' },
      },
    },
  },
  {
    name: 'get_aggregates',
    description:
      'Compute EXACT statistics over ALL matching transactions (no row limit) — ' +
      'use this for any superlative or total: most/least expensive, total spent, ' +
      'average, count. Returns count, sum, avg, min, max, plus the actual ' +
      'largestExpense and largestIncome rows. Set groupBy to "category", ' +
      '"account", or "merchant" for per-group totals (e.g. spending by category). ' +
      'Always prefer this over adding up rows yourself.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive lower bound' },
        endDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive upper bound' },
        category: { type: 'string', description: 'Exact category match (single). For several, use categories.' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these categories (OR).' },
        excludeCategories: { type: 'array', items: { type: 'string' }, description: 'Categories to EXCLUDE, e.g. ["Transfers","Securities Trades"]. Rows with no category are kept.' },
        uncategorized: { type: 'boolean', description: 'When true, only rows with NO category (NULL or empty).' },
        account: { type: 'string', description: 'Exact account match (single). For several, use accounts.' },
        accounts: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these accounts (OR).' },
        excludeAccounts: { type: 'array', items: { type: 'string' }, description: 'Accounts to EXCLUDE.' },
        descriptionContains: { type: 'string', description: 'Case-insensitive merchant/description substring' },
        descriptionExcludes: { type: 'array', items: { type: 'string' }, description: 'Description/merchant substrings to EXCLUDE (case-insensitive).' },
        notesContains: { type: 'string', description: 'Case-insensitive substring of the transaction note. Rows without a note never match.' },
        minAbsAmount: { type: 'number', description: 'Absolute-value lower bound' },
        sign: { type: 'string', enum: ['expense', 'income'], description: 'Restrict to expenses or income' },
        groupBy: { type: 'string', enum: ['category', 'account', 'merchant', 'month', 'week', 'year', 'day'], description: 'Per-group totals instead of one summary. category/account/merchant order by spend; month/week/year/day are TIME buckets ordered chronologically (use these for "spending each month" / trends) and return a "period" label per row.' },
        groupLimit: { type: 'number', description: 'Max groups to return when groupBy is set (dimensions: default 20, cap 100; time: default 60, cap 366)' },
        minCount: { type: 'number', description: 'With a category/account/merchant groupBy, keep only groups with MORE THAN this many transactions and order by frequency — for "merchants I visited more than N times". Ignored for time groupings.' },
        includeSavings: { type: 'boolean', description: 'By default, savings-category transactions are EXCLUDED, since they are not spending. Set true ONLY when the user explicitly asks about saving / contributions.' },
      },
    },
  },
  {
    name: 'find_recurring',
    description:
      'Detect recurring charges / subscriptions ("what am I paying for every ' +
      'month?"). Detects ANY regular cadence via gap analysis — weekly, ' +
      'biweekly, semi-monthly, monthly, bimonthly, quarterly — not just ' +
      'monthly, so a semi-monthly mortgage is caught. Amount is NOT used to ' +
      'exclude anything, so variable-but-regular bills (utilities) are caught ' +
      'too. Returns TWO lists: "fixed" (flat-price, amount barely varies) and ' +
      '"variable" (regular cadence but the amount moves — each carries an ' +
      'amountRange and a note). Every entry has a cadence label, typicalAmount, ' +
      'estimatedMonthlyCost (normalized to the cadence), occurrences, median ' +
      'gap in days, and first/last charge dates. Defaults to expenses and to ' +
      'still-active charges. Use this instead of listing rows and guessing.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive lower bound' },
        endDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive upper bound' },
        account: { type: 'string', description: 'Restrict to one account' },
        accounts: { type: 'array', items: { type: 'string' }, description: 'Restrict to any of these accounts (OR).' },
        excludeCategories: { type: 'array', items: { type: 'string' }, description: 'Categories to EXCLUDE (e.g. Transfers).' },
        sign: { type: 'string', enum: ['expense', 'income'], description: 'Which side to scan; defaults to expense ("paying for").' },
        minOccurrences: { type: 'number', description: 'Minimum times a merchant must appear to be considered recurring (default 3, min 2, cap 60).' },
        activeWithinMonths: { type: 'number', description: 'Only count merchants whose LAST charge is within this many months of today — i.e. still active. Default 3. Pass 0 to include charges that stopped long ago (for "what did I USED to pay for").' },
        maxGapVariation: { type: 'number', description: 'Max coefficient of variation of the day-gaps between charges (how consistent the spacing must be). Default 0.35. Lower is stricter (more regular). This is the recurrence filter — amount is never used to exclude.' },
        fixedAmountThreshold: { type: 'number', description: 'Amount coefficient of variation below which a charge is reported as "fixed" vs "variable". Default 0.05 (5%). Only SPLITS the output lists; never excludes.' },
        includeSavings: { type: 'boolean', description: 'By default, savings-category charges are excluded. Set true ONLY when the user explicitly asks about recurring saving / contributions.' },
        limit: { type: 'number', description: 'Max candidates to return across both lists (default 40, cap 100).' },
      },
    },
  },
];

// Dispatch a tool call by name. Returns the JSON-serializable result the
// model will see as the tool result. `savingsCategories` (from ctx) is folded
// into each tool's filters as a default exclusion — see withSavingsExclusion —
// unless the model passed includeSavings:true on the call.
async function runTool(pool, userId, name, input, savingsCategories = []) {
  const filters = withSavingsExclusion(input || {}, savingsCategories);
  if (name === 'query_transactions') {
    return queryTransactions(pool, userId, filters);
  }
  if (name === 'get_aggregates') {
    return getAggregates(pool, userId, filters);
  }
  if (name === 'find_recurring') {
    return findRecurring(pool, userId, filters);
  }
  return { error: `unknown tool: ${name}` };
}

/* ─────────────────────────── System prompt ───────────────────────────
 * RAG-lite: standing context about the household is assembled from existing
 * state and injected here. No embeddings, no vector store. Row-level data
 * comes from tools, not this prompt.
 *
 * `ctx` is a small object the route builds from budget_state (income shape,
 * FIRE target, goals). It is intentionally compact.
 */
function buildSystemPrompt(ctx = {}) {
  // Stamp the real current date (server-side) so the model resolves relative
  // ranges ("last month", "this year", "past 90 days") against reality instead
  // of guessing a year. Tests may pin it via ctx.today.
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const lines = [
    'You are a financial insights assistant embedded in a personal budgeting app for a dual-income household.',
    `Today's date is ${today}. Resolve any relative date range ("last month", "this year", "past 90 days") against this date and pass explicit startDate/endDate to the tools — never assume the year.`,
    'You help by answering questions about spending and budget, surfacing anomalies or overspending, and coaching toward the household\'s FIRE (financial independence) goals. You may also give general personal-finance guidance when asked.',
    '',
    'Rules:',
    '- Ground every claim about the user\'s money in real data. When a question needs actual numbers, call a tool rather than guessing.',
    '- For ANY superlative or total — most/least expensive, biggest purchase, total spent, average, how many — call get_aggregates. It computes the exact answer over ALL matching transactions. NEVER answer these by listing rows and eyeballing them; a row list can be incomplete.',
    '- Use query_transactions when the user wants to SEE individual transactions. If the result has truncated:true, tell the user you are showing only part of the set (state the true total) and do not imply it is complete.',
    '- Do not add up or rank transactions yourself over a row list; rely on get_aggregates for math and on sortBy for ordering.',
    '- To EXCLUDE things ("not transfers", "excluding securities trades"), pass excludeCategories / excludeAccounts / descriptionExcludes on the SAME tool call — do not filter by hand and do not report an empty result when the tool actually supports the exclusion. If you are unsure which category or account names exist, call get_aggregates with groupBy "category" (or "account") first to see the real names, then filter by those exact names. If a tool result includes a "warnings" field saying an excluded category/account name did not exist, you MUST tell the user the exclusion did not apply and did not silently drop anything — never present such a result as if the exclusion worked.',
    '- For "each month / per week / over time / trend" questions, call get_aggregates with groupBy "month" (or "week"/"year") — it returns one exact row per period in chronological order. Do NOT list transactions and bucket them yourself.',
    '- To match several categories or accounts at once ("Dining or Groceries"), pass categories:[...] or accounts:[...] in ONE call rather than making separate calls and adding the results by hand. For "uncategorized" transactions pass uncategorized:true.',
    '- For "what am I paying for every month", "which subscriptions do I have", or recurring-charge questions, call find_recurring — it detects any regular cadence (weekly through quarterly) via gap analysis, not just monthly, and does NOT drop bills whose amount varies. It returns two lists: "fixed" (flat price) and "variable" (regular but the amount moves, with an amountRange). Each entry names its cadence and an estimatedMonthlyCost normalized to that cadence. It excludes charges that stopped long ago by default. Do NOT list transactions and guess what repeats. For "what did I USED to pay for" pass activeWithinMonths:0.',
    '- For "merchants (or categories/accounts) I used more than N times", call get_aggregates with the matching groupBy and minCount:N — it keeps only groups above that count and orders by frequency. Do NOT list rows and tally by hand.',
    '- Savings contributions are NOT spending: expense, top-merchant, and recurring queries EXCLUDE savings-category transactions by default. When the user explicitly asks about saving or contributions (how much am I saving, my savings by month, recurring transfers into savings), pass includeSavings:true so those rows are counted.',
    '- Amounts are signed: expenses negative, income positive.',
    '- You may PROPOSE budget or category changes as text for the user to apply manually. You cannot and must not claim to have changed anything — you have no write access.',
    '- Be concise and concrete. Prefer specific figures and short actionable takeaways.',
  ];
  if (ctx.contextBlock) {
    lines.push('', 'Household context:', ctx.contextBlock);
  }
  return lines.join('\n');
}

/* ─────────────────────────── Claude adapter ───────────────────────────
 * Translates the neutral { system, messages, tools } shape to the Anthropic
 * Messages API and back. Uses global fetch (Node 18+).
 */

// The neutral message blocks may carry internal bookkeeping fields (prefixed
// with "_", e.g. _toolName used by the Ollama adapter). Anthropic rejects
// unknown fields on content blocks, so strip them before sending.
function stripInternalFields(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m;
    return {
      ...m,
      content: m.content.map(block => {
        const clean = {};
        for (const k of Object.keys(block)) {
          if (!k.startsWith('_')) clean[k] = block[k];
        }
        return clean;
      }),
    };
  });
}

const claudeAdapter = {
  name: 'claude',
  async createMessage({ system, messages, tools }) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': keyFor('claude'),
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: modelFor('claude'),
        max_tokens: 1024,
        system,
        messages: stripInternalFields(messages),
        tools,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`provider error ${res.status}`);
      err.status = res.status;
      err.body = body.slice(0, 500);
      throw err;
    }

    const data = await res.json();
    // Anthropic already returns content blocks in {type:'text'|'tool_use'} shape,
    // so the neutral shape matches 1:1 here. Other adapters will remap.
    return { content: data.content || [], stopReason: data.stop_reason };
  },
};

function getAdapter(provider) {
  switch (provider) {
    case 'ollama':
      return ollamaAdapter;
    case 'claude':
    default:
      return claudeAdapter;
  }
}

/* ─────────────────────────── Ollama adapter ───────────────────────────
 * Talks to a local Ollama server's POST /api/chat (stream:false). Ollama is
 * keyless — it uses INSIGHTS_OLLAMA_URL instead of an API key.
 *
 * The hard part is translation. The tool loop works in the NEUTRAL shape,
 * which mirrors Anthropic:
 *   assistant tool call -> { type:'tool_use', id, name, input }
 *   tool result         -> user turn w/ { type:'tool_result', tool_use_id, content }
 * Ollama's wire format is different:
 *   assistant tool call -> message.tool_calls[].function.{name, arguments(obj)}
 *   tool result         -> { role:'tool', tool_name, content } message
 * There are also no tool-call IDs in Ollama. So this adapter translates the
 * ENTIRE messages array outbound (neutral -> Ollama) and translates the reply
 * inbound (Ollama -> neutral) so the loop stays provider-agnostic.
 */
const OLLAMA_VERSION = '2023-06-01'; // unused; kept for symmetry/no-op

// neutral tools -> Ollama tools ([{type:'function', function:{name,description,parameters}}])
function toolsToOllama(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// neutral messages -> Ollama messages. Neutral content is either a plain
// string (normal turn) or an array of blocks (tool_use / tool_result). We
// flatten each into Ollama's shape.
function messagesToOllama(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      // May contain text blocks and/or tool_use blocks.
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const toolCalls = m.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ function: { name: b.name, arguments: b.input || {} } }));
      const msg = { role: 'assistant', content: text };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    } else {
      // user turn: either normal text (handled above) or tool_result blocks.
      const results = m.content.filter(b => b.type === 'tool_result');
      if (results.length) {
        for (const r of results) {
          out.push({ role: 'tool', tool_name: r._toolName || undefined, content: r.content });
        }
      } else {
        const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        out.push({ role: 'user', content: text });
      }
    }
  }
  return out;
}

// Ollama reply message -> neutral content blocks. Synthesizes tool-call IDs
// (Ollama doesn't provide them) so the neutral loop can pair results to calls.
let _ollamaCallSeq = 0;
function ollamaReplyToNeutral(message) {
  const blocks = [];
  if (message.content && message.content.trim()) {
    blocks.push({ type: 'text', text: message.content });
  }
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const c of calls) {
    const fn = c.function || {};
    // arguments may be an object (typical) or a JSON string; normalize to object.
    let input = fn.arguments;
    if (typeof input === 'string') {
      try { input = JSON.parse(input); } catch { input = {}; }
    }
    blocks.push({
      type: 'tool_use',
      id: `ollama_${++_ollamaCallSeq}`,
      name: fn.name,
      input: input || {},
      _toolName: fn.name, // carried so the tool_result can echo tool_name back
    });
  }
  return blocks;
}

const ollamaAdapter = {
  name: 'ollama',
  async createMessage({ system, messages, tools }) {
    const base = (process.env.INSIGHTS_OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelFor('ollama'),
        stream: false,
        messages: messagesToOllama(system, messages),
        tools: toolsToOllama(tools),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`provider error ${res.status}`);
      err.status = res.status;
      err.body = body.slice(0, 500);
      throw err;
    }

    const data = await res.json();
    const content = ollamaReplyToNeutral(data.message || {});
    // Ollama has no explicit stop reason; infer from whether it asked for tools.
    const stopReason = content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
    return { content, stopReason };
  },
};
void OLLAMA_VERSION;

/* ─────────────────────────── Chat loop ───────────────────────────
 * Runs the tool-use loop: send messages, if the model asks for a tool, run
 * it, append the result, repeat until the model produces a final answer or we
 * hit the round ceiling. Returns { answer, rounds }.
 *
 * `history` is the prior conversation (neutral role/content), `question` is
 * the new user turn. This slice is ephemeral — history is whatever the client
 * sends; nothing is persisted yet.
 */
async function runInsightsChat({ pool, userId, question, history = [], ctx = {}, provider = 'claude', adapter: adapterOverride = null }) {
  // adapterOverride lets tests inject a fake adapter (no network). In
  // production it's null and we select by provider name.
  if (!adapterOverride && !insightsConfigured(provider)) {
    const err = new Error('Insights is not configured on the server (no API key).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const adapter = adapterOverride || getAdapter(provider);
  const system = buildSystemPrompt(ctx);

  // Build the running message list. History is trusted as already-neutral.
  const messages = [
    ...history,
    { role: 'user', content: question },
  ];

  let rounds = 0;
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const reply = await adapter.createMessage({ system, messages, tools: TOOLS });

    // Record the assistant turn verbatim (may contain tool_use blocks).
    messages.push({ role: 'assistant', content: reply.content });

    const toolUses = (reply.content || []).filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) {
      // Final answer. Concatenate text blocks.
      const answer = (reply.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      return { answer, rounds };
    }

    // Run each requested tool and feed results back as a user turn.
    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      try {
        result = await runTool(pool, userId, tu.name, tu.input, ctx.savingsCategories || []);
      } catch (e) {
        logger.error({ event: 'insights.tool.error', tool: tu.name, err: e.message }, 'insights tool failed');
        result = { error: e.message };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
        _toolName: tu.name, // used by the Ollama adapter's role:'tool' echo; ignored by Claude
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // Hit the ceiling without a final text answer.
  return {
    answer: 'I wasn\'t able to finish analyzing that within the allowed number of steps. Try narrowing the question.',
    rounds,
  };
}

// Providers this server knows how to talk to (an adapter exists). Used to
// validate the client's requested provider and to advertise availability.
const KNOWN_PROVIDERS = ['claude', 'ollama'];

function providerStatus() {
  const out = {};
  for (const p of KNOWN_PROVIDERS) out[p] = insightsConfigured(p);
  return out;
}

module.exports = {
  runInsightsChat,
  insightsConfigured,
  providerStatus,
  KNOWN_PROVIDERS,
  buildSystemPrompt,
  queryTransactions,
  getAggregates,
  findRecurring,
  savingsCategoriesFromState,
  withSavingsExclusion,
  TOOLS,
  MODEL: PROVIDER_MODELS.claude, // back-comparable default; per-provider via modelFor
  modelFor,
  // exported for tests:
  _getAdapter: getAdapter,
  _runTool: runTool,
  _messagesToOllama: messagesToOllama,
  _ollamaReplyToNeutral: ollamaReplyToNeutral,
  _stripInternalFields: stripInternalFields,
};
