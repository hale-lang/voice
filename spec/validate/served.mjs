// Ask a running api, with a node serving, for a response and a chat
// completion, and validate both against the bundled spec.
//   usage: node served.mjs <bundled.json> <base-url> <project-key>
import fs from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const [bundlePath, base, key] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv); ajv.addKeyword('discriminator');
const strip = s => { const c = structuredClone(s); delete c.$schema; return c; };
let fails = 0;
const fail = (l, m) => { fails++; console.log('FAIL', l, m); };
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
