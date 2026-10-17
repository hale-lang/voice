// Ask a running api, with a node serving, for a response and a chat
// completion, and validate both against the bundled spec. With `502`, every
// seat is set to fail: the response must be the contract's `502`, with the
// request id and every attempt in `error.voice`. With `tool`, the seat
// answers with a tool call, and the chat completion must carry it.
//   usage: node served.mjs <bundled.json> <base-url> <project-key> [502|tool]
import fs from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const [bundlePath, base, key, expect] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv); ajv.addKeyword('discriminator');
const strip = s => { const c = structuredClone(s); delete c.$schema; return c; };
let fails = 0;
const fail = (l, m) => { fails++; console.log('FAIL', l, m); };
if (expect === 'tool') {
  // the seat answers with a tool call: a chat completion that carries it
  const r = await fetch(base + '/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'weather?' }], tools: [{ type: 'function', function: { name: 'weather' } }] }), headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` } });
  const text = await r.text();
  if (r.status !== 200) fail('/v1/chat/completions', `status ${r.status}: ${text.slice(0, 200)}`);
  else {
    const f = ajv.compile(strip(spec.paths['/v1/chat/completions'].post.responses['200'].content['application/json'].schema));
    const j = JSON.parse(text);
    if (!f(j)) fail('/v1/chat/completions', JSON.stringify(f.errors.slice(0, 3)));
    const c = j.choices?.[0];
    if (c?.finish_reason !== 'tool_calls') fail('/v1/chat/completions', `finish_reason ${c?.finish_reason}`);
    if (c?.message?.tool_calls?.[0]?.function?.name !== 'weather') fail('/v1/chat/completions', 'no tool call to weather');
    console.log('/v1/chat/completions', r.status, c?.finish_reason, c?.message?.tool_calls?.[0]?.function?.name);
  }
  console.log(`1 tool call, ${fails} failures`);
  process.exit(fails ? 1 : 0);
}
if (expect === '502') {
  const r = await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'echo-1', input: 'hi' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` } });
  const text = await r.text();
  if (r.status !== 502) fail('/v1/responses', `status ${r.status}, not 502: ${text.slice(0, 200)}`);
  else {
    const schema = spec.paths['/v1/responses'].post.responses['502'].content['application/json'].schema;
    const f = ajv.compile(strip(schema));
    const j = JSON.parse(text);
    if (!f(j)) fail('/v1/responses 502', JSON.stringify(f.errors.slice(0, 3)));
    const v = j.error?.voice;
    if (!v?.request_id) fail('/v1/responses 502', 'no error.voice.request_id');
    if (!v?.attempts?.length) fail('/v1/responses 502', 'no error.voice.attempts');
    console.log('/v1/responses', r.status, j.error?.code, (v?.attempts || []).map(a => a.seat + ' ' + a.outcome).join(', '));
  }
  console.log(`1 failed call, ${fails} failures`);
  process.exit(fails ? 1 : 0);
}
const calls = [
  ['/v1/responses', { model: 'echo-1', input: 'hello there', instructions: 'Be brief.', metadata: { 'dna.attempt_id': 'w-1' } }],
  ['/v1/chat/completions', { model: 'echo-1', messages: [{ role: 'user', content: 'hi' }], max_tokens: 64 }],
];
for (const [path, body] of calls) {
  const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` } });
  const text = await r.text();
  if (r.status !== 200) { fail(path, `status ${r.status}: ${text.slice(0, 200)}`); continue; }
  const schema = spec.paths[path].post.responses['200'].content['application/json'].schema;
  const f = ajv.compile(strip(schema));
  const j = JSON.parse(text);
  if (!f(j)) fail(path, JSON.stringify(f.errors.slice(0, 3)));
  if (r.headers.get('x-request-id') !== j.voice?.request_id) fail(path, 'X-Request-Id is not voice.request_id');
  if (!text.includes('hello from voice')) fail(path, 'not the seat text');
  console.log(path, r.status, j.voice?.served?.seat, j.voice?.timing?.wall_ms + 'ms');
}
console.log(`${calls.length} served calls, ${fails} failures`);
process.exit(fails ? 1 : 0);
