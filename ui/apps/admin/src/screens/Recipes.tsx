import { useEffect, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextArea, Button, Confirm, bytes, when } from '@hale/components';
import { useGet, type Recipe, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';

type Variant = Recipe['variants'][number];

/** The weights the operator allows: what a placement may install, and from where. */
export function Recipes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/recipes');
  const recipe = q.data?.data.find((r) => r.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <AllowJson what="recipe" path="/admin/v1/recipes" back="recipes" /> : recipe ? <RecipeInspector recipe={recipe} /> : null);
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
              { k: 'files', v: v.files.map((f) => <div key={f.path}><Mono>{f.path}</Mono> <span className="muted">{bytes(f.bytes)}</span></div>) },
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

/**
 * Allow a recipe or a runtime: its document, pasted whole, as the files
 * voice ships are (recipes/, runtimes/). Every check is the api's: the
 * weights pinned by commit and digest, the artifact by digest.
 */
export function AllowJson({ what, path, back }: { what: 'recipe' | 'runtime'; path: '/admin/v1/recipes' | '/admin/v1/runtimes'; back: string }) {
  const w = useWrite();
  const [text, setText] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>Allow a {what}</h2>
      <Form
        error={bad ?? w.error}
        onSubmit={async () => {
          let body: unknown;
          try { body = JSON.parse(text); } catch (e) { setBad(`not JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
          setBad(null);
          const r = path === '/admin/v1/recipes'
            ? await w.write('post', path, { body: body as Schemas['RecipeCreate'] })
            : await w.write('post', path, { body: body as Schemas['RuntimeCreate'] });
          if (r && 'id' in r) go(back, r.id);
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy || !text.trim()}>allow</Button>
            <Button onClick={() => go(back)}>cancel</Button>
          </>
        }
      >
        <Field label={`${what} (JSON)`} required help={`the ${what}'s document, as voice's own ${what}s/*.json are`}>
          <TextArea mono value={text} onChange={setText} required rows={18} placeholder='{"id": "...", "license": {...}, ...}' />
        </Field>
      </Form>
    </>
  );
}

