import type { UsageSummary } from '../api/client';

/** How many conversations the board shows. */
export const ROWS = 24;

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
export function flights(groups: Group[]): Flight[] {
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

/** A request in flight, as much of it as the board reads (the `request` event's data). */
export type Running = { id: string; conversation?: string | null };

export type State = { label: string; tone: 'live' | 'ok' | 'fail' | 'quiet' };

/**
 * Whether a request of the row is in flight now: one of its conversation,
 * or, for a request that names none (or an api from before flights carried
 * it), the row's latest turn itself.
 */
export function running(f: Pick<Flight, 'conversation' | 'last_request'>, flying: readonly Running[]): boolean {
  return flying.some((r) => (f.conversation != null && r.conversation === f.conversation) || r.id === f.last_request);
}

/**
 * A conversation's status: in flight while a request of it is (the api's
 * requests in flight, not how recent its last turn was), else how its
 * latest turn ended: served, refused, cancelled or failed. Nothing while
 * that turn is still being read.
 */
export function state(f: Flight, last: { status: string } | undefined, flying: readonly Running[]): State {
  if (running(f, flying)) return { label: 'in flight', tone: 'live' };
  if (!last) return { label: '', tone: 'quiet' };
  if (!FINE.has(last.status)) {
    // a limit, a budget or no seat to take it: refused; anything else failed
    const refused = last.status === 'rate_limited' || last.status === 'budget_exhausted' || last.status === 'no_capacity';
    return { label: refused ? 'refused' : last.status === 'cancelled' ? 'cancelled' : 'failed', tone: 'fail' };
  }
  return { label: 'served', tone: f.turns > 1 ? 'ok' : 'quiet' };
}
