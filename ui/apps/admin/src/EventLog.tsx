import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { count } from '@hale/components';
import { subscribeAdminEvents, subscribeFlights, type Flight } from './api/events';
import { api, type Schemas, type UsageRecord } from './api/client';
import { go } from './route';
import { DEFAULT, clamp, dragged, keyed, room as roomFor, type Size } from './resize';
import s from './EventLog.module.css';

type AdminEvent = Schemas['AdminEvent'];

/** Lines the log keeps. */
const KEEP = 300;

/** The latest requests the log opens with, as history. */
const SEED = 20;

/** An event older than this when it arrives is history, shown quiet, in seconds. */
const LIVE = 60;

type Tone = 'req' | 'ok' | 'warn' | 'fail' | 'node' | 'change' | 'quiet' | 'note';

type Line = { key: string; at: number; tag: string; tone: Tone; text: string; detail?: string; open?: () => void; replayed: boolean };

/**
 * The live log at the foot of every screen: what the admin event stream
 * tells, one line an event. A request taking off (in flight), landing (its
 * usage), a node coming or going, a change an operator made. The stream is
 * the one the screens already share; the log opens nothing of its own.
 * Folded to its title bar, or open, as the viewer last left it, and as
 * tall: its top edge drags (or takes the arrow keys) to resize it, and a
 * double-click there folds or reopens it.
 */
export function EventLog() {
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useRemembered('voice.event-log', true);
  const [height, setHeight] = useRememberedNumber('voice.event-log.height', DEFAULT);
  const log = useRef<HTMLElement>(null);
  const room = useRoom(log, open);
  const shown = clamp(height, room);
  const size: Size = { open, height: shown };
  const resize = (next: Size, keep: boolean) => {
    if (next.open !== open) setOpen(next.open);
    setHeight(next.height, keep);
  };
  // a drag: where it began, held while the pointer is down
  const drag = useRef<{ y: number; from: Size } | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const add = (l: Line) => {
      if (pausedRef.current) return;
      setLines((old) => (old.some((o) => o.key === l.key) ? old : [...old, l].slice(-KEEP)));
      setUnseen((n) => n + 1);
    };
    const flying = new Set<string>();
    const offFlights = subscribeFlights((now) => {
      for (const f of now) {
        if (flying.has(f.id)) continue;
        flying.add(f.id);
        add(departure(f));
      }
      // keep only what is still in flight, so a retried id can take off again
      const ids = new Set(now.map((f) => f.id));
      for (const id of flying) if (!ids.has(id)) flying.delete(id);
    });
    const offEvents = subscribeAdminEvents((e) => {
      const l = lineOf(e);
      if (l) add(l);
    });
    // the stream tells what happens from now on: the log opens on the
    // latest requests, quiet, as what came before
    void api.GET('/admin/v1/usage', { params: { query: { limit: SEED } } }).then((r) => {
      const past = (r.data?.data ?? []).map((u) => landing(u, Date.parse(u.created_at) || 0, true)).reverse();
      setLines((old) => [...past.filter((p) => !old.some((o) => o.key === p.key)), ...old].sort((a, b) => a.at - b.at).slice(-KEEP));
    });
    return () => {
      offFlights();
      offEvents();
    };
  }, []);

  // follow the newest line, unless the viewer has scrolled up to read
  const body = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [lines, open, shown]);
  useEffect(() => {
    if (open) setUnseen(0);
  }, [open, lines]);

  const live = lines.filter((l) => !l.replayed).length;
  return (
    <section ref={log} className={`${s.log} ${open ? s.open : ''}`} aria-label="Event log">
      <div
        className={s.handle}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the event log"
        aria-valuemin={0}
        aria-valuemax={room}
        aria-valuenow={open ? shown : 0}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, from: size };
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) resize(dragged(d.from, d.y - e.clientY, room), false);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d) resize(dragged(d.from, d.y - e.clientY, room), true);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          const next = keyed(e.key, e.shiftKey, size, room);
          if (!next) return;
          e.preventDefault();
          resize(next, true);
        }}
      />
      <header className={s.bar}>
        <button type="button" className={s.toggle} onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={paused ? s.dotPaused : s.dot} />
          event log
          <span className={s.count}>{live} live{lines.length > live ? ` · ${lines.length - live} before` : ''}</span>
          {!open && unseen > 0 && <span className={s.unseen}>+{unseen}</span>}
          <span className={s.chevron}>{open ? '▾' : '▴'}</span>
        </button>
        {open && (
          <span className={s.actions}>
            <button type="button" onClick={() => setPaused(!paused)}>{paused ? 'resume' : 'pause'}</button>
            <button type="button" onClick={() => setLines([])}>clear</button>
          </span>
        )}
      </header>
      {open && (
        <div
          className={s.body}
          style={{ height: shown }}
          ref={body}
          onScroll={(e) => {
            const el = e.currentTarget;
            stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          }}
        >
          {lines.length === 0 ? (
            <div className={s.empty}>listening… requests, annotations, nodes and changes show here as they happen</div>
          ) : (
            lines.map((l) => (
              <div
                key={l.key}
                className={`${s.line} ${s[l.tone]} ${l.replayed ? s.replayed : ''} ${l.open ? s.link : ''}`}
                onClick={l.open}
                title={l.detail}
              >
                <span className={s.time}>{clock(l.at)}</span>
                <span className={s.tag}>{l.tag}</span>
                <span className={s.text}>{l.text}</span>
                {l.detail && <span className={s.detail}>{l.detail}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

// ---- one line an event ------------------------------------------------

function departure(f: Flight): Line {
  const at = Date.parse(f.started_at) || Date.now();
  return {
    key: `req:${f.id}:${f.seat}`,
    at,
    tag: '▶ req',
    tone: 'req',
    text: `${f.project} → ${f.requested_model} on ${f.seat}`,
    detail: f.id,
    replayed: Date.now() - at > LIVE * 1000,
  };
}

function lineOf(e: AdminEvent): Line | null {
  const at = Date.parse(e.at) || Date.now();
  const replayed = Date.now() - at > LIVE * 1000;
  switch (e.type) {
    case 'usage':
      return landing(e.data, at, replayed);
    case 'node': {
      const n = e.data;
      const down = n.status !== 'up';
      return {
        key: `node:${e.id}`,
        at,
        tag: '◆ node',
        tone: down ? 'fail' : 'node',
        text: `${n.id} ${n.status}${n.version ? ` · ${n.version}` : ''} · ${n.in_flight ?? 0}/${n.effective_max_in_flight ?? n.max_in_flight ?? '–'} in flight`,
        open: () => go('nodes', n.id),
        replayed,
      };
    }
    case 'change': {
      const c = e.data;
      const fields = changed(c.before, c.after);
      return {
        key: `change:${c.id}`,
        at,
        tag: '✎ change',
        tone: 'change',
        text: `${c.action} ${c.target}${fields ? ` · ${fields}` : ''}`,
        detail: c.principal ?? undefined,
        open: () => go('changes', c.id),
        replayed,
      };
    }
    case 'annotation': {
      const a = e.data;
      const pick = (q: string) => a.answers.find((x) => x.question === q)?.answer;
      const task = pick('task');
      const outcome = pick('outcome');
      const flags = a.answers.filter((x) => x.answer === 'true' && x.probability >= 0.5).map((x) => x.question.replace(/_/g, '-'));
      const said = [task && outcome ? `${task} → ${outcome.replace(/_/g, ' ')}` : (task ?? outcome), ...flags.slice(0, 3)].filter(Boolean).join(' · ');
      const tokens = a.runs.reduce((n, r) => n + r.input_tokens, 0);
      const not = a.status !== 'annotated';
      return {
        key: `annotation:${e.id}`,
        at,
        tag: not ? '◌ unread' : '◇ read',
        tone: not ? 'warn' : 'note',
        text: not
          ? `${a.project} · not annotated: ${a.reason}`
          : `${a.project} · ${said || `${a.answers.length} answers`}${a.title ? ` · “${a.title}”` : ''} · ${a.runs.length} run${a.runs.length === 1 ? '' : 's'}, ${count(tokens)} tok`,
        detail: a.conversation ?? a.request_id,
        open: () => go('usage', a.request_id),
        replayed,
      };
    }
    default:
      return null;
  }
}

/** The statuses a request ends as that are not a failure. */
const FINE = new Set(['served', 'incomplete']);

function landing(r: UsageRecord, at: number, replayed: boolean): Line {
  const t = r.timing;
  const secs = t.wall_ms / 1000;
  const rate = t.first_output_ms != null && t.engine_ms != null && t.engine_ms > t.first_output_ms && r.output_tokens > 0 ? ` · ${((1000 * r.output_tokens) / (t.engine_ms - t.first_output_ms)).toFixed(0)} tok/s` : '';
  const failed = !FINE.has(r.status);
  // voice's own request for the project (its system key's): an annotation's
  // stage or a title, quiet beside the project's own
  const side = r.internal ? String((r.metadata as Record<string, unknown> | null)?.side ?? 'internal') : '';
  return {
    key: `usage:${r.id}`,
    at,
    tag: failed ? '✕ ' + r.status.replace(/_/g, ' ') : r.internal ? '· internal' : '■ done',
    tone: failed ? 'fail' : r.internal ? 'quiet' : r.status === 'incomplete' ? 'warn' : 'ok',
    text: `${r.project}${r.internal ? ` · ${side === 'title' ? 'title' : `${side} stage`}` : ''} · ${r.served?.model ?? r.requested_model} on ${r.served?.seat ?? '–'} · ${count(r.input_tokens)} → ${count(r.output_tokens)} tok · ${secs < 10 ? secs.toFixed(1) : Math.round(secs)} s${rate}`,
    detail: r.conversation ?? r.id,
    open: () => go('usage', r.id),
    replayed,
  };
}

/** The top-level fields a change made differ, named; "" for a create or a removal. */
function changed(before: unknown, after: unknown): string {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return '';
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  return keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4}` : '');
}

function clock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour12: false });
}

/** A boolean kept in this browser, so the log stays as the viewer left it. */
function useRemembered(name: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, set] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(name);
      return s === null ? initial : s === '1';
    } catch {
      return initial;
    }
  });
  return [
    v,
    (x: boolean) => {
      set(x);
      try {
        localStorage.setItem(name, x ? '1' : '0');
      } catch {
        // kept for this visit only
      }
    },
  ];
}

/**
 * A number kept in this browser: set while it changes (a drag), kept when
 * `keep` says it has settled.
 */
function useRememberedNumber(name: string, initial: number): [number, (v: number, keep: boolean) => void] {
  const [v, set] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(name));
      return Number.isFinite(n) && n > 0 ? n : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (x: number, keep: boolean) => {
      set(x);
      if (!keep) return;
      try {
        localStorage.setItem(name, String(x));
      } catch {
        // kept for this visit only
      }
    },
  ];
}

/**
 * The tallest the log's body may be as the screen is laid out: what it has
 * and what the page above it (the screen's `main`) could give, measured
 * when it opens or folds and as the window changes. Unbounded until the
 * first measure, which comes before the first paint.
 */
function useRoom(log: RefObject<HTMLElement | null>, open: boolean): number {
  const [room, setRoom] = useState(Number.MAX_SAFE_INTEGER);
  useLayoutEffect(() => {
    const measure = () => {
      const body = open ? (log.current?.lastElementChild?.getBoundingClientRect().height ?? 0) : 0;
      const page = document.querySelector('main')?.getBoundingClientRect().height ?? 0;
      setRoom(roomFor(window.innerHeight, body, page));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [log, open]);
  return room;
}
