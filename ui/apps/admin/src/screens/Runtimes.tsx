import { useEffect, useState } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Form, Field, TextInput, NumberInput, Select, Checkbox, Button, Confirm, bytes, when } from '@hale/components';
import { useGet, type Runtime, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';

/** The servers a model may run under, each pinned by its artifact's digest. */
export function Runtimes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/runtimes');
  const runtime = q.data?.data.find((r) => r.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <AllowRuntime /> : runtime ? <RuntimeInspector runtime={runtime} /> : null);
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

type Create = Schemas['RuntimeCreate'];
type Format = Create['formats'][number];
type Platform = Create['platforms'][number];

const FORMATS: Format[] = ['safetensors', 'gguf', 'mlx'];
const PLATFORMS: Platform[] = [
  { os: 'linux', arch: 'x86_64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'x86_64' },
];

/**
 * Allow a runtime: a server program, pinned by its artifact's digest, and
 * what it runs on and reads. Every check is the api's.
 */
function AllowRuntime() {
  const w = useWrite();
  const [id, setId] = useState('');
  const [license, setLicense] = useState('');
  const [licenseUrl, setLicenseUrl] = useState('');
  const [server, setServer] = useState<Create['server']>('vllm');
  const [formats, setFormats] = useState<Format[]>([]);
  const [accelerator, setAccelerator] = useState<Create['accelerator']>('cuda');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [kind, setKind] = useState<'container' | 'archive'>('container');
  const [image, setImage] = useState('');
  const [digest, setDigest] = useState('');
  const [url, setUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [size, setSize] = useState<number | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const toggle = <T,>(xs: T[], x: T, on: boolean) => (on ? [...xs, x] : xs.filter((y) => y !== x));
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>Allow a runtime</h2>
      <Form
        error={bad ?? w.error}
        onSubmit={async () => {
          if (!formats.length) { setBad('choose the formats it reads'); return; }
          if (!platforms.length) { setBad('choose the platforms it runs on'); return; }
          setBad(null);
          const body: Create = {
            id,
            license: { name: license, url: licenseUrl },
            server,
            formats,
            accelerator,
            platforms: PLATFORMS.filter((p) => platforms.includes(`${p.os}/${p.arch}`)),
            artifact: kind === 'container' ? { kind, image, digest } : { kind, url, sha256, bytes: size ?? 0 },
          };
          const r = await w.write('post', '/admin/v1/runtimes', { body });
          if (r && 'id' in r) go('runtimes', r.id);
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy}>allow</Button>
            <Button onClick={() => go('runtimes')}>cancel</Button>
          </>
        }
      >
        <Field label="id" required help="stable; never reused for another build">
          <TextInput mono value={id} onChange={setId} required pattern="[a-z0-9][a-z0-9.\-]{0,62}" placeholder="vllm-26.09" />
        </Field>
        <Field label="license" required>
          <TextInput value={license} onChange={setLicense} required placeholder="apache-2.0" />
        </Field>
        <Field label="license url" required>
          <TextInput type="url" value={licenseUrl} onChange={setLicenseUrl} required placeholder="https://…" />
        </Field>
        <Field label="server" required help="the program, which the node knows how to start and stop">
          <Select value={server} onChange={(v) => setServer(v as Create['server'])} options={[{ value: 'vllm' }, { value: 'llama-server' }]} required />
        </Field>
        <Field label="reads" required help="the weight formats it serves">
          {FORMATS.map((f) => (
            <Checkbox key={f} checked={formats.includes(f)} onChange={(on) => setFormats(toggle(formats, f, on))} label={f} />
          ))}
        </Field>
        <Field label="accelerator" required help="cpu runs on any machine">
          <Select value={accelerator} onChange={(v) => setAccelerator(v as Create['accelerator'])} options={[{ value: 'cuda' }, { value: 'metal' }, { value: 'cpu' }]} required />
        </Field>
        <Field label="runs on" required>
          {PLATFORMS.map((p) => {
            const k = `${p.os}/${p.arch}`;
            return <Checkbox key={k} checked={platforms.includes(k)} onChange={(on) => setPlatforms(toggle(platforms, k, on))} label={k} />;
          })}
        </Field>
        <Field label="artifact" required>
          <Select
            value={kind}
            onChange={(v) => setKind(v as 'container' | 'archive')}
            options={[
              { value: 'container', label: 'a container image, pulled by digest' },
              { value: 'archive', label: 'an archive, fetched and checked by sha256' },
            ]}
            required
          />
        </Field>
        {kind === 'container' ? (
          <>
            <Field label="image" required help="without a tag; for several platforms, the manifest list">
              <TextInput mono value={image} onChange={setImage} required pattern="[a-z0-9.\-]+(:[0-9]+)?/[a-z0-9._/\-]+" placeholder="nvcr.io/nvidia/vllm" />
            </Field>
            <Field label="digest" required>
              <TextInput mono value={digest} onChange={setDigest} required pattern="sha256:[0-9a-f]{64}" placeholder="sha256:…" />
            </Field>
          </>
        ) : (
          <>
            <Field label="url" required>
              <TextInput mono type="url" value={url} onChange={setUrl} required pattern="https://.*" placeholder="https://…" />
            </Field>
            <Field label="sha256" required>
              <TextInput mono value={sha256} onChange={setSha256} required pattern="[0-9a-f]{64}" />
            </Field>
            <Field label="bytes" required>
              <NumberInput value={size} onChange={setSize} min={1} step={1} required />
            </Field>
          </>
        )}
      </Form>
    </>
  );
}
