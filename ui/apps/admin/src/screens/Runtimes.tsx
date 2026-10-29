import { useEffect } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Button, Confirm, bytes, when } from '@hale/components';
import { useGet, type Runtime } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { AllowJson } from './Recipes';

/** The servers a model may run under, each pinned by its artifact's digest. */
export function Runtimes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/runtimes');
  const runtime = q.data?.data.find((r) => r.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <AllowJson what="runtime" path="/admin/v1/runtimes" back="runtimes" /> : runtime ? <RuntimeInspector runtime={runtime} /> : null);
  }, [creating, runtime, setInspector]);

  if (q.isPending) return <Loading what="runtimes" />;
  if (q.isError) return <Unavailable what="Runtimes" detail={q.error.message} />;
  if (selected && !creating && !runtime) return <Missing what={`runtime ${selected}`} />;

  return (
    <>
      <h1>Runtimes</h1>
      <Panel title="Runtimes" readout={readout(q, `${q.data.data.length} runtimes`)}>
        <Table<Runtime>
          rows={q.data.data}
          rowKey={(r) => r.id}
          selectedKey={selected}
          onSelect={(r) => go('runtimes', r.id)}
          columns={[
            { key: 'id', header: 'Runtime', render: (r) => <Mono>{r.id}</Mono> },
            { key: 'server', header: 'Server', render: (r) => r.server },
            { key: 'acc', header: 'Runs on', render: (r) => `${r.accelerator} · ${platforms(r)}` },
            { key: 'formats', header: 'Formats', render: (r) => r.formats.join(', ') },
            { key: 'artifact', header: 'Artifact', render: (r) => r.artifact.kind },
            { key: 'origin', header: 'Origin', render: (r) => r.origin },
          ]}
          empty="No runtimes. Voice ships some; an operator allows others."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('runtimes', 'new')} tone="primary">allow a runtime</Button>
        </p>
      </Panel>
    </>
  );
}

function platforms(r: Runtime): string {
  return r.platforms.map((p) => `${p.os}/${p.arch}`).join(', ');
}

function RuntimeInspector({ runtime: r }: { runtime: Runtime }) {
  const w = useWrite();
  const a = r.artifact;
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{r.id}</Mono>
      </h2>
      <Kv
        rows={[
          { k: 'server', v: r.server },
          { k: 'accelerator', v: r.accelerator },
          { k: 'platforms', v: platforms(r) },
          { k: 'formats', v: r.formats.join(', ') },
          { k: 'artifact', v: a.kind === 'container' ? 'a container image, run under docker' : 'an archive, run in a sandbox' },
          ...(a.kind === 'container'
            ? [{ k: 'image', v: <Mono>{`${a.image}@${a.digest}`}</Mono> }]
            : [
                { k: 'url', v: <Mono>{a.url}</Mono> },
                { k: 'sha256', v: <Mono>{a.sha256}</Mono> },
                { k: 'size', v: bytes(a.bytes) },
              ]),
          { k: 'license', v: r.license.url ? <a href={r.license.url} target="_blank" rel="noreferrer">{r.license.name}</a> : r.license.name },
          { k: 'origin', v: r.origin === 'shipped' ? 'shipped with voice' : 'allowed by the operator' },
          ...(r.created_at ? [{ k: 'allowed', v: when(r.created_at) }] : []),
        ]}
      />
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Confirm label="remove" confirm="remove: no placement may use it" onConfirm={async () => { const x = await w.write('delete', '/admin/v1/runtimes/{runtime}', { params: { path: { runtime: r.id } } }); if (x) go('runtimes'); }} />
      </p>
      {w.pending && <p className="c-wait">Proposed, pending review: {w.pending}</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
      <p className="faint" style={{ fontSize: 'var(--size-xs)', marginTop: 'var(--space-4)' }}>
        <a href={href('runtimes')}>all runtimes</a>
      </p>
    </>
  );
}
