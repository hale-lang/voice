import { useSyncExternalStore } from 'react';

/**
 * Whether the admin events are flowing (the hub's, else the held event
 * stream): set by the shell, read by every query that follows them. While
 * they flow nothing is read on a timer; while they do not, `FALLBACK_MS`
 * keeps the screens converging. A query takes it as its own option
 * (`useRefetchInterval`), so a screen already open starts or stops reading
 * as the events stop or start.
 */
const FALLBACK_MS = 30_000;

let live = false;
const watchers = new Set<() => void>();

export function setEventsLive(next: boolean) {
  if (next === live) return;
  live = next;
  for (const w of watchers) w();
}

/** The refetch interval a query that follows the admin events takes now. */
export function useRefetchInterval(): number | false {
  const now = useSyncExternalStore(
    (w) => { watchers.add(w); return () => { watchers.delete(w); }; },
    () => live,
  );
  return now ? false : FALLBACK_MS;
}
