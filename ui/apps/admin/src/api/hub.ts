import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useGet, type Node, type Schemas } from './client';
import { AFFECTS, COVERED, deliver, deliverFlights, refresh, type Flight } from './events';
import { useOperatorToken } from './token';

type AdminEvent = Schemas['AdminEvent'];

/** The hub's admin topics, and the event type each carries (events.ts). */
const ADMIN_TOPICS: Record<string, string> = {
  UsageRecorded: 'usage',
  ChangeMade: 'change',
  AnnotationKept: 'annotation',
  NodeMoved: 'node',
  RequestsInFlight: 'request',
};

/** Whether this api's hub carries the admin events (an api with a database). */
export function useHubCarriesAdmin(): boolean | undefined {
  const hub = useGet('/admin/v1/hub');
  if (hub.isError) return false;
  if (!hub.data) return undefined;
  return hub.data.topics.includes('UsageRecorded');
}

/** One admin topic's frame: its event delivered, or, when the frame could
 * not carry it whole, what it covers read again. */
function adminFrame(qc: QueryClient, topic: string, payload: Record<string, unknown>) {
  const type = ADMIN_TOPICS[topic]!;
  const whole = payload.whole !== false && typeof payload.data === 'string';
  if (!whole) {
    refresh(qc, type === 'change' ? COVERED : AFFECTS[type] ?? COVERED);
    return;
  }
  const data = JSON.parse(payload.data as string) as unknown;
  if (topic === 'RequestsInFlight') {
    if (Array.isArray(data)) deliverFlights(data as Flight[]);
    return;
  }
  deliver(qc, { id: payload.id, at: payload.at, type, data } as AdminEvent);
}

/**
 * The api's hub (GET /admin/v1/hub), over a WebSocket on a port of the api's
 * own (until it can share the api's, hale-lang/hale#1818): the fleet's
 * heartbeats as they arrive, and, where the api has a database, the admin
 * events of every api instance. Each `NodeObserved` is a node whole, as GET
 * /admin/v1/nodes/{id} answers it, so it is written into the nodes the
 * screens already show, with no read; each `InstanceBeat` is an api
 * instance alive; each admin topic's event goes where the event stream's
 * would (events.ts `deliver`).
 */
export type HubState = 'connecting' | 'open' | 'closed';
export type Instance = { id: string; at: string };

let hubState: HubState = 'connecting';
const stateWatchers = new Set<() => void>();
function setHubState(s: HubState) {
  if (s === hubState) return;
  hubState = s;
  for (const w of stateWatchers) w();
}

/** Whether the hub is open: a screen that would read again to follow the fleet need not while it is. */
export function useHubState(): HubState {
  return useSyncExternalStore((w) => { stateWatchers.add(w); return () => { stateWatchers.delete(w); }; }, () => hubState);
}

/** An instance not heard from for this long is shown as gone (it beats every 5 s). */
export const INSTANCE_LAPSE_MS = 15_000;

// An instance's beat reaches only the hub of its own process, so the
// instances shown are those the hub connected to now hears: a connection
// to another instance (a reconnect behind a balancer) starts them again,
// rather than keeping the last one's beats, which would lapse while it
// is alive.
const instances = new Map<string, Instance>();
let snapshot: Instance[] = [];
const watchers = new Set<() => void>();
function told() {
  snapshot = [...instances.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const w of watchers) w();
}
function beat(i: Instance) {
  instances.set(i.id, i);
  told();
}
function forget() {
  instances.clear();
  told();
}

/** The api instances the hub connected to now has announced, each with its last beat. */
export function useInstances(): Instance[] {
  return useSyncExternalStore((w) => { watchers.add(w); return () => { watchers.delete(w); }; }, () => snapshot);
}

/** A node as the hub announced it, written into the nodes list the screens read. */
function observed(qc: QueryClient, node: Node) {
  qc.setQueryData<{ data: Node[] }>(['/admin/v1/nodes', null], (old) => {
    if (!old) return old;
    const at = old.data.findIndex((n) => n.id === node.id);
    const data = at < 0 ? [...old.data, node] : old.data.map((n, i) => (i === at ? node : n));
    return { ...old, data };
  });
}

/**
 * Connect to the hub while the operator token is held, and reconnect after a
 * drop. Called once, by the shell; screens read `useHubState`.
 */
export function useHub(): HubState {
  const qc = useQueryClient();
  const token = useOperatorToken();
  const hub = useGet('/admin/v1/hub');
  const port = hub.data?.port;
  const topicKey = (hub.data?.topics ?? []).join(',');
  const setState = setHubState;
  useEffect(() => {
    if (!token || !port) { setState(hub.isError ? 'closed' : 'connecting'); return; }
    // the topics this hub carries (`GET /admin/v1/hub`)
    const topics = topicKey ? topicKey.split(',') : [];
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.hostname}:${port}/?access_token=${encodeURIComponent(token)}`);
      // each topic's last `seq`: a gap is events shed for a slow
      // subscriber, and what that topic covers is read again
      const last = new Map<string, number>();
      let caughtUp = false;
      socket.onopen = () => {
        forget();
        last.clear();
        caughtUp = false;
        for (const topic of topics) socket?.send(JSON.stringify({ type: 'subscribe', topic }));
      };
      socket.onmessage = (m) => {
        try {
          const f = JSON.parse(String(m.data)) as { type: string; topic?: string; seq?: number; payload?: Record<string, unknown> };
          if (f.type === 'subscribed') {
            setState('open');
            // what was missed while it was not open, once a connection
            if (!caughtUp && f.topic && ADMIN_TOPICS[f.topic]) { caughtUp = true; refresh(qc, COVERED); }
          } else if (f.type === 'refusal' || f.type === 'unauthorized') setState('closed');
          else if (f.type === 'event' && f.topic && typeof f.seq === 'number') {
            const before = last.get(f.topic);
            last.set(f.topic, f.seq);
            const admin = ADMIN_TOPICS[f.topic];
            // a change shed names a resource no event left can say: every
            // admin read again; another topic's gap, what that topic covers
            if (admin && before !== undefined && f.seq > before + 1) refresh(qc, admin === 'change' ? COVERED : AFFECTS[admin] ?? COVERED);
            if (admin && f.payload) adminFrame(qc, f.topic, f.payload);
            else if (f.topic === 'NodeObserved' && typeof f.payload?.body === 'string') {
              observed(qc, JSON.parse(f.payload.body) as Node);
              // a seat that moved changes what can be routed and where placements stand
              void qc.invalidateQueries({ queryKey: ['/admin/v1/routes'] });
            } else if (f.topic === 'InstanceBeat' && typeof f.payload?.instance === 'string' && typeof f.payload.at === 'string') {
              beat({ id: f.payload.instance, at: f.payload.at });
            }
          }
        } catch { /* a malformed frame does not stop the ones after it */ }
      };
      socket.onclose = () => {
        if (stopped) return;
        setState('connecting');
        retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => { stopped = true; clearTimeout(retry); socket?.close(); };
  }, [qc, token, port, hub.isError, topicKey]);
  return useHubState();
}
