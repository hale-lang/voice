// A project's usage over a window, from the hourly rollup: the window's
// `from` to the hour, the totals summed by project, key and model across
// currencies, the most spent first, and the pace a stream of usage events
// reads them again at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS, DEFAULT_WINDOW, windowOf, windowFrom, totalsBy, breakdown, sumOf, capped, tokensSaid, paceWait, TOTALS_PACE_MS, TOTALS_GROUPS, NO_TOTALS } from './usage-totals.ts';

const row = (group, currency, n) => ({
  group,
  currency,
  requests: n.requests ?? 1,
  failed_requests: n.failed ?? 0,
  input_tokens: n.input ?? 0,
  cached_input_tokens: n.cached ?? 0,
  output_tokens: n.output ?? 0,
  reasoning_tokens: n.reasoning ?? 0,
  price_micros: n.price ?? 0,
});

test('the windows are 24 hours, 7 days and 30 days, 7 days unless chosen', () => {
  assert.deepEqual(WINDOWS.map((w) => w.value), ['24h', '7d', '30d']);
  assert.equal(DEFAULT_WINDOW, '7d');
  assert.equal(windowOf('30d'), '30d');
  assert.equal(windowOf('1y'), '7d');
  assert.equal(windowOf(null), '7d');
});

test("a window's from is the start of an hour, the current hour its last", () => {
  const now = Date.parse('2026-11-14T10:37:12.345Z');
  assert.equal(windowFrom('24h', now), '2026-11-13T11:00:00Z');
  assert.equal(windowFrom('7d', now), '2026-11-07T11:00:00Z');
  assert.equal(windowFrom('30d', now), '2026-10-15T11:00:00Z');
  // the same query until the hour turns
  assert.equal(windowFrom('7d', Date.parse('2026-11-14T10:59:59Z')), windowFrom('7d', now));
  assert.equal(windowFrom('7d', Date.parse('2026-11-14T11:00:00Z')), '2026-11-07T12:00:00Z');
});

test('totals by project sum a row per currency into one, the spend kept per currency', () => {
  const by = totalsBy(
    [
      row({ project: 'work' }, 'USD', { requests: 3, failed: 1, input: 100, cached: 40, output: 20, reasoning: 5, price: 1500 }),
      row({ project: 'work' }, 'EUR', { requests: 1, input: 9, output: 1, price: 90 }),
      row({ project: 'play' }, 'USD', { requests: 2, input: 1, output: 1 }),
    ],
    'project',
  );
  assert.deepEqual(by.get('work'), {
    requests: 4,
    failed: 1,
    input: 109,
    cached: 40,
    output: 21,
    reasoning: 5,
    spend: [
      { currency: 'USD', micros: 1500 },
      { currency: 'EUR', micros: 90 },
    ],
  });
  // nothing spent is no spend, not a zero in some currency
  assert.deepEqual(by.get('play').spend, []);
  assert.equal(by.get('none'), undefined);
});

test("a project's keys and models summed by each, the most spent first", () => {
  const rows = [
    row({ key: 'k_ci', model: 'qwen' }, 'USD', { requests: 5, input: 500, output: 50, price: 100 }),
    row({ key: 'k_ci', model: 'dsv4' }, 'USD', { requests: 1, failed: 1, input: 0, output: 7, price: 900 }),
    row({ key: 'k_dev', model: 'qwen' }, 'USD', { requests: 2, input: 20, output: 2, price: 10 }),
    row({ key: 'k_free', model: 'qwen' }, 'USD', { requests: 1, input: 3000, output: 3 }),
    row({ key: 'k_idle', model: 'qwen' }, 'USD', { requests: 1, input: 1, output: 1 }),
  ];
  const keys = breakdown(rows, 'key');
  assert.deepEqual(keys.map((k) => k.name), ['k_ci', 'k_dev', 'k_free', 'k_idle'], 'by spend, then by tokens when none was spent');
  assert.deepEqual(keys[0].totals, { requests: 6, failed: 1, input: 500, cached: 0, output: 57, reasoning: 0, spend: [{ currency: 'USD', micros: 1000 }] });
  const models = breakdown(rows, 'model');
  assert.deepEqual(models.map((m) => [m.name, m.totals.requests]), [['dsv4', 1], ['qwen', 9]], 'a model by its spend too');
  assert.equal(sumOf(rows).requests, 10, 'and the whole of it');
  assert.equal(sumOf(rows).input, 3521);
  assert.deepEqual(sumOf([]), NO_TOTALS);
});

test('an answer as full as one can be says it may be short', () => {
  assert.equal(TOTALS_GROUPS, 1000);
  const many = (n) => Array.from({ length: n }, (_, i) => row({ key: `k${i}` }, 'USD', {}));
  assert.equal(capped(many(999)), false);
  assert.equal(capped(many(1000)), true);
});

test('token counts are short', () => {
  assert.equal(tokensSaid(950), '950');
  assert.equal(tokensSaid(12_345), '12.3K');
  assert.equal(tokensSaid(4_500_000), '4.5M');
});

test('a stream of usage events reads the totals at most every few seconds', () => {
  assert.equal(TOTALS_PACE_MS, 5000);
  assert.equal(paceWait(0, 1_000_000), 0, 'the first read waits for none');
  assert.equal(paceWait(1_000_000, 1_001_000), 4000, 'one asked for soon after waits out the rest');
  assert.equal(paceWait(1_000_000, 1_009_000), 0, 'and none once the pace has passed');
});
