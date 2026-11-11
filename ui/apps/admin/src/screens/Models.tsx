import { useEffect, useMemo, useState } from 'react';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, NumberInput, Select, Button, Confirm, micros, when } from '@hale/components';
import { useGet, useNodes, useNodesWhole, useRecipes, type CatalogModel, type Node, type NodeSummary, type Placement } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { ContextWindow } from '../context';
import { NamedByList, useAliasesByModel } from '../aliases';
import { modelState } from './placement-state';
import { modelSource, sourceLabel, type EngineKindOf, type ModelSource, type SeatInfo } from './model-source';
import { apiWrites, harnessKinds, harnessWrites, freshSeatId, loginEntry, noNodeOffers, nodesOffering, priceOf, type AddWrites, type HarnessInfo, type Offer } from './add-model';

/**
 * What the Models screen reads besides the catalog: every node's seats (a
 * model's seats, by ref), every node whole (the kind of each engine it
 * declares), and the placements; each a model's source is derived from
 * (model-source.ts).
 */
function useFleet() {
  const nodes = useNodes();
  const placements = useGet('/admin/v1/placements');
  const ids = (nodes.data?.data ?? []).map((n) => n.id);
  const whole = useNodesWhole(ids);
  const declared = whole.map((q) => q.data).filter((n): n is Node => !!n);
  const key = declared.map((n) => `${n.id}:${(n.capabilities?.engines ?? []).map((e) => `${e.id}=${e.kind}`).join(',')}`).join(';');
  const kindOf: EngineKindOf = useMemo(() => {
    const kinds = new Map(declared.flatMap((n) => (n.capabilities?.engines ?? []).map((e) => [`${n.id}/${e.id}`, e.kind] as const)));
    return (node, engine) => kinds.get(`${node}/${engine}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const seatAt = (ref: string): (NodeSummary['seats'][number] & SeatInfo) | undefined =>
    nodes.data?.data.find((x) => x.id === ref.split('/')[0])?.seats.find((s) => s.ref === ref);
  return { nodes, placements, declared, kindOf, seatAt, ready: nodes.isSuccess && placements.isSuccess };
}

/**
 * A model's state as words: served; starting, and how far, while a
 * placement or seat of it comes up; or why nothing serves it.
 */
function Availability({ m, short }: { m: CatalogModel; short?: boolean }) {
  const f = useFleet();
  if (m.available) return short ? <Status tone="ok" label="served" /> : <>served</>;
  if (!f.ready) return <span className="faint">–</span>;
  const st = modelState(m, f.placements.data!.data, f.seatAt)!;
  const tone = st.state === 'starting' ? 'wait' : 'fail';
  if (short) return <Status tone={tone} label={st.label} title={st.detail} />;
  return <span className={st.state === 'starting' ? 'c-wait' : 'c-fail'}>{st.label}: {st.detail}</span>;
}

/** A price, or `flat-rate` for a model a subscription alone serves. */
function priceText(m: CatalogModel, src: ModelSource | undefined) {
  if (src?.flatRate) return 'flat-rate';
  return m.price ? `${micros(m.price.input_per_mtok_micros, m.price.currency)} · ${micros(m.price.output_per_mtok_micros, m.price.currency)}` : <span className="faint">free</span>;
}

/** What a model's seats carry: tools, reasoning, both or neither. */
function carries(m: CatalogModel): string {
  const what = [m.tools ? 'tools' : '', m.reasoning ? 'reasoning' : ''].filter(Boolean);
  return what.length ? what.join(' · ') : '–';
}

/**
 * Models: every model voice serves, however it is served, in one list. Each
 * row's source is read off what serves it: a placement (local), a claude-cli
 * seat (a subscription), an openai-compatible seat (an api) or the static
 * engine (a test). A row opens its placement or its seat; its name opens the
 * model itself.
 */
export function Models({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/models');
  const named = useAliasesByModel();
  const f = useFleet();
  const model = q.data?.data.find((m) => m.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <AddModel /> : model ? <ModelInspector model={model} /> : null);
  }, [creating, model, setInspector]);

  if (q.isPending) return <Loading what="the models" />;
  if (q.isError) return <Unavailable what="Models" detail={q.error.message} />;
  if (selected && !creating && !model) return <Missing what={`model ${selected}`} />;

  const sources = new Map(q.data.data.map((m) => [m.id, f.ready ? modelSource(m, f.seatAt, f.kindOf, f.placements.data!.data) : undefined]));
  const open = (m: CatalogModel) => {
    const t = sources.get(m.id)?.target;
    if (t?.kind === 'placement') go('placements', t.id);
    else if (t?.kind === 'seat') go('nodes', t.node, t.seat);
    else go('models', m.id);
  };
  return (
    <>
      <h1>Models</h1>
      <Panel title="Models" readout={readout(q, `${q.data.data.length} models`)}>
        <Table<CatalogModel>
          rows={q.data.data}
          rowKey={(m) => m.id}
          selectedKey={selected}
          onSelect={open}
          columns={[
            { key: 'id', header: 'Model', render: (m) => <a href={href('models', m.id)} onClick={(e) => e.stopPropagation()}><Mono>{m.id}</Mono></a> },
            { key: 'aliases', header: 'Named by', render: (m) => <NamedByList names={named.get(m.id)} /> },
            { key: 'source', header: 'Source', render: (m) => sourceText(sources.get(m.id), m.contract) },
            { key: 'account', header: 'Account', render: (m) => <Mono>{sources.get(m.id)?.accounts.join(', ') || '–'}</Mono> },
            { key: 'where', header: 'Served on', render: (m) => sources.get(m.id)?.nodes.join(', ') || <span className="faint">–</span> },
            { key: 'avail', header: 'Status', render: (m) => <Availability m={m} short /> },
            { key: 'ctx', header: 'Context', num: true, render: (m) => <ContextWindow served={m.served_context_length} native={m.context_length} /> },
            { key: 'carries', header: 'Carries', render: carries },
            { key: 'price', header: 'Price / Mtok in · out', num: true, render: (m) => priceText(m, sources.get(m.id)) },
            { key: 'load', header: 'In flight', num: true, render: (m) => sources.get(m.id)?.inFlight ?? '–' },
          ]}
          empty="No models. Add one: place a local model, or serve a Claude subscription or a remote API."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('models', 'new')} tone="primary">add a model</Button>
        </p>
      </Panel>
    </>
  );
}

function sourceText(src: ModelSource | undefined, contract: CatalogModel['contract']) {
  if (!src) return <span className="faint">–</span>;
  const words = src.sources.length ? src.sources.map(sourceLabel).join(' + ') : 'nothing serves it';
  return <span className={src.sources.length ? undefined : 'faint'}>{words}{contract === 'decision' ? ' · decisions' : ''}</span>;
}

type Path = 'local' | 'subscription' | 'api';

/**
 * Adding a model, by how it is to be served: a local model from a recipe,
 * then placed; a coding CLI's login, a harness seat under the account's
 * login on a node whose capabilities offer a harness engine, as the
 * harness's definition describes it; or a remote API, an
 * openai-compatible seat on a node offering that engine. Each with the admin
 * API as it is: the catalog model, then its seat.
 */
function AddModel() {
  const [path, setPath] = useState<Path>('subscription');
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>Add a model</h2>
      <Field label="served by" help="local: weights on voice's nodes, placed; a coding CLI: its official CLI under an account's login, flat-rate, for coding attempts (and requests, for claude); a remote API: an OpenAI-compatible endpoint with a key, metered">
        <Select value={path} onChange={(v) => setPath(v as Path)} options={[{ value: 'local', label: 'local (a recipe, placed)' }, { value: 'subscription', label: "a coding CLI's login" }, { value: 'api', label: 'a remote API' }]} />
      </Field>
      {path === 'local' ? <ModelForm local /> : path === 'subscription' ? <AddHarness /> : <AddApi />}
    </>
  );
}

/** The nodes offering an engine of one of `kinds`, as the add forms read them. */
function useOffers(...kinds: string[]): { offers: Offer[]; ready: boolean } {
  const f = useFleet();
  const allRead = f.nodes.isSuccess && f.declared.length === (f.nodes.data?.data.length ?? 0);
  return { offers: nodesOffering(f.declared, ...kinds), ready: allRead };
}

/** The catalog model, then its seat; a model already in the catalog that nothing serves is kept, not made again. */
async function addBoth(w: ReturnType<typeof useWrite>, writes: AddWrites, catalog: CatalogModel[], nodes: NodeSummary[]) {
  const existing = catalog.find((m) => m.id === writes.model.id);
  if (existing && existing.seats.length > 0) {
    w.clear();
    return `model ${writes.model.id} exists and is served; name another`;
  }
  if (!existing) {
    const made = await w.write('post', '/admin/v1/models', { body: writes.model });
    if (!made) return null;
  }
  const taken = new Set((nodes.find((n) => n.id === writes.node)?.seats ?? []).map((s) => s.id));
  const seat = { ...writes.seat, id: freshSeatId(writes.seat.id, taken) };
  const r = await w.write('post', '/admin/v1/nodes/{node}/seats', { params: { path: { node: writes.node } }, body: seat });
  if (r) go('nodes', writes.node, seat.id);
  return null;
}

/**
 * One form for every coding CLI: the harness (its definition says how a
 * login of it is made and named), the node and engine that run it, the
 * account it spends, its login, and the CLI's own name for its model.
 */
function AddHarness() {
  const w = useWrite();
  const catalog = useGet('/admin/v1/models');
  const accounts = useGet('/admin/v1/accounts');
  const defs = useGet('/admin/v1/harnesses');
  const nodes = useNodes();
  const [harness, setHarness] = useState('');
  const list: HarnessInfo[] = (defs.data?.data ?? []) as HarnessInfo[];
  const h = list.find((d) => d.id === harness) ?? list[0];
  const { offers, ready } = useOffers(...harnessKinds(h?.id ?? ''));
  const [node, setNode] = useState('');
  const [account, setAccount] = useState('');
  const [login, setLogin] = useState('');
  const [loginSet, setLoginSet] = useState(false);
  const [cliModel, setCliModel] = useState('');
  const [name, setName] = useState('');
  const [nameSet, setNameSet] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (defs.isPending || !ready) return <Loading what="the harnesses and the nodes' engines" />;
  if (!h) return <p className="c-fail">voice has no harness definitions: its api reads them from its harnesses directory at start.</p>;
  const offer = offers.find((o) => o.node === node) ?? (offers.length === 1 ? offers[0] : undefined);
  const shownLogin = loginSet ? login : loginEntry(h, account);
  const shownName = nameSet ? name : `${h.id}-${cliModel.trim() || 'default'}`;
  return (
    <Form
      error={refused ?? w.error}
      onSubmit={async () => {
        if (!offer) return;
        setRefused(await addBoth(w, harnessWrites({ model: shownName, offer, account, harness: h.id, login: shownLogin, cliModel }), catalog.data?.data ?? [], nodes.data?.data ?? []));
      }}
      actions={
        <>
          <Button type="submit" tone="primary" disabled={w.busy || !offer || !account || !shownLogin || !shownName}>add</Button>
          <Button onClick={() => go('models')}>cancel</Button>
        </>
      }
    >
      <Field label="harness" required help="the coding CLI, as voice's definition of it runs it: in a container, under its own permission policy">
        <Select value={h.id} onChange={(v) => { setHarness(v); setNameSet(false); setLoginSet(false); }} options={list.map((d) => ({ value: d.id, label: `${d.id} · ${d.name}` }))} required />
      </Field>
      {offers.length === 0 ? (
        <p className="c-fail">{noNodeOffers('harness')}.</p>
      ) : (
        <Field label="node" required help="one whose capabilities offer a harness engine">
          <Select value={offer?.node ?? ''} onChange={setNode} options={offers.map((o) => ({ value: o.node, label: `${o.node} · ${o.engine}` }))} required empty={offers.length === 1 ? undefined : ''} />
        </Field>
      )}
      <Field label="account" required help="the subscription it spends: flat-rate, its windows the only cap">
        <Select value={account} onChange={setAccount} options={(accounts.data?.data ?? []).filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.id} · ${a.billing}` }))} required empty="" />
      </Field>
      <Field label="login" required help={`${h.login.describe ?? ''}${h.login.setup ? ` On the node: ${h.login.setup}` : ''}`}>
        <TextInput mono value={shownLogin} onChange={(v) => { setLogin(v); setLoginSet(true); }} required placeholder={loginEntry(h, 'work')} />
      </Field>
      <Field label="model" help="the CLI's own name for its model; its default when empty">
        <TextInput mono value={cliModel} onChange={setCliModel} placeholder="its default" />
      </Field>
      <Field label="name" required help="the catalog model attempts and requests name; never reused for a different model">
        <TextInput mono value={shownName} onChange={(v) => { setName(v); setNameSet(true); }} required />
      </Field>
    </Form>
  );
}

function AddApi() {
  const w = useWrite();
  const catalog = useGet('/admin/v1/models');
  const accounts = useGet('/admin/v1/accounts');
  const nodes = useNodes();
  const { offers, ready } = useOffers('openai-compatible');
  const [node, setNode] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [account, setAccount] = useState('');
  const [keyVault, setKeyVault] = useState('');
  const [upstream, setUpstream] = useState('');
  const [name, setName] = useState('');
  const [nameSet, setNameSet] = useState(false);
  const [ctx, setCtx] = useState<number | null>(null);
  const [priceIn, setPriceIn] = useState<number | null>(null);
  const [priceOut, setPriceOut] = useState<number | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const offer = offers.find((o) => o.node === node) ?? (offers.length === 1 ? offers[0] : undefined);
  const shownName = nameSet ? name : upstream.split('/').pop() ?? '';
  if (!ready) return <Loading what="the nodes' engines" />;
  if (offers.length === 0) return <p className="c-fail">{noNodeOffers('openai-compatible')}.</p>;
  return (
    <Form
      error={refused ?? w.error}
      onSubmit={async () => {
        if (!offer) return;
        const writes = apiWrites({ model: shownName, offer, account, baseUrl, keyVault, upstream, price: priceOf(priceIn, priceOut), contextLength: ctx });
        setRefused(await addBoth(w, writes, catalog.data?.data ?? [], nodes.data?.data ?? []));
      }}
      actions={
        <>
          <Button type="submit" tone="primary" disabled={w.busy || !offer || !account || !baseUrl || !upstream || !shownName}>add</Button>
          <Button onClick={() => go('models')}>cancel</Button>
        </>
      }
    >
      <Field label="node" required help="one whose capabilities offer an openai-compatible engine: the node sends the requests">
        <Select value={offer?.node ?? ''} onChange={setNode} options={offers.map((o) => ({ value: o.node, label: `${o.node} · ${o.engine}` }))} required empty={offers.length === 1 ? undefined : ''} />
      </Field>
      <Field label="endpoint" required help="the API's root, up to its version: requests go to <endpoint>/chat/completions">
        <TextInput mono type="url" value={baseUrl} onChange={setBaseUrl} required placeholder="https://openrouter.ai/api/v1" />
      </Field>
      <Field label="account" required help="what it spends, metered at the price below">
        <Select value={account} onChange={setAccount} options={(accounts.data?.data ?? []).filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.id} · ${a.billing}` }))} required empty="" />
      </Field>
      <Field label="key's vault entry" help="where the node's vault holds the API key; empty for an endpoint that takes none">
        <TextInput mono value={keyVault} onChange={setKeyVault} placeholder="openrouter-key" />
      </Field>
      <Field label="upstream model" required help="the endpoint's own name for the model">
        <TextInput mono value={upstream} onChange={setUpstream} required placeholder="openai/gpt-oss-120b" />
      </Field>
      <Field label="name" required help="what callers name; never reused for a different model">
        <TextInput mono value={shownName} onChange={(v) => { setName(v); setNameSet(true); }} required />
      </Field>
      <Field label="context length" help="tokens the endpoint serves, when you know it">
        <NumberInput value={ctx} onChange={setCtx} min={1} />
      </Field>
      <Field label="price per million input tokens (USD)" help="empty on both for free">
        <NumberInput value={priceIn} onChange={setPriceIn} min={0} step={0.01} />
      </Field>
      <Field label="price per million output tokens (USD)">
        <NumberInput value={priceOut} onChange={setPriceOut} min={0} step={0.01} />
      </Field>
    </Form>
  );
}

/**
 * A model's own fields, changed; or, `local`, a local model added from a
 * recipe, then placed (Placements).
 */
function ModelForm({ model, local }: { model?: CatalogModel; local?: boolean }) {
  const w = useWrite();
  const [id, setId] = useState(model?.id ?? '');
  const [ownedBy, setOwnedBy] = useState(model?.owned_by ?? 'local');
  const [kind, setKind] = useState<'local' | 'hosted'>(local ? 'local' : model?.kind ?? 'local');
  const [recipe, setRecipe] = useState(model?.recipe ?? '');
  // what it answers; "" is its recipe's (else generative) on create
  const [contract, setContract] = useState<'' | 'generative' | 'decision'>(model?.contract ?? '');
  const recipes = useRecipes();
  const [ctx, setCtx] = useState<number | null>(model?.context_length ?? null);
  const [maxOut, setMaxOut] = useState<number | null>(model?.max_output_tokens ?? null);
  const [priceIn, setPriceIn] = useState<number | null>(model?.price ? model.price.input_per_mtok_micros / 1e6 : null);
  const [priceOut, setPriceOut] = useState<number | null>(model?.price ? model.price.output_per_mtok_micros / 1e6 : null);
  const price = priceIn != null && priceOut != null ? { input_per_mtok_micros: Math.round(priceIn * 1e6), output_per_mtok_micros: Math.round(priceOut * 1e6), currency: 'USD' } : null;
  return (
    <>
      {local ? (
        <p className="muted">A local model's weights come from a recipe; it is served once it is placed on a node. Add it here, then place it, or <a href={href('placements', 'new')}>place a model already in the catalog</a>.</p>
      ) : (
        <h2 style={{ marginBottom: 'var(--space-3)' }}>{model ? <Mono>{model.id}</Mono> : 'Add model'}</h2>
      )}
      <Form
        error={w.error}
        onSubmit={async () => {
          const body = { owned_by: ownedBy, kind, context_length: ctx ?? undefined, max_output_tokens: maxOut ?? undefined, price, ...(contract ? { contract } : {}) };
          const r = model
            ? await w.write('patch', '/admin/v1/models/{model}', { params: { path: { model: model.id } }, body })
            : await w.write('post', '/admin/v1/models', { body: { id, ...body, recipe: kind === 'local' && recipe ? recipe : undefined } });
          if (r) {
            if (local) go('placements', 'new');
            else go('models', model?.id ?? id);
          }
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy || (local && !recipe)}>{model ? 'save' : local ? 'add, then place it' : 'add'}</Button>
            <Button onClick={() => go('models', ...(model ? [model.id] : []))}>cancel</Button>
          </>
        }
      >
        {!model && (
          <Field label="id" required help="what callers name; never reused for a different model">
            <TextInput mono value={id} onChange={setId} required placeholder="claude-sonnet-5" />
          </Field>
        )}
        {!local && (
          <Field label="kind" required>
            <Select value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: 'local' }, { value: 'hosted' }]} />
          </Field>
        )}
        {!model && kind === 'local' && (
          <Field label="recipe" required={local} help="the allowed weights voice installs it from, for a placement; fixed once created">
            <Select value={recipe} onChange={setRecipe} options={(recipes.data?.data ?? []).map((r) => ({ value: r.id, label: `${r.id} · ${r.origin}` }))} required={local} empty={local ? '' : 'none (a seat names its own)'} />
          </Field>
        )}
        <Field label="owned by" help="the provider, or local">
          <TextInput value={ownedBy} onChange={setOwnedBy} />
        </Field>
        <Field label="answers" help="decision: only a structured request (a JSON schema of choices, yes/no and scores), with each answer's probability; for a Jev-style model, local or behind a service">
          <Select
            value={contract}
            onChange={(v) => setContract(v as typeof contract)}
            options={[...(model ? [] : [{ value: '', label: "its recipe's, else text" }]), { value: 'generative', label: 'text (generative)' }, { value: 'decision', label: 'decisions' }]}
          />
        </Field>
        <Field label="context length" help="tokens the model is made for; one made from a recipe takes the recipe's when left empty">
          <NumberInput value={ctx} onChange={setCtx} min={1} />
        </Field>
        <Field label="max output tokens" help="the default and maximum; reserved when a request sets none">
          <NumberInput value={maxOut} onChange={setMaxOut} min={1} />
        </Field>
        <Field label="price per million input tokens (USD)" help="empty on both for free">
          <NumberInput value={priceIn} onChange={setPriceIn} min={0} step={0.01} />
        </Field>
        <Field label="price per million output tokens (USD)">
          <NumberInput value={priceOut} onChange={setPriceOut} min={0} step={0.01} />
        </Field>
      </Form>
    </>
  );
}

function ModelInspector({ model: m }: { model: CatalogModel }) {
  const w = useWrite();
  const named = useAliasesByModel();
  const f = useFleet();
  const src = f.ready ? modelSource(m, f.seatAt, f.kindOf, f.placements.data!.data) : undefined;
  const placed = (f.placements.data?.data ?? []).filter((p: Placement) => p.model === m.id);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [m]);
  if (editing) return <ModelForm model={m} />;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{m.id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'source', v: sourceText(src, m.contract) },
          { k: 'kind', v: `${m.kind ?? 'local'} · ${m.owned_by ?? 'local'}` },
          { k: 'account', v: <Mono>{src?.accounts.join(', ') || '–'}</Mono> },
          { k: 'served on', v: src?.nodes.join(', ') || '–' },
          { k: 'placements', v: placed.length ? placed.map((p) => <div key={p.id}><a href={href('placements', p.id)}><Mono>{p.id}</Mono></a></div>) : '–' },
          { k: 'carries', v: carries(m) },
          { k: 'recipe', v: m.recipe ? <a href={href('recipes', m.recipe)}><Mono>{m.recipe}</Mono></a> : '–' },
          { k: 'answers', v: m.contract === 'decision' ? 'decisions: a structured request only, with probabilities' : 'text' },
          { k: 'context', v: m.context_length ? `${m.context_length.toLocaleString()} tokens, made for` : '–' },
          { k: 'served', v: m.served_context_length ? <ContextWindow served={m.served_context_length} native={m.context_length} /> : <span className="faint">no seat has said</span> },
          { k: 'max output', v: m.max_output_tokens?.toLocaleString() ?? '–' },
          { k: 'price', v: src?.flatRate ? 'flat-rate: the subscription is its cap' : m.price ? `${micros(m.price.input_per_mtok_micros, m.price.currency)} in · ${micros(m.price.output_per_mtok_micros, m.price.currency)} out, per Mtok` : 'free' },
          { k: 'available', v: <Availability m={m} /> },
          { k: 'seats', v: m.seats.length ? m.seats.map((s) => <div key={s}><a href={href('nodes', s.split('/')[0] ?? '', s.split('/')[1] ?? '')}><Mono>{s}</Mono></a></div>) : 'none' },
          { k: 'named by', v: <NamedByList names={named.get(m.id)} /> },
          { k: 'created', v: when(m.created_at) },
        ]}
      />
      <p style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <Button onClick={() => setEditing(true)}>edit</Button>
        <Confirm label="remove" confirm="remove from catalog" onConfirm={async () => { const r = await w.write('delete', '/admin/v1/models/{model}', { params: { path: { model: m.id } } }); if (r) go('models'); }} />
      </p>
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
    </>
  );
}
