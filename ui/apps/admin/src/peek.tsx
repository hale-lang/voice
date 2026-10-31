import { useState, type ReactNode } from 'react';
import { Button } from '@hale/components';
import { useGet } from './api/client';
import s from './peek.module.css';

type Item = {
  type?: string;
  role?: string;
  content?: unknown;
  summary?: unknown;
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: unknown;
  text?: string;
};

/**
 * A request's recording, when its project or key peeks (set on Projects):
 * the request as it was served and its final response, reasoning included,
 * kept seven days. Read as a conversation, each part of it a section of its
 * own, folded but for the last thing the caller said and what the model
 * answered; or as the raw JSON.
 */
export function PeekSection({ id }: { id: string }) {
  const q = useGet('/admin/v1/peeks/{request_id}', { params: { path: { request_id: id } } });
  const [raw, setRaw] = useState(false);
  if (q.isPending) return null;
  // none: its project and key did not peek, or it is past seven days
  if (q.isError) return <p className="faint">Not recorded: peek is off for its project and key, or it is past seven days.</p>;
  const p = q.data;
  const input = parse(p.input);
  const output = parse(p.output);
  const asked = (Array.isArray(input?.input) ? input.input : typeof input?.input === 'string' ? [{ type: 'message', role: 'user', content: input.input }] : []) as Item[];
  const answered = (Array.isArray(output?.output) ? output.output : []) as Item[];
  // the last thing the caller said opens; the rest of what it sent is folded
  let lastUser = -1;
  asked.forEach((it, i) => {
    if (it.role === 'user') lastUser = i;
  });
  const failure = typeof output?.error === 'string' ? output.error : null;
  return (
    <section className={s.peek}>
      <div className={s.head}>
        <h3>Conversation</h3>
        <span className="faint">
          {asked.length} {asked.length === 1 ? 'part' : 'parts'} asked · {answered.length} answered
        </span>
        <span className={s.spacer} />
        <Button onClick={() => setRaw(!raw)}>{raw ? 'as a conversation' : 'raw JSON'}</Button>
      </div>
      {raw ? (
        <>
          <Fold title="request" open>
            <pre className={s.pre}>{pretty(p.input)}</pre>
          </Fold>
          <Fold title="response" open>
            <pre className={s.pre}>{pretty(p.output)}</pre>
          </Fold>
        </>
      ) : (
        <>
          {typeof input?.instructions === 'string' && <Fold title="instructions" preview={input.instructions} kind="system" body={input.instructions} />}
          {asked.map((it, i) => (
            <ItemView key={i} item={it} open={i === lastUser} />
          ))}
          <div className={s.answer}>
            <div className={s.answerLabel}>response{typeof output?.status === 'string' ? ` · ${output.status}` : ''}</div>
            {failure && <p className="c-fail">{failure}</p>}
            {answered.length ? answered.map((it, i) => <ItemView key={i} item={it} open={it.type !== 'reasoning'} />) : !failure && <p className="faint">no output</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** One part of the conversation, folded or open. */
function ItemView({ item, open }: { item: Item; open: boolean }) {
  if (item.type === 'reasoning') {
    const t = texts(item.content) || texts(item.summary);
    return <Fold title="reasoning" kind="reasoning" preview={t} body={t} open={open} />;
  }
  if (item.type === 'function_call') {
    return <Fold title={`tool call · ${item.name ?? 'function'}`} kind="tool" preview={item.arguments ?? ''} body={<pre className={s.pre}>{prettyText(item.arguments ?? '')}</pre>} open={open} />;
  }
  if (item.type === 'function_call_output') {
    const out = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
    return <Fold title="tool output" kind="tool" preview={out} body={<pre className={s.pre}>{out}</pre>} open={open} />;
  }
  const role = item.role ?? item.type ?? 'item';
  const t = texts(item.content) || item.text || '';
  return <Fold title={role} kind={role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system'} preview={t} body={t} open={open} />;
}

/**
 * A section that shows its title, a line of what it holds and its size when
 * folded, and its body only once opened: a long prompt is not laid out
 * until it is read.
 */
function Fold(props: { title: string; kind?: string; preview?: string; body?: ReactNode; open?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(!!props.open);
  const preview = (props.preview ?? '').replace(/\s+/g, ' ').trim();
  return (
    <div className={`${s.fold} ${props.kind ? s[props.kind] ?? '' : ''}`}>
      <button type="button" className={s.foldHead} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={s.chevron}>{open ? '▾' : '▸'}</span>
        <span className={s.title}>{props.title}</span>
        {!open && preview && <span className={s.preview}>{preview.slice(0, 160)}</span>}
        {props.preview != null && <span className={s.size}>{size(props.preview)}</span>}
      </button>
      {open && <div className={s.body}>{props.children ?? (typeof props.body === 'string' ? <div className={s.text}>{props.body}</div> : props.body)}</div>}
    </div>
  );
}

/** About how many tokens a text is (four characters a token). */
function size(t: string): string {
  const n = Math.ceil(t.length / 4);
  return n >= 1000 ? `~${(n / 1000).toFixed(1)}k tokens` : `~${n} tokens`;
}

/** The text of a content value: a string, or the `text` of each part. */
function texts(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).filter(Boolean).join('\n');
  return '';
}

function parse(t: string): Record<string, unknown> | null {
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pretty(t: string): string {
  const v = parse(t);
  return v ? JSON.stringify(v, null, 2) : t;
}

/** A tool call's arguments, laid out when they are JSON. */
function prettyText(t: string): string {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}
