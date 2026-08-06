'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { queryTransactions, buildSystemPrompt, _runTool, runInsightsChat } = require('./insights');

/* A fake pg pool that records the SQL + params it was asked to run and
   returns canned rows. Lets us assert the query builder without a database. */
function fakePool(responder) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return responder(sql, params, calls.length);
    },
  };
}

test('queryTransactions builds a scoped WHERE and reports truncation', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 120, total: -3456.78 }] };
    return {
      rows: [
        { date: new Date('2025-03-04'), amount: '-52.10', description: 'MARKET', category: 'Groceries', account: 'Checking' },
        { date: '2025-03-02', amount: '-13.00', description: 'COFFEE', category: 'Dining', account: 'Checking' },
      ],
    };
  });

  const out = await queryTransactions(pool, 'default', {
    startDate: '2025-03-01',
    endDate: '2025-03-31',
    category: 'Groceries',
    limit: 2,
  });

  // Count query first, then row query.
  assert.match(pool.calls[0].sql, /COUNT\(\*\)/);
  assert.match(pool.calls[1].sql, /ORDER BY date DESC/);
  // user_id always first param; filters appended in order.
  assert.strictEqual(pool.calls[1].params[0], 'default');
  assert.ok(pool.calls[1].params.includes('2025-03-01'));
  assert.ok(pool.calls[1].params.includes('Groceries'));

  assert.strictEqual(out.totalMatching, 120);
  assert.strictEqual(out.sumOfMatching, -3456.78);
  assert.strictEqual(out.returned, 2);
  assert.strictEqual(out.truncated, true); // 120 total > 2 returned
  assert.strictEqual(out.transactions[0].date, '2025-03-04'); // Date coerced to ISO day
  assert.strictEqual(out.transactions[0].amount, -52.1);      // string amount coerced to number
});

test('queryTransactions caps limit at the hard row cap', async () => {
  let rowLimit = null;
  const pool = fakePool((sql, params) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 5, total: 0 }] };
    rowLimit = params[params.length - 1];
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { limit: 99999 });
  assert.strictEqual(rowLimit, 500); // QUERY_ROW_CAP (raised from 200)
});

test('minAbsAmount uses ABS() so it catches large txns of either sign', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { minAbsAmount: 500 });
  assert.match(pool.calls[0].sql, /ABS\(amount\) >=/);
});

test('excludeCategories emits NOT IN and keeps NULL-category rows', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 5, total: -500 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', {
    sortBy: 'amount', sortDir: 'asc', limit: 5,
    excludeCategories: ['Transfers', 'Securities Trades'],
  });
  const countSql = pool.calls[0].sql;
  // NULL categories are preserved; named categories are dropped.
  assert.match(countSql, /category IS NULL OR category NOT IN/);
  assert.ok(pool.calls[0].params.includes('Transfers'));
  assert.ok(pool.calls[0].params.includes('Securities Trades'));
});

test('descriptionExcludes emits a NOT ILIKE per substring', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', {
    descriptionExcludes: ['transfer', 'vanguard'],
  });
  const sql = pool.calls[0].sql;
  assert.strictEqual((sql.match(/NOT ILIKE/g) || []).length, 2);
  assert.ok(pool.calls[0].params.includes('%transfer%'));
  assert.ok(pool.calls[0].params.includes('%vanguard%'));
});

test('exclusion filters ignore empty/non-string entries without emitting SQL', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', {
    excludeCategories: ['', null, 42],
    descriptionExcludes: ['', undefined],
  });
  const sql = pool.calls[0].sql;
  assert.doesNotMatch(sql, /NOT IN/);
  assert.doesNotMatch(sql, /NOT ILIKE/);
});

test('get_aggregates honors exclusion filters', async () => {
  const pool = fakePool((sql) => {
    if (/GROUP BY/.test(sql)) return { rows: [] };
    if (/ORDER BY amount ASC/.test(sql)) return { rows: [] };
    if (/ORDER BY amount DESC/.test(sql)) return { rows: [] };
    return { rows: [{ count: 3, sum: -300, avg: -100, min: -200, max: -20 }] };
  });
  await _runTool(pool, 'default', 'get_aggregates', {
    sign: 'expense', excludeCategories: ['Transfers'],
  });
  assert.match(pool.calls[0].sql, /category IS NULL OR category NOT IN/);
  assert.ok(pool.calls[0].params.includes('Transfers'));
});

test('categories/accounts emit IN lists (OR match)', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', {
    categories: ['Dining', 'Groceries'],
    accounts: ['Checking'],
  });
  const sql = pool.calls[0].sql;
  assert.match(sql, /category IN \(/);
  assert.match(sql, /account IN \(/);
  assert.ok(pool.calls[0].params.includes('Dining'));
  assert.ok(pool.calls[0].params.includes('Groceries'));
  assert.ok(pool.calls[0].params.includes('Checking'));
});

test('uncategorized flag matches NULL or empty category', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { uncategorized: true });
  assert.match(pool.calls[0].sql, /category IS NULL OR category = ''/);
});

test('excludeAccounts emits NOT IN over account', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { excludeAccounts: ['Brokerage'] });
  assert.match(pool.calls[0].sql, /account NOT IN \(/);
  assert.ok(pool.calls[0].params.includes('Brokerage'));
});

test('notesContains filters on notes and rows return notes when present', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 1, total: -20 }] };
    return { rows: [{ date: '2025-01-05', amount: '-20', description: 'X', category: 'Y', account: 'A', notes: 'reimbursable' }] };
  });
  const out = await queryTransactions(pool, 'default', { notesContains: 'reimburs' });
  assert.match(pool.calls[0].sql, /notes ILIKE/);
  assert.ok(pool.calls[0].params.includes('%reimburs%'));
  assert.strictEqual(out.transactions[0].notes, 'reimbursable');
});

test('rowToLite omits notes when absent/empty', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 1, total: -20 }] };
    return { rows: [{ date: '2025-01-05', amount: '-20', description: 'X', category: 'Y', account: 'A', notes: '' }] };
  });
  const out = await queryTransactions(pool, 'default', {});
  assert.ok(!('notes' in out.transactions[0]));
});

test('get_aggregates groupBy month buckets by date_trunc, ordered chronologically', async () => {
  const pool = fakePool((sql) => {
    assert.match(sql, /date_trunc\('month', date\)/);
    assert.match(sql, /ORDER BY date_trunc\('month', date\) ASC/);
    return { rows: [
      { grp: '2025-01-01', count: 3, sum: -300, avg: -100, min: -200, max: -20 },
      { grp: '2025-02-01', count: 2, sum: -150, avg: -75, min: -100, max: -50 },
    ] };
  });
  const out = await _runTool(pool, 'default', 'get_aggregates', { groupBy: 'month', sign: 'expense' });
  assert.strictEqual(out.groupedBy, 'month');
  assert.strictEqual(out.groups[0].period, '2025-01-01');
  assert.strictEqual(out.groups[1].sum, -150);
});

test('get_aggregates rejects an unknown time grain and falls through to dimension whitelist', async () => {
  // 'decade' is neither a TIME_GROUP nor a GROUP_COLUMN -> scalar path.
  const pool = fakePool((sql) => {
    if (/date_trunc/.test(sql)) throw new Error('should not time-group');
    if (/GROUP BY/.test(sql)) throw new Error('should not dimension-group');
    if (/ORDER BY amount/.test(sql)) return { rows: [] };
    return { rows: [{ count: 0, sum: 0, avg: 0, min: null, max: null }] };
  });
  const out = await _runTool(pool, 'default', 'get_aggregates', { groupBy: 'decade' });
  assert.ok('count' in out); // scalar summary, not grouped
});

test('buildSystemPrompt stamps today and steers relative dates + trends', () => {
  const sys = buildSystemPrompt({ today: '2026-08-05' });
  assert.match(sys, /Today's date is 2026-08-05/);
  assert.match(sys, /groupBy "month"/);
  assert.match(sys, /categories:\[\.\.\.\]/);
});

test('_runTool dispatches query_transactions and rejects unknown tools', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 1, total: -9 }] };
    return { rows: [{ date: '2025-01-01', amount: '-9', description: 'X', category: null, account: 'A' }] };
  });
  const ok = await _runTool(pool, 'default', 'query_transactions', {});
  assert.strictEqual(ok.totalMatching, 1);

  const bad = await _runTool(pool, 'default', 'nope', {});
  assert.match(bad.error, /unknown tool/);
});

test('buildSystemPrompt includes household context and the no-write rule', () => {
  const sys = buildSystemPrompt({ contextBlock: 'Two earners. FIRE enabled.' });
  assert.match(sys, /Two earners\. FIRE enabled\./);
  assert.match(sys, /must not claim to have changed anything/i);
});

test('runInsightsChat runs the tool loop: model asks for a tool, gets the result, then answers', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 3, total: -150 }] };
    return { rows: [{ date: '2025-02-01', amount: '-50', description: 'CAFE', category: 'Dining', account: 'Checking' }] };
  });

  // Fake adapter: first reply asks for a tool, second reply gives the answer.
  let call = 0;
  const fakeAdapter = {
    name: 'fake',
    async createMessage({ system, messages, tools }) {
      call++;
      // The tool schema and system prompt are always passed through.
      assert.ok(tools.some(t => t.name === 'query_transactions'));
      assert.match(system, /financial insights assistant/i);
      if (call === 1) {
        return {
          content: [{ type: 'tool_use', id: 'tu_1', name: 'query_transactions', input: { category: 'Dining' } }],
          stopReason: 'tool_use',
        };
      }
      // Second turn: the loop must have fed the tool result back as a user turn.
      const last = messages[messages.length - 1];
      assert.strictEqual(last.role, 'user');
      assert.strictEqual(last.content[0].type, 'tool_result');
      assert.strictEqual(last.content[0].tool_use_id, 'tu_1');
      const payload = JSON.parse(last.content[0].content);
      assert.strictEqual(payload.totalMatching, 3);
      return { content: [{ type: 'text', text: 'You spent $150 on dining across 3 transactions.' }], stopReason: 'end_turn' };
    },
  };

  const out = await runInsightsChat({
    pool, userId: 'default', question: 'How much on dining?',
    ctx: { contextBlock: 'Two earners.' },
    adapter: fakeAdapter,
  });

  assert.strictEqual(out.rounds, 2);
  assert.match(out.answer, /\$150 on dining/);
});

test('runInsightsChat answers directly when no tool is needed', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  const fakeAdapter = {
    async createMessage() {
      return { content: [{ type: 'text', text: 'Generally, aim to save 20% of income.' }], stopReason: 'end_turn' };
    },
  };
  const out = await runInsightsChat({ pool, userId: 'default', question: 'general advice?', adapter: fakeAdapter });
  assert.strictEqual(out.rounds, 1);
  assert.match(out.answer, /save 20%/);
  assert.strictEqual(pool.calls.length, 0); // no DB touched
});

test('runInsightsChat throws NOT_CONFIGURED for a keyless provider with no injected adapter', async () => {
  // Keys are captured at module load. The test process starts with no
  // INSIGHTS_ANTHROPIC_API_KEY, so the default 'claude' provider is
  // unconfigured. (Setting process.env here would not help — it's already
  // been read.) The injected-adapter tests above cover the configured path.
  const pool = fakePool(() => ({ rows: [] }));
  await assert.rejects(
    () => runInsightsChat({ pool, userId: 'default', question: 'hi' }),
    (e) => e.code === 'NOT_CONFIGURED'
  );
});

test('insightsConfigured is per-provider; ollama is keyless', () => {
  const { insightsConfigured } = require('./insights');
  // No anthropic/openai key in the test env → those are unconfigured...
  assert.strictEqual(insightsConfigured('claude'), false);
  assert.strictEqual(insightsConfigured('openai'), false);
  // ...but ollama needs no key, so it's always considered configured.
  assert.strictEqual(insightsConfigured('ollama'), true);
});

test('modelFor returns a distinct default per provider', () => {
  const { modelFor } = require('./insights');
  assert.match(modelFor('claude'), /^claude-/);
  assert.match(modelFor('openai'), /^gpt-/);
  assert.strictEqual(modelFor('ollama'), 'llama3.1');
  // Unknown provider falls back to the Claude default rather than undefined.
  assert.match(modelFor('nope'), /^claude-/);
});

/* ─────────────────── Ollama adapter translation ─────────────────── */

const {
  _messagesToOllama, _ollamaReplyToNeutral, _stripInternalFields,
  providerStatus, KNOWN_PROVIDERS, TOOLS,
} = require('./insights');

test('messagesToOllama: plain turns pass through with a system message first', () => {
  const out = _messagesToOllama('SYS', [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ]);
  assert.deepStrictEqual(out[0], { role: 'system', content: 'SYS' });
  assert.deepStrictEqual(out[1], { role: 'user', content: 'hello' });
  assert.deepStrictEqual(out[2], { role: 'assistant', content: 'hi there' });
});

test('messagesToOllama: assistant tool_use -> tool_calls; tool_result -> role:tool', () => {
  const neutral = [
    { role: 'user', content: 'How much dining?' },
    { role: 'assistant', content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'ollama_1', name: 'query_transactions', input: { category: 'Dining' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'ollama_1', content: '{"totalMatching":3}', _toolName: 'query_transactions' },
    ] },
  ];
  const out = _messagesToOllama('SYS', neutral);
  // assistant turn carries tool_calls in Ollama shape
  const asst = out.find(m => m.role === 'assistant');
  assert.strictEqual(asst.tool_calls[0].function.name, 'query_transactions');
  assert.deepStrictEqual(asst.tool_calls[0].function.arguments, { category: 'Dining' });
  // tool result becomes a role:'tool' message echoing tool_name
  const toolMsg = out.find(m => m.role === 'tool');
  assert.strictEqual(toolMsg.tool_name, 'query_transactions');
  assert.match(toolMsg.content, /totalMatching/);
});

test('ollamaReplyToNeutral: text + tool_calls -> neutral blocks with synthesized ids', () => {
  const blocks = _ollamaReplyToNeutral({
    content: 'Checking that.',
    tool_calls: [{ function: { name: 'query_transactions', arguments: { category: 'Dining' } } }],
  });
  const text = blocks.find(b => b.type === 'text');
  const call = blocks.find(b => b.type === 'tool_use');
  assert.strictEqual(text.text, 'Checking that.');
  assert.strictEqual(call.name, 'query_transactions');
  assert.deepStrictEqual(call.input, { category: 'Dining' });
  assert.match(call.id, /^ollama_/); // synthesized id
});

test('ollamaReplyToNeutral: string arguments are parsed to an object', () => {
  const blocks = _ollamaReplyToNeutral({
    content: '',
    tool_calls: [{ function: { name: 'query_transactions', arguments: '{"limit":5}' } }],
  });
  const call = blocks.find(b => b.type === 'tool_use');
  assert.deepStrictEqual(call.input, { limit: 5 });
});

test('stripInternalFields removes _-prefixed keys (Anthropic rejects unknown fields)', () => {
  const cleaned = _stripInternalFields([
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'x', content: '{}', _toolName: 'query_transactions' },
    ] },
  ]);
  const block = cleaned[0].content[0];
  assert.strictEqual(block._toolName, undefined);
  assert.strictEqual(block.tool_use_id, 'x'); // real fields kept
});

test('providerStatus reports every known provider; KNOWN_PROVIDERS includes claude+ollama', () => {
  const st = providerStatus();
  for (const p of KNOWN_PROVIDERS) assert.ok(p in st);
  assert.ok(KNOWN_PROVIDERS.includes('claude'));
  assert.ok(KNOWN_PROVIDERS.includes('ollama'));
  assert.strictEqual(st.ollama, true); // keyless → always ready
});

test('full loop through an Ollama-shaped fake adapter grounds the answer in a tool call', async () => {
  const { runInsightsChat } = require('./insights');
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 3, total: -150 }] };
    return { rows: [] };
  });

  // A fake adapter mimicking the Ollama adapter's neutral output: first turn
  // returns a tool_use block (id synthesized), second returns text.
  let call = 0;
  const fakeOllama = {
    name: 'ollama',
    async createMessage({ messages }) {
      call++;
      if (call === 1) {
        return {
          content: [{ type: 'tool_use', id: 'ollama_1', name: 'query_transactions', input: { category: 'Dining' }, _toolName: 'query_transactions' }],
          stopReason: 'tool_use',
        };
      }
      const last = messages[messages.length - 1];
      assert.strictEqual(last.content[0].type, 'tool_result');
      return { content: [{ type: 'text', text: 'Dining totaled $150 over 3 charges.' }], stopReason: 'end_turn' };
    },
  };

  const out = await runInsightsChat({ pool, userId: 'default', question: 'dining?', provider: 'ollama', adapter: fakeOllama });
  assert.strictEqual(out.rounds, 2);
  assert.match(out.answer, /\$150/);
});

/* ─────────────────── sort + aggregates (correctness fixes) ─────────────────── */

const { getAggregates } = require('./insights');

test('queryTransactions sorts by amount asc when asked (biggest expense first)', async () => {
  let orderClause = null;
  const pool = fakePool((sql, params) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 3, total: -100 }] };
    const m = sql.match(/ORDER BY ([^\n]+)/);
    orderClause = m ? m[1].trim() : null;
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { sortBy: 'amount', sortDir: 'asc' });
  assert.match(orderClause, /^amount ASC/);
});

test('queryTransactions rejects an unknown sort column (whitelist -> date)', async () => {
  let orderClause = null;
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 1, total: 0 }] };
    const m = sql.match(/ORDER BY ([^\n]+)/);
    orderClause = m ? m[1].trim() : null;
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { sortBy: 'amount); DROP TABLE transactions;--' });
  assert.match(orderClause, /^date DESC/); // fell back to safe default, no injection
});

test('queryTransactions emits a loud note when the list is truncated', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 5000, total: -1 }] };
    return { rows: [{ date: '2026-01-01', amount: '-1', description: 'X', category: 'A', account: 'B' }] };
  });
  const out = await queryTransactions(pool, 'default', { limit: 1 });
  assert.strictEqual(out.truncated, true);
  assert.match(out.note, /Only 1 of 5000/);
  assert.match(out.note, /get_aggregates/); // steers to the exact-answer tool
});

test('getAggregates returns exact scalars + the actual largest expense/income rows', async () => {
  // Query order: [0] scalar aggregates, [1] min row, [2] max row.
  let call = 0;
  const pool = fakePool(() => {
    call++;
    if (call === 1) return { rows: [{ count: 25011, sum: -120000, avg: -4.8, min: -5257.34, max: 1921.14 }] };
    if (call === 2) return { rows: [{ date: new Date('2026-03-15'), amount: '-5257.34', description: 'ROCKET MORTGAGE', category: 'Housing', account: 'Joint' }] };
    return { rows: [{ date: '2026-06-01', amount: '1921.14', description: 'PAYCHECK', category: 'Income', account: 'Checking' }] };
  });
  const out = await getAggregates(pool, 'default', {});
  assert.strictEqual(out.count, 25011);
  assert.strictEqual(out.min, -5257.34);
  assert.strictEqual(out.largestExpense.description, 'ROCKET MORTGAGE');
  assert.strictEqual(out.largestExpense.amount, -5257.34);
  assert.strictEqual(out.largestIncome.amount, 1921.14);
});

test('getAggregates groups by category and orders by spend', async () => {
  let groupedSql = null;
  const pool = fakePool((sql) => {
    groupedSql = sql;
    return { rows: [
      { grp: 'Housing', count: 12, sum: -63088, avg: -5257, min: -5257, max: -5257 },
      { grp: 'Groceries', count: 200, sum: -8000, avg: -40, min: -120, max: -2 },
    ] };
  });
  const out = await getAggregates(pool, 'default', { groupBy: 'category' });
  assert.strictEqual(out.groupedBy, 'category');
  assert.match(groupedSql, /GROUP BY category/);
  assert.strictEqual(out.groups[0].group, 'Housing');
  assert.strictEqual(out.groups[0].sum, -63088);
});

test('getAggregates groupBy whitelist ignores an unknown dimension (falls to scalar path)', async () => {
  let call = 0;
  const pool = fakePool(() => {
    call++;
    if (call === 1) return { rows: [{ count: 1, sum: -5, avg: -5, min: -5, max: -5 }] };
    return { rows: [{ date: '2026-01-01', amount: '-5', description: 'X', category: 'A', account: 'B' }] };
  });
  const out = await getAggregates(pool, 'default', { groupBy: 'ssn' });
  assert.strictEqual(out.groups, undefined); // not grouped
  assert.strictEqual(out.count, 1);          // scalar path ran
});

test('_runTool dispatches get_aggregates', async () => {
  let call = 0;
  const pool = fakePool(() => {
    call++;
    if (call === 1) return { rows: [{ count: 2, sum: -10, avg: -5, min: -6, max: -4 }] };
    return { rows: [{ date: '2026-01-01', amount: '-6', description: 'X', category: 'A', account: 'B' }] };
  });
  const { _runTool } = require('./insights');
  const out = await _runTool(pool, 'default', 'get_aggregates', {});
  assert.strictEqual(out.count, 2);
});

test('sign filter narrows to expenses', async () => {
  let whereSql = null;
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) { whereSql = sql; return { rows: [{ n: 0, total: 0 }] }; }
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { sign: 'expense' });
  assert.match(whereSql, /amount < 0/);
});
