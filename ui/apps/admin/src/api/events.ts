import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Schemas } from './client';
import { forgetOperatorToken, useOperatorToken } from './token';

type AdminEvent = Schemas['AdminEvent'];
const listeners = new Set<(event: AdminEvent) => void>();

/** Share the existing stream; screens do not open a second connection. */
export function subscribeAdminEvents(listener: (event: AdminEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * The admin event stream: each event names a resource that changed, and
 * the queries that show it are refetched. A `reset` refetches everything.
 * It takes the operator token, which EventSource cannot send, so it is read
 * with fetch: each answer is short (the api answers one request per
 * connection), and the next asks again from the last event's id
 * (`Last-Event-ID`) after the `retry` the stream gives.
 */
const AFFECTS: Record<string, string[]> = {
  node: ['/admin/v1/nodes', '/admin/v1/routes', '/admin/v1/placements'],
  seat: ['/admin/v1/nodes', '/admin/v1/routes', '/admin/v1/models', '/admin/v1/placements'],
  account: ['/admin/v1/accounts', '/admin/v1/routes'],
  usage: ['/admin/v1/usage', '/admin/v1/usage/summary', '/admin/v1/projects'],
  change: ['/admin/v1/changes'],
};

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

export function useAdminEvents(): 'connecting' | 'open' | 'closed' {
  const qc = useQueryClient();
  const token = useOperatorToken();
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  useEffect(() => {
    if (!token) { setState('closed'); return; }
    const stop = new AbortController();
    const seen = new Set<string>();
    const receive = (data: string) => {
      try {
        const event = JSON.parse(data) as AdminEvent;
        if (!event || typeof event.id !== 'string' || typeof event.at !== 'string' || !event.data || seen.has(event.id)) return;
        if (event.type === 'usage' && (typeof event.data.id !== 'string' || typeof event.data.project !== 'string' || typeof event.data.requested_model !== 'string' || !event.data.timing || typeof event.data.input_tokens !== 'number' || typeof event.data.output_tokens !== 'number')) return;
        seen.add(event.id);
        if (seen.size > 512) seen.delete(seen.values().next().value!);
        for (const listener of listeners) listener(event);
      } catch { /* A malformed event does not stop subsequent valid events. */ }
    };
    const dispatch = (e: Sse) => {
      if (e.event === 'reset') { seen.clear(); receive(e.data); void qc.invalidateQueries(); return; }
      const keys = AFFECTS[e.event];
      if (!keys) return;
      receive(e.data);
      for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
    };
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
              if (e.data) dispatch(e);
            }
          }
        } catch {
          if (stop.signal.aborted) return;
          setState('connecting');
        }
        await sleep(retry, stop.signal);
      }
    })();
    return () => stop.abort();
  }, [qc, token]);
  return state;
}
