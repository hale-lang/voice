// Read a running api's board (getQueues) and validate it against the bundled
// spec (`QueueBoard`: internal.yaml's Board and its age).
//   usage: node queues.mjs <bundled.json> <base-url> <seat> [token-file]
// The board is the admin plane's: the operator token is read from
// `token-file` (`voice-api admin-token` writes it), never a command line.
// Exits 0 when the board is valid and `seat` is on it, not held, consuming
// its own queue first.
import fs from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const [bundlePath, base, seat, tokenFile] = process.argv.slice(2);
const operator = tokenFile ? { authorization: `Bearer ${fs.readFileSync(tokenFile, 'utf8').trim()}` } : {};
const spec = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
const schema = structuredClone(spec.paths['/admin/v1/queues'].get.responses['200'].content['application/json'].schema);
delete schema.$schema;
const r = await fetch(base + '/admin/v1/queues', { headers: operator });
const text = await r.text();
if (r.status !== 200) { console.log('queues', r.status, text.slice(0, 200)); process.exit(1); }
const board = JSON.parse(text);
const f = ajv.compile(schema);
if (!f(board)) { console.log('FAIL queues', JSON.stringify(f.errors.slice(0, 3))); process.exit(1); }
const found = board.seats.find(s => s.seat === seat);
if (!found || found.hold !== null || !found.consume[0]?.endsWith('.work.s.' + seat.replace('/', '.'))) {
  console.log('FAIL', seat, 'is not on the board consuming its own queue first', JSON.stringify(found));
  process.exit(1);
}
console.log('board version', board.version, `(${board.age_ms} ms old):`, seat, 'consumes', found.consume.length, 'queues, its own first');
