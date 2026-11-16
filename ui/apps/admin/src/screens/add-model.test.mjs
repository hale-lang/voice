import test from 'node:test';
import assert from 'node:assert/strict';
import { apiWrites, freshSeatId, nodesOffering, noNodeOffers, priceOf, seatIdFor } from './add-model.ts';

const nodes = [
  { id: 'mac', status: 'up', capabilities: { engines: [{ id: 'managed', kind: 'managed' }, { id: 'lab', kind: 'openai-compatible' }] } },
  { id: 'box', status: 'up', capabilities: { engines: [{ id: 'ollama', kind: 'openai-compatible' }] } },
  { id: 'old', status: 'revoked', capabilities: { engines: [{ id: 'ollama', kind: 'openai-compatible' }] } },
  { id: 'new', status: 'pending', capabilities: null },
];

test('the nodes that offer an engine of a kind, each with its engine', () => {
  assert.deepEqual(nodesOffering(nodes, 'openai-compatible'), [{ node: 'mac', engine: 'lab' }, { node: 'box', engine: 'ollama' }]);
  assert.deepEqual(nodesOffering(nodes, 'managed'), [{ node: 'mac', engine: 'managed' }]);
  assert.deepEqual(nodesOffering(nodes, 'static'), []);
});

test('no node offering an engine says what to do', () => {
  assert.match(noNodeOffers(), /^no node offers openai-compatible: /);
});

test('an api model: priced, its endpoint and upstream name on an openai-compatible seat', () => {
  const w = apiWrites({
    model: 'gpt-oss-120b',
    offer: { node: 'box', engine: 'ollama' },
    account: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    keyVault: ' openrouter-key ',
    upstream: 'openai/gpt-oss-120b',
    price: priceOf(0.1, 0.5),
    contextLength: 131072,
  });
  assert.deepEqual(w, {
    model: { id: 'gpt-oss-120b', owned_by: 'openrouter.ai', kind: 'hosted', context_length: 131072, price: { input_per_mtok_micros: 100000, output_per_mtok_micros: 500000, currency: 'USD' } },
    node: 'box',
    seat: { id: 'gpt-oss-120b', engine: 'ollama', account: 'openrouter', serves: [{ model: 'gpt-oss-120b' }], concurrency: 4, enabled: true, config: { base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-120b', api_key_vault: 'openrouter-key' } },
  });
  const keyless = apiWrites({ model: 'm', offer: { node: 'box', engine: 'ollama' }, account: 'a', baseUrl: 'http://127.0.0.1:11434/v1', keyVault: '', upstream: 'qwen3', price: null, contextLength: null });
  assert.deepEqual(keyless.seat.config, { base_url: 'http://127.0.0.1:11434/v1', model: 'qwen3' }, 'an endpoint with no key names none');
  assert.equal(keyless.model.price, null);
  assert.equal('context_length' in keyless.model, false);
});

test('a price needs both halves', () => {
  assert.equal(priceOf(1, null), null);
  assert.equal(priceOf(null, null), null);
});

test('seat ids are slugs, fresh on their node', () => {
  assert.equal(seatIdFor('Claude Opus 4.1'), 'claude-opus-4-1');
  assert.equal(seatIdFor('openai/gpt-oss'), 'openai-gpt-oss');
  assert.equal(seatIdFor('---'), 'seat');
  assert.equal(freshSeatId('claude', new Set(['claude', 'claude-2'])), 'claude-3');
  assert.equal(freshSeatId('claude', new Set()), 'claude');
});
