import type { Schemas, NodeSummary } from '../api/client';

/**
 * The brain's board (`getQueues`) as the Queues screen and the live view read
 * it: per model its shape and any change of it, its partitions with their
 * depth and oldest ticket's age; per seat its plan (held and why, or its
 * queues in order) beside how its node says it pulls and the plan version it
 * follows.
 *
 * Pure (no React), so the tests read it as the app does.
 */
export type Board = Schemas['QueueBoard'];
export type BoardQueue = Board['queues'][number];
export type BoardSeat = Board['seats'][number];
export type SeatPull = Schemas['SeatPulls'];

/** How long a queue's oldest ticket has waited, as a tone: none waits, it waits, or it waits long. */
export type AgeTone = 'idle' | 'ok' | 'wait' | 'fail';

/**
 * A ticket waiting longer than this is drawn waiting, and past the second
 * long: a request waits a minute for a seat before it is refused (`429
 * no_capacity`), so half that is late.
 */
export const WAIT_MS = 5_000;
export const LONG_MS = 30_000;
/** A board older than this says the brain is down: the api reads past it, and so does a reader. */
export const STALE_MS = 5_000;

export function ageTone(depth: number, oldestMs: number | null | undefined): AgeTone {
  if (depth <= 0) return 'idle';
  const age = oldestMs ?? 0;
  return age >= LONG_MS ? 'fail' : age >= WAIT_MS ? 'wait' : 'ok';
}

/** An age in ms as a reader says it: `850 ms`, `4.2 s`, `3 min 5 s`. */
export function age(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** A partition's subject without its root and kind: `echo-1.internal.any`, `glm-4%2E7-flash.local.internal.tools`. */
export function shortSubject(subject: string): string {
  const at = subject.indexOf('.work.');
  return at < 0 ? subject : subject.slice(at + 8);
}

/** A model's shape as said: `one account (local)`, `per account`, and any change in progress. */
export function shapeLabel(m: Board['models'][number]): string {
  const now = m.shape === 'm' ? `one account${m.provider_account ? ` (${m.provider_account})` : ''}` : 'per account';
  if (m.next) return `${now}; becoming ${m.next.shape === 'm' ? `one account${m.next.provider_account ? ` (${m.next.provider_account})` : ''}` : 'per account'}`;
  if (m.previous) return `${now}; draining its ${m.previous.shape === 'm' ? 'one-account' : 'per-account'} queues`;
  return now;
}

export type ModelQueues = {
  model: string;
  shape: string;
  partitions: (BoardQueue & { tone: AgeTone })[];
  depth: number;
  oldestMs: number | null;
  tone: AgeTone;
};

/** Each model on the board with its partitions, deepest backlog first, and the backlog across them. */
export function modelQueues(board: Board): ModelQueues[] {
  const out: ModelQueues[] = [];
  for (const m of board.models) {
    const partitions = board.queues
      .filter((q) => q.model === m.model)
      .map((q) => ({ ...q, tone: ageTone(q.depth, q.oldest_age_ms) }))
      .sort((a, b) => b.depth - a.depth || a.subject.localeCompare(b.subject));
    const depth = partitions.reduce((n, q) => n + q.depth, 0);
    const oldest = partitions.reduce<number | null>((o, q) => (q.depth > 0 && q.oldest_age_ms != null && (o == null || q.oldest_age_ms > o) ? q.oldest_age_ms : o), null);
    out.push({ model: m.model, shape: shapeLabel(m), partitions, depth, oldestMs: oldest, tone: ageTone(depth, oldest) });
  }
  return out.sort((a, b) => b.depth - a.depth || a.model.localeCompare(b.model));
}

export type SeatPlanRow = {
  seat: string;
  held: string | null;
  consume: string[];
  ownQueue: number;
  concurrency: number;
  inFlight: number;
  /** How its node says it pulls, the plan version it follows, and its prefill rate: undefined when it has not said (protocol 2, or not yet). */
  pull?: SeatPull;
  prefillRate?: number;
  /** Whether the node follows a plan of the brain's (`plan_version` set) or its own eligibility. */
  following: 'plan' | 'own' | 'unknown';
};

/** Each seat on the board, its plan beside what its node reports (`listNodes`' seats). */
export function seatPlans(board: Board, nodes: NodeSummary[]): SeatPlanRow[] {
  const reported = new Map(nodes.flatMap((n) => n.seats.map((s) => [s.ref, s] as const)));
  const own = new Map(board.queues.filter((q) => q.shape === 's').map((q) => [q.subject, q.depth] as const));
  return board.seats.map((s) => {
    const r = reported.get(s.seat);
    const pull = r?.pull;
    const ownSubject = s.consume[0];
    return {
      seat: s.seat,
      held: s.hold ?? null,
      consume: s.consume,
      ownQueue: ownSubject ? own.get(ownSubject) ?? 0 : 0,
      concurrency: s.concurrency,
      inFlight: s.in_flight,
      ...(pull ? { pull } : {}),
      ...(r?.prefill_rate ? { prefillRate: r.prefill_rate } : {}),
      following: !pull ? 'unknown' : pull.plan_version == null ? 'own' : 'plan',
    };
  });
}

/** A plan version (ms of Postgres's clock) as the time it was written. */
export function planTime(version: number | null | undefined): string | undefined {
  return version == null ? undefined : new Date(version).toISOString();
}

/**
 * The live view's reading of the board: per model, its backlog across its
 * partitions and its oldest ticket's age; per seat, how its node says it
 * pulls. A board stale or missing says nothing.
 */
export function liveQueues(board: Board | undefined): { byModel: Map<string, { depth: number; oldestMs: number | null; tone: AgeTone; partitions: number }>; stale: boolean } {
  const byModel = new Map<string, { depth: number; oldestMs: number | null; tone: AgeTone; partitions: number }>();
  if (!board) return { byModel, stale: true };
  for (const m of modelQueues(board)) byModel.set(m.model, { depth: m.depth, oldestMs: m.oldestMs, tone: m.tone, partitions: m.partitions.length });
  return { byModel, stale: board.age_ms > STALE_MS };
}
