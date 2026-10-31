import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useGet, type Node } from './client';
import { useOperatorToken } from './token';

/**
 * The api's hub (GET /admin/v1/hub): the fleet's heartbeats as they arrive,
 * over a WebSocket on a port of the api's own. Each `NodeObserved` is a node
 * whole, as GET /admin/v1/nodes/{id} answers it, so it is written into the
 * nodes the screens already show, with no read; each `InstanceBeat` is an
 * api instance alive. The store keeps only the latest of each, which the
 * screens' reads answer; the hub carries each as it happens.
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
  const setState = setHubState;
  useEffect(() => {
    if (!token || !port) { setState(hub.isError ? 'closed' : 'connecting'); return; }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.hostname}:${port}/?access_token=${encodeURIComponent(token)}`);
      socket.onopen = () => {
        forget();
        for (const topic of ['NodeObserved', 'InstanceBeat']) socket?.send(JSON.stringify({ type: 'subscribe', topic }));
      };
      socket.onmessage = (m) => {
        try {
          const f = JSON.parse(String(m.data)) as { type: string; topic?: string; payload?: Record<string, unknown> };
          if (f.type === 'subscribed') setState('open');
          else if (f.type === 'refusal' || f.type === 'unauthorized') setState('closed');
          else if (f.type === 'event' && f.topic === 'NodeObserved' && typeof f.payload?.body === 'string') {
            observed(qc, JSON.parse(f.payload.body) as Node);
            // a seat that moved changes what can be routed and where placements stand
            void qc.invalidateQueries({ queryKey: ['/admin/v1/routes'] });
          } else if (f.type === 'event' && f.topic === 'InstanceBeat' && typeof f.payload?.instance === 'string' && typeof f.payload.at === 'string') {
            beat({ id: f.payload.instance, at: f.payload.at });
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
  }, [qc, token, port, hub.isError]);
  return useHubState();
}
