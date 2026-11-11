import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel, Table, Status, Loading, Unavailable, Missing, Kv, Mono, Button, Confirm, when } from '@hale/components';
import { api, useGet, type Schemas } from '../api/client';
import { operatorToken } from '../api/token';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import { attemptEnded, attemptTone, parseTranscript, shortSha, wall, type AttemptEvent } from './attempt-view';

type Attempt = Schemas['CodingAttempt'];

/**
 * Coding attempts: an agentic coding harness run once on a repository
 * (`createAttempt`), every project's, newest first; one opens with its
 * live transcript, its commits, its usage, its bundle and a cancel.
 */
export function Attempts({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/attempts');
  const attempt = q.data?.data.find((a) => a.id === selected);

  useEffect(() => {
    setInspector(attempt ? <AttemptInspector key={attempt.id} id={attempt.id} /> : null);
  }, [attempt?.id, setInspector]);

  if (q.isPending) return <Loading what="attempts" />;
  if (q.isError) return <Unavailable what="Attempts" detail={q.error.message} />;
  if (selected && !attempt) return <Missing what={`attempt ${selected}`} />;

  const running = q.data.data.filter((a) => !attemptEnded(a.state)).length;
  return (
    <>
      <h1>Attempts</h1>
      <Panel title="Coding attempts" readout={readout(q, `${q.data.data.length} attempts · ${running} queued or running`)}>
        <Table<Attempt>
          rows={q.data.data}
          rowKey={(a) => a.id}
          selectedKey={selected}
          onSelect={(a) => go('attempts', a.id)}
          columns={[
            { key: 'state', header: 'State', render: (a) => <Status tone={attemptTone(a.state)} label={a.phase ? `${a.state} · ${a.phase}` : a.state} /> },
            { key: 'id', header: 'Attempt', render: (a) => <Mono>{a.id}</Mono> },
            { key: 'project', header: 'Project', render: (a) => <Mono>{a.project}</Mono> },
            { key: 'harness', header: 'Harness', render: (a) => a.harness ?? <span className="faint">any</span> },
            { key: 'repo', header: 'Repository', render: (a) => <><Mono>{a.repo}</Mono> <span className="muted">@ {a.base}</span></> },
            { key: 'when', header: 'Created', render: (a) => when(a.created_at) },
            { key: 'wall', header: 'Ran', render: (a) => (a.wall_ms ? wall(a.wall_ms) : <span className="faint">–</span>) },
          ]}
          empty="No attempts. A caller asks for one with POST /v1/attempts; it runs on a harness seat."
        />
      </Panel>
    </>
  );
}

/** One attempt, followed while it runs: its state every two seconds, its transcript as it grows. */
function AttemptInspector({ id }: { id: string }) {
  const w = useWrite();
  const [fetched, setFetched] = useState<string | null>(null);
  const one = useQuery({
    queryKey: ['attempt', id],
    refetchInterval: (q) => (q.state.data && attemptEnded(q.state.data.state) ? false : 2000),
    queryFn: async () => {
      const r = await api.GET('/admin/v1/attempts/{attempt}', { params: { path: { attempt: id } } });
      if (r.error || !r.data) throw new Error(`attempt ${id}: ${r.response.status}`);
      return r.data;
    },
  });
  const a = one.data;
  const ended = a ? attemptEnded(a.state) : false;
  const transcript = useQuery({
    queryKey: ['attempt-transcript', id, ended],
    refetchInterval: ended ? false : 2000,
    queryFn: async () => {
      const r = await api.GET('/admin/v1/attempts/{attempt}/transcript', { params: { path: { attempt: id } }, parseAs: 'text' });
      if (r.error !== undefined) throw new Error(`transcript: ${r.response.status}`);
      return parseTranscript(String(r.data ?? ''));
    },
  });
  if (one.isPending) return <Loading what={`attempt ${id}`} />;
  if (one.isError || !a) return <Unavailable what={`Attempt ${id}`} detail={one.error?.message ?? ''} />;

  async function download() {
    // the bundle is binary, and the api lets it go once it is fetched
    const r = await fetch(`/admin/v1/attempts/${encodeURIComponent(id)}/bundle`, { headers: { Authorization: `Bearer ${operatorToken() ?? ''}` } });
    if (!r.ok) {
      setFetched(`the bundle could not be fetched (${r.status})`);
      return;
    }
    const url = URL.createObjectURL(await r.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${id}.bundle`;
    link.click();
    URL.revokeObjectURL(url);
    setFetched('fetched: voice no longer holds it');
    void one.refetch();
  }

  const usage = a.usage.reported ? `${a.usage.input_tokens ?? 0} in · ${a.usage.output_tokens ?? 0} out` : 'not reported by the harness';
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>
        <Mono>{a.id}</Mono> <Status tone={attemptTone(a.state)} label={a.phase ? `${a.state} · ${a.phase}` : a.state} />
      </h2>
      {w.error && <p className="c-fail">{w.error}</p>}
      <Kv
        rows={[
          { k: 'project', v: <Mono>{a.project}</Mono> },
          { k: 'harness', v: a.harness ?? <span className="faint">any</span> },
          { k: 'served', v: a.served ? <Mono>{`${a.served.node}/${a.served.seat} · ${a.served.account}`}</Mono> : <span className="faint">not started</span> },
          { k: 'repository', v: <><Mono>{a.repo}</Mono> @ <Mono>{a.base}</Mono></> },
          { k: 'as', v: `${a.as.name} <${a.as.email}>` },
          { k: 'branch', v: <Mono>{a.branch}</Mono> },
          { k: 'commits', v: a.head_sha ? <Mono>{`${shortSha(a.base_sha)}..${shortSha(a.head_sha)}`}</Mono> : <span className="faint">none yet</span> },
          { k: 'summary', v: a.summary ?? <span className="faint">–</span> },
          ...(a.failure ? [{ k: 'failure', v: <span className="c-fail">{a.failure}</span> }] : []),
          { k: 'usage', v: <>{usage} · <a href={href('usage', 'c', a.id)}>in Usage</a></> },
          { k: 'wall time', v: a.wall_ms ? wall(a.wall_ms) : '–' },
          { k: 'created', v: when(a.created_at) },
          { k: 'deadline', v: when(a.deadline) },
          { k: 'transcript', v: a.transcript_digest ? <Mono>{a.transcript_digest}</Mono> : `${a.transcript.events} events, sealed when it ends` },
          { k: 'bundle', v: a.bundle ? `${a.bundle.bytes} bytes, held until fetched or a day passes` : <span className="faint">{fetched ?? 'none held'}</span> },
        ]}
      />
      <p>
        {a.bundle && <Button onClick={download}>download the bundle</Button>}{' '}
        {!ended && (
          <Confirm
            label={a.cancel_requested ? 'cancelling…' : 'cancel'}
            confirm="cancel this attempt"
            disabled={a.cancel_requested}
            onConfirm={async () => {
              await w.write('post', '/admin/v1/attempts/{attempt}/cancel', { params: { path: { attempt: id } } });
              void one.refetch();
            }}
          />
        )}
      </p>
      <h3>Transcript</h3>
      {transcript.isPending ? <Loading what="the transcript" /> : <Transcript events={transcript.data ?? []} />}
    </>
  );
}

const KIND_CLASS: Record<AttemptEvent['kind'], string> = { text: '', tool: 'mono muted', note: 'faint', error: 'c-fail' };

function Transcript({ events }: { events: AttemptEvent[] }) {
  if (events.length === 0) return <p className="faint">Nothing yet.</p>;
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
      {events.map((e) => (
        <li key={e.seq} className={KIND_CLASS[e.kind]} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {e.kind === 'tool' ? '▸ ' : e.kind === 'note' ? '· ' : ''}
          {e.text}
        </li>
      ))}
    </ol>
  );
}
