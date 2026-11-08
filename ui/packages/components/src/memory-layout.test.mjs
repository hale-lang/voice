import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMemory, planCells, orderForPlan, memoryTotals, memoryUnit, hueOf, huesFor, HUE_SLOTS, CELLS_MAX } from './memory-layout.ts';

const GIB = 1024 ** 3;
const count = (cells, pred) => cells.filter(pred).length;
const of = (cells, key) => cells.map((c, i) => (c.block === key ? i : -1)).filter((i) => i >= 0);

test('a cell is a gibibyte, until the largest machine would take more than CELLS_MAX', () => {
  assert.equal(memoryUnit(128e9), GIB);
  assert.equal(memoryUnit(512 * GIB), GIB);
  assert.equal(memoryUnit(513 * GIB), 2 * GIB);
  assert.ok(memoryUnit(4096 * GIB) / GIB * CELLS_MAX >= 4096);
});

test('the machine holds back first, each block its rounded share, contiguous, then free', () => {
  const m = { totalBytes: 120 * GIB, budgetBytes: 112 * GIB, blocks: [{ key: 'a', label: 'a', bytes: 30.4 * GIB }, { key: 'b', label: 'b', bytes: 30.4 * GIB }] };
  const cells = layoutMemory(m, GIB);
  assert.equal(cells.length, 120);
  assert.equal(count(cells, (c) => c.kind === 'reserve'), 8);
  // running ends: 38.4 → 38, 68.8 → 69: no drift, a and b differ by one
  assert.deepEqual([of(cells, 'a').length, of(cells, 'b').length], [30, 31]);
  assert.deepEqual(of(cells, 'a'), Array.from({ length: 30 }, (_, i) => 8 + i), 'contiguous after the reserve');
  assert.equal(count(cells, (c) => c.kind === 'free'), 120 - 8 - 61);
  assert.deepEqual(memoryTotals(m), { total: 120 * GIB, reserve: 8 * GIB, used: 60.8 * GIB, free: 112 * GIB - 60.8 * GIB });
});

test('a small block still takes a cell; its overhead is its last cells', () => {
  const cells = layoutMemory({ totalBytes: 16 * GIB, budgetBytes: 16 * GIB, blocks: [{ key: 'tiny', label: 't', bytes: 0.2 * GIB }, { key: 'm', label: 'm', bytes: 7.6 * GIB, coreBytes: 5.6 * GIB }] }, GIB);
  assert.equal(of(cells, 'tiny').length, 1);
  const m = cells.filter((c) => c.block === 'm');
  assert.equal(m.length, 7);
  assert.deepEqual(m.map((c) => !!c.overhead), [false, false, false, false, false, true, true]);
});

test('blocks that overfill the machine run past it, marked over', () => {
  const cells = layoutMemory({ totalBytes: 10 * GIB, budgetBytes: 8 * GIB, blocks: [{ key: 'a', label: 'a', bytes: 10 * GIB }] }, GIB);
  assert.equal(cells.length, 12);
  assert.equal(count(cells, (c) => c.over), 2);
  assert.ok(memoryTotals({ totalBytes: 10 * GIB, budgetBytes: 8 * GIB, blocks: [{ key: 'a', label: 'a', bytes: 10 * GIB }] }).free < 0);
});

test('a plan keeps what it keeps in place, its additions take the freed cells, and what a removal frees and nothing takes says so', () => {
  const kept = new Set(['coder']);
  const nowBlocks = orderForPlan([{ key: 'granite', label: 'g', bytes: 20 * GIB }, { key: 'coder', label: 'c', bytes: 40 * GIB }], (k) => kept.has(k));
  assert.deepEqual(nowBlocks.map((b) => b.key), ['coder', 'granite'], 'kept first');
  const now = { totalBytes: 100 * GIB, budgetBytes: 100 * GIB, blocks: nowBlocks };
  const plan = {
    totalBytes: 100 * GIB,
    budgetBytes: 100 * GIB,
    blocks: [{ key: 'coder', label: 'c', bytes: 40 * GIB, mark: 'kept' }, { key: 'small', label: 's', bytes: 8 * GIB, mark: 'added' }, { key: 'granite', label: 'g', bytes: 20 * GIB, mark: 'removed' }],
  };
  const before = layoutMemory(now, GIB);
  const after = planCells(now, plan, GIB);
  assert.deepEqual(of(after, 'coder'), of(before, 'coder'), 'kept cells stay put');
  assert.ok(after.filter((c) => c.block === 'coder').every((c) => c.mark === 'kept'));
  assert.deepEqual(of(after, 'small'), Array.from({ length: 8 }, (_, i) => 40 + i), 'the addition takes the first freed cells');
  assert.ok(after.filter((c) => c.block === 'small').every((c) => c.mark === 'added'));
  assert.equal(count(after, (c) => c.was === 'granite'), 12, 'the rest of what granite held is freed, and says so');
  assert.equal(of(after, 'granite').length, 0, 'a removed block holds nothing in the plan');
});

test('a block spanning two machines is the same key, and the same hue, on each', () => {
  const half = { key: 'ds-pair', label: 'deepseek', bytes: 100 * GIB };
  const spark = layoutMemory({ totalBytes: 120 * GIB, budgetBytes: 112 * GIB, blocks: [half] }, GIB);
  const flare = layoutMemory({ totalBytes: 120 * GIB, budgetBytes: 112 * GIB, blocks: [half] }, GIB);
  assert.equal(of(spark, 'ds-pair').length, 100);
  assert.deepEqual(of(spark, 'ds-pair'), of(flare, 'ds-pair'));
  assert.equal(hueOf('ds-pair'), hueOf('ds-pair'));
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
