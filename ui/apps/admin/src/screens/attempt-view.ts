/**
 * What the Attempts screen reads off an attempt (`CodingAttempt`) and its
 * transcript, kept apart from the screen so it is tested on its own.
 */
import type { Tone } from '@hale/components';
import type { Schemas } from '../api/client';

type FailureKind = Schemas['AttemptFailureKind'];

/** A state as the screen shows it. */
export function attemptTone(state: string): Tone {
  if (state === 'done') return 'ok';
  if (state === 'failed') return 'fail';
  if (state === 'running') return 'active';
  if (state === 'queued') return 'wait';
  return 'quiet';
}

/** True once an attempt has ended: nothing of it changes after. */
export function attemptEnded(state: string): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}

/** Why an attempt failed (`failure_kind`), in a few words. */
export const FAILURE_WORDS: Record<FailureKind, string> = {
  over_budget: 'over its budget',
  past_deadline: 'past its deadline',
  harness_failed: 'the harness failed',
  no_changes: 'no changes',
  repo_unavailable: 'repository unavailable',
  login_unavailable: 'login unavailable',
  sandbox_failed: 'sandbox failed',
  bundle_too_large: 'bundle too large',
  node_lost: 'node lost',
  key_revoked: 'key revoked',
  internal: 'voice failed',
};

/** An attempt's state as a label: what its node is doing while it runs, why it failed once it failed. */
export function attemptLabel(a: { state: string; phase?: string | null; failure_kind?: FailureKind | null }): string {
  if (a.state === 'failed' && a.failure_kind) return `failed · ${FAILURE_WORDS[a.failure_kind] ?? a.failure_kind}`;
  return a.phase ? `${a.state} · ${a.phase}` : a.state;
}

/** One transcript event (`CodingAttemptEvent`). */
export type AttemptEvent = { seq: number; at: string; kind: 'text' | 'tool' | 'note' | 'error'; text: string };

/** A transcript as `getAttemptTranscript` answers it, one event a line; a line that is not one is passed over. */
export function parseTranscript(text: string): AttemptEvent[] {
  const out: AttemptEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AttemptEvent;
      if (typeof e.seq === 'number' && typeof e.text === 'string') out.push(e);
    } catch {
      // a line cut short: the next read has it whole
    }
  }
  return out;
}

/** A commit, short. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 12) : '–';
}

/** A wall time in words: seconds under two minutes, else minutes. */
export function wall(ms: number): string {
  if (ms < 120000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60000)} min`;
}
