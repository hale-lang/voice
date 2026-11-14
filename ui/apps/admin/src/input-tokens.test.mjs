import test from 'node:test';
import assert from 'node:assert/strict';
import { inputTokens } from './input-tokens.ts';

test("an engine's count is shown as it is, an estimate marked so", () => {
  assert.equal(inputTokens({ input_tokens: 12 }), '12');
  assert.equal(inputTokens({ input_tokens: 12, input_tokens_estimated: false }), '12');
  assert.equal(inputTokens({ input_tokens: 0, input_tokens_estimated: false }), '0');
  assert.equal(inputTokens({ input_tokens: 56000, input_tokens_estimated: true }), `≈${(56000).toLocaleString()} (estimated)`);
});
