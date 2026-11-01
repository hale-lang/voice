import { useEffect, useMemo, useState } from 'react';
import { Panel, Loading, Unavailable, count, ago } from '@hale/components';
import { useGet, useGetOnce, useAnnotations, type UsageRecord, type UsageSummary, type Schemas } from '../api/client';
import { readout } from '../readout';
import { useTitles } from '../titles';
import s from './Board.module.css';

/** How far back the board looks, in seconds. */
const WINDOW = 6 * 3600;

/** A turn this recent keeps its conversation boarding, in seconds. */
const ACTIVE = 120;

/** How many conversations the board shows. */
const ROWS = 24;

/** The statuses a turn ends as that are not a failure. */
const FINE = new Set(['served', 'incomplete']);

type Group = UsageSummary['data'][number];

/**
 * One row of the board: a conversation, by the `prompt_cache_key` its turns
 * share, its totals over the whole window as the api sums them. Requests
 * that named none are a row of their own.
 */
export type Flight = {
  conversation: string | null;
  turns: number;
  input: number;
  output: number;
  last_at: string;
  last_request: string;
};

/** The summary's groups as rows, the most recently active first. */
function flights(groups: Group[]): Flight[] {
  const by = new Map<string, Flight>();
  for (const g of groups) {
    const c = (g.group as Record<string, string>).conversation ?? '';
    // a conversation's turns in another currency are its turns still
    const was = by.get(c);
    const later = !was || Date.parse(g.last_at) > Date.parse(was.last_at);
    by.set(c, {
      conversation: c || null,
      turns: (was?.turns ?? 0) + g.requests,
      input: (was?.input ?? 0) + g.input_tokens,
      output: (was?.output ?? 0) + g.output_tokens,
      last_at: later ? g.last_at : was!.last_at,
      last_request: later ? g.last_request : was!.last_request,
    });
  }
  return [...by.values()].sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at)).slice(0, ROWS);
}

type State = { label: string; tone: 'live' | 'ok' | 'fail' | 'quiet' };

/** A conversation's status: in flight while its turns keep coming, else how its latest ended (served, failed, refused). */
function state(f: Flight, last: UsageRecord | undefined, now: number): State {
  if (last && !FINE.has(last.status)) {
    // a limit, a budget or no seat to take it: refused; anything else failed
    const refused = last.status === 'rate_limited' || last.status === 'budget_exhausted' || last.status === 'no_capacity';
    return { label: refused ? 'refused' : last.status === 'cancelled' ? 'cancelled' : 'failed', tone: 'fail' };
  }
  if (now - Date.parse(f.last_at) < ACTIVE * 1000) return { label: 'in flight', tone: 'live' };
  return { label: 'served', tone: f.turns > 1 ? 'ok' : 'quiet' };
}

/** How long a request may wait for its annotation before the board stops saying it is coming, in seconds. */
const ANNOTATING = 180;

/** A hue of its own for each conversation, the same every time it shows. */
function hue(root: string): number {
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * The live board of the last six hours' conversations: one row each,
 * newest activity on top, lit while turns keep coming. The rows and their
 * totals are the api's summary of the whole window, grouped by
 * conversation; a row reads its latest turn for the rest. A row's title is
 * the caller's `metadata.title`, or the first thing its user asked when the
 * project peeks. A row opens its latest turn and narrows the requests below
 * to the conversation.
 */
export function Board({ onOpen }: { onOpen: (f: Flight) => void }) {
  // the cutoff is fixed when the board opens, so the query stays the same
  // while the event stream refreshes it
  const [from] = useState(() => new Date(Date.now() - WINDOW * 1000).toISOString());
  const q = useGet('/admin/v1/usage/summary', { params: { query: { group_by: ['conversation'], from } } });
  const rows = useMemo(() => flights(q.data?.data ?? []), [q.data]);
  // the projects that annotate: a turn of one waits for its tags
  const projects = useGet('/admin/v1/projects');
  const annotating = useMemo(() => new Set((projects.data?.data ?? []).filter((p) => p.annotates).map((p) => p.id)), [projects.data]);
  // the clock a remark reads, so boarding ends without a new turn
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <Panel title="Board" readout={readout(q, q.data ? `${rows.length} conversations · 6 h` : null)}>
      {q.isPending ? (
        <Loading what="the board" />
      ) : q.isError ? (
        <Unavailable what="The board" detail={q.error.message} />
      ) : rows.length === 0 ? (
        <p className="faint">Nothing in the last six hours.</p>
      ) : (
        <div className={s.board} role="table" aria-label="conversations">
          <div className={`${s.row} ${s.head}`} role="row">
            <span role="columnheader">last</span>
            <span role="columnheader">conversation</span>
            <span role="columnheader">project</span>
            <span role="columnheader">model · seat</span>
            <span role="columnheader" className={s.num}>turns</span>
            <span role="columnheader" className={s.num}>in</span>
            <span role="columnheader" className={s.num}>out</span>
            <span role="columnheader">status · tags</span>
          </div>
          {rows.map((f) => (
            <Row key={f.conversation ?? ''} flight={f} now={now} annotating={annotating} onOpen={onOpen} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** A conversation's row: its totals, and what its latest turn says. */
function Row({ flight: f, now, annotating, onOpen }: { flight: Flight; now: number; annotating: Set<string>; onOpen: (f: Flight) => void }) {
  const last = useGet('/admin/v1/usage/{request_id}', { params: { path: { request_id: f.last_request } } }).data;
  // the turn a title is read from: the first the board saw, so a new turn
  // does not fetch the recording again
  const [titled] = useState(f.last_request);
  const r = state(f, last, now);
  const titleOf = useTitles();
  const named = f.conversation ? titleOf(f.conversation, last?.project) : null;
  return (
    <button type="button" role="row" className={`${s.row} ${s[r.tone]}`} style={{ ['--hue' as string]: hue(f.conversation ?? '') }} onClick={() => onOpen(f)}>
      <span className={s.time}>{ago(f.last_at)}</span>
      {/* keyed by the latest turn: a new turn flips the title */}
      <span className={s.title} key={f.last_request}>
        {named ? (
          <span title={f.conversation ?? ''}>{named}</span>
        ) : f.conversation ? (
          <Title last={last} id={titled} fallback={f.conversation} />
        ) : (
          <span className={s.key}>requests of no conversation</span>
        )}
      </span>
      <span className={s.cell}>{last?.project ?? ''}</span>
      <span className={s.cell}>
        {last ? (last.served?.model ?? last.requested_model) : ''}
        <span className={s.seat}> · {last?.served?.seat ?? '–'}</span>
      </span>
      <span className={s.num}>{f.turns}</span>
      <span className={s.num}>{count(f.input)}</span>
      <span className={s.num}>{count(f.output)}</span>
      <span className={s.remark}>
        <span className={s.state}>{r.label}</span>
        <Tags id={f.last_request} waiting={!!last && annotating.has(last.project) && now - Date.parse(f.last_at) < ANNOTATING * 1000} />
      </span>
    </button>
  );
}

type Annotation = Schemas['Annotation'];
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** The answers worth a chip: the request's task and the response's outcome first, then each yes, then any other choice. */
function chips(a: Annotation): { label: string; title: string }[] {
  const given = a.answers.filter((x) => !x.skipped && x.answer != null);
  const head = (annotator: string, question: string) => given.find((x) => x.annotator === annotator && x.question === question);
  const out: { label: string; title: string }[] = [];
  const seen = new Set<string>();
  const add = (x: (typeof given)[number], label: string) => {
    const k = `${x.annotator}.${x.question}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label, title: `${k} = ${x.answer} · ${pct(x.probability)}` });
  };
  for (const [an, q] of [['request-basics', 'task'], ['response-basics', 'outcome']] as const) {
    const x = head(an, q);
    if (x) add(x, `${q}: ${x.answer!.replace(/_/g, ' ')}`);
  }
  for (const x of given) if (x.answer === 'true' && x.probability >= 0.5) add(x, x.question.replace(/_/g, '-'));
  for (const x of given) if (x.answer !== 'true' && x.answer !== 'false' && x.score == null) add(x, `${x.question}: ${x.answer!.replace(/_/g, ' ')}`);
  return out;
}

/**
 * A turn's tags, as its annotation lands (the event stream's `annotation`
 * refreshes it): its answers as chips, the probability on hover; a pending
 * mark while it is still being read; a failed one's reason on hover.
 */
function Tags({ id, waiting }: { id: string; waiting: boolean }) {
  // read as the conversation view reads it, one cache: none yet is null
  const q = useAnnotations([id])[0]!;
  const a = q.data;
  if (!a) return waiting ? <span className={s.pending} title="its annotation is being read">annotating</span> : null;
  if (a.status !== 'annotated') return <span className={s.failed} title={a.reason}>not annotated</span>;
  const all = chips(a);
  const shown = all.slice(0, 4);
  const rest = all.slice(4);
  return (
    <>
      {shown.map((c) => (
        <span key={c.label} className={s.chip} title={c.title}>
          {c.label}
        </span>
      ))}
      {rest.length > 0 && (
        <span className={s.chip} title={rest.map((c) => c.title).join('\n')}>
          +{rest.length}
        </span>
      )}
    </>
  );
}

/** A conversation's title: its `metadata.title`, else what its user first asked, else its key. */
function Title({ last, id, fallback }: { last: UsageRecord | undefined; id: string; fallback: string }) {
  const m = last?.metadata as Record<string, unknown> | null | undefined;
  if (m && typeof m.title === 'string' && m.title.trim()) return <>{m.title.trim()}</>;
  return <PeekTitle id={id} fallback={fallback} />;
}

/**
 * The first thing the user asked in a conversation, from a turn's recording: a peeked project's only. Wrapped
 * context a client sends ahead of the prompt (`<environment_context>`) is
 * passed over.
 */
function PeekTitle({ id, fallback }: { id: string; fallback: string }) {
  const q = useGetOnce('/admin/v1/peeks/{request_id}', { params: { path: { request_id: id } } });
  const asked = q.data ? firstAsked(q.data.input) : null;
  return asked ? <>{asked}</> : <span className={s.key}>{fallback}</span>;
}

function firstAsked(input: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(input);
  } catch {
    return null;
  }
  const items = (body as { input?: unknown })?.input;
  if (typeof items === 'string') return line(items);
  if (!Array.isArray(items)) return null;
  for (const it of items as { role?: string; content?: unknown }[]) {
    if (it?.role !== 'user') continue;
    const parts = typeof it.content === 'string' ? [it.content] : Array.isArray(it.content) ? it.content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')) : [];
    for (const p of parts) {
      const t = p.trim();
      if (t && !t.startsWith('<')) return line(t);
    }
  }
  return null;
}

/** A text's first line, at most a board's width. */
function line(t: string): string {
  const first = t.trim().split('\n')[0] ?? '';
  return first.length > 90 ? `${first.slice(0, 89)}…` : first;
}
