import test from 'node:test';
import assert from 'node:assert/strict';
import { acceleratorName, nameBeside, fleetNodes, placedBlocks, plannedBlocks, unmetOf, memoryOf, pairsOf, cardGroups, linkSaid } from './fleet-memory.ts';
import { DEMO_NODES, DEMO_PLACEMENTS, DEMO_PLAN, demoLink } from './fleet-memory-demo.ts';
import { layoutMemory, planCells, memoryUnit, memoryTotals, unitSaid, CELLS } from '../../../packages/components/src/memory-layout.ts';

const GIB = 1024 ** 3;
const nodes = fleetNodes(DEMO_NODES);
const now = placedBlocks(DEMO_PLACEMENTS);
const plan = plannedBlocks(DEMO_PLAN, DEMO_PLACEMENTS);
const kept = new Set(plan.filter((b) => b.mark === 'kept').map((b) => b.key));
const node = (id) => nodes.find((n) => n.id === id);
const cellsOf = (cells, key) => cells.filter((c) => c.block === key);

test('a Spark and a Mac a fifth its size are the same grid, each its own cell', () => {
  const flare = memoryOf(node('flare'), now);
  const mac = memoryOf(node('mac'), now);
  assert.equal(layoutMemory(flare).length, CELLS);
  assert.equal(layoutMemory(mac).length, CELLS);
  assert.equal(unitSaid(memoryUnit(flare)), '1.22 GiB');
  assert.equal(unitSaid(memoryUnit(mac)), '0.24 GiB');
  const cells = layoutMemory(flare);
  assert.equal(cells.filter((c) => c.kind === 'reserve').length, 6, 'a sixteenth held back');
  assert.ok(cells.slice(6).every((c) => c.kind === 'free'), 'nothing placed on flare now');
  assert.equal(layoutMemory(mac).filter((c) => c.kind === 'reserve').length, 17, 'the 4 GiB a Mac keeps: a sixth of it');
  assert.equal(node('spark').accelerator, 'NVIDIA GB10');
  assert.equal(node('mac').accelerator, 'Apple M4 Pro');
});

test('a model takes the cells of what it holds, its server\'s own drawn apart', () => {
  const spark3 = layoutMemory(memoryOf(node('spark3'), now));
  assert.equal(spark3.length, CELLS);
  const coder = cellsOf(spark3, 'coder');
  assert.equal(coder.length, 73, '88 of 121.7 GiB');
  assert.equal(coder.filter((c) => c.overhead).length, 2, 'its server\'s 2 GiB');
  assert.equal(cellsOf(spark3, 'tiny').length, 6);
  assert.equal(spark3.filter((c) => c.kind === 'free').length, 0, 'a sliver free rounds to none');
  const t = memoryTotals(memoryOf(node('spark3'), now));
  assert.equal(Math.round(t.used / GIB * 10) / 10, 113.8);
  assert.ok(t.free >= 0 && t.free < GIB, 'spark3 is full now');
  const mini = cellsOf(layoutMemory(memoryOf(node('mac'), now)), 'mini');
  assert.equal(mini.length, 27, 'the same 6.6 GiB is a quarter of a Mac');
});

test('a pair spans two nodes: the same block on both, under one bracket', () => {
  const pairs = pairsOf(plan, demoLink);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].nodes, ['flare', 'spark']);
  assert.equal(linkSaid(pairs[0].link), '23.6 GB/s checked');
  const key = pairs[0].key;
  const flare = planCells(memoryOf(node('flare'), now, kept), memoryOf(node('flare'), plan, kept));
  const spark = planCells(memoryOf(node('spark'), now, kept), memoryOf(node('spark'), plan, kept));
  assert.equal(cellsOf(flare, key).length, cellsOf(spark, key).length, 'two Sparks: the same share');
  assert.equal(cellsOf(flare, key).length, 88);
  assert.deepEqual(cardGroups(nodes, [...pairsOf(now), ...pairs]), [['flare', 'spark'], ['mac'], ['spark3']], 'the pair\'s cards side by side');
});

test('the plan beside now: kept cells stay put, additions are marked, and what a removal frees and nothing takes says so', () => {
  const nowModel = memoryOf(node('spark3'), now, kept);
  const planModel = memoryOf(node('spark3'), plan, kept);
  assert.deepEqual(nowModel.blocks.map((b) => b.key), ['coder', 'tiny', 'granite'], 'now: what the plan keeps first');
  assert.deepEqual(planModel.blocks.map((b) => [b.key, b.mark]), [['coder', 'kept'], ['tiny', 'kept'], ['granite', 'removed'], ['jev-style-2b-decision-v3-spark3', 'added']]);
  const before = layoutMemory(nowModel);
  const after = planCells(nowModel, planModel);
  assert.equal(after.length, CELLS);
  const at = (cells, key) => cells.map((c, i) => (c.block === key ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(at(after, 'coder'), at(before, 'coder'), 'kept: the same cells');
  assert.deepEqual(at(after, 'tiny'), at(before, 'tiny'));
  const jev = at(after, 'jev-style-2b-decision-v3-spark3');
  assert.equal(jev.length, 5);
  assert.ok(jev.every((i) => before[i].block === 'granite'), 'the addition takes cells granite gives back');
  assert.ok(cellsOf(after, 'jev-style-2b-decision-v3-spark3').every((c) => c.mark === 'added'));
  assert.equal(cellsOf(after, 'granite').length, 0, 'removed: nothing held in the plan');
  assert.equal(after.filter((c) => c.was === 'granite').length, 10, 'the rest of granite\'s cells, freed');
  const sparkAfter = planCells(memoryOf(node('spark'), now, kept), memoryOf(node('spark'), plan, kept));
  assert.equal(sparkAfter.filter((c) => c.was === 'oss').length, 0, 'DeepSeek takes all gpt-oss held, and more');
  const mac = memoryOf(node('mac'), now, kept);
  assert.deepEqual(planCells(mac, memoryOf(node('mac'), plan, kept)).map((c) => c.block), layoutMemory(mac).map((c) => c.block), 'the Mac, kept as it is');
});

test('a want left unmet carries the least it would hold of a node', () => {
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

test('an accelerator named by lspci\'s whole line reads as it is sold', () => {
  assert.equal(acceleratorName('03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 48 [Radeon RX 9070/9070 XT/9070 GRE] (rev c0)'), 'AMD Radeon RX 9070');
  assert.equal(acceleratorName('0d:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Granite Ridge [Radeon Graphics] (rev cb)'), 'AMD Radeon Graphics');
  assert.equal(acceleratorName('03:00.0 VGA compatible controller: Intel Corporation DG2 [Arc A770] (rev 08)'), 'Intel Arc A770');
  assert.equal(acceleratorName('03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Device 7551'), 'AMD GPU');
  for (const n of ['NVIDIA GB10', 'Apple M4 Pro', 'AMD Radeon RX 9070', 'NVIDIA GeForce RTX 4090']) assert.equal(acceleratorName(n), n, `${n} as it is`);
  const amd = { ...DEMO_NODES[0], id: 'amd', hardware: { ...DEMO_NODES[0].hardware, accelerators: [{ kind: 'rocm', name: '03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 48 [Radeon RX 9070/9070 XT/9070 GRE] (rev c0)', memory_bytes: 17095983104, unified: false }] } };
  assert.equal(fleetNodes([amd])[0].accelerator, 'AMD Radeon RX 9070');
});

test('a card heads a node by its id and what its name adds, not the id again', () => {
  assert.equal(nameBeside(node('flare')), 'Spark 2');
  assert.equal(nameBeside(node('spark')), 'Spark 1');
  assert.equal(nameBeside({ id: 'lin1', name: 'lin1' }), '');
  assert.equal(nameBeside({ id: 'lin1' }), '');
});
