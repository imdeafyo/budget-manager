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
  return {
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    amount: Number(r.amount),
    description: r.description,
    category: r.category,
    account: r.account,
  };
}

// Whitelist for the sort column so nothing user/model-supplied reaches SQL.
const SORT_COLUMNS = {
  date: 'date',
  amount: 'amount',
  absamount: 'ABS(amount)',
};

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
    `SELECT date, amount, description, category, account
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

async function getAggregates(pool, userId, args = {}) {
  const { whereSql, params } = buildWhere(userId, args);

  // Grouped path: totals per category/account/merchant, ordered by spend.
  if (args.groupBy && GROUP_COLUMNS[String(args.groupBy).toLowerCase()]) {
    const gcol = GROUP_COLUMNS[String(args.groupBy).toLowerCase()];
    const limit = Math.min(Number(args.groupLimit) || 20, 100);
    const res = await pool.query(
      `SELECT ${gcol} AS grp,
              COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS sum,
              COALESCE(AVG(amount), 0)::float AS avg,
              COALESCE(MIN(amount), 0)::float AS min,
              COALESCE(MAX(amount), 0)::float AS max
         FROM transactions WHERE ${whereSql}
         GROUP BY ${gcol}
         ORDER BY SUM(amount) ASC
         LIMIT ${limit}`,
      params
    );
    return {
      groupedBy: String(args.groupBy).toLowerCase(),
      groups: res.rows.map(r => ({
        group: r.grp,
        count: r.count,
        sum: Math.round(r.sum * 100) / 100,
        avg: Math.round(r.avg * 100) / 100,
        min: Math.round(r.min * 100) / 100,
        max: Math.round(r.max * 100) / 100,
      })),
    };
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
    `SELECT date, amount, description, category, account FROM transactions
       WHERE ${whereSql} ORDER BY amount ASC, created_at DESC LIMIT 1`,
    params
  );
  const maxRowRes = await pool.query(
    `SELECT date, amount, description, category, account FROM transactions
       WHERE ${whereSql} ORDER BY amount DESC, created_at DESC LIMIT 1`,
    params
  );

  return {
    count: a.count,
    sum: a.sum == null ? 0 : Math.round(a.sum * 100) / 100,
    avg: a.avg == null ? 0 : Math.round(a.avg * 100) / 100,
    min: a.min == null ? null : Math.round(a.min * 100) / 100,
    max: a.max == null ? null : Math.round(a.max * 100) / 100,
    largestExpense: minRowRes.rows[0] ? rowToLite(minRowRes.rows[0]) : null,
    largestIncome: maxRowRes.rows[0] ? rowToLite(maxRowRes.rows[0]) : null,
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
        category: { type: 'string', description: 'Exact category match' },
        account: { type: 'string', description: 'Exact account match' },
        descriptionContains: { type: 'string', description: 'Case-insensitive substring of the description/merchant' },
        minAmount: { type: 'number', description: 'Signed amount lower bound' },
        maxAmount: { type: 'number', description: 'Signed amount upper bound' },
        minAbsAmount: { type: 'number', description: 'Absolute-value lower bound, for "large" transactions of either sign' },
        sign: { type: 'string', enum: ['expense', 'income'], description: 'Restrict to expenses (amount<0) or income (amount>0)' },
        sortBy: { type: 'string', enum: ['date', 'amount', 'absamount'], description: 'Sort column (default date)' },
        sortDir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default desc). For biggest expense use amount asc.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, hard cap 500)' },
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
        category: { type: 'string', description: 'Exact category match' },
        account: { type: 'string', description: 'Exact account match' },
        descriptionContains: { type: 'string', description: 'Case-insensitive merchant/description substring' },
        minAbsAmount: { type: 'number', description: 'Absolute-value lower bound' },
        sign: { type: 'string', enum: ['expense', 'income'], description: 'Restrict to expenses or income' },
        groupBy: { type: 'string', enum: ['category', 'account', 'merchant'], description: 'Return per-group totals instead of one overall summary' },
        groupLimit: { type: 'number', description: 'Max groups to return when groupBy is set (default 20, cap 100)' },
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
  if (name === 'get_aggregates') {
    return getAggregates(pool, userId, input || {});
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
    '- Ground every claim about the user\'s money in real data. When a question needs actual numbers, call a tool rather than guessing.',
    '- For ANY superlative or total — most/least expensive, biggest purchase, total spent, average, how many — call get_aggregates. It computes the exact answer over ALL matching transactions. NEVER answer these by listing rows and eyeballing them; a row list can be incomplete.',
    '- Use query_transactions when the user wants to SEE individual transactions. If the result has truncated:true, tell the user you are showing only part of the set (state the true total) and do not imply it is complete.',
    '- Do not add up or rank transactions yourself over a row list; rely on get_aggregates for math and on sortBy for ordering.',
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
        result = await runTool(pool, userId, tu.name, tu.input);
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
