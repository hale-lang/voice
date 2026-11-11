import test from 'node:test';
import assert from 'node:assert/strict';
import { placementState, modelState, NO_SEAT } from './placement-state.ts';

const GiB = 1024 ** 3;
const seat = (ref, status, over = {}) => ({ ref, node: ref.split('/')[0], status, ...over });
const at = (...seats) => (ref) => seats.find((s) => s.ref === ref);
const two = { seat: 'node-a/llm', follower_seat: 'node-e/llm' };

test('a two-node start in progress is starting, and says how far', () => {
  const st = placementState(two, at(seat('node-a/llm', 'starting'), seat('node-e/llm', 'up')));
  assert.deepEqual(st, { state: 'starting', label: 'starting', detail: '1 of 2 seats up · node-a loading the model' });
});

test('a fetch says how much of it is in', () => {
  const st = placementState({ seat: 'node-a/llm' }, at(seat('node-a/llm', 'fetching', { progress: { done_bytes: 42 * GiB, total_bytes: 167 * GiB } })));
  assert.deepEqual(st, { state: 'starting', label: 'starting', detail: 'node-a fetching 42 of 167 GiB' });
  const early = placementState({ seat: 'node-a/llm' }, at(seat('node-a/llm', 'fetching', { progress: { done_bytes: 512 * 1024 ** 2, total_bytes: 167 * GiB } })));
  assert.equal(early.detail, 'node-a fetching 512 MiB of 167 GiB');
  assert.equal(placementState({ seat: 'node-a/llm' }, at(seat('node-a/llm', 'fetching'))).detail, 'node-a fetching');
  assert.equal(placementState({ seat: 'node-a/llm' }, at(seat('node-a/llm', 'pending'))).state, 'starting');
});

test('no time is invented: a start says how far, not for how long', () => {
  const st = placementState(two, at(seat('node-a/llm', 'starting'), seat('node-e/llm', 'starting')));
  assert.doesNotMatch(st.detail, /\d+[smh]\b|ago/);
});

test('nothing coming up: no seat serves this, always with why', () => {
  const offline = placementState(two, at(seat('node-a/llm', 'starting'), seat('node-e/llm', 'offline')));
  assert.deepEqual(offline, { state: 'stopped', label: NO_SEAT, detail: 'node-e is offline' });
  const down = placementState({ seat: 'node-a/llm' }, at(seat('node-a/llm', 'down', { reason: 'exited 137' })));
  assert.deepEqual(down, { state: 'stopped', label: NO_SEAT, detail: 'node-a/llm down: exited 137' });
  const missing = placementState({ seat: 'node-a/llm' }, at());
  assert.equal(missing.detail, 'node-a/llm is not on its node');
});

test('up is up; a leader up with its follower not says so beside it', () => {
  assert.deepEqual(placementState({ seat: 'node-a/llm' }, at(seat('node-a/llm', 'up'))), { state: 'up', label: 'up', detail: '' });
  assert.equal(placementState(two, at(seat('node-a/llm', 'up'), seat('node-e/llm', 'up'))).detail, '2 of 2 seats up');
  assert.equal(placementState(two, at(seat('node-a/llm', 'up'), seat('node-e/llm', 'down'))).detail, 'follower node-e/llm down');
});

test("a model's availability: starting while a placement of it comes up, else why no seat serves it", () => {
  const m = { id: 'big', available: false, seats: ['node-a/llm'] };
  const placements = [{ model: 'big', ...two }];
  assert.equal(modelState(m, placements, at(seat('node-a/llm', 'starting'), seat('node-e/llm', 'up'))).state, 'starting');
  assert.deepEqual(modelState({ id: 'big', available: false, seats: [] }, [], at()), { state: 'stopped', label: NO_SEAT, detail: 'none is assigned: place it on a node' });
  assert.equal(modelState(m, placements, at(seat('node-a/llm', 'down'), seat('node-e/llm', 'up'))).detail, 'node-a/llm down');
  assert.equal(modelState({ ...m, available: true }, placements, at()), null);
  // a seat assigned by hand, still fetching
  const hand = modelState({ id: 'small', available: false, seats: ['node-e/small'] }, [], at(seat('node-e/small', 'fetching')));
  assert.deepEqual(hand, { state: 'starting', label: 'starting', detail: 'node-e fetching' });
});
