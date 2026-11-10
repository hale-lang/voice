import test from 'node:test';
import assert from 'node:assert/strict';
import { changeReads, fleetMoved, fitsMoved, ARRANGEMENTS, FITS } from './fleet-reads.ts';

const node = (over = {}) => ({ id: 'spark3', status: 'up', seats: [{ id: 'a' }], in_flight: 0, last_heartbeat_at: '2026-11-08T00:00:00Z', ...over });

test('a placement or a node changed reads the saved arrangements again; others do not', () => {
  assert.deepEqual(changeReads('placements/qwen-spark3'), ['/admin/v1/placements', ARRANGEMENTS, FITS]);
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

test('how every recipe fits is read again when a recipe, runtime, placement or node changes', () => {
  for (const t of ['recipes/x', 'runtimes/vllm-26.09', 'placements/qwen-spark3', 'nodes/spark3']) assert.ok(changeReads(t).includes(FITS), t);
  assert.ok(!changeReads('projects/work/budget').includes(FITS));
  assert.ok(!changeReads('accounts/work').includes(FITS));
});

test('a node report moves the fits when it joins, its seats or state move, a download lands or its hardware changes; a heartbeat does not', () => {
  const hw = { os: 'linux', arch: 'arm64', memory_bytes: 130e9, model_memory_bytes: 122e9, accelerators: [], disk_free_bytes: 3.5e12 };
  const base = node({ hardware: hw, downloaded: { files: 7, bytes: 3e9 } });
  assert.equal(fitsMoved(undefined, base), true);
  assert.equal(fitsMoved(base, { ...base, last_heartbeat_at: '2026-11-08T00:01:00Z', in_flight: 2 }), false);
  assert.equal(fitsMoved(base, { ...base, seats: [] }), true);
  assert.equal(fitsMoved(base, { ...base, downloaded: { files: 9, bytes: 8e9 } }), true);
  assert.equal(fitsMoved(base, { ...base, hardware: { ...hw, disk_free_bytes: 3.4e12 } }), true);
});
