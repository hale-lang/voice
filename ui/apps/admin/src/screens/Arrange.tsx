import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Seats } from './Placements';
import { Panel, Table, Status, Loading, Unavailable, Mono, Field, Select, NumberInput, Checkbox, Button, Confirm, TextInput, bytes, when, type Tone } from '@hale/components';
import { api, describe, useGet, useNodes, useRecipes, type Schemas, type Placement } from '../api/client';
import type { ScreenProps } from '../App';
import { href } from '../route';
import { ArrangeFleet } from './ArrangeFleet';

type Wants = Schemas['ArrangementWants'];
type Pin = Schemas['ArrangementPin'];
type RoleWant = Schemas['ArrangementRoleWant'];
type Plan = Schemas['ArrangementPlan'];
type Applied = Schemas['ArrangementApplied'];
type Kept = Schemas['Arrangement'];

/** One line of the plan's diff, as the table shows it. */
type Step = { key: string; kind: 'keep' | 'remove' | 'add' | 'alias'; what: React.ReactNode; nodes: string; detail: React.ReactNode; block?: string };

const TONE: Record<Step['kind'], Tone> = { keep: 'quiet', remove: 'fail', add: 'active', alias: 'ok' };

/**
 * The fleet as the operator wants it: models pinned to nodes and roles to
 * fill, and the plan voice proposes for it, a diff against what is placed
 * now, with why and what it costs; and, on the operator's click, the plan
 * carried out, each step's state and each added placement's seats shown.
 */
export function Arrange(_: ScreenProps) {
  const roles = useGet('/admin/v1/arrangement-roles');
  const catalog = useGet('/admin/v1/models');
  const recipes = useRecipes();
  const nodes = useNodes();
  const [pins, setPins] = useState<Pin[]>([]);
  const [wanted, setWanted] = useState<RoleWant[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  // the placement chosen, on the fleet's cards or in the plan's diff
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState('');
  const [project, setProject] = useState('');
  const [applied, setApplied] = useState<Applied | null>(null);
  // why applying failed: shown with what applying came to, under the button
  const [applyError, setApplyError] = useState<string | null>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const accounts = useGet('/admin/v1/accounts');
  const kept = useGet('/admin/v1/arrangements');
  const qc = useQueryClient();
  const [keepAs, setKeepAs] = useState('');
  const [keepName, setKeepName] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const projects = useGet('/admin/v1/projects');

  if (roles.isPending) return <Loading what="roles" />;
  if (roles.isError) return <Unavailable what="Arrange" detail={roles.error.message} />;

  const models = [
    ...(catalog.data?.data ?? []).filter((m) => m.recipe).map((m) => ({ value: m.id, label: `${m.id} · ${m.recipe}` })),
    ...(recipes.data?.data ?? []).map((r) => ({ value: r.id, label: `${r.id} (recipe)` })),
  ];
  const live = (nodes.data?.data ?? []).filter((n) => n.status !== 'revoked').map((n) => n.id).sort();
  const unused = roles.data.data.filter((r) => !wanted.some((w) => w.role === r.id));

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const body: Wants = { pins, roles: wanted };
      const r = await api.POST('/admin/v1/arrangement-plans', { body });
      if (r.error !== undefined || !r.data) {
        setError(describe(r.error, r.response.status));
        setPlan(null);
      } else {
        setPlan(r.data);
        setApplied(null);
        setApplyError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The plan shown, carried out: only ever on the operator's click. */
  async function apply() {
    if (!plan) return;
    setBusy(true);
    setApplyError(null);
    setApplied(null);
    try {
      const r = await api.POST('/admin/v1/arrangement-applies', { body: { wants: { pins, roles: wanted }, plan, account, project: project || undefined } });
      if (r.error !== undefined || !r.data) {
        setApplyError(describe(r.error, r.response.status));
        return;
      }
      setApplied(r.data);
      // drifted: the fleet has moved on, and the fresh plan is the one to look at
      if (r.data.outcome === 'drifted' && r.data.plan) setPlan(r.data.plan);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // what applying came to is shown under the button that applied, in view:
  // the plan above it can be long
  useEffect(() => {
    if (applied || applyError) outcome.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [applied, applyError]);

  /** The kept arrangement's wants, in the editor. */
  function open(a: Kept) {
    setPins(a.wants.pins ?? []);
    setWanted(a.wants.roles ?? []);
    setCurrent(a.id);
    setKeepAs(a.id);
    setKeepName(a.name);
    setPlan(null);
    setApplied(null);
    setApplyError(null);
  }

  /** A kept arrangement planned again, against the fleet now: asked for, never on its own. */
  async function replan(a: Kept) {
    open(a);
    setBusy(true);
    setError(null);
    try {
      const r = await api.POST('/admin/v1/arrangements/{arrangement}/plan', { params: { path: { arrangement: a.id } } });
      if (r.error !== undefined || !r.data) setError(describe(r.error, r.response.status));
      else setPlan(r.data);
      await qc.invalidateQueries({ queryKey: ['/admin/v1/arrangements'] });
    } finally {
      setBusy(false);
    }
  }

  /** The wants in the editor, kept as `keepAs`. */
  async function keep() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.PUT('/admin/v1/arrangements/{arrangement}', { params: { path: { arrangement: keepAs } }, body: { name: keepName || undefined, wants: { pins, roles: wanted } } });
      if (r.error !== undefined) setError(describe(r.error, r.response.status));
      else setCurrent(keepAs);
      await qc.invalidateQueries({ queryKey: ['/admin/v1/arrangements'] });
    } finally {
      setBusy(false);
    }
  }

  async function forget(id: string) {
    const r = await api.DELETE('/admin/v1/arrangements/{arrangement}', { params: { path: { arrangement: id } } });
    if (r.error !== undefined) setError(describe(r.error, r.response.status));
    if (current === id) setCurrent(null);
    await qc.invalidateQueries({ queryKey: ['/admin/v1/arrangements'] });
  }

  const setPin = (i: number, p: Partial<Pin>) => setPins(pins.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setRole = (i: number, w: Partial<RoleWant>) => setWanted(wanted.map((x, j) => (j === i ? { ...x, ...w } : x)));

  return (
    <>
      <h1><a href={href('nodes')}>Nodes</a> · Arrange</h1>
      <Panel title="Kept arrangements" readout={kept.data ? `${kept.data.data.length} kept` : undefined}>
        <Table<Kept>
          rows={kept.data?.data ?? []}
          rowKey={(a) => a.id}
          selectedKey={current ?? undefined}
          onSelect={open}
          columns={[
            { key: 'name', header: 'Arrangement', render: (a) => <><strong>{a.name}</strong> <Mono>{a.id}</Mono></> },
            { key: 'wants', header: 'Wants', render: (a) => `${(a.wants.pins ?? []).length} pins · ${(a.wants.roles ?? []).map((r) => r.role).join(', ') || 'no roles'}` },
            {
              key: 'planned',
              header: 'Planned',
              render: (a) => (a.planned_at ? <>{when(a.planned_at)}{a.fleet_changed && <> · <Status tone="wait" label="the fleet has changed since" /></>}</> : <span className="faint">not since it was kept</span>),
            },
            { key: 'x', header: '', render: (a) => <span style={{ display: 'flex', gap: 'var(--space-2)' }}><Button tone={a.fleet_changed ? 'primary' : 'default'} disabled={busy} onClick={() => replan(a)}>re-plan</Button><Confirm label="forget" confirm="forget: what it applied stays" onConfirm={() => forget(a.id)} /></span> },
          ]}
          empty="None kept. State what the fleet is for below, and keep it to plan again later."
        />
      </Panel>
      <Panel title="Pins" readout={`${pins.length} pinned`}>
        <p className="muted" style={{ marginTop: 0 }}>A model on a node, or split across two cabled to each other with their link checked. Name the nodes, or let voice pick any that fit.</p>
        {pins.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 2fr) auto', gap: 'var(--space-3)', alignItems: 'start', marginBottom: 'var(--space-3)' }}>
            <Field label="model" required>
              <Select value={p.model} onChange={(v) => setPin(i, { model: v })} options={models} required empty="" />
            </Field>
            <Field label="nodes" help={(p.nodes ?? []).length ? 'the first named leads' : `any ${p.count === 2 ? 'two linked nodes' : 'node'}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <Select value={String(p.count ?? 1)} onChange={(v) => setPin(i, { count: Number(v), nodes: (p.nodes ?? []).slice(0, Number(v)) })} options={[{ value: '1', label: 'one node' }, { value: '2', label: 'two linked nodes' }]} />
                {live.map((n) => (
                  <Checkbox
                    key={n}
                    label={n}
                    checked={(p.nodes ?? []).includes(n)}
                    onChange={(c) => {
                      const named = c ? [...(p.nodes ?? []), n].slice(-(p.count ?? 1)) : (p.nodes ?? []).filter((x) => x !== n);
                      setPin(i, { nodes: named });
                    }}
                  />
                ))}
              </div>
            </Field>
            <div style={{ paddingTop: 'var(--space-5)' }}>
              <Button onClick={() => setPins(pins.filter((_, j) => j !== i))}>remove</Button>
            </div>
          </div>
        ))}
        <Button onClick={() => setPins([...pins, { model: '', count: 1, nodes: [] }])}>pin a model</Button>
      </Panel>

      <Panel title="Roles" readout={`${wanted.length} of ${roles.data.data.length}`}>
        <p className="muted" style={{ marginTop: 0 }}>Each role is filled with the strongest model voice has that fits what is left, priority 1 first, and points its alias at it.</p>
        {wanted.length > 0 && (
          <Table<RoleWant & { i: number }>
            rows={wanted.map((w, i) => ({ ...w, i }))}
            rowKey={(w) => w.role}
            columns={[
              {
                key: 'role',
                header: 'Role',
                render: (w) => {
                  const r = roles.data.data.find((x) => x.id === w.role);
                  return (
                    <>
                      <strong>{r?.title ?? w.role}</strong> <span className="muted">· {r?.annotation}</span>
                      <div className="faint">alias <Mono>{r?.alias}</Mono> · candidates {r?.candidates.join(', ')}</div>
                    </>
                  );
                },
              },
              { key: 'priority', header: 'Priority', render: (w) => <NumberInput value={w.priority ?? null} onChange={(v) => setRole(w.i, { priority: v ?? 0 })} min={1} placeholder="none" /> },
              { key: 'count', header: 'Count', render: (w) => <NumberInput value={w.count ?? 1} onChange={(v) => setRole(w.i, { count: v ?? 1 })} min={1} max={8} /> },
              { key: 'x', header: '', render: (w) => <Button onClick={() => setWanted(wanted.filter((_, j) => j !== w.i))}>remove</Button> },
            ]}
          />
        )}
        {unused.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
            {unused.map((r) => (
              <Button key={r.id} onClick={() => setWanted([...wanted, { role: r.id, priority: wanted.length + 1, count: 1 }])}>
                + {r.title}
              </Button>
            ))}
          </div>
        )}
        {roles.data.data.length === 0 && <p className="faint">voice has no role data (catalog/roles.json)</p>}
      </Panel>

      <p style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button tone="primary" onClick={ask} disabled={busy || pins.some((p) => !p.model)}>{busy ? 'working…' : 'plan'}</Button>
        <span className="faint">a plan changes nothing</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <TextInput mono value={keepAs} onChange={setKeepAs} pattern="^[a-z0-9][a-z0-9-]{0,62}$" placeholder="id, to keep it" />
          <TextInput value={keepName} onChange={setKeepName} placeholder="name" />
          <Button onClick={keep} disabled={busy || !keepAs}>{current === keepAs ? 'keep changes' : 'keep'}</Button>
        </span>
      </p>
      {error && <p className="c-fail">{error}</p>}
      <ArrangeFleet plan={plan} selected={chosen} onSelect={setChosen} />
      {plan && <PlanView plan={plan} selected={chosen} onSelect={setChosen} />}
      {plan && (plan.add.length > 0 || plan.remove.length > 0 || plan.aliases.length > 0) && (
        <Panel title="Apply" readout="the plan as shown, carried out">
          <p className="muted" style={{ marginTop: 0 }}>Voice plans again first, and changes nothing if the fleet has moved on. Then removals, adds, aliases, in that order; a step that fails stops the rest, and nothing done is undone.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-3)' }}>
            <Field label="account" required help="what the seats it adds spend">
              <Select value={account} onChange={setAccount} options={(accounts.data?.data ?? []).filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.id} · ${a.billing}` }))} required empty="" />
            </Field>
            <Field label="project" required={plan.aliases.length > 0} help="whose aliases the roles point">
              <Select value={project} onChange={setProject} options={(projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.id }))} empty={plan.aliases.length ? '' : 'none'} />
            </Field>
          </div>
          <Confirm
            label="apply"
            confirm={`apply: ${plan.remove.length} removed, ${plan.add.length} added, ${plan.aliases.length} aliases`}
            disabled={busy || (plan.add.length > 0 && !account) || (plan.aliases.length > 0 && !project)}
            onConfirm={apply}
          />
          {busy && <span className="faint"> applying…</span>}
        </Panel>
      )}
      <div ref={outcome}>
        {applyError && <p className="c-fail">apply failed: {applyError}</p>}
        {applied && <AppliedView applied={applied} />}
      </div>
    </>
  );
}

/**
 * The plan: its diff, what it costs, and what it leaves unmet. A step's
 * placement is the one chosen on the fleet's cards: choosing either
 * selects the other, the step scrolled to.
 */
function PlanView({ plan, selected, onSelect }: { plan: Plan; selected: string | null; onSelect: (block: string) => void }) {
  const diff = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    diff.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [selected]);
  const steps: Step[] = [
    ...plan.remove.map((r) => ({ key: `remove ${r.placement}`, block: r.placement, kind: 'remove' as const, what: <a href={href('placements', r.placement)}><Mono>{r.placement}</Mono></a>, nodes: r.nodes.join(', '), detail: <><Mono>{r.model}</Mono> · {r.reason}</> })),
    ...plan.keep.map((k) => ({ key: `keep ${k.placement}`, block: k.placement, kind: 'keep' as const, what: <a href={href('placements', k.placement)}><Mono>{k.placement}</Mono></a>, nodes: k.nodes.join(', '), detail: <><Mono>{k.model}</Mono> · {k.reason}</> })),
    ...plan.add.map((a) => ({
      key: `add ${a.placement}`,
      block: a.placement,
      kind: 'add' as const,
      what: <><Mono>{a.model}</Mono>{a.in_catalog ? '' : <span className="muted"> (added to the catalog)</span>}</>,
      nodes: a.nodes.join(', '),
      detail: (
        <>
          <Mono>{a.variant}</Mono> under <Mono>{a.runtime}</Mono>, for {a.serves.join(', ')}
          <div className="muted">{a.reason}</div>
        </>
      ),
    })),
    ...plan.aliases.map((a) => ({ key: `alias ${a.role}`, kind: 'alias' as const, what: <Mono>{a.alias}</Mono>, nodes: '', detail: <>→ <Mono>{a.model}</Mono> <span className="muted">· {a.role}</span></> })),
  ];
  const fetched = plan.downloads.reduce((n, d) => n + d.bytes, 0);
  return (
    <>
      <Panel title="Plan" readout={`${plan.add.length} to add · ${plan.remove.length} to remove · ${plan.keep.length} kept`}>
        <div ref={diff}>
        <Table<Step>
          rows={steps}
          rowKey={(s) => s.key}
          selectedKey={steps.find((x) => x.block !== undefined && x.block === selected)?.key}
          onSelect={(x) => (x.block ? onSelect(x.block) : undefined)}
          columns={[
            { key: 'kind', header: '', render: (s) => <Status tone={TONE[s.kind]} label={s.kind} /> },
            { key: 'what', header: 'What', render: (s) => s.what },
            { key: 'nodes', header: 'Nodes', render: (s) => s.nodes || <span className="faint">–</span> },
            { key: 'detail', header: 'Why', render: (s) => s.detail },
          ]}
          empty="Nothing to change."
        />
        </div>
      </Panel>
      <Panel title="Costs" readout={fetched ? `${bytes(fetched)} to fetch` : 'nothing to fetch'}>
        <Table<{ node: string; bytes: number }>
          rows={plan.downloads}
          rowKey={(d) => d.node}
          columns={[
            { key: 'node', header: 'Node', render: (d) => <a href={href('nodes', d.node)}>{d.node}</a> },
            { key: 'bytes', header: 'Fetches', render: (d) => (d.bytes ? bytes(d.bytes) : <span className="faint">on disk already</span>) },
          ]}
          empty="No node fetches anything."
        />
        <p style={{ marginBottom: 0 }}>
          {plan.down.length ? <>Goes down: {plan.down.map((m, i) => <span key={m}>{i ? ', ' : ''}<Mono>{m}</Mono></span>)}</> : <span className="faint">No model served now goes down.</span>}
        </p>
      </Panel>
      {plan.unmet.length > 0 && (
        <Panel title="Unmet" readout={`${plan.unmet.length} wants`}>
          <Table<{ want: string; reason: string }>
            rows={plan.unmet}
            rowKey={(u) => u.want}
            columns={[
              { key: 'want', header: 'Want', render: (u) => <Status tone="wait" label={u.want} /> },
              { key: 'reason', header: 'Why', render: (u) => <span className="muted">{u.reason}</span> },
            ]}
          />
        </Panel>
      )}
    </>
  );
}

const STEP_TONE: Record<string, Tone> = { done: 'ok', failed: 'fail', not_run: 'quiet' };

/** What applying came to: each step's state, the added placements' seats as their nodes report them, and what to do. */
function AppliedView({ applied }: { applied: Applied }) {
  const placements = useGet('/admin/v1/placements');
  const nodes = useNodes();
  const seatAt = (ref: string | undefined) => { const [n] = (ref ?? '').split('/'); return nodes.data?.data.find((x) => x.id === n)?.seats.find((s) => s.ref === ref); };
  const placed = (id: string): Placement | undefined => placements.data?.data.find((p) => p.id === id);
  const tone: Tone = applied.outcome === 'applied' ? 'ok' : applied.outcome === 'failed' ? 'fail' : 'wait';
  return (
    <Panel title={<>Applied <Status tone={tone} label={applied.outcome} /></>} readout={`${applied.steps.filter((s) => s.state === 'done').length} of ${applied.steps.length} steps done`}>
      <p className={applied.outcome === 'applied' ? 'muted' : applied.outcome === 'failed' ? 'c-fail' : 'c-wait'} style={{ marginTop: 0 }}>{applied.advice}</p>
      {applied.steps.length > 0 && (
        <Table<Schemas['ApplyStep'] & { i: number }>
          rows={applied.steps.map((s, i) => ({ ...s, i }))}
          rowKey={(s) => String(s.i)}
          columns={[
            { key: 'state', header: '', render: (s) => <Status tone={STEP_TONE[s.state] ?? 'quiet'} label={s.state.replace('_', ' ')} /> },
            { key: 'action', header: 'Step', render: (s) => <>{s.action} <Mono>{s.target}</Mono></> },
            { key: 'detail', header: 'What', render: (s) => <>{s.detail}{s.reason && <div className="c-fail">{s.reason}</div>}</> },
            {
              key: 'seat',
              header: 'Seats',
              render: (s) => {
                const p = s.action === 'add' && s.state === 'done' ? placed(s.target) : undefined;
                return p ? <a href={href('placements', p.id)}><Seats p={p} seatAt={seatAt} ready={nodes.isSuccess} /></a> : <span className="faint">–</span>;
              },
            },
          ]}
        />
      )}
    </Panel>
  );
}
