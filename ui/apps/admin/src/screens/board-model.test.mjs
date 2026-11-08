import test from 'node:test';
import assert from 'node:assert/strict';
import { state, running } from './board-model.ts';

const NOW = 1_800_000_000_000;
const row = (over = {}) => ({
  conversation: 'conv-7',
  turns: 3,
  input: 10,
  output: 20,
  last_at: new Date(NOW - 1000).toISOString(),
  last_request: 'resp_3',
  ...over,
});

test('a finished request is shown as served at once, however recent, with nothing in flight', () => {
  assert.deepEqual(state(row(), { status: 'served' }, []), { label: 'served', tone: 'ok' });
  assert.deepEqual(state(row({ turns: 1 }), { status: 'served' }, []), { label: 'served', tone: 'quiet' });
});

test('a running request of the conversation shows it in flight', () => {
  const flying = [{ id: 'resp_4', conversation: 'conv-7' }];
  assert.deepEqual(state(row(), { status: 'served' }, flying), { label: 'in flight', tone: 'live' });
  // even after its last turn failed: the next is running
  assert.equal(state(row(), { status: 'server_error' }, flying).label, 'in flight');
});

test("another conversation's running request leaves it as its latest turn ended", () => {
  const flying = [{ id: 'resp_9', conversation: 'conv-8' }, { id: 'resp_10', conversation: null }];
  assert.equal(state(row(), { status: 'served' }, flying).label, 'served');
  assert.equal(state(row(), { status: 'rate_limited' }, flying).label, 'refused');
  assert.equal(state(row(), { status: 'cancelled' }, flying).label, 'cancelled');
  assert.equal(state(row(), { status: 'server_error' }, flying).label, 'failed');
});

test('a row of no conversation is in flight only while its latest request is', () => {
  const none = row({ conversation: null });
  assert.equal(running(none, [{ id: 'resp_9', conversation: null }]), false);
  assert.equal(running(none, [{ id: 'resp_3', conversation: null }]), true);
  // a flight told by an api from before flights carried their conversation
  assert.equal(running(row(), [{ id: 'resp_3' }]), true);
});

test('a row whose latest turn is still being read claims no outcome', () => {
  assert.deepEqual(state(row(), undefined, []), { label: '', tone: 'quiet' });
});
