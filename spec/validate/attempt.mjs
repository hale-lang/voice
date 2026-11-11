// Read one coding attempt from a running api and validate it against the
// bundled spec's CodingAttempt (getAttempt).
//   usage: node attempt.mjs <bundled.json> <base-url> <key-file> <attempt>
// The project key is read from `key-file`, never a command line.
import fs from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const [bundlePath, base, keyFile, id] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
const schema = structuredClone(spec.components.schemas.CodingAttempt);
delete schema.$schema;
delete schema.examples;
const r = await fetch(`${base}/v1/attempts/${id}`, { headers: { authorization: `Bearer ${fs.readFileSync(keyFile, 'utf8').trim()}` } });
const text = await r.text();
if (r.status !== 200) { console.log('attempt', r.status, text.slice(0, 200)); process.exit(1); }
const f = ajv.compile(schema);
if (!f(JSON.parse(text))) { console.log('FAIL attempt', JSON.stringify(f.errors.slice(0, 3))); process.exit(1); }
console.log('attempt', id, 'is a CodingAttempt');
