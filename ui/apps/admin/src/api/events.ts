import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Schemas } from './client';
import { forgetOperatorToken, useOperatorToken } from './token';

type AdminEvent = Schemas['AdminEvent'];
const listeners = new Set<(event: AdminEvent) => void>();

/** Share the existing stream; screens do not open a second connection. */
export function subscribeAdminEvents(listener: (event: AdminEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A request a seat is serving now, as the stream's `request` event says it. */
export type Flight = Extract<AdminEvent, { type: 'request' }>['data'];

// The requests in flight: the hub tells the set whole each time it changes;
// the event stream tells each as it starts, and it leaves with its usage.
let flights: Flight[] = [];
const flightListeners = new Set<(f: Flight[]) => void>();

/** The requests in flight, now and as each answer of the stream says. */
export function subscribeFlights(listener: (f: Flight[]) => void): () => void {
  flightListeners.add(listener);
  listener(flights);
  return () => { flightListeners.delete(listener); };
}

function setFlights(next: Flight[]) {
  flights = next;
  for (const l of flightListeners) l(flights);
}

/**
 * The admin events: each names a resource that changed, and the queries
 * that show it are read again. They arrive on the hub (hub.ts), every api
 * instance's, where the api has a database; otherwise on the held event
 * stream (`GET /admin/v1/events`, `useAdminEvents`). Either way they come
 * through `deliver`.
 */
export const AFFECTS: Record<string, string[]> = {
  node: ['/admin/v1/nodes', '/admin/v1/routes', '/admin/v1/placements'],
  seat: ['/admin/v1/nodes', '/admin/v1/routes', '/admin/v1/models', '/admin/v1/placements'],
  account: ['/admin/v1/accounts', '/admin/v1/routes'],
  usage: ['/admin/v1/usage', '/admin/v1/usage/summary', '/admin/v1/projects'],
  // the log, and the resource the change names (`target`), below
  change: ['/admin/v1/changes', '/admin/v1/routes'],
  // a request a seat is serving: told to listeners (the Network view), no
  // query changes until its usage is recorded
  request: [],
  // a request annotated: its annotation, the searches over them, the
  // conversations' titles, and the annotators' counts
  annotation: ['/admin/v1/annotations', '/admin/v1/conversations', '/admin/v1/annotators'],
};

/** What a (re)connect reads again: every admin read, for what was missed. */
export const COVERED = ['/admin/v1'];

/** Read again every query under `paths` (a path, or anything below it). */
export function refresh(qc: QueryClient, paths: string[]) {
  const under = (k: unknown) => typeof k === 'string' && paths.some((p) => k === p || k.startsWith(`${p}/`));
  void qc.invalidateQueries({ predicate: (q) => under(q.queryKey[0]) });
}

const seen = new Set<string>();

/**
 * One event: told to the listeners once (by id), and the queries it
 * affects read again. A request in flight joins the set until its usage is
 * told (the event stream's shape; the hub tells the set whole instead).
 */
export function deliver(qc: QueryClient, event: AdminEvent) {
  if (!event || typeof event.id !== 'string' || typeof event.at !== 'string' || !event.data || seen.has(event.id)) return;
  if (event.type === 'usage' && (typeof event.data.id !== 'string' || typeof event.data.project !== 'string' || typeof event.data.requested_model !== 'string' || !event.data.timing || typeof event.data.input_tokens !== 'number' || typeof event.data.output_tokens !== 'number')) return;
  seen.add(event.id);
  if (seen.size > 512) seen.delete(seen.values().next().value!);
  if (event.type === 'request') {
    const f = event.data as Flight;
    if (typeof f?.id === 'string' && typeof f.seat === 'string' && typeof f.project === 'string') setFlights([...flights.filter((o) => o.id !== f.id), f]);
  } else if (event.type === 'usage' && flights.some((f) => f.id === event.data.id)) {
    setFlights(flights.filter((f) => f.id !== event.data.id));
  }
  for (const listener of listeners) listener(event);
  if (event.type === 'reset') { refresh(qc, COVERED); return; }
  const paths = [...(AFFECTS[event.type] ?? [])];
  if (event.type === 'change' && typeof event.data.target === 'string') {
    // `projects/work/budget` changes what `/admin/v1/projects` shows
    const top = event.data.target.split('/')[0];
    if (top) paths.push(`/admin/v1/${top}`);
  }
  refresh(qc, paths);
}

/** The requests in flight, as the hub tells them whole. */
export function deliverFlights(next: Flight[]) {
  setFlights(next.filter((f) => typeof f?.id === 'string' && typeof f.seat === 'string' && typeof f.project === 'string'));
}

/** One server-sent event: its `event`, `data` and `id`, and a `retry`. */
type Sse = { event: string; data: string; id: string | null; retry: number | null };

function parseEvent(block: string): Sse {
  const out: Sse = { event: 'message', data: '', id: null, retry: null };
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') out.event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') out.id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) out.retry = Number(value);
  }
  out.data = data.join('\n');
  return out;
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((done) => {
  const t = setTimeout(done, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); done(); }, { once: true });
});

/**
 * The held event stream, for an api whose hub does not carry the admin
 * events (`enabled`): read with fetch, since EventSource cannot send the
 * operator token. It stays open, and is opened again from the last event's
 * id (`Last-Event-ID`) after the `retry` it gives, should it end.
 */
export function useAdminEvents(enabled: boolean): 'connecting' | 'open' | 'closed' | 'hub' {
  const qc = useQueryClient();
  const token = useOperatorToken();
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    if (!enabled) return;
    if (!token) { setState('closed'); return; }
    const stop = new AbortController();
    void (async () => {
      let last: string | null = null;
      let retry = 2000;
      while (!stop.signal.aborted) {
        try {
          const headers: Record<string, string> = { accept: 'text/event-stream', authorization: `Bearer ${token}` };
          if (last !== null) headers['last-event-id'] = last;
          const r = await fetch('/admin/v1/events', { headers, signal: stop.signal });
          if (r.status === 401) { setState('closed'); forgetOperatorToken(); return; }
          if (!r.ok || !r.body) throw new Error(String(r.status));
          setState('open');
          // what was missed while it was not open
          if (last === null) refresh(qc, COVERED);
          const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value.replace(/\r\n?/g, '\n');
            let at: number;
            while ((at = buffer.indexOf('\n\n')) >= 0) {
              const e = parseEvent(buffer.slice(0, at));
              buffer = buffer.slice(at + 2);
              if (e.retry !== null) retry = e.retry;
              if (e.id !== null) last = e.id;
              if (!e.data) continue;
              try { deliver(qc, JSON.parse(e.data) as AdminEvent); } catch { /* a malformed event does not stop the rest */ }
            }
          }
        } catch {
          if (stop.signal.aborted) return;
        }
        setState('connecting');
        await sleep(retry, stop.signal);
      }
    })();
    return () => stop.abort();
  }, [qc, token, enabled]);
  return enabled ? state : 'hub';
}
