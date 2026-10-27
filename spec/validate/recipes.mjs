// Hold every recipe in a directory to the contract (`RecipeCreate`,
// spec/openapi.yaml, bundled): its schema, its id the file's name, and its
// variants' ids distinct. With --refused, every file must be refused
// instead: the fixtures in recipes/refused say what curation keeps out.
//
//   usage: node recipes.mjs <bundled-contract.json> <dir> [--refused]
import fs from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const [contractPath, dir, mode] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
const valid = ajv.compile(contract.components.schemas.RecipeCreate);

function problems(file) {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { return [e.message]; }
  if (!valid(r)) return valid.errors.map(e => `${e.instancePath || '/'} ${e.message}`);
  const out = [];
  for (const k of Object.keys(r)) if (!['id', 'license', 'variants'].includes(k)) out.push(`it has no field ${k}`);
  if (r.id + '.json' !== file) out.push(`its id is ${r.id}, its file ${file}`);
  const ids = r.variants.map(v => v.id);
  if (new Set(ids).size !== ids.length) out.push('two variants share an id');
  return out;
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
let failed = 0;
for (const f of files) {
  const p = problems(f);
  if (mode === '--refused') {
    if (p.length === 0) { failed++; console.log(`FAIL ${f}: a recipe curation keeps out was taken`); }
    else console.log(`ok   ${f} refused: ${p[0]}`);
  } else if (p.length > 0) { failed++; console.log(`FAIL ${f}: ${p.join('; ')}`); }
  else console.log(`ok   ${f}`);
}
console.log(`${files.length} recipe(s), ${failed} failure(s)`);
process.exit(failed ? 1 : 0);
