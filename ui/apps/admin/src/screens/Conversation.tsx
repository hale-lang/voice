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
            {read.threads.map((th, k) => (
              <div key={k} className={s.thread} style={{ ['--hue' as string]: threadHue(k) }}>
                {read.threads.length > 1 && <div className={s.threadName}>thread {k + 1}</div>}
                {th.opening && (
                  <div className={s.opening}>
                    <div className={s.label}>opening prompt</div>
                    <div className={s.text}>{th.opening}</div>
                  </div>
                )}
                {th.context.map((c, i) => (
                  <div key={i}>{c}</div>
                ))}
                {th.tools.length > 0 && <Tools tools={th.tools} />}
                {!th.context.length && !th.tools.length && !th.opening && <p className="faint">Nothing recorded set it up.</p>}
              </div>
            ))}
            {!read.threads.length && <p className="faint">Nothing recorded set it up.</p>}
          </aside>
          <section className={s.chat}>
            {hidden > 0 && (
              <p className={s.more}>
                <Button onClick={() => setShown(shown + STEP)}>{Math.min(STEP, hidden)} earlier turns</Button> <span className="faint">{hidden} not shown</span>
              </p>
            )}
            {read.turns.map((t) => (
              <TurnView key={t.record.id} turn={t} threads={read.threads.length} />
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

type Turn = { record: UsageRecord; recorded: boolean; thread: number; said: Item[]; earlier: Item[]; answered: Item[]; failure: string | null };

/** A thread's own hue, the same in the context and on each of its turns. */
function threadHue(k: number): number {
  return (190 + k * 137) % 360;
}

function TurnView({ turn: t, threads }: { turn: Turn; threads: number }) {
  const r = t.record;
  return (
    <div className={`${s.turn} ${threads > 1 && t.thread >= 0 ? s.threaded : ''}`} style={{ ['--hue' as string]: threadHue(Math.max(0, t.thread)) }}>
      <a className={s.divider} href={href('usage', r.id)} title="the request">
        {threads > 1 && t.thread >= 0 && <span className={s.threadTag}>thread {t.thread + 1}</span>}
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

/**
 * How many of a turn's leading parts replay what was said before: the
 * longest run of them found in `history` in order (a client may drop or
 * reshape a part it resends, reasoning most of all), counted only when it
 * reaches the last part said before that is not reasoning. Otherwise the
 * client sent only what is new, and none of it is a replay: a message is
 * new whenever it is said again, whatever it says.
 */
function replays(history: string[], asked: string[]): number {
  if (!history.length) return 0;
  let j = 0;
  let last = -1;
  let n = 0;
  while (n < asked.length) {
    const at = history.indexOf(asked[n]!, j);
    if (at < 0) {
      // reasoning resent reshaped is still the replay
      if (asked[n]!.startsWith('reasoning:')) {
        n++;
        continue;
      }
      break;
    }
    last = at;
    j = at + 1;
    n++;
  }
  let anchor = history.length - 1;
  while (anchor >= 0 && history[anchor]!.startsWith('reasoning:')) anchor--;
  return anchor < 0 || last >= anchor ? n : 0;
}

/** What makes two parts the same part, however a client resends it. */
function identity(it: Item & { id?: string }): string {
  if (it.type === 'function_call' || it.type === 'function_call_output') return `${it.type}:${it.call_id ?? it.id ?? ''}`;
  if (it.type === 'reasoning') return `reasoning:${texts(it.content) || texts(it.summary)}`;
  return `${it.role ?? it.type}:${texts(it.content) || it.text || ''}`;
}

/** One thread of a conversation: what set it up, its tools, and what its user first asked. */
type ThreadContext = { context: ReactNode[]; tools: Tool[]; opening: string | null };

type Thread = { threads: ThreadContext[]; turns: Turn[] };

/** A thread as it is read: its history so far, in order, as the client last told it, and its latest request. */
type Open = { history: string[]; latest: Record<string, unknown> | null; opening: string | null; shown: boolean };

/**
 * The turns as threads, each turn's parts not said before (`replays`), then
 * its answer. One root can hold several threads at once (a Codex session's
 * agent and the reviewer judging its steps share its id): a turn continues
 * the thread whose history it replays; one that opens with its own setup
 * starts a thread; one that only adds what is new (a client that sends no
 * history) goes on the latest. Each thread's context is its latest
 * recorded turn's: instructions, setup messages, tools. When earlier turns
 * are not shown, a thread's first shown turn folds its history away.
 */
function thread(turns: UsageRecord[], peeks: ({ input: string; output: string } | null)[], earlierHidden: boolean): Thread {
  const open: Open[] = [];
  let current = -1;
  const out: Turn[] = [];
  turns.forEach((record, i) => {
    const p = peeks[i];
    if (!p) {
      out.push({ record, recorded: false, thread: -1, said: [], earlier: [], answered: [], failure: null });
      return;
    }
    const input = parse(p.input);
    const output = parse(p.output);
    const asked = (Array.isArray(input?.input) ? input.input : typeof input?.input === 'string' ? [{ type: 'message', role: 'user', content: input.input }] : []) as Item[];
    const ids = asked.map(identity);
    // the thread this turn replays the most of
    let best = -1;
    let replayed = 0;
    open.forEach((th, k) => {
      const n = replays(th.history, ids);
      if (n > replayed) {
        replayed = n;
        best = k;
      }
    });
    if (best < 0) {
      if (current < 0 || (asked[0] && isContext(asked[0]))) {
        open.push({ history: [], latest: null, opening: null, shown: false });
        best = open.length - 1;
      } else {
        best = current;
      }
    }
    current = best;
    const th = open[best]!;
    const fresh = asked.slice(replayed).filter((it) => !isContext(it));
    if (th.opening === null) {
      const u = asked.find((it) => it.role === 'user' && !isContext(it) && texts(it.content).trim());
      if (u) th.opening = texts(u.content).trim();
    }
    // a thread's first turn shown after hidden ones: its history before
    // what the user last said folds away
    let earlier: Item[] = [];
    let said = fresh;
    if (earlierHidden && !th.shown) {
      let lastUser = -1;
      fresh.forEach((it, j) => {
        if (it.role === 'user') lastUser = j;
      });
      if (lastUser > 0) {
        earlier = fresh.slice(0, lastUser);
        said = fresh.slice(lastUser);
      }
    }
    th.shown = true;
    th.latest = input ?? th.latest;
    const answered = (Array.isArray(output?.output) ? output.output : []) as Item[];
    // a client that resent the history told it whole; one that sent only
    // what is new adds to it
    th.history = [...(replayed > 0 ? [] : th.history), ...ids, ...answered.map(identity)];
    out.push({ record, recorded: true, thread: best, said, earlier, answered, failure: typeof output?.error === 'string' ? output.error : null });
  });
  return { threads: open.map((th) => contextOf(th.latest, th.opening)), turns: out };
}

/** What set a thread up, from its latest request. */
function contextOf(top: Record<string, unknown> | null, opening: string | null): ThreadContext {
  const context: ReactNode[] = [];
  const tools: Tool[] = [];
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
  return { context, tools, opening };
}
