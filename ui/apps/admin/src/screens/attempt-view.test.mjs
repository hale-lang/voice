import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptEnded, attemptTone, parseTranscript, shortSha, wall } from './attempt-view.ts';

test('a state as the screen shows it', () => {
  assert.equal(attemptTone('done'), 'ok');
  assert.equal(attemptTone('failed'), 'fail');
  assert.equal(attemptTone('running'), 'active');
  assert.equal(attemptTone('queued'), 'wait');
  assert.equal(attemptTone('cancelled'), 'quiet');
  assert.equal(attemptEnded('cancelled'), true);
  assert.equal(attemptEnded('running'), false);
});

test('a transcript, a line an event; a line cut short is passed over', () => {
  const text = '{"seq": 1, "at": "2026-11-12T02:00:00Z", "kind": "note", "text": "fetching main"}\n{"seq": 2, "at": "2026-11-12T02:00:01Z", "kind": "text", "text": "working"}\n{"seq": 3, "at"';
  const e = parseTranscript(text);
  assert.deepEqual(e.map((x) => x.seq), [1, 2]);
  assert.equal(e[1].kind, 'text');
  assert.deepEqual(parseTranscript(''), []);
});

test('commits and wall time, short', () => {
  assert.equal(shortSha('26148255548842d039c635933c91aa26e7b597f4'), '261482555488');
  assert.equal(shortSha(null), '–');
  assert.equal(wall(5148), '5 s');
  assert.equal(wall(412000), '7 min');
});
