import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, NumberInput, Select, ListInput, Checkbox, Button, Confirm, Secret, SchemaForm, ago, bytes, type JsonObject, type JsonSchema } from '@hale/components';
import { useGet, useNodes, type Node, type NodeSummary, type SeatSummary, type SeatView, type Schemas } from '../api/client';
import { useHubState } from '../api/hub';
import { useWrite } from '../api/mutate';
import { Arrange } from './Arrange';
import type { ScreenProps } from '../App';
import { href, go } from '../route';
import { readout } from '../readout';
import { toneOf } from '../tone';
import { ContextWindow } from '../context';
import { Value } from '../values';
import { nodeModels, heldSaid, type NodeModel } from './node-models';
import { FleetMemory, NodeMemory, Toggle, useFleetMemory } from '../FleetMemory';
import { fleetNodes, memoryOf, placedBlocks } from '../fleet-memory';
import { DEMO_NODES, DEMO_PLACEMENTS, demoLink } from '../fleet-memory-demo';

type Seat = Schemas['Seat'];

/**
 * Nodes, and one node's models: what it runs and what it holds on its
 * disk, first; its seats (assigned beside reported) in their details
 * below. The list is the nodes summarized; the inspector reads the node
 * whole (what it declared), and a seat whole (its config).
 */
export function Nodes({ route, setInspector }: ScreenProps) {
  const nodeId = route.parts[1];
  const seatId = route.parts[2];
  const q = useNodes();
  const node = q.data?.data.find((n) => n.id === nodeId);
  const creating = nodeId === 'new';
  // the arranger: the whole fleet's wants, planned against these nodes
  // (Arrange.tsx). A query, not a part: a node may be named anything a slug
  // allows, `arrange` too
  const arranging = !nodeId && route.query.has('arrange');
  const seat = node?.seats.find((s) => s.id === seatId);
  const newSeat = seatId === 'new';
  const qc = useQueryClient();
  // a seat on its way up moves by itself: the hub says so as it does, and
  // with no hub, read again while one is
  const live = useHubState() === 'open';
  const moving = q.data?.data.some((n) => n.seats.some((s) => s.status === 'fetching' || s.status === 'starting')) ?? false;
  useEffect(() => {
    if (!moving || live) return;
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: ['/admin/v1/nodes'] }), 3000);
    return () => clearInterval(t);
  }, [moving, live, qc]);

  const nodeKey = node?.id;
  const seatKey = seat?.id;
  useEffect(() => {
    if (creating) setInspector(<CreateNode />);
    else if (nodeKey && newSeat) setInspector(<NodeWhole id={nodeKey} show={(n) => <SeatForm node={n} />} />);
    else if (nodeKey && seatKey) setInspector(<NodeWhole id={nodeKey} show={(n) => <SeatWhole node={n} seat={seatKey} />} />);
    else if (nodeKey) setInspector(<NodeWhole id={nodeKey} show={(n) => <NodeInspector node={n} />} />);
    else setInspector(null);
  }, [creating, nodeKey, seatKey, newSeat, setInspector]);

  if (q.isPending) return <Loading what="nodes" />;
  if (q.isError) return <Unavailable what="Nodes" detail={q.error.message} />;
  if (arranging) return <Arrange route={route} setInspector={setInspector} />;
  if (nodeId && !creating && !node) return <Missing what={`node ${nodeId}`} />;

  return (
    <>
      <h1>Nodes</h1>
      <FleetPanel current={nodeId} />
      <Panel title="Nodes" readout={readout(q, `${q.data.data.length} nodes`)}>
        <Table<NodeSummary>
          rows={q.data.data}
          rowKey={(n) => n.id}
          selectedKey={nodeId}
          onSelect={(n) => go('nodes', n.id)}
          columns={[
            { key: 'id', header: 'Node', render: (n) => <Mono>{n.id}</Mono> },
            { key: 'name', header: 'Name', render: (n) => n.name ?? '' },
            { key: 'status', header: 'State', render: (n) => <Status tone={toneOf(n.status)} label={n.status} /> },
            { key: 'seats', header: 'Seats', num: true, render: (n) => n.seats.length },
            { key: 'cap', header: 'In flight / cap', num: true, render: (n) => `${n.in_flight ?? 0} / ${n.effective_max_in_flight ?? '–'}` },
            { key: 'assign', header: 'Assignment', num: true, render: (n) => <AssignmentCell node={n} /> },
            { key: 'disk', header: 'On disk', num: true, render: (n) => <OnDiskCell node={n} /> },
            { key: 'hb', header: 'Heartbeat', render: (n) => <Heartbeat at={n.last_heartbeat_at} /> },
          ]}
          empty="No nodes. Create one to get its enrollment token."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('nodes', 'new')} tone="primary">new node</Button>{' '}
          <Button onClick={() => { location.hash = `${href('nodes')}?arrange`; }}>arrange</Button>
        </p>
      </Panel>
      {node && <Models node={node} fresh={readout(q)} />}
      {node && (
        <details open={!!seatId} style={{ marginTop: 'var(--space-3)' }}>
          <summary className="muted" style={{ cursor: 'pointer', marginBottom: 'var(--space-2)' }}>
            Seats on {node.id}: {node.seats.length}, the details behind its models
          </summary>
          <Seats node={node} selected={seatId} fresh={readout(q)} />
        </details>
      )}
    </>
  );
}

const DEMO = { nodes: fleetNodes(DEMO_NODES), now: placedBlocks(DEMO_PLACEMENTS) };

/**
 * The fleet's memory for models at a glance: a card a node, each placement
 * in its hue (FleetMemory.tsx), live as the hub reports the nodes and the
 * events tell placements changed. A card opens its node. A labeled demo
 * fleet draws it with no fleet behind it.
 */
function FleetPanel({ current }: { current?: string }) {
  const f = useFleetMemory();
  const [source, setSource] = useState<'fleet' | 'demo'>(() => {
    try { return sessionStorage.getItem('voice.memory.source') === 'demo' ? 'demo' : 'fleet'; } catch { return 'fleet'; }
  });
  const choose = (v: 'fleet' | 'demo') => {
    setSource(v);
    try { sessionStorage.setItem('voice.memory.source', v); } catch { /* storage can be disabled */ }
  };
  const shown = source === 'demo' ? { ...DEMO, links: demoLink } : f;
  let used = 0;
  let budget = 0;
  for (const n of shown.nodes) {
    const m = memoryOf(n, shown.now);
    if (!m) continue;
    budget += m.budgetBytes;
    used += m.blocks.reduce((t, b) => t + b.bytes, 0);
  }
  const lead = <Toggle label="memory drawn from" value={source} options={[['fleet', 'fleet'], ['demo', 'demo fleet']]} onChange={choose} />;
  return (
    <Panel title="Memory" readout={source === 'demo' ? 'demo · synthetic, no host' : `${bytes(used)} of ${bytes(budget)} held · ${shown.nodes.length} nodes`}>
      {source === 'fleet' && f.error ? (
        <>{lead}<p className="faint">memory unavailable: {f.error}</p></>
      ) : source === 'fleet' && f.pending ? (
        <span className="faint pulse">reading memory…</span>
      ) : (
        <FleetMemory nodes={shown.nodes} now={shown.now} links={shown.links} compact current={source === 'fleet' ? current : undefined} onOpenNode={source === 'fleet' ? (id) => go('nodes', id) : undefined} lead={lead} />
      )}
    </Panel>
  );
}

/** Quiet while fresh; amber once older than the interval a node is expected to keep. */
function Heartbeat({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="faint">–</span>;
  const stale = Date.now() - Date.parse(at) > 60_000;
  return <span className={stale ? 'c-wait' : 'muted'} title={stale ? 'no heartbeat for over a minute' : undefined}>{ago(at)} ago</span>;
}

/** The node whole (`getNode`): what it declared, and its links. */
function NodeWhole({ id, show }: { id: string; show: (node: Node) => ReactNode }) {
  const q = useGet('/admin/v1/nodes/{node}', { params: { path: { node: id } } });
  if (q.isPending) return <Loading what={`node ${id}`} />;
  if (q.isError) return <Unavailable what={`Node ${id}`} detail={q.error.message} />;
  return <>{show(q.data)}</>;
}

/** A seat whole (`getSeat`): its config among it. */
function SeatWhole({ node, seat }: { node: Node; seat: string }) {
  const q = useGet('/admin/v1/nodes/{node}/seats/{seat}', { params: { path: { node: node.id, seat } } });
  if (q.isPending) return <Loading what={`seat ${seat}`} />;
  if (q.isError) return <Unavailable what={`Seat ${node.id}/${seat}`} detail={q.error.message} />;
  return <SeatInspector node={node} seat={q.data} />;
}

/** Intent beside ground truth: the latest assignment and the one applied. */
function AssignmentCell({ node }: { node: NodeSummary }) {
  const version = node.assignment_version ?? 0;
  const behind = node.applied_version != null && node.applied_version < version;
  return (
    <span className={behind ? 'c-wait' : undefined} title={behind ? 'the node has not yet applied the latest assignment' : undefined}>
      v{version}
      {node.applied_version == null ? <span className="faint"> (not applied)</span> : behind ? ` (applied v${node.applied_version})` : ''}
    </span>
  );
}

/** What the node's store holds, in short: its size, with how many files. */
function OnDiskCell({ node }: { node: NodeSummary }) {
  const d = node.downloaded;
  if (!d) return <span className="faint" title="the node has not reported what its store holds">–</span>;
  return <span title={`${d.files} files held whole`}>{bytes(d.bytes)}</span>;
}

type Download = Schemas['NodeDownload'];

/**
 * What the node runs and holds, model by model (node-models.ts): each
 * model a seat serves here (a placement's seat, its leader or the follower
 * that runs the other half, or a seat of another engine), with its state
 * and what its disk holds of it; then each variant on its disk that nothing
 * here serves. A row of a seat opens it.
 */
function Models({ node, fresh }: { node: NodeSummary; fresh: string }) {
  const placements = useGet('/admin/v1/placements');
  const downloads = useGet('/admin/v1/nodes/{node}/downloads', { params: { path: { node: node.id } } });
  const rows = nodeModels(node.id, node.seats, placements.data?.data ?? [], downloads.data?.data ?? []);
  const served = rows.filter((r) => r.seat).length;
  return (
    <Panel title={`Models on ${node.id}`} readout={`${served} served · ${rows.length - served} on disk only · ${fresh}`}>
      <Table<NodeModel>
        rows={rows}
        rowKey={(r) => r.key}
        onSelect={(r) => (r.seat ? go('nodes', node.id, r.seat.id) : undefined)}
        columns={[
          { key: 'model', header: 'Model', render: (r) => <Mono>{r.model}</Mono> },
          {
            key: 'how',
            header: 'How',
            wrap: true,
            render: (r) =>
              r.placement ? (
                <>
                  <a href={href('placements', r.placement.id)}>placed as {r.placement.id}</a>
                  <span className="muted"> · {r.placement.variant} under {r.placement.runtime}{r.part === 'leader' ? `, leading ${r.placement.nodes.filter((n) => n !== node.id).join('')}` : r.part === 'follower' ? `, the other half of ${r.placement.leader}'s` : ''}</span>
                </>
              ) : r.seat ? (
                <span className="muted">a {r.seat.engine} seat</span>
              ) : (
                <span className="muted">{r.download?.variant}</span>
              ),
          },
          {
            key: 'state',
            header: 'State',
            render: (r) => (r.seat ? <Status tone={toneOf(r.seat.status)} label={reported(r.seat)} title={r.seat.reason ?? undefined} /> : <Status tone="quiet" label={r.placement ? 'placed, no seat here yet' : 'on disk, not served'} />),
          },
          {
            key: 'disk',
            header: 'On disk',
            num: true,
            render: (r) => (r.download ? (r.download.complete ? bytes(r.download.bytes) : <span className="c-wait">{heldSaid(r.download)} of {bytes(r.download.bytes)}</span>) : <span className="faint">–</span>),
          },
        ]}
        empty={downloads.data && !downloads.data.reported_at ? 'Nothing served here, and the node has not said what its disk holds.' : 'Nothing served here, and nothing on its disk.'}
      />
      <p style={{ marginBottom: 0 }}>
        <Button onClick={() => go('placements', 'new')}>place a model</Button>
      </p>
    </Panel>
  );
}

function Seats({ node, selected, fresh }: { node: NodeSummary; selected?: string; fresh: string }) {
  // what it offers is declared when it connects
  const declared = node.connected_at != null;
  return (
    <Panel title={`Seats on ${node.id}`} readout={`${node.seats.length} seats · ${fresh}`}>
      <Table<SeatSummary>
        rows={node.seats}
        rowKey={(s) => s.id}
        selectedKey={selected}
        onSelect={(s) => go('nodes', node.id, s.id)}
        columns={[
          { key: 'id', header: 'Seat', render: (s) => <Mono>{s.id}</Mono> },
          { key: 'engine', header: 'Engine', render: (s) => s.engine },
          { key: 'account', header: 'Account', render: (s) => <Mono>{s.account}</Mono> },
          { key: 'serves', header: 'Serves', render: (s) => s.serves.map((m) => (m.as ? `${m.model} as ${m.as}` : m.model)).join(', ') },
          { key: 'assigned', header: 'Assigned', render: (s) => (s.enabled === false ? 'disabled' : `enabled · ${s.concurrency ?? 1} at once`) },
          { key: 'reported', header: 'Reported', render: (s) => <Status tone={toneOf(s.status)} label={reported(s)} title={s.reason ?? undefined} /> },
          { key: 'reason', header: 'Reason', wrap: true, render: (s) => s.reason ?? (s.problems.length ? <span className="c-wait">{s.problems.join('; ')}</span> : <span className="faint">–</span>) },
          { key: 'ctx', header: 'Context', num: true, render: (s) => <ContextWindow served={s.context} native={nativeOf(s)} /> },
          { key: 'flight', header: 'In flight', num: true, render: (s) => s.in_flight },
        ]}
        empty="No seats assigned to this node."
      />
      <p style={{ marginBottom: 0 }}>
        <Button onClick={() => go('nodes', node.id, 'new')} tone="primary" disabled={!declared}>
          {declared ? 'add seat' : 'add seat (the node has not declared what it offers)'}
        </Button>
      </p>
    </Panel>
  );
}

/** A seat's reported state, with how far a fetch has come. */
function reported(s: SeatSummary | SeatView): string {
  const p = s.progress;
  if (s.status !== 'fetching' || !p || p.total_bytes <= 0) return s.status;
  return `fetching ${Math.floor((100 * p.done_bytes) / p.total_bytes)}%`;
}

/** What the machine has, as the node measured it: what placement fits models to. */
/**
 * The nodes this one is cabled to, as its capabilities file declares them:
 * the ports that reach each, whether the peer declares the link back, and
 * the link's latest check. A model is placed across the two once it passed.
 */
function Links({ node }: { node: Node }) {
  const w = useWrite();
  const declared = node.capabilities?.links ?? [];
  if (declared.length === 0) return <span className="faint">none declared: its capabilities file names no node it is cabled to</span>;
  return (
    <>
      <Kv
        rows={declared.map((l) => {
          const seen = node.links?.find((x) => x.peer === l.peer);
          const c = seen?.check;
          const label = !c ? '' : c.status === 'passed' && c.degraded ? 'passed, degraded' : c.status;
          const tone = !c ? 'quiet' : c.status === 'failed' ? 'fail' : c.status === 'running' || c.degraded ? 'wait' : 'quiet';
          return {
            k: l.peer,
            v: (
              <>
                <a href={href('nodes', l.peer)}>{l.peer}</a>{': '}
                <Mono>{l.ports.map((p) => `${p.ifname} ${p.address}${p.hca ? ` · ${p.hca}` : ''}`).join(', ')}</Mono>
                {!seen?.paired && <span className="c-wait"> · {l.peer} declares no link back</span>}
                {c ? (
                  <>
                    {' · '}
                    <Status tone={tone} label={label} title={c.reason ?? undefined} />
                    {c.bus_bytes_per_second ? <span className="muted"> · {bytes(c.bus_bytes_per_second)}/s</span> : null}
                  </>
                ) : (
                  <span className="muted"> · never checked</span>
                )}
                {seen?.paired && node.status === 'up' && c?.status !== 'running' && (
                  <>
                    {' '}
                    <Button onClick={() => void w.write('post', '/admin/v1/nodes/{node}/links/{peer}/check', { params: { path: { node: node.id, peer: l.peer } } })} disabled={w.busy}>check</Button>
                  </>
                )}
              </>
            ),
          };
        })}
      />
      {w.error && <p className="c-fail">{w.error}</p>}
    </>
  );
}

function Hardware({ node }: { node: Node }) {
  const hw = node.capabilities?.hardware;
  if (!hw) return <span className="faint">{node.capabilities ? 'not measured: no model is placed on this node' : 'not declared yet: the node has not registered'}</span>;
  return (
    <Kv
      rows={[
        { k: 'platform', v: `${hw.os} · ${hw.arch}` },
        { k: 'memory', v: <>{bytes(hw.memory_bytes)}{hw.model_memory_bytes < hw.memory_bytes ? <span className="muted"> · {bytes(hw.model_memory_bytes)} for models</span> : null}</> },
        ...(hw.accelerators.length
          ? hw.accelerators.map((a, i) => ({
              k: hw.accelerators.length > 1 ? `accelerator ${i}` : 'accelerator',
              v: <>{a.name} <span className="muted">· {a.kind} · {a.unified ? `unified memory` : bytes(a.memory_bytes)}</span></>,
            }))
          : [{ k: 'accelerator', v: <span className="c-wait">none: a model needs one</span> }]),
        { k: 'disk free', v: bytes(hw.disk_free_bytes) },
      ]}
    />
  );
}

function CreateNode() {
  const w = useWrite();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [cap, setCap] = useState<number | null>(null);
  const [token, setToken] = useState<{ id: string; token: string } | null>(null);
  if (token) {
    return (
      <>
        <h2 style={{ marginBottom: 'var(--space-3)' }}>
          <Mono>{token.id}</Mono> created
        </h2>
        <Secret label="enrollment token" value={token.token} note="start the node with it; voice stores only a digest" />
        <p className="muted" style={{ fontSize: 'var(--size-sm)' }}>
          <code>voice-node --id {token.id} --token … --api https://your-api --capabilities capabilities.json</code>
        </p>
        <p><Button onClick={() => go('nodes', token.id)}>done</Button></p>
      </>
    );
  }
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>New node</h2>
      <Form
        error={w.error}
        onSubmit={async () => {
          const r = await w.write('post', '/admin/v1/nodes', { body: { id, name: name || undefined, max_in_flight: cap } });
          if (r && 'enrollment_token' in r) setToken({ id: r.id, token: r.enrollment_token });
          else if (r) go('nodes');
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy}>create and issue token</Button>
            <Button onClick={() => go('nodes')}>cancel</Button>
          </>
        }
      >
        <Field label="id" required help="the machine's name in voice; never reused">
          <TextInput mono value={id} onChange={setId} required pattern="^[a-z0-9][a-z0-9-]{0,62}$" placeholder="laptop" />
        </Field>
        <Field label="name">
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="in-flight cap" help="the coordinator's cap; empty leaves the node's declared cap in charge">
          <NumberInput value={cap} onChange={setCap} min={1} />
        </Field>
      </Form>
    </>
  );
}

function NodeInspector({ node }: { node: Node }) {
  const w = useWrite();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name ?? '');
  const [cap, setCap] = useState<number | null>(node.max_in_flight ?? null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setEditing(false);
    setName(node.name ?? '');
    setCap(node.max_in_flight ?? null);
    setToken(null);
  }, [node]);
  const caps = node.capabilities;
  const local = node.local;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{node.id}</Mono>
      </h2>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <NodeMemory ids={[node.id]} />
      </div>
      {editing ? (
        <Form
          error={w.error}
          onSubmit={async () => {
            const r = await w.write('patch', '/admin/v1/nodes/{node}', { params: { path: { node: node.id } }, body: { name: name || undefined, max_in_flight: cap } });
            if (r) setEditing(false);
          }}
          actions={
            <>
              <Button type="submit" tone="primary" disabled={w.busy}>save</Button>
              <Button onClick={() => setEditing(false)}>cancel</Button>
            </>
          }
        >
          <Field label="name"><TextInput value={name} onChange={setName} /></Field>
          <Field label="in-flight cap" help={caps ? `at most the declared ${caps.max_in_flight}; empty for none` : 'empty for none'}>
            <NumberInput value={cap} onChange={setCap} min={1} max={caps?.max_in_flight} />
          </Field>
        </Form>
      ) : (
        <Kv
          rows={[
            { k: 'state', v: <Status tone={toneOf(node.status)} label={node.status} /> },
            { k: 'name', v: node.name ?? '–' },
            { k: 'version', v: node.version ?? '–' },
            { k: 'connected', v: node.connected_at ? `${ago(node.connected_at)} ago` : 'never' },
            { k: 'heartbeat', v: <Heartbeat at={node.last_heartbeat_at} /> },
            { k: 'cap', v: <CapExplained node={node} /> },
            { k: 'assignment', v: <AssignmentCell node={node} /> },
          ]}
        />
      )}
      <OnThisMachine node={node} />
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Offers</h3>
      {caps ? (
        <Kv rows={caps.engines.map((e) => ({ k: e.id, v: <>{e.kind}{e.models ? <span className="muted"> · {e.models.join(', ')}</span> : null}</> }))} />
      ) : (
        <span className="faint">not declared yet: the node has not registered</span>
      )}
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Hardware</h3>
      <Hardware node={node} />
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Links</h3>
      <Links node={node} />
      {node.status !== 'revoked' && <Suggested node={node} />}
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Local controls</h3>
      {local ? (
        <Kv
          rows={[
            { k: 'paused', v: local.paused ? <Status tone="wait" label="paused" /> : 'no' },
            { k: 'paused seats', v: local.paused_seats.length ? local.paused_seats.join(', ') : 'none' },
            { k: 'local cap', v: local.max_in_flight ?? 'none' },
            { k: 'reason', v: local.reason ?? '–' },
          ]}
        />
      ) : (
        <span className="faint">not reported yet</span>
      )}
      {token && <div style={{ marginTop: 'var(--space-3)' }}><Secret label="new enrollment token" value={token} note="the old token stops working now; restart the node with this one" /></div>}
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && !editing && <p className="c-fail">{w.error}</p>}
      {node.status !== 'revoked' && (
        <p style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
          {!editing && <Button onClick={() => setEditing(true)}>edit</Button>}
          <Confirm label="rotate token" confirm="rotate: the old one stops now" tone="default" onConfirm={async () => { const r = await w.write('post', '/admin/v1/nodes/{node}/token', { params: { path: { node: node.id } } }); if (r && 'enrollment_token' in r) setToken(r.enrollment_token); }} />
          <Confirm label="revoke node" confirm="revoke: its seats stop serving" onConfirm={async () => { await w.write('delete', '/admin/v1/nodes/{node}', { params: { path: { node: node.id } } }); }} />
        </p>
      )}
      <p className="faint" style={{ fontSize: 'var(--size-xs)', marginTop: 'var(--space-4)' }}>
        <a href={href('nodes')}>all nodes</a>
      </p>
    </>
  );
}

/**
 * The models on the machine's disk (`listNodeDownloads`): each recipe
 * variant it holds whole, its size and the placement that uses it here
 * now; one it holds in part, with how much; and what no variant lists.
 * A placement removed leaves its files, so placing a variant held whole
 * again is a reload, not a download.
 */
function OnThisMachine({ node }: { node: Node }) {
  const q = useGet('/admin/v1/nodes/{node}/downloads', { params: { path: { node: node.id } } });
  const d = q.data;
  return (
    <>
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
        On this machine
        {d?.reported_at && <span className="faint" style={{ fontWeight: 400 }}> · {bytes(d.bytes)} in {d.files} files · reported {ago(d.reported_at)} ago</span>}
      </h3>
      {q.isPending ? (
        <Loading what="downloads" />
      ) : q.isError ? (
        <Unavailable what="Downloads" detail={q.error.message} />
      ) : !q.data.reported_at ? (
        <span className="faint">not reported yet: the node has not said what its store holds</span>
      ) : (
        <Kv
          rows={[
            ...q.data.data.map((v) => ({ k: v.recipe, v: <DownloadRow v={v} /> })),
            ...(q.data.data.length === 0 ? [{ k: 'models', v: <span className="faint">none: no variant of a recipe voice knows has a file here</span> }] : []),
            ...(q.data.other_files > 0
              ? [{ k: 'other', v: <>{bytes(q.data.other_bytes)} <span className="muted">· {q.data.other_files} files no recipe lists: a runtime, or a withdrawn recipe's weights</span></> }]
              : []),
          ]}
        />
      )}
    </>
  );
}

/** One variant on disk: whole with its size, or how far along. */
function DownloadRow({ v }: { v: Download }) {
  const pct = v.bytes > 0 ? Math.floor((100 * v.bytes_held) / v.bytes) : 0;
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span className="muted">{v.variant}</span>
      {v.complete ? (
        <Status tone="ok" label={`downloaded · ${bytes(v.bytes)}`} />
      ) : (
        <Status tone="wait" label={`partial ${pct}% · ${v.files_held} of ${v.files_total} files · ${bytes(v.bytes_held)} of ${bytes(v.bytes)}`} />
      )}
      {v.placed ? <a href={href('placements', v.placed)}>placed as {v.placed}</a> : <span className="faint">not placed here</span>}
    </div>
  );
}

type Suggestion = Schemas['NodeSuggestion'];

/** `s` as a placement id: lowercase letters, digits and dashes, at most 63. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '');
}

/**
 * What voice would place here, a model per category it ships, from its
 * default catalog for the node's platform and memory tier
 * (`suggestNodeModels`): what fits, or is placed already, or why nothing
 * does. Placing one adds its recipe to the catalog as a model when none is
 * there yet, then places it on this node, spending the account chosen.
 */
function Suggested({ node }: { node: Node }) {
  const q = useGet('/admin/v1/nodes/{node}/suggestions', { params: { path: { node: node.id } } });
  const models = useGet('/admin/v1/models');
  const accounts = useGet('/admin/v1/accounts');
  const w = useWrite();
  const [account, setAccount] = useState('');
  const options = (accounts.data?.data ?? []).filter((a) => a.status !== 'archived');
  // an account that bills no one is the natural payer of a local seat
  const payer = account || (options.find((a) => (a.billing ?? 'none') === 'none') ?? options[0])?.id || '';
  const placements = useGet('/admin/v1/placements');
  const place = async (s: Suggestion, peer?: string) => {
    if (!s.recipe || !payer) return;
    const recipe = s.recipe;
    const all = models.data?.data ?? [];
    // the catalog model whose weights are this recipe: one named for it
    // first; a model's id says nothing of its weights, so one of the same
    // id with another recipe is not it, and a new one takes a free id
    const bound = all.find((m) => m.id === recipe && m.recipe === recipe) ?? all.find((m) => m.kind === 'local' && m.recipe === recipe);
    let model = bound?.id ?? null;
    if (!model) {
      model = await w.createFresh('/admin/v1/models', recipe, new Set(all.map((m) => m.id)), (id) => ({ id, owned_by: 'local', kind: 'local', recipe }));
      if (!model) return;
    }
    const chosen = model;
    // a placement's id is a slug, never reused, even once removed
    await w.createFresh('/admin/v1/placements', slug(`${recipe}-on-${node.id}${peer ? `-and-${peer}` : ''}`), new Set((placements.data?.data ?? []).map((p) => p.id)), (id) => ({
      id,
      model: chosen,
      account: payer,
      nodes: peer ? [node.id, peer] : [node.id],
      ...(s.variant ? { variant: s.variant } : {}),
    }));
  };
  return (
    <>
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
        Suggested models
        {q.data?.tier_gb != null && <span className="faint" style={{ fontWeight: 400 }}> · {q.data.os} {q.data.tier_gb} GB tier</span>}
      </h3>
      {q.isPending ? (
        <Loading what="suggestions" />
      ) : q.isError ? (
        <Unavailable what="Suggestions" detail={q.error.message} />
      ) : (
        <>
          <Kv rows={q.data.data.map((s) => suggestionRow(s, () => void place(s), w.busy || !payer))} />
          {q.data.pair && (
            <>
              <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
                Across {node.id} and {q.data.pair.peer}
                {q.data.pair.tier_gb != null && <span className="faint" style={{ fontWeight: 400 }}> · {q.data.pair.tier_gb} GB together</span>}
              </h3>
              <Kv rows={q.data.pair.data.map((s) => suggestionRow(s, () => void place(s, q.data.pair?.peer), w.busy || !payer))} />
            </>
          )}
          {options.length > 1 && (
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span className="faint">spending</span>
              <Select value={payer} onChange={setAccount} options={options.map((a) => ({ value: a.id }))} />
            </div>
          )}
          {!payer && <p className="c-wait">No account to spend: add one on Accounts to place a model.</p>}
          {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
          {w.error && <p className="c-fail">{w.error}</p>}
        </>
      )}
    </>
  );
}

/** Why a suggestion says downloaded: placing it is a reload. */
function downloadedNote(s: Suggestion): string {
  return `${s.recipe} ${s.variant ?? ''} is on disk already: placing it loads it, with nothing to download`;
}

/** One category's suggestion, with a button to place it. */
function suggestionRow(s: Suggestion, place: () => void, disabled: boolean) {
  return {
    k: s.category,
    v: s.recipe ? (
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Mono>{s.recipe}</Mono>
        {s.variant && <span className="muted">{s.variant}</span>}
        {s.downloaded && <Status tone="ok" label="downloaded" title={downloadedNote(s)} />}
        {s.placed ? (
          <a href={href('placements', s.placed)}>placed as {s.placed}</a>
        ) : (
          <Button onClick={place} disabled={disabled}>place</Button>
        )}
        <div className="faint" style={{ flexBasis: '100%', fontSize: 'var(--size-xs)' }}>{s.reason}</div>
      </div>
    ) : (
      <span className="faint">{s.reason}</span>
    ),
  };
}

/** The effective cap and what bounds it: declared, coordinator, local. */
function CapExplained({ node }: { node: Node }) {
  const declared = node.capabilities?.max_in_flight;
  const parts = [
    declared != null ? `declared ${declared}` : null,
    node.max_in_flight != null ? `coordinator ${node.max_in_flight}` : null,
    node.local?.max_in_flight != null ? `local ${node.local.max_in_flight}` : null,
  ].filter(Boolean);
  return (
    <>
      <b>{node.effective_max_in_flight ?? '–'}</b>
      {parts.length ? <span className="muted"> · {parts.join(' · ')}</span> : null}
    </>
  );
}

/**
 * The context a placed seat's model is made for, from the config its
 * placement gave it: as a summary says it, or read from the config.
 */
function nativeOf(s: SeatSummary | SeatView): number | undefined {
  const n = 'context_length' in s ? s.context_length : ((s as SeatView).config as { context_length?: unknown } | undefined)?.context_length;
  return typeof n === 'number' ? n : undefined;
}

function SeatInspector({ node, seat }: { node: Node; seat: SeatView }) {
  const w = useWrite();
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [seat]);
  if (editing) return <SeatForm node={node} seat={seat} onDone={() => setEditing(false)} />;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{seat.ref}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'reported', v: <Status tone={toneOf(seat.status)} label={reported(seat)} /> },
          ...(seat.status === 'fetching' && seat.progress ? [{ k: 'fetched', v: `${bytes(seat.progress.done_bytes)} of ${bytes(seat.progress.total_bytes)}` }] : []),
          { k: 'reason', v: seat.reason ?? '–' },
          { k: 'problems', v: seat.problems.length ? <span className="c-wait">{seat.problems.join('; ')}</span> : 'none' },
          { k: 'engine', v: seat.engine },
          { k: 'account', v: <Mono>{seat.account}</Mono> },
          { k: 'serves', v: seat.serves.map((m) => <div key={m.model}>{m.model}{m.as ? <span className="muted"> as {m.as}</span> : null}</div>) },
          { k: 'data classes', v: (seat.data_classes ?? ['internal']).join(', ') },
          { k: 'assigned', v: seat.enabled === false ? 'disabled' : `enabled · ${seat.concurrency ?? 1} at once` },
          { k: 'context', v: seat.context ? <ContextWindow served={seat.context} native={nativeOf(seat)} /> : nativeOf(seat) ? <span className="faint">not said yet; made for {nativeOf(seat)!.toLocaleString()}</span> : '–' },
          { k: 'in flight', v: seat.in_flight },
          { k: 'config', v: <Value v={seat.config ?? {}} /> },
        ]}
      />
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
      <p style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
        <Button onClick={() => setEditing(true)}>edit</Button>
        <Button onClick={() => w.write('patch', '/admin/v1/nodes/{node}/seats/{seat}', { params: { path: { node: node.id, seat: seat.id } }, body: { enabled: seat.enabled === false } })}>
          {seat.enabled === false ? 'enable' : 'disable'}
        </Button>
        <Confirm label="remove seat" confirm="remove: in-flight requests finish" onConfirm={async () => { const r = await w.write('delete', '/admin/v1/nodes/{node}/seats/{seat}', { params: { path: { node: node.id, seat: seat.id } } }); if (r) go('nodes', node.id); }} />
      </p>
    </>
  );
}

/** A seat, created or changed: the engine's own config schema drives its form. */
function SeatForm({ node, seat, onDone }: { node: Node; seat?: SeatView; onDone?: () => void }) {
  const w = useWrite();
  const accounts = useGet('/admin/v1/accounts');
  const catalog = useGet('/admin/v1/models');
  const engines = node.capabilities?.engines ?? [];
  const [id, setId] = useState(seat?.id ?? '');
  const [engine, setEngine] = useState(seat?.engine ?? engines[0]?.id ?? '');
  const [account, setAccount] = useState(seat?.account ?? '');
  const [serves, setServes] = useState<Seat['serves']>(seat?.serves ?? []);
  const [dataClasses, setDataClasses] = useState<string[]>(seat?.data_classes ?? ['internal']);
  const [concurrency, setConcurrency] = useState<number | null>(seat?.concurrency ?? 1);
  const [enabled, setEnabled] = useState(seat?.enabled ?? true);
  const [config, setConfig] = useState<JsonObject>((seat?.config as JsonObject | undefined) ?? {});
  const engineDef = engines.find((e) => e.id === engine);
  const schema = (engineDef?.config_schema ?? { type: 'object' }) as JsonSchema;
  const cancel = () => (onDone ? onDone() : go('nodes', node.id));
  // a placement's seat runs its model's weights: its engine, what it serves
  // and its config are the placement's, changed on Placements
  const placed = typeof seat?.config?.placement === 'string' ? seat.config.placement : '';
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>{seat ? <><Mono>{seat.ref}</Mono></> : `New seat on ${node.id}`}</h2>
      <Form
        error={w.error}
        onSubmit={async () => {
          const body: Seat = { id, engine, account, serves, data_classes: dataClasses, concurrency: concurrency ?? 1, enabled, config };
          const r = seat
            ? await w.write('patch', '/admin/v1/nodes/{node}/seats/{seat}', { params: { path: { node: node.id, seat: seat.id } }, body: placed ? { account, data_classes: dataClasses, concurrency: concurrency ?? 1, enabled } : { engine, account, serves, data_classes: dataClasses, concurrency: concurrency ?? 1, enabled, config } })
            : await w.write('post', '/admin/v1/nodes/{node}/seats', { params: { path: { node: node.id } }, body });
          if (r) {
            if (onDone) onDone();
            else go('nodes', node.id, id);
          }
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy || !engine || !account || serves.length === 0}>{seat ? 'save' : 'add seat'}</Button>
            <Button onClick={cancel}>cancel</Button>
          </>
        }
      >
        {!seat && (
          <Field label="id" required help="unique on this node">
            <TextInput mono value={id} onChange={setId} required pattern="^[a-z0-9][a-z0-9-]{0,62}$" placeholder="static" />
          </Field>
        )}
        {placed && (
          <p className="muted" style={{ margin: 0 }}>
            Placement <a href={`#/placements/${placed}`}><Mono>{placed}</Mono></a>'s seat: it serves {serves.map((m) => m.model).join(', ')} alone, on the engine and config the placement chose. To serve another model, place it on Placements.
          </p>
        )}
        {!placed && <Field label="engine" required help="one the node offers">
          <Select value={engine} onChange={(v) => { setEngine(v); setConfig({}); }} options={engines.map((e) => ({ value: e.id, label: `${e.id} (${e.kind})` }))} required empty="" />
        </Field>}
        <Field label="account" required help="what this seat spends">
          <Select value={account} onChange={setAccount} options={(accounts.data?.data ?? []).filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.id} · ${a.billing}` }))} required empty="" />
        </Field>
        {!placed && <Field label="serves" required help="catalog models this seat serves; `as` is the engine's own name when it differs">
          <ServesEditor value={serves} onChange={setServes} models={(catalog.data?.data ?? []).map((m) => m.id)} engineModels={engineDef?.models ?? null} />
        </Field>}
        <Field label="data classes" help="what this seat may carry">
          <ListInput value={dataClasses} onChange={setDataClasses} />
        </Field>
        <Field label="concurrency" help="requests this seat serves at once">
          <NumberInput value={concurrency} onChange={setConcurrency} min={1} />
        </Field>
        <Checkbox checked={enabled} onChange={setEnabled} label="enabled" />
        {!placed && schema.properties && (
          <>
            <h3 style={{ margin: 'var(--space-2) 0 0' }}>{engine} config</h3>
            <SchemaForm schema={schema} value={config} onChange={setConfig} />
          </>
        )}
      </Form>
    </>
  );
}

function ServesEditor({ value, onChange, models, engineModels }: { value: Seat['serves']; onChange: (v: Seat['serves']) => void; models: string[]; engineModels: string[] | null }) {
  const set = (i: number, patch: Partial<Seat['serves'][number]>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {value.map((m, i) => (
        <span key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Select value={m.model} onChange={(v) => set(i, { model: v })} options={models.map((id) => ({ value: id }))} empty="model" required />
          <span className="faint">as</span>
          {engineModels ? (
            <Select value={m.as ?? ''} onChange={(v) => set(i, { as: v || null })} options={engineModels.map((id) => ({ value: id }))} empty="same" />
          ) : (
            <TextInput mono value={m.as ?? ''} onChange={(v) => set(i, { as: v || null })} placeholder="same" />
          )}
          <Button onClick={() => onChange(value.filter((_, j) => j !== i))}>remove</Button>
        </span>
      ))}
      <span><Button onClick={() => onChange([...value, { model: models[0] ?? '', as: null }])}>add model</Button></span>
    </div>
  );
}
