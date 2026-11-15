import test from 'node:test';
import assert from 'node:assert/strict';
import { apiWrites, harnessKinds, harnessWrites, freshSeatId, loginEntry, nodesOffering, noNodeOffers, priceOf, recipeKinds, runsOnHost, seatIdFor, voiceKeyed } from './add-model.ts';

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

test('the claude harness runs on a claude-cli engine too; any other harness on a harness engine', () => {
  const both = [...nodes, { id: 'gpu', status: 'up', capabilities: { engines: [{ id: 'coding', kind: 'harness' }] } }];
  assert.deepEqual(nodesOffering(both, ...harnessKinds('claude')), [{ node: 'mac', engine: 'claude' }, { node: 'gpu', engine: 'coding' }]);
  assert.deepEqual(nodesOffering(both, ...harnessKinds('codex')), [{ node: 'gpu', engine: 'coding' }]);
});

test('no node offering an engine says what to do', () => {
  assert.match(noNodeOffers('harness'), /^no node offers a harness engine: /);
  assert.match(noNodeOffers('openai-compatible'), /^no node offers openai-compatible: /);
});

test("a login is named as the definition suggests", () => {
  assert.equal(loginEntry({ id: 'claude', name: 'Claude Code', login: { kind: 'env', entry: 'claude-token--{account}' } }, 'work'), 'claude-token--work');
  assert.equal(loginEntry({ id: 'codex', name: 'Codex', login: { kind: 'home', entry: 'codex-{account}' } }, 'work'), 'codex-work');
  assert.equal(loginEntry({ id: 'x', name: 'X', login: { kind: 'env' } }, 'work'), 'x-work');
  assert.equal(loginEntry({ id: 'x', name: 'X', login: { kind: 'env' } }, ''), '');
});

test("a coding CLI's model: a hosted model with no price, and a harness seat under the login", () => {
  const w = harnessWrites({ model: 'codex-default', offer: { node: 'gpu', engine: 'coding' }, account: 'work', harness: 'codex', login: ' codex-work ', cliModel: '' });
  assert.deepEqual(w, {
    model: { id: 'codex-default', owned_by: 'codex', kind: 'hosted', price: null },
    node: 'gpu',
    seat: { id: 'codex-default', engine: 'coding', account: 'work', serves: [{ model: 'codex-default' }], concurrency: 1, enabled: true, config: { harness: 'codex', login: 'codex-work' } },
  });
  const named = harnessWrites({ model: 'claude-opus', offer: { node: 'mac', engine: 'claude' }, account: 'work', harness: 'claude', login: 'claude-token--work', cliModel: 'opus' });
  assert.deepEqual(named.seat.config, { harness: 'claude', login: 'claude-token--work', model: 'opus' }, "the CLI's own name for its model");
});

test("a CLI under voice's own key: its seat names no login, its model the voice model it calls", () => {
  const pi = { id: 'pi', name: 'pi', login: { kind: 'voice' } };
  assert.equal(voiceKeyed(pi), true);
  assert.equal(voiceKeyed({ id: 'vibe', name: 'Vibe', login: { kind: 'env' } }), false);
  assert.equal(loginEntry(pi, 'work'), '', 'no login to suggest');
  const w = harnessWrites({ model: 'pi-qwen3-coder', offer: { node: 'gpu', engine: 'coding' }, account: 'local', harness: 'pi', login: '', cliModel: 'qwen3-coder' });
  assert.deepEqual(w.seat.config, { harness: 'pi', model: 'qwen3-coder' });
});

test('where a recipe runs: a container unless the seat opts in to the host, or the host alone', () => {
  const both = { id: 'codex', name: 'Codex', login: { kind: 'home' }, backends: [{ kind: 'container' }, { kind: 'host' }] };
  const boxed = { id: 'fake', name: 'Fake', login: { kind: 'env' }, image: { base: 'x', install: 'y' } };
  const hostOnly = { id: 'mine', name: 'Mine', login: { kind: 'env' }, backends: [{ kind: 'host' }] };
  assert.deepEqual(recipeKinds(both), ['container', 'host']);
  assert.deepEqual(recipeKinds(boxed), ['container'], 'the older image is a container');
  assert.equal(runsOnHost(both, false), false, 'a container by default');
  assert.equal(runsOnHost(both, true), true, 'the host on the opt-in');
  assert.equal(runsOnHost(boxed, true), false, 'no host backend, no host');
  assert.equal(runsOnHost(hostOnly, false), true, 'a recipe of the host alone');
  const w = harnessWrites({ model: 'codex-host', offer: { node: 'gpu', engine: 'coding' }, account: 'work', harness: 'codex', login: 'codex-work', cliModel: '', host: true });
  assert.deepEqual(w.seat.config, { harness: 'codex', login: 'codex-work', backend: 'host' }, 'the seat opts in');
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
