import { useEffect, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Kv, Mono, Select, Button, when } from '@hale/components';
import { useGet } from '../api/client';
import type { ScreenProps } from '../App';
import { go } from '../route';
import { readout } from '../readout';

type Item = { type?: string; role?: string; content?: unknown; summary?: unknown; name?: string; arguments?: string; output?: unknown; text?: string };

/**
 * Peek: the requests recorded whole for a project or key that peeks (set on
 * Projects), newest first, kept seven days. A recording is the request as it
 * was served and the final response, reasoning included.
 */
export function Peek({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const [project, setProject] = useState('');
  const projects = useGet('/admin/v1/projects');
  const q = useGet('/admin/v1/peeks', { params: { query: { limit: 100, ...(project ? { project } : {}) } } });
  useEffect(() => {
    setInspector(selected ? <PeekInspector id={selected} /> : null);
  }, [selected, setInspector]);
  const peeking = (projects.data?.data ?? []).filter((p) => p.peek);
  return (
    <>
      <h1>Peek</h1>
      <Panel title="Recorded requests" readout={readout(q, q.data ? `${q.data.data.length} recorded` : null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          A project or key that peeks has each request it sends recorded whole, kept seven days. Turn it on in a project's inspector, or per key.
          {peeking.length ? <> Peeking now: {peeking.map((p) => <Mono key={p.id}>{p.id} </Mono>)}</> : null}
        </p>
        <div style={{ maxWidth: 280, marginBottom: 'var(--space-3)' }}>
          <Select value={project} onChange={setProject} options={[{ value: '', label: 'every project' }, ...(projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.id }))]} />
        </div>
        {q.isPending ? (
          <Loading what="recordings" />
        ) : q.isError ? (
          <Unavailable what="Recordings" detail={q.error.message} />
        ) : (
          <Table
            rows={q.data.data}
            rowKey={(r) => r.request_id}
            selectedKey={selected}
            onSelect={(r) => go('peek', r.request_id)}
            columns={[
              { key: 'at', header: 'When', render: (r) => when(r.created_at) },
              { key: 'project', header: 'Project', render: (r) => <Mono>{r.project}</Mono> },
              { key: 'key', header: 'Key', render: (r) => <Mono>{r.key}</Mono> },
              { key: 'model', header: 'Model', render: (r) => <Mono>{r.model}</Mono> },
              { key: 'id', header: 'Request', render: (r) => <Mono>{r.request_id}</Mono> },
            ]}
            empty="Nothing recorded. A project or key records once it peeks."
          />
        )}
      </Panel>
    </>
  );
}

function PeekInspector({ id }: { id: string }) {
  const q = useGet('/admin/v1/peeks/{request_id}', { params: { path: { request_id: id } } });
  const [raw, setRaw] = useState(false);
  if (q.isPending) return <Loading what="the recording" />;
  if (q.isError) return <Unavailable what="The recording" detail={q.error.message} />;
  const p = q.data;
  const input = parse(p.input);
  const output = parse(p.output);
  const asked = (Array.isArray(input?.input) ? input.input : typeof input?.input === 'string' ? [{ type: 'message', role: 'user', content: input.input }] : []) as Item[];
  const answered = (Array.isArray(output?.output) ? output.output : []) as Item[];
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{p.request_id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'when', v: when(p.created_at) },
          { k: 'project', v: <a href={`#/projects/${p.project}`}><Mono>{p.project}</Mono></a> },
          { k: 'key', v: <Mono>{p.key}</Mono> },
          { k: 'model', v: <Mono>{p.model}</Mono> },
          { k: 'status', v: String(output?.status ?? '–') },
        ]}
      />
      <p><Button onClick={() => setRaw(!raw)}>{raw ? 'as read' : 'raw JSON'}</Button></p>
      {raw ? (
        <>
          <h3>Request</h3>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty(p.input)}</pre>
          <h3>Response</h3>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty(p.output)}</pre>
        </>
      ) : (
        <>
          {typeof input?.instructions === 'string' && <Turn who="instructions" text={input.instructions} />}
          <h3>Asked</h3>
          {asked.map((it, i) => <ItemView key={i} item={it} />)}
          <h3>Answered</h3>
          {answered.length ? answered.map((it, i) => <ItemView key={i} item={it} />) : <p className="faint">no output</p>}
        </>
      )}
    </>
  );
}

function ItemView({ item }: { item: Item }) {
  if (item.type === 'reasoning') return <Turn who="reasoning" text={texts(item.content) || texts(item.summary)} muted />;
  if (item.type === 'function_call') return <Turn who={`calls ${item.name ?? ''}`} text={item.arguments ?? ''} mono />;
  if (item.type === 'function_call_output') return <Turn who="tool output" text={typeof item.output === 'string' ? item.output : JSON.stringify(item.output)} mono />;
  return <Turn who={item.role ?? item.type ?? 'item'} text={texts(item.content) || item.text || ''} />;
}

function Turn({ who, text, muted, mono }: { who: string; text: string; muted?: boolean; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div className="faint" style={{ fontSize: '0.85em' }}>{who}</div>
      <div className={[muted ? 'muted' : '', mono ? 'mono' : ''].join(' ')} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</div>
    </div>
  );
}

/** The text of a content value: a string, or the `text` of each part. */
function texts(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).filter(Boolean).join('\n');
  return '';
}

function parse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pretty(s: string): string {
  const v = parse(s);
  return v ? JSON.stringify(v, null, 2) : s;
}
