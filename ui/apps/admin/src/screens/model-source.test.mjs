import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSource, seatSource } from './model-source.ts';

const KINDS = { managed: 'managed', claude: 'claude-cli', ollama: 'openai-compatible', static: 'static' };
const kindOf = (_node, engine) => KINDS[engine];
const seat = (ref, engine, over = {}) => ({ ref, node: ref.split('/')[0], id: ref.split('/')[1], engine, account: 'work', status: 'up', in_flight: 0, ...over });
const at = (...seats) => (ref) => seats.find((s) => s.ref === ref);

test('each engine kind is its source', () => {
  assert.equal(seatSource(seat('box/a', 'claude'), kindOf), 'subscription');
  assert.equal(seatSource(seat('box/a', 'ollama'), kindOf), 'api');
  assert.equal(seatSource(seat('box/a', 'static'), kindOf), 'static');
  assert.equal(seatSource(seat('box/a', 'managed'), kindOf), 'local');
  assert.equal(seatSource(seat('box/a', 'unknown', { placement: 'p1' }), kindOf), 'local', "a placement's seat is local whatever its engine is called");
  assert.equal(seatSource(seat('box/a', 'unknown'), kindOf), undefined, 'an engine its node has not declared says nothing');
});

test('a subscription model: its account, its node, flat-rate, and its seat to open', () => {
  const m = { id: 'claude-opus', seats: ['mac/claude-opus'] };
  const s = modelSource(m, at(seat('mac/claude-opus', 'claude', { account: 'personal', in_flight: 2 })), kindOf, []);
  assert.deepEqual(s, { sources: ['subscription'], accounts: ['personal'], nodes: ['mac'], inFlight: 2, flatRate: true, target: { kind: 'seat', node: 'mac', seat: 'claude-opus' } });
});

test('an api model is metered, not flat-rate', () => {
  const s = modelSource({ id: 'gpt', seats: ['box/gpt'] }, at(seat('box/gpt', 'ollama')), kindOf, []);
  assert.deepEqual(s.sources, ['api']);
  assert.equal(s.flatRate, false);
});

test('a placed model opens its placement, served on every node it is placed on', () => {
  const placements = [{ id: 'qwen-spark', model: 'qwen', nodes: ['spark', 'ember'], account: 'local' }];
  const s = modelSource({ id: 'qwen', seats: ['spark/qwen-spark'] }, at(seat('spark/qwen-spark', 'managed', { placement: 'qwen-spark', account: 'local' })), kindOf, placements);
  assert.deepEqual(s.sources, ['local']);
  assert.deepEqual(s.nodes, ['spark', 'ember']);
  assert.deepEqual(s.accounts, ['local']);
  assert.deepEqual(s.target, { kind: 'placement', id: 'qwen-spark' });
});

test('placed but with no seat yet, or with a recipe and not placed: local', () => {
  const placements = [{ id: 'p', model: 'qwen', nodes: ['spark'], account: 'local' }];
  assert.deepEqual(modelSource({ id: 'qwen', seats: [] }, at(), kindOf, placements).sources, ['local']);
  const unplaced = modelSource({ id: 'qwen', seats: [], recipe: 'qwen3' }, at(), kindOf, []);
  assert.deepEqual(unplaced.sources, ['local']);
  assert.equal(unplaced.target, null, 'nothing to open');
});

test('a model nothing serves has no source', () => {
  const s = modelSource({ id: 'orphan', seats: [] }, at(), kindOf, []);
  assert.deepEqual(s, { sources: [], accounts: [], nodes: [], inFlight: 0, flatRate: false, target: null });
});

test('several sources are listed in order, each account and node once', () => {
  const s = modelSource(
    { id: 'echo-1', seats: ['mini/steady', 'laptop/claude', 'laptop/static'] },
    at(seat('mini/steady', 'static'), seat('laptop/claude', 'claude', { account: 'personal' }), seat('laptop/static', 'static')),
    kindOf,
    [],
  );
  assert.deepEqual(s.sources, ['subscription', 'static']);
  assert.deepEqual(s.accounts, ['work', 'personal']);
  assert.deepEqual(s.nodes, ['mini', 'laptop']);
  assert.equal(s.flatRate, false, 'flat-rate only when a subscription alone serves it');
});
