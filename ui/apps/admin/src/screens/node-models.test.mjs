import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeModels, heldSaid } from './node-models.ts';

const seat = (id, serves, status = 'up', engine = 'managed') => ({ id, engine, account: 'local', serves: serves.map((model) => ({ model, as: null })), ref: `spark/${id}`, node: 'spark', status, in_flight: 0, problems: [] });
const placement = (id, model, nodes, recipe, variant) => ({ id, model, nodes, leader: nodes[0], recipe, variant, runtime: 'rt', seat: `${nodes[0]}/${id}`, fit: [], account: 'local', chosen_by: 'coordinator', created_at: '2026-11-07T00:00:00Z' });
const download = (recipe, variant, complete, placed = null) => ({ recipe, variant, bytes: 100, complete, files_held: complete ? 2 : 1, files_total: 2, bytes_held: complete ? 100 : 40, placed });

test('a node leads with what its seats serve, a placement named, then what its disk holds alone', () => {
  const rows = nodeModels(
    'spark',
    [seat('ds', ['deepseek']), seat('claude', ['sonnet'], 'up', 'claude-cli')],
    [placement('ds', 'deepseek', ['flare', 'spark'], 'deepseek-v4.1-flash-1017', 'exl3'), placement('elsewhere', 'tiny', ['spark3'], 'qwen3-0.6b', 'gguf')],
    [download('deepseek-v4.1-flash-1017', 'exl3', true, 'ds'), download('qwen3-coder-next', 'gguf-q8_0', false)],
  );
  assert.deepEqual(rows.map((r) => r.key), ['seat ds', 'seat claude', 'held qwen3-coder-next gguf-q8_0']);
  assert.equal(rows[0].placement?.id, 'ds');
  assert.equal(rows[0].part, 'follower', 'flare leads the pair; spark runs the other half');
  assert.equal(heldSaid(rows[0].download), 'whole');
  assert.equal(rows[1].placement, undefined, 'a seat of another engine is no placement');
  assert.equal(rows[2].seat, undefined);
  assert.equal(heldSaid(rows[2].download), '40%');
});

test('a placement whose seat serves no model by name shows its model', () => {
  const rows = nodeModels('spark', [seat('p', [])], [placement('p', 'qwen', ['spark'], 'r', 'v')], []);
  assert.equal(rows[0].model, 'qwen');
  assert.equal(rows[0].part, undefined);
});
