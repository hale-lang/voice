import { useEffect, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Status, Form, Field, TextInput, TextArea, Select, Checkbox, Button, Confirm, when } from '@hale/components';
import { useGet, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go } from '../route';
import { readout } from '../readout';

type Annotator = Schemas['Annotator'];
type Rule = Schemas['AnnotationRule'];
type Question = Schemas['AnnotatorQuestion'];

/**
 * The annotators: the questions a decision model is asked about each request
 * whose project or key annotates, at the request stage or the response's;
 * and the rules that pair their answers. Each edit of an annotator is a new
 * version, which every answer names. Voice ships two annotators and four
 * rules: edited and disabled, never removed.
 */
export function Annotators({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const ruleSel = route.parts[1] === 'rules' ? route.parts[2] : undefined;
  const q = useGet('/admin/v1/annotators');
  const rules = useGet('/admin/v1/annotation-rules');
  const annotator = q.data?.data.find((a) => a.id === selected);
  const rule = rules.data?.data.find((r) => r.id === ruleSel);
  const creating = selected === 'new';
  const creatingRule = ruleSel === 'new';

  useEffect(() => {
    setInspector(
      creating ? <AnnotatorEditor /> : annotator ? <AnnotatorInspector annotator={annotator} /> : creatingRule ? <RuleEditor /> : rule ? <RuleEditor rule={rule} /> : null,
    );
  }, [creating, annotator, creatingRule, rule, setInspector]);

  if (q.isPending || rules.isPending) return <Loading what="annotators" />;
  if (q.isError) return <Unavailable what="Annotators" detail={q.error.message} />;
  if (rules.isError) return <Unavailable what="Rules" detail={rules.error.message} />;
  if (selected && selected !== 'rules' && !creating && !annotator) return <Missing what={`annotator ${selected}`} />;

  const asked = (stage: 'request' | 'response') =>
    q.data.data.filter((a) => a.enabled && a.stage === stage).reduce((n, a) => n + a.questions.length, 0);
  return (
    <>
      <h1>Annotators</h1>
      <Panel title="Annotators" readout={readout(q, `${q.data.data.length} · request ${asked('request')}/64 · response ${asked('response')}/64 questions`)}>
        <Table<Annotator>
          rows={q.data.data}
          rowKey={(a) => a.id}
          selectedKey={selected}
          onSelect={(a) => go('annotators', a.id)}
          columns={[
            { key: 'id', header: 'Annotator', render: (a) => <><Mono>{a.id}</Mono>{a.builtin && <span className="faint"> · voice's own</span>}</> },
            { key: 'name', header: 'Name', render: (a) => a.name },
            { key: 'stage', header: 'Stage', render: (a) => a.stage + (a.reads_request ? ' · reads the request\'s answers' : '') },
            { key: 'q', header: 'Questions', num: true, render: (a) => a.questions.length },
            { key: 'v', header: 'Version', num: true, render: (a) => a.version },
            { key: 'scope', header: 'Scope', render: (a) => scopeLine(a.scope) },
            { key: 'on', header: 'State', render: (a) => <Status tone={a.enabled ? 'active' : 'quiet'} label={a.enabled ? 'asking' : 'disabled'} /> },
          ]}
          empty="No annotators."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('annotators', 'new')} tone="primary">make an annotator</Button>
        </p>
      </Panel>
      <Panel title="Rules" readout={readout(rules, `${rules.data.data.length} rules`)}>
        <Table<Rule>
          rows={rules.data.data}
          rowKey={(r) => r.id}
          selectedKey={ruleSel}
          onSelect={(r) => go('annotators', 'rules', r.id)}
          columns={[
            { key: 'name', header: 'Rule', render: (r) => <>{r.name}{r.builtin && <span className="faint"> · voice's own</span>}</> },
            { key: 'when', header: 'When', render: (r) => (r.condition ? <Mono>{condLine(r.condition)}</Mono> : <span className="faint">always</span>) },
            { key: 'expect', header: 'Expects', render: (r) => <Mono>{`${r.expect.annotator}.${r.expect.question} ${r.expect.at_least ? `≥ ${r.expect.at_least}` : `= ${r.expect.answer}`}`}</Mono> },
            { key: 'on', header: 'State', render: (r) => <Status tone={r.enabled ? 'active' : 'quiet'} label={r.enabled ? 'scored' : 'disabled'} /> },
          ]}
          empty="No rules."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('annotators', 'rules', 'new')} tone="primary">make a rule</Button>
        </p>
      </Panel>
    </>
  );
}

const scopeLine = (s: Annotator['scope']) =>
  !s.projects.length && !s.keys.length ? <span className="faint">every request that annotates</span> : [...s.projects.map((p) => `project ${p}`), ...s.keys.map((k) => `key ${k}`)].join(', ');

const condLine = (c: Schemas['AnnotationCondition']) => `${c.annotator}.${c.question} = ${c.answer} (p ≥ ${c.min_probability ?? 0.5})`;

/** An annotator: its questions, at its current version or an earlier one; edited, disabled, backfilled, removed. */
function AnnotatorInspector({ annotator: a }: { annotator: Annotator }) {
  const w = useWrite();
  const [version, setVersion] = useState(a.version);
  const [editing, setEditing] = useState(false);
  const old = useGet('/admin/v1/annotators/{annotator}', { params: { path: { annotator: a.id }, query: { version } } });
  const shown = version === a.version ? a : old.data ?? a;
  if (editing) return <AnnotatorEditor annotator={a} done={() => setEditing(false)} />;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-1)' }}>
        <Mono>{a.id}</Mono> <Status tone={a.enabled ? 'active' : 'quiet'} label={a.enabled ? 'asking' : 'disabled'} />
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {a.name} · the {a.stage} stage{a.reads_request ? ', reading the request\'s answers' : ''} · {scopeLine(a.scope)}
      </p>
      <Kv
        rows={[
          {
            k: 'version',
            v: (
              <Select value={String(version)} onChange={(v) => setVersion(Number(v))} options={Array.from({ length: a.version }, (_, i) => ({ value: String(a.version - i), label: `${a.version - i}${i === 0 ? ' (current)' : ''}` }))} />
            ),
          },
          { k: 'made', v: when(a.created_at) },
          { k: 'edited', v: when(a.updated_at) },
        ]}
      />
      <h3>Questions{version !== a.version ? ` at version ${version}` : ''}</h3>
      {shown.questions.map((qn) => <QuestionView key={qn.name} q={qn} />)}
      <p style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button onClick={() => setEditing(true)}>edit: a new version</Button>
        <Button onClick={async () => { await w.write('patch', '/admin/v1/annotators/{annotator}', { params: { path: { annotator: a.id } }, body: { enabled: !a.enabled } }); }} disabled={w.busy}>
          {a.enabled ? 'disable' : 'enable'}
        </Button>
        {!a.builtin && <Confirm label="remove" confirm="remove: its answers stay" onConfirm={async () => { if (await w.write('delete', '/admin/v1/annotators/{annotator}', { params: { path: { annotator: a.id } } })) go('annotators'); }} />}
      </p>
      <Backfill annotator={a} />
      {w.error && <p className="c-fail">{w.error}</p>}
    </>
  );
}

function QuestionView({ q }: { q: Question }) {
  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <Mono>{q.name}</Mono> <span className="faint">{q.type}</span> {q.instructions}
      {q.options && q.options.length > 0 && <div className="muted">{q.options.map((o) => o.value + (o.description ? ` (${o.description})` : '')).join(' · ')}</div>}
      {q.condition && <div className="c-wait">asked only when {condLine(q.condition)}</div>}
    </div>
  );
}

/** Ask this annotator of past requests whose recording still exists (peek, seven days). */
function Backfill({ annotator: a }: { annotator: Annotator }) {
  const w = useWrite();
  const projects = useGet('/admin/v1/projects');
  const [project, setProject] = useState('');
  const [queued, setQueued] = useState<number | null>(null);
  return (
    <Form
      error={w.error}
      onSubmit={async () => {
        const r = await w.write('post', '/admin/v1/annotation-backfills', { body: { annotator: a.id, version: a.version, ...(project ? { project } : {}) } });
        if (r) setQueued((r as { queued: number }).queued);
      }}
      actions={<Button type="submit" disabled={w.busy}>annotate past requests</Button>}
    >
      <Field label="past requests" help="the newest 200 recorded (peek keeps a request seven days); voice keeps no other text">
        <Select value={project} onChange={setProject} empty="every project" options={(projects.data?.data ?? []).filter((p) => !p.internal).map((p) => ({ value: p.id }))} />
      </Field>
      {queued != null && <p className="muted">{queued} recorded request{queued === 1 ? '' : 's'} being asked, as voice-system's requests</p>}
    </Form>
  );
}

const QUESTION_HELP = '[{"name": "polite", "type": "noul", "instructions": "Is it polite?"}, {"name": "tone", "type": "choice", "instructions": "What tone?", "options": [{"value": "warm"}, {"value": "curt"}]}]';

/** Make an annotator, or a new version of one: its questions as JSON (AnnotatorQuestion), checked by the api. */
function AnnotatorEditor({ annotator: a, done }: { annotator?: Annotator; done?: () => void }) {
  const w = useWrite();
  const [id, setId] = useState('');
  const [name, setName] = useState(a?.name ?? '');
  const [stage, setStage] = useState<'request' | 'response'>(a?.stage ?? 'request');
  const [questions, setQuestions] = useState(a ? JSON.stringify(a.questions, null, 2) : '');
  const [reads, setReads] = useState(a?.reads_request ?? false);
  const [projects, setProjects] = useState((a?.scope.projects ?? []).join(', '));
  const [keys, setKeys] = useState((a?.scope.keys ?? []).join(', '));
  const [bad, setBad] = useState<string | null>(null);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <Form
      error={bad ?? w.error}
      onSubmit={async () => {
        let parsed: Question[];
        try {
          parsed = JSON.parse(questions) as Question[];
        } catch (e) {
          setBad(`questions: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        setBad(null);
        const scope = { projects: list(projects), keys: list(keys) };
        if (a) {
          if (await w.write('patch', '/admin/v1/annotators/{annotator}', { params: { path: { annotator: a.id } }, body: { name, questions: parsed, scope, reads_request: reads } })) done?.();
        } else if (await w.write('post', '/admin/v1/annotators', { body: { id, name, stage, questions: parsed, scope, reads_request: reads, enabled: true } })) go('annotators', id);
      }}
      actions={
        <>
          <Button type="submit" tone="primary" disabled={w.busy}>{a ? `save as version ${a.version + 1}` : 'make it'}</Button>
          <Button onClick={() => (done ? done() : go('annotators'))}>cancel</Button>
        </>
      }
    >
      <h2>{a ? <>Edit <Mono>{a.id}</Mono></> : 'An annotator'}</h2>
      {!a && (
        <Field label="id" required help="lowercase letters, digits and dashes">
          <TextInput mono value={id} onChange={setId} required />
        </Field>
      )}
      <Field label="name" required>
        <TextInput value={name} onChange={setName} required />
      </Field>
      {!a && (
        <Field label="stage" help="request: asked of the request's text; response: of its response, read beside the request">
          <Select value={stage} onChange={(v) => setStage(v as 'request' | 'response')} options={[{ value: 'request' }, { value: 'response' }]} />
        </Field>
      )}
      {stage === 'response' && <Checkbox checked={reads} onChange={setReads} label="reads the request's answers too (its answers are marked conditioned)" />}
      <Field label="questions" required help={`choice (1–255 options), noul (yes or no), score (2–10 integer levels in order); a response question may carry a condition on a request answer. e.g. ${QUESTION_HELP}`}>
        <TextArea mono rows={14} value={questions} onChange={setQuestions} required />
      </Field>
      <Field label="projects" help="its scope: these projects and their children; with no keys either, every request that annotates">
        <TextInput mono value={projects} onChange={setProjects} placeholder="work, research" />
      </Field>
      <Field label="keys">
        <TextInput mono value={keys} onChange={setKeys} placeholder="k_…" />
      </Field>
    </Form>
  );
}

/** Make a rule, or change one. */
function RuleEditor({ rule: r }: { rule?: Rule }) {
  const w = useWrite();
  const [id, setId] = useState('');
  const [name, setName] = useState(r?.name ?? '');
  const [when_, setWhen] = useState(r?.condition ? `${r.condition.annotator}.${r.condition.question}=${r.condition.answer}` : '');
  const [minP, setMinP] = useState(String(r?.condition?.min_probability ?? 0.5));
  const [expect, setExpect] = useState(r ? `${r.expect.annotator}.${r.expect.question}${r.expect.at_least ? '>=' + r.expect.at_least : '=' + r.expect.answer}` : '');
  const [bad, setBad] = useState<string | null>(null);
  const part = (s: string) => {
    const m = /^([a-z0-9-]+)\.([a-z0-9_]+)(>=|=)(.+)$/.exec(s.trim());
    return m ? { annotator: m[1]!, question: m[2]!, op: m[3]!, value: m[4]! } : null;
  };
  return (
    <>
      <Form
        error={bad ?? w.error}
        onSubmit={async () => {
          const e = part(expect);
          const c = when_.trim() ? part(when_) : null;
          if (!e || (when_.trim() && (!c || c.op !== '='))) {
            setBad('write each as <annotator>.<question>=<answer> (an expectation of a score may be >=<level>)');
            return;
          }
          setBad(null);
          const body = {
            name,
            condition: c ? { annotator: c.annotator, question: c.question, answer: c.value, min_probability: Number(minP) } : null,
            expect: e.op === '>=' ? { annotator: e.annotator, question: e.question, at_least: e.value } : { annotator: e.annotator, question: e.question, answer: e.value },
          };
          if (r) await w.write('patch', '/admin/v1/annotation-rules/{rule}', { params: { path: { rule: r.id } }, body });
          else if (await w.write('post', '/admin/v1/annotation-rules', { body: { id, ...body, condition: body.condition ?? undefined, enabled: true } })) go('annotators', 'rules', id);
        }}
        actions={<Button type="submit" tone="primary" disabled={w.busy}>{r ? 'save' : 'make it'}</Button>}
      >
        <h2>{r ? r.name : 'A rule'}</h2>
        {!r && (
          <Field label="id" required>
            <TextInput mono value={id} onChange={setId} required />
          </Field>
        )}
        <Field label="name" required>
          <TextInput value={name} onChange={setName} required />
        </Field>
        <Field label="when" help="a request answer, e.g. request-basics.asks_for_code=true; empty, always">
          <TextInput mono value={when_} onChange={setWhen} />
        </Field>
        <Field label="at least probability">
          <TextInput mono value={minP} onChange={setMinP} />
        </Field>
        <Field label="expects" required help="a response answer, e.g. response-basics.contains_code=true, or a score's level or higher, response-basics.completeness>=3">
          <TextInput mono value={expect} onChange={setExpect} required />
        </Field>
      </Form>
      {r && (
        <p style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button onClick={async () => { await w.write('patch', '/admin/v1/annotation-rules/{rule}', { params: { path: { rule: r.id } }, body: { enabled: !r.enabled } }); }} disabled={w.busy}>
            {r.enabled ? 'disable' : 'enable'}
          </Button>
          {!r.builtin && <Confirm label="remove" confirm="remove the rule" onConfirm={async () => { if (await w.write('delete', '/admin/v1/annotation-rules/{rule}', { params: { path: { rule: r.id } } })) go('annotators'); }} />}
        </p>
      )}
      {r && <p className="muted">Rules are scored when an annotation is read: a change applies to every annotation, old ones too.</p>}
    </>
  );
}
