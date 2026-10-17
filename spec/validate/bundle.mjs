// Hold the api's exported surface (api/bundle/Voice.openapi.json) to the
// contract (spec/openapi.yaml, bundled): each row type against the
// contract schema it stands for, field by field. Every difference is a
// gap, classed by what closes it; the classed gaps are committed in
// api/gaps.json, and a run fails when the gaps found and the gaps
// committed differ, either way: a new difference, or a closed one still
// listed.
//
// It fails closed: every exported component is mapped to the contract,
// reached inside a mapped one, or on NOT_COMPARED with a reviewed reason;
// a contract shape with no single type is a gap of its own (`open`); a
// scalar of another type is classed only by a reviewed rule; enum values
// are compared when both sides have them; and `required` is checked both
// ways.
//
//   usage: node bundle.mjs <bundled-contract.json> <Voice.openapi.json> <gaps.json> [--write]
import fs from 'fs';

const [contractPath, bundlePath, gapsPath, mode] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

// What closes each kind of gap.
const WAITS_ON = {
  optional: 'hale-lang/hale#1600: optional fields (a value or null)',
  enum: 'hale step 0: enums',
  map: 'hale step 0: maps, as bounded[S; N] indexed_by <field>',
  name: 'hale: stable, valid schema names for imported types (st::X is no OpenAPI component name)',
  wrapper: 'hale: a bounded field assigned whole (FRICTION.md); the list rides in a record',
  'json-text': 'voice: a structured object carried as JSON text, typed once it may be null (#1600)',
  path: 'voice: a path or query parameter carried in the row\'s request',
  wire: 'voice: the REST wire\'s shape differs from the row (written by api/wire.hl)',
  required: 'voice: the row gives the field a default, so the surface does not require it; the REST reader does (api/wire.hl)',
  open: 'voice: the contract admits several shapes there (oneOf/anyOf, or none named); the row carries one, as the REST reader does',
};

// Each row type, and the contract schema it stands for: a component name,
// or METHOD path for an inline response.
const MAP = {
  Health: 'Health',
  CatalogModel: 'CatalogModel',
  CatalogModelCreate: 'CatalogModelCreate',
  CatalogModelUpdate: 'CatalogModelUpdate',
  CatalogList: 'GET /admin/v1/models',
  Model: 'Model',
  ModelList: 'ModelList',
  Capabilities: 'Capabilities',
  Project: 'Project',
  ProjectCreate: 'ProjectCreate',
  ProjectUpdate: 'ProjectUpdate',
  ProjectList: 'GET /admin/v1/projects',
  Key: 'KeyWithSecret',
  KeyCreate: 'KeyCreate',
  KeyUpdate: 'KeyUpdate',
  KeyList: 'GET /admin/v1/projects/{project}/keys',
  Budget: 'Budget',
  'st::BudgetSet': 'BudgetSet',
  LimitSet: 'LimitSet',
  'st::Limit': 'Limit',
  'st::ModelPrice': 'ModelPrice',
  Account: 'Account',
  AccountCreate: 'AccountCreate',
  AccountUpdate: 'AccountUpdate',
  AccountList: 'GET /admin/v1/accounts',
  Node: 'NodeWithToken',
  NodeCreate: 'NodeCreate',
  NodeUpdate: 'NodeUpdate',
  NodeList: 'GET /admin/v1/nodes',
  SeatView: 'SeatView',
  SeatCreate: 'Seat',
  SeatUpdate: 'SeatUpdate',
  SeatList: 'GET /admin/v1/nodes/{node}/seats',
  'st::SeatModel': 'SeatModel',
  Change: 'Change',
  ChangeList: 'GET /admin/v1/changes',
  Attempt: 'Attempt',
  VoiceExtension: 'VoiceResponseExtension',
  ServedBy: 'Served',
  Served: 'Response',
  InferenceRequest: 'CreateResponseRequest',
  Registration: 'Registration',
  Registered: 'Registered',
  Assignment: 'Assignment',
  AssignedSeat: 'Seat',
  SeatState: 'SeatState',
  SeatStates: 'SeatStates',
  Heartbeat: 'Heartbeat',
  QuotaReport: 'QuotaReport',
  Draining: 'Draining',
  ApiError: 'ErrorResponse.error',
  BudgetRequest: 'BudgetSet',
  LimitsRequest: 'LimitSet',
};

// Exported components compared with nothing, each with why. Anything
// exported that is neither mapped, reached inside a mapped component, nor
// here fails the run.
const NOT_COMPARED = {
  AccountRef: 'the path parameter `account`; no body',
  KeyRef: 'the path parameters `project` and `key`; no body',
  ModelRef: 'the path parameter `model`; no body',
  NodeRef: 'the path parameter `node`; no body',
  ProjectRef: 'the path parameter `project`; no body',
  SeatRef: 'the path parameters `node` and `seat`; no body',
  AccountQuery: 'the query parameter `include_archived`; no body',
  ProjectQuery: 'the query parameter `include_archived`; no body',
  'st::ChangeQuery': 'the query parameters of `GET /admin/v1/changes` (`target`, `from`, `to`, `limit`, `cursor`); no body',
  NodeReport: 'one row for two bodies, the node\'s `Capabilities` (PUT /node/v1/capabilities) and `LocalControls` (PUT /node/v1/local), each carried whole as JSON text and checked by the reader (api/fleet.hl)',
  'hale.Refusal': 'hale\'s own refusal of a malformed rpc (std::api), not part of voice\'s contract',
};

// Fields of a row's request that are the path's or the query's.
const PARAMS = new Set(['model', 'project', 'key', 'account', 'node', 'seat', 'include_archived']);
// Records that stand for a list: the list rides in `items`.
const WRAPPERS = new Set(['st::Names', 'st::Limits', 'st::SeatModels', 'SeatViews', 'ModelIds', 'AppliedLimits', 'Problems', 'Attempts', 'AssignedSeats', 'SeatStateList']);
// Records that stand for a value or null.
const NULLABLES = new Set(['st::Restriction', 'MaybeBudget']);

const bschemas = bundle.components.schemas;
const cschemas = contract.components.schemas;
const gaps = [];
const gap = (at, kind) => { if (!gaps.some(g => g.at === at)) gaps.push({ at, kind }); };
// the exported components a comparison reached
const reached = new Set();

function bresolve(s) {
  while (s && s.$ref) {
    const n = s.$ref.replace('#/components/schemas/', '');
    reached.add(n);
    s = bschemas[n];
  }
  return s || {};
}
function bname(s) { return s && s.$ref ? s.$ref.replace('#/components/schemas/', '') : ''; }

// A contract schema with allOf merged, and whether it admits null.
function cflat(s) {
  if (!s) return { s: {}, nullable: false };
  let nullable = false;
  if (Array.isArray(s.type) && s.type.includes('null')) { nullable = true; s = { ...s, type: s.type.filter(t => t !== 'null')[0] }; }
  if (s.oneOf) {
    const rest = s.oneOf.filter(o => o.type !== 'null');
    if (rest.length < s.oneOf.length) nullable = true;
    if (rest.length === 1) { const r = cflat(rest[0]); return { s: r.s, nullable: nullable || r.nullable }; }
  }
  if (s.allOf) {
    const merged = { type: 'object', properties: {}, required: [] };
    for (const part of s.allOf) {
      const p = cflat(part).s;
      Object.assign(merged.properties, p.properties || {});
      merged.required.push(...(p.required || []));
    }
    return { s: merged, nullable };
  }
  return { s, nullable };
}
const ctype = s => s.type || (s.properties ? 'object' : s.items ? 'array' : undefined);

function compare(at, c, b) {
  const { s: cs, nullable } = cflat(c);
  const name = bname(b);
  if (name) reached.add(name);
  if (NULLABLES.has(name)) { gap(at, 'optional'); return; }
  if (WRAPPERS.has(name)) {
    if (ctype(cs) === 'array') gap(at, 'wrapper'); else gap(at, 'wire');
    return;
  }
  const bs = bresolve(b);
  if (nullable) gap(at, 'optional');
  const ct = ctype(cs), bt = bs.type;
  if (cs.enum && bs.enum) {
    const a = [...cs.enum].sort().join(','), z = [...bs.enum].sort().join(',');
    if (a !== z) gap(at + ' (enum values)', 'enum-values');
  } else if (cs.enum && bt === 'string') { gap(at + ' (enum)', 'enum'); return; }
  // a contract shape with no single type: several, or none named
  if (ct === undefined) { gap(at, 'open'); return; }
  if (ct === 'object' && bt === 'string') {
    const freeform = !cs.properties || cs.additionalProperties;
    gap(at, freeform ? 'map' : 'json-text');
    return;
  }
  if (ct === 'array' && bt === 'string') { gap(at, 'json-text'); return; }
  if (ct === 'object' && bt === 'object') { fields(at, cs, bs); return; }
  if (ct === 'array' && bt === 'array') { compare(at + '[]', cs.items, bs.items); return; }
  const same = ct === bt || (ct === 'number' && bt === 'integer');
  if (!same) gap(at, 'type');
}

function fields(at, cs, bs) {
  const cp = cs.properties || {}, bp = bs.properties || {};
  const breq = new Set(bs.required || []);
  const creq = new Set(cs.required || []);
  for (const k of Object.keys(cp)) {
    if (cp[k].readOnly) continue;
    if (!(k in bp)) gap(`${at}.${k}`, 'missing');
    else {
      if (creq.has(k) && !breq.has(k)) gap(`${at}.${k} (required)`, 'required');
      // a field the row requires and the contract does not: the row
      // would refuse what the contract allows
      if (breq.has(k) && !creq.has(k)) gap(`${at}.${k} (required by the row)`, 'over-required');
      compare(`${at}.${k}`, cp[k], bp[k]);
    }
  }
  for (const k of Object.keys(bp)) {
    if (k in cp) continue;
    if (PARAMS.has(k)) gap(`${at}.${k}`, 'path');
    else gap(`${at}.${k}`, 'extra');
  }
}

for (const [row, target] of Object.entries(MAP)) {
  const b = bschemas[row];
  if (!b) { gap(row, 'unmapped'); continue; }
  let c;
  if (target.includes(' ')) {
    const [method, path] = target.split(' ');
    c = contract.paths[path][method.toLowerCase()].responses['200'].content['application/json'].schema;
  } else if (target.includes('.')) {
    // a component's property: `ErrorResponse.error`
    const [comp, prop] = target.split('.');
    c = cschemas[comp] && cflat(cschemas[comp]).s.properties?.[prop];
  } else c = cschemas[target];
  if (!c) { gap(row + ' -> ' + target, 'unmapped'); continue; }
  compare(row, c, { $ref: '#/components/schemas/' + row });
}
for (const n of Object.keys(bschemas)) if (n.includes('::')) gap('component ' + n, 'name');
// every exported component is compared, or says why not
const unaccounted = Object.keys(bschemas).filter(n => !(n in MAP) && !reached.has(n) && !(n in NOT_COMPARED) && !WRAPPERS.has(n) && !NULLABLES.has(n));
const stale = Object.keys(NOT_COMPARED).filter(n => !(n in bschemas) || n in MAP || reached.has(n));

// A field the row has and the contract does not, or the reverse, classed
// by why: the first rule whose pattern the gap's place matches.
const RULES = [
  [/\.set_[a-z_]+$/, 'optional', 'a PATCH field\'s presence: only the fields present change'],
  [/\.(priced|expires|used|revoked|archived|connected|beating|ends|budgeted|anchored)$/, 'optional', 'the null of the field beside it'],
  [/\.(created_by|principal|exhausted_until|output_tokens_before_failure|quantization)$/, 'optional', 'a field the api leaves null or absent for now'],
  [/List\.data\[\]\.(secret|enrollment_token)$/, 'wire', 'the list shares the type of the create answer; the wire leaves the secret out'],
  [/^(Model|ModelList)\b/, 'wire', 'the caller\'s model nests voice\'s fields under `voice`, and lists say `object`'],
  [/^(Budget|ProjectCreate\.budget)\./, 'wire', 'a budget is its BudgetSet flattened into it on the wire'],
  [/^Registered\.nats/, 'wire', '`nats` is an object of url and subject on the wire'],
  [/(VoiceExtension|Served\.voice)\.(wall_ms|timing)$/, 'wire', 'the timing is an object of wall, queue and load on the wire'],
  [/^Health\.(checks|store)$/, 'map', '`checks` is a map of dependency to state'],
  [/^Capabilities\.(project_id|project_name|key_id|key_name|project|key)$/, 'wire', 'the project and the key are objects of id and name on the wire'],
  [/^ApiError\.(kind|type)$/, 'wire', 'the row\'s `kind` is the envelope\'s `type`, renamed by the wire (error_json)'],
  [/^ApiError\.status$/, 'wire', 'the HTTP status the error answers with, not a field of the envelope'],
  [/^BudgetRequest\.(set|allowance_micros|currency|period|period_anchor)$/, 'wire', 'the body is the BudgetSet, which the row carries under `set`'],
];
// Places whose every gap is the wire's, whatever the field: the standard
// request and response, which pass through as JSON text. `Served.voice`
// is the typed VoiceExtension, and is compared.
const WHOLE = [
  [/^(Served\.(?!voice\b)|InferenceRequest\.)/, 'the standard request and response pass through as JSON text (`body`, `response`)'],
];
// Kinds a rule may class; any other that no rule classes fails.
const RULED = new Set(['missing', 'extra', 'type', 'over-required']);
function reclass(at, kind) {
  for (const [re, why] of WHOLE) if (re.test(at)) return { kind: 'wire', why };
  if (!RULED.has(kind)) return { kind };
  for (const [re, k, why, only] of RULES) if ((!only || only === kind) && re.test(at)) return { kind: k, why };
  return { kind };
}
const committed = fs.existsSync(gapsPath) ? JSON.parse(fs.readFileSync(gapsPath, 'utf8')) : { gaps: [] };
const reasons = new Map(committed.gaps.map(g => [g.at, g]));
const found = gaps.map(g => {
  const r = reclass(g.at, g.kind);
  return { at: g.at, found: g.kind, kind: r.kind, waits_on: WAITS_ON[r.kind] || 'unclassed: say what closes it', ...(r.why ? { why: r.why } : {}) };
}).sort((a, b) => a.at.localeCompare(b.at));

if (mode === '--write') {
  const counts = {};
  for (const g of found) counts[g.kind] = (counts[g.kind] || 0) + 1;
  fs.writeFileSync(gapsPath, JSON.stringify({ note: 'Written by spec/validate/bundle.mjs --write; every gap between the exported Voice surface and spec/openapi.yaml, classed by what closes it.', counts, gaps: found }, null, 2) + '\n');
  console.log(`${found.length} gaps written`, counts);
  process.exit(0);
}

let fails = 0;
const committedAt = new Set(committed.gaps.map(g => g.at));
const foundAt = new Set(found.map(g => g.at));
for (const g of found) {
  if (!committedAt.has(g.at)) { fails++; console.log('NEW GAP', g.at, g.found); }
  else if (reasons.get(g.at).found !== g.found) { fails++; console.log('CHANGED', g.at, reasons.get(g.at).found, '->', g.found); }
}
for (const g of committed.gaps) if (!foundAt.has(g.at)) { fails++; console.log('CLOSED, still listed', g.at, g.kind); }
for (const g of found) if (!(g.kind in WAITS_ON)) { fails++; console.log('UNCLASSED', g.at, g.kind); }
for (const n of unaccounted) { fails++; console.log('NOT COMPARED, and no reason given', n); }
for (const n of stale) { fails++; console.log('NOT_COMPARED lists what is compared or gone', n); }
const counts = {};
for (const g of found) counts[g.kind] = (counts[g.kind] || 0) + 1;
console.log(`${found.length} gaps, all committed and classed:`, fails === 0, counts);
process.exit(fails ? 1 : 0);
