import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetNodes, placedBlocks, plannedBlocks, unmetOf, memoryOf, pairsOf, cardGroups, linkSaid } from './fleet-memory.ts';
import { DEMO_NODES, DEMO_PLACEMENTS, DEMO_PLAN, demoLink } from './fleet-memory-demo.ts';
import { layoutMemory, planCells, memoryUnit, memoryTotals } from '../../../packages/components/src/memory-layout.ts';

const GIB = 1024 ** 3;
const nodes = fleetNodes(DEMO_NODES);
const now = placedBlocks(DEMO_PLACEMENTS);
const plan = plannedBlocks(DEMO_PLAN, DEMO_PLACEMENTS);
const kept = new Set(plan.filter((b) => b.mark === 'kept').map((b) => b.key));
const node = (id) => nodes.find((n) => n.id === id);
const cellsOf = (cells, key) => cells.filter((c) => c.block === key);

test('a Spark is a pleasant grid of gibibyte cells, what its system keeps hatched first', () => {
  const unit = memoryUnit(Math.max(...nodes.map((n) => n.memoryBytes)));
  assert.equal(unit, GIB);
  const cells = layoutMemory(memoryOf(node('flare'), now), unit);
  assert.equal(cells.length, 122, '121.7 GiB, to the nearest cell');
  assert.equal(cells.filter((c) => c.kind === 'reserve').length, 8, 'a sixteenth held back');
  assert.ok(cells.slice(8).every((c) => c.kind === 'free'), 'nothing placed on flare now');
  assert.equal(node('spark').accelerator, 'NVIDIA GB10');
});

test('a model takes the cells of what it holds, its server\'s own drawn apart', () => {
  const spark3 = layoutMemory(memoryOf(node('spark3'), now), GIB);
  const coder = cellsOf(spark3, 'coder');
  assert.equal(coder.length, 88, '86 GiB reserved and 2 GiB its server\'s');
  assert.equal(coder.filter((c) => c.overhead).length, 2);
  assert.equal(cellsOf(spark3, 'tiny').length, 7, '7.6 GiB, from 95.6 to 103.2 GiB: cells 96 to 103');
  const t = memoryTotals(memoryOf(node('spark3'), now));
  assert.equal(Math.round(t.used / GIB * 10) / 10, 113.8);
  assert.ok(t.free >= 0 && t.free < GIB, 'spark3 is full now');
});

test('a pair spans two nodes: the same block, the same cells, on both, under one bracket', () => {
  const pairs = pairsOf(plan, demoLink);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].nodes, ['flare', 'spark']);
  assert.equal(linkSaid(pairs[0].link), '23.6 GB/s checked');
  const key = pairs[0].key;
  const flare = planCells(memoryOf(node('flare'), now, kept), memoryOf(node('flare'), plan, kept), GIB);
  const spark = planCells(memoryOf(node('spark'), now, kept), memoryOf(node('spark'), plan, kept), GIB);
  assert.equal(cellsOf(flare, key).length, cellsOf(spark, key).length);
  assert.ok(cellsOf(flare, key).length > 100);
  assert.deepEqual(cardGroups(nodes, [...pairsOf(now), ...pairs]), [['flare', 'spark'], ['spark3']], 'the pair\'s cards side by side');
});

test('the plan beside now: kept cells stay put, additions are marked, and what a removal frees and nothing takes says so', () => {
  const nowModel = memoryOf(node('spark3'), now, kept);
  const planModel = memoryOf(node('spark3'), plan, kept);
  assert.deepEqual(nowModel.blocks.map((b) => b.key), ['coder', 'tiny', 'granite'], 'now: what the plan keeps first');
  assert.deepEqual(planModel.blocks.map((b) => [b.key, b.mark]), [['coder', 'kept'], ['tiny', 'kept'], ['granite', 'removed'], ['jev-style-2b-decision-v3-spark3', 'added']]);
  const before = layoutMemory(nowModel, GIB);
  const after = planCells(nowModel, planModel, GIB);
  const at = (cells, key) => cells.map((c, i) => (c.block === key ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(at(after, 'coder'), at(before, 'coder'), 'kept: the same cells');
  assert.deepEqual(at(after, 'tiny'), at(before, 'tiny'));
  const jev = at(after, 'jev-style-2b-decision-v3-spark3');
  assert.equal(jev.length, 6);
  assert.ok(jev.every((i) => before[i].block === 'granite'), 'the addition takes cells granite gives back');
  assert.ok(cellsOf(after, 'jev-style-2b-decision-v3-spark3').every((c) => c.mark === 'added'));
  assert.equal(cellsOf(after, 'granite').length, 0, 'removed: nothing held in the plan');
  assert.equal(after.filter((c) => c.was === 'granite').length, 12, 'the rest of granite\'s cells, freed');
  const sparkAfter = planCells(memoryOf(node('spark'), now, kept), memoryOf(node('spark'), plan, kept), GIB);
  assert.equal(sparkAfter.filter((c) => c.was === 'oss').length, 0, 'DeepSeek takes all gpt-oss held, and more');
});

test('a want left unmet carries the least it would hold, in cells', () => {
  const [u] = unmetOf(DEMO_PLAN);
  assert.equal(u.want, 'reasoner');
  assert.equal(Math.round(u.needBytes / GIB), 252);
});

test('a plan names the wants and aliases each block serves', () => {
  const coder = plan.find((b) => b.key === 'coder');
  assert.deepEqual(coder.serves, ['coder']);
  assert.deepEqual(coder.aliases, ['coding']);
  assert.deepEqual(plan.find((b) => b.key === 'jev-style-2b-decision-v3-spark3').aliases, ['decide']);
  assert.equal(plan.find((b) => b.key === 'tiny').variant, 'safetensors-bf16', 'a kept block\'s variant from its placement');
});
