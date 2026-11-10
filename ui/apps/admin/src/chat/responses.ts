import type { SseEvent } from './sse.ts';

/**
 * One answer as its `/v1/responses` stream builds it: the text, the
 * model's thinking, and, once it ends, what the api says of it (its usage,
 * its `voice`: the request id, the seat and node that served it, its
 * price). Nothing here is guessed: the route and the cost are the api's.
 */
export type Answer = {
  text: string;
  reasoning: string;
  /** started → streaming → completed | incomplete | failed */
  status: 'started' | 'streaming' | 'completed' | 'incomplete' | 'failed';
  requestId?: string;
  /** the api's `voice.served`, once the response ended */
  served?: { model: string; node: string; seat: string; account: string; engine?: string };
  usage?: { input: number; output: number; reasoning?: number };
  priceMicros?: number;
  currency?: string;
  /** the seat's own timing (`voice.timing`) */
  timing?: { wall_ms: number; queue_ms: number; first_output_ms?: number; engine_ms?: number };
  /** seats that failed it before one served (`voice:attempt`) */
  attempts: { seat: string; outcome: string; error?: string }[];
  error?: { code: string; message: string };
  /** why an `incomplete` answer stopped (`max_output_tokens`) */
  incomplete?: string;
  /** keep-alives seen while the seat worked */
  alive: number;
  /** the `[DONE]` line came */
  done: boolean;
};

export function newAnswer(): Answer {
  return { text: '', reasoning: '', status: 'started', attempts: [], alive: 0, done: false };
}

/** True for an event that is output reaching the caller: the first one is the time to first token. */
export function isOutput(ev: SseEvent): boolean {
  const t = typeOf(ev);
  return t === 'response.output_text.delta' || t === 'response.reasoning.delta' || t === 'response.reasoning_text.delta' || t === 'response.reasoning_summary_text.delta' || t === 'response.refusal.delta';
}

function typeOf(ev: SseEvent): string {
  if (ev.event) return ev.event;
  const d = parse(ev.data);
  return d && typeof d.type === 'string' ? d.type : '';
}

type Json = Record<string, unknown>;

function parse(data: string): Json | null {
  try {
    const v = JSON.parse(data);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The answer after `ev`. Unknown events change nothing. */
export function apply(a: Answer, ev: SseEvent): Answer {
  if (ev.data === '[DONE]') return { ...a, done: true };
  const d = parse(ev.data);
  if (!d) return a;
  const type = ev.event || str(d.type);
  switch (type) {
    case 'response.created':
      return { ...a, requestId: requestIdOf(obj(d.response)) ?? a.requestId };
    case 'response.in_progress':
      // the stream opens with one, and voice sends one again as a keep-alive
      return { ...a, alive: a.alive + 1, requestId: a.requestId ?? requestIdOf(obj(d.response)) };
    case 'response.output_text.delta':
    case 'response.refusal.delta':
      return { ...a, status: 'streaming', text: a.text + str(d.delta) };
    case 'response.reasoning.delta':
    case 'response.reasoning_text.delta':
    case 'response.reasoning_summary_text.delta':
      return { ...a, status: 'streaming', reasoning: a.reasoning + str(d.delta) };
    case 'voice:attempt': {
      const at = obj(d.attempt);
      return { ...a, attempts: [...a.attempts, { seat: str(at.seat), outcome: str(at.outcome), error: str(at.error) || undefined }] };
    }
    case 'error': {
      const e = obj(d.error);
      return { ...a, error: { code: str(e.code) || 'error', message: str(e.message) } };
    }
    case 'response.completed':
    case 'response.incomplete':
    case 'response.failed':
      return ended(a, type.slice('response.'.length) as Answer['status'], obj(d.response));
    default:
      return a;
  }
}

function requestIdOf(r: Json): string | undefined {
  const v = obj(r.voice);
  return str(v.request_id) || str(r.id) || undefined;
}

/** The response object a stream ended with: its output whole, its usage and `voice`. */
function ended(a: Answer, status: Answer['status'], r: Json): Answer {
  const out: Answer = { ...a, status };
  // the output as the api has it, where the deltas missed some
  const { text, reasoning } = outputOf(r.output);
  if (text.length > out.text.length) out.text = text;
  if (reasoning.length > out.reasoning.length) out.reasoning = reasoning;
  const u = obj(r.usage);
  const input = num(u.input_tokens);
  const output = num(u.output_tokens);
  if (input !== undefined || output !== undefined) {
    out.usage = { input: input ?? 0, output: output ?? 0, reasoning: num(obj(u.output_tokens_details).reasoning_tokens) };
  }
  const v = obj(r.voice);
  if (Object.keys(v).length) {
    out.requestId = str(v.request_id) || out.requestId;
    const s = obj(v.served);
    if (str(s.seat)) out.served = { model: str(s.model), node: str(s.node), seat: str(s.seat), account: str(s.account), engine: str(s.engine) || undefined };
    out.priceMicros = num(v.price_micros);
    out.currency = str(v.currency) || 'USD';
    const t = obj(v.timing);
    if (num(t.wall_ms) !== undefined) {
      out.timing = { wall_ms: num(t.wall_ms)!, queue_ms: num(t.queue_ms) ?? 0, first_output_ms: num(t.first_output_ms), engine_ms: num(t.engine_ms) };
    }
    if (Array.isArray(v.attempts)) {
      out.attempts = v.attempts.map((x) => obj(x)).map((x) => ({ seat: str(x.seat), outcome: str(x.outcome), error: str(x.error) || undefined }));
    }
  }
  const e = obj(r.error);
  if (status === 'failed' && (str(e.message) || str(e.code))) out.error = { code: str(e.code) || 'error', message: str(e.message) };
  if (status === 'incomplete') out.incomplete = str(obj(r.incomplete_details).reason) || 'incomplete';
  return out;
}

function outputOf(output: unknown): { text: string; reasoning: string } {
  let text = '';
  let reasoning = '';
  if (!Array.isArray(output)) return { text, reasoning };
  for (const raw of output) {
    const item = obj(raw);
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        const p = obj(c);
        if (p.type === 'output_text' || p.type === 'refusal') text += str(p.text) || str(p.refusal);
      }
    } else if (item.type === 'reasoning') {
      for (const part of [...(Array.isArray(item.content) ? item.content : []), ...(Array.isArray(item.summary) ? item.summary : [])]) reasoning += str(obj(part).text);
    }
  }
  return { text, reasoning };
}

/**
 * The answer's pace as the operator saw it: the time to its first output,
 * the whole time, and the output tokens a second from the first output to
 * the end (the api's count of them, once it ended).
 */
export type Pace = { ttftMs?: number; totalMs?: number; tokensPerSecond?: number };

export function paceOf(a: Answer, sentAt: number, firstAt: number | undefined, endAt: number | undefined): Pace {
  const p: Pace = {};
  if (firstAt !== undefined) p.ttftMs = Math.max(0, firstAt - sentAt);
  if (endAt !== undefined) p.totalMs = Math.max(0, endAt - sentAt);
  if (firstAt !== undefined && endAt !== undefined && a.usage && a.usage.output > 0 && endAt > firstAt) {
    p.tokensPerSecond = a.usage.output / ((endAt - firstAt) / 1000);
  }
  return p;
}
