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
  assert.strictEqual(rowLimit, 200); // QUERY_ROW_CAP
});

test('minAbsAmount uses ABS() so it catches large txns of either sign', async () => {
  const pool = fakePool((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0, total: 0 }] };
    return { rows: [] };
  });
  await queryTransactions(pool, 'default', { minAbsAmount: 500 });
  assert.match(pool.calls[0].sql, /ABS\(amount\) >=/);
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
