/**
 * What projects, keys and models used over a window, from the ledger's
 * hourly rollup (`getUsageTotals`): the windows offered, the `from` each
 * reads (to the hour, as the totals are), the totals summed by project,
 * key or model, and how often a stream of usage events reads them again.
 */

/** One row of `getUsageTotals`, as the contract says it. */
export type UsageTotal = {
  group: Record<string, string>;
  currency: string;
  requests: number;
  failed_requests: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  price_micros: number;
};

/** The windows a project's usage is shown over; 7 days unless chosen. */
export const WINDOWS = [
  { value: '24h', label: '24 h', hours: 24 },
  { value: '7d', label: '7 d', hours: 24 * 7 },
  { value: '30d', label: '30 d', hours: 24 * 30 },
] as const;
export type UsageWindow = (typeof WINDOWS)[number]['value'];
export const DEFAULT_WINDOW: UsageWindow = '7d';

/** `v` when it names a window, else the default. */
export function windowOf(v: string | null | undefined): UsageWindow {
  return WINDOWS.some((w) => w.value === v) ? (v as UsageWindow) : DEFAULT_WINDOW;
}

const HOUR_MS = 3_600_000;

/**
 * The `from` a window reads at `now`: the start of the hour `hours` before
 * the current one, so the window is whole hours (the totals are to the
 * hour, the current one counted so far) and the query stays the same
 * until the hour turns.
 */
export function windowFrom(w: UsageWindow, now: number): string {
  const hours = WINDOWS.find((x) => x.value === w)!.hours;
  const start = Math.floor(now / HOUR_MS) * HOUR_MS - (hours - 1) * HOUR_MS;
  return new Date(start).toISOString().replace('.000Z', 'Z');
}

/** Totals summed: requests, tokens, and the spend in each currency. */
export type Totals = {
  requests: number;
  failed: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  /** Spend per currency, most first; none when nothing was spent. */
  spend: { currency: string; micros: number }[];
};

export const NO_TOTALS: Totals = { requests: 0, failed: 0, input: 0, cached: 0, output: 0, reasoning: 0, spend: [] };

function added(t: Totals, r: UsageTotal): Totals {
  const spend = t.spend.map((s) => ({ ...s }));
  if (r.price_micros !== 0) {
    const s = spend.find((x) => x.currency === r.currency);
    if (s) s.micros += r.price_micros;
    else spend.push({ currency: r.currency, micros: r.price_micros });
    spend.sort((a, b) => b.micros - a.micros || a.currency.localeCompare(b.currency));
  }
  return {
    requests: t.requests + r.requests,
    failed: t.failed + r.failed_requests,
    input: t.input + r.input_tokens,
    cached: t.cached + r.cached_input_tokens,
    output: t.output + r.output_tokens,
    reasoning: t.reasoning + r.reasoning_tokens,
    spend,
  };
}

/** The rows summed by their group's `field` (a row per currency becomes one). */
export function totalsBy(rows: UsageTotal[], field: 'project' | 'key' | 'model'): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const r of rows) {
    const name = r.group[field];
    if (name === undefined) continue;
    out.set(name, added(out.get(name) ?? NO_TOTALS, r));
  }
  return out;
}

/** The rows summed by `field`, the most spent first, then the most tokens, then by name. */
export function breakdown(rows: UsageTotal[], field: 'key' | 'model'): { name: string; totals: Totals }[] {
  const tokens = (t: Totals) => t.input + t.output;
  const spent = (t: Totals) => t.spend.reduce((n, s) => n + s.micros, 0);
  return [...totalsBy(rows, field)]
    .map(([name, totals]) => ({ name, totals }))
    .sort((a, b) => spent(b.totals) - spent(a.totals) || tokens(b.totals) - tokens(a.totals) || a.name.localeCompare(b.name));
}

/** All of `rows` summed. */
export function sumOf(rows: UsageTotal[]): Totals {
  return rows.reduce(added, NO_TOTALS);
}

/** A token count, short: `950`, `12.3k`, `4.5M`. */
export function tokensSaid(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/**
 * The least time between two reads of the totals a stream of usage events
 * asks for: each request's record is an event, and the totals are to the
 * hour, so a busy ledger is read at most this often.
 */
export const TOTALS_PACE_MS = 5_000;

/** How long a read asked for at `now` waits, the last having been at `last`. */
export function paceWait(last: number, now: number, every = TOTALS_PACE_MS): number {
  return Math.max(0, last + every - now);
}
