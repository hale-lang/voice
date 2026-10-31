import { useEffect, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, NumberInput, Select, TextArea, Button, Confirm, bytes, when } from '@hale/components';
import { useGet, type Recipe, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { tokens } from '../context';

type Variant = Recipe['variants'][number];

/** The weights the operator allows: what a placement may install, and from where. */
export function Recipes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/recipes');
  const recipe = q.data?.data.find((r) => r.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <AllowRecipe /> : recipe ? <RecipeInspector recipe={recipe} /> : null);
  }, [creating, recipe, setInspector]);

  if (q.isPending) return <Loading what="recipes" />;
  if (q.isError) return <Unavailable what="Recipes" detail={q.error.message} />;
  if (selected && !creating && !recipe) return <Missing what={`recipe ${selected}`} />;

  return (
    <>
      <h1>Recipes</h1>
      <Panel title="Recipes" readout={readout(q, `${q.data.data.length} recipes`)}>
        <Table<Recipe>
          rows={q.data.data}
          rowKey={(r) => r.id}
          selectedKey={selected}
          onSelect={(r) => go('recipes', r.id)}
          columns={[
            { key: 'id', header: 'Recipe', render: (r) => <Mono>{r.id}</Mono> },
            { key: 'origin', header: 'Origin', render: (r) => r.origin },
            { key: 'license', header: 'License', render: (r) => r.license.name },
            { key: 'ctx', header: 'Context', num: true, render: (r) => (r.context_length ? tokens(r.context_length) : <span className="faint">–</span>) },
            { key: 'variants', header: 'Variants', render: (r) => r.variants.map((v) => `${v.id} (${v.format})`).join(', ') },
            { key: 'size', header: 'Smallest', num: true, render: (r) => bytes(Math.min(...r.variants.map(size))) },
          ]}
          empty="No recipes. Voice ships some; an operator allows others."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('recipes', 'new')} tone="primary">allow a recipe</Button>
        </p>
      </Panel>
    </>
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

/** A variant's download: its files together. */
function size(v: Variant): number {
  return v.files.reduce((n, f) => n + f.bytes, 0);
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
