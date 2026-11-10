import test from 'node:test';
import assert from 'node:assert/strict';
import { apiWrites, claudeWrites, freshSeatId, nodesOffering, noNodeOffers, priceOf, seatIdFor, tokenEntry } from './add-model.ts';

const nodes = [
  { id: 'mac', status: 'up', capabilities: { engines: [{ id: 'managed', kind: 'managed' }, { id: 'claude', kind: 'claude-cli' }] } },
  { id: 'box', status: 'up', capabilities: { engines: [{ id: 'ollama', kind: 'openai-compatible' }] } },
  { id: 'old', status: 'revoked', capabilities: { engines: [{ id: 'claude', kind: 'claude-cli' }] } },
  { id: 'new', status: 'pending', capabilities: null },
];

test('the nodes that offer an engine of a kind, each with its engine', () => {
  assert.deepEqual(nodesOffering(nodes, 'claude-cli'), [{ node: 'mac', engine: 'claude' }]);
  assert.deepEqual(nodesOffering(nodes, 'openai-compatible'), [{ node: 'box', engine: 'ollama' }]);
  assert.deepEqual(nodesOffering(nodes, 'static'), []);
});

test('no node offering an engine says what to do', () => {
  assert.equal(noNodeOffers('claude-cli'), 'no node offers claude-cli: install the claude CLI and place the node again');
  assert.match(noNodeOffers('openai-compatible'), /^no node offers openai-compatible: /);
});

test('the token entry is the one the install keeps', () => {
  assert.equal(tokenEntry('work'), 'claude-token--work');
});

test('a Claude subscription: a hosted model with no price, and a claude-cli seat under the token', () => {
  const w = claudeWrites({ model: 'claude-opus', offer: { node: 'mac', engine: 'claude' }, account: 'work', vault: 'claude-token--work', cliModel: 'opus' });
  assert.deepEqual(w, {
    model: { id: 'claude-opus', owned_by: 'anthropic', kind: 'hosted', price: null },
    node: 'mac',
    seat: { id: 'claude-opus', engine: 'claude', account: 'work', serves: [{ model: 'claude-opus' }], concurrency: 1, enabled: true, config: { token_vault: 'claude-token--work', model: 'opus' } },
  });
  const dflt = claudeWrites({ model: 'claude', offer: { node: 'mac', engine: 'claude' }, account: 'work', vault: 'claude-token--work', cliModel: '' });
  assert.deepEqual(dflt.seat.config, { token_vault: 'claude-token--work' }, "the CLI's default names no model");
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
