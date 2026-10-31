import { useMemo, useState, type ReactNode } from 'react';
import { Loading, Unavailable, Mono, Button, count, when } from '@hale/components';
import { useAllUsage, usePeeks, type UsageRecord } from '../api/client';
import { href } from '../route';
import { Fold, ItemView, texts, parse, type Item } from '../peek';
import s from './Conversation.module.css';

/** What a conversation is gathered by: its `prompt_cache_key`, or a metadata pair the caller set on each turn. */
export type Root = { conversation: string } | { metadata: string };

/** Turns shown at first, and more each time earlier ones are asked for. */
const STEP = 30;

/**
 * A conversation read whole: what set it up beside the back and forth.
 * The turns are the ledger's for its root, oldest first; each turn's
 * recording (when its project peeks) gives what was said. A client that
 * resends the history each turn (Codex) repeats what was said before, so
 * a part already shown is not shown again.
 */
export function ConversationView({ root }: { root: Root }) {
  const q = useAllUsage('conversation' in root ? { conversation: root.conversation } : { metadata: [root.metadata] });
  const [shown, setShown] = useState(STEP);
  const all = q.data?.turns ?? [];
  const turns = all.slice(Math.max(0, all.length - shown));
  const hidden = all.length - turns.length;
  const peeks = usePeeks(turns.map((t) => t.id));
  const loaded = peeks.every((p) => !p.isPending);
  const read = useMemo(
    () => (loaded ? thread(turns, peeks.map((p) => (p.data ? p.data : null)), hidden > 0) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, turns.map((t) => t.id).join(','), hidden],
  );
  const name = 'conversation' in root ? root.conversation : root.metadata;
  if (q.isPending) return <Loading what="the conversation" />;
  if (q.isError) return <Unavailable what="The conversation" detail={q.error.message} />;
  if (!all.length) return <p className="faint">No requests of {name}.</p>;
  const first = all[0]!;
  const last = all[all.length - 1]!;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-1)' }}>
        <Mono>{name}</Mono>
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {all.length} turn{all.length === 1 ? '' : 's'}
        {q.data.truncated ? ' (the latest 2000)' : ''} · {last.project} · {last.served?.model ?? last.requested_model} · {count(all.reduce((n, t) => n + t.input_tokens, 0))} in · {count(all.reduce((n, t) => n + t.output_tokens, 0))} out · {when(first.created_at)} → {when(last.created_at)}
      </p>
      {!read ? (
        <Loading what="what was said" />
      ) : (
        <div className={s.split}>
          <aside className={s.context}>
            <h3>Context</h3>
            {read.context.length || read.tools.length ? (
              <>
                {read.opening && (
                  <div className={s.opening}>
                    <div className={s.label}>opening prompt</div>
                    <div className={s.text}>{read.opening}</div>
                  </div>
                )}
                {read.context.map((c, i) => (
                  <div key={i}>{c}</div>
                ))}
                {read.tools.length > 0 && <Tools tools={read.tools} />}
              </>
            ) : (
              <p className="faint">Nothing recorded set it up.</p>
            )}
          </aside>
          <section className={s.chat}>
            {hidden > 0 && (
              <p className={s.more}>
                <Button onClick={() => setShown(shown + STEP)}>{Math.min(STEP, hidden)} earlier turns</Button> <span className="faint">{hidden} not shown</span>
              </p>
            )}
            {read.turns.map((t) => (
              <TurnView key={t.record.id} turn={t} />
            ))}
          </section>
        </div>
      )}
    </>
  );
}

type Tool = { name: string; description: string; parameters: unknown };

/** The tools the latest turn offered, each a line, its schema a click away. */
function Tools({ tools }: { tools: Tool[] }) {
  return (
    <div className={s.tools}>
      <div className={s.label}>tools · {tools.length}</div>
      {tools.map((t) => (
        <Fold key={t.name} title={t.name} kind="tool" preview={t.description} body={<pre className={s.pre}>{(t.description ? t.description + '\n\n' : '') + JSON.stringify(t.parameters ?? {}, null, 2)}</pre>} />
      ))}
    </div>
  );
}

type Turn = { record: UsageRecord; recorded: boolean; said: Item[]; earlier: Item[]; answered: Item[]; failure: string | null };

function TurnView({ turn: t }: { turn: Turn }) {
  const r = t.record;
  return (
    <div className={s.turn}>
      <a className={s.divider} href={href('usage', r.id)} title="the request">
        <span>{when(r.created_at)}</span>
        <span>{r.served?.seat ?? r.requested_model}</span>
        <span>{count(r.input_tokens)} in · {count(r.output_tokens)} out</span>
        {r.status !== 'served' && <span className="c-wait">{r.status}</span>}
      </a>
      {!t.recorded ? (
        <p className="faint">Not recorded: peek was off for it, or it is past seven days.</p>
      ) : (
        <>
          {t.earlier.length > 0 && (
            <Fold title={`earlier · ${t.earlier.length} parts said before the turns shown`} kind="system">
              {t.earlier.map((it, i) => (
                <Said key={i} item={it} />
              ))}
            </Fold>
          )}
          {t.said.map((it, i) => (
            <Said key={i} item={it} />
          ))}
          {t.failure && <p className="c-fail">{t.failure}</p>}
          {t.answered.map((it, i) => (
            <Said key={`a${i}`} item={it} />
          ))}
        </>
      )}
    </div>
  );
}

/** A part of the back and forth: what the user and the model said as bubbles, the rest a tight line. */
function Said({ item }: { item: Item }) {
  const text = (texts(item.content) || item.text || '').trim();
  if (item.type !== 'reasoning' && item.type !== 'function_call' && item.type !== 'function_call_output' && (item.role === 'user' || item.role === 'assistant') && text) {
    return <Bubble who={item.role}>{text}</Bubble>;
  }
  return <ItemView item={item} open={false} />;
}

/** Lines a message shows before the rest is a click away. */
const LINES = 14;

function Bubble({ who, children }: { who: 'user' | 'assistant'; children: string }) {
  const long = children.split('\n').length > LINES || children.length > LINES * 120;
  const [all, setAll] = useState(false);
  return (
    <div className={`${s.bubble} ${s[who]}`}>
      <div className={s.who}>{who}</div>
      <div className={`${s.text} ${long && !all ? s.clipped : ''}`}>{children}</div>
      {long && (
        <button type="button" className={s.all} onClick={() => setAll(!all)}>
          {all ? 'less' : `all of it · ${children.split('\n').length} lines`}
        </button>
      )}
    </div>
  );
}

// ---- reading the recordings ------------------------------------------

/** Who set the conversation up rather than took part in it: a developer or system message, or context a client wraps in a tag. */
function isContext(it: Item): boolean {
  if (it.role === 'developer' || it.role === 'system') return true;
  if (it.role === 'user' && (texts(it.content) || '').trim().startsWith('<')) return true;
  return false;
}

/** What makes two parts the same part, however a client resends it. */
function identity(it: Item & { id?: string }): string {
  if (it.type === 'function_call' || it.type === 'function_call_output') return `${it.type}:${it.call_id ?? it.id ?? ''}`;
  if (it.type === 'reasoning') return `reasoning:${texts(it.content) || texts(it.summary)}`;
  return `${it.role ?? it.type}:${texts(it.content) || it.text || ''}`;
}

type Thread = { context: ReactNode[]; tools: Tool[]; opening: string | null; turns: Turn[] };

/**
 * The turns as a thread: each one's parts not said before, then its answer.
 * The context is the latest recorded turn's (instructions, developer
 * messages, wrapped context, tools); the opening prompt the first thing the
 * user asked that the recordings hold. When earlier turns are not shown,
 * the first shown turn's history folds as what came before.
 */
function thread(turns: UsageRecord[], peeks: ({ input: string; output: string } | null)[], earlierHidden: boolean): Thread {
  const seen = new Set<string>();
  const out: Turn[] = [];
  let opening: string | null = null;
  let latest: Record<string, unknown> | null = null;
  turns.forEach((record, i) => {
    const p = peeks[i];
    if (!p) {
      out.push({ record, recorded: false, said: [], earlier: [], answered: [], failure: null });
      return;
    }
    const input = parse(p.input);
    const output = parse(p.output);
    latest = input ?? latest;
    const asked = (Array.isArray(input?.input) ? input.input : typeof input?.input === 'string' ? [{ type: 'message', role: 'user', content: input.input }] : []) as Item[];
    const fresh = asked.filter((it) => !isContext(it) && !seen.has(identity(it)));
    for (const it of asked) seen.add(identity(it));
    if (opening === null) {
      const u = asked.find((it) => it.role === 'user' && !isContext(it) && texts(it.content).trim());
      if (u) opening = texts(u.content).trim();
    }
    // the first turn shown after hidden ones: its history before what the
    // user last said folds away
    let earlier: Item[] = [];
    let said = fresh;
    if (earlierHidden && out.length === 0) {
      let lastUser = -1;
      fresh.forEach((it, j) => {
        if (it.role === 'user') lastUser = j;
      });
      if (lastUser > 0) {
        earlier = fresh.slice(0, lastUser);
        said = fresh.slice(lastUser);
      }
    }
    const answered = (Array.isArray(output?.output) ? output.output : []) as Item[];
    for (const it of answered) seen.add(identity(it));
    out.push({ record, recorded: true, said, earlier, answered, failure: typeof output?.error === 'string' ? output.error : null });
  });
  const context: ReactNode[] = [];
  const tools: Tool[] = [];
  const top = latest as Record<string, unknown> | null;
  if (top) {
    if (typeof top.instructions === 'string' && top.instructions.trim()) context.push(<Fold title="instructions" kind="system" preview={top.instructions} body={top.instructions} />);
    const asked = (Array.isArray(top.input) ? top.input : []) as Item[];
    for (const it of asked.filter(isContext)) context.push(<ItemView item={it} open={false} />);
    if (Array.isArray(top.tools)) {
      for (const t of top.tools as Record<string, unknown>[]) {
        const fn = (t.function ?? t) as Record<string, unknown>;
        tools.push({ name: String(fn.name ?? t.type ?? 'tool'), description: typeof fn.description === 'string' ? fn.description : '', parameters: fn.parameters });
      }
    }
  }
  return { context, tools, opening, turns: out };
}
