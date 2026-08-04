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
