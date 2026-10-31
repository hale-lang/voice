import { useEffect, useState } from 'react';
import { Panel, PanelGrid, Table, Status, Loading, Unavailable, Kv, Mono, Button, micros, count, when, ago } from '@hale/components';
import { toneOf } from '../tone';
import { useGet, type UsageRecord } from '../api/client';
import type { ScreenProps } from '../App';
import { go } from '../route';
import { readout } from '../readout';
import { PeekSection } from '../peek';

/** Requests a page holds. */
const PAGE = 50;

/** Summaries first, then the records behind them, a page at a time. */
export function Usage({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  // the cursors of the pages before this one, newest first: older pushes
  // the page's `next_cursor`, newer pops it
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const records = useGet('/admin/v1/usage', { params: { query: { limit: PAGE, ...(cursor ? { cursor } : {}) } } });
  const onPage = records.data?.data.find((r) => r.id === selected);
  useEffect(() => {
    setInspector(selected ? (onPage ? <RecordInspector record={onPage} /> : <RecordById id={selected} />) : null);
  }, [selected, onPage, setInspector]);
  const next = records.data?.next_cursor ?? null;
  const page = cursors.length + 1;

  return (
    <>
      <h1>Usage</h1>
      <PanelGrid>
        <Summary group="project" />
        <Summary group="account" />
      </PanelGrid>
      <Panel title="Requests" readout={readout(records, records.data ? `page ${page} · ${records.data.data.length}` : null)}>
        {records.isPending ? (
          <Loading what="usage" />
        ) : records.isError ? (
          <Unavailable what="Usage" detail={records.error.message} />
        ) : (
          <Table<UsageRecord>
            rows={records.data.data}
            rowKey={(r) => r.id}
            selectedKey={selected}
            onSelect={(r) => go('usage', r.id)}
            columns={[
              { key: 'when', header: 'When', render: (r) => <span className="muted">{ago(r.created_at)}</span> },
              { key: 'id', header: 'Request', render: (r) => <Mono>{r.id}</Mono> },
              { key: 'project', header: 'Project / key', render: (r) => <><Mono>{r.project}</Mono> <span className="muted">{r.key}</span></> },
              { key: 'model', header: 'Model', render: (r) => r.served?.model ?? r.requested_model },
              { key: 'account', header: 'Account', render: (r) => <Mono>{r.served?.account ?? '–'}</Mono> },
              { key: 'status', header: 'Status', render: (r) => <Status tone={toneOf(r.status)} label={r.status} /> },
              { key: 'in', header: 'In', num: true, render: (r) => count(r.input_tokens) },
              { key: 'out', header: 'Out', num: true, render: (r) => count(r.output_tokens) },
              { key: 'price', header: 'Price', num: true, render: (r) => micros(r.price_micros, r.currency) },
              { key: 'wall', header: 'Wall', num: true, render: (r) => `${r.timing.wall_ms} ms` },
              { key: 'first', header: 'First output', num: true, render: (r) => (r.timing.first_output_ms != null ? `${r.timing.first_output_ms} ms` : <span className="faint">–</span>) },
              { key: 'rate', header: 'Tok/s', num: true, render: (r) => throughput(r) },
            ]}
            empty="No requests yet."
          />
        )}
        <p style={{ marginBottom: 0, display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Button onClick={() => setCursors([])} disabled={cursors.length === 0}>newest</Button>
          <Button onClick={() => setCursors(cursors.slice(0, -1))} disabled={cursors.length === 0}>newer</Button>
          <Button onClick={() => next && setCursors([...cursors, next])} disabled={!next}>older</Button>
          <span className="muted">page {page}{next ? '' : ', the oldest'}</span>
        </p>
      </Panel>
    </>
  );
}

/** A record that is not on the page shown: read by its id. */
function RecordById({ id }: { id: string }) {
  const q = useGet('/admin/v1/usage/{request_id}', { params: { path: { request_id: id } } });
  if (q.isPending) return <Loading what="the request" />;
  if (q.isError) return <Unavailable what="The request" detail={q.error.message} />;
  return <RecordInspector record={q.data} />;
}

function Summary({ group }: { group: 'project' | 'account' }) {
  const q = useGet('/admin/v1/usage/summary', { params: { query: { group_by: [group] } } });
  return (
    <Panel title={`By ${group}`} readout={readout(q, q.data ? `${when(q.data.from)} → ${when(q.data.to)}` : null)}>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Unavailable what="Summary" detail={q.error.message} />
      ) : (
        <Table
          rows={q.data.data}
          rowKey={(r) => JSON.stringify(r.group)}
          columns={[
            { key: 'g', header: group, render: (r) => <Mono>{Object.values(r.group).join(' · ')}</Mono> },
            { key: 'req', header: 'Requests', num: true, render: (r) => count(r.requests) },
            { key: 'ref', header: 'Refused', num: true, render: (r) => (r.refused ? <span className="c-wait">{count(r.refused)}</span> : '0') },
            { key: 'in', header: 'In', num: true, render: (r) => count(r.input_tokens) },
            { key: 'out', header: 'Out', num: true, render: (r) => count(r.output_tokens) },
            { key: 'price', header: 'Price', num: true, render: (r) => micros(r.price_micros, r.currency) },
          ]}
        />
      )}
    </Panel>
  );
}

function RecordInspector({ record: r }: { record: UsageRecord }) {
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{r.id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'status', v: <Status tone={toneOf(r.status)} label={r.status} /> },
          { k: 'created', v: when(r.created_at) },
          { k: 'project', v: <Mono>{r.project}</Mono> },
          { k: 'key', v: <Mono>{r.key}</Mono> },
          { k: 'requested', v: <>{r.requested_model}{r.requested_account ? <span className="muted"> on {r.requested_account}</span> : null}</> },
          { k: 'served', v: r.served ? <><Mono>{r.served.seat}</Mono> · {r.served.model}{r.served.quantization ? ` (${r.served.quantization})` : ''} · {r.served.engine}</> : '–' },
          { k: 'account', v: r.served?.account ?? '–' },
          { k: 'data class', v: r.data_class ?? '–' },
          { k: 'tokens', v: `${count(r.input_tokens)} in (${count(r.cached_input_tokens ?? 0)} cached, ${count(r.cache_write_input_tokens ?? 0)} written) · ${count(r.output_tokens)} out (${count(r.reasoning_tokens ?? 0)} reasoning)` },
          { k: 'price', v: micros(r.price_micros, r.currency) },
          { k: 'timing', v: `wall ${r.timing.wall_ms} · queue ${r.timing.queue_ms} · load ${r.timing.load_ms} ms` },
          { k: 'attempts', v: (r.attempts ?? []).map((a, i) => <div key={i}><Mono>{a.seat}</Mono> <Status tone={a.outcome === 'served' ? 'quiet' : 'fail'} label={a.outcome} />{a.error ? <span className="muted"> {a.error}</span> : null}</div>) },
          { k: 'metadata', v: <Mono>{JSON.stringify(r.metadata)}</Mono> },
        ]}
      />
      <PeekSection id={r.id} />
    </>
  );
}

/**
 * A seat's throughput on one request: its output tokens over the time it
 * generated, from its first output to its end, as its node measured both,
 * so reading the prompt and a cold start are not counted against it.
 */
function throughput(r: UsageRecord): string {
  const { first_output_ms: first, engine_ms: end } = r.timing;
  if (first == null || end == null || end <= first || r.output_tokens <= 0) return '–';
  return ((1000 * r.output_tokens) / (end - first)).toFixed(1);
}
