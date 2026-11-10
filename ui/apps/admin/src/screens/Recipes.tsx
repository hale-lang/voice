import { useEffect, useMemo, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, NumberInput, Select, TextArea, Button, Confirm, Checkbox, Status, bytes, when, type Column, type Tone } from '@hale/components';
import { useGet, useRecipeFits, type Recipe, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { tokens } from '../context';
import { acceleratorName } from '../fleet-memory';
import { usePlaceRecipe } from '../place';
import {
  CAPABILITIES, DEFAULT_VIEW, SORTS, STATUSES, STATUS_SAID, bestIn, choicesOf, downloadedOn, filterRows, headroomOf, queryOf, rowsOf, sortRows, statusOf, targetKey, targetSaid,
  targetsOf, toggled, viewOf, whyOf, type FitNode, type FitRow, type FitStatus, type FitView, type RecipeFits, type TargetFit,
} from './recipe-fit';
import s from './RecipeFit.module.css';

type Variant = Recipe['variants'][number];

/** The hash that opens `parts` with view `v` kept in its query. */
function viewHref(v: FitView, ...parts: string[]): string {
  const q = queryOf(v);
  return href(...parts) + (q ? `?${q}` : '');
}

/**
 * The weights the operator allows, and how each fits the fleet now, as
 * `llmfit` ranks models by the machine at hand: every variant judged on
 * every node and linked pair by the rules a placement is judged by
 * (`listRecipeFits`), read again as the fleet changes (a placement made or
 * removed, a node joining, leaving or reporting a download or new
 * hardware). Sorted and filtered here, the view kept in the URL's query;
 * a row opens its fit on each node, and places it on one.
 */
export function Recipes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const variant = route.parts[2];
  const view = viewOf(route.query);
  const q = useRecipeFits();
  const creating = selected === 'new';
  const placer = usePlaceRecipe();
  const rows = useMemo(() => (q.data ? rowsOf(q.data) : []), [q.data]);
  const row = rows.find((r) => r.recipe.id === selected && (!variant || r.variant.id === variant));
  const said = queryOf(view);

  useEffect(() => {
    setInspector(creating ? <AllowRecipe /> : selected ? <RecipeFitInspector id={selected} variant={variant} view={viewOf(new URLSearchParams(said))} /> : null);
  }, [creating, selected, variant, said, setInspector]);

  if (q.isPending) return <Loading what="recipes" />;
  if (q.isError) return <Unavailable what="Recipes" detail={q.error.message} />;
  if (selected && !creating && !rows.some((r) => r.recipe.id === selected)) return <Missing what={`recipe ${selected}`} />;

  const set = (next: Partial<FitView>) => { location.hash = viewHref({ ...view, ...next }, ...route.parts); };
  const shown = bestIn(sortRows(filterRows(rows, view), view), view.on);
  const recipes = new Set(rows.map((r) => r.recipe.id)).size;

  return (
    <>
      <h1>Recipes</h1>
      <Hardware fits={q.data} view={view} set={set} readout={readout(q, `${q.data.nodes.length} nodes`)} />
      <Panel title="Fit" readout={readout(q, `${shown.length} of ${rows.length} variants`, `${recipes} recipes`)}>
        <Filters fits={q.data} rows={rows} view={view} set={set} />
        <FitTable fits={q.data} rows={shown} view={view} selected={row?.key} placer={placer} />
        <p style={{ marginBottom: 0, display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={() => go('recipes', 'new')} tone="primary">allow a recipe</Button>
          <Spending placer={placer} />
        </p>
        {placer.w.pending && <p className="c-wait">Proposed, pending review: {placer.w.pending}</p>}
        {placer.w.error && <p className="c-fail">{placer.w.error}</p>}
      </Panel>
    </>
  );
}

type Placer = ReturnType<typeof usePlaceRecipe>;

/** The account a placement spends, when there is a choice; or that there is none. */
function Spending({ placer }: { placer: Placer }) {
  if (!placer.payer) return <span className="c-wait">No account to spend: add one on Accounts to place a model.</span>;
  if (placer.accounts.length < 2) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <span className="faint">placing spends</span>
      <Select value={placer.payer} onChange={placer.setAccount} options={placer.accounts.map((a) => ({ value: a.id }))} />
    </span>
  );
}

/** The memory a node's models are served from, as its chip says it. */
function memorySaid(n: FitNode): string {
  return n.gpu ? 'GPU' : n.accelerator ? 'unified' : 'memory';
}

/**
 * What the fit is judged against: each node's memory for models (a GPU's
 * own, or the machine's), what is free of it, its accelerator and its disk
 * free; each linked pair. Choosing one keeps the table to what fits there.
 */
function Hardware({ fits, view, set, readout: said }: { fits: RecipeFits; view: FitView; set: (v: Partial<FitView>) => void; readout: string }) {
  const pick = (key: string) => {
    const on = toggled(view.on, key);
    // a node chosen alone shows what fits there now, until the operator says otherwise
    set({ on, fit: on.length > view.on.length && view.fit.length === 0 ? ['fits'] : view.fit });
  };
  const node = (id: string) => fits.nodes.find((n) => n.node === id);
  return (
    <Panel title="Hardware" readout={said}>
      {fits.nodes.length === 0 ? (
        <p className="faint" style={{ margin: 0 }}>No node yet: a recipe fits once a node with a managed engine declares its hardware.</p>
      ) : (
        <div className={s.hardware}>
          {fits.nodes.map((n) => {
            const used = n.model_memory_bytes > 0 ? Math.min(1, Math.max(0, n.held_bytes / n.model_memory_bytes)) : 0;
            return (
              <button key={n.node} type="button" className={s.target} aria-pressed={view.on.includes(n.node)} disabled={!!n.problem} title={n.problem ?? `only what ${n.node} can take`} onClick={() => pick(n.node)}>
                <span className={s.targetName}>{n.node}</span>
                {n.problem ? (
                  <span className="faint">{n.problem}</span>
                ) : (
                  <>
                    <span className="muted">{n.accelerator ? acceleratorName(n.accelerator) : 'processors only'}</span>
                    <span>
                      {bytes(Math.max(0, n.free_bytes))} free <span className="faint">of {bytes(n.model_memory_bytes)} {memorySaid(n)}</span>
                    </span>
                    <span className={s.meter} aria-hidden="true"><span className={s.meterHeld} style={{ display: 'block', width: `${used * 100}%` }} /></span>
                    <span className="faint">{bytes(n.disk_free_bytes)} disk free</span>
                  </>
                )}
              </button>
            );
          })}
          {fits.pairs.map((p) => {
            const key = targetKey(p.nodes);
            const free = Math.min(...p.nodes.map((id) => node(id)?.free_bytes ?? 0));
            return (
              <button key={key} type="button" className={s.target} aria-pressed={view.on.includes(key)} disabled={!!p.problem} title={p.problem ?? `only what ${targetSaid(key)} can take together`} onClick={() => pick(key)}>
                <span className={s.targetName}>{targetSaid(key)}</span>
                {p.problem ? <span className="faint">{p.problem}</span> : (
                  <>
                    <span className="muted">linked, a model split across the two</span>
                    <span>{bytes(Math.max(0, free))} free <span className="faint">on each, at the least</span></span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** A row of toggles, each choice on or off. */
function Chips<T extends string>({ label, values, chosen, said, onChange }: { label: string; values: T[]; chosen: T[]; said?: (v: T) => string; onChange: (v: T[]) => void }) {
  if (values.length === 0) return null;
  return (
    <span className={s.filter} role="group" aria-label={label}>
      <span className={s.filterLabel}>{label}</span>
      {values.map((v) => (
        <button key={v} type="button" className={s.chip} aria-pressed={chosen.includes(v)} onClick={() => onChange(toggled(chosen, v))}>{said ? said(v) : v}</button>
      ))}
    </span>
  );
}

/** The view's filters and its order. */
function Filters({ fits, rows, view, set }: { fits: RecipeFits; rows: FitRow[]; view: FitView; set: (v: Partial<FitView>) => void }) {
  const { formats, runtimes } = choicesOf(rows);
  const targets = targetsOf(fits);
  const plain = queryOf(view) === '';
  return (
    <div className={s.filters}>
      <span className={`${s.filter} ${s.search}`}>
        <TextInput value={view.q} onChange={(q) => set({ q })} placeholder="search recipes, variants, quantizations" />
      </span>
      <Chips label="on" values={targets} chosen={view.on.filter((k) => targets.includes(k))} said={targetSaid} onChange={(on) => set({ on })} />
      <Chips label="fit" values={STATUSES} chosen={view.fit} said={(v) => STATUS_SAID[v]} onChange={(fit) => set({ fit })} />
      <Chips label="format" values={formats} chosen={view.format} onChange={(format) => set({ format })} />
      <Chips label="runtime" values={runtimes} chosen={view.runtime} onChange={(runtime) => set({ runtime })} />
      <Chips label="carries" values={CAPABILITIES} chosen={view.cap} onChange={(cap) => set({ cap })} />
      <span className={s.filter}>
        <Checkbox checked={view.downloaded} onChange={(downloaded) => set({ downloaded })} label="downloaded" />
      </span>
      <span className={s.filter}>
        <span className={s.filterLabel}>sort</span>
        <Select value={view.sort} onChange={(v) => set({ sort: v as FitView['sort'] })} options={SORTS} />
        <button type="button" className={s.chip} aria-pressed={view.desc} onClick={() => set({ desc: !view.desc })} title="turn the order over">{view.desc ? 'desc' : 'asc'}</button>
      </span>
      {!plain && <button type="button" className={s.chip} onClick={() => set(DEFAULT_VIEW)}>clear</button>}
    </div>
  );
}

const TONE: Record<FitStatus, Tone> = { fits: 'ok', placed: 'active', freed: 'wait', never: 'quiet' };
const SHORT: Record<FitStatus, string> = { fits: 'fits', placed: 'placed', freed: 'if freed', never: 'never' };

/** A cell's state, with why on hover. */
function FitCell({ cell }: { cell: TargetFit | undefined }) {
  if (!cell) return <span className="faint">–</span>;
  const st = statusOf(cell);
  return <Status tone={TONE[st]} label={SHORT[st]} title={whyOf(cell)} />;
}

/** What a variant's seat carries, under the runtime it fits best with (or any it has). */
function Caps({ row }: { row: FitRow }) {
  const cell = row.best?.cell ?? [...row.cells.values()].find((c) => c.runtime);
  const caps = [
    ...(cell?.tools ? ['tools'] : []),
    ...(cell?.reasoning ? ['reasoning'] : []),
    ...(row.recipe.contract === 'decision' ? ['decision'] : []),
  ];
  return caps.length ? <span className={s.caps}>{caps.join(' · ')}</span> : <span className="faint">–</span>;
}

/** Every variant shown, a recipe's together, its fit on each node and pair. */
function FitTable({ fits, rows, view, selected, placer }: { fits: RecipeFits; rows: FitRow[]; view: FitView; selected?: string; placer: Placer }) {
  const targets = targetsOf(fits);
  const first = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) if (!seen.has(r.recipe.id)) { seen.add(r.recipe.id); first.add(r.key); }
  const columns: Column<FitRow>[] = [
    { key: 'model', header: 'Model', render: (r) => (first.has(r.key) ? <span className={s.group}>{r.recipe.id}</span> : null) },
    { key: 'variant', header: 'Variant', render: (r) => <Mono>{r.variant.id}</Mono> },
    { key: 'format', header: 'Format', render: (r) => `${r.variant.format} · ${r.variant.quantization}` },
    { key: 'memory', header: 'Needs', num: true, render: (r) => bytes(r.variant.memory_bytes) },
    { key: 'size', header: 'Size', num: true, render: (r) => bytes(r.variant.total_bytes) },
    { key: 'context', header: 'Context', num: true, render: (r) => (r.recipe.context_length ? tokens(r.recipe.context_length) : <span className="faint">–</span>) },
    { key: 'caps', header: 'Carries', render: (r) => <Caps row={r} /> },
    {
      key: 'best',
      header: 'Best fit',
      render: (r) => (r.best ? (
        <span title={whyOf(r.best.cell)} className={r.best.status === 'fits' ? undefined : 'muted'}>
          {targetSaid(r.best.key)} <span className="faint">· {r.best.cell.runtime}{r.best.status === 'freed' ? ', once freed' : r.best.status === 'placed' ? ', placed' : ''}</span>
        </span>
      ) : <span className="faint">fits nowhere</span>),
    },
    { key: 'headroom', header: 'Headroom', num: true, render: (r) => { const h = r.best?.status === 'fits' ? headroomOf(r.best.cell) : null; return h == null ? <span className="faint">–</span> : bytes(h); } },
    ...targets.map((t): Column<FitRow> => ({ key: `on:${t}`, header: <span className={view.on.includes(t) ? s.inScope : undefined}>{targetSaid(t)}</span>, render: (r) => <FitCell cell={r.cells.get(t)} /> })),
    { key: 'downloaded', header: 'Downloaded', render: (r) => { const on = downloadedOn(r); return on.length ? on.join(', ') : <span className="faint">–</span>; } },
    {
      key: 'place',
      header: '',
      render: (r) => (r.best?.status === 'fits' ? (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button disabled={placer.w.busy || !placer.payer} onClick={() => void placer.place(r.recipe.id, r.best!.cell.nodes, r.variant.id)}>place on {targetSaid(r.best.key)}</Button>
        </span>
      ) : null),
    },
  ];
  return (
    <Table<FitRow>
      rows={rows}
      rowKey={(r) => r.key}
      selectedKey={selected}
      onSelect={(r) => { location.hash = viewHref(view, 'recipes', r.recipe.id, r.variant.id); }}
      columns={columns}
      empty={rows.length === 0 ? 'Nothing matches this view.' : undefined}
    />
  );
}

/**
 * One variant's fit on every node and pair, each with what it would take
 * and what it leaves, and a button to place it there; then the recipe
 * whole. With no variant named, the recipe's first.
 */
function RecipeFitInspector({ id, variant, view }: { id: string; variant?: string; view: FitView }) {
  const fits = useRecipeFits().data;
  const placer = usePlaceRecipe();
  const rows = fits ? rowsOf(fits).filter((r) => r.recipe.id === id) : [];
  const row = rows.find((r) => r.variant.id === variant) ?? rows[0];
  return (
    <>
      {row && (
        <>
          <h2 style={{ marginBottom: 'var(--space-3)' }}>
            <Mono>{row.recipe.id}</Mono> <span className="muted"><Mono>{row.variant.id}</Mono></span>
          </h2>
          {rows.length > 1 && (
            <p className="faint" style={{ fontSize: 'var(--size-sm)' }}>
              {rows.map((r) => (r === row ? <b key={r.key} style={{ marginRight: 'var(--space-2)' }}>{r.variant.id}</b> : <a key={r.key} href={viewHref(view, 'recipes', id, r.variant.id)} style={{ marginRight: 'var(--space-2)' }}>{r.variant.id}</a>))}
            </p>
          )}
          <Kv
            rows={[...row.cells.entries()].map(([key, c]) => ({
              k: targetSaid(key),
              v: <TargetDetail cell={c} onPlace={statusOf(c) === 'fits' ? () => void placer.place(row.recipe.id, c.nodes, row.variant.id) : undefined} disabled={placer.w.busy || !placer.payer} />,
            }))}
          />
          {row.cells.size === 0 && <p className="faint">No node can take a model yet.</p>}
          <p><Spending placer={placer} /></p>
          {placer.w.pending && <p className="c-wait">Proposed, pending review: {placer.w.pending}</p>}
          {placer.w.error && <p className="c-fail">{placer.w.error}</p>}
        </>
      )}
      <RecipeWhole id={id} />
    </>
  );
}

/** A variant on one node or pair: its state, its runtime, what it takes of the room there and of the disk. */
function TargetDetail({ cell: c, onPlace, disabled }: { cell: TargetFit; onPlace?: () => void; disabled: boolean }) {
  const st = statusOf(c);
  const h = headroomOf(c);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Status tone={TONE[st]} label={STATUS_SAID[st]} />
        {c.runtime && <span className="muted">under <a href={href('runtimes', c.runtime)}><Mono>{c.runtime}</Mono></a></span>}
        {c.placed && <a href={href('placements', c.placed)}>as {c.placed}</a>}
        {c.downloaded && <Status tone="ok" label="downloaded" title="its files are on disk already: placing it loads them, with nothing to download" />}
        {onPlace && <Button onClick={onPlace} disabled={disabled}>place here</Button>}
      </span>
      {c.runtime && (
        <span className="faint" style={{ fontSize: 'var(--size-xs)' }}>
          needs {bytes(c.need_bytes)} of {bytes(Math.max(0, c.room_bytes))} free {c.gpu ? 'on its GPU' : 'for models'}
          {c.held_bytes != null ? `; holds ${bytes(c.held_bytes)} with its cache, ${bytes(h ?? 0)} left` : ''}
          {c.room_empty_bytes !== c.room_bytes ? `; ${bytes(c.room_empty_bytes)} with nothing placed` : ''}
          ; {bytes(c.disk_bytes)} of {bytes(c.disk_free_bytes)} disk
        </span>
      )}
      <span className="faint" style={{ fontSize: 'var(--size-xs)' }}>{whyOf(c)}</span>
    </div>
  );
}

/** A variant's files: the first few, the rest behind a disclosure (a frontier model has hundreds of shards). */
function Files({ files }: { files: Variant['files'] }) {
  const row = (f: Variant['files'][number]) => <div key={f.path}><Mono>{f.path}</Mono> <span className="muted">{bytes(f.bytes)}</span></div>;
  if (files.length <= 8) return <>{files.map(row)}</>;
  return (
    <>
      {files.slice(0, 8).map(row)}
      <details>
        <summary className="muted">{files.length - 8} more</summary>
        {files.slice(8).map(row)}
      </details>
    </>
  );
}

/** A variant's download: its files together, and its file sets' (a manifest and what it lists). */
function size(v: Variant): number {
  const sets = (v.file_sets ?? []).reduce(
    (n, s) => n + (s.manifest ? s.manifest.bytes + (s.bytes ?? 0) : (s.files ?? []).reduce((m, f) => m + f.bytes, 0)),
    0,
  );
  return v.files.reduce((n, f) => n + f.bytes, 0) + sets;
}

/** A recipe whole (`getRecipe`): every variant's files among it. */
function RecipeWhole({ id }: { id: string }) {
  const q = useGet('/admin/v1/recipes/{recipe}', { params: { path: { recipe: id } } });
  if (q.isPending) return <Loading what={`recipe ${id}`} />;
  if (q.isError) return <Unavailable what={`Recipe ${id}`} detail={q.error.message} />;
  return <RecipeInspector recipe={q.data} />;
}

function RecipeInspector({ recipe: r }: { recipe: Recipe }) {
  const w = useWrite();
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{r.id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'origin', v: r.origin === 'shipped' ? 'shipped with voice' : 'allowed by the operator' },
          { k: 'context', v: r.context_length ? `${r.context_length.toLocaleString()} tokens, made for` : '–' },
          { k: 'license', v: r.license.url ? <a href={r.license.url} target="_blank" rel="noreferrer">{r.license.name}</a> : r.license.name },
          ...(r.created_at ? [{ k: 'allowed', v: when(r.created_at) }] : []),
        ]}
      />
      {r.variants.map((v) => (
        <div key={v.id}>
          <h3 style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
            <Mono>{v.id}</Mono>
          </h3>
          <Kv
            rows={[
              { k: 'format', v: `${v.format}${v.quantization ? ` · ${v.quantization}` : ''}` },
              { k: 'needs', v: `${bytes(v.memory_bytes)} of memory` },
              { k: 'download', v: `${bytes(size(v))} in ${v.files.length} file${v.files.length === 1 ? '' : 's'}` },
              { k: 'source', v: <Mono>{`${v.source.repo}@${v.source.revision.slice(0, 12)}`}</Mono> },
              { k: 'files', v: <Files files={v.files} /> },
              ...(v.file_sets ?? []).map((s) => ({
                k: `set ${s.name}`,
                v: s.manifest
                  ? <>
                      <Mono>{`${s.source.repo}@${s.source.revision.slice(0, 12)}`}</Mono>: the files <Mono>{s.manifest.path}</Mono> lists, {bytes(s.bytes ?? 0)}
                    </>
                  : <>
                      <Mono>{`${s.source.repo}@${s.source.revision.slice(0, 12)}`}</Mono>
                      <Files files={s.files ?? []} />
                    </>,
              })),
              ...(v.prepare
                ? [{ k: 'readied', v: `${v.prepare}, once on each node: ${(v.prepared ?? []).map((f) => f.path).join(', ')}` }]
                : []),
            ]}
          />
        </div>
      ))}
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Confirm label="remove" confirm="remove: no model may name it" onConfirm={async () => { const x = await w.write('delete', '/admin/v1/recipes/{recipe}', { params: { path: { recipe: r.id } } }); if (x) go('recipes'); }} />
      </p>
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
      <p className="faint" style={{ fontSize: 'var(--size-xs)', marginTop: 'var(--space-4)' }}>
        <a href={href('recipes')}>all recipes</a>
      </p>
    </>
  );
}

type VariantDraft = { id: string; format: Variant['format']; quantization: string; repo: string; revision: string; files: string; memory_gib: number | null };

const blankVariant = (): VariantDraft => ({ id: '', format: 'safetensors', quantization: '', repo: '', revision: '', files: '', memory_gib: null });

/**
 * A variant's files as typed, one a line: `sha256 bytes path`, the form
 * `sha256sum` and `ls -l` give. A line that is not one is told by its number.
 */
function parseFiles(text: string): { files: Variant['files'] } | { bad: string } {
  const files: Variant['files'] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;
    const m = /^([0-9a-f]{64})\s+(\d+)\s+(\S+)$/.exec(line);
    if (!m || !m[1] || !m[2] || !m[3]) return { bad: `line ${i + 1} is not "sha256 bytes path": ${line.slice(0, 60)}` };
    files.push({ sha256: m[1], bytes: Number(m[2]), path: m[3] });
  }
  return { files };
}

/**
 * Allow a recipe: the weights, pinned. Each variant names its source by
 * commit and lists every file it needs by digest; every check is the api's.
 */
function AllowRecipe() {
  const w = useWrite();
  const [id, setId] = useState('');
  const [license, setLicense] = useState('');
  const [licenseUrl, setLicenseUrl] = useState('');
  const [context, setContext] = useState<number | null>(null);
  const [kv, setKv] = useState<number | null>(null);
  const [variants, setVariants] = useState<VariantDraft[]>([blankVariant()]);
  const [bad, setBad] = useState<string | null>(null);
  const put = (i: number, d: Partial<VariantDraft>) => setVariants(variants.map((v, j) => (j === i ? { ...v, ...d } : v)));
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>Allow a recipe</h2>
      <Form
        error={bad ?? w.error}
        onSubmit={async () => {
          const vs: Variant[] = [];
          for (const v of variants) {
            const f = parseFiles(v.files);
            if ('bad' in f) { setBad(`variant ${v.id || vs.length + 1}: ${f.bad}`); return; }
            vs.push({
              id: v.id,
              format: v.format,
              quantization: v.quantization,
              source: { hub: 'huggingface', repo: v.repo, revision: v.revision },
              files: f.files,
              memory_bytes: Math.round((v.memory_gib ?? 0) * 2 ** 30),
            });
          }
          setBad(null);
          const body: Schemas['RecipeCreate'] = {
            id,
            license: { name: license, url: licenseUrl },
            variants: vs,
            ...(context ? { context_length: context } : {}),
            ...(kv ? { kv_bytes_per_token: kv } : {}),
          };
          const r = await w.write('post', '/admin/v1/recipes', { body });
          if (r && 'id' in r) go('recipes', r.id);
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy}>allow</Button>
            <Button onClick={() => go('recipes')}>cancel</Button>
          </>
        }
      >
        <Field label="id" required help="stable; never reused for other weights">
          <TextInput mono value={id} onChange={setId} required pattern="[a-z0-9][a-z0-9.\-]{0,62}" placeholder="qwen3-8b" />
        </Field>
        <Field label="license" required>
          <TextInput value={license} onChange={setLicense} required placeholder="apache-2.0" />
        </Field>
        <Field label="license url" required>
          <TextInput type="url" value={licenseUrl} onChange={setLicenseUrl} required placeholder="https://…" />
        </Field>
        <Field label="context length" help="the longest context it is made for, in tokens (its config's max_position_embeddings)">
          <NumberInput value={context} onChange={setContext} min={1} step={1} />
        </Field>
        <Field label="KV bytes per token" help="what one more token of context costs in KV cache at 16 bits; sizes a seat's prompt cache">
          <NumberInput value={kv} onChange={setKv} min={1} step={1} />
        </Field>
        {variants.map((v, i) => (
          <fieldset key={i}>
            <legend>
              variant {i + 1}
              {variants.length > 1 && (
                <>
                  {' '}
                  <Button onClick={() => setVariants(variants.filter((_, j) => j !== i))}>drop</Button>
                </>
              )}
            </legend>
            <Field label="id" required help="distinct within the recipe">
              <TextInput mono value={v.id} onChange={(x) => put(i, { id: x })} required pattern="[a-z0-9][a-z0-9_.\-]{0,62}" placeholder="gguf-q4_k_m" />
            </Field>
            <Field label="format" required>
              <Select value={v.format} onChange={(x) => put(i, { format: x as Variant['format'] })} options={[{ value: 'safetensors' }, { value: 'gguf' }, { value: 'mlx' }]} required />
            </Field>
            <Field label="quantization" required>
              <TextInput mono value={v.quantization} onChange={(x) => put(i, { quantization: x })} required placeholder="bf16, q4_k_m, 4bit" />
            </Field>
            <Field label="Hugging Face repo" required>
              <TextInput mono value={v.repo} onChange={(x) => put(i, { repo: x })} required pattern="[A-Za-z0-9][A-Za-z0-9._\-]*/[A-Za-z0-9][A-Za-z0-9._\-]*" placeholder="Qwen/Qwen3-8B" />
            </Field>
            <Field label="revision" required help="a commit, never a branch or a tag">
              <TextInput mono value={v.revision} onChange={(x) => put(i, { revision: x })} required pattern="[0-9a-f]{40}" placeholder="40 hex digits" />
            </Field>
            <Field label="memory" required help="what serving it needs, weights and the engine's own, before any context; GiB">
              <NumberInput value={v.memory_gib} onChange={(x) => put(i, { memory_gib: x })} min={0.01} step={0.01} required />
            </Field>
            <Field label="files" required help="every file it needs, one a line: sha256 bytes path (up to 300)">
              <TextArea mono value={v.files} onChange={(x) => put(i, { files: x })} required rows={8} placeholder={'9f86d0…0a08  4022 config.json\n2c26b4…7ae2  5368709120 model-00001-of-00002.safetensors'} />
            </Field>
            {v.files.trim() && <FilesTally text={v.files} />}
          </fieldset>
        ))}
        {variants.length < 8 && (
          <p>
            <Button onClick={() => setVariants([...variants, blankVariant()])}>add a variant</Button>
          </p>
        )}
      </Form>
    </>
  );
}

/** What the files typed come to, or the first line that is not one. */
function FilesTally({ text }: { text: string }) {
  const f = parseFiles(text);
  if ('bad' in f) return <p className="c-fail" style={{ fontSize: 'var(--size-sm)' }}>{f.bad}</p>;
  const total = f.files.reduce((n, x) => n + x.bytes, 0);
  return <p className="faint" style={{ fontSize: 'var(--size-sm)' }}>{f.files.length} file{f.files.length === 1 ? '' : 's'}, {bytes(total)}</p>;
}
