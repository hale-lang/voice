import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel, Table, Status, Loading, Unavailable, Kv, Mono, Button, Select, TextInput, Checkbox, micros, count, when, ago } from '@hale/components';
import { toneOf } from '../tone';
import { api, describe, useGet, USAGE_PAGE, type UsageRecord, type UsageRecordSummary, type Schemas } from '../api/client';
import { useRefetchInterval } from '../api/live';
import { subscribeFlights, type Flight } from '../api/events';
import { useWrite } from '../api/mutate';
import { useLastStep, stepLabel, settles } from '../api/steps';
import type { ScreenProps } from '../App';
import { readout } from '../readout';
import { PeekSection } from '../peek';
import { AnnotationSection, RefusedSummary } from '../annotation';
import { refusalLine } from '../refusal';
import { inputTokens } from '../input-tokens';
import { listedProjects } from '../projects-listed';
import { ConversationView } from './Conversation';
import { Toggle } from '../FleetMemory';
import { href } from '../route';
import { ConversationName } from '../titles';
import {
  viewOf,
  viewHref,
  opensConversation,
  filtered,
  fromOf,
  metadataPairs,
  requestsQuery,
  conversationsQuery,
  matchOf,
  mergeFresh,
  appended,
  conversationKey,
  modelSaid,
  statusSaid,
  inputSaid,
  throughput,
  conversationState,
  NO_VIEW,
  STATUSES,
  SINCE,
  type UsageView,
  type UsageTab,
  type ConversationUsage,
} from './usage-view';

/** The most requests one run annotates (`runAnnotations`). */
const RUN_MAX = 500;

type RunOutcome = Schemas['AnnotationRunOutcome'];

/**
 * The ledger two ways, a table each: every request, or every conversation
 * its requests are turns of. The view and its filters are the URL's query,
 * so a link keeps them; a row opens the request, or the conversation, in
 * the inspector, which shows its annotations. Each table is live: a new
 * request (or a conversation active again) rises to the top as the events
 * say, and the pages loaded below it stay.
 */
export function Usage({ route, setInspector }: ScreenProps) {
  // `usage/<request>`, or a conversation, `usage/c/<prompt_cache_key>`
  const conversation = route.parts[1] === 'c' ? (route.parts[2] ?? '') : null;
  const selected = conversation === null ? route.parts[1] : undefined;
  const view = viewOf(route.query, opensConversation(route.parts));
  // the cutoff the range names, fixed when it is chosen (or the page
  // opens), so the query stays the same while the events refresh it
  const from = useMemo(() => fromOf(view.since, Date.now()), [view.since]);
  const set = (next: Partial<UsageView>) => {
    location.hash = viewHref({ ...view, ...next }, ...route.parts);
  };
  useEffect(() => {
    if (conversation) setInspector(<ConversationView key={conversation} conversation={conversation} />);
    else setInspector(selected ? <RecordById id={selected} /> : null);
  }, [conversation, selected, setInspector]);

  return (
    <>
      <h1>Usage</h1>
      <Toggle<UsageTab>
        label="what the table lists"
        value={view.tab}
        options={[
          ['requests', 'Requests'],
          ['conversations', 'Conversations'],
        ]}
        onChange={(tab) => set({ tab })}
      />
      <Filters view={view} set={set} />
      {view.tab === 'requests' ? (
        <Requests view={view} from={from} selected={selected} open={(r) => (location.hash = viewHref(view, 'usage', r.id))} />
      ) : (
        <Conversations view={view} from={from} selected={conversation ?? undefined} open={(c) => (location.hash = viewHref(view, 'usage', 'c', c.conversation))} />
      )}
    </>
  );
}

type Page<T> = { data: T[]; next_cursor?: string | null };

/**
 * A list read a page at a time that stays live: its first page is a query
 * under `path`, which the events refresh; each time it lands its rows go
 * on top of those held (`mergeFresh`), so a refresh shows what is new
 * without reading again the pages loaded below, and what is on screen
 * stays while it reads. `more` loads the page after the last held.
 */
function useLivePages<T>(path: string, query: object, page: (cursor?: string) => Promise<Page<T>>, keyOf: (r: T) => string) {
  const refetchInterval = useRefetchInterval();
  const first = useQuery({ queryKey: [path, { live: query }], refetchInterval, queryFn: () => page(undefined) });
  const id = JSON.stringify(query);
  const [held, setHeld] = useState<{ id: string; at: number; rows: T[]; next: string | null }>({ id: '', at: 0, rows: [], next: null });
  const [loading, setLoading] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  useEffect(() => {
    const fresh = first.data;
    if (!fresh) return;
    setHeld((h) => {
      const mine = h.id === id ? h : { id, at: 0, rows: [], next: null };
      if (mine.at === first.dataUpdatedAt) return mine;
      const m = mergeFresh(mine.rows, fresh.data, keyOf);
      return { id, at: first.dataUpdatedAt, rows: m.rows, next: m.reset ? (fresh.next_cursor ?? null) : mine.next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first.data, first.dataUpdatedAt, id]);
  const mine = held.id === id ? held : null;
  async function more() {
    if (!mine?.next || loading.busy) return;
    setLoading({ busy: true, error: null });
    try {
      const p = await page(mine.next);
      setHeld((h) => (h.id === id ? { ...h, rows: appended(h.rows, p.data, keyOf), next: p.next_cursor ?? null } : h));
      setLoading({ busy: false, error: null });
    } catch (e) {
      setLoading({ busy: false, error: (e as Error).message });
    }
  }
  return { first, rows: mine?.rows ?? null, next: mine?.next ?? null, more, loading };
}

/** "Load more", and how many are shown. */
function More({ shown, next, loading, more, what }: { shown: number; next: string | null; loading: { busy: boolean; error: string | null }; more: () => void; what: string }) {
  return (
    <p style={{ marginBottom: 0, display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <Button onClick={more} disabled={!next || loading.busy}>{loading.busy ? 'loading…' : 'load more'}</Button>
      <span className="muted">
        {count(shown)} {what} shown{next ? '' : shown ? ', the oldest among them' : ''}
      </span>
      {loading.error && <span className="c-fail">{loading.error}</span>}
    </p>
  );
}

/** Every request the filters match, newest first, with what it cost and how fast it ran. */
function Requests({ view, from, selected, open }: { view: UsageView; from: string; selected?: string; open: (r: UsageRecordSummary) => void }) {
  const query = requestsQuery(view, from);
  const list = useLivePages<UsageRecordSummary>(
    '/admin/v1/usage',
    query,
    async (cursor) => {
      const r = await api.GET('/admin/v1/usage', { params: { query: { ...query, limit: USAGE_PAGE, ...(cursor ? { cursor } : {}) } } });
      if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
      return r.data;
    },
    (r) => r.id,
  );
  // what the filters match in all, from usage's own totals
  const totals = useGet('/admin/v1/usage/summary', { params: { query: { group_by: ['internal'], ...query } } });
  const matching = totals.data?.data.reduce((n, g) => n + g.requests, 0);
  const spent = totals.data ? spend(totals.data.data) : null;
  // the requests chosen to annotate: kept across pages, let go when the
  // filters change; or every one the filters match, which the run itself
  // finds (`runAnnotations` `matching`)
  const [chosen, setChosenIds] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const setChosen = (ids: Set<string>) => {
    setChosenIds(ids);
    setAllMatching(false);
  };
  const said = JSON.stringify(query);
  useEffect(() => setChosen(new Set()), [said]);
  const rows = list.rows ?? [];
  return (
    <Panel title="Requests" readout={readout(list.first, matching != null ? `${count(matching)} matching` : null, spent)}>
      <Annotate match={matchOf(view, from)} chosen={chosen} setChosen={setChosen} allMatching={allMatching} setAllMatching={setAllMatching} pageIds={rows.map((r) => r.id)} matching={matching} />
      {list.rows === null ? (
        list.first.isError ? <Unavailable what="Usage" detail={list.first.error.message} /> : <Loading what="usage" />
      ) : (
        <>
          {list.first.isError && <p className="c-fail">{list.first.error.message}</p>}
          <Table<UsageRecordSummary>
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={selected}
            onSelect={open}
            columns={[
              {
                key: 'pick',
                header: <PageBox ids={rows.map((r) => r.id)} chosen={chosen} setChosen={setChosen} all={allMatching} />,
                render: (r) => (
                  <input
                    type="checkbox"
                    aria-label={`choose ${r.id}`}
                    checked={allMatching || chosen.has(r.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const n = new Set(chosen);
                      if (e.target.checked) n.add(r.id);
                      else n.delete(r.id);
                      setChosen(n);
                    }}
                  />
                ),
              },
              { key: 'when', header: 'Time', render: (r) => <span className="muted" title={when(r.created_at)}>{ago(r.created_at)}</span> },
              {
                key: 'id',
                header: 'Request',
                render: (r) => (
                  <>
                    <Mono>{r.id}</Mono>
                    {r.internal && <Internal of={r} />}
                    {r.tool_arguments_repaired && (
                      <div className="c-wait" title="voice repaired a tool call's arguments its engine wrote before the caller had them; a recording keeps what the engine wrote">
                        tool args repaired
                      </div>
                    )}
                    <StepMark id={r.id} />
                  </>
                ),
              },
              {
                key: 'project',
                header: 'Project / key',
                render: (r) => (
                  <>
                    <Mono>{r.project}</Mono> <span className="muted">{r.key}</span>
                    {r.conversation && (
                      <div className="faint">
                        <ConversationName conversation={r.conversation} project={r.project} />
                      </div>
                    )}
                  </>
                ),
              },
              { key: 'model', header: 'Model', render: (r) => modelSaid(r) },
              { key: 'status', header: 'Status', render: (r) => <Status tone={toneOf(r.status)} label={r.status} title={statusSaid(r.status)} /> },
              { key: 'in', header: 'In', num: true, render: (r) => (r.input_tokens_estimated ? <span title="voice's estimate: its seat reported no usage">{inputSaid(r)}</span> : inputSaid(r)) },
              { key: 'out', header: 'Out', num: true, render: (r) => count(r.output_tokens) },
              { key: 'reason', header: 'Reasoning', num: true, render: (r) => (r.reasoning_tokens ? count(r.reasoning_tokens) : <span className="faint">–</span>) },
              { key: 'price', header: 'Price', num: true, render: (r) => micros(r.price_micros, r.currency) },
              { key: 'wall', header: 'Wall', num: true, render: (r) => `${r.timing.wall_ms} ms` },
              { key: 'first', header: 'First output', num: true, render: (r) => (r.timing.first_output_ms != null ? `${r.timing.first_output_ms} ms` : <span className="faint">–</span>) },
              { key: 'rate', header: 'Tok/s', num: true, render: (r) => throughput(r) },
            ]}
            empty={filtered(view) ? 'No request matches these filters.' : 'No requests yet.'}
          />
          <More shown={rows.length} next={list.next} loading={list.loading} more={() => void list.more()} what="requests" />
        </>
      )}
    </Panel>
  );
}

/** What a summary's groups spent, each currency apart. */
function spend(groups: { price_micros: number; currency: string }[]): string | null {
  const by = new Map<string, number>();
  for (const g of groups) by.set(g.currency, (by.get(g.currency) ?? 0) + g.price_micros);
  return by.size ? [...by].map(([c, n]) => micros(n, c)).join(' + ') : null;
}

/** Every conversation the filters' requests are turns of, the most recently active first. */
function Conversations({ view, from, selected, open }: { view: UsageView; from: string; selected?: string; open: (c: ConversationUsage) => void }) {
  const query = conversationsQuery(view, from);
  const list = useLivePages<ConversationUsage>(
    '/admin/v1/usage/conversations',
    query,
    async (cursor) => {
      const r = await api.GET('/admin/v1/usage/conversations', { params: { query: { ...query, limit: USAGE_PAGE, ...(cursor ? { cursor } : {}) } } });
      if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
      return r.data;
    },
    conversationKey,
  );
  // the requests in flight, as Network reads them: a row is lit while one
  // of its conversation runs, and no longer
  const [flying, setFlying] = useState<Flight[]>([]);
  useEffect(() => subscribeFlights(setFlying), []);
  const rows = list.rows ?? [];
  const chosen = rows.find((c) => c.conversation === selected);
  return (
    <Panel title="Conversations" readout={readout(list.first, list.rows ? `${count(rows.length)} shown` : null)}>
      {list.rows === null ? (
        list.first.isError ? <Unavailable what="Conversations" detail={list.first.error.message} /> : <Loading what="conversations" />
      ) : (
        <>
          {list.first.isError && <p className="c-fail">{list.first.error.message}</p>}
          <Table<ConversationUsage>
            rows={rows}
            rowKey={conversationKey}
            selectedKey={chosen ? conversationKey(chosen) : undefined}
            onSelect={open}
            columns={[
              { key: 'title', header: 'Conversation', render: (c) => (c.title ? <span title={c.conversation}>{c.title}</span> : <Mono>{c.conversation}</Mono>) },
              { key: 'project', header: 'Project / keys', render: (c) => <><Mono>{c.project}</Mono> <span className="muted">{c.keys.join(', ')}</span></> },
              { key: 'models', header: 'Models', render: (c) => c.models.join(', ') },
              { key: 'requests', header: 'Requests', num: true, render: (c) => count(c.requests) },
              { key: 'in', header: 'In', num: true, render: (c) => inputSaid({ input_tokens: c.input_tokens, cached_input_tokens: c.cached_input_tokens }) },
              { key: 'out', header: 'Out', num: true, render: (c) => count(c.output_tokens) },
              { key: 'price', header: 'Price', num: true, render: (c) => micros(c.price_micros, c.currency) },
              { key: 'last', header: 'Last activity', render: (c) => <span className="muted" title={`${when(c.first_at)} → ${when(c.last_at)}`}>{ago(c.last_at)}</span> },
              {
                key: 'status',
                header: 'Status',
                render: (c) => {
                  const st = conversationState(c, flying);
                  return <Status tone={st.tone} label={st.label} title={st.title} />;
                },
              },
            ]}
            empty={filtered(view) ? 'No conversation matches these filters.' : 'No conversations yet: a request names one by its prompt_cache_key.'}
          />
          <More shown={rows.length} next={list.next} loading={list.loading} more={() => void list.more()} what="conversations" />
        </>
      )}
    </Panel>
  );
}

/** A filter's label above it. */
function Labelled({ label, warn, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <label>
      <div className={warn ? 'c-wait' : 'faint'}>{label}</div>
      {children}
    </label>
  );
}

/** A text filter, applied when it is left or Enter is pressed, so each keystroke is not a query. */
function Draft({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim());
  };
  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <span onBlur={commit} style={{ display: 'contents' }}>
        <TextInput mono value={text} onChange={setText} placeholder={placeholder} />
      </span>
    </form>
  );
}

/**
 * The filters over either table: projects, models and accounts as voice
 * knows them. The requests are filtered by how each ended, and by their
 * account, conversation and metadata too; the conversations by whether one
 * of their requests failed.
 */
function Filters({ view: v, set }: { view: UsageView; set: (next: Partial<UsageView>) => void }) {
  const projects = useGet('/admin/v1/projects', { params: { query: { include_archived: true } } });
  const models = useGet('/admin/v1/models');
  const accounts = useGet('/admin/v1/accounts');
  const requests = v.tab === 'requests';
  const badPair = v.metadata.trim() !== '' && !metadataPairs(v.metadata);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'end', margin: 'var(--space-3) 0' }} aria-label="filters">
      <Labelled label="project">
        <Select value={v.project} onChange={(project) => set({ project })} empty="any" options={listedProjects(projects.data?.data ?? [], { chosen: v.project }).map((p) => ({ value: p.id }))} />
      </Labelled>
      <Labelled label="key">
        <Draft value={v.key} onCommit={(key) => set({ key })} placeholder="k_…" />
      </Labelled>
      <Labelled label="model">
        <Select value={v.model} onChange={(model) => set({ model })} empty="any" options={(models.data?.data ?? []).map((m) => ({ value: m.id }))} />
      </Labelled>
      {requests && (
        <>
          <Labelled label="status">
            <Select value={v.status} onChange={(status) => set({ status: status as UsageView['status'] })} empty="any" options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
          </Labelled>
          <Labelled label="account">
            <Select value={v.account} onChange={(account) => set({ account })} empty="any" options={(accounts.data?.data ?? []).map((a) => ({ value: a.id }))} />
          </Labelled>
          <Labelled label="conversation">
            <Draft value={v.conversation} onCommit={(conversation) => set({ conversation })} placeholder="its prompt_cache_key" />
          </Labelled>
          <Labelled label={badPair ? 'metadata: name=value, …' : 'metadata'} warn={badPair}>
            <Draft value={v.metadata} onCommit={(metadata) => set({ metadata })} placeholder="team=search, run=7" />
          </Labelled>
        </>
      )}
      <Labelled label="when">
        <Select value={v.since} onChange={(since) => set({ since })} options={SINCE} />
      </Labelled>
      {!requests && <Checkbox checked={v.failures} onChange={(failures) => set({ failures })} label="only those with a failed request" />}
      <Checkbox checked={v.internal} onChange={(internal) => set({ internal })} label="show internal: voice's own requests for each project (annotations, titles)" />
      {filtered(v) && <Button onClick={() => set({ ...NO_VIEW, tab: v.tab })}>clear</Button>}
    </div>
  );
}

/** The page's requests, chosen or let go at once. */
function PageBox({ ids, chosen, setChosen, all: matching }: { ids: string[]; chosen: Set<string>; setChosen: (s: Set<string>) => void; all: boolean }) {
  const all = matching || (ids.length > 0 && ids.every((id) => chosen.has(id)));
  return (
    <input
      type="checkbox"
      aria-label="choose the requests shown"
      checked={all}
      ref={(el) => { if (el) el.indeterminate = !all && ids.some((id) => chosen.has(id)); }}
      onChange={(e) => {
        const n = new Set(matching ? ids : chosen);
        for (const id of ids) {
          if (e.target.checked) n.add(id);
          else n.delete(id);
        }
        setChosen(n);
      }}
    />
  );
}

/** A request's annotation as its steps tell it, while this view watches: its last step. */
function StepMark({ id }: { id: string }) {
  const step = useLastStep(id);
  if (!step) return null;
  return <div className={settles(step) ? (step.step === 'kept' ? 'faint' : 'c-wait') : 'faint'} title={step.reason || undefined}>{stepLabel(step)}</div>;
}

/**
 * The chosen requests annotated now (`runAnnotations`): every annotator in
 * force for each, or the one picked. The chosen are named, those shown or
 * not, or are every request the filters match, which the run finds itself
 * (`matching`: the newest `RUN_MAX`, the most one run takes); each comes
 * back queued, or refused and why, and those refused are said in one
 * line. Each queued one's steps show on its row as they happen.
 */
function Annotate({ match, chosen, setChosen, allMatching, setAllMatching, pageIds, matching }: { match: Schemas['UsageMatch']; chosen: Set<string>; setChosen: (s: Set<string>) => void; allMatching: boolean; setAllMatching: (all: boolean) => void; pageIds: string[]; matching: number | undefined }) {
  const annotators = useGet('/admin/v1/annotators');
  const [annotator, setAnnotator] = useState('');
  const [outcomes, setOutcomes] = useState<RunOutcome[] | null>(null);
  const w = useWrite();
  const allPage = pageIds.length > 0 && pageIds.every((id) => chosen.has(id));
  const selected = allMatching ? Math.min(matching ?? 0, RUN_MAX) : chosen.size;
  async function run() {
    const which = allMatching ? { matching: match } : { request_ids: [...chosen].slice(0, RUN_MAX) };
    const r = await w.write('post', '/admin/v1/annotation-runs', { body: { ...which, ...(annotator ? { annotator } : {}) } });
    if (r) setOutcomes(r.data);
  }
  const refused = outcomes?.filter((o) => !o.queued) ?? [];
  const queued = outcomes ? outcomes.length - refused.length : 0;
  if (!chosen.size && !allMatching && !outcomes) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', margin: 'var(--space-2) 0' }} aria-label="annotate the chosen requests">
      <span><b>{count(selected)}</b> selected{allMatching ? ', every one matching' : ''}</span>
      {!allMatching && allPage && matching != null && matching > chosen.size && (
        <Button onClick={() => setAllMatching(true)}>
          select all {count(Math.min(matching, RUN_MAX))} matching{matching > RUN_MAX ? ` (of ${count(matching)}, the newest the most one run takes)` : ''}
        </Button>
      )}
      <Select
        value={annotator}
        onChange={setAnnotator}
        options={[{ value: '', label: 'every annotator in force' }, ...(annotators.data?.data ?? []).filter((a) => a.enabled).map((a) => ({ value: a.id, label: a.id }))]}
      />
      <Button tone="primary" onClick={() => void run()} disabled={w.busy || !selected}>Annotate selected</Button>
      {selected > 0 && <Button onClick={() => { setChosen(new Set()); setOutcomes(null); }}>clear</Button>}
      {w.error && <span className="c-fail">{w.error}</span>}
      {outcomes && (
        <span className="muted" aria-label="annotate outcome">
          {count(queued)} queued
          {refused.length > 0 && (
            <span className="c-wait" title={refused.map((o) => `${o.request_id}: ${refusalLine(o)}`).join('\n')}>
              {' '}· {count(refused.length)} not queued: <RefusedSummary outcomes={refused} />
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** A record that is not on the page shown: read by its id. */
function RecordById({ id }: { id: string }) {
  const q = useGet('/admin/v1/usage/{request_id}', { params: { path: { request_id: id } } });
  if (q.isPending) return <Loading what="the request" />;
  if (q.isError) return <Unavailable what="The request" detail={q.error.message} />;
  return <RecordInspector record={q.data} />;
}

function RecordInspector({ record: r }: { record: UsageRecord }) {
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-1)' }}>
        <Mono>{r.id}</Mono> <Status tone={toneOf(r.status)} label={r.status} />
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {r.served?.model ?? r.requested_model} on <Mono>{r.served?.seat ?? '–'}</Mono> · {inputTokens(r)} in · {count(r.output_tokens)} out · {r.timing.wall_ms} ms · {when(r.created_at)}
      </p>
      <Kv
        rows={[
          { k: 'status', v: <Status tone={toneOf(r.status)} label={r.status} /> },
          { k: 'created', v: when(r.created_at) },
          { k: 'project', v: <Mono>{r.project}</Mono> },
          { k: 'key', v: <><Mono>{r.key}</Mono>{r.internal && <Internal of={internalOf(r)} />}</> },
          { k: 'requested', v: <>{r.requested_model}{r.requested_account ? <span className="muted"> on {r.requested_account}</span> : null}</> },
          { k: 'served', v: r.served ? <><Mono>{r.served.seat}</Mono> · {r.served.model}{r.served.quantization ? ` (${r.served.quantization})` : ''} · {r.served.engine}</> : '–' },
          { k: 'account', v: r.served?.account ?? '–' },
          { k: 'conversation', v: r.conversation ? <><ConversationName conversation={r.conversation} project={r.project} mono /> <a href={href('usage', 'c', r.conversation)}>read it</a></> : <span className="faint">none</span> },
          { k: 'data class', v: r.data_class ?? '–' },
          { k: 'tokens', v: `${inputTokens(r)} in (${count(r.cached_input_tokens ?? 0)} cached, ${count(r.cache_write_input_tokens ?? 0)} written) · ${count(r.output_tokens)} out (${count(r.reasoning_tokens ?? 0)} reasoning)` },
          { k: 'price', v: micros(r.price_micros, r.currency) },
          { k: 'timing', v: `wall ${r.timing.wall_ms} · queue ${r.timing.queue_ms} · load ${r.timing.load_ms} ms` },
          { k: 'attempts', v: (r.attempts ?? []).map((a, i) => <div key={i}><Mono>{a.seat}</Mono> <Status tone={a.outcome === 'served' ? 'quiet' : 'fail'} label={a.outcome} />{a.error ? <span className="muted"> {a.error}</span> : null}</div>) },
          ...(r.tool_arguments_repaired ? [{ k: 'tool arguments', v: <span className="muted">repaired before the caller had them; a recording keeps what the engine wrote</span> }] : []),
          { k: 'metadata', v: <Metadata of={r.metadata} /> },
        ]}
      />
      <AnnotationSection id={r.id} />
      <PeekSection id={r.id} />
    </>
  );
}


/** What an internal request's metadata says of it, as its summary says it. */
function internalOf(r: UsageRecord): { annotates?: string; side?: string } {
  const m = (r.metadata ?? {}) as Record<string, unknown>;
  return {
    ...(typeof m.annotates === 'string' ? { annotates: m.annotates } : {}),
    ...(typeof m.side === 'string' ? { side: m.side } : {}),
  };
}

/**
 * What a request of a project's system key was: voice's own for the
 * project, an annotation's stage (or a title) for the request it names,
 * kept apart from the project's usage.
 */
function Internal({ of: r }: { of: { annotates?: string; side?: string } }) {
  const of = r.annotates ?? null;
  const side = r.side ?? null;
  return (
    <div className="faint" title="voice's own request for the project, under its system key: not in its usage, its limits or what is told to the organization">
      internal{side ? ` · ${side === 'title' ? 'its title' : `the ${side} stage`}` : ''}
      {of && (
        <>
          {' '}of <a href={href('usage', of)} onClick={(e) => e.stopPropagation()}><Mono>{of}</Mono></a>
        </>
      )}
    </div>
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

