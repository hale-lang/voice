import test from 'node:test';
import assert from 'node:assert/strict';
import { webFetchOffered } from './tools.ts';

const on = { web_fetch: { enabled: true, max_calls: 8, timeout_ms: 15000, max_bytes: 2097152, max_chars: 40000, denylist: [] } };
const off = { web_fetch: { ...on.web_fetch, enabled: false } };
const tools = { id: 'qwen3-8b', voice: { capabilities: { tools: true } } };
const plain = { id: 'claude-cli', voice: { capabilities: { tools: false } } };

test('the web fetch toggle shows when the tool is on and the model takes tool calls', () => {
  assert.equal(webFetchOffered(on, tools), true);
});

test('and not when the operator turned it off', () => {
  assert.equal(webFetchOffered(off, tools), false);
});

test('nor for a model whose seats carry no tool calls, or that says nothing of them', () => {
  assert.equal(webFetchOffered(on, plain), false);
  assert.equal(webFetchOffered(on, { id: 'm', voice: {} }), false);
  assert.equal(webFetchOffered(on, undefined), false, 'a model not in the project');
});

test('nor while the settings are still being read, or could not be', () => {
  assert.equal(webFetchOffered(undefined, tools), false);
});
