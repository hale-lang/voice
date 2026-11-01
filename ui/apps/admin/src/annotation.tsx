import { useState } from 'react';
import { Panel, Status, Mono, Select, Table, Loading, Unavailable, count, ago } from '@hale/components';
import { useGet, useAnnotations, type Annotation, type Schemas } from './api/client';
import { readout } from './readout';
import { href } from './route';
import { Fold } from './peek';
import s from './annotation.module.css';

type Answer = Schemas['AnnotationAnswer'];
type Run = Schemas['AnnotationRun'];
type Annotator = Schemas['Annotator'];

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** The headline of an annotation: the request's task and the response's outcome, when the built-in annotators gave them. */
export function AnnotationLine({ a }: { a: Annotation | null }) {
  if (!a) return null;
  if (a.status !== 'annotated') return <span className="faint" title={a.reason}>not annotated</span>;
  const pick = (annotator: string, question: string) => a.answers.find((x) => x.annotator === annotator && x.question === question && !x.skipped);
  const task = pick('request-basics', 'task');
  const outcome = pick('response-basics', 'outcome');
  if (!task && !outcome) return <span className="muted">{a.answers.filter((x) => !x.skipped).length} answers</span>;
  return (
    <span>
      {task && <Mono>{task.answer}</Mono>}
      {task && outcome && <span className="faint"> → </span>}
      {outcome && <span className={outcome.answer === 'answered' ? undefined : 'c-wait'}>{outcome.answer}</span>}
    </span>
  );
}

/**
 * A request's annotation, when its project or key annotates: every answer,
 * by annotator and the version that asked it, with its probability; the
 * rules scored on them.
 */
export function AnnotationSection({ id }: { id: string }) {
  // read as the Board and the conversation read it, under the same query:
  // a request with no annotation (404) is `null`, not an error
  const q = useAnnotations([id])[0]!;
  if (q.isPending) return null;
  if (q.isError) return <p className="faint">Its annotation could not be read: {q.error.message}</p>;
  const a = q.data;
  if (a === null || a === undefined) return <p className="faint">Not annotated: annotate is off for its project and key, or it is not read yet.</p>;
  if (a.status !== 'annotated') {
    return (
      <section>
        <p>
          <Status tone="wait" label="not annotated" /> <span className="muted">{a.reason}</span>
        </p>
        <Runs runs={a.runs} project={a.project} />
      </section>
    );
  }
  const byAnnotator = new Map<string, Answer[]>();
  for (const x of a.answers) byAnnotator.set(x.annotator, [...(byAnnotator.get(x.annotator) ?? []), x]);
  return (
    <section>
      <h3 style={{ marginBottom: 'var(--space-1)' }}>
        Annotation <span className="faint" style={{ fontWeight: 'normal' }}>· <AnnotationLine a={a} /></span>
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        annotated under <Mono>{a.project}-system</Mono>{a.model ? <> with <Mono>{a.model}</Mono></> : null}, {count(a.input_tokens)} tokens, kept apart from its project's usage
        {a.clipped && <span className="c-wait"> · a text was cut to fit: its start and end were read</span>}
      </p>
      {a.title && (
        <p style={{ marginTop: 0 }}>
          <span className="faint">titled its conversation </span>“{a.title}”
        </p>
      )}
      <Runs runs={a.runs} project={a.project} />
      {a.pairs.filter((p) => p.applies).map((p) => (
        <div key={p.rule}>
          <Status tone={p.met ? 'ok' : 'fail'} label={p.name} /> <span className="faint">{pct(p.probability)}</span>
        </div>
      ))}
      {[...byAnnotator.entries()].map(([annotator, answers]) => (
        <Fold
          key={annotator}
          title={`${annotator} · version ${answers[0]!.version} · ${answers[0]!.stage}`}
          preview={answers.filter((x) => !x.skipped).map((x) => `${x.question}: ${x.answer}`).join(' · ')}
          body={
            <div>
              {answers.map((x) => (
                <div key={x.question}>
                  <Mono>{x.question}</Mono> <span className="faint">=</span>{' '}
                  {x.skipped ? <span className="faint">skipped: its condition did not hold</span> : <>{x.answer} <span className="faint">{pct(x.probability)}</span></>}
                  {x.score != null && <span className="faint"> · expected {x.score.toFixed(2)}</span>}
                  {x.conditioned && <span className="c-wait"> · read the request's answers</span>}
                </div>
              ))}
            </div>
          }
        />
      ))}
    </section>
  );
}

/**
 * The requests voice made for an annotation, one line each: its stage and
 * the annotators it asked for, its model, tokens and time, and how it went
 * (a reason when it was skipped or not made). Each made one is a usage
 * record of the project's system key, kept apart from its usage.
 */
export function Runs({ runs, project }: { runs: Run[]; project: string }) {
  if (!runs.length) return null;
  return (
    <div className={s.runs} aria-label="annotation runs">
      {runs.map((r, i) => (
        <div key={i} className={s.run}>
          <Status tone={r.status === 'annotated' ? 'ok' : r.status === 'skipped' ? 'quiet' : 'wait'} label={r.stage} />{' '}
          <Mono>{r.annotators.join(', ')}</Mono>
          {r.model && <span className="faint"> · {r.model}</span>}
          <span className="faint"> · {count(r.input_tokens)} in, {count(r.output_tokens)} out · {r.ms} ms</span>
          {r.request_id && (
            <span className="faint">
              {' '}· <a href={href('usage', r.request_id)} title={`its usage record, under ${project}-system`}>run</a>
            </span>
          )}
          {r.status !== 'annotated' && <span className="c-wait"> · {r.status.replace('_', ' ')}{r.reason ? `: ${r.reason}` : ''}</span>}
        </div>
      ))}
    </div>
  );
}

/** Every question the annotators ask, `<annotator>.<question>`, with its answers in their own order (a choice's options, true and false, a score's levels). */
function questionsOf(annotators: Annotator[]) {
  return annotators.flatMap((a) =>
    a.questions.map((q) => ({
      id: `${a.id}.${q.name}`,
      label: `${a.id} · ${q.name}`,
      answers: q.type === 'noul' ? ['true', 'false'] : (q.options ?? []).map((o) => o.value),
    })),
  );
}

/** An answer's categorical slot: its place among its question's answers, the 9th and on folded into "other", so its color follows it whatever the counts. */
function slot(order: string[], answer: string): string {
  const i = order.indexOf(answer);
  return i >= 0 && i < 8 ? `var(--cat-${i + 1})` : 'var(--cat-other)';
}

export type Slice = { project?: string; key?: string; conversation?: string };

/**
 * What the requests were and what their responses did: a question's answers
 * counted (a bar each, click one to keep only those requests), the same over
 * time, and the requests they keep. Every count is over the slice and the
 * answers chosen.
 */
export function AnnotationsPanel({ slice, title = 'Annotations' }: { slice: Slice; title?: string }) {
  const annotators = useGet('/admin/v1/annotators');
  const questions = questionsOf(annotators.data?.data ?? []);
  const [question, setQuestion] = useState('response-basics.outcome');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [minP, setMinP] = useState('0');
  const [bucket, setBucket] = useState<'hour' | 'day'>('day');
  const answer = Object.keys(chosen).length ? JSON.stringify(chosen) : undefined;
  const filters = {
    ...(slice.project ? { project: slice.project } : {}),
    ...(slice.key ? { key: slice.key } : {}),
    ...(slice.conversation ? { conversation: slice.conversation } : {}),
    ...(answer ? { answer } : {}),
    min_probability: Number(minP),
  };
  const facets = useGet('/admin/v1/annotations/facets', { params: { query: { question, ...filters } } });
  const trend = useGet('/admin/v1/annotations/trend', { params: { query: { question, bucket, ...filters } } });
  const list = useGet('/admin/v1/annotations', { params: { query: { limit: 20, ...filters } } });
  const order = questions.find((q) => q.id === question)?.answers ?? [];
  const toggle = (a: string) => {
    const next = { ...chosen };
    if (next[question] === a) delete next[question];
    else next[question] = a;
    setChosen(next);
  };
  return (
    <Panel title={title} readout={readout(facets, facets.data ? `${facets.data.total} answered` : null)}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-2)' }}>
        <label>
          <div className="faint">question</div>
          <Select value={question} onChange={setQuestion} options={questions.map((q) => ({ value: q.id, label: q.label }))} />
        </label>
        <label>
          <div className="faint">at least</div>
          <Select value={minP} onChange={setMinP} options={[{ value: '0', label: 'any probability' }, { value: '0.5', label: '50%' }, { value: '0.7', label: '70%' }, { value: '0.9', label: '90%' }]} />
        </label>
        <label>
          <div className="faint">over time by</div>
          <Select value={bucket} onChange={(v) => setBucket(v as 'hour' | 'day')} options={[{ value: 'day' }, { value: 'hour' }]} />
        </label>
      </div>
      {Object.keys(chosen).length > 0 && (
        <div className={s.chips}>
          {Object.entries(chosen).map(([q, a]) => (
            <button
              key={q}
              type="button"
              className={s.chip}
              onClick={() => {
                const n = { ...chosen };
                delete n[q];
                setChosen(n);
              }}
              title="stop keeping only these"
            >
              {q} = {a} ×
            </button>
          ))}
        </div>
      )}
      {facets.isPending ? (
        <Loading />
      ) : facets.isError ? (
        <Unavailable what="Annotations" detail={facets.error.message} />
      ) : !facets.data.counts.length ? (
        <p className="faint">No answers to {question} here: a project or key annotates when set to on Projects, once its `decide` alias names a decision model.</p>
      ) : (
        <div className={s.chart}>
          <Facets counts={facets.data.counts} total={facets.data.total} chosen={chosen[question]} onPick={toggle} />
          {trend.data && trend.data.points.length > 0 && <Trend points={trend.data.points} order={order} bucket={bucket} />}
        </div>
      )}
      {list.data && list.data.data.length > 0 && (
        <Table
          rows={list.data.data}
          rowKey={(r) => r.request_id}
          columns={[
            { key: 'when', header: 'When', render: (r) => <span className="muted">{ago(r.created_at)}</span> },
            { key: 'id', header: 'Request', render: (r) => <a href={href('usage', r.request_id)}><Mono>{r.request_id}</Mono></a> },
            { key: 'p', header: 'Project', render: (r) => <Mono>{r.project}</Mono> },
            { key: 'c', header: 'Conversation', render: (r) => (r.conversation ? <a href={href('usage', 'c', r.conversation)}><Mono>{r.conversation}</Mono></a> : <span className="faint">–</span>) },
            { key: 's', header: 'Annotated', render: (r) => (r.status === 'annotated' ? (r.clipped ? <span className="c-wait">yes, a text cut</span> : 'yes') : <span className="c-wait" title={r.reason}>no</span>) },
          ]}
        />
      )}
    </Panel>
  );
}

/** A question's answers counted: a bar each, its count beside it; one picked keeps only its requests. */
function Facets({ counts, total, chosen, onPick }: { counts: { answer: string; count: number }[]; total: number; chosen?: string; onPick: (a: string) => void }) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <div className={s.facets} role="table" aria-label="answers counted">
      {counts.map((c) => (
        <div key={c.answer} role="row" style={{ display: 'contents' }}>
          <span role="cell">
            <button type="button" className={`${s.label} ${chosen === c.answer ? s.on : ''}`} onClick={() => onPick(c.answer)} title={chosen === c.answer ? 'keep every answer' : `keep only ${c.answer}`}>
              {c.answer}
            </button>
          </span>
          <div role="cell" className={s.track} title={`${c.answer}: ${c.count} of ${total} (${pct(c.count / Math.max(1, total))})`}>
            <div className={s.bar} style={{ width: `${(100 * c.count) / max}%` }} />
          </div>
          <span role="cell" className={s.value}>{count(c.count)}</span>
        </div>
      ))}
    </div>
  );
}

/** Each bucket's answers stacked, oldest first: a column a bucket, a slot of the categorical palette an answer. */
function Trend({ points, order, bucket }: { points: { at: string; answer: string; count: number }[]; order: string[]; bucket: 'hour' | 'day' }) {
  const buckets = [...new Set(points.map((p) => p.at))];
  const answers = [...new Set(points.map((p) => p.answer))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const totals = buckets.map((b) => points.filter((p) => p.at === b).reduce((n, p) => n + p.count, 0));
  const max = Math.max(1, ...totals);
  // the buckets are UTC hours and days, and labelled so
  const label = (at: string) => (bucket === 'day' ? at.slice(0, 10) : `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`);
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <div className={s.legend}>
        {answers.map((a) => (
          <span key={a}>
            <span className={s.swatch} style={{ background: slot(order, a) }} />
            {a}
          </span>
        ))}
      </div>
      <div className={s.trend} role="img" aria-label={`answers by ${bucket}, ${buckets.length} ${bucket}s`}>
        {buckets.map((b, i) => (
          <div key={b} className={s.column} title={`${label(b)}: ${points.filter((p) => p.at === b).map((p) => `${p.answer} ${p.count}`).join(', ')}`} style={{ height: `${(100 * totals[i]!) / max}%` }}>
            {answers.map((a) => {
              const n = points.find((p) => p.at === b && p.answer === a)?.count ?? 0;
              return n ? <div key={a} className={s.segment} style={{ flex: n, background: slot(order, a) }} /> : null;
            })}
          </div>
        ))}
      </div>
      <div className={s.axis}>
        <span>{label(buckets[0]!)}</span>
        <span>most in a {bucket}: {max}</span>
        <span>{label(buckets[buckets.length - 1]!)}</span>
      </div>
    </div>
  );
}
