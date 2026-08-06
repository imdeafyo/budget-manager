'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { queryTransactions, buildSystemPrompt, _runTool, runInsightsChat, savingsCategoriesFromState, withSavingsExclusion } = require('./insights');

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
    if (/DISTINCT lower\(category\)/.test(sql)) return { rows: [{ v: 'transfers' }] };
    if (/DISTINCT lower\(account\)/.test(sql)) return { rows: [] };
    if (/GROUP BY/.test(sql)) return { rows: [] };
    if (/ORDER BY amount ASC/.test(sql)) return { rows: [] };
    if (/ORDER BY amount DESC/.test(sql)) return { rows: [] };
    return { rows: [{ count: 3, sum: -300, avg: -100, min: -200, max: -20 }] };
  });
  await _runTool(pool, 'default', 'get_aggregates', {
    sign: 'expense', excludeCategories: ['Transfers'],
  });
  // The exclusion WHERE lands on the scalar aggregate call (not the existence
  // probe), so find the call that carries the exclusion clause.
  const aggCall = pool.calls.find(c => /category IS NULL OR category NOT IN/.test(c.sql));
  assert.ok(aggCall, 'an aggregate query with the exclusion clause was issued');
  assert.ok(aggCall.params.includes('Transfers'));
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

test('getAggregates minCount adds a HAVING floor and orders by frequency (gap 7)', async () => {
  let groupedSql = null;
  const pool = fakePool((sql) => {
    groupedSql = sql;
    return { rows: [
      { grp: 'Starbucks', count: 40, sum: -200, avg: -5, min: -8, max: -2 },
      { grp: 'Chipotle', count: 12, sum: -144, avg: -12, min: -20, max: -8 },
    ] };
  });
  const out = await getAggregates(pool, 'default', { groupBy: 'merchant', minCount: 5 });
  assert.match(groupedSql, /HAVING COUNT\(\*\) > 5/);
  assert.match(groupedSql, /ORDER BY COUNT\(\*\) DESC/);
  assert.strictEqual(out.groups[0].group, 'Starbucks');
  assert.strictEqual(out.groups[0].count, 40);
});

test('getAggregates without minCount keeps the spend ordering and no HAVING', async () => {
  let groupedSql = null;
  const pool = fakePool((sql) => {
    groupedSql = sql;
    return { rows: [{ grp: 'Housing', count: 12, sum: -63088, avg: -5257, min: -5257, max: -5257 }] };
  });
  await getAggregates(pool, 'default', { groupBy: 'category' });
  assert.doesNotMatch(groupedSql, /HAVING/);
  assert.match(groupedSql, /ORDER BY SUM\(amount\) ASC/);
});

test('getAggregates minCount coerces to a floored positive int (no injection)', async () => {
  let groupedSql = null;
  const pool = fakePool((sql) => { groupedSql = sql; return { rows: [] }; });
  await getAggregates(pool, 'default', { groupBy: 'merchant', minCount: '5); DROP TABLE transactions;--' });
  // Non-numeric string -> Number(...) is NaN -> no HAVING clause at all.
  assert.doesNotMatch(groupedSql, /DROP TABLE/);
  assert.doesNotMatch(groupedSql, /HAVING/);
});

test('find_recurring detects a cadence via gap analysis and returns fixed list', async () => {
  let recurringSql = null;
  const pool = fakePool((sql) => {
    recurringSql = sql;
    return { rows: [
      { merchant: 'Netflix', occurrences: 12, first_date: '2025-01-05', last_date: '2025-12-05',
        avg_amount: -15.99, std_amount: 0, min_amount: -15.99, max_amount: -15.99,
        median_gap: 30, mean_gap: 30, std_gap: 1 },
    ] };
  });
  const out = await _runTool(pool, 'default', 'find_recurring', { today: '2026-02-01' });
  // Defaults to expenses.
  assert.match(recurringSql, /amount < 0/);
  // Cadence detection is gap analysis, not amount stability.
  assert.match(recurringSql, /LAG\(date\)/);
  assert.match(recurringSql, /percentile_cont\(0\.5\)/); // median gap
  assert.match(recurringSql, /HAVING COUNT\(\*\) >= 3/);
  // The old amount-CV filter is GONE — amount never excludes. std_amount may
  // still be SELECTed (it drives the fixed/variable split in JS), but it must
  // not be COMPARED in a filter (no `std_amount <=/</>=` predicate).
  assert.doesNotMatch(recurringSql, /std_amount\s*(<=|<|>=|>)/);
  // The regularity filter keys on gaps, not amounts.
  assert.match(recurringSql, /std_gap\s*\)?\s*<=|mean_gap/);
  // Flat amount -> "fixed" list, labeled monthly.
  assert.strictEqual(out.variable.length, 0);
  const c = out.fixed[0];
  assert.strictEqual(c.merchant, 'Netflix');
  assert.strictEqual(c.cadence, 'monthly');
  assert.strictEqual(c.typicalAmount, -15.99);
  assert.strictEqual(c.estimatedMonthlyCost, 15.99); // monthly => ×1
  assert.strictEqual(c.occurrences, 12);
  assert.strictEqual(c.firstDate, '2025-01-05');
});

test('find_recurring gap-regularity filter uses gap CV, not amount CV', async () => {
  let recurringSql = null;
  const pool = fakePool((sql) => { recurringSql = sql; return { rows: [] }; });
  // default gap-CV cap 0.35
  await _runTool(pool, 'default', 'find_recurring', { today: '2026-08-05' });
  assert.match(recurringSql, /GREATEST\(mean_gap, 1\) \* 0\.35/);
  // amount is no longer an exclusion filter anywhere in the SQL.
  assert.doesNotMatch(recurringSql, /ABS\(avg_amount\) \* 0\.08/);
  assert.doesNotMatch(recurringSql, /std_amount\s*(<=|<|>=|>)/);
  // overridable
  await _runTool(pool, 'default', 'find_recurring', { maxGapVariation: 0.15, today: '2026-08-05' });
  assert.match(recurringSql, /GREATEST\(mean_gap, 1\) \* 0\.15/);
});

test('find_recurring applies a recency window by default (last charge cutoff)', async () => {
  let recurringSql = null;
  let recurringParams = null;
  const pool = fakePool((sql, params) => { recurringSql = sql; recurringParams = params; return { rows: [] }; });
  await _runTool(pool, 'default', 'find_recurring', { today: '2026-08-05' });
  // Default 3-month window: a last_date >= cutoff clause is added...
  assert.match(recurringSql, /last_date >= \$/);
  // ...and the cutoff param is 3 months before today (2026-05-05), computed
  // server-side, not interpolated into SQL.
  assert.ok(recurringParams.includes('2026-05-05'));
});

test('find_recurring activeWithinMonths:0 disables the recency gate', async () => {
  let recurringSql = null;
  const pool = fakePool((sql) => { recurringSql = sql; return { rows: [] }; });
  const out = await _runTool(pool, 'default', 'find_recurring', { activeWithinMonths: 0, today: '2026-08-05' });
  assert.doesNotMatch(recurringSql, /last_date >= \$/); // no recency clause
  assert.strictEqual(out.activeWithinMonths, 0);
});

test('find_recurring honors minOccurrences (clamped) and income override', async () => {
  let recurringSql = null;
  const pool = fakePool((sql) => { recurringSql = sql; return { rows: [] }; });
  await _runTool(pool, 'default', 'find_recurring', { minOccurrences: 6, sign: 'income', today: '2026-08-05' });
  assert.match(recurringSql, /HAVING COUNT\(\*\) >= 6/);
  assert.match(recurringSql, /amount > 0/); // income override respected
});

test('find_recurring is dispatched and exported', async () => {
  const { findRecurring } = require('./insights');
  assert.strictEqual(typeof findRecurring, 'function');
});

test('getAggregates warns loudly when an excluded account name matches nothing', async () => {
  // The exclusion existence check runs a DISTINCT lower(account) probe; return
  // only real account names, none matching the guessed "Brokerage".
  const pool = fakePool((sql) => {
    if (/DISTINCT lower\(account\)/.test(sql)) {
      return { rows: [{ v: 'joint checking' }, { v: 'house vault' }] };
    }
    if (/DISTINCT lower\(category\)/.test(sql)) return { rows: [] };
    // scalar aggregate + min/max rows
    if (/ORDER BY amount/.test(sql)) return { rows: [] };
    return { rows: [{ count: 5, sum: -100, avg: -20, min: -50, max: -5 }] };
  });
  const out = await getAggregates(pool, 'default', { excludeAccounts: ['Brokerage'], sign: 'expense' });
  assert.ok(Array.isArray(out.warnings) && out.warnings.length === 1);
  assert.match(out.warnings[0], /Brokerage/);
  assert.match(out.warnings[0], /no account by that name exists/);
  assert.match(out.note, /Brokerage/); // folded into note too
});

test('getAggregates does NOT warn when the excluded account exists (case-insensitive)', async () => {
  const pool = fakePool((sql) => {
    if (/DISTINCT lower\(account\)/.test(sql)) return { rows: [{ v: 'brokerage' }] };
    if (/DISTINCT lower\(category\)/.test(sql)) return { rows: [] };
    if (/ORDER BY amount/.test(sql)) return { rows: [] };
    return { rows: [{ count: 0, sum: 0, avg: 0, min: null, max: null }] };
  });
  const out = await getAggregates(pool, 'default', { excludeAccounts: ['Brokerage'] });
  assert.strictEqual(out.warnings, undefined); // 'brokerage' matches 'Brokerage'
});

test('queryTransactions warns when an excluded category matches nothing', async () => {
  const pool = fakePool((sql) => {
    if (/DISTINCT lower\(category\)/.test(sql)) return { rows: [{ v: 'dining' }] };
    if (/DISTINCT lower\(account\)/.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  const out = await queryTransactions(pool, 'default', { excludeCategories: ['Securities Trades'] });
  assert.ok(out.warnings && /Securities Trades/.test(out.warnings[0]));
});

test('buildSystemPrompt steers recurring + count-threshold + unmatched-exclusion', () => {
  const sys = buildSystemPrompt({ today: '2026-08-05' });
  assert.match(sys, /find_recurring/);
  assert.match(sys, /minCount/);
  assert.match(sys, /activeWithinMonths:0/);      // recency steer
  assert.match(sys, /warnings/);                   // relay unmatched-exclusion
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

/* ── Change 2: find_recurring cadence redesign — cases that slipped through ── */

test('find_recurring catches a bimonthly mortgage (non-monthly cadence)', async () => {
  // The old monthly-only detector missed this: median gap ~60 days is not
  // "monthly", but it IS a regular cadence. Flat amount -> fixed, labeled
  // bimonthly, and estimatedMonthlyCost halves the per-charge amount.
  const pool = fakePool(() => ({ rows: [
    { merchant: 'HOME MORTGAGE', occurrences: 8, first_date: '2025-01-01', last_date: '2026-01-01',
      avg_amount: -2200, std_amount: 0, min_amount: -2200, max_amount: -2200,
      median_gap: 60, mean_gap: 60, std_gap: 2 },
  ] }));
  const out = await _runTool(pool, 'default', 'find_recurring', { today: '2026-02-01' });
  assert.strictEqual(out.variable.length, 0);
  const m = out.fixed[0];
  assert.strictEqual(m.merchant, 'HOME MORTGAGE');
  assert.strictEqual(m.cadence, 'bimonthly');
  assert.strictEqual(m.medianGapDays, 60);
  assert.strictEqual(m.typicalAmount, -2200);
  assert.strictEqual(m.estimatedMonthlyCost, 1100); // 2200 × 0.5/month
});

test('find_recurring keeps a variable-but-regular utility bill (amount never excludes)', async () => {
  // The old amount-CV filter dropped this because the amount swings with usage.
  // Now it survives on gap-regularity and lands in the "variable" list with a
  // range + note; typicalAmount is the average.
  const pool = fakePool(() => ({ rows: [
    { merchant: 'CITY POWER', occurrences: 11, first_date: '2025-02-10', last_date: '2026-01-10',
      avg_amount: -140, std_amount: 45, min_amount: -220, max_amount: -80,
      median_gap: 30, mean_gap: 30, std_gap: 2 },
  ] }));
  const out = await _runTool(pool, 'default', 'find_recurring', { today: '2026-02-01' });
  assert.strictEqual(out.fixed.length, 0);
  const u = out.variable[0];
  assert.strictEqual(u.merchant, 'CITY POWER');
  assert.strictEqual(u.cadence, 'monthly');
  assert.strictEqual(u.typicalAmount, -140);
  assert.deepStrictEqual(u.amountRange, { min: -220, max: -80 });
  assert.match(u.note, /varies/i);
});

test('find_recurring drops merchants whose spacing is irregular (high gap CV survives to SQL)', async () => {
  // Regularity is enforced in SQL; here we just confirm the JS cadence gate
  // also rejects a regular-but-unrecognized gap (e.g. every ~45 days).
  const pool = fakePool(() => ({ rows: [
    { merchant: 'ODD VENDOR', occurrences: 6, first_date: '2025-01-01', last_date: '2025-10-01',
      avg_amount: -50, std_amount: 0, min_amount: -50, max_amount: -50,
      median_gap: 45, mean_gap: 45, std_gap: 1 },
  ] }));
  const out = await _runTool(pool, 'default', 'find_recurring', { today: '2025-11-01' });
  assert.strictEqual(out.fixed.length, 0);
  assert.strictEqual(out.variable.length, 0); // 45-day gap maps to no cadence band
});

/* ── Change 1: savings-category exclusion + includeSavings opt-in ── */

test('savingsCategoriesFromState pulls distinct category tags from state.sav', () => {
  const state = { sav: [
    { n: 'House Fund', c: 'Home' },
    { n: 'Washing Machine', c: 'Home' },   // duplicate category
    { n: 'Emergency Fund', c: 'Emergency' },
    { n: 'No Category', c: '' },            // ignored
    { n: 'Bad' },                           // no c -> ignored
  ] };
  assert.deepStrictEqual(savingsCategoriesFromState(state), ['Home', 'Emergency']);
  assert.deepStrictEqual(savingsCategoriesFromState({}), []);
  assert.deepStrictEqual(savingsCategoriesFromState(null), []);
});

test('withSavingsExclusion merges savings cats into excludeCategories by default', () => {
  const out = withSavingsExclusion({ excludeCategories: ['Transfers'] }, ['Home', 'Emergency', 'transfers']);
  // Existing exclusion kept; savings appended; de-duped case-insensitively.
  assert.deepStrictEqual(out.excludeCategories, ['Transfers', 'Home', 'Emergency']);
  // Original input not mutated.
  const original = { foo: 1 };
  const merged = withSavingsExclusion(original, ['Home']);
  assert.notStrictEqual(merged, original);
  assert.deepStrictEqual(merged.excludeCategories, ['Home']);
});

test('withSavingsExclusion is a no-op when includeSavings:true', () => {
  const input = { includeSavings: true, excludeCategories: ['Transfers'] };
  assert.strictEqual(withSavingsExclusion(input, ['Home', 'Emergency']), input); // same ref, untouched
});

test('_runTool excludes savings categories by default and opts in with includeSavings', async () => {
  const savCats = ['Home', 'Emergency'];
  let excludeParams = null;
  const pool = fakePool((sql, params) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    // unmatchedExclusions probe returns the savings cats as existing (no warning)
    if (/DISTINCT lower/.test(sql)) return { rows: [{ v: 'home' }, { v: 'emergency' }] };
    excludeParams = params;
    return { rows: [] };
  });

  // Default: savings categories are excluded (appear as NOT IN params).
  await _runTool(pool, 'default', 'get_aggregates', { sign: 'expense' }, savCats);
  assert.ok(excludeParams.includes('Home'));
  assert.ok(excludeParams.includes('Emergency'));

  // Opt-in: includeSavings:true suppresses the exclusion.
  excludeParams = null;
  await _runTool(pool, 'default', 'get_aggregates', { sign: 'expense', includeSavings: true }, savCats);
  assert.ok(!excludeParams.includes('Home'));
  assert.ok(!excludeParams.includes('Emergency'));
});

test('savings exclusion inherits the unmatched-exclusion warning path', async () => {
  // A savings category that matches no transactions should surface the loud
  // warning, same as any other excludeCategories miss.
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    if (/DISTINCT lower/.test(sql)) return { rows: [{ v: 'dining' }] }; // no "Home"
    return { rows: [] };
  });
  const out = await _runTool(pool, 'default', 'get_aggregates', {}, ['Home']);
  assert.ok(out.warnings && out.warnings.some(w => /Home/.test(w)));
});

test('buildSystemPrompt steers savings exclusion + includeSavings opt-in', () => {
  const sys = buildSystemPrompt({ today: '2026-08-05' });
  assert.match(sys, /Savings contributions are NOT spending/);
  assert.match(sys, /includeSavings:true/);
});
