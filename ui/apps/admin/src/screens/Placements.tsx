import { useEffect, useState } from 'react';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, Select, Checkbox, Button, Confirm, when } from '@hale/components';
import { useGet, type Placement } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { toneOf } from '../tone';

/**
 * A model put on nodes: voice picks the variant and runtime that fit the
 * node's hardware, fetches them, and runs the server as a seat on the
 * leader. Each placement's seat is shown as the node reports it.
 */
export function Placements({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/placements');
  const nodes = useGet('/admin/v1/nodes');
  const placement = q.data?.data.find((p) => p.id === selected);
  const creating = selected === 'new';
  const seatOf = (p: Placement) => nodes.data?.data.find((n) => n.id === p.leader)?.seats.find((s) => s.ref === p.seat);

  useEffect(() => {
    setInspector(creating ? <PlacementForm /> : placement ? <PlacementInspector placement={placement} /> : null);
  }, [creating, placement, setInspector]);

  if (q.isPending) return <Loading what="placements" />;
  if (q.isError) return <Unavailable what="Placements" detail={q.error.message} />;
  if (selected && !creating && !placement) return <Missing what={`placement ${selected}`} />;

  return (
    <>
      <h1>Placements</h1>
      <Panel title="Placements" readout={readout(q, `${q.data.data.length} placements`)}>
        <Table<Placement>
          rows={q.data.data}
          rowKey={(p) => p.id}
          selectedKey={selected}
          onSelect={(p) => go('placements', p.id)}
          columns={[
            { key: 'id', header: 'Placement', render: (p) => <Mono>{p.id}</Mono> },
            { key: 'model', header: 'Model', render: (p) => <Mono>{p.model}</Mono> },
            { key: 'nodes', header: 'Nodes', render: (p) => p.nodes.join(', ') },
            { key: 'variant', header: 'Variant · runtime', render: (p) => `${p.variant} · ${p.runtime}` },
            { key: 'account', header: 'Account', render: (p) => <Mono>{p.account}</Mono> },
            { key: 'seat', header: 'Seat', render: (p) => { const s = seatOf(p); return s ? <Status tone={toneOf(s.status)} label={seatState(s)} title={s.reason ?? undefined} /> : <span className="faint">–</span>; } },
          ]}
          empty="Nothing placed. Place a catalog model that names a recipe on a node."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('placements', 'new')} tone="primary">place a model</Button>
        </p>
      </Panel>
    </>
  );
}

function seatState(s: { status: string; progress?: { done_bytes: number; total_bytes: number } | null }): string {
  const p = s.progress;
  if (s.status !== 'fetching' || !p || p.total_bytes <= 0) return s.status;
  return `fetching ${Math.floor((100 * p.done_bytes) / p.total_bytes)}%`;
}

function PlacementInspector({ placement: p }: { placement: Placement }) {
  const w = useWrite();
  const [node, seat] = p.seat.split('/');
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{p.id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'model', v: <a href={href('catalog', p.model)}><Mono>{p.model}</Mono></a> },
          { k: 'recipe', v: <a href={href('recipes', p.recipe)}><Mono>{p.recipe}</Mono></a> },
          { k: 'variant', v: <><Mono>{p.variant}</Mono> <span className="muted">· chosen by the {p.chosen_by}</span></> },
          { k: 'runtime', v: <a href={href('runtimes', p.runtime)}><Mono>{p.runtime}</Mono></a> },
          { k: 'nodes', v: p.nodes.join(', ') },
          { k: 'seat', v: <a href={href('nodes', node ?? '', seat ?? '')}><Mono>{p.seat}</Mono></a> },
          { k: 'account', v: <Mono>{p.account}</Mono> },
          { k: 'placed', v: when(p.created_at) },
        ]}
      />
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Fit on {p.leader}</h3>
      <Kv rows={p.fit.map((f) => ({ k: f.variant, v: <span className={f.fits ? undefined : 'muted'}>{f.fits ? `fits, under ${f.runtime}` : f.reason}</span> }))} />
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Confirm label="remove" confirm="remove: its seat stops serving" onConfirm={async () => { const x = await w.write('delete', '/admin/v1/placements/{placement}', { params: { path: { placement: p.id } } }); if (x) go('placements'); }} />
      </p>
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
    </>
  );
}

function PlacementForm() {
  const w = useWrite();
  const catalog = useGet('/admin/v1/models');
  const recipes = useGet('/admin/v1/recipes');
  const runtimes = useGet('/admin/v1/runtimes');
  const nodes = useGet('/admin/v1/nodes');
  const accounts = useGet('/admin/v1/accounts');
  const [id, setId] = useState('');
  const [model, setModel] = useState('');
  const [on, setOn] = useState<string[]>([]);
  const [account, setAccount] = useState('');
  const [variant, setVariant] = useState('');
  const [runtime, setRuntime] = useState('');
  const placeable = (catalog.data?.data ?? []).filter((m) => m.recipe);
  const recipe = recipes.data?.data.find((r) => r.id === placeable.find((m) => m.id === model)?.recipe);
  const live = (nodes.data?.data ?? []).filter((n) => n.status !== 'revoked');
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>Place a model</h2>
      <Form
        error={w.error}
        onSubmit={async () => {
          const r = await w.write('post', '/admin/v1/placements', { body: { id, model, nodes: on, account, variant: variant || undefined, runtime: runtime || undefined } });
          if (r && 'id' in r) go('placements', r.id);
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy || !model || on.length === 0 || !account}>place</Button>
            <Button onClick={() => go('placements')}>cancel</Button>
          </>
        }
      >
        <Field label="id" required help="the seat's name on the node, too">
          <TextInput mono value={id} onChange={setId} required pattern="^[a-z0-9][a-z0-9-]{0,62}$" placeholder="qwen-on-spark" />
        </Field>
        <Field label="model" required help="a catalog model that names a recipe">
          <Select value={model} onChange={(v) => { setModel(v); setVariant(''); }} options={placeable.map((m) => ({ value: m.id, label: `${m.id} · ${m.recipe}` }))} required empty="" />
        </Field>
        <Field label="nodes" required help="the first is the leader, which runs the server">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {live.map((n) => (
              <Checkbox key={n.id} checked={on.includes(n.id)} onChange={(c) => setOn(c ? [...on, n.id] : on.filter((x) => x !== n.id))} label={`${n.id}${n.capabilities?.hardware ? '' : ' (no hardware measured)'}`} />
            ))}
          </div>
        </Field>
        <Field label="account" required help="what the seat spends">
          <Select value={account} onChange={setAccount} options={(accounts.data?.data ?? []).filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.id} · ${a.billing}` }))} required empty="" />
        </Field>
        <Field label="variant" help="empty lets voice pick the one that fits">
          <Select value={variant} onChange={setVariant} options={(recipe?.variants ?? []).map((v) => ({ value: v.id, label: `${v.id} (${v.format})` }))} empty="voice picks" />
        </Field>
        <Field label="runtime" help="empty lets voice pick one the node can run">
          <Select value={runtime} onChange={setRuntime} options={(runtimes.data?.data ?? []).map((r) => ({ value: r.id }))} empty="voice picks" />
        </Field>
      </Form>
    </>
  );
}
