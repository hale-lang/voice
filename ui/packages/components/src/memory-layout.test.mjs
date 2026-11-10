import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMemory, planCells, orderForPlan, memoryTotals, memoryUnit, unitSaid, apportion, hueOf, huesFor, HUE_SLOTS, CELLS } from './memory-layout.ts';

const GIB = 1024 ** 3;
const count = (cells, pred) => cells.filter(pred).length;
const of = (cells, key) => cells.map((c, i) => (c.block === key ? i : -1)).filter((i) => i >= 0);
const model = (totalG, budgetG, blocks) => ({ totalBytes: totalG * GIB, budgetBytes: budgetG * GIB, blocks: blocks.map(([key, g, extra]) => ({ key, label: key, bytes: g * GIB, ...extra })) });

test('every machine is a hundred cells, each a hundredth of it, whatever its size', () => {
  assert.equal(CELLS, 100);
  for (const total of [8, 24, 30, 121.7, 512, 2048]) {
    const m = model(total, total - 4, [['a', total / 3]]);
    assert.equal(layoutMemory(m).length, CELLS, `${total} GiB`);
    assert.equal(memoryUnit(m), (total * GIB) / CELLS);
  }
  assert.equal(unitSaid(memoryUnit(model(121.7, 114, []))), '1.22 GiB');
  assert.equal(unitSaid(memoryUnit(model(24, 20, []))), '0.24 GiB');
  assert.equal(unitSaid(memoryUnit(model(2048, 2000, []))), '20.5 GiB');
});

test('the shares are apportioned by the largest remainder, summing to the hundred', () => {
  assert.deepEqual(apportion([33.4, 33.3, 33.3], 100), [34, 33, 33]);
  assert.deepEqual(apportion([10.2, 20.7, 69.1], 100), [10, 21, 69], 'the cell left goes to the largest remainder');
  assert.deepEqual(apportion([0.2, 0.3, 99.5], 100), [1, 1, 98], 'the small ones a cell each, taken back from the largest');
  assert.deepEqual(apportion([0.2, 99.8], 100, [true, false]), [1, 99]);
  assert.deepEqual(apportion([0.4, 99.6], 100, [false, true]), [0, 100], 'what may round to none does');
  // many random machines: always a hundred, never an occupant without a cell
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let t = 0; t < 500; t++) {
    const total = 4 + rnd() * 500;
    const blocks = Array.from({ length: Math.floor(rnd() * 12) }, (_, i) => [`b${i}`, rnd() < 0.3 ? rnd() * 0.05 * total : rnd() * total / 8]);
    const m = model(total, total * (0.6 + rnd() * 0.4), blocks);
    const cells = layoutMemory(m);
    assert.equal(cells.length, CELLS, `machine ${t}`);
    for (const [k] of blocks) assert.ok(of(cells, k).length >= 1, `machine ${t}: ${k} has a cell`);
    assert.ok(count(cells, (c) => c.kind === 'reserve') >= 1);
  }
});

test('the machine holds back first, each block its share, contiguous, then free', () => {
  const m = model(120, 112, [['a', 30.4], ['b', 30.4]]);
  const cells = layoutMemory(m);
  // quotas: reserve 6.67, a 25.33, b 25.33, free 42.67 → 7, 25, 25, 43
  assert.equal(count(cells, (c) => c.kind === 'reserve'), 7);
  assert.deepEqual([of(cells, 'a').length, of(cells, 'b').length], [25, 25]);
  assert.deepEqual(of(cells, 'a'), Array.from({ length: 25 }, (_, i) => 7 + i), 'contiguous after the reserve');
  assert.equal(count(cells, (c) => c.kind === 'free'), 43);
  assert.deepEqual(memoryTotals(m), { total: 120 * GIB, reserve: 8 * GIB, used: 60.8 * GIB, free: 112 * GIB - 60.8 * GIB });
});

test('a small block still takes a cell, on a large machine as on a small one; its overhead is its last cells', () => {
  const big = layoutMemory(model(512, 480, [['tiny', 0.2], ['m', 100]]));
  assert.equal(of(big, 'tiny').length, 1, 'a fifth of a gibibyte on 512 GiB: a cell');
  assert.equal(big.length, CELLS);
  const cells = layoutMemory(model(16, 16, [['tiny', 0.02], ['m', 7.6, { coreBytes: 5.6 * GIB }]]));
  assert.equal(of(cells, 'tiny').length, 1);
  const m = cells.filter((c) => c.block === 'm');
  assert.equal(m.length, 47, '7.6 of 16 GiB: 47.5 cells');
  assert.equal(m.filter((c) => c.overhead).length, 12, 'a quarter of it its overhead');
  assert.ok(m.slice(-12).every((c) => c.overhead), 'last');
});

test('blocks that overfill the machine are drawn to its total and theirs, still a hundred cells, the overflow marked', () => {
  const m = model(10, 8, [['a', 10]]);
  const cells = layoutMemory(m);
  assert.equal(cells.length, CELLS);
  assert.equal(memoryUnit(m), (12 * GIB) / CELLS, 'a hundredth of the 2 held back and the 10 held');
  assert.equal(count(cells, (c) => c.over), 17, '2 GiB past the budget, in cells of 0.12 GiB');
  assert.ok(cells.slice(-17).every((c) => c.over && c.block === 'a'));
  assert.equal(count(cells, (c) => c.kind === 'free'), 0);
  assert.ok(memoryTotals(m).free < 0);
  const barely = layoutMemory(model(100, 100, [['a', 100.001]]));
  assert.equal(count(barely, (c) => c.over), 1, 'over by a sliver: still flagged');
  assert.equal(count(layoutMemory(model(100, 100, [['a', 100]])), (c) => c.over), 0, 'full is not over');
});

test('a plan keeps what it keeps in place, its additions take the freed cells, and what a removal frees and nothing takes says so', () => {
  const kept = new Set(['coder']);
  const nowBlocks = orderForPlan([{ key: 'granite', label: 'g', bytes: 20.3 * GIB }, { key: 'coder', label: 'c', bytes: 40.4 * GIB }], (k) => kept.has(k));
  assert.deepEqual(nowBlocks.map((b) => b.key), ['coder', 'granite'], 'kept first');
  const now = { totalBytes: 100 * GIB, budgetBytes: 96 * GIB, blocks: nowBlocks };
  const plan = {
    totalBytes: 100 * GIB,
    budgetBytes: 96 * GIB,
    blocks: [{ key: 'coder', label: 'c', bytes: 40.4 * GIB, mark: 'kept' }, { key: 'small', label: 's', bytes: 8.6 * GIB, mark: 'added' }, { key: 'granite', label: 'g', bytes: 20.3 * GIB, mark: 'removed' }],
  };
  const before = layoutMemory(now);
  const after = planCells(now, plan);
  assert.equal(after.length, CELLS);
  assert.deepEqual(of(after, 'coder'), of(before, 'coder'), 'kept cells stay put');
  assert.ok(after.filter((c) => c.block === 'coder').every((c) => c.mark === 'kept'));
  assert.deepEqual(of(after, 'small'), Array.from({ length: 9 }, (_, i) => 45 + i), 'the addition takes the first freed cells');
  assert.ok(after.filter((c) => c.block === 'small').every((c) => c.mark === 'added'));
  assert.equal(count(after, (c) => c.was === 'granite'), 11, 'the rest of what granite held is freed, and says so');
  assert.equal(of(after, 'granite').length, 0, 'a removed block holds nothing in the plan');
});

test('a block spanning two machines of different sizes: the same key and hue on each, its share on each card\'s own scale', () => {
  const half = ['ds-pair', 20];
  const spark = layoutMemory(model(121.7, 114, [half]));
  const mac = layoutMemory(model(24, 20, [half]));
  assert.equal(spark.length, mac.length, 'the same grid on both');
  assert.equal(of(spark, 'ds-pair').length, 17, '20 of 121.7 GiB: 16.4 cells, and the largest remainder');
  assert.equal(of(mac, 'ds-pair').length, 83, '20 of 24 GiB');
  assert.equal(memoryUnit(model(121.7, 114, [half])) / memoryUnit(model(24, 20, [half])), 121.7 / 24, 'each card its own cell');
  assert.equal(hueOf('ds-pair'), hueOf('ds-pair'));
  assert.equal(huesFor(['ds-pair', 'x']).get('ds-pair'), huesFor(['x', 'ds-pair']).get('ds-pair'));
  for (const k of ['a', 'b', 'deepseek', 'qwen3-coder-next', 'x'.repeat(40)]) {
    const h = hueOf(k);
    assert.ok(h >= 25 && h < 335, `${k}: ${h} is clear of red`);
  }
});

test('blocks shown together each get a hue apart from the others, the same every time', () => {
  const keys = ['coder', 'tiny', 'granite', 'oss', 'deepseek-v4-1-flash-1017-flare', 'jev-style-2b-decision-v3-spark3'];
  const hues = huesFor(keys);
  assert.equal(new Set(hues.values()).size, keys.length, 'no two alike');
  assert.deepEqual([...huesFor([...keys].reverse())], [...hues], 'whatever order they come in');
  for (const h of hues.values()) assert.ok(HUE_SLOTS.includes(h));
  assert.equal(huesFor(Array.from({ length: 14 }, (_, i) => `m${i}`)).size, 14, 'past the slots, they share');
});

test('the cell each small block is given at the least is no overflow: overflow follows the bytes', () => {
  // a 2 TiB machine, its budget all but full, 61 blocks: the small ones' cells come out of the large one's
  const blocks = [['big', 1780], ...Array.from({ length: 60 }, (_, i) => [`s${i}`, 2.2])];
  const m = model(2048, 1920, blocks);
  assert.ok(memoryTotals(m).free > 0);
  const cells = layoutMemory(m);
  assert.equal(cells.length, CELLS);
  for (let i = 0; i < 60; i++) assert.equal(of(cells, `s${i}`).length, 1);
  assert.equal(cells.filter((c) => c.over).length, 0, 'nothing is over');
  const over = layoutMemory(model(2048, 1920, [...blocks, ['x', 20]]));
  assert.equal(over.length, CELLS);
  assert.equal(over.filter((c) => c.over).length, 1, '12 GiB past the budget, in cells of about 20.6 GiB: one');
});

test('a plan that keeps several fractional shares and removes others is still a hundred cells', () => {
  const kept = ['k1', 'k2', 'k3'];
  const now = model(100, 93, [['k1', 5.4], ['k2', 5.4], ['k3', 5.4], ['r1', 25.6], ['r2', 25.6], ['r3', 25.6]]);
  const before = layoutMemory(now);
  assert.equal(before.length, CELLS);
  const plan = { ...now, blocks: now.blocks.map((b) => ({ ...b, mark: kept.includes(b.key) ? 'kept' : 'removed' })) };
  const after = planCells(now, plan);
  assert.equal(after.length, CELLS, 'the pinned kept cells leave the rest of the hundred to the free');
  for (const k of kept) assert.deepEqual(of(after, k), of(before, k), `${k} stays put`);
  assert.equal(count(after, (c) => c.was), count(before, (c) => c.block?.startsWith('r')), 'every removed cell is freed, and says so');
  // many plans of kept and removed fractional shares: always a hundred
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let t = 0; t < 300; t++) {
    const blocks = Array.from({ length: 2 + Math.floor(rnd() * 8) }, (_, i) => [`b${i}`, 0.3 + rnd() * 12]);
    const m = model(100, 90 + rnd() * 6, blocks);
    const p = { ...m, blocks: [...m.blocks.map((b) => ({ ...b, mark: rnd() < 0.5 ? 'kept' : 'removed' })), { key: 'new', label: 'new', bytes: rnd() * 20 * GIB, mark: 'added' }] };
    assert.equal(planCells(m, p).length, CELLS, `plan ${t}`);
  }
});
