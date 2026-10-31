import { useEffect, useState } from 'react';
import { Panel, PanelGrid, Table, Status, Loading, Unavailable, Kv, Mono, Button, Select, TextInput, micros, count, when, ago } from '@hale/components';
import { toneOf } from '../tone';
import { useGet, type UsageRecord } from '../api/client';
import type { ScreenProps } from '../App';
import { go } from '../route';
import { readout } from '../readout';
import { PeekSection } from '../peek';
import { AnnotationSection, tally, TallyLine } from '../annotation';
import { Board } from './Board';
import { ConversationView } from './Conversation';
import { href } from '../route';

/** Requests a page holds. */
const PAGE = 50;

/** The board of conversations, live; summaries; then the records behind them, a page at a time. */
export function Usage({ route, setInspector }: ScreenProps) {
  // `usage/<request>`, or a conversation, `usage/c/<prompt_cache_key>`
  const conversation = route.parts[1] === 'c' ? (route.parts[2] ?? '') : null;
  const selected = conversation === null ? route.parts[1] : undefined;
  // the cursors of the pages before this one, newest first: older pushes
  // the page's `next_cursor`, newer pops it
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const [filter, setFilterState] = useState<Filter>(NO_FILTER);
  // a new filter starts again at the newest page
  const setFilter = (f: Filter) => {
    setFilterState(f);
    setCursors([]);
  };
  const records = useGet('/admin/v1/usage', { params: { query: { limit: PAGE, ...query(filter), ...(cursor ? { cursor } : {}) } } });
  const onPage = records.data?.data.find((r) => r.id === selected);
  useEffect(() => {
    if (conversation) setInspector(<ConversationView key={conversation} conversation={conversation} />);
    else setInspector(selected ? (onPage ? <RecordInspector record={onPage} /> : <RecordById id={selected} />) : null);
  }, [conversation, selected, onPage, setInspector]);
  const next = records.data?.next_cursor ?? null;
  const page = cursors.length + 1;

  return (
    <>
      <h1>Usage</h1>
      <Board
        onOpen={(f) => {
          // a conversation opens as one; a request of none, as itself
          if (f.conversation) go('usage', 'c', f.conversation);
          else go('usage', f.last_request);
        }}
      />
      <PanelGrid>
        <Summary group="project" />
        <Summary group="account" />
      </PanelGrid>
      <Annotations project={filter.project} keyId={filter.key.trim()} />
      <Panel title="Requests" readout={readout(records, records.data ? `page ${page} · ${records.data.data.length}` : null)}>
        <Filters value={filter} onChange={setFilter} />
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
      <h2 style={{ marginBottom: 'var(--space-1)' }}>
        <Mono>{r.id}</Mono> <Status tone={toneOf(r.status)} label={r.status} />
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {r.served?.model ?? r.requested_model} on <Mono>{r.served?.seat ?? '–'}</Mono> · {count(r.input_tokens)} in · {count(r.output_tokens)} out · {r.timing.wall_ms} ms · {when(r.created_at)}
      </p>
      <Kv
        rows={[
          { k: 'status', v: <Status tone={toneOf(r.status)} label={r.status} /> },
          { k: 'created', v: when(r.created_at) },
          { k: 'project', v: <Mono>{r.project}</Mono> },
          { k: 'key', v: <Mono>{r.key}</Mono> },
          { k: 'requested', v: <>{r.requested_model}{r.requested_account ? <span className="muted"> on {r.requested_account}</span> : null}</> },
          { k: 'served', v: r.served ? <><Mono>{r.served.seat}</Mono> · {r.served.model}{r.served.quantization ? ` (${r.served.quantization})` : ''} · {r.served.engine}</> : '–' },
          { k: 'account', v: r.served?.account ?? '–' },
          { k: 'conversation', v: r.conversation ? <><Mono>{r.conversation}</Mono> <a href={href('usage', 'c', r.conversation)}>read it</a></> : <span className="faint">none</span> },
          { k: 'data class', v: r.data_class ?? '–' },
          { k: 'tokens', v: `${count(r.input_tokens)} in (${count(r.cached_input_tokens ?? 0)} cached, ${count(r.cache_write_input_tokens ?? 0)} written) · ${count(r.output_tokens)} out (${count(r.reasoning_tokens ?? 0)} reasoning)` },
          { k: 'price', v: micros(r.price_micros, r.currency) },
          { k: 'timing', v: `wall ${r.timing.wall_ms} · queue ${r.timing.queue_ms} · load ${r.timing.load_ms} ms` },
          { k: 'attempts', v: (r.attempts ?? []).map((a, i) => <div key={i}><Mono>{a.seat}</Mono> <Status tone={a.outcome === 'served' ? 'quiet' : 'fail'} label={a.outcome} />{a.error ? <span className="muted"> {a.error}</span> : null}</div>) },
          { k: 'metadata', v: <Metadata of={r.metadata} /> },
        ]}
      />
      <AnnotationSection id={r.id} />
      <PeekSection id={r.id} />
    </>
  );
}

/**
 * What the requests were and what their responses did, as voice-system's
 * decision model read them (for a project or key that annotates): every one
 * of the latest 200 together, then by model.
 */
function Annotations({ project, keyId }: { project: string; keyId: string }) {
  const q = useGet('/admin/v1/annotations', { params: { query: { limit: 200, ...(project ? { project } : {}), ...(keyId ? { key: keyId } : {}) } } });
  const all = q.data?.data ?? [];
  const byModel = new Map<string, typeof all>();
  for (const a of all) byModel.set(a.model, [...(byModel.get(a.model) ?? []), a]);
  return (
    <Panel title="Annotations" readout={readout(q, q.data ? `latest ${all.length}` : null)}>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <Unavailable what="Annotations" detail={q.error.message} />
      ) : !all.length ? (
        <p className="faint">None yet: a project or key annotates when set to on Projects, and voice-system needs a decision model it may use.</p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            <TallyLine t={tally(all)} />
          </p>
          <Table
            rows={[...byModel.entries()]}
            rowKey={([m]) => m}
            columns={[
              { key: 'm', header: 'Model', render: ([m]) => <Mono>{m}</Mono> },
              { key: 't', header: 'Tasks, outcomes', render: ([, as]) => <TallyLine t={tally(as)} /> },
              { key: 'n', header: 'Not annotated', num: true, render: ([, as]) => count(as.filter((a) => a.status !== 'annotated').length) },
            ]}
          />
        </>
      )}
    </Panel>
  );
}

/** A request's metadata, `name = value` each, as the caller set it. */
function Metadata({ of }: { of: unknown }) {
  const pairs = of && typeof of === 'object' ? Object.entries(of as Record<string, unknown>) : [];
  if (!pairs.length) return <span className="faint">none</span>;
  return (
    <>
      {pairs.map(([k, v]) => (
        <div key={k}>
          <Mono>{k}</Mono> <span className="faint">=</span> <Mono>{typeof v === 'string' ? v : JSON.stringify(v)}</Mono>
        </div>
      ))}
    </>
  );
}

/**
 * What the requests are narrowed to: each "" for any. `from` is the
 * cutoff `since` chose, fixed when it was chosen, so the query (and its
 * cache) stays the same across renders and pages.
 */
type Filter = { project: string; key: string; model: string; account: string; conversation: string; metadata: string; since: string; from: string };

const NO_FILTER: Filter = { project: '', key: '', model: '', account: '', conversation: '', metadata: '', since: '', from: '' };

/** The time ranges offered, as how far back, in seconds. */
const SINCE: { value: string; label: string }[] = [
  { value: '', label: 'any time' },
  { value: '3600', label: 'the last hour' },
  { value: '86400', label: 'the last day' },
  { value: '604800', label: 'the last week' },
];

/**
 * The metadata pairs asked for, each `name=value`, several apart by commas,
 * as the api takes them: one pair as it is, several as a JSON object, all
 * of which a request must have. null when one is not a pair.
 */
function metadataPairs(m: string): string | null {
  const parts = m.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[^=\s]+=.*$/.test(p))) return null;
  if (parts.length === 1) return parts[0]!;
  return JSON.stringify(Object.fromEntries(parts.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])));
}

/** The filter as listUsage's query. */
function query(f: Filter) {
  const pairs = metadataPairs(f.metadata);
  return {
    ...(f.project ? { project: [f.project] } : {}),
    ...(f.key ? { key: [f.key.trim()] } : {}),
    ...(f.model ? { model: [f.model] } : {}),
    ...(f.account ? { account: [f.account] } : {}),
    ...(f.conversation.trim() ? { conversation: f.conversation.trim() } : {}),
    ...(pairs ? { metadata: pairs } : {}),
    ...(f.from ? { from: f.from } : {}),
  };
}

/** The filters over the requests: projects, models and accounts as voice knows them. */
function Filters({ value: f, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const projects = useGet('/admin/v1/projects', { params: { query: { include_archived: true } } });
  const models = useGet('/admin/v1/models');
  const accounts = useGet('/admin/v1/accounts');
  const set = (k: keyof Filter) => (v: string) => onChange({ ...f, [k]: v });
  // the cutoff is fixed now, when the range is chosen
  const since = (v: string) => onChange({ ...f, since: v, from: v ? new Date(Date.now() - Number(v) * 1000).toISOString() : '' });
  const badPair = f.metadata.trim() !== '' && !metadataPairs(f.metadata);
  const any = Object.values(f).some(Boolean);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-3)' }}>
      <label>
        <div className="faint">project</div>
        <Select value={f.project} onChange={set('project')} empty="any" options={(projects.data?.data ?? []).map((p) => ({ value: p.id }))} />
      </label>
      <label>
        <div className="faint">model</div>
        <Select value={f.model} onChange={set('model')} empty="any" options={(models.data?.data ?? []).map((m) => ({ value: m.id }))} />
      </label>
      <label>
        <div className="faint">account</div>
        <Select value={f.account} onChange={set('account')} empty="any" options={(accounts.data?.data ?? []).map((a) => ({ value: a.id }))} />
      </label>
      <label>
        <div className="faint">key</div>
        <TextInput mono value={f.key} onChange={set('key')} placeholder="k_…" />
      </label>
      <label>
        <div className="faint">conversation</div>
        <TextInput mono value={f.conversation} onChange={set('conversation')} placeholder="its prompt_cache_key" />
      </label>
      <label>
        <div className={badPair ? 'c-wait' : 'faint'}>{badPair ? 'metadata: name=value, …' : 'metadata'}</div>
        <TextInput mono value={f.metadata} onChange={set('metadata')} placeholder="team=search, run=7" />
      </label>
      <label>
        <div className="faint">when</div>
        <Select value={f.since} onChange={since} options={SINCE} />
      </label>
      {any && <Button onClick={() => onChange(NO_FILTER)}>clear</Button>}
    </div>
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
