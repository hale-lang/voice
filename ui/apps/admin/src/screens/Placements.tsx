import { useEffect, useState } from 'react';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, Select, Checkbox, Button, Confirm, when, bytes } from '@hale/components';
import { useGet, useNodes, useRecipes, type Placement } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { NodeMemory } from '../FleetMemory';
import { placementState, type SeatReport } from './placement-state';

/**
 * A model put on nodes: voice picks the variant and runtime that fit the
 * nodes' hardware, fetches them, and runs the server as a seat on the
 * leader; across two nodes, a seat on the follower runs the other half.
 * Each placement's seats are shown as their nodes report them: up,
 * starting and how far, or why no seat serves it.
 */
export function Placements({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/placements');
  const nodes = useNodes();
  const placement = q.data?.data.find((p) => p.id === selected);
  const creating = selected === 'new';
  const seatAt = (ref: string) => { const [n] = (ref ?? '').split('/'); return nodes.data?.data.find((x) => x.id === n)?.seats.find((s) => s.ref === ref); };

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
            { key: 'seat', header: 'Seat', render: (p) => <Seats p={p} seatAt={seatAt} ready={nodes.isSuccess} /> },
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

/**
 * A placement's seats, as one state: up; starting, and how far (fetching,
 * loading the model); or why no seat serves it.
 */
export function Seats({ p, seatAt, ready = true }: { p: Placement; seatAt: (ref: string) => SeatReport | undefined; ready?: boolean }) {
  if (!ready) return <span className="faint">–</span>;
  const st = placementState(p, seatAt);
  const tone = st.state === 'up' ? 'quiet' : st.state === 'starting' ? 'wait' : 'fail';
  return (
    <>
      <Status tone={tone} label={st.label} />
      {st.detail && <span className="muted">: {st.detail}</span>}
    </>
  );
}

function PlacementInspector({ placement: p }: { placement: Placement }) {
  const w = useWrite();
  const nodes = useNodes();
  const seatAt = (ref: string) => nodes.data?.data.find((x) => x.id === ref.split('/')[0])?.seats.find((s) => s.ref === ref);
  const [node, seat] = p.seat.split('/');
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{p.id}</Mono>
      </h2>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <NodeMemory ids={p.nodes} lit={p.id} compact />
      </div>
      <Kv
        rows={[
          { k: 'model', v: <a href={href('models', p.model)}><Mono>{p.model}</Mono></a> },
          { k: 'recipe', v: <a href={href('recipes', p.recipe)}><Mono>{p.recipe}</Mono></a> },
          { k: 'variant', v: <><Mono>{p.variant}</Mono> <span className="muted">· chosen by the {p.chosen_by}</span></> },
          { k: 'runtime', v: <a href={href('runtimes', p.runtime)}><Mono>{p.runtime}</Mono></a> },
          { k: 'nodes', v: p.nodes.join(', ') },
          { k: 'state', v: <Seats p={p} seatAt={seatAt} ready={nodes.isSuccess} /> },
          { k: 'seat', v: <a href={href('nodes', node ?? '', seat ?? '')}><Mono>{p.seat}</Mono></a> },
          ...(p.follower_seat ? [{ k: 'follower', v: <><a href={href('nodes', p.follower_seat.split('/')[0] ?? '', seat ?? '')}><Mono>{p.follower_seat}</Mono></a> <span className="muted">· runs the other half, serves nothing itself</span></> }] : []),
          { k: 'account', v: <Mono>{p.account}</Mono> },
          { k: 'cache', v: p.cache_tokens ? `${p.cache_tokens.toLocaleString()} tokens, shared by the conversations it holds` : <span className="faint">32k, placed before voice sized it</span> },
          { k: 'holds', v: p.held_bytes ? <>{bytes(p.held_bytes)} of {p.nodes.length > 1 ? `each of ${p.nodes.join(' and ')}'s` : `${p.leader}'s`} memory for models{p.reserved_bytes ? <span className="muted"> · {bytes(p.reserved_bytes)} reserved, the rest its server's</span> : null}</> : '–' },
          { k: 'placed', v: when(p.created_at) },
        ]}
      />
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Fit on {p.nodes.join(' and ')}</h3>
      <Kv rows={p.fit.map((f) => ({ k: f.variant, v: <span className={f.fits ? undefined : 'muted'}>{f.fits ? `fits, under ${f.runtime}` : f.reason}</span> }))} />
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Confirm label="remove" confirm={p.follower_seat ? 'remove: both its seats stop' : 'remove: its seat stops serving'} onConfirm={async () => { const x = await w.write('delete', '/admin/v1/placements/{placement}', { params: { path: { placement: p.id } } }); if (x) go('placements'); }} />
      </p>
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
    </>
  );
}

function PlacementForm() {
  const w = useWrite();
  const catalog = useGet('/admin/v1/models');
  const recipes = useRecipes();
  const runtimes = useGet('/admin/v1/runtimes');
  const nodes = useNodes();
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
          <TextInput mono value={id} onChange={setId} required pattern="^[a-z0-9][a-z0-9-]{0,62}$" placeholder="qwen-on-node-a" />
        </Field>
        <Field label="model" required help="a catalog model that names a recipe">
          <Select value={model} onChange={(v) => { setModel(v); setVariant(''); }} options={placeable.map((m) => ({ value: m.id, label: `${m.id} · ${m.recipe}` }))} required empty="" />
        </Field>
        <Field label="nodes" required help="the first is the leader, which serves; a second, cabled to it with its link checked, takes the other half of a model too large for one">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {live.map((n) => (
              <Checkbox key={n.id} checked={on.includes(n.id)} onChange={(c) => setOn(c ? [...on, n.id] : on.filter((x) => x !== n.id))} label={`${n.id}${n.hardware ? '' : ' (no hardware measured)'}`} />
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
