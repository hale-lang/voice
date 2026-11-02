import { Mono, Status } from '@hale/components';
import { useGet, type Schemas } from './api/client';

type Route = Schemas['AnnotateRoute'];

/**
 * A project's annotation routes as they stand (getAnnotateReadiness): its
 * `decide` alias to the decision model to the seats serving it, each up or
 * not and spending an account the project may or not; and its title's alias
 * likewise. `decide` ready is what annotate needs; the title is optional. Read
 * again as nodes, seats, accounts and the project change (events.ts).
 */
export function AnnotateRoutes({ project }: { project: string }) {
  const q = useGet('/admin/v1/projects/{project}/annotate-readiness', { params: { path: { project } } });
  if (q.isPending) return <span className="faint">reading its routes…</span>;
  if (q.isError) return <span className="c-fail">its routes could not be read: {q.error.message}</span>;
  return (
    <div>
      <RouteLine route={q.data.decide} needed />
      <RouteLine route={q.data.title} />
    </div>
  );
}

function RouteLine({ route, needed }: { route: Route; needed?: boolean }) {
  const tone = route.ready ? 'ok' : needed ? 'fail' : 'wait';
  return (
    <div>
      <Status tone={tone} label={route.ready ? 'ready' : needed ? 'not ready' : 'no titles'} />{' '}
      <Mono>{route.alias}</Mono>
      {route.model ? <> → <Mono>{route.model}</Mono></> : null}
      {route.seats.map((s) => (
        <span key={s.seat}>
          {' '}→ <Mono>{s.seat}</Mono>{' '}
          <Status tone={s.up ? 'ok' : 'fail'} label={s.up ? 'up' : 'down'} />
          <span className={s.may_spend ? 'muted' : 'c-fail'}> · {s.account}{s.may_spend ? '' : ', not its to spend'}</span>
        </span>
      ))}
      {!route.ready && route.problem ? <div className={needed ? 'c-fail' : 'muted'}>{route.problem}</div> : null}
    </div>
  );
}
