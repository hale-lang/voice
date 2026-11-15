import { when } from '@hale/components/src/format.ts';

/**
 * How long a seat has been in its state (its status and reason), from the
 * `since` its node's reports stamp: "42 s", "12 m", "1 h 12 m", "3 d 4 h".
 * Null when it has none (a seat pending or offline).
 */
export function lasted(since: string | null | undefined, now = Date.now()): string | null {
  if (!since) return null;
  const at = Date.parse(since);
  if (Number.isNaN(at)) return null;
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** A seat's state with how long it has held: "starting · 1 h 12 m", or the state alone. */
export function withLasted(state: string, since: string | null | undefined, now = Date.now()): string {
  const l = lasted(since, now);
  return l ? `${state} · ${l}` : state;
}

/** The exact time a seat's state began, for a hover: "since 15/11/2026, 09:12:04". */
export function sinceExact(since: string | null | undefined): string | undefined {
  return since ? `since ${when(since)}` : undefined;
}
