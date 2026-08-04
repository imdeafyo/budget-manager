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

// Provider-neutral env var names. INSIGHTS_API_KEY is the single key the
// server reads; INSIGHTS_MODEL overrides the default model string. Keeping
// the key name provider-neutral means the same wiring works when OpenAI is
// added — the adapter decides how to use it.
const API_KEY = process.env.INSIGHTS_API_KEY || '';
const MODEL = process.env.INSIGHTS_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOOL_ROUNDS = 6; // hard ceiling on tool-use round-trips per question

function insightsConfigured() {
  return API_KEY.length > 0;
}

/* ─────────────────────── Transaction query tool ───────────────────────
 * The one tool in this slice. Runs a parameterized SELECT against the
 * transactions table. Filters map to indexed columns (date, category,
 * account) so it stays fast at scale. Returns a capped list of rows plus a
 * total count so the model knows if it's seeing a truncated set.
 *
 * `pool` is injected so this module has no direct DB dependency and stays
 * unit-testable with a fake pool.
 */

const QUERY_ROW_CAP = 200; // never hand the model more than this many rows at once

async function queryTransactions(pool, userId, filters = {}) {
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
  // amount filters. Transactions store signed amounts; callers can ask by
  // absolute magnitude via minAbsAmount (useful for "large" spend/income).
  if (typeof filters.minAmount === 'number') { where.push(`amount >= $${i++}`); params.push(filters.minAmount); }
  if (typeof filters.maxAmount === 'number') { where.push(`amount <= $${i++}`); params.push(filters.maxAmount); }
  if (typeof filters.minAbsAmount === 'number') { where.push(`ABS(amount) >= $${i++}`); params.push(filters.minAbsAmount); }

  const whereSql = where.join(' AND ');

  // Total count first (so the model knows if the row list is truncated).
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS total
       FROM transactions WHERE ${whereSql}`,
    params
  );
  const totalCount = countRes.rows[0].n;
  const totalAmount = countRes.rows[0].total;

  const limit = Math.min(Number(filters.limit) || 50, QUERY_ROW_CAP);
  const rowsRes = await pool.query(
    `SELECT date, amount, description, category, account
       FROM transactions WHERE ${whereSql}
       ORDER BY date DESC, created_at DESC
       LIMIT $${i}`,
    [...params, limit]
  );

  const rows = rowsRes.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    amount: Number(r.amount),
    description: r.description,
    category: r.category,
    account: r.account,
  }));

  return {
    totalMatching: totalCount,
    sumOfMatching: Math.round(totalAmount * 100) / 100,
    returned: rows.length,
    truncated: totalCount > rows.length,
    transactions: rows,
  };
}

// Tool schema advertised to the model. Provider-neutral (Anthropic tool
// format; the OpenAI adapter will translate this shape when added).
const TOOLS = [
  {
    name: 'query_transactions',
    description:
      'Query the user\'s real transaction history from the database. Use this ' +
      'whenever a question needs actual spending/income data — amounts, dates, ' +
      'merchants, categories. Amounts are signed: expenses are negative, income ' +
      'positive. Returns matching rows (capped) plus the total count and sum so ' +
      'you know if results were truncated. Prefer narrow filters and use the ' +
      'sum/count for totals rather than adding rows yourself.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive lower bound' },
        endDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive upper bound' },
        category: { type: 'string', description: 'Exact category match' },
        account: { type: 'string', description: 'Exact account match' },
        descriptionContains: { type: 'string', description: 'Case-insensitive substring of the description/merchant' },
        minAmount: { type: 'number', description: 'Signed amount lower bound' },
        maxAmount: { type: 'number', description: 'Signed amount upper bound' },
        minAbsAmount: { type: 'number', description: 'Absolute-value lower bound, for "large" transactions of either sign' },
        limit: { type: 'number', description: 'Max rows to return (default 50, hard cap 200)' },
      },
    },
  },
];

// Dispatch a tool call by name. Returns the JSON-serializable result the
// model will see as the tool result.
async function runTool(pool, userId, name, input) {
  if (name === 'query_transactions') {
    return queryTransactions(pool, userId, input || {});
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
  const lines = [
    'You are a financial insights assistant embedded in a personal budgeting app for a dual-income household.',
    'You help by answering questions about spending and budget, surfacing anomalies or overspending, and coaching toward the household\'s FIRE (financial independence) goals. You may also give general personal-finance guidance when asked.',
    '',
    'Rules:',
    '- Ground every claim about the user\'s money in real data. When a question needs actual numbers, call query_transactions rather than guessing.',
    '- Do not do financial arithmetic in your head over lists of transactions; rely on the sum/count the tool returns.',
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
const claudeAdapter = {
  name: 'claude',
  async createMessage({ system, messages, tools }) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages,
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
  // Only Claude in this slice. The switch is the seam OpenAI/Ollama slot into.
  switch (provider) {
    case 'claude':
    default:
      return claudeAdapter;
  }
}

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
  if (!adapterOverride && !insightsConfigured()) {
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
        result = await runTool(pool, userId, tu.name, tu.input);
      } catch (e) {
        logger.error({ event: 'insights.tool.error', tool: tu.name, err: e.message }, 'insights tool failed');
        result = { error: e.message };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
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

module.exports = {
  runInsightsChat,
  insightsConfigured,
  buildSystemPrompt,
  queryTransactions,
  TOOLS,
  MODEL,
  // exported for tests:
  _getAdapter: getAdapter,
  _runTool: runTool,
};
