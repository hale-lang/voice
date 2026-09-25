import { useEffect } from 'react';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, ago } from '@hale/components';
import { toneOf } from '../tone';
import { useGet, type Node, type SeatView } from '../api/client';
import type { ScreenProps } from '../App';
import { href, go } from '../route';
import { readout } from '../readout';

/** Nodes, and one node's seats with assigned beside reported. */
export function Nodes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/nodes');
  const node = q.data?.data.find((n) => n.id === selected);

  useEffect(() => {
    setInspector(node ? <NodeInspector node={node} /> : null);
  }, [node, setInspector]);

  if (q.isPending) return <Loading what="nodes" />;
  if (q.isError) return <Unavailable what="Nodes" detail={q.error.message} />;
  if (selected && !node) return <Missing what={`node ${selected}`} />;

  return (
    <>
      <h1>Nodes</h1>
      <Panel title="Nodes" readout={readout(q, `${q.data.data.length} nodes`)}>
        <Table<Node>
          rows={q.data.data}
          rowKey={(n) => n.id}
          selectedKey={selected}
          onSelect={(n) => go('nodes', n.id)}
          columns={[
            { key: 'id', header: 'Node', render: (n) => <Mono>{n.id}</Mono> },
            { key: 'name', header: 'Name', render: (n) => n.name ?? '' },
            { key: 'status', header: 'State', render: (n) => <Status tone={toneOf(n.status)} label={n.status} /> },
            { key: 'seats', header: 'Seats', num: true, render: (n) => n.seats.length },
            { key: 'cap', header: 'In flight / cap', num: true, render: (n) => `${n.in_flight ?? 0} / ${n.effective_max_in_flight ?? '–'}` },
            { key: 'assign', header: 'Assignment', num: true, render: (n) => <AssignmentCell node={n} /> },
            { key: 'hb', header: 'Heartbeat', render: (n) => <Heartbeat at={n.last_heartbeat_at} /> },
          ]}
          empty="No nodes. Create one to get its enrollment token."
        />
      </Panel>
      {node && <Seats node={node} fresh={readout(q)} />}
    </>
  );
}

/** Quiet while fresh; amber once older than the interval a node is expected to keep. */
function Heartbeat({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="faint">–</span>;
  const stale = Date.now() - Date.parse(at) > 60_000;
  return <span className={stale ? 'c-wait' : 'muted'} title={stale ? 'no heartbeat for over a minute' : undefined}>{ago(at)} ago</span>;
}

/** Intent beside ground truth: the latest assignment and the one applied. */
function AssignmentCell({ node }: { node: Node }) {
  const version = node.assignment_version ?? 0;
  const behind = node.applied_version != null && node.applied_version < version;
  return (
    <span className={behind ? 'c-wait' : undefined} title={behind ? 'the node has not yet applied the latest assignment' : undefined}>
      v{version}
      {node.applied_version == null ? <span className="faint"> (not applied)</span> : behind ? ` (applied v${node.applied_version})` : ''}
    </span>
  );
}

function Seats({ node, fresh }: { node: Node; fresh: string }) {
  return (
    <Panel title={`Seats on ${node.id}`} readout={`${node.seats.length} seats · ${fresh}`}>
      <Table<SeatView>
        rows={node.seats}
        rowKey={(s) => s.ref}
        columns={[
          { key: 'id', header: 'Seat', render: (s) => <Mono>{s.id}</Mono> },
          { key: 'engine', header: 'Engine', render: (s) => s.engine },
          { key: 'account', header: 'Account', render: (s) => <Mono>{s.account}</Mono> },
          { key: 'serves', header: 'Serves', render: (s) => s.serves.map((m) => (m.as ? `${m.model} as ${m.as}` : m.model)).join(', ') },
          { key: 'assigned', header: 'Assigned', render: (s) => (s.enabled === false ? 'disabled' : `enabled · ${s.concurrency ?? 1} at once`) },
          { key: 'reported', header: 'Reported', render: (s) => <Status tone={toneOf(s.status)} label={s.status} title={s.reason ?? undefined} /> },
          { key: 'reason', header: 'Reason', wrap: true, render: (s) => s.reason ?? <span className="faint">–</span> },
          { key: 'flight', header: 'In flight', num: true, render: (s) => s.in_flight },
        ]}
        empty="No seats assigned to this node."
      />
    </Panel>
  );
}

function NodeInspector({ node }: { node: Node }) {
  const caps = node.capabilities;
  const local = node.local;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{node.id}</Mono>
      </h2>
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
      <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Offers</h3>
      {caps ? (
        <Kv rows={caps.engines.map((e) => ({ k: e.id, v: <>{e.kind}{e.models ? <span className="muted"> · {e.models.join(', ')}</span> : null}</> }))} />
      ) : (
        <span className="faint">not declared yet</span>
      )}
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
      <p className="faint" style={{ fontSize: 'var(--size-xs)', marginTop: 'var(--space-4)' }}>
        <a href={href('nodes')}>all nodes</a>
      </p>
    </>
  );
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
