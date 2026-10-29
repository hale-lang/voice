// The contract the API screen reads: spec/openapi.yaml bundled into one
// JSON document (its other files' references pulled into its components),
// written where the api serves the UI's files, so `/openapi.json` is the
// contract voice was built with. References stay references; the screen
// follows them.
import { bundle, loadConfig } from '@redocly/openapi-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../../../../spec/openapi.yaml');
const out = path.resolve(here, '../public/openapi.json');
const config = await loadConfig({});
const { bundle: doc, problems } = await bundle({ ref: spec, config, dereference: false });
const errors = problems.filter((p) => p.severity === 'error');
if (errors.length) {
  for (const p of errors) console.error(p.message);
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc.parsed) + '\n');
console.log(`wrote ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes)`);
