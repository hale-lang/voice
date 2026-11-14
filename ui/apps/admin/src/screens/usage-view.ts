import type { Schemas, UsageRecordSummary } from '../api/client';

export type ConversationUsage = Schemas['ConversationUsage'];
export type UsageStatus = UsageRecordSummary['status'];

/** The two views of the ledger: each request, or each conversation. */
export type UsageTab = 'requests' | 'conversations';

/**
 * What the Usage page shows, as its URL's query keeps it: the view, and
 * each filter, "" (or false) for any. `since` is how far back, in seconds;
 * the cutoff it names is fixed where the page reads it (`fromOf`), so a
 * query stays the same while the page is open.
 */
export type UsageView = {
  tab: UsageTab;
  project: string;
  key: string;
  model: string;
  account: string;
  status: UsageStatus | '';
  conversation: string;
  metadata: string;
  since: string;
  failures: boolean;
  internal: boolean;
};

export const NO_VIEW: UsageView = { tab: 'requests', project: '', key: '', model: '', account: '', status: '', conversation: '', metadata: '', since: '', failures: false, internal: false };

/** Every status a request ends as (`UsageRecord.status`), as the status filter offers them. */
export const STATUSES: UsageStatus[] = ['served', 'incomplete', 'failed', 'rate_limited', 'budget_exhausted', 'no_capacity', 'deadline_exceeded', 'cancelled', 'abandoned'];

/** The time ranges offered, as how far back, in seconds. */
export const SINCE: { value: string; label: string }[] = [
  { value: '', label: 'any time' },
  { value: '3600', label: 'the last hour' },
  { value: '86400', label: 'the last day' },
  { value: '604800', label: 'the last week' },
];

/**
 * The view a URL's query names. `tab` defaults to conversations when the
 * route opens one (`usage/c/<conversation>`), else to requests; a value no
 * filter takes is dropped.
 */
export function viewOf(query: URLSearchParams, openConversation = false): UsageView {
  const tab = query.get('view');
  const status = query.get('status') ?? '';
  const since = query.get('since') ?? '';
  return {
    tab: tab === 'conversations' || tab === 'requests' ? tab : openConversation ? 'conversations' : 'requests',
    project: query.get('project') ?? '',
    key: query.get('key') ?? '',
    model: query.get('model') ?? '',
    account: query.get('account') ?? '',
    status: (STATUSES as string[]).includes(status) ? (status as UsageStatus) : '',
    conversation: query.get('conversation') ?? '',
    metadata: query.get('metadata') ?? '',
    since: SINCE.some((s) => s.value === since) ? since : '',
    failures: query.get('failures') === '1',
    internal: query.get('internal') === '1',
  };
}

/** The query that names `v`: only what differs from the default. */
export function queryOf(v: UsageView): string {
  const q = new URLSearchParams();
  if (v.tab !== 'requests') q.set('view', v.tab);
  for (const k of ['project', 'key', 'model', 'account', 'status', 'conversation', 'metadata', 'since'] as const) {
    if (v[k]) q.set(k, v[k]);
  }
  if (v.failures) q.set('failures', '1');
  if (v.internal) q.set('internal', '1');
  return q.toString();
}

/** A hash link to `parts` (as `href` writes them) with `v` as its query. */
export function viewHref(v: UsageView, ...parts: string[]): string {
  const q = queryOf(v);
  return '#/' + parts.map(encodeURIComponent).join('/') + (q ? `?${q}` : '');
}

/** True when any filter is set (the view itself aside). */
export function filtered(v: UsageView): boolean {
  return queryOf({ ...v, tab: 'requests' }) !== '';
}

/** The cutoff `since` names from `now` (ms), as RFC 3339; "" for any time. */
export function fromOf(since: string, now: number): string {
  return since ? new Date(now - Number(since) * 1000).toISOString() : '';
}

/**
 * The metadata pairs asked for, each `name=value`, several apart by commas,
 * as the api takes them: one pair as it is, several as a JSON object, all
 * of which a request must have. null when one is not a pair.
 */
export function metadataPairs(m: string): string | null {
  const parts = pairsOf(m);
  if (!parts) return null;
  if (parts.length === 1) return `${parts[0]![0]}=${parts[0]![1]}`;
  return JSON.stringify(Object.fromEntries(parts));
}

function pairsOf(m: string): [string, string][] | null {
  const parts = m.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[^=\s]+=.*$/.test(p))) return null;
  return parts.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]);
}

/** The filters `listUsage` and `summarizeUsage` take, as their query: `from` the cutoff `fromOf` fixed. */
export function requestsQuery(v: UsageView, from: string) {
  const pairs = metadataPairs(v.metadata);
  return {
    ...(v.project ? { project: v.project } : {}),
    ...(v.key.trim() ? { key: v.key.trim() } : {}),
    ...(v.model ? { model: v.model } : {}),
    ...(v.account ? { account: v.account } : {}),
    ...(v.status ? { status: v.status } : {}),
    ...(v.conversation.trim() ? { conversation: v.conversation.trim() } : {}),
    ...(pairs ? { metadata: pairs } : {}),
    ...(from ? { from } : {}),
    ...(v.internal ? { include_internal: true } : {}),
  };
}

/** The filters `listUsageConversations` takes, as its query. */
export function conversationsQuery(v: UsageView, from: string) {
  return {
    ...(v.project ? { project: v.project } : {}),
    ...(v.key.trim() ? { key: v.key.trim() } : {}),
    ...(v.model ? { model: v.model } : {}),
    ...(from ? { from } : {}),
    ...(v.failures ? { has_failures: true } : {}),
    ...(v.internal ? { include_internal: true } : {}),
  };
}

/** The requests view's filters as `runAnnotations` matches requests by them (`UsageMatch`). */
export function matchOf(v: UsageView, from: string): Schemas['UsageMatch'] {
  const pairs = pairsOf(v.metadata);
  const { metadata, ...rest } = requestsQuery(v, from);
  return { ...rest, ...(metadata && pairs ? { metadata: Object.fromEntries(pairs) } : {}) };
}

/**
 * Rows held on screen, and a fresh first page: the fresh rows on top, in
 * their order, and the held ones after that the fresh ones do not
 * replace, so a new request (or a conversation active again) rises to the
 * top while the pages loaded below stay. A fresh page that shares no row
 * with those held is a jump past them (more landed than a page holds, or
 * the held rows are another filter's): it is the rows anew, `reset`.
 */
export function mergeFresh<T>(held: readonly T[], fresh: readonly T[], keyOf: (r: T) => string): { rows: T[]; reset: boolean } {
  const fresher = new Set(fresh.map(keyOf));
  if (!held.length || !held.some((r) => fresher.has(keyOf(r)))) return { rows: [...fresh], reset: true };
  return { rows: [...fresh, ...held.filter((r) => !fresher.has(keyOf(r)))], reset: false };
}

/** Held rows with a page loaded after them: the page's rows that are not held already. */
export function appended<T>(held: readonly T[], page: readonly T[], keyOf: (r: T) => string): T[] {
  const have = new Set(held.map(keyOf));
  return [...held, ...page.filter((r) => !have.has(keyOf(r)))];
}

/** A conversation's row key: a conversation's requests in another project or currency are a row of their own. */
export function conversationKey(c: Pick<ConversationUsage, 'project' | 'conversation' | 'currency'>): string {
  return `${c.project}\u0000${c.conversation}\u0000${c.currency}`;
}

/** The model a request asked for, and what served it when that was another: `asked → served`. */
export function modelSaid(r: Pick<UsageRecordSummary, 'requested_model' | 'served'>): string {
  const served = r.served?.model;
  return served && served !== r.requested_model ? `${r.requested_model} → ${served}` : r.requested_model;
}

/** What each status a request ended as means, said on hover. */
const STATUS_SAID: Record<UsageStatus, string> = {
  served: 'served whole',
  incomplete: 'served, cut short (its output limit, or the engine stopped it)',
  failed: 'a seat failed it after output, or every seat it was offered failed it (502)',
  rate_limited: 'refused by a rate limit',
  budget_exhausted: 'refused: its budget was spent',
  no_capacity: 'waited for a slot and none freed in time (429)',
  deadline_exceeded: 'waited for a slot past its own deadline (504)',
  cancelled: 'its caller went away',
  abandoned: 'the api instance serving it stopped before it settled',
};

/** A status as its hover says it: what it means, and that its seat's errors are in the request. */
export function statusSaid(status: UsageStatus): string {
  const said = STATUS_SAID[status] ?? status;
  return status === 'served' ? said : `${status}: ${said}; open the request for each seat's error`;
}

/** True for a status a request failed with: any but served and incomplete (`failed_requests`). */
export function failedStatus(status: string): boolean {
  return status !== 'served' && status !== 'incomplete';
}

/**
 * A request's input as the table says it: its count with what the seat's
 * prompt cache held, or voice's estimate, marked `≈`, for one cut off
 * before its seat reported any.
 */
export function inputSaid(r: Pick<UsageRecordSummary, 'input_tokens' | 'cached_input_tokens' | 'input_tokens_estimated'>): string {
  const n = r.input_tokens.toLocaleString();
  if (r.input_tokens_estimated) return `≈${n}`;
  return r.cached_input_tokens ? `${n} (${r.cached_input_tokens.toLocaleString()} cached)` : n;
}

/**
 * A seat's throughput on one request: its output tokens over the time it
 * generated, from its first output to its end, as its node measured both,
 * so reading the prompt and a cold start are not counted against it.
 */
export function throughput(r: Pick<UsageRecordSummary, 'timing' | 'output_tokens'>): string {
  const { first_output_ms: first, engine_ms: end } = r.timing;
  if (first == null || end == null || end <= first || r.output_tokens <= 0) return '–';
  return ((1000 * r.output_tokens) / (end - first)).toFixed(1);
}

/** A request in flight, as much of it as a conversation's row reads (the `request` event's data). */
export type Running = { id: string; conversation?: string | null };

export type RowState = { label: string; tone: 'active' | 'fail' | 'wait' | 'quiet'; title: string };

/**
 * A conversation's status: in flight while a request of it is (the api's
 * requests in flight, as the stream tells them), else how its requests
 * ended: each served, or how many failed, and how its latest ended when
 * that is one.
 */
export function conversationState(c: Pick<ConversationUsage, 'conversation' | 'last_request' | 'requests' | 'failed_requests' | 'last_status'>, flying: readonly Running[]): RowState {
  const ended = `its latest request ${c.last_status}`;
  if (flying.some((r) => r.conversation === c.conversation || r.id === c.last_request)) return { label: 'in flight', tone: 'active', title: 'a request of it is being served now' };
  if (!c.failed_requests) {
    return c.last_status === 'incomplete' ? { label: 'incomplete', tone: 'wait', title: ended } : { label: 'served', tone: 'quiet', title: 'every request served' };
  }
  const last = failedStatus(c.last_status);
  return {
    label: `${c.failed_requests} of ${c.requests} failed${last ? `, last ${c.last_status}` : ''}`,
    tone: last ? 'fail' : 'wait',
    title: `${c.failed_requests} of its ${c.requests} requests ended other than served; ${ended}`,
  };
}
