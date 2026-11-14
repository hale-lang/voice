import test from 'node:test';
import assert from 'node:assert/strict';
import {
  viewOf,
  queryOf,
  viewHref,
  filtered,
  opensConversation,
  fromOf,
  metadataPairs,
  requestsQuery,
  conversationsQuery,
  matchOf,
  mergeFresh,
  appended,
  conversationKey,
  modelSaid,
  statusSaid,
  inputSaid,
  throughput,
  conversationState,
  NO_VIEW,
} from './usage-view.ts';

const q = (s) => new URLSearchParams(s);

test('a view round-trips through the URL query, only what differs from the default written', () => {
  assert.equal(queryOf(NO_VIEW), '');
  assert.deepEqual(viewOf(q('')), NO_VIEW);
  const v = { ...NO_VIEW, tab: 'conversations', project: 'work', key: 'k_ci', model: 'echo-1', account: 'paid', status: 'no_capacity', conversation: 'conv 7', metadata: 'team=search, run=7', since: '3600', failures: true, internal: true };
  assert.deepEqual(viewOf(q(queryOf(v))), v);
  assert.equal(viewHref({ ...NO_VIEW, tab: 'conversations', status: 'failed' }, 'usage', 'c', 'a/b'), '#/usage/c/a%2Fb?status=failed');
  assert.equal(viewHref(NO_VIEW, 'usage'), '#/usage');
});

test('the tab chosen holds on every route, a conversation open or none', () => {
  for (const parts of [['usage'], ['usage', 'resp_1'], ['usage', 'c', 'conv-7']]) {
    for (const tab of ['requests', 'conversations']) {
      const v = { ...NO_VIEW, tab, status: 'failed' };
      const url = viewHref(v, ...parts);
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      assert.deepEqual(viewOf(query, opensConversation(parts)), v, url);
    }
  }
  assert.equal(viewHref({ ...NO_VIEW, tab: 'conversations' }, 'usage', 'c', 'x'), '#/usage/c/x');
  assert.equal(viewHref(NO_VIEW, 'usage', 'c', 'x'), '#/usage/c/x?view=requests');
});

test('a query value no filter takes is dropped, and the tab follows what the route opens', () => {
  const v = viewOf(q('view=board&status=lost&since=12&failures=yes'));
  assert.deepEqual(v, NO_VIEW);
  assert.equal(viewOf(q(''), true).tab, 'conversations');
  assert.equal(viewOf(q('view=requests'), true).tab, 'requests');
});

test('filtered says whether any filter is set, the tab aside', () => {
  assert.equal(filtered({ ...NO_VIEW, tab: 'conversations' }), false);
  assert.equal(filtered({ ...NO_VIEW, status: 'failed' }), true);
  assert.equal(filtered({ ...NO_VIEW, failures: true }), true);
});

test('a range is a cutoff fixed from now', () => {
  assert.equal(fromOf('', 0), '');
  assert.equal(fromOf('3600', Date.parse('2026-11-14T12:00:00Z')), '2026-11-14T11:00:00.000Z');
});

test('the filters as each list takes them', () => {
  const v = { ...NO_VIEW, project: 'work', key: ' k_ci ', status: 'failed', conversation: 'c1', metadata: 'team=search', failures: true, internal: true, account: 'paid' };
  assert.deepEqual(requestsQuery(v, 'T'), { project: 'work', key: 'k_ci', account: 'paid', status: 'failed', conversation: 'c1', metadata: 'team=search', from: 'T', include_internal: true });
  // the conversations take no status, account, conversation or metadata, and their own failures
  assert.deepEqual(conversationsQuery(v, 'T'), { project: 'work', key: 'k_ci', from: 'T', has_failures: true, include_internal: true });
  assert.deepEqual(requestsQuery(NO_VIEW, ''), {});
  assert.deepEqual(conversationsQuery(NO_VIEW, ''), {});
});

test('metadata pairs: one as written, several as an object, a malformed one none', () => {
  assert.equal(metadataPairs('team=search'), 'team=search');
  assert.equal(metadataPairs('team=search, run=7'), '{"team":"search","run":"7"}');
  assert.equal(metadataPairs('team'), null);
  assert.equal(metadataPairs(''), null);
  assert.deepEqual(requestsQuery({ ...NO_VIEW, metadata: 'oops' }, ''), {});
});

test('a run matches the requests as the list filters them, its metadata an object', () => {
  assert.deepEqual(matchOf({ ...NO_VIEW, status: 'cancelled', metadata: 'team=search, run=7' }, 'T'), { status: 'cancelled', from: 'T', metadata: { team: 'search', run: '7' } });
  assert.deepEqual(matchOf({ ...NO_VIEW, metadata: 'oops' }, ''), {});
});

const id = (r) => r.id;

test('a fresh first page goes on top of the rows held, the pages below kept', () => {
  const held = [{ id: 'r3' }, { id: 'r2' }, { id: 'r1' }];
  assert.deepEqual(mergeFresh(held, [{ id: 'r5' }, { id: 'r4' }, { id: 'r3' }], id), { rows: [{ id: 'r5' }, { id: 'r4' }, { id: 'r3' }, { id: 'r2' }, { id: 'r1' }], reset: false });
  // nothing new: the same rows
  assert.deepEqual(mergeFresh(held, [{ id: 'r3' }, { id: 'r2' }], id).rows, held);
});

test('a conversation active again rises to the top with its new totals', () => {
  const held = [{ id: 'a', n: 1 }, { id: 'b', n: 1 }, { id: 'c', n: 1 }];
  assert.deepEqual(mergeFresh(held, [{ id: 'c', n: 2 }, { id: 'a', n: 1 }], id).rows, [{ id: 'c', n: 2 }, { id: 'a', n: 1 }, { id: 'b', n: 1 }]);
});

test('a fresh page that shares nothing with those held is the rows anew', () => {
  assert.deepEqual(mergeFresh([], [{ id: 'r1' }], id), { rows: [{ id: 'r1' }], reset: true });
  assert.deepEqual(mergeFresh([{ id: 'r1' }], [{ id: 'r9' }], id), { rows: [{ id: 'r9' }], reset: true });
  assert.deepEqual(mergeFresh([{ id: 'r1' }], [], id), { rows: [], reset: true });
});

test('a page loaded below adds only what is not held', () => {
  assert.deepEqual(appended([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], id), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test("a conversation's row is its project, its id and its currency", () => {
  assert.notEqual(conversationKey({ project: 'p', conversation: 'c', currency: 'USD' }), conversationKey({ project: 'p', conversation: 'c', currency: 'EUR' }));
  assert.notEqual(conversationKey({ project: 'p', conversation: 'c', currency: 'USD' }), conversationKey({ project: 'q', conversation: 'c', currency: 'USD' }));
});

test('a model as asked, and what served it when that was another', () => {
  assert.equal(modelSaid({ requested_model: 'fast', served: { model: 'qwen3-8b' } }), 'fast → qwen3-8b');
  assert.equal(modelSaid({ requested_model: 'qwen3-8b', served: { model: 'qwen3-8b' } }), 'qwen3-8b');
  assert.equal(modelSaid({ requested_model: 'qwen3-8b', served: null }), 'qwen3-8b');
});

test('a status said on hover: what it means, and a failure points at its seats', () => {
  assert.equal(statusSaid('served'), 'served whole');
  assert.match(statusSaid('no_capacity'), /^no_capacity: waited for a slot.*seat's error$/);
  assert.match(statusSaid('deadline_exceeded'), /deadline/);
});

test('input with what the cache held, an estimate marked', () => {
  assert.equal(inputSaid({ input_tokens: 1200, cached_input_tokens: 1000 }), `${(1200).toLocaleString()} (${(1000).toLocaleString()} cached)`);
  assert.equal(inputSaid({ input_tokens: 12, cached_input_tokens: 0 }), '12');
  assert.equal(inputSaid({ input_tokens: 56000, cached_input_tokens: 0, input_tokens_estimated: true }), `≈${(56000).toLocaleString()}`);
});

test('throughput is output over the time from first output to the end', () => {
  assert.equal(throughput({ output_tokens: 100, timing: { first_output_ms: 1000, engine_ms: 3000 } }), '50.0');
  assert.equal(throughput({ output_tokens: 0, timing: { first_output_ms: 1000, engine_ms: 3000 } }), '–');
  assert.equal(throughput({ output_tokens: 10, timing: {} }), '–');
});

const conv = (over = {}) => ({ conversation: 'c1', last_request: 'r9', requests: 5, failed_requests: 0, last_status: 'served', ...over });

test("a conversation's status: in flight, served, or how many failed and how its latest ended", () => {
  assert.equal(conversationState(conv(), [{ id: 'rx', conversation: 'c1' }]).label, 'in flight');
  assert.equal(conversationState(conv(), [{ id: 'r9' }]).tone, 'active');
  assert.deepEqual(conversationState(conv(), [{ id: 'rx', conversation: 'c2' }]), { label: 'served', tone: 'quiet', title: 'every request served' });
  assert.equal(conversationState(conv({ last_status: 'incomplete' }), []).tone, 'wait');
  const failedLast = conversationState(conv({ failed_requests: 2, last_status: 'no_capacity' }), []);
  assert.equal(failedLast.label, '2 of 5 failed, last no_capacity');
  assert.equal(failedLast.tone, 'fail');
  const recovered = conversationState(conv({ failed_requests: 1 }), []);
  assert.equal(recovered.label, '1 of 5 failed');
  assert.equal(recovered.tone, 'wait');
});
