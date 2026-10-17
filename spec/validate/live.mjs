// Call every operation on a running api and validate status, content type,
// headers and body against the bundled spec.  usage: node live.mjs <bundled.json> <base-url>
//
// The api starts empty, so the sample world is made first, through the
// admin plane, and every call presents the key it yields. Operations that
// create get fresh ids, and the ones that delete run last, so each call
// finds what it names.
import fs from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const [bundlePath, base] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv); ajv.addKeyword('discriminator');
const sample = { project: 'work', key: 'k_ci', model: 'echo-1', account: 'claude-work', node: 'laptop', seat: 'static', request_id: 'resp_01j8z3q4v7m2k9x0' };
let fails = 0, n = 0;
const fail = (l, m) => { fails++; console.log('FAIL', l, m); };
const strip = s => { const c = structuredClone(s); delete c.$schema; return c; };

// the sample world: a model, a project and a key under it
const setup = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const text = await r.text();
  if (r.status !== 201) { console.log('FAIL setup', path, r.status, text.slice(0, 200)); process.exit(1); }
  return JSON.parse(text);
};
await setup('/admin/v1/models', { id: 'echo-1', context_length: 8192, max_output_tokens: 1024, price: { input_per_mtok_micros: 3000000, output_per_mtok_micros: 15000000, currency: 'USD' } });
await setup('/admin/v1/projects', { id: 'work', name: 'Work', owners: ['operator@example.com'], data_classes: ['public', 'internal'] });
const key = await setup('/admin/v1/projects/work/keys', { name: 'ci' });
sample.key = key.id;
const auth = { authorization: `Bearer ${key.secret}` };

// the bodies the real handlers take; anything else gets the generic one
const bodies = {
  createCatalogModel: { id: 'live-1', kind: 'hosted', owned_by: 'anthropic', price: null },
  updateCatalogModel: { max_output_tokens: 2048 },
  createProject: { id: 'live', name: 'Live' },
  updateProject: { name: 'Work' },
  createKey: { name: 'live', expires_at: '2099-01-01T00:00:00Z' },
  updateKey: { name: 'ci' },
};

const calls = [], last = [];
for (const [p, item] of Object.entries(spec.paths)) for (const [m, op] of Object.entries(item)) {
  if (m === 'parameters') continue;
  (m === 'delete' ? last : calls).push([p, m, op]);
}
for (const [p, m, op] of [...calls, ...last]) {
  const code = Object.keys(op.responses).find(c => c.startsWith('2'));
  const url = base + p.replace(/\{(\w+)\}/g, (_, k) => sample[k]);
  const content = op.responses[code].content;
  if (!content) {
    n++;
    const body = ['post', 'put'].includes(m) ? JSON.stringify({ in_flight: 0, seats: [], assignment_version: 1, paused: false, paused_seats: [], max_in_flight: 4, engines: [], seat: 's', windows: [] }) : undefined;
    const r = await fetch(url, { method: m.toUpperCase(), body, headers: body ? { 'content-type': 'application/json', ...auth } : auth });
    if (String(r.status) !== code) fail(`${op.operationId} ${m.toUpperCase()} ${p}`, `status ${r.status} != ${code}`);
    continue;
  }
  const variants = content['application/json'] ? (content['text/event-stream'] ? [false, true] : [false]) : [true];
  const inference = !!content['application/json'];
  for (const stream of variants) {
    n++;
    const label = `${op.operationId}${stream ? ' (stream)' : ''} ${m.toUpperCase()} ${url.slice(base.length)}`;
    const generic = stream ? { model: 'echo-1', input: 'hi', stream: true } : { model: 'echo-1', input: 'hi' };
    const body = ['post', 'put', 'patch'].includes(m) ? JSON.stringify(bodies[op.operationId] ?? generic) : undefined;
    const r = await fetch(url, { method: m.toUpperCase(), body, headers: body ? { 'content-type': 'application/json', ...auth } : auth });
    const text = await r.text();
    if (String(r.status) !== code) { fail(label, `status ${r.status} != ${code}: ${text.slice(0, 120)}`); continue; }
    const ct = r.headers.get('content-type') || '';
    const want = stream ? 'text/event-stream' : 'application/json';
    if (!ct.startsWith(want)) fail(label, `content-type ${ct} != ${want}`);
    if (p.startsWith('/v1/') && !r.headers.get('x-request-id')) fail(label, 'no X-Request-Id');
    if (!stream) {
      const f = ajv.compile(strip(content[want].schema));
      if (!f(JSON.parse(text))) fail(label, JSON.stringify(f.errors.slice(0, 3)));
    } else {
      const f = ajv.compile(strip(content[want].schema));
      const datas = text.split('\n\n').map(b => b.split('\n').find(l => l.startsWith('data: '))).filter(Boolean).map(l => l.slice(6));
      if (inference && datas.at(-1) !== '[DONE]') fail(label, 'no [DONE]');
      for (const d of (inference ? datas.slice(0, -1) : datas)) if (!f(JSON.parse(d))) fail(label, JSON.stringify(f.errors.slice(0, 3)));
    }
  }
}
const nf = await fetch(base + '/nope'); n++;
const nfb = await nf.json().catch(() => null);
if (nf.status !== 404 || nfb?.error?.code !== 'not_found') fail('unknown route', `${nf.status} ${JSON.stringify(nfb)}`);
// a caller-plane read without a key is refused in the contract's envelope
const anon = await fetch(base + '/v1/models'); n++;
const anonb = await anon.json().catch(() => null);
if (anon.status !== 401 || anonb?.error?.code !== 'invalid_key') fail('no key', `${anon.status} ${JSON.stringify(anonb)}`);
console.log(`${n} live calls, ${fails} failures`);
process.exit(fails ? 1 : 0);
