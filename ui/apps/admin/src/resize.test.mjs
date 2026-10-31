import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN, STEP, BIG_STEP, KEEP, clamp, maxHeight, room, dragged, keyed } from './resize.ts';

const MAX = maxHeight(800);

test('the most is most of the viewport, never under MIN', () => {
  assert.equal(MAX, 576);
  assert.equal(maxHeight(40), MIN);
});

test('the room is what the page can give, keeping some of it in view', () => {
  // a desktop: the page and the body share 747 px; the cap is three quarters of the viewport
  assert.equal(room(800, 148, 599), MAX);
  // a phone, its rail stacked above: the page keeps KEEP px
  assert.equal(room(844, 148, 426), 148 + 426 - KEEP);
  // the same however the room is shared between them
  assert.equal(room(844, 348, 226), room(844, 148, 426));
  assert.equal(room(300, 0, 50), MIN);
});

test('a height is held to MIN..max', () => {
  assert.equal(clamp(10, MAX), MIN);
  assert.equal(clamp(10_000, MAX), MAX);
  assert.equal(clamp(200.4, MAX), 200);
});

test('a drag grows and shrinks the body, folds it below half of MIN, and opens it again', () => {
  const open = { open: true, height: 200 };
  assert.deepEqual(dragged(open, 100, MAX), { open: true, height: 300 });
  assert.deepEqual(dragged(open, 10_000, MAX), { open: true, height: MAX });
  assert.deepEqual(dragged(open, -170, MAX), { open: true, height: MIN });
  // folded, keeping the height it reopens to
  assert.deepEqual(dragged(open, -190, MAX), { open: false, height: 200 });
  // a folded log pulled up opens from its bar
  assert.deepEqual(dragged({ open: false, height: 200 }, 120, MAX), { open: true, height: 120 });
  assert.deepEqual(dragged({ open: false, height: 200 }, 10, MAX), { open: false, height: 200 });
});

test('keys step, fold and open', () => {
  const open = { open: true, height: 200 };
  assert.deepEqual(keyed('ArrowUp', false, open, MAX), { open: true, height: 200 + STEP });
  assert.deepEqual(keyed('ArrowUp', true, open, MAX), { open: true, height: 200 + BIG_STEP });
  assert.deepEqual(keyed('ArrowDown', false, open, MAX), { open: true, height: 200 - STEP });
  assert.deepEqual(keyed('ArrowDown', false, { open: true, height: MIN }, MAX), { open: false, height: MIN });
  assert.deepEqual(keyed('ArrowUp', false, { open: false, height: 200 }, MAX), { open: true, height: 200 });
  assert.deepEqual(keyed('ArrowDown', false, { open: false, height: 200 }, MAX), { open: false, height: 200 });
  assert.deepEqual(keyed('Home', false, open, MAX), { open: false, height: 200 });
  assert.deepEqual(keyed('End', false, open, MAX), { open: true, height: MAX });
  assert.equal(keyed('Enter', false, open, MAX), null);
});
