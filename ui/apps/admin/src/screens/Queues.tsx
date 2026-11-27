import { Panel, Table, Status, Loading, Unavailable, Empty, Mono, when, type Tone } from '@hale/components';
import { useGet, useNodes } from '../api/client';
import type { ScreenProps } from '../App';
import { readout } from '../readout';
import { href } from '../nav';
import { modelQueues, seatPlans, shortSubject, age, planTime, STALE_MS, type AgeTone } from './queues-view';

const TONE: Record<AgeTone, Tone> = { idle: 'quiet', ok: 'active', wait: 'wait', fail: 'fail' };

/**
 * Queue routing's board, as the brain last wrote it (`getQueues`): per model
 * its partitions, each with its tickets waiting and its oldest's age, and
 * the seats consuming it; per seat its plan beside how its node says it
 * pulls. Requests whose seats all pull are queued here; any other is offered
 * through the route table (Routes) until the push path goes.
 */
export function Queues(_: ScreenProps) {
  const q = useGet('/admin/v1/queues');
  const nodes = useNodes();
  if (q.isPending) return <Loading what="the board" />;
  if (q.isError) return <Unavailable what="The board" detail={q.error.message} />;
  const b = q.data;
  const models = modelQueues(b);
  const seats = seatPlans(b, nodes.data?.data ?? []);
  const stale = b.age_ms > STALE_MS;
  return (
    <>
      <h1>Queues</h1>
      <p className="muted">
        Board written {when(b.at)}, {age(b.age_ms)} ago{stale ? ': the brain has not written one since, so the api reads past it and seats pull on their last plan' : ''}. Each queue as its consumer was read a tick before; a seat's own queue takes a conversation's turns before its partitions.
      </p>
      {stale && <p><Status tone="wait" label="stale" title="the brain is down, or a standby has not taken over yet" /> <span className="muted">No brain has written the board for {age(b.age_ms)}.</span></p>}
      {models.length === 0 && <Empty>No model is served by a seat that pulls.</Empty>}
      {models.map((m) => (
        <Panel key={m.model} title={<Mono>{m.model}</Mono>} readout={readout(q, `${m.depth} waiting`, m.oldestMs != null ? `oldest ${age(m.oldestMs)}` : 'none waiting', m.shape)}>
          <Table
            rows={m.partitions}
            rowKey={(p) => p.subject}
            columns={[
              { key: 'queue', header: 'Partition', render: (p) => <Mono>{shortSubject(p.subject)}</Mono> },
              { key: 'account', header: 'Account', render: (p) => (p.provider_account ? <Mono>{p.provider_account}</Mono> : <span className="faint">its one</span>) },
              { key: 'depth', header: 'Waiting', num: true, render: (p) => <Status tone={TONE[p.tone]} label={String(p.depth)} /> },
              { key: 'oldest', header: 'Oldest', num: true, render: (p) => (p.depth > 0 ? age(p.oldest_age_ms) : <span className="faint">—</span>) },
              { key: 'pulls', header: 'Standing pulls', num: true, render: (p) => p.waiting_pulls },
              { key: 'acks', header: 'Claiming', num: true, render: (p) => p.ack_pending },
              { key: 'service', header: 'Service', num: true, render: (p) => age(p.service_ms) },
              { key: 'seats', header: 'Consumed by', render: (p) => (p.seats.length ? p.seats.map((s, i) => <span key={s}>{i ? ', ' : ''}<a href={href('nodes', ...s.split('/'))}><Mono>{s}</Mono></a></span>) : <Status tone="fail" label="no seat" title="every seat that serves it is held, or none consumes it yet" />) },
            ]}
            empty="No partition: no seat that pulls serves this model."
          />
        </Panel>
      ))}
      <Panel title="Seats" readout={readout(q, `${seats.length} seats`, `${seats.filter((s) => s.held).length} held`)}>
        <Table
          rows={seats}
          rowKey={(s) => s.seat}
          columns={[
            { key: 'seat', header: 'Seat', render: (s) => <a href={href('nodes', ...s.seat.split('/'))}><Mono>{s.seat}</Mono></a> },
            { key: 'plan', header: 'Plan', render: (s) => (s.held ? <Status tone="wait" label="held" title={s.held} /> : <span>{s.consume.length} queues</span>) },
            { key: 'why', header: 'Pulls, in order', render: (s) => (s.held ? <span className="muted">{s.held}</span> : <span>{s.consume.map((c, i) => <span key={c}>{i ? ' → ' : ''}<Mono>{shortSubject(c)}</Mono></span>)}</span>) },
            { key: 'own', header: 'Own queue', num: true, render: (s) => s.ownQueue },
            { key: 'load', header: 'In flight', num: true, render: (s) => `${s.inFlight} / ${s.concurrency}` },
            { key: 'node', header: 'Its node says', render: (s) => (s.pull ? <Status tone={s.pull.state === 'held' || s.pull.state === 'off' ? 'wait' : s.pull.state === 'full' ? 'active' : 'quiet'} label={s.pull.state} title={s.pull.reason ?? undefined} /> : <span className="faint">not said</span>) },
            { key: 'version', header: 'Following', render: (s) => (s.following === 'plan' ? <span title={`plan version ${s.pull?.plan_version}`}>plan of {when(planTime(s.pull?.plan_version))}</span> : s.following === 'own' ? <span className="muted">its own eligibility</span> : <span className="faint">—</span>) },
            { key: 'prefill', header: 'Prefill', num: true, render: (s) => (s.prefillRate ? `${s.prefillRate} tok/s` : <span className="faint">—</span>) },
          ]}
          empty="No seat on the board."
        />
      </Panel>
    </>
  );
}
