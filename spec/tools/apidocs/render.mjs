// render.mjs BUNDLE.json SOURCE OUT.md: an OpenAPI document, bundled by the
// pinned redocly (every $ref internal), as a Markdown reference that reads
// on GitHub: the document's own prose, how a caller authenticates, then each
// tag's operations in the document's order (parameters, request body,
// responses, each schema's fields), then every schema, each linked where it
// is used. The same document always gives the same bytes. No dependencies.
import fs from 'node:fs';

const [bundlePath, source, outPath] = process.argv.slice(2);
if (!bundlePath || !source || !outPath) {
  console.error('usage: render.mjs BUNDLE.json SOURCE OUT.md');
  process.exit(2);
}
const doc = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const schemas = doc.components?.schemas ?? {};
const METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'];
// how deep an inline object's fields are listed under its parent
const DEPTH = 3;

const out = [];
const line = (s = '') => out.push(s);

// a component's anchor: explicit, so a link never depends on how GitHub
// slugs a heading
const anchor = name => 'schema-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const refName = ref => ref.split('/').pop();
const resolve = (obj, kind) => {
  if (!obj?.$ref) return obj;
  const name = refName(obj.$ref);
  return doc.components?.[kind]?.[name] ?? obj;
};
// one table cell: one line, no pipes
const cell = s => String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
const code = s => '`' + String(s).replace(/`/g, "'") + '`';

/** A schema's type, written short: a link for a named schema. */
function typeOf(s) {
  if (!s || typeof s !== 'object') return '';
  if (s.$ref) {
    const n = refName(s.$ref);
    return `[${n}](#${anchor(n)})`;
  }
  if (s.const !== undefined) return code(JSON.stringify(s.const));
  for (const k of ['oneOf', 'anyOf']) {
    if (Array.isArray(s[k])) return s[k].map(typeOf).filter(Boolean).join(' \\| ');
  }
  if (Array.isArray(s.allOf)) {
    // a part that only says something (a description, a title) adds no type
    const typed = s.allOf.filter(p => p.$ref || p.type || p.properties || p.items || p.enum || p.oneOf || p.anyOf || p.allOf || p.const !== undefined);
    return typed.map(typeOf).filter(Boolean).join(' & ') || 'any';
  }
  let t = Array.isArray(s.type) ? s.type.join(' \\| ') : s.type;
  if (t === 'array' || (s.items && !t)) {
    const inner = typeOf(s.items);
    t = inner ? `array of ${inner}` : 'array';
  } else if (!t && s.properties) {
    t = 'object';
  }
  if (Array.isArray(s.enum)) {
    t = `${t ?? 'value'}, one of ${s.enum.map(v => code(v === null ? 'null' : v)).join(', ')}`;
  }
  if (s.format) t = `${t} (${s.format})`;
  return t ?? 'any';
}

/** A field's description: its own, else the first its alternatives give. */
function describe(s) {
  if (!s || typeof s !== 'object') return '';
  if (s.description) return s.description;
  for (const k of ['anyOf', 'oneOf', 'allOf']) {
    for (const part of s[k] ?? []) {
      if (!part.$ref && part.description) return part.description;
    }
  }
  return '';
}

/** Notes beyond the type: default, bounds, pattern. */
function notes(s) {
  const n = [];
  if (!s || typeof s !== 'object') return '';
  if (s.default !== undefined) n.push(`default ${code(JSON.stringify(s.default))}`);
  for (const [k, w] of [['minimum', '≥'], ['maximum', '≤'], ['minLength', 'length ≥'], ['maxLength', 'length ≤'], ['minItems', 'items ≥'], ['maxItems', 'items ≤']]) {
    if (s[k] !== undefined) n.push(`${w} ${s[k]}`);
  }
  if (s.pattern) n.push(`pattern ${code(s.pattern)}`);
  if (s.readOnly) n.push('read-only');
  if (s.deprecated) n.push('deprecated');
  return n.join('; ');
}

/** The inline object a field holds, if any, whose fields are listed below it. */
function inlineObject(s) {
  if (!s || s.$ref) return null;
  if (s.properties) return s;
  if (s.items && !s.items.$ref && s.items.properties) return s.items;
  return null;
}

/** A schema's fields as table rows, inline objects' fields indented below. */
function fieldRows(s, prefix, depth, rows) {
  if (!s || typeof s !== 'object') return rows;
  const parts = Array.isArray(s.allOf) ? s.allOf : [s];
  for (const part of parts) {
    if (part.$ref && Array.isArray(s.allOf)) {
      rows.push([`${prefix}…`, `all of ${typeOf(part)}`, '', '', '']);
      continue;
    }
    const required = new Set(part.required ?? []);
    for (const [name, f] of Object.entries(part.properties ?? {})) {
      const path = prefix + name;
      rows.push([code(path), typeOf(f), required.has(name) ? 'yes' : '', cell(describe(f)), cell(notes(f))]);
      const inner = inlineObject(f);
      if (inner && depth < DEPTH) fieldRows(inner, path + (f.items === inner ? '[].' : '.'), depth + 1, rows);
    }
  }
  return rows;
}

function fieldTable(s) {
  const rows = fieldRows(s, '', 1, []);
  if (!rows.length) return false;
  line('| Field | Type | Required | Description | Notes |');
  line('|---|---|---|---|---|');
  for (const r of rows) line(`| ${r.join(' | ')} |`);
  line();
  return true;
}

/** A body's schema: its type, and the fields of the object it is. */
function bodySchema(schema) {
  line(`Schema: ${typeOf(schema)}`);
  line();
  const target = schema?.$ref ? schemas[refName(schema.$ref)] : schema;
  if (target && (target.properties || target.allOf)) fieldTable(target);
}

// --- the document --------------------------------------------------------

const info = doc.info ?? {};
line(`<!-- Generated from ${source} by spec/tools/apidocs/render.mjs. Do not edit: run spec/tools/apidocs.sh. -->`);
line();
line(`# ${info.title ?? 'API'} ${info.version ? `(${info.version})` : ''}`.trim());
line();
line(`> Generated from [\`${source}\`](../../${source}), the contract. Regenerate with \`spec/tools/apidocs.sh\`; CI fails when this file and the contract differ.`);
line();
if (info.summary) {
  line(info.summary);
  line();
}
if (info.description) {
  line(info.description.trim());
  line();
}

const tags = doc.tags ?? [];
const opsByTag = new Map(tags.map(t => [t.name, []]));
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const tag = op.tags?.[0] ?? 'other';
    if (!opsByTag.has(tag)) opsByTag.set(tag, []);
    opsByTag.get(tag).push({ path, method: m, op, shared: item.parameters ?? [] });
  }
}

line('## Contents');
line();
for (const [tag, ops] of opsByTag) {
  if (ops.length) line(`- [${tag}](#tag-${anchor(tag).slice(7)}) (${ops.length})`);
}
line('- [Schemas](#schemas)');
line();

const schemes = doc.components?.securitySchemes ?? {};
if (Object.keys(schemes).length) {
  line('## Authentication');
  line();
  for (const [name, s] of Object.entries(schemes)) {
    line(`- **${name}** (${[s.type, s.scheme, s.in, s.name].filter(Boolean).join(', ')}): ${cell(s.description)}`);
  }
  line();
}
if (doc.servers?.length) {
  line('## Servers');
  line();
  for (const s of doc.servers) line(`- ${code(s.url)}${s.description ? `: ${cell(s.description)}` : ''}`);
  line();
}

const security = op => {
  const req = op.security ?? doc.security ?? [];
  if (!req.length) return 'none';
  return req.map(r => Object.keys(r).join(' and ') || 'none').join(', or ');
};

for (const [tag, ops] of opsByTag) {
  if (!ops.length) continue;
  const t = tags.find(x => x.name === tag);
  line(`<a id="tag-${anchor(tag).slice(7)}"></a>`);
  line();
  line(`## ${tag}`);
  line();
  if (t?.description) {
    line(t.description.trim());
    line();
  }
  for (const { path, method, op, shared } of ops) {
    line(`### ${method.toUpperCase()} ${code(path)}`);
    line();
    if (op.summary) line(`**${op.summary.trim()}**${op.operationId ? ` · ${code(op.operationId)}` : ''}${op.deprecated ? ' · deprecated' : ''}`);
    line();
    line(`Authentication: ${security(op)}`);
    line();
    if (op.description) {
      line(op.description.trim());
      line();
    }
    const params = [...shared, ...(op.parameters ?? [])].map(p => resolve(p, 'parameters'));
    if (params.length) {
      line('Parameters:');
      line();
      line('| Name | In | Type | Required | Description |');
      line('|---|---|---|---|---|');
      for (const p of params) {
        line(`| ${code(p.name)} | ${p.in} | ${typeOf(p.schema)} | ${p.required ? 'yes' : ''} | ${cell(p.description || describe(p.schema))} |`);
      }
      line();
    }
    const body = resolve(op.requestBody, 'requestBodies');
    if (body?.content) {
      line(`Request body${body.required ? '' : ' (optional)'}${body.description ? `: ${cell(body.description)}` : ''}`);
      line();
      for (const [type, c] of Object.entries(body.content)) {
        line(`${code(type)}`);
        line();
        if (c.schema) bodySchema(c.schema);
      }
    }
    const responses = Object.entries(op.responses ?? {});
    if (responses.length) {
      line('Responses:');
      line();
      line('| Status | Description | Body |');
      line('|---|---|---|');
      for (const [status, r0] of responses) {
        const r = resolve(r0, 'responses');
        const bodies = Object.entries(r.content ?? {}).map(([type, c]) => `${code(type)} ${typeOf(c.schema)}`.trim());
        line(`| ${status} | ${cell(r.description)} | ${bodies.join('<br>')} |`);
      }
      line();
    }
  }
}

line('<a id="schemas"></a>');
line();
line('## Schemas');
line();
for (const [name, s] of Object.entries(schemas)) {
  line(`<a id="${anchor(name)}"></a>`);
  line();
  line(`### ${name}`);
  line();
  if (s.description) {
    line(s.description.trim());
    line();
  }
  line(`Type: ${typeOf({ ...s, description: undefined, ...(s.properties ? { type: s.type ?? 'object' } : {}) })}`);
  line();
  const n = notes(s);
  if (n) {
    line(`Notes: ${n}`);
    line();
  }
  fieldTable(s);
}

fs.writeFileSync(outPath, out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
