import test from 'node:test';
import assert from 'node:assert/strict';
import { changeReads, fleetMoved, ARRANGEMENTS } from './fleet-reads.ts';

const node = (over = {}) => ({ id: 'spark3', status: 'up', seats: [{ id: 'a' }], in_flight: 0, last_heartbeat_at: '2026-11-08T00:00:00Z', ...over });

test('a placement or a node changed reads the saved arrangements again; others do not', () => {
  assert.deepEqual(changeReads('placements/qwen-spark3'), ['/admin/v1/placements', ARRANGEMENTS]);
  assert.ok(changeReads('nodes/spark3').includes(ARRANGEMENTS));
  assert.ok(!changeReads('projects/work/budget').includes(ARRANGEMENTS));
  assert.ok(changeReads('recipes/x').includes('/admin/v1/nodes/{node}/downloads'));
  assert.deepEqual(changeReads(''), []);
});

test('a node joining, its state or its seats moving is a fleet change; a heartbeat or load is not', () => {
  assert.equal(fleetMoved(undefined, node()), true);
  assert.equal(fleetMoved(node(), node({ last_heartbeat_at: '2026-11-08T00:01:00Z', in_flight: 3 })), false);
  assert.equal(fleetMoved(node(), node({ status: 'offline' })), true);
  assert.equal(fleetMoved(node(), node({ seats: [{ id: 'a' }, { id: 'b' }] })), true);
});
