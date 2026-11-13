import type { Account, NodeSummary, Schemas, UsageRecordSummary } from '../api/client';
import { capacityOf } from '../api/fleet-reads.ts';
import type { Flight } from '../api/events';

/**
 * A request as the graph draws it: as the ledger lists it, with the
 * caller's metadata when it is known (the record read whole, an event's, or
 * the demo's).
 */
export type FleetRequest = UsageRecordSummary & { metadata?: Record<string, string> };

export type CoreKind = 'project' | 'repository' | 'model' | 'api' | 'node' | 'seat' | 'account' | 'system';
export type Kind = CoreKind | `context:${string}`;
export const KINDS: CoreKind[] = ['project', 'repository', 'model', 'api', 'node', 'seat', 'account', 'system'];
export const kindName = (kind: Kind): string => kind.startsWith('context:') ? kind.slice(8) : ({ project: 'Project', repository: 'Repository', model: 'Model', api: 'API instance', node: 'Execution host', seat: 'Seat', account: 'Account', system: 'System key' }[kind as CoreKind]);
export const graphKinds = (graph: Graph): Kind[] => [...new Set(graph.vertices.map(v => v.kind))].sort((a, b) => kindName(a).localeCompare(kindName(b)));

export type RequestContext = { repository?: string; apiInstance?: string };
/**
 * `placements`: what is placed (`listPlacements`), so a placement across two hosts is drawn as one unit; left out, none is.
 * `instances`: the api instances heard beating, each with its last beat and whether it beats now; left out, none has
 * been heard, and no instance is taken for retired. `inFlight`: the requests in flight now, by id.
 */
export type Fleet = { nodes: NodeSummary[]; accounts: Account[]; projects: Schemas['Project'][]; usage: FleetRequest[]; placements?: Schemas['Placement'][]; contexts?: Record<string, RequestContext>; instances?: { id: string; at: string; up: boolean }[]; inFlight?: string[] };
/** A seat's part in a placement across two hosts: its role, and its partner's seat vertex. */
export type SeatPart = { placement: string; role: 'leader' | 'follower'; partner: string };
/**
 * `aliases`: on a model, the names projects give it now (`ModelAlias`), each once: a label on the model, never a vertex of its own.
 * `part`: a seat's part in a placement across two hosts. `partnerActive`: on a follower's seat and host, the requests in
 * flight on its leader's seat, which it computes half of; its own reported numbers stay its own.
 */
export type Vertex = { id: string; name: string; kind: Kind; state: string; active: number; details: [string, string][]; href?: string; parent?: string; aliases?: string[]; placement?: string; part?: SeatPart; partnerActive?: number };
/**
 * `standing`: the fleet's standing topology (a project to the api instances, an api instance to every host), drawn faint whether or not anything flows; never traffic.
 * `bond`: a placement's leader seat to its follower's, the two halves of one model; `cable`: the link between their hosts.
 */
export type Edge = { id: string; source: string; target: string; kind: 'offers' | 'hosts' | 'pays' | 'standing' | 'observed' | 'bond' | 'cable'; flow?: boolean };
/**
 * `askedAs`: the alias a request named, when it named one; it flows to the model the alias named like any other.
 * `retired`: the api instance that admitted it (`context.apiInstance`, as recorded) has since retired.
 */
export type RequestPath = { vertices: string[]; edges: string[]; flowEdges: string[]; context: RequestContext; askedAs?: string; retired?: boolean };
/**
 * A placement across two hosts, drawn as one unit: its leader's seat and host, its follower's, the bond between the
 * seats, the cable between the hosts, and every edge of it (`edges`). `state`: down when any part of it is, waiting
 * when any part is, with the first such part's reason. `active`: the requests in flight on its leader's seat.
 */
export type Pair = { id: string; model: string; runtime: string; leader: string; follower: string; hosts: [string, string]; bond: string; cable: string; edges: string[]; state: 'up' | 'waiting' | 'down'; reason?: string; active: number };
export type Graph = { vertices: Vertex[]; edges: Edge[]; total: number; requests: Map<string, RequestPath>; pairs: Pair[] };
/** The states drawn as failed, and as waiting. */
export const BAD_STATES = ['down', 'failed', 'exhausted', 'refused', 'revoked'];
export const WAITING_STATES = ['paused', 'pending', 'starting', 'fetching', 'offline', 'disabled'];
/** An api instance's state once it no longer beats and no request in flight names it: drawn faint, and only when asked for. */
export const RETIRED = 'retired';
export type Point = { x: number; y: number };
export const entityId = (kind: Kind, name: string) => `${kind}:${name}`;
export const edgeId = (a: string, b: string) => [a, b].sort().join('|');
const link = (...parts: string[]) => '#/' + parts.map(encodeURIComponent).join('/');

/**
 * The catalog model a request's alias named; none when it named a model. The
 * record says, when it was written after voice kept it (`resolved_model`, the
 * model it was routed as: the alias's model, or the one asked for itself); an
 * older record is read against its project's aliases in force now.
 */
export function resolvedModel(record: FleetRequest, projects: Schemas['Project'][]): { model: string; recorded: boolean } | undefined {
  const kept = record.resolved_model;
  if (kept) return kept !== record.requested_model ? { model: kept, recorded: true } : undefined;
  const now = projects.find(p => p.id === record.project)?.resolved_aliases?.find(a => a.name === record.requested_model);
  return now ? { model: now.model, recorded: false } : undefined;
}

/** Repository is an optional caller label. API identity must come from trusted observation, never caller metadata: the record's `instance`, which the api itself writes. */
export function requestContext(record: FleetRequest, contexts?: Fleet['contexts']): RequestContext {
  const instance = (record as { instance?: string | null }).instance ?? undefined;
  return { repository: record.metadata?.repository?.trim() || undefined, ...(instance ? { apiInstance: instance } : {}), ...contexts?.[record.id] };
}

/**
 * The api instances live now: each beating, and any a request in flight names, beating or not (it is serving still).
 * Undefined when no instance has been heard (`instances` left out): then none is taken for retired.
 */
export function liveInstances(fleet: Fleet): Set<string> | undefined {
  if (!fleet.instances) return undefined;
  const live = new Set(fleet.instances.filter(i => i.up).map(i => i.id));
  const flying = new Set(fleet.inFlight ?? []);
  for (const r of fleet.usage) if (flying.has(r.id)) { const id = requestContext(r, fleet.contexts).apiInstance; if (id) live.add(id); }
  return live;
}

/**
 * What the graph draws beyond the flow. `context`: each request's caller-supplied context (its conversation, repository and metadata keys) as nodes beside its project; off, the project is the flow's only source.
 * `retired`: the api instances that have retired (each redeploy retires one), faint, with the requests they admitted
 * joined to them as recorded; off, none is drawn, and a request one admitted flows from its project straight to its host.
 */
export type GraphOptions = { context?: boolean; retired?: boolean };

/** Each request is a hyperedge: a correlated set of participants, rendered as links. */
export function buildGraph(fleet: Fleet, options: GraphOptions = {}): Graph {
  const vertices = new Map<string, Vertex>();
  const edges = new Map<string, Edge>();
  const requests = new Map<string, RequestPath>();
  const add = (v: Vertex) => vertices.set(v.id, v);
  const connect = (source: string, target: string, kind: Edge['kind'], flow = false) => {
    if (vertices.has(source) && vertices.has(target)) {
      const id = edgeId(source, target);
      // Configuration retains its style; the request membership is tracked
      // separately. A standing link something flows over is traffic now
      const was = edges.get(id);
      if (!was) edges.set(id, { id, source, target, kind, flow });
      else if (flow) edges.set(id, { ...was, source, target, kind: was.kind === 'standing' ? 'observed' : was.kind, flow: true });
      else if (was.kind === 'standing' && kind === 'observed') edges.set(id, { ...was, kind });
      return id;
    }
    return undefined;
  };
  // the api instances: live while they beat or a request in flight names
  // them; retired after (each redeploy starts a new one), drawn only when
  // asked for. Unknown when none has been heard: then each is as recorded
  const live = liveInstances(fleet);
  const retired = (id: string) => !!live && !live.has(id);
  const heard = new Map((fleet.instances ?? []).map(i => [i.id, i]));
  const apiVertex = (name: string): string | undefined => {
    const id = entityId('api', name);
    if (retired(name) && !options.retired) return undefined;
    if (vertices.has(id)) return id;
    const beat = heard.get(name);
    const state = retired(name) ? RETIRED : live ? 'up' : 'observed';
    const meaning = state === RETIRED ? 'Retired: it no longer beats and no request in flight names it. The requests it admitted still name it.'
      : state === 'up' ? (beat?.up ? 'Live: beating.' : 'Live: a request in flight names it.')
      : 'The api instance that admitted a request, as its usage record says.';
    add({ id, name, kind: 'api', state, active: 0, details: [['API instance', name], ['State', meaning], ['Last heartbeat', beat?.at ?? 'not heard']] });
    return id;
  };
  for (const i of fleet.instances ?? []) apiVertex(i.id);
  for (const p of fleet.projects) add({ id: entityId('project', p.id), name: p.id, kind: 'project', state: p.status, active: 0, href: link('projects', p.id), details: [['Name', p.name], ['State', p.status]] });
  const model = (name: string, meaning: string) => {
    const id = entityId('model', name);
    if (!vertices.has(id)) add({ id, name, kind: 'model', state: 'configured', active: 0, href: link('models', name), details: [['Catalog model', name], ['Meaning', meaning]] });
    return id;
  };
  // each seat of a placement, its placement: a leader's and follower's of one
  // across two hosts, by their refs
  const placedAt = new Map<string, Schemas['Placement']>();
  for (const p of fleet.placements ?? []) { placedAt.set(p.seat, p); if (p.follower_seat) placedAt.set(p.follower_seat, p); }
  const seatAt = new Map(fleet.nodes.flatMap(n => n.seats.map(s => [s.ref, s] as const)));
  const partOf = (ref: string): (SeatPart & { at: Schemas['Placement'] }) | undefined => {
    const p = placedAt.get(ref);
    if (!p?.follower_seat || !seatAt.has(p.seat) || !seatAt.has(p.follower_seat)) return undefined;
    return ref === p.seat ? { placement: p.id, role: 'leader', partner: entityId('seat', p.follower_seat), at: p } : { placement: p.id, role: 'follower', partner: entityId('seat', p.seat), at: p };
  };
  for (const a of fleet.accounts) add({ id: entityId('account', a.id), name: a.id, kind: 'account', state: a.exhausted_until ? 'exhausted' : a.status, active: 0, href: link('accounts', a.id), details: [['Billing', a.billing ?? 'none'], ['State', a.status], ...a.windows.map((w): [string, string] => [w.name.replaceAll('_', ' '), `${w.used_percent}% used · reported ${w.observed_at}`])] });
  for (const n of fleet.nodes) {
    // a follower's seat serves nothing itself: the node's capacity is its
    // other seats', and what it computes for a leader is told as that
    const follows = n.seats.flatMap(s => { const part = partOf(s.ref); return part?.role === 'follower' ? [part] : []; });
    const computing = follows.reduce((sum, f) => sum + (seatAt.get(f.at.seat)?.in_flight ?? 0), 0);
    add({ id: entityId('node', n.id), name: n.id, kind: 'node', state: n.status, active: n.in_flight ?? 0, ...(follows.length ? { partnerActive: computing } : {}), href: link('nodes', n.id), details: [['Name', n.name ?? n.id], ['State', n.status], ['In flight / capacity', `${n.in_flight ?? '—'} / ${capacityOf({ seats: n.seats.filter(s => partOf(s.ref)?.role !== 'follower') })}`], ...follows.map((f): [string, string] => ['Follower of', `${f.at.seat} (${f.at.id}): computes half of its ${seatAt.get(f.at.seat)?.in_flight ?? 0} in flight`]), ['Last heartbeat', n.last_heartbeat_at ?? 'not reported'], ['Assignment / applied', `${n.assignment_version ?? '—'} / ${n.applied_version ?? '—'}`]] });
    for (const s of n.seats) {
      const part = partOf(s.ref);
      const placement = part?.at ?? placedAt.get(s.ref);
      const leader = part?.role === 'follower' ? seatAt.get(part.at.seat) : undefined;
      const runtime = s.runtime ?? placement?.runtime;
      const role: [string, string][] = !part ? (placement ? [['Placement', `${placement.id} · on ${n.id} alone`]] : [])
        : part.role === 'leader' ? [['Role', `Leader: takes its requests, and computes them with ${part.at.follower_seat} across the link`], ['Placement', `${part.at.id}${part.at.model !== part.at.id ? ` · ${part.at.model}` : ''} across ${part.at.nodes.join(' + ')}`], ['Partner seat', part.at.follower_seat!]]
        : [['Role', `Follower: serves through its leader, ${part.at.seat}; it takes no request of its own`], ['Placement', `${part.at.id}${part.at.model !== part.at.id ? ` · ${part.at.model}` : ''} across ${part.at.nodes.join(' + ')}`], ['Partner seat', part.at.seat]];
      const flight: [string, string] = leader ? ['In flight', `none of its own; computes half of its leader's ${leader.in_flight}`] : ['In flight / cap', `${s.in_flight} / ${s.concurrency ?? 1}`];
      add({ id: entityId('seat', s.ref), name: s.id, kind: 'seat', parent: entityId('node', n.id), state: s.status, active: s.in_flight, ...(leader ? { partnerActive: leader.in_flight } : {}), ...(placement ? { placement: placement.id } : {}), ...(part ? { part: { placement: part.placement, role: part.role, partner: part.partner } } : {}), href: link('nodes', n.id, s.id), details: [['Seat', s.ref], ...role, ['Engine', s.engine], ...(runtime ? [['Runtime', runtime] as [string, string]] : []), ['Account', s.account], ['State', s.status], flight, ['Reason', s.reason ?? (s.problems.join('; ') || 'none reported')]] });
      connect(entityId('node', n.id), entityId('seat', s.ref), 'hosts');
      // a follower reaches its model only through its leader, across the bond
      if (part?.role === 'follower') continue;
      for (const m of s.serves) {
        const id = model(m.model, 'Configured on a seat; not evidence of loaded weights.');
        // Account/model links summarize the models offered by its seats.
        connect(vertices.has(entityId('account', s.account)) ? entityId('account', s.account) : entityId('seat', s.ref), id, 'offers');
      }
      connect(entityId('seat', s.ref), entityId('account', s.account), 'pays');
    }
  }
  // each placement across two hosts: one unit, its seats bonded, its hosts
  // cabled, down or waiting as its worst part is
  const pairs: Pair[] = [];
  const pairBySeat = new Map<string, Pair>();
  for (const p of fleet.placements ?? []) {
    if (!p.follower_seat || !partOf(p.seat)) continue;
    const leaderSeat = seatAt.get(p.seat)!, followerSeat = seatAt.get(p.follower_seat)!;
    const leader = entityId('seat', p.seat), follower = entityId('seat', p.follower_seat);
    const hosts: [string, string] = [entityId('node', leaderSeat.node), entityId('node', followerSeat.node)];
    const bond = connect(leader, follower, 'bond')!;
    const cable = connect(hosts[0], hosts[1], 'cable')!;
    // its hosts first: a host down is why its seat is
    const parts = [
      { v: vertices.get(hosts[0])!, what: `host ${leaderSeat.node}`, reason: undefined },
      { v: vertices.get(hosts[1])!, what: `host ${followerSeat.node}`, reason: undefined },
      { v: vertices.get(leader)!, what: `leader ${p.seat}`, reason: leaderSeat.reason },
      { v: vertices.get(follower)!, what: `follower ${p.follower_seat}`, reason: followerSeat.reason },
    ];
    const worst = parts.find(x => BAD_STATES.includes(x.v.state)) ?? parts.find(x => WAITING_STATES.includes(x.v.state));
    const state: Pair['state'] = !worst ? 'up' : BAD_STATES.includes(worst.v.state) ? 'down' : 'waiting';
    const pair: Pair = { id: p.id, model: p.model, runtime: leaderSeat.runtime ?? p.runtime, leader, follower, hosts, bond, cable, edges: [bond, cable, edgeId(hosts[0], leader), edgeId(hosts[1], follower)], state, ...(worst ? { reason: `${worst.what} is ${worst.v.state}${worst.reason ? `: ${worst.reason}` : ''}` } : {}), active: leaderSeat.in_flight };
    pairs.push(pair);
    pairBySeat.set(leader, pair);
  }
  // the names projects give models now, their own and those they inherit:
  // labels on the model, each name once, and who gives it in its detail
  const givenBy = new Map<string, string[]>();
  for (const p of fleet.projects) for (const a of p.resolved_aliases ?? p.aliases ?? []) {
    const id = model(a.model, 'Named by an alias; not evidence of a seat that serves it.');
    const v = vertices.get(id)!;
    if (!(v.aliases ??= []).includes(a.name)) v.aliases.push(a.name);
    givenBy.set(id, [...(givenBy.get(id) ?? []), `${p.id}: ${a.name}`]);
  }
  for (const [id, by] of givenBy) vertices.get(id)!.details.push(['Aliases', by.join(', ')]);
  for (const r of fleet.usage) {
    // voice's own request for a project (its system key's: an annotation, a
    // title), drawn apart and dotted: project → its system key → the model,
    // never through the project's own flow
    if ((r as { internal?: boolean }).internal) {
      const members: string[] = [];
      const links: string[] = [];
      const project = entityId('project', r.project);
      if (!vertices.has(project)) add({ id: project, name: r.project, kind: 'project', state: 'observed', active: 0, details: [['Project', r.project]] });
      const key = entityId('system', r.key);
      if (!vertices.has(key)) add({ id: key, name: r.key, kind: 'system', state: 'internal', active: 0, details: [['System key', r.key], ['Meaning', "Voice's own requests for the project (annotations, titles): kept out of its usage, its limits and its flow."]] });
      const target = r.served?.model ?? r.requested_model;
      const model = entityId('model', target);
      if (!vertices.has(model)) add({ id: model, name: target, kind: 'model', state: 'observed', active: 0, details: [['Model', target], ['Evidence', 'Asked by a system key.']] });
      for (const [a, b] of [[project, key], [key, model]] as const) {
        const id = connect(a, b, 'observed', false);
        if (id) links.push(id);
      }
      members.push(project, key, model);
      requests.set(r.id, { vertices: members, edges: links, flowEdges: [], context: requestContext(r, fleet.contexts) });
      continue;
    }
    const context = requestContext(r, fleet.contexts);
    const members: string[] = [];
    const links: string[] = [];
    const flowLinks: string[] = [];
    const member = (kind: Kind, name: string, meaning = 'Seen in a request; current configuration is not reported.') => {
      const id = entityId(kind, name);
      if (!vertices.has(id)) add({ id, name, kind, state: 'observed', active: 0, details: [[kindName(kind), name], ['Evidence', meaning]] });
      members.push(id);
      return id;
    };
    const join = (a: string, b: string, flow = false) => { const id = connect(a, b, 'observed', flow); if (id) { links.push(id); if (flow) flowLinks.push(id); } };
    const project = member('project', r.project);
    // a request by alias is the model it named, as it was served: the alias
    // is what it was asked as, kept on its path, never a vertex
    const resolved = resolvedModel(r, fleet.projects);
    if (resolved) member('model', resolved.model, resolved.recorded ? 'The catalog model the alias named when the request was admitted.' : 'The model the alias names now; the record predates voice keeping what it named.');
    else member('model', r.requested_model);
    if (options.context && context.repository) join(project, member('repository', context.repository, 'Caller-supplied metadata.repository; a label, not verified repository ownership.'));
    // its conversation, the prompt_cache_key it was sent with: whatever client
    if (options.context && r.conversation) {
      const c = member('context:conversation', r.conversation, "The request's conversation: the prompt_cache_key its client sent, as its usage record keeps it.");
      const v = vertices.get(c);
      if (v && !v.href) v.href = link('usage', 'c', r.conversation);
      join(project, c);
    }
    if (options.context) for (const [key, value] of Object.entries(r.metadata ?? {})) {
      if (key === 'repository' || typeof value !== 'string' || !value.trim()) continue;
      join(project, member(`context:${key}`, value, `Caller-supplied metadata.${key}; request context, not verified infrastructure identity.`));
    }
    // the api instance that admitted it, as recorded; one since retired is
    // drawn only when asked for, and never stands in for the live one
    const admitted = context.apiInstance;
    const api = admitted ? apiVertex(admitted) : undefined;
    if (api) { members.push(api); join(project, api, true); }
    if (r.served) {
      const seat = member('seat', r.served.seat);
      const host = member('node', r.served.node);
      const account = member('account', r.served.account);
      const servedModel = member('model', r.served.model, 'Model reported by the serving engine; the terminal inference target.');
      join(host, seat, true); join(seat, account, true); join(account, servedModel, true);
      // a leader's request is computed by both its hosts: its follower's seat
      // and host are on its path, the bond and the cable lit with it
      const pair = pairBySeat.get(seat);
      if (pair) {
        const followerHost = member('node', pair.hosts[1].slice(5)), followerSeat = member('seat', pair.follower.slice(5));
        join(host, followerHost, true); join(followerHost, followerSeat, true); join(seat, followerSeat, true);
      }
      // the project reaches the host through the api instance that admitted
      // it, or straight there when the record predates naming one or that
      // instance has retired and is not drawn: a project is never left apart
      // from its flow
      if (api) join(api, host, true);
      else join(project, host, true);
    }
    requests.set(r.id, { vertices: [...new Set(members)], edges: [...new Set(links)], flowEdges: flowLinks, context, ...(resolved ? { askedAs: r.requested_model } : {}), ...(admitted && retired(admitted) ? { retired: true } : {}) });
  }
  // the standing topology, faint, with or without traffic: every project
  // reaches the api instances, every api instance every host; after the
  // requests, so an instance known only from its records is joined too; a
  // retired one reaches nothing now
  const apis = [...vertices.values()].filter(v => v.kind === 'api' && v.state !== RETIRED).map(v => v.id);
  for (const p of fleet.projects) for (const a of apis) connect(entityId('project', p.id), a, 'standing');
  for (const a of apis) for (const n of fleet.nodes) connect(a, entityId('node', n.id), 'standing');
  const visible = [...vertices.values()].slice(0, 160);
  const ids = new Set(visible.map(v => v.id));
  return { vertices: visible, edges: [...edges.values()].filter(e => ids.has(e.source) && ids.has(e.target)), total: vertices.size, requests, pairs: pairs.filter(p => [p.leader, p.follower, ...p.hosts].every(id => ids.has(id))) };
}

/** The placement across two hosts each of `ids` is part of (a seat of it, its bond or its hull's), each once. */
export function pairsOf(ids: Iterable<string>, graph: Graph): Pair[] {
  const want = new Set(ids);
  return graph.pairs.filter(p => want.has(p.leader) || want.has(p.follower) || want.has(p.bond) || want.has(`pair:${p.id}`));
}

/**
 * What re-runs the layout: the vertices and the configured edges (a host's seats, what they offer and who pays, the
 * bonds and cables of placements across two hosts). A request starting, running or ending changes neither: the edges it
 * draws are observed, and its flow is never part of it; the standing topology follows from the vertices.
 */
export function topologyKey(graph: Graph): string {
  return graph.vertices.map(v => `${v.id}/${v.parent ?? ''}`).sort().join(',') + '|' + graph.edges.filter(e => e.kind !== 'observed' && e.kind !== 'standing').map(e => `${e.id}/${e.kind}`).sort().join(',');
}

/** No transitive traversal: sharing a model/account cannot splice two requests together. */
export function requestEdges(record: FleetRequest, graph: Graph): Set<string> {
  const existing = new Set(graph.edges.map(e => e.id));
  return new Set((graph.requests.get(record.id)?.edges ?? []).filter(id => existing.has(id)));
}
export function requestFlowEdges(record: FleetRequest, graph: Graph): Set<string> {
  const existing = new Set(graph.edges.map(e => e.id));
  return new Set((graph.requests.get(record.id)?.flowEdges ?? []).filter(id => existing.has(id)));
}

export function requestVertices(record: FleetRequest, graph: Graph): Set<string> {
  const existing = new Set(graph.vertices.map(v => v.id));
  return new Set((graph.requests.get(record.id)?.vertices ?? []).filter(id => existing.has(id)));
}
export function relatedRequests(id: string, records: FleetRequest[], graph: Graph): FleetRequest[] {
  return records.filter(r => graph.requests.get(r.id)?.vertices.includes(id));
}
export function matchingRequests(ids: string[], records: FleetRequest[], graph: Graph, mode: 'all' | 'any' = 'all'): FleetRequest[] {
  if (!ids.length) return records;
  return records.filter(r => {
    const members = graph.requests.get(r.id)?.vertices ?? [];
    return mode === 'all' ? ids.every(id => members.includes(id)) : ids.some(id => members.includes(id));
  });
}

/**
 * A request in flight as a record the graph can light: what it asked for, the catalog model it is routed as, and the
 * seat it is on. An api from before the event told `resolved_model` told that model as `requested_model`.
 */
export function provisional(f: Flight): FleetRequest {
  const model = f.resolved_model ?? f.requested_model;
  return { id: f.id, created_at: f.started_at, project: f.project, key: f.key, requested_model: f.requested_model, ...(f.resolved_model ? { resolved_model: f.resolved_model } : {}), status: 'served', served: { seat: f.seat, node: f.seat.split('/')[0], account: f.account, model, engine: '' }, input_tokens: 0, output_tokens: 0, price_micros: 0, currency: 'USD', timing: { wall_ms: 0, queue_ms: 0, load_ms: 0 }, attempts: [], metadata: {}, instance: (f as { instance?: string | null }).instance ?? null } as unknown as FleetRequest;
}

const hash = (value: string) => [...value].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** One field with a soft execution direction. Context never shortens the execution spine. */
export function layoutGraph(graph: Graph, width: number, height: number, pins: ReadonlyMap<string, Point> = new Map(), previous?: ReadonlyMap<string, Point>): Map<string, Point> {
  const vertices = [...graph.vertices].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...graph.edges].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(vertices.map(v => [v.id, v]));
  const neighbors = new Map(vertices.map(v => [v.id, [] as string[]]));
  for (const e of edges) { neighbors.get(e.source)?.push(e.target); neighbors.get(e.target)?.push(e.source); }
  const constrain = (p: Point) => ({ x: Math.max(65, Math.min(width - 65, p.x)), y: Math.max(55, Math.min(height - 65, p.y)) });
  const context = vertices.filter(v => v.kind === 'repository' || v.kind.startsWith('context:'));
  const stages = (['project', 'system', 'api', 'node', 'seat', 'account', 'model'] as Kind[]).filter(kind => vertices.some(v => v.kind === kind));
  const anchors = new Map<string, Point>();
  const span = width - 170;
  const start = 85 + (context.length ? span * .17 : 0);
  const modelStart = width - 190;
  const top = 95, bottom = Math.max(top, height - 90);
  const spreadY = (index: number, length: number) => length === 1 ? (top + bottom) / 2 : top + index * (bottom - top) / (length - 1);
  // Shared model neighborhoods order hosts before their seats, reducing crossings.
  const modelIds = vertices.filter(v => v.kind === 'model').map(v => v.id);
  const modelOrder = (v: Vertex): number => {
    const seats = neighbors.get(v.id)!.filter(id => byId.get(id)?.kind === 'seat');
    const accounts = seats.flatMap(id => neighbors.get(id)!).filter(id => byId.get(id)?.kind === 'account');
    const models = [...new Set([...seats, ...accounts].flatMap(id => neighbors.get(id)!).filter(id => byId.get(id)?.kind === 'model'))];
    return models.length ? models.reduce((sum, id) => sum + modelIds.indexOf(id), 0) / models.length : modelIds.length;
  };
  // a placement across two hosts is one unit: its hosts side by side, the
  // leader's first, and its seats facing each other across the bond
  const pairs = [...(graph.pairs ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const cabled = new Map<string, string[]>();
  for (const p of pairs) for (const [a, b] of [p.hosts, [p.hosts[1], p.hosts[0]]]) cabled.set(a!, [...(cabled.get(a!) ?? []), b!]);
  const partnerOf = new Map(pairs.flatMap(p => [[p.leader, p.follower], [p.follower, p.leader]] as const));
  for (const [stage, kind] of stages.entries()) {
    const group = vertices.filter(v => v.kind === kind);
    if (kind === 'node') {
      group.sort((a,b) => modelOrder(a) - modelOrder(b) || a.id.localeCompare(b.id));
      // each host followed at once by those it is cabled to, and theirs
      const placed = new Set<string>(), order: Vertex[] = [];
      const place = (v: Vertex) => {
        if (placed.has(v.id)) return;
        placed.add(v.id); order.push(v);
        for (const id of cabled.get(v.id) ?? []) { const w = byId.get(id); if (w) place(w); }
      };
      group.forEach(place);
      group.splice(0, group.length, ...order);
    }
    if (kind === 'model' || kind === 'account') {
      const meanY = (v: Vertex) => {
        const related = neighbors.get(v.id)!.flatMap(id => anchors.has(id) ? [anchors.get(id)!.y] : []);
        return related.length ? related.reduce((sum,y) => sum+y,0)/related.length : height/2;
      };
      group.sort((a,b) => meanY(a)-meanY(b) || a.id.localeCompare(b.id));
    }
    const x = stages.length === 1 ? width / 2 : start + stage * (modelStart - start) / (stages.length - 1);
    group.forEach((v, index) => {
      const hostId = v.parent ?? neighbors.get(v.id)!.find(id => byId.get(id)?.kind === 'node');
      const host = kind === 'seat' && hostId ? anchors.get(hostId) : undefined;
      // a pair's seat sits at the edge of its host's seats nearest its partner's host
      const facing = (s: Vertex) => {
        const partner = partnerOf.get(s.id), there = partner ? anchors.get(byId.get(partner)?.parent ?? '') : undefined;
        return there && host ? Math.sign(there.y - host.y) : 0;
      };
      const siblings = hostId ? group.filter(s => s.parent === hostId || neighbors.get(s.id)!.includes(hostId)).sort((a, b) => facing(a) - facing(b)) : [];
      const offset = host ? (siblings.indexOf(v) - (siblings.length - 1) / 2) * 46 : 0;
      const weights = group.map(item => 1 + neighbors.get(item.id)!.filter(id => byId.get(id)?.kind === 'seat').length);
      const hostY = top + (weights.slice(0,index).reduce((sum,n) => sum+n,0) + weights[index]! / 2) / weights.reduce((sum,n) => sum+n,0) * (bottom-top);
      const y = kind === 'model' ? group.length === 1 ? height / 2 : top + index * (height - 160) / (group.length - 1) : host ? host.y + offset : kind === 'node' ? hostY : spreadY(index, group.length);
      anchors.set(v.id, { x, y });
    });
  }
  const contextY = (v: Vertex) => {
    const related = neighbors.get(v.id)!.flatMap(id => anchors.has(id) ? [anchors.get(id)!.y] : []);
    return related.length ? related.reduce((sum,y) => sum+y,0)/related.length : height/2;
  };
  context.sort((a,b) => contextY(a)-contextY(b) || a.id.localeCompare(b.id));
  context.forEach((v,index) => anchors.set(v.id, { x: 85, y: spreadY(index, context.length) }));
  const points = new Map(vertices.map(v => {
    const anchor = anchors.get(v.id)!, saved = previous?.get(v.id);
    const initial = saved ? { x: saved.x * .1 + anchor.x * .9, y: saved.y * .1 + anchor.y * .9 } : anchor;
    return [v.id, constrain(pins.get(v.id) ?? initial)];
  }));
  for (let step = 0; step < 220; step++) {
    const force = new Map(vertices.map(v => [v.id, { x: 0, y: 0 }]));
    for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
      const a = vertices[i]!, b = vertices[j]!, pa = points.get(a.id)!, pb = points.get(b.id)!;
      const dx = pa.x - pb.x || .1, dy = pa.y - pb.y || .1;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const repulsion = Math.min(6, 1700 / (distance * distance));
      let fx = dx / distance * repulsion, fy = dy / distance * repulsion;
      // Reserve both the glyph and its label, including labels revealed by selection.
      const overlapX = (a.kind === 'seat' && b.kind === 'seat' ? 112 : 158) - Math.abs(dx);
      const overlapY = (a.kind === 'model' && b.kind === 'model' ? (a.aliases?.length || b.aliases?.length ? 44 : 30) : a.kind === 'seat' && b.kind === 'seat' ? 46 : 82) - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) {
        if (overlapX < overlapY) fx += Math.sign(dx) * overlapX * .9;
        else fy += Math.sign(dy) * overlapY * .9;
      }
      force.get(a.id)!.x += fx; force.get(a.id)!.y += fy;
      force.get(b.id)!.x -= fx; force.get(b.id)!.y -= fy;
    }
    for (const e of edges) {
      const a = points.get(e.source)!, b = points.get(e.target)!;
      const aa = anchors.get(e.source)!, ba = anchors.get(e.target)!;
      // never a request's flow: the layout is the topology's alone (topologyKey)
      const structural = e.kind === 'hosts' || e.kind === 'offers' || e.kind === 'bond' || e.kind === 'cable';
      const strength = (structural ? .065 : .012) / Math.sqrt(Math.max(neighbors.get(e.source)!.length, neighbors.get(e.target)!.length));
      // Springs retain their natural directed span instead of collapsing long context links.
      const fx = ((b.x - a.x) - (ba.x - aa.x)) * strength - (structural ? Math.max(0, 85 - (b.x-a.x)) * .4 : 0);
      const fy = ((b.y - a.y) - (e.kind === 'hosts' ? ba.y - aa.y : 0)) * strength;
      force.get(e.source)!.x += fx; force.get(e.source)!.y += fy;
      force.get(e.target)!.x -= fx; force.get(e.target)!.y -= fy;
    }
    for (const v of vertices) {
      if (pins.has(v.id)) continue;
      const p = points.get(v.id)!, f = force.get(v.id)!, anchor = anchors.get(v.id)!;
      const saved = previous?.get(v.id);
      f.x += (anchor.x - p.x) * .12 + ((saved?.x ?? p.x) - p.x) * .008;
      f.y += (anchor.y - p.y) * .1 + ((saved?.y ?? p.y) - p.y) * .008;
      const cooling = 1 - step / 300;
      const next = constrain({ x: p.x + Math.max(-12,Math.min(12,f.x)) * cooling, y: p.y + Math.max(-12,Math.min(12,f.y)) * cooling });
      // Neural layers retain their alignment; only explicit pins leave a layer.
      p.x = constrain(anchor).x;
      p.y = v.kind === 'model' || v.kind === 'account' ? constrain(anchor).y : next.y;
    }
  }
  return points;
}

/** Preserve the mental map proportionally when the canvas changes size. */
export function resizeLayout(points: ReadonlyMap<string, Point>, from: Point, to: Point): Map<string, Point> {
  return new Map([...points].map(([id,p]) => [id, { x: p.x * to.x / from.x, y: p.y * to.y / from.y }]));
}

/**
 * The outline around a placement across two hosts: the convex hull of its vertices, each grown to a circle of `pad`,
 * so it reads as one rounded unit; its centre, where its label sits, and the middle of its bottom edge.
 */
export function hullOf(centres: Point[], pad: number): { path: string; centre: Point; bottom: Point } {
  const ring = centres.flatMap(c => Array.from({ length: 24 }, (_, i) => ({ x: c.x + pad * Math.cos(i * Math.PI / 12), y: c.y + pad * Math.sin(i * Math.PI / 12) })));
  const sorted = [...ring].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (points: Point[]) => {
    const out: Point[] = [];
    for (const p of points) { while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop(); out.push(p); }
    return out.slice(0, -1);
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  const xs = centres.map(c => c.x), x = (Math.min(...xs) + Math.max(...xs)) / 2;
  return { path: hull.length ? 'M' + hull.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L') + 'Z' : '', centre: { x, y: centres.reduce((sum, c) => sum + c.y, 0) / Math.max(1, centres.length) }, bottom: { x, y: Math.max(...hull.map(p => p.y)) } };
}

export function edgePath(a: Point, b: Point, id: string, orthogonal = false): string {
  if (orthogonal) return `M${a.x},${a.y} H${(a.x+b.x)/2} V${b.y} H${b.x}`;
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy));
  const bend = (hash(id) % 41) - 20;
  return `M${a.x},${a.y} Q${(a.x + b.x) / 2 - dy / length * bend},${(a.y + b.y) / 2 + dx / length * bend} ${b.x},${b.y}`;
}
