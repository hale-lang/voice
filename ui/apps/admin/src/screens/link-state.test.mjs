import test from 'node:test';
import assert from 'node:assert/strict';
import { cablingState, cabledSaid, linkState, portsSaid, speedSaid, bandwidthSaid } from './link-state.ts';

const halves = [
  { ifname: 'enP2p1s0f0np0', speed_mbps: 200000 },
  { ifname: 'enp1s0f0np0', speed_mbps: 200000 },
];
const found = (over = {}) => ({ peer: 'node-b', paired: true, source: 'discovered', addressed: true, ...over });

test('cabled ports with no peer found say so', () => {
  assert.equal(cablingState(halves, []), '2 ports cabled (200 Gb/s), no peer found');
  assert.equal(cablingState([{ ifname: 'a', speed_mbps: 100000 }], undefined), '1 port cabled (100 Gb/s), no peer found');
});

test('nothing cabled and nothing declared says that too', () => {
  assert.equal(cablingState(undefined, undefined), 'no cabled port found, and its capabilities file declares no link');
  assert.equal(cablingState([], []), 'no cabled port found, and its capabilities file declares no link');
});

test('a link found leaves the cabling to its own line', () => {
  assert.equal(cablingState(halves, [found()]), '');
});

test('cabled to a peer, without an address to meet on', () => {
  assert.deepEqual(linkState(found({ addressed: false }), true), { tone: 'wait', text: 'cabled to node-b, not addressed', checkable: false });
});

test('a link with none back is said, and not checked', () => {
  assert.deepEqual(linkState(found({ source: 'declared', paired: false }), true), { tone: 'wait', text: 'cabled to node-b · node-b has no link back', checkable: false });
});

test('a link never checked can be, while its node is up', () => {
  assert.deepEqual(linkState(found(), true), { tone: 'quiet', text: 'cabled to node-b · not checked', checkable: true });
  assert.equal(linkState(found(), false).checkable, false);
});

test('a running check is waited on', () => {
  const s = linkState(found({ check: { status: 'running', degraded: false } }), true);
  assert.deepEqual(s, { tone: 'wait', text: 'cabled to node-b · link check running', checkable: false });
});

test('a passed check says what it measured', () => {
  const s = linkState(found({ check: { status: 'passed', degraded: false, bus_bytes_per_second: 22_900_000_000 } }), true);
  assert.deepEqual(s, { tone: 'ok', text: 'cabled to node-b · link check passed 22.9 GB/s', checkable: true });
});

test('a degraded pass says why', () => {
  const reason = 'node-a: the all-reduce\'s sum was right; node-b: ran it right; degraded: 3.1 GB/s measured, under the 10 GB/s voice expects';
  const s = linkState(found({ check: { status: 'passed', degraded: true, bus_bytes_per_second: 3_100_000_000, reason } }), true);
  assert.equal(s.text, 'degraded: 3.1 GB/s measured, under the 10 GB/s voice expects');
  assert.equal(s.tone, 'wait');
});

test('a failed check says what failed', () => {
  const s = linkState(found({ check: { status: 'failed', degraded: false, reason: 'node-b: the check did not finish' } }), true);
  assert.deepEqual(s, { tone: 'fail', text: 'cabled to node-b · link check failed: node-b: the check did not finish', checkable: true });
});

test('speeds and bandwidths as they are sold', () => {
  assert.equal(speedSaid(200000), '200 Gb/s');
  assert.equal(speedSaid(2500), '2.5 Gb/s');
  assert.equal(speedSaid(100), '100 Mb/s');
  assert.equal(bandwidthSaid(22_745_586_834), '22.7 GB/s');
  assert.equal(cabledSaid([{ ifname: 'a', speed_mbps: 0 }]), '1 port cabled');
});

test("a link's ports on one line, the meeting one first", () => {
  assert.equal(
    portsSaid([
      { ifname: 'enp1s0f0np0', address: '198.51.100.1', hca: 'rocep1s0f0' },
      { ifname: 'enP2p1s0f0np0', address: '203.0.113.1', hca: 'roceP2p1s0f0' },
    ]),
    'enp1s0f0np0 198.51.100.1 · rocep1s0f0, enP2p1s0f0np0 203.0.113.1 · roceP2p1s0f0',
  );
  assert.equal(portsSaid([{ ifname: 'enP2p1s0f0np0', hca: 'roceP2p1s0f0', speed_mbps: 200000 }]), 'enP2p1s0f0np0 · roceP2p1s0f0', 'not addressed: no address');
});

test('ports that are not a list say nothing, and never throw', () => {
  // what getNode once sent: the ports' JSON as a string
  assert.equal(portsSaid('{"ifname": "enp1s0f0np0", "address": "198.51.100.1", "hca": "rocep1s0f0"}'), '');
  assert.equal(portsSaid(undefined), '');
  assert.equal(portsSaid({ ifname: 'enp1s0f0np0' }), '');
  assert.equal(portsSaid([null, 'x', { ifname: 'enp1s0f0np0' }]), 'enp1s0f0np0');
});
