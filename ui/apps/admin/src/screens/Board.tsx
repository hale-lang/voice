import { useEffect, useMemo, useState } from 'react';
import { Panel, Loading, Unavailable, count, ago } from '@hale/components';
import { useGet, useGetOnce, type UsageRecord } from '../api/client';
import { readout } from '../readout';
import s from './Board.module.css';

/** How far back the board looks, in seconds. */
const WINDOW = 6 * 3600;

/** A turn this recent keeps its conversation boarding, in seconds. */
const ACTIVE = 120;

/** How many conversations the board shows. */
const ROWS = 24;

/** The statuses a turn ends as that are not a failure. */
const FINE = new Set(['served', 'incomplete']);

/**
 * One row of the board: a conversation, by the `prompt_cache_key` its turns
 * share, or a request that named none, on its own.
 */
export type Flight = {
  root: string;
  conversation: string | null;
  turns: UsageRecord[]; // newest first
  first: UsageRecord;
  last: UsageRecord;
  input: number;
  output: number;
};

/** The ledger's records as conversations, the most recently active first. */
function flights(records: UsageRecord[]): Flight[] {
  const by = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const root = r.conversation ?? r.id;
    const turns = by.get(root);
    if (turns) turns.push(r);
    else by.set(root, [r]);
  }
  const out: Flight[] = [];
  for (const [root, turns] of by) {
    // the ledger answers newest first, and so the turns are
    const last = turns[0]!;
    const first = turns[turns.length - 1]!;
    out.push({
      root,
      conversation: last.conversation ?? null,
      turns,
      first,
      last,
      input: turns.reduce((n, t) => n + t.input_tokens, 0),
      output: turns.reduce((n, t) => n + t.output_tokens, 0),
    });
  }
  return out.sort((a, b) => Date.parse(b.last.created_at) - Date.parse(a.last.created_at)).slice(0, ROWS);
}

type Remark = { label: string; tone: 'live' | 'ok' | 'fail' | 'quiet' };

/** What the board says of a conversation: boarding while its turns keep coming, else how its last ended. */
function remark(f: Flight, now: number): Remark {
  if (!FINE.has(f.last.status)) return { label: f.last.status.replace(/_/g, ' '), tone: 'fail' };
  if (now - Date.parse(f.last.created_at) < ACTIVE * 1000) return { label: 'boarding', tone: 'live' };
  return { label: f.turns.length > 1 ? 'landed' : 'served', tone: f.turns.length > 1 ? 'ok' : 'quiet' };
}

/** A hue of its own for each conversation, the same every time it shows. */
function hue(root: string): number {
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** A string metadata field `title` on any of its turns, the newest first. */
function metadataTitle(f: Flight): string | null {
  for (const t of f.turns) {
    const m = t.metadata as Record<string, unknown> | null | undefined;
    if (m && typeof m.title === 'string' && m.title.trim()) return m.title.trim();
  }
  return null;
}

/**
 * The live board of the last six hours' conversations: one row each,
 * newest activity on top, lit while turns keep coming. A row's title is
 * the caller's `metadata.title`, or the first thing its user asked when the
 * project peeks. A row opens its latest turn and narrows the requests below
 * to the conversation.
 */
export function Board({ onOpen }: { onOpen: (f: Flight) => void }) {
  // the cutoff is fixed when the board opens, so the query stays the same
  // while the event stream refreshes it
  const [from] = useState(() => new Date(Date.now() - WINDOW * 1000).toISOString());
  const q = useGet('/admin/v1/usage', { params: { query: { limit: 500, from } } });
  const rows = useMemo(() => flights(q.data?.data ?? []), [q.data]);
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
            <span role="columnheader">remark</span>
          </div>
          {rows.map((f) => {
            const r = remark(f, now);
            return (
              <button
                type="button"
                role="row"
                key={f.root}
                className={`${s.row} ${s[r.tone]}`}
                style={{ ['--hue' as string]: hue(f.root) }}
                onClick={() => onOpen(f)}
              >
                <span className={s.time}>{ago(f.last.created_at)}</span>
                {/* the key of the last turn: a new turn flips the row */}
                <span className={s.title} key={f.last.id}>
                  <Title flight={f} />
                </span>
                <span className={s.cell}>{f.last.project}</span>
                <span className={s.cell}>
                  {f.last.served?.model ?? f.last.requested_model}
                  <span className={s.seat}> · {f.last.served?.seat ?? '–'}</span>
                </span>
                <span className={s.num}>{f.turns.length}</span>
                <span className={s.num}>{count(f.input)}</span>
                <span className={s.num}>{count(f.output)}</span>
                <span className={s.remark}>{r.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** A conversation's title, else its key, else the one request's id. */
function Title({ flight: f }: { flight: Flight }) {
  const meta = metadataTitle(f);
  if (meta) return <>{meta}</>;
  return <PeekTitle id={f.first.id} fallback={f.conversation ?? f.root} />;
}

/**
 * The first thing the user asked in a conversation's earliest turn the
 * board holds, from its recording: a peeked project's only. Wrapped
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
