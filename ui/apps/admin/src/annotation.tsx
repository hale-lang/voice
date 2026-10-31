import { Status, Mono, count } from '@hale/components';
import { useGet, type Annotation } from './api/client';
import { Fold } from './peek';

/** One answer as the api keeps it: the answer, its probability, every option's. */
type Answer = { answer: string | number | boolean; probability: number; probabilities?: Record<string, number> };
type Pair = { pair: string; applies: boolean; met: boolean; probability: number };
type Body = { before?: Record<string, Answer>; after?: Record<string, Answer>; pairs?: Pair[]; by?: string[]; model?: string; input_tokens?: number };

const pct = (p: number) => `${Math.round(p * 100)}%`;
const body = (a: Annotation): Body => (a.annotations ?? {}) as Body;

/** A request's task and its response's outcome, in a line: `code → answered`. */
export function AnnotationLine({ a }: { a: Annotation }) {
  if (a.status !== 'annotated') return <span className="faint" title={a.reason}>not annotated</span>;
  return (
    <span>
      <Mono>{a.task}</Mono> <span className="faint">→</span> <span className={a.outcome === 'answered' ? undefined : 'c-wait'}>{a.outcome}</span>
    </span>
  );
}

/**
 * A request's annotation, when its project or key annotates (set on
 * Projects): what voice-system's decision model made of the request and of
 * its response, each answer with its probability, and the two paired.
 */
export function AnnotationSection({ id }: { id: string }) {
  const q = useGet('/admin/v1/annotations/{request_id}', { params: { path: { request_id: id } } });
  if (q.isPending) return null;
  if (q.isError) return <p className="faint">Not annotated: annotate is off for its project and key, or it is not read yet.</p>;
  const a = q.data;
  if (a.status !== 'annotated') {
    return (
      <p>
        <Status tone="wait" label="not annotated" /> <span className="muted">{a.reason}</span>
      </p>
    );
  }
  const b = body(a);
  return (
    <section>
      <h3 style={{ marginBottom: 'var(--space-1)' }}>
        Annotation <span className="faint" style={{ fontWeight: 'normal' }}>· <AnnotationLine a={a} /></span>
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        annotated by voice-system{b.model ? <> with <Mono>{b.model}</Mono></> : null}, {count(b.input_tokens ?? 0)} tokens
      </p>
      {(b.pairs ?? []).filter((p) => p.applies).map((p) => (
        <div key={p.pair}>
          <Status tone={p.met ? 'ok' : 'fail'} label={p.pair} /> <span className="faint">{pct(p.probability)}</span>
        </div>
      ))}
      <Fold title="the request" preview={answersLine(b.before)} body={<Answers of={b.before} />} />
      <Fold title="the response" preview={answersLine(b.after)} body={<Answers of={b.after} />} />
    </section>
  );
}

function answersLine(of?: Record<string, Answer>): string {
  return Object.entries(of ?? {}).map(([q, a]) => `${q}: ${String(a.answer)}`).join(' · ');
}

function Answers({ of }: { of?: Record<string, Answer> }) {
  return (
    <div>
      {Object.entries(of ?? {}).map(([q, a]) => (
        <div key={q}>
          <Mono>{q}</Mono> <span className="faint">=</span> {String(a.answer)} <span className="faint">{pct(a.probability)}</span>
        </div>
      ))}
    </div>
  );
}

/** How many of `as` fall in each task and each outcome, the likeliest first. */
export function tally(as: (Annotation | null | undefined)[]) {
  const tasks = new Map<string, number>();
  const outcomes = new Map<string, number>();
  let annotated = 0;
  for (const a of as) {
    if (!a || a.status !== 'annotated') continue;
    annotated++;
    if (a.task) tasks.set(a.task, (tasks.get(a.task) ?? 0) + 1);
    if (a.outcome) outcomes.set(a.outcome, (outcomes.get(a.outcome) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  return { annotated, tasks: sorted(tasks), outcomes: sorted(outcomes) };
}

/** A tally as a line: `5 annotated · code 3, chat 2 · answered 4, refused 1`. */
export function TallyLine({ t }: { t: ReturnType<typeof tally> }) {
  if (!t.annotated) return <span className="faint">none annotated</span>;
  return (
    <span className="muted">
      {t.annotated} annotated · {t.tasks.map(([k, n]) => `${k} ${n}`).join(', ')} · {t.outcomes.map(([k, n]) => `${k} ${n}`).join(', ')}
    </span>
  );
}
