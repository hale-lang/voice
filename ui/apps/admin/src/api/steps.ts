import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useGet, type Schemas } from './client';

/**
 * Annotation steps as they happen (the admin stream's `annotation_step`,
 * the hub's `AnnotationStepTaken`): each request's, kept in this browser
 * as they arrive, so a view shows a request's annotation progress live and
 * the board knows what a pending one is doing. A view that opens on a
 * request reads its steps so far (`listAnnotationSteps`) and follows from
 * there.
 */
export type Step = Schemas['AnnotationStep'];

const byRequest = new Map<string, Step[]>();
const watchers = new Set<() => void>();
let version = 0;

/** The most requests whose steps are kept here. */
const KEPT = 400;

/** Steps added: by `seq`, each once, the oldest requests let go past `KEPT`. */
export function addSteps(steps: Step[]) {
  let changed = false;
  for (const s of steps) {
    if (!s || typeof s.request_id !== 'string' || typeof s.seq !== 'number') continue;
    const had = byRequest.get(s.request_id) ?? [];
    if (had.some((x) => x.seq === s.seq)) continue;
    byRequest.delete(s.request_id);
    byRequest.set(s.request_id, [...had, s].sort((a, b) => a.seq - b.seq));
    changed = true;
  }
  while (byRequest.size > KEPT) byRequest.delete(byRequest.keys().next().value!);
  if (!changed) return;
  version += 1;
  for (const w of watchers) w();
}

function useVersion(): number {
  return useSyncExternalStore((w) => { watchers.add(w); return () => { watchers.delete(w); }; }, () => version);
}

/** A request's steps: those read when the view opened, then each as it arrives. */
export function useSteps(id: string | undefined): Step[] {
  const v = useVersion();
  const q = useGet('/admin/v1/annotations/{request_id}/steps', { params: { path: { request_id: id ?? '' } } });
  useEffect(() => { if (q.data) addSteps(q.data.data); }, [q.data]);
  return useMemo(() => (id ? byRequest.get(id) ?? [] : []), [id, v]);
}

/** A request's last step heard here, if any (no read: what the stream told). */
export function useLastStep(id: string | undefined): Step | undefined {
  const v = useVersion();
  return useMemo(() => { const s = id ? byRequest.get(id) : undefined; return s?.[s.length - 1]; }, [id, v]);
}

/** Whether a step ends a request's annotation. */
export const settles = (s: Step | undefined) => s?.step === 'kept' || s?.step === 'not_annotated';

/** A step as a few words: what it is doing now. */
export function stepLabel(s: Step): string {
  switch (s.step) {
    case 'queued': return 'queued';
    case 'started': return `reading ${s.stage}`;
    case 'done': return s.reason ? `${s.stage} failed` : `${s.stage} done`;
    case 'waiting': return `waiting · ${s.stage}`;
    case 'skipped': return `${s.stage} skipped`;
    case 'titled': return 'titled';
    case 'kept': return 'annotated';
    case 'not_annotated': return 'not annotated';
  }
}
