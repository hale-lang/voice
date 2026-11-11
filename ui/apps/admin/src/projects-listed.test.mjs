import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetiredSystem, listedProjects } from './projects-listed.ts';

const work = { id: 'work', status: 'active', internal: false };
const gone = { id: 'old', status: 'archived', internal: false };
const retired = { id: 'voice-system', status: 'archived', internal: true };
const ids = (ps) => ps.map((p) => p.id);

test("voice's retired system project is internal and archived", () => {
  assert.equal(isRetiredSystem(retired), true);
  assert.equal(isRetiredSystem(gone), false);
  assert.equal(isRetiredSystem(work), false);
  assert.equal(isRetiredSystem({ id: 'x', status: 'active', internal: true }), false);
  assert.equal(isRetiredSystem({ id: 'x', status: 'archived' }), false);
});

test('a list leaves it out, and keeps a caller’s archived project', () => {
  assert.deepEqual(ids(listedProjects([work, gone, retired])), ['work', 'old']);
});

test('an install without it lists the same', () => {
  assert.deepEqual(ids(listedProjects([work, gone])), ['work', 'old']);
});

test('where it is kept, it is listed on asking', () => {
  assert.deepEqual(ids(listedProjects([work, retired], { showRetired: true })), ['work', 'voice-system']);
});

test('a choice already made of it stays', () => {
  assert.deepEqual(ids(listedProjects([work, retired], { keep: 'voice-system' })), ['work', 'voice-system']);
  assert.deepEqual(ids(listedProjects([work, retired], { keep: '' })), ['work']);
  assert.deepEqual(ids(listedProjects([work, retired], { keep: 'work' })), ['work']);
});
