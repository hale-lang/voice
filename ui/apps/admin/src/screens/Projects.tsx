import { useEffect, useState } from 'react';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, NumberInput, Select, ListInput, Button, Confirm, Secret, micros, when, ago } from '@hale/components';
import { useGet, type Project, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go } from '../route';
import { readout } from '../readout';
import { toneOf } from '../tone';
import { LimitsEditor, limitsForWrite, type Limit } from '../LimitsEditor';
import { describeLimit } from './Accounts';

type Key = Schemas['Key'];

/** Projects: who is asking, what they may spend, and their keys. */
export function Projects({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/projects', { params: { query: { include_archived: true } } });
  const project = q.data?.data.find((p) => p.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <CreateProject /> : project ? <ProjectInspector project={project} /> : null);
  }, [creating, project, setInspector]);

  if (q.isPending) return <Loading what="projects" />;
  if (q.isError) return <Unavailable what="Projects" detail={q.error.message} />;
  if (selected && !creating && !project) return <Missing what={`project ${selected}`} />;

  return (
    <>
      <h1>Projects</h1>
      <Panel title="Projects" readout={readout(q, `${q.data.data.length} projects`)}>
        <Table<Project>
          rows={inTree(q.data.data)}
          rowKey={(p) => p.id}
          selectedKey={selected}
          onSelect={(p) => go('projects', p.id)}
          columns={[
            { key: 'id', header: 'Project', render: (p) => (p.parent ? <><span className="faint">↳ </span><Mono>{p.id}</Mono></> : <Mono>{p.id}</Mono>) },
            { key: 'name', header: 'Name', render: (p) => p.name },
            { key: 'status', header: 'State', render: (p) => <Status tone={toneOf(p.status)} label={p.status} /> },
            { key: 'keys', header: 'Keys', num: true, render: (p) => p.key_count ?? 0 },
            { key: 'accounts', header: 'Accounts', render: (p) => (p.inherits ? <span className="muted">{p.parent}'s</span> : p.accounts ? (p.accounts.length ? p.accounts.join(', ') : <span className="c-wait">none</span>) : <span className="muted">any</span>) },
            { key: 'spent', header: 'Spent', num: true, render: (p) => (p.budget ? micros(p.budget.spent_micros, p.budget.currency) : <span className="faint">no budget</span>) },
            { key: 'budget', header: 'Allowance', num: true, render: (p) => (p.budget ? `${micros(p.budget.allowance_micros, p.budget.currency)} / ${p.budget.period}` : '') },
          ]}
          empty="No projects. Create one, then keys under it."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('projects', 'new')} tone="primary">new project</Button>
        </p>
      </Panel>
      {project && <Keys project={project} />}
    </>
  );
}

/** A list that may be none, any, or some names: `[]`, `null`, or the names. */
type Scope = 'none' | 'any' | 'these' | 'parent' | 'kept';
const scopeOf = (v: string[] | null | undefined, empty: Scope): Scope => (v == null ? 'any' : v.length ? 'these' : empty);

/** Projects in order, each followed by its children: a habitat's callers under it. */
function inTree(all: Project[]): Project[] {
  const ids = new Set(all.map((p) => p.id));
  const out: Project[] = [];
  for (const p of all) {
    if (p.parent && ids.has(p.parent)) continue;
    out.push(p);
    for (const c of all) if (c.parent === p.id) out.push(c);
  }
  return out;
}

/** The projects that may be a parent of `of`: of no parent of their own, not archived, not `of`. */
function parentsFor(all: Project[], of?: string): Project[] {
  return all.filter((q) => !q.parent && q.status !== 'archived' && q.id !== of);
}

function CreateProject() {
  const w = useWrite();
  const projects = useGet('/admin/v1/projects');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [dataClasses, setDataClasses] = useState<string[]>(['internal']);
  const [accounts, setAccounts] = useState<string[]>([]);
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>New project</h2>
      <Form
        error={w.error}
        onSubmit={async () => {
          // a child with no accounts of its own inherits its parent's
          const spends = parent ? (accounts.length ? { accounts } : {}) : { accounts: accounts.length ? accounts : null };
          const r = await w.write('post', '/admin/v1/projects', { body: { id, name, data_classes: dataClasses, ...spends, ...(parent ? { parent } : {}) } });
          if (r) go('projects', id);
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy}>create</Button>
            <Button onClick={() => go('projects')}>cancel</Button>
          </>
        }
      >
        <Field label="id" required help="lowercase, digits and dashes; never reused">
          <TextInput mono value={id} onChange={setId} required pattern="^[a-z0-9][a-z0-9-]{0,62}$" placeholder="work" />
        </Field>
        <Field label="name" required>
          <TextInput value={name} onChange={setName} required />
        </Field>
        <Field label="parent" help="a subproject of another; it inherits the parent's accounts unless given its own">
          <Select value={parent} onChange={setParent} options={[{ value: '', label: 'none: a project of its own' }, ...parentsFor(projects.data?.data ?? []).map((q) => ({ value: q.id, label: q.id }))]} />
        </Field>
        <Field label="data classes" help="what this project may send; comma-separated">
          <ListInput value={dataClasses} onChange={setDataClasses} />
        </Field>
        <Field label="accounts" help={parent ? `what it may spend; empty for ${parent}'s, inherited` : 'what it may spend; empty for any. Client work names the work account here.'}>
          <ListInput mono value={accounts} onChange={setAccounts} placeholder="claude-work" />
        </Field>
      </Form>
    </>
  );
}

function ProjectInspector({ project: p }: { project: Project }) {
  const w = useWrite();
  const [mode, setMode] = useState<'view' | 'budget' | 'limits' | 'access'>('view');
  const [accountScope, setAccountScope] = useState<Scope>(p.inherits ? 'parent' : scopeOf(p.accounts, 'none'));
  const [accountNames, setAccountNames] = useState<string[]>(p.accounts ?? []);
  const [modelScope, setModelScope] = useState<Scope>(scopeOf(p.models, 'none'));
  const [modelNames, setModelNames] = useState<string[]>(p.models ?? []);
  const known = useGet('/admin/v1/accounts');
  const projects = useGet('/admin/v1/projects');
  const [parent, setParent] = useState(p.parent ?? '');
  // a child may inherit its parent's accounts; a parent cannot become one
  const child = Boolean(parent);
  const isParent = (projects.data?.data ?? []).some((q) => q.parent === p.id);
  const [allowance, setAllowance] = useState<number | null>(p.budget ? p.budget.allowance_micros / 1e6 : null);
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'none'>(p.budget?.period ?? 'month');
  const [limits, setLimits] = useState<Limit[]>(p.limits ?? []);
  useEffect(() => {
    setMode('view');
    setAllowance(p.budget ? p.budget.allowance_micros / 1e6 : null);
    setPeriod(p.budget?.period ?? 'month');
    setLimits(p.limits ?? []);
    setAccountScope(p.inherits ? 'parent' : scopeOf(p.accounts, 'none'));
    setAccountNames(p.accounts ?? []);
    setParent(p.parent ?? '');
    setModelScope(scopeOf(p.models, 'none'));
    setModelNames(p.models ?? []);
  }, [p]);
  const b = p.budget;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{p.id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'state', v: <Status tone={toneOf(p.status)} label={p.status} /> },
          {
            k: 'peek',
            v: (
              <>
                {p.peeks ? <span className="c-wait">recording each request whole</span> : <span className="muted">off</span>}
                {p.peek == null && p.parent ? <span className="muted"> · {p.parent}'s</span> : null}{' '}
                {p.status !== 'archived' && (
                  <Select
                    value={p.peek == null ? (p.parent ? 'parent' : 'off') : p.peek ? 'on' : 'off'}
                    onChange={async (v) => { await w.write('patch', '/admin/v1/projects/{project}', { params: { path: { project: p.id } }, body: { peek: v === 'parent' ? null : v === 'on' } }); }}
                    options={[...(p.parent ? [{ value: 'parent', label: `${p.parent}'s` }] : []), { value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
                  />
                )}
                {p.peeks && <span className="muted"> · shown on each request in Usage</span>}
              </>
            ),
          },
          { k: 'name', v: p.name },
          { k: 'owners', v: p.owners.join(', ') },
          { k: 'data classes', v: p.data_classes.join(', ') },
          { k: 'models', v: p.models ? (p.models.length ? p.models.join(', ') : <span className="c-wait">none</span>) : 'the whole catalog' },
          ...(p.parent ? [{ k: 'parent', v: <a href={`#/projects/${p.parent}`}><Mono>{p.parent}</Mono></a> }] : []),
          { k: 'accounts', v: p.inherits ? <>{p.parent}'s, inherited</> : p.accounts ? (p.accounts.length ? p.accounts.join(', ') : <span className="c-wait">none: nothing serves it</span>) : 'any' },
          { k: 'position', v: p.position ?? '–' },
          { k: 'created', v: when(p.created_at) },
        ]}
      />
      {mode === 'access' ? (
        <Form
          error={w.error}
          onSubmit={async () => {
            const r = await w.write('patch', '/admin/v1/projects/{project}', {
              params: { path: { project: p.id } },
              body: {
                // its parent first: made a project of its own, it keeps
                // what it spent unless given accounts here
                ...(parent !== (p.parent ?? '') ? { parent: parent || null } : {}),
                // a child set to its parent's inherits them; any accounts of
                // its own narrow it
                ...(accountScope === 'kept'
                  ? {}
                  : accountScope === 'parent'
                  ? { inherits: true }
                  : { accounts: accountScope === 'any' ? null : accountScope === 'none' ? [] : accountNames }),
                models: modelScope === 'any' ? null : modelScope === 'none' ? [] : modelNames,
              },
            });
            if (r) setMode('view');
          }}
          actions={
            <>
              <Button type="submit" tone="primary" disabled={w.busy}>save access</Button>
              <Button onClick={() => setMode('view')}>cancel</Button>
            </>
          }
        >
          <Field label="parent" help={isParent ? `${p.id} is a parent, so it stays a project of its own` : 'a subproject; set it to inherit to spend the parent\u2019s accounts'}>
            <Select
              value={parent}
              onChange={(v) => {
                setParent(v);
                // made a project of its own, it keeps what it spends now
                // (the server copies its parent's) unless set otherwise
                if (!v && accountScope === 'parent') setAccountScope('kept');
                if (v && accountScope === 'kept') setAccountScope('parent');
              }}
              options={isParent ? [{ value: '', label: 'none: a project of its own' }] : [{ value: '', label: 'none: a project of its own' }, ...parentsFor(projects.data?.data ?? [], p.id).map((q) => ({ value: q.id, label: q.id }))]}
            />
          </Field>
          <Field label="accounts it may spend" help={(known.data?.data ?? []).filter((a) => a.status === 'active').map((a) => a.id).join(', ') || 'no account yet: create one on Accounts'}>
            <Select value={accountScope} onChange={(v) => setAccountScope(v as Scope)} options={[...(child ? [{ value: 'parent', label: `${parent}'s (inherit)` }] : []), ...(accountScope === 'kept' ? [{ value: 'kept', label: 'what it spends now (kept)' }] : []), { value: 'none', label: 'none' }, { value: 'these', label: 'these' }, { value: 'any', label: 'any' }]} />
          </Field>
          {accountScope === 'these' && (
            <Field label="accounts">
              <ListInput mono value={accountNames} onChange={setAccountNames} placeholder="local" />
            </Field>
          )}
          <Field label="models it may name">
            <Select value={modelScope} onChange={(v) => setModelScope(v as Scope)} options={[{ value: 'any', label: 'the whole catalog' }, { value: 'these', label: 'these' }, { value: 'none', label: 'none' }]} />
          </Field>
          {modelScope === 'these' && (
            <Field label="models">
              <ListInput mono value={modelNames} onChange={setModelNames} placeholder="qwen3-0.6b" />
            </Field>
          )}
        </Form>
      ) : (
        p.status !== 'archived' && <p><Button onClick={() => setMode('access')}>edit access</Button></p>
      )}
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Budget</h3>
      {mode === 'budget' ? (
        <Form
          error={w.error}
          onSubmit={async () => {
            const r = await w.write('put', '/admin/v1/projects/{project}/budget', { params: { path: { project: p.id } }, body: { allowance_micros: Math.round((allowance ?? 0) * 1e6), period, currency: 'USD' } });
            if (r) setMode('view');
          }}
          actions={
            <>
              <Button type="submit" tone="primary" disabled={w.busy}>set budget</Button>
              <Button onClick={() => setMode('view')}>cancel</Button>
            </>
          }
        >
          <Field label="allowance (USD)" required help="a hard cap on spend per period">
            <NumberInput value={allowance} onChange={setAllowance} min={0} step={0.01} required />
          </Field>
          <Field label="period" required>
            <Select value={period} onChange={(v) => setPeriod(v as typeof period)} options={[{ value: 'day' }, { value: 'week' }, { value: 'month' }, { value: 'none', label: 'none (lifetime cap)' }]} />
          </Field>
        </Form>
      ) : (
        <>
          {b ? (
            <Kv
              rows={[
                { k: 'allowance', v: `${micros(b.allowance_micros, b.currency)} per ${b.period}` },
                { k: 'spent', v: <span className={b.allowance_micros && b.spent_micros / b.allowance_micros >= 0.8 ? 'c-wait' : undefined}>{micros(b.spent_micros, b.currency)}</span> },
                { k: 'reserved', v: micros(b.reserved_micros, b.currency) },
                { k: 'remaining', v: <span className={b.remaining_micros <= 0 ? 'c-fail' : undefined}>{micros(b.remaining_micros, b.currency)}</span> },
                { k: 'window', v: `${when(b.window_start)} → ${b.window_end ? when(b.window_end) : 'no end'}` },
              ]}
            />
          ) : (
            <span className="faint">no budget: unlimited spend</span>
          )}
          <p><Button onClick={() => setMode('budget')}>{b ? 'change budget' : 'set budget'}</Button></p>
        </>
      )}
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Limits</h3>
      {mode === 'limits' ? (
        <Form
          error={w.error}
          onSubmit={async () => {
            const r = await w.write('put', '/admin/v1/projects/{project}/limits', { params: { path: { project: p.id } }, body: { limits: limitsForWrite(limits) } });
            if (r) setMode('view');
          }}
          actions={
            <>
              <Button type="submit" tone="primary" disabled={w.busy}>save limits</Button>
              <Button onClick={() => setMode('view')}>cancel</Button>
            </>
          }
        >
          <LimitsEditor scope="project" allowModel value={limits} onChange={setLimits} />
        </Form>
      ) : (
        <>
          {(p.limits ?? []).length === 0 ? <span className="faint">none</span> : (p.limits ?? []).map((l, i) => <div key={i}>{describeLimit(l)}</div>)}
          <p><Button onClick={() => setMode('limits')}>edit limits</Button></p>
        </>
      )}
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {p.status === 'active' && (
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Confirm label="archive project" confirm="archive: its keys are revoked" onConfirm={async () => { await w.write('delete', '/admin/v1/projects/{project}', { params: { path: { project: p.id } } }); }} />
        </p>
      )}
      {w.error && mode === 'view' && <p className="c-fail">{w.error}</p>}
    </>
  );
}

function Keys({ project }: { project: Project }) {
  const q = useGet('/admin/v1/projects/{project}/keys', { params: { path: { project: project.id } } });
  const w = useWrite();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [secret, setSecret] = useState<{ id: string; secret: string } | null>(null);
  return (
    <Panel title={`Keys under ${project.id}`} readout={readout(q, q.data ? `${q.data.data.length} keys` : null)}>
      {q.isPending ? (
        <Loading what="keys" />
      ) : q.isError ? (
        <Unavailable what="Keys" detail={q.error.message} />
      ) : (
        <Table<Key>
          rows={q.data.data}
          rowKey={(k) => k.id}
          rowClass={(k) => (k.id === secret?.id ? 'afterglow' : undefined)}
          columns={[
            { key: 'id', header: 'Key', render: (k) => <Mono>{k.id}</Mono> },
            { key: 'name', header: 'Name', render: (k) => k.name },
            { key: 'prefix', header: 'Prefix', render: (k) => <Mono>{k.prefix ?? '–'}…</Mono> },
            { key: 'accounts', header: 'Accounts', render: (k) => (k.accounts ? k.accounts.join(', ') : <span className="muted">the project's</span>) },
            { key: 'status', header: 'State', render: (k) => <Status tone={toneOf(k.status)} label={k.status} /> },
            { key: 'used', header: 'Last used', render: (k) => <span className="muted">{k.last_used_at ? `${ago(k.last_used_at)} ago` : 'never'}</span> },
            {
              key: 'peek',
              header: 'Peek',
              render: (k) =>
                k.status === 'active' ? (
                  <Button onClick={async () => { await w.write('patch', '/admin/v1/projects/{project}/keys/{key}', { params: { path: { project: project.id, key: k.id } }, body: { peek: !k.peek } }); }} disabled={w.busy}>
                    {k.peek ? 'recording · stop' : project.peeks ? 'by the project' : 'peek'}
                  </Button>
                ) : (
                  <span className="faint">–</span>
                ),
            },
            {
              key: 'x',
              header: '',
              render: (k) =>
                k.status === 'active' ? (
                  <Confirm label="revoke" confirm="revoke now" onConfirm={async () => { await w.write('delete', '/admin/v1/projects/{project}/keys/{key}', { params: { path: { project: project.id, key: k.id } } }); }} />
                ) : null,
            },
          ]}
          empty="No keys. One per client is the intended use."
        />
      )}
      {secret && <div style={{ marginTop: 'var(--space-3)' }}><Secret label={`secret of ${secret.id}`} value={secret.secret} note="voice stores only a digest; this is the only time it is shown" /></div>}
      {creating ? (
        <div style={{ marginTop: 'var(--space-3)', maxWidth: 480 }}>
          <Form
            error={w.error}
            onSubmit={async () => {
              const r = await w.write('post', '/admin/v1/projects/{project}/keys', { params: { path: { project: project.id } }, body: { name, accounts: accounts.length ? accounts : null } });
              if (r && 'secret' in r) {
                setSecret({ id: r.id, secret: r.secret });
                setCreating(false);
                setName('');
                setAccounts([]);
              }
            }}
            actions={
              <>
                <Button type="submit" tone="primary" disabled={w.busy}>create key</Button>
                <Button onClick={() => setCreating(false)}>cancel</Button>
              </>
            }
          >
            <Field label="name" required help="name the client this key is for; usage is broken down by key">
              <TextInput value={name} onChange={setName} required placeholder="ci" />
            </Field>
            <Field label="accounts" help="restrict to these accounts, within the project's; empty for the project's">
              <ListInput mono value={accounts} onChange={setAccounts} placeholder="claude-work" />
            </Field>
          </Form>
        </div>
      ) : (
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => { setSecret(null); setCreating(true); }} tone="primary">new key</Button>
        </p>
      )}
      {w.error && !creating && <p className="c-fail">{w.error}</p>}
    </Panel>
  );
}
