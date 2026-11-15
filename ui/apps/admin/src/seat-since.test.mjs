// How long a seat has been in its state, from the `since` its node's
// reports stamp, as a seat's state shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lasted, withLasted, sinceExact } from './seat-since.ts';

const now = Date.parse('2026-11-15T12:00:00Z');
const before = (s) => new Date(now - s * 1000).toISOString();

test('how long, coarser as it grows', () => {
  assert.equal(lasted(before(42), now), '42 s');
  assert.equal(lasted(before(12 * 60 + 30), now), '12 m');
  assert.equal(lasted(before(72 * 60), now), '1 h 12 m');
  assert.equal(lasted(before(3 * 3600), now), '3 h');
  assert.equal(lasted(before((3 * 24 + 4) * 3600 + 59), now), '3 d 4 h');
  assert.equal(lasted(before(2 * 86400), now), '2 d');
});

test('none without a since, and never negative', () => {
  assert.equal(lasted(null, now), null);
  assert.equal(lasted(undefined, now), null);
  assert.equal(lasted('not a time', now), null);
  assert.equal(lasted(new Date(now + 5000).toISOString(), now), '0 s');
});

test('a state with how long it has held, and the exact time for a hover', () => {
  assert.equal(withLasted('starting', before(72 * 60), now), 'starting · 1 h 12 m');
  assert.equal(withLasted('pending', null, now), 'pending');
  assert.match(sinceExact(before(60)) ?? '', /^since /);
  assert.equal(sinceExact(null), undefined);
});
