import test from 'node:test';
import assert from 'node:assert/strict';
import { SseReader } from './sse.ts';
import { apply, newAnswer, isOutput, paceOf } from './responses.ts';
import { bodyOf, refusedOf, refusedLine } from './request.ts';
import { newConversation } from './store.ts';

/** The events of a whole stream, read in chunks of `size` characters. */
function read(text, size = 7) {
  const r = new SseReader();
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(...r.feed(text.slice(i, i + size)));
  out.push(...r.end());
  return out;
}

const ev = (type, body) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;

const voice = {
  request_id: 'resp_abc',
  project: 'work',
  key: 'work-operator',
  served: { model: 'qwen3-8b', node: 'spark', seat: 'spark/llama', account: 'local', engine: 'llama.cpp' },
  price_micros: 1234,
  currency: 'USD',
  timing: { wall_ms: 900, queue_ms: 0, load_ms: 0, first_output_ms: 120, engine_ms: 850 },
  attempts: [{ seat: 'flare/llama', account: 'local', outcome: 'failed', error: 'the engine exited' }, { seat: 'spark/llama', account: 'local', outcome: 'served' }],
};

const STREAM =
  ev('response.created', { response: { id: 'resp_abc', status: 'in_progress' } }) +
  ev('response.in_progress', { response: { id: 'resp_abc' } }) +
  ': keep-alive\n\n' +
  ':\n\n' +
  ev('response.in_progress', { response: { id: 'resp_abc' } }) +
  ev('voice:attempt', { attempt: { seat: 'flare/llama', account: 'local', outcome: 'failed', error: 'the engine exited' }, next_seat: 'spark/llama' }) +
  ev('response.reasoning.delta', { delta: 'Think ' }) +
  ev('response.reasoning.delta', { delta: 'first.' }) +
  ev('response.output_text.delta', { delta: 'Hello, ' }) +
  ev('response.output_text.delta', { delta: 'wörld ✓' }) +
  ev('response.completed', {
    response: {
      id: 'resp_abc',
      status: 'completed',
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Think first.' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello, wörld ✓' }] },
      ],
      usage: { input_tokens: 11, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 } },
      voice,
    },
  }) +
  'data: [DONE]\n\n';

test('the reader takes events across any chunking, CRLF and comments alike', () => {
  for (const size of [1, 3, 7, 64, 100000]) {
    const evs = read(STREAM, size);
    assert.equal(evs.length, 10, `size ${size}`);
    assert.equal(evs[0].event, 'response.created');
    assert.equal(evs.at(-1).data, '[DONE]');
  }
  const crlf = read(STREAM.replace(/\n/g, '\r\n'), 5);
  assert.equal(crlf.length, 10, "CRLF lines");
  const multi = read('data: a\ndata: b\n\n');
  assert.deepEqual(multi, [{ event: '', data: 'a\nb' }], 'data lines join');
  assert.deepEqual(read('data: tail'), [{ event: '', data: 'tail' }], 'an unterminated last event');
});

test('text and reasoning deltas, keep-alives, attempts and the completion with usage and route', () => {
  let a = newAnswer();
  const seen = [];
  for (const e of read(STREAM)) {
    if (isOutput(e)) seen.push(e.event);
    a = apply(a, e);
  }
  assert.equal(a.text, 'Hello, wörld ✓');
  assert.equal(a.reasoning, 'Think first.');
  assert.equal(a.status, 'completed');
  assert.equal(a.done, true);
  assert.equal(a.alive, 2, 'the opening in_progress and one keep-alive');
  assert.equal(a.requestId, 'resp_abc');
  assert.deepEqual(a.usage, { input: 11, output: 7, reasoning: 3 });
  assert.equal(a.priceMicros, 1234);
  assert.equal(a.served.seat, 'spark/llama');
  assert.equal(a.served.node, 'spark');
  assert.equal(a.attempts.length, 2, 'the api\'s attempts, whole, at the end');
  assert.equal(a.timing.first_output_ms, 120);
  assert.equal(seen.length, 4, 'four output events');
});

test('a keep-alive alone changes nothing but the count', () => {
  const a = apply(newAnswer(), { event: 'response.in_progress', data: JSON.stringify({ type: 'response.in_progress', response: { id: 'resp_x', voice: { request_id: 'resp_x' } } }) });
  assert.equal(a.text, '');
  assert.equal(a.status, 'started');
  assert.equal(a.alive, 1);
  assert.equal(a.requestId, 'resp_x');
});

test('a stream that fails: the error event, then response.failed with what came', () => {
  const failed =
    ev('response.created', { response: { id: 'resp_f' } }) +
    ev('response.output_text.delta', { delta: 'partial' }) +
    ev('error', { error: { type: 'server_error', code: 'upstream_failed', message: 'the seat went silent', param: null } }) +
    ev('response.failed', { response: { id: 'resp_f', status: 'failed', output: [], error: { code: 'upstream_failed', message: 'the seat went silent' }, voice: { ...voice, request_id: 'resp_f' } } }) +
    'data: [DONE]\n\n';
  let a = newAnswer();
  for (const e of read(failed)) a = apply(a, e);
  assert.equal(a.status, 'failed');
  assert.equal(a.text, 'partial', 'what came is kept');
  assert.deepEqual(a.error, { code: 'upstream_failed', message: 'the seat went silent' });
  assert.equal(a.requestId, 'resp_f');
});

test('an incomplete answer says why', () => {
  const a = apply(newAnswer(), { event: 'response.incomplete', data: JSON.stringify({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 1, output_tokens: 5 } } }) });
  assert.equal(a.status, 'incomplete');
  assert.equal(a.incomplete, 'max_output_tokens');
});

test('unknown events and broken data change nothing', () => {
  const a = newAnswer();
  assert.equal(apply(a, { event: 'response.output_item.added', data: '{"type":"response.output_item.added"}' }), a);
  assert.equal(apply(a, { event: '', data: 'not json' }), a);
});

test('the pace: time to first output, total, and tokens a second after it', () => {
  const a = { ...newAnswer(), usage: { input: 10, output: 50 } };
  assert.deepEqual(paceOf(a, 1000, 1500, 3500), { ttftMs: 500, totalMs: 2500, tokensPerSecond: 25 });
  assert.deepEqual(paceOf(newAnswer(), 1000, undefined, 1200), { totalMs: 200 });
});

test('refusals are said plainly, with Retry-After', () => {
  const r = refusedOf(429, '12', JSON.stringify({ error: { type: 'too_many_requests', code: 'rate_limited', message: 'project work is past its limit of 2 requests per 60s' } }));
  assert.deepEqual(r, { status: 429, code: 'rate_limited', message: 'project work is past its limit of 2 requests per 60s', retryAfter: 12 });
  assert.equal(refusedLine(r), '429 rate_limited: project work is past its limit of 2 requests per 60s · retry in 12s');
  const no = refusedOf(503, '30', '{"error": {"code": "no_capacity", "message": "every account is out of headroom"}}');
  assert.equal(refusedLine(no), '503 no_capacity: every account is out of headroom · retry in 30s');
  assert.equal(refusedLine(refusedOf(502, null, '')), '502: the api answered 502');
  assert.equal(refusedOf(502, null, 'Bad Gateway').message, 'Bad Gateway');
});

test('the body: the conversation whole, its system prompt and its options', () => {
  const c = newConversation('work', 'qwen3-8b', 0);
  c.system = 'Be brief.';
  c.options = { temperature: 0.2, top_p: null, max_output_tokens: 256, effort: 'low' };
  c.messages = [
    { id: 'm1', role: 'user', text: 'hi', at: 0 },
    { id: 'm2', role: 'assistant', text: 'hello', at: 1 },
    { id: 'm3', role: 'assistant', text: '', at: 2, refused: '429' },
    { id: 'm4', role: 'user', text: 'again', at: 3 },
  ];
  const b = bodyOf(c);
  assert.equal(b.model, 'qwen3-8b');
  assert.equal(b.stream, true);
  assert.equal(b.instructions, 'Be brief.');
  assert.equal(b.temperature, 0.2);
  assert.equal('top_p' in b, false, 'an option left unset is not sent');
  assert.equal(b.max_output_tokens, 256);
  assert.deepEqual(b.reasoning, { effort: 'low' });
  assert.equal(b.prompt_cache_key, c.id);
  assert.deepEqual(b.input.map((m) => `${m.role}:${m.content}`), ['user:hi', 'assistant:hello', 'user:again'], 'an empty answer is not sent');
});
