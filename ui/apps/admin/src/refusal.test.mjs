import test from 'node:test';
import assert from 'node:assert/strict';
import { refusalOf, refusalLine, refusedGroups, refusedLine } from './refusal.ts';

const out = (reason, over = {}) => ({ request_id: 'resp_1', queued: false, reason, message: '', project: 'work', key: 'key_1', ...over });

test('each reason is said in plain words when the api gives no message', () => {
  assert.equal(refusalLine(out('no_annotator')), 'no annotator applies to this request');
  assert.equal(refusalLine(out('no_text')), 'the request has no recorded text to read');
  assert.equal(refusalLine(out('unknown', { project: '', key: '' })), 'voice has no record of this request');
  assert.equal(refusalLine(out('not_annotating')), 'annotation is off for its project and key: turn it on in Projects');
});

test("the api's message is said first, and never a bare refused", () => {
  const o = out('no_text', { message: 'request resp_1 has no recorded text to read' });
  assert.equal(refusalLine(o), 'request resp_1 has no recorded text to read');
  assert.equal(refusalLine(out('some_new_reason')), 'some new reason');
  assert.notEqual(refusalLine(out('')), 'refused');
});

test('annotation off names the project to turn it on for', () => {
  const r = refusalOf(out('not_annotating', { message: 'annotation is off for project work and key key_1' }));
  assert.deepEqual(r, { said: 'annotation is off for project work and key key_1', turnOn: { project: 'work' } });
  assert.equal(refusalOf(out('no_text')).turnOn, undefined);
});

test('a run is summed up by reason, the most first, queued ones left out', () => {
  const run = [
    out('', { queued: true }),
    out('no_text'),
    out('no_text', { request_id: 'resp_2' }),
    out('not_annotating', { project: 'quiet' }),
    out('not_annotating', { project: 'work' }),
    out('not_annotating', { project: 'quiet' }),
    out('unknown', { project: '' }),
  ];
  const g = refusedGroups(run);
  assert.deepEqual(g.map((x) => [x.reason, x.count]), [['not_annotating', 3], ['no_text', 2], ['unknown', 1]]);
  assert.deepEqual(g[0].projects, ['quiet', 'work']);
  assert.equal(
    refusedLine(run),
    '3 with annotation off for project quiet, project work: turn it on in Projects; 2 with no recorded text to read; 1 that voice has no record of',
  );
  assert.deepEqual(refusedGroups([out('', { queued: true })]), []);
});
