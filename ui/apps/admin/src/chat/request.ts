import { SseReader, type SseEvent } from './sse.ts';
import type { Conversation } from './store.ts';
import { WEB_FETCH_TOOLS } from './tools.ts';

/**
 * How Chat reaches inference: the caller plane's own `/v1/responses`,
 * streamed, with the operator token and `Voice-Project` naming the project
 * the request is charged to (spec/openapi.yaml, "The operator, charged to a
 * project"). The api serves it as that project's operator key, so the
 * routing, the limits, the budget and the usage record are a caller's.
 */
export const VOICE_PROJECT = 'Voice-Project';

/** The headers of a request charged to `project`. */
export function chargedTo(token: string, project: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, [VOICE_PROJECT]: project };
}

/**
 * The `/v1/responses` body for the conversation's next answer: every turn
 * so far, then the stream. With `webFetch` (the chat turned it on, where it
 * is offered) it lists the hosted `web_fetch` tool.
 */
export function bodyOf(c: Conversation, webFetch = false): Record<string, unknown> {
  const o = c.options;
  const body: Record<string, unknown> = {
    model: c.model,
    stream: true,
    input: c.messages.filter((m) => m.text.trim() !== '' || m.role === 'user').map((m) => ({ type: 'message', role: m.role, content: m.text })),
    // one conversation, one cache key: its seat's prompt cache holds what it said
    prompt_cache_key: c.id,
  };
  if (c.system.trim()) body.instructions = c.system;
  if (o.temperature !== null) body.temperature = o.temperature;
  if (o.top_p !== null) body.top_p = o.top_p;
  if (o.max_output_tokens !== null) body.max_output_tokens = o.max_output_tokens;
  if (o.effort) body.reasoning = { effort: o.effort };
  if (webFetch) body.tools = WEB_FETCH_TOOLS;
  return body;
}

/** A request the api refused before any stream: its status, code and words, and when to ask again. */
export type Refused = { status: number; code: string; message: string; retryAfter?: number };

/** What a refusal says: the caller plane's `{"error": {...}}`, else the status alone. */
export function refusedOf(status: number, retryAfter: string | null, body: string): Refused {
  let code = '';
  let message = '';
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }).error;
    if (e && typeof e === 'object') {
      code = typeof e.code === 'string' ? e.code : '';
      message = typeof e.message === 'string' ? e.message : '';
    }
  } catch {
    // not the caller plane's envelope: the status says it
  }
  const out: Refused = { status, code, message: message || body.trim().slice(0, 300) || `the api answered ${status}` };
  const s = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(s) && s >= 0) out.retryAfter = s;
  return out;
}

/** A refusal in one plain line: `429 rate_limited: … · retry in 12s`. */
export function refusedLine(r: Refused): string {
  return `${r.status}${r.code ? ` ${r.code}` : ''}: ${r.message}${r.retryAfter !== undefined ? ` · retry in ${r.retryAfter}s` : ''}`;
}

/**
 * Stream the conversation's next answer: each event to `onEvent` as it
 * comes. Resolves when the stream ends (or `signal` stops it); a refusal
 * before the stream is thrown as `Refused`.
 */
export async function stream(c: Conversation, token: string, signal: AbortSignal, onEvent: (ev: SseEvent) => void, webFetch = false): Promise<void> {
  const r = await fetch('/v1/responses', {
    method: 'POST',
    headers: { ...chargedTo(token, c.project), 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(bodyOf(c, webFetch)),
    signal,
  });
  if (!r.ok || !r.body) {
    throw refusedOf(r.status, r.headers.get('retry-after'), await r.text().catch(() => ''));
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const ev of sse.feed(decoder.decode(value, { stream: true }))) onEvent(ev);
  }
  for (const ev of sse.feed(decoder.decode())) onEvent(ev);
  for (const ev of sse.end()) onEvent(ev);
}

export function isRefused(e: unknown): e is Refused {
  return !!e && typeof e === 'object' && 'status' in e && 'message' in e && typeof (e as Refused).status === 'number';
}
