import { useState } from 'react';
import { Button } from '@hale/components';
import { useGet } from './api/client';

type Item = { type?: string; role?: string; content?: unknown; summary?: unknown; name?: string; arguments?: string; output?: unknown; text?: string };

/**
 * A request's recording, when its project or key peeks (set on Projects):
 * the request as it was served and its final response, reasoning included,
 * kept seven days. Shown in the Usage inspector of the request it is of.
 */
export function PeekSection({ id }: { id: string }) {
  const q = useGet('/admin/v1/peeks/{request_id}', { params: { path: { request_id: id } } });
  const [raw, setRaw] = useState(false);
  if (q.isPending) return null;
  // none: its project and key did not peek, or it is past seven days
  if (q.isError) return <p className="faint" style={{ marginTop: 'var(--space-4)' }}>Not recorded: peek is off for its project and key, or it is past seven days.</p>;
  const p = q.data;
  const input = parse(p.input);
  const output = parse(p.output);
  const asked = (Array.isArray(input?.input) ? input.input : typeof input?.input === 'string' ? [{ type: 'message', role: 'user', content: input.input }] : []) as Item[];
  const answered = (Array.isArray(output?.output) ? output.output : []) as Item[];
  return (
    <>
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
        Peek <Button onClick={() => setRaw(!raw)}>{raw ? 'as read' : 'raw JSON'}</Button>
      </h3>
      {raw ? (
        <>
          <h4>Request</h4>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty(p.input)}</pre>
          <h4>Response</h4>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty(p.output)}</pre>
        </>
      ) : (
        <>
          {typeof input?.instructions === 'string' && <Turn who="instructions" text={input.instructions} />}
          <h4>Asked</h4>
          {asked.map((it, i) => <ItemView key={i} item={it} />)}
          <h4>Answered</h4>
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
