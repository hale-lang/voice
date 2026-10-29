import { Fragment, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono } from '@hale/components';
import type { ScreenProps } from '../App';
import { go, href } from '../route';

/**
 * Voice's own API, as its contract says it: spec/openapi.yaml, bundled into
 * `/openapi.json` when the UI was built (scripts/contract.mjs), so what this
 * shows is the contract this voice was built with. Operations by tag, each
 * with what it takes and answers; a schema named by `$ref` is a page of its own.
 */

type Json = Record<string, unknown>;
type Schema = Json & { $ref?: string };
type Doc = {
  security?: Json[];
  info: { title: string; version: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Json>>;
  components?: { schemas?: Record<string, Schema>; parameters?: Record<string, Json>; responses?: Record<string, Json>; securitySchemes?: Record<string, Json> };
};
type Operation = { id: string; method: string; path: string; tag: string; op: Json; shared: Json[] };

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function useContract() {
  return useQuery({
    queryKey: ['/openapi.json'],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch('/openapi.json');
      if (!r.ok) throw new Error(`/openapi.json: ${r.status}`);
      return (await r.json()) as Doc;
    },
  });
}

function operations(doc: Doc): Operation[] {
  const out: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const id = (op.operationId as string | undefined) ?? `${method}-${path}`;
      // the path item's parameters apply to each of its operations
      out.push({ id, method, path, tag: ((op.tags as string[] | undefined) ?? ['other'])[0]!, op, shared: (item.parameters as unknown as Json[] | undefined) ?? [] });
    }
  }
  return out;
}

/** A `#/components/<kind>/<Name>` reference, followed. */
function resolve<T>(doc: Doc, v: T): T {
  const ref = (v as Schema | undefined)?.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return v;
  let at: unknown = doc;
  for (const part of ref.slice(2).split('/')) at = (at as Json | undefined)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  return (at ?? v) as T;
}

const refName = (ref: string) => ref.split('/').pop() ?? ref;

export function Api({ route, setInspector }: ScreenProps) {
  const q = useContract();
  const [kind, name] = [route.parts[1], route.parts[2]];
  useEffect(() => setInspector(null), [kind, name, setInspector]);
  const ops = useMemo(() => (q.data ? operations(q.data) : []), [q.data]);

  if (q.isPending) return <Loading what="the API's contract" />;
  if (q.isError) return <Unavailable what="The API's contract" detail={q.error.message} />;
  const doc = q.data;

  if (kind === 'op') {
    const op = ops.find((o) => o.id === name);
    return op ? <OperationPage doc={doc} op={op} /> : <Missing what={`operation ${name}`} />;
  }
  if (kind === 'schema') {
    const schema = doc.components?.schemas?.[name ?? ''];
    return schema ? <SchemaPage doc={doc} name={name!} schema={schema} /> : <Missing what={`schema ${name}`} />;
  }
  return <Index doc={doc} ops={ops} />;
}

function Index({ doc, ops }: { doc: Doc; ops: Operation[] }) {
  const tags = doc.tags ?? [];
  const named = new Set(tags.map((t) => t.name));
  const groups = [...tags, ...[...new Set(ops.map((o) => o.tag))].filter((t) => !named.has(t)).map((name) => ({ name, description: undefined }))];
  return (
    <>
      <h1>API</h1>
      <Panel title={doc.info.title} readout={`${ops.length} operations · ${doc.info.version}`}>
        {doc.info.description && <Overview text={doc.info.description} />}
        <p className="muted" style={{ marginBottom: 0 }}>
          The contract this voice was built with: <a href="/openapi.json">openapi.json</a>.
        </p>
      </Panel>
      {groups.map((t) => {
        const here = ops.filter((o) => o.tag === t.name);
        if (!here.length) return null;
        return (
          <Panel key={t.name} title={t.name} readout={`${here.length} operations`}>
            {t.description && <Prose text={t.description} />}
            <Table<Operation>
              rows={here}
              rowKey={(o) => o.id}
              onSelect={(o) => go('api', 'op', o.id)}
              columns={[
                { key: 'm', header: 'Method', render: (o) => <Mono>{o.method.toUpperCase()}</Mono> },
                { key: 'p', header: 'Path', render: (o) => <Mono>{o.path}</Mono> },
                { key: 's', header: 'Summary', wrap: true, render: (o) => (o.op.summary as string | undefined) ?? '' },
                { key: 'a', header: 'Takes', render: (o) => auth(doc, o.op) },
              ]}
            />
          </Panel>
        );
      })}
    </>
  );
}

/** The contract's overview: its first paragraph, the rest behind a disclosure. */
function Overview({ text }: { text: string }) {
  const cut = text.indexOf('\n\n');
  if (cut < 0) return <Prose text={text} />;
  return (
    <>
      <Prose text={text.slice(0, cut)} />
      <details>
        <summary className="muted">the rest of the overview: planes, nodes, routing, errors</summary>
        <Prose text={text.slice(cut + 2)} />
      </details>
    </>
  );
}

/** What an operation's caller presents: its security schemes, by name. */
function auth(doc: Doc, op: Json): ReactNode {
  // an operation's own, else the document's (an empty list is none)
  const sec = (op.security as Json[] | undefined) ?? doc.security ?? [];
  if (!sec.length || sec.every((s) => Object.keys(s).length === 0)) return 'nothing';
  return sec.flatMap((s) => Object.keys(s)).map((k, i) => {
    const d = doc.components?.securitySchemes?.[k]?.description as string | undefined;
    const first = d ? d.replace(/\s+/g, ' ').match(/^(.*?\.)(\s|$)/)?.[1] ?? d : k;
    return <Fragment key={k}>{i > 0 && ' or '}{spans(first)}</Fragment>;
  });
}

function OperationPage({ doc, op }: { doc: Doc; op: Operation }) {
  const o = op.op;
  // the path's parameters, then the operation's, which replace a path's of
  // the same name and place (OpenAPI's path item)
  const own = ((o.parameters as Json[] | undefined) ?? []).map((p) => resolve(doc, p));
  const key = (p: Json) => `${p.in}:${p.name}`;
  const params = [...op.shared.map((p) => resolve(doc, p)).filter((p) => !own.some((x) => key(x) === key(p))), ...own];
  const body = resolve(doc, o.requestBody as Json | undefined);
  const bodyContent = (body?.content as Record<string, Json> | undefined) ?? {};
  const responses = Object.entries((o.responses as Record<string, Json> | undefined) ?? {});
  return (
    <>
      <p className="faint" style={{ fontSize: 'var(--size-xs)' }}><a href={href('api')}>API</a> · {op.tag}</p>
      <h1><Mono>{op.method.toUpperCase()} {op.path}</Mono></h1>
      <Panel title={(o.summary as string | undefined) ?? op.id} readout={op.id}>
        {typeof o.description === 'string' && <Prose text={o.description} />}
        <Kv rows={[{ k: 'takes', v: auth(doc, o) }]} />
      </Panel>
      {params.length > 0 && (
        <Panel title="Parameters">
          <Table<Json>
            rows={params}
            rowKey={(p) => `${p.in}:${p.name}`}
            columns={[
              { key: 'n', header: 'Name', render: (p) => <Mono>{p.name as string}</Mono> },
              { key: 'i', header: 'In', render: (p) => p.in as string },
              { key: 't', header: 'Type', wrap: true, render: (p) => <Cell narrow><TypeOf doc={doc} schema={p.schema as Schema | undefined} /></Cell> },
              { key: 'r', header: 'Required', render: (p) => (p.required ? 'yes' : 'no') },
              { key: 'd', header: 'Description', wrap: true, render: (p) => (typeof p.description === 'string' ? <Cell><Prose text={p.description} inline /></Cell> : '') },
            ]}
          />
        </Panel>
      )}
      {Object.keys(bodyContent).length > 0 && (
        <Panel title="Request body" readout={Object.keys(bodyContent).join(', ')}>
          {typeof body?.description === 'string' && <Prose text={body.description} />}
          {Object.entries(bodyContent).map(([type, c]) => (
            <Expanded key={type} doc={doc} schema={c.schema as Schema | undefined} />
          ))}
        </Panel>
      )}
      <Panel title="Responses" readout={`${responses.length}`}>
        {responses.map(([code, raw]) => {
          const r = resolve(doc, raw);
          const content = (r.content as Record<string, Json> | undefined) ?? {};
          return (
            <div key={code} style={{ marginBottom: 'var(--space-3)' }}>
              <h3 style={{ margin: 'var(--space-2) 0' }}><Mono>{code}</Mono> <span className="muted">{Object.keys(content).join(', ')}</span></h3>
              {typeof r.description === 'string' && <Prose text={r.description} />}
              {Object.entries(content).map(([type, c]) =>
                code.startsWith('2') ? <Expanded key={type} doc={doc} schema={c.schema as Schema | undefined} /> : <SchemaBlock key={type} doc={doc} schema={c.schema as Schema | undefined} />,
              )}
            </div>
          );
        })}
      </Panel>
    </>
  );
}

function SchemaPage({ doc, name, schema }: { doc: Doc; name: string; schema: Schema }) {
  const users = useMemo(() => operations(doc).filter((o) => JSON.stringify(o.op).includes(`/schemas/${name}"`)), [doc, name]);
  return (
    <>
      <p className="faint" style={{ fontSize: 'var(--size-xs)' }}><a href={href('api')}>API</a> · schema</p>
      <h1><Mono>{name}</Mono></h1>
      <Panel title="Schema">
        {typeof schema.description === 'string' && <Prose text={schema.description} />}
        <SchemaBlock doc={doc} schema={schema} top />
      </Panel>
      {users.length > 0 && (
        <Panel title="Used by" readout={`${users.length} operations`}>
          {users.map((o) => <div key={o.id}><a href={href('api', 'op', o.id)}><Mono>{o.method.toUpperCase()} {o.path}</Mono></a></div>)}
        </Panel>
      )}
    </>
  );
}

/** A schema named by reference, its fields shown here as well as on its page. */
function Expanded({ doc, schema }: { doc: Doc; schema: Schema | undefined }) {
  if (!schema || typeof schema.$ref !== 'string') return <SchemaBlock doc={doc} schema={schema} />;
  return (
    <>
      <p><TypeOf doc={doc} schema={schema} /></p>
      <SchemaBlock doc={doc} schema={resolve(doc, schema)} top />
    </>
  );
}

/** A schema's type in a word or two, a named one as a link to its page. */
function TypeOf({ doc, schema }: { doc: Doc; schema: Schema | undefined }): ReactNode {
  if (!schema) return <span className="faint">any</span>;
  if (typeof schema.$ref === 'string') {
    const n = refName(schema.$ref);
    return schema.$ref.startsWith('#/components/schemas/') ? <a href={href('api', 'schema', n)}><Mono>{n}</Mono></a> : <Mono>{n}</Mono>;
  }
  for (const k of ['oneOf', 'anyOf'] as const) {
    const alts = schema[k] as Schema[] | undefined;
    if (alts) return <>{alts.map((a, i) => <Fragment key={i}>{i > 0 && <span className="faint"> | </span>}<TypeOf doc={doc} schema={a} /></Fragment>)}</>;
  }
  if (schema.allOf) return <>{(schema.allOf as Schema[]).map((a, i) => <Fragment key={i}>{i > 0 && <span className="faint"> & </span>}<TypeOf doc={doc} schema={a} /></Fragment>)}</>;
  const t = schema.type;
  const types = Array.isArray(t) ? t : t ? [t] : [];
  const word = types.map((x) => (x === 'array' ? null : x)).filter(Boolean).join(' | ');
  if (types.includes('array')) {
    const rest = types.filter((x) => x !== 'array');
    return <><TypeOf doc={doc} schema={schema.items as Schema | undefined} /><span className="muted">[]</span>{rest.length ? <span className="muted"> | {rest.join(' | ')}</span> : null}</>;
  }
  const en = schema.enum as unknown[] | undefined;
  if (en) return <Mono>{en.map((e) => JSON.stringify(e)).join(' | ')}</Mono>;
  return <Mono>{word || (schema.properties ? 'object' : 'any')}{schema.format ? ` (${schema.format as string})` : ''}</Mono>;
}

/**
 * A schema shown whole: an object as its properties, each with its type,
 * whether it is required and what it means; an array as its items; anything
 * else as its type. A named schema is a link, never expanded here, so a
 * recursive one stops at its name.
 */
function SchemaBlock({ doc, schema, top }: { doc: Doc; schema: Schema | undefined; top?: boolean }): ReactNode {
  if (!schema) return null;
  if (typeof schema.$ref === 'string' && !top) return <p><TypeOf doc={doc} schema={schema} /></p>;
  if (schema.allOf) {
    // one table of every part's fields: a part named by reference is followed
    const parts = (schema.allOf as Schema[]).map((s) => resolve(doc, s));
    const merged: Schema = {
      ...schema,
      allOf: undefined,
      properties: Object.assign({}, ...parts.map((s) => (s.properties as Json | undefined) ?? {})),
      required: parts.flatMap((s) => (s.required as string[] | undefined) ?? []),
    };
    return <SchemaBlock doc={doc} schema={merged} top />;
  }
  const props = schema.properties as Record<string, Schema> | undefined;
  if (!props) {
    if (schema.type === 'array') return <p className="muted">a list of <TypeOf doc={doc} schema={schema.items as Schema} /></p>;
    return <p><TypeOf doc={doc} schema={schema} /></p>;
  }
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return (
    <Table<[string, Schema]>
      rows={Object.entries(props)}
      rowKey={([k]) => k}
      columns={[
        { key: 'n', header: 'Field', render: ([k]) => <Mono>{k}</Mono> },
        { key: 't', header: 'Type', wrap: true, render: ([, s]) => <Cell narrow><TypeOf doc={doc} schema={s} /></Cell> },
        { key: 'r', header: 'Required', render: ([k]) => (required.has(k) ? 'yes' : <span className="faint">no</span>) },
        { key: 'd', header: 'Description', wrap: true, render: ([, s]) => (typeof resolve(doc, s).description === 'string' && !s.$ref ? <Cell><Prose text={s.description as string} inline /></Cell> : '') },
      ]}
    />
  );
}

/** A table cell's description: it wraps anywhere, so a long code span never widens the table. */
function Cell({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div style={{ overflowWrap: 'anywhere', whiteSpace: 'normal', minWidth: narrow ? '6em' : '14em', maxWidth: narrow ? '18em' : '48em' }}>{children}</div>;
}

/**
 * A description's text: paragraphs, `- ` lists, fenced code, and inline
 * `code`, **bold** and [links](url), built as elements (never as HTML).
 */
function Prose({ text, inline }: { text: string; inline?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) { code.push(lines[i]!); i += 1; }
      i += 1;
      blocks.push(<pre key={blocks.length} style={{ overflowX: 'auto', maxWidth: '100%' }}><code>{code.join('\n')}</code></pre>);
    } else if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*] |\s{2,}\S)/.test(lines[i]!)) {
        if (/^\s*[-*] /.test(lines[i]!)) items.push(lines[i]!.replace(/^\s*[-*] /, ''));
        else items[items.length - 1] += ' ' + lines[i]!.trim();
        i += 1;
      }
      blocks.push(<ul key={blocks.length}>{items.map((t, j) => <li key={j}>{spans(t)}</li>)}</ul>);
    } else if (/^#{1,4} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const title = spans(line.replace(/^#+ /, ''));
      blocks.push(level <= 2 ? <h2 key={blocks.length} style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>{title}</h2> : <h3 key={blocks.length} style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>{title}</h3>);
      i += 1;
    } else if (line.trim() === '') {
      i += 1;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && !/^\s*[-*] /.test(lines[i]!) && !/^#{1,4} /.test(lines[i]!) && !lines[i]!.trim().startsWith('```')) { para.push(lines[i]!.trim()); i += 1; }
      blocks.push(inline ? <span key={blocks.length}>{spans(para.join(' '))} </span> : <p key={blocks.length}>{spans(para.join(' '))}</p>);
    }
  }
  return <>{blocks}</>;
}

/** Inline `code`, **bold** and [text](url). */
function spans(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<code key={out.length}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<b key={out.length}>{m[2]}</b>);
    else {
      const url = m[4]!;
      out.push(/^(https?:|#|\/)/.test(url) ? <a key={out.length} href={url} target={url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{m[3]}</a> : m[3]);
    }
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
