import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, entityId, edgeId, requestEdges, requestVertices, requestContext, relatedRequests, matchingRequests, graphKinds, requestFlowEdges, layoutGraph, resizeLayout, topologyKey, provisional, pairsOf, hullOf, liveInstances, RETIRED } from './network-model.ts';
import { demoFleet, demoRequest, demoInFlight, demoCompletions, demoContext, demoInstances } from './network-demo.ts';

test('graph relationships come from configuration or usage, never all-to-all guesses', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const graph = buildGraph(fleet);
  const model = entityId('model', 'sonnet');
  const account = entityId('account', fleet.nodes.find(n => n.id === 'host-4').seats.find(s => s.ref === 'host-4/seat-1').account);
  assert(graph.edges.some((e) => e.id === edgeId(model, account) && e.kind === 'offers'));
  assert(!graph.edges.some((e) => e.id === edgeId(model, entityId('account', 'local'))));
  const noUsage = buildGraph({ ...fleet, usage: [] });
  assert(!noUsage.edges.some((e) => e.kind === 'observed'));
  assert.equal(noUsage.vertices.filter((v) => v.kind === 'project').length, fleet.projects.length);
});

test('a refused request without an attributed seat never lights a machine or payer', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...demoRequest(fleet, 2, 1_800_000_000_000), served: null, status: 'no_capacity' };
  const graph = buildGraph({ ...fleet, usage: [record] });
  const lit = requestEdges(record, graph);
  // no host, seat or account: what it does light is only its project's own context
  assert(![...lit].some((id) => /(^|>)(node|seat|account):/.test(id) || id.includes('node:') || id.includes('seat:') || id.includes('account:')));
  assert(!lit.has(edgeId(entityId('project', record.project), entityId('model', record.requested_model))));
});

test('a served event traces its own model, seat, node and account only', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = demoRequest(fleet, 1, 1_800_000_000_000);
  const graph = buildGraph({ ...fleet, usage: [record] });
  const lit = requestEdges(record, graph);
  assert.equal(lit.size, 4);
  assert(lit.has(edgeId(entityId('seat', record.served.seat), entityId('node', record.served.node))));
  assert(lit.has(edgeId(entityId('seat', record.served.seat), entityId('account', record.served.account))));
});

test('occupancy updates preserve topology and a deterministic bounded layout', () => {
  const a = buildGraph(demoFleet(0, 1_800_000_000_000));
  const b = buildGraph(demoFleet(7, 1_800_000_000_000));
  assert.deepEqual(a.edges, b.edges);
  const first = layoutGraph(a, 600, 530);
  assert.deepEqual(first, layoutGraph(b, 600, 530));
  for (const p of first.values()) {
    assert(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert(p.x >= 65 && p.x <= 535 && p.y >= 55 && p.y <= 465);
  }
});

test('large fleets stay bounded and never retain dangling edges', () => {
  const fixture = demoFleet(0, 1_800_000_000_000);
  const graph = buildGraph({ ...fixture, projects: Array.from({ length: 200 }, (_, i) => ({ ...fixture.projects[0], id: `p-${i}` })) });
  assert.equal(graph.vertices.length, 160);
  assert(graph.total > 160);
  const ids = new Set(graph.vertices.map((v) => v.id));
  assert(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
});

import { filterFleet } from './network-filters.ts';
test('combined host and backend filters retain only matching seat neighborhoods', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const result = filterFleet(fleet, { host: 'host-4', engine: 'claude-cli', account: 'claude-work' });
  assert.deepEqual(result.nodes.map(n => n.id), ['host-4']);
  assert.deepEqual(result.accounts.map(a => a.id), ['claude-work']);
  assert(result.usage.every(r => !r.served || r.served.node === 'host-4'));
  assert.equal(filterFleet(fleet, { host: 'host-4', engine: 'mlx' }).nodes.length, 0);
});
test('policy defaults and idle filtering follow the seat contract', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const result = filterFleet(fleet, { dataClass: 'internal', enabled: 'enabled', activity: 'idle' });
  assert(result.nodes.length > 0);
  assert(result.nodes.flatMap(n => n.seats).every(s => s.in_flight === 0));
  assert.equal(filterFleet(fleet, { dataClass: 'secret' }).nodes.length, 0);
});

test('unified layout is independent of response ordering and supports newly reported dimensions', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const graph = buildGraph(fleet, { context: true });
  const points = layoutGraph(graph, 940, 740);
  assert.deepEqual(points, layoutGraph({ ...graph, vertices: [...graph.vertices].reverse(), edges: [...graph.edges].reverse() }, 940, 740));
  const record = { ...fleet.usage[1], id: 'extra', metadata: { branch: 'feature/new' } };
  const expanded = buildGraph({ ...fleet, usage: [...fleet.usage, record] }, { context: true });
  const next = layoutGraph(expanded, 940, 740, new Map(), points);
  assert(next.has('context:branch:feature/new'));
  for (const p of next.values()) assert(Number.isFinite(p.x) && p.x >= 65 && p.x <= 875 && p.y >= 55 && p.y <= 675);
  const displacement = [...points].reduce((sum,[id,p]) => sum + Math.hypot(next.get(id).x-p.x,next.get(id).y-p.y),0)/points.size;
  assert(displacement < 50, `Existing network moved ${displacement}px on average`);
});
test('drag pins are honored and bounded; reset restores the settled layout', () => {
  const graph = buildGraph(demoFleet(0, 1_800_000_000_000));
  const base = layoutGraph(graph, 940, 740);
  const pins = new Map([['project:research', { x: 250, y: 200 }], ['node:host-4', { x: -100, y: 900 }]]);
  const dragged = layoutGraph(graph, 940, 740, pins);
  assert.deepEqual(dragged.get('project:research'), { x: 250, y: 200 });
  assert.deepEqual(dragged.get('node:host-4'), { x: 65, y: 675 });
  assert.deepEqual(layoutGraph(graph, 940, 740, new Map()), base);
});

test('a request fuses all seven participants without borrowing another request path', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const first = { ...demoRequest(fleet, 1, 1_800_000_000_000), id: 'first', project: 'research', metadata: { repository: 'repo-a' } };
  const second = { ...first, id: 'second', project: 'product', metadata: { repository: 'repo-b' }, served: { ...first.served, node: 'historical-host', seat: 'historical-host/seat' } };
  fleet.usage = [first,second];
  fleet.contexts = { first: { apiInstance: 'api-a' }, second: { apiInstance: 'api-b' } };
  const graph = buildGraph(fleet, { context: true });
  const path = requestVertices(first, graph);
  assert.equal(path.size, 7);
  assert.equal(requestEdges(first, graph).size, 6);
  assert(path.has('repository:repo-a') && path.has('api:api-a'));
  assert(!path.has('repository:repo-b') && !path.has('api:api-b') && !path.has('node:historical-host'));
  assert.deepEqual(relatedRequests('project:research', fleet.usage, graph).map(r => r.id), ['first']);
  assert.equal(relatedRequests(`model:${first.requested_model}`, fleet.usage, graph).length, 2);
  assert(requestVertices(second, graph).has('node:historical-host'));
});
test('caller metadata cannot spoof API instance identity; missing context stays absent', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...fleet.usage[0], metadata: { apiInstance: 'spoofed', api_instance: 'spoofed' }, served: null };
  const graph = buildGraph({ ...fleet, usage: [record] }, { context: true });
  assert.equal(requestContext(record).apiInstance, undefined);
  assert(!graph.vertices.some(v => v.kind === 'api' || v.kind === 'repository'));
  assert.deepEqual([...requestVertices(record, graph)].sort(), [`project:${record.project}`, `model:${record.requested_model}`, 'context:apiInstance:spoofed', 'context:api_instance:spoofed'].sort());
  assert.equal(requestFlowEdges(record, graph).size, 0);
});
test('repository and API filters intersect on the same request, not a shared model', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const a = { ...fleet.usage[0], id: 'a', metadata: { repository: 'repo-a' } };
  const b = { ...a, id: 'b', metadata: { repository: 'repo-b' } };
  fleet.usage = [a,b]; fleet.contexts = { a: { apiInstance: 'api-a' }, b: { apiInstance: 'api-b' } };
  assert.equal(filterFleet(fleet, { repository: 'repo-a', api: 'api-b' }).usage.length, 0);
  assert.deepEqual(filterFleet(fleet, { repository: 'repo-a', api: 'api-a' }).usage.map(r => r.id), ['a']);
});

test('resource filters exclude unattributed requests; request facets preserve historical evidence', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...fleet.usage[0], served: null };
  fleet.usage = [record];
  assert.equal(filterFleet(fleet, { host: 'host-1' }).usage.length, 0);
  assert.equal(filterFleet(fleet, { project: record.project }).usage.length, 1);
  fleet.usage = [{ ...record, served: { model: record.requested_model, node: 'retired', seat: 'retired/seat', account: 'old' } }];
  const filtered = filterFleet(fleet, { repository: record.metadata.repository });
  assert.equal(filtered.usage.length, 1);
  assert(requestVertices(filtered.usage[0], buildGraph(filtered)).has('node:retired'));
});

test('composable selection intersects whole requests and can explicitly union them', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const a = { ...fleet.usage[1], id: 'a', project: 'research', metadata: { repository: 'a' } };
  const b = { ...a, id: 'b', project: 'product', metadata: { repository: 'b' } };
  fleet.usage = [a,b];
  const graph = buildGraph(fleet, { context: true });
  assert.deepEqual(matchingRequests(['project:research','repository:a'],fleet.usage,graph).map(r=>r.id),['a']);
  assert.equal(matchingRequests(['project:research','repository:b'],fleet.usage,graph).length,0);
  assert.equal(matchingRequests(['project:research','repository:b'],fleet.usage,graph,'any').length,2);
});
test('optional metadata dimensions emerge without a type registry entry', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const a = { ...fleet.usage[1], metadata: { workflow: 'review', 'dna.attempt_id': 'a-41' } };
  const graph = buildGraph({ ...fleet, usage: [a] }, { context: true });
  assert(graphKinds(graph).includes('context:dna.attempt_id'));
  assert(requestVertices(a,graph).has('context:workflow:review'));
  const bare = buildGraph({ ...fleet, usage: [{ ...a, metadata: {} }] }, { context: true });
  assert(!bare.vertices.some(v => v.kind.startsWith('context:') || v.kind === 'repository'));
});
test('execution ends at the served model, through its account, while requested model remains context', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...fleet.usage[1], served: { ...fleet.usage[1].served, model: 'provider-specific-model' } };
  const graph = buildGraph({ ...fleet, usage: [record], contexts: { [record.id]: { apiInstance: 'api-1' } } });
  const flow = graph.edges.filter(e => requestFlowEdges(record,graph).has(e.id));
  assert.equal(flow.length,5);
  assert(flow.some(e => e.source === `account:${record.served.account}` && e.target === 'model:provider-specific-model'));
  assert(!flow.some(e => e.source.startsWith('model:')));
  assert(requestVertices(record,graph).has(`model:${record.requested_model}`));
  const refused = { ...record, served: null };
  assert.equal(requestFlowEdges(refused,buildGraph({ ...fleet, usage: [refused] })).size,0);
});


test('directed force layout spreads execution toward models across the available canvas', () => {
  const graph = buildGraph(demoFleet(0, 1_800_000_000_000));
  for (const width of [1040, 1580]) {
    const points = layoutGraph(graph, width, 900);
    // a pair's bond and cable join one layer to itself, by design
    for (const edge of graph.edges.filter(e => (e.flow || e.kind === 'hosts' || e.kind === 'offers') && e.kind !== 'bond' && e.kind !== 'cable')) {
      assert(points.get(edge.target).x - points.get(edge.source).x > 65, `Execution reverses at ${edge.id}`);
    }
    const xs = [...points.values()].map(p => p.x);
    const ys = [...points.values()].map(p => p.y);
    assert(Math.max(...xs)-Math.min(...xs) > width*.7, 'Network collapsed horizontally');
    assert(Math.max(...ys)-Math.min(...ys) > 900*.7, 'Network collapsed vertically');
    const labels = graph.vertices.filter(v => v.kind !== 'seat');
    for (let i=0; i<labels.length; i++) for (let j=i+1; j<labels.length; j++) {
      const a = points.get(labels[i].id), b = points.get(labels[j].id);
      assert(Math.abs(a.x-b.x)>145 || Math.abs(a.y-b.y)>(labels[i].kind === 'model' && labels[j].kind === 'model' ? 29 : 60), `Overlapping labels: ${labels[i].id}, ${labels[j].id}`);
    }
  }
});
test('resizing existing positions uses the enlarged canvas instead of keeping the old knot', () => {
  const graph = buildGraph(demoFleet(0, 1_800_000_000_000));
  const initial = layoutGraph(graph,1040,610);
  const resized = resizeLayout(initial,{x:1040,y:610},{x:1580,y:900});
  const actual = layoutGraph(graph,1580,900,new Map(),resized);
  const fresh = layoutGraph(graph,1580,900);
  const displacement = [...fresh].reduce((sum,[id,p]) => sum+Math.hypot(actual.get(id).x-p.x,actual.get(id).y-p.y),0)/fresh.size;
  assert(displacement < 25, `Resizing retained stale positions: ${displacement}px`);
  assert([...actual.values()].some(p => p.x>1350));
});
test('missing optional stages leave a directed and usable execution layout', () => {
  const fleet = demoFleet(0,1_800_000_000_000);
  const graph = buildGraph({...fleet, projects:[], accounts:[], usage:[], contexts:undefined});
  const points = layoutGraph(graph,1040,700);
  assert(!graph.vertices.some(v => v.kind === 'project' || v.kind === 'api' || v.kind === 'repository'));
  for (const edge of graph.edges.filter(e => e.kind !== 'bond' && e.kind !== 'cable')) assert(points.get(edge.target).x > points.get(edge.source).x);
});


test('simulated work never exceeds three distinct projects and occupancy matches their routes', () => {
  let peak = 0;
  const projects = new Set(), accounts = new Set(), models = new Set();
  for (let tick = 0; tick < 240; tick++) {
    const fleet = demoFleet(tick, 1_800_000_000_000);
    const jobs = demoInFlight(fleet,tick,1_800_000_000_000);
    assert(jobs.length <= 3);
    assert.equal(new Set(jobs.map(j => j.record.project)).size,jobs.length);
    assert.equal(fleet.nodes.reduce((sum,n) => sum+n.in_flight,0),jobs.length);
    for (const node of fleet.nodes) for (const seat of node.seats) {
      assert.equal(seat.in_flight,jobs.filter(j => j.record.served.seat === seat.ref).length);
    }
    for (const job of jobs) { projects.add(job.record.project); accounts.add(job.record.served.account); models.add(job.record.served.model); }
    const completed = demoCompletions(fleet,tick,1_800_000_000_000);
    assert(completed.every(r => !jobs.some(j => j.record.id === r.id)));
    peak = Math.max(peak,jobs.length);
  }
  assert.equal(peak,3);
  assert.equal(projects.size,7);
  assert.deepEqual([...accounts].sort(),['agy','claude-personal','claude-work','local','openai','vibe']);
  assert.equal(models.size,23);
  assert(models.has('deepseek-v4'), 'the pair serves too');
});
test('a routed request follows one project-to-API-to-host-to-seat-to-account-to-model branch', () => {
  const fleet = demoFleet(0,1_800_000_000_000), record = fleet.usage[1];
  const graph = buildGraph({...fleet,usage:[record],contexts:{[record.id]:{apiInstance:'api-1'}}});
  const flow = graph.edges.filter(e => requestFlowEdges(record,graph).has(e.id));
  const participants = [`project:${record.project}`,'api:api-1',`node:${record.served.node}`,`seat:${record.served.seat}`,`account:${record.served.account}`,`model:${record.served.model}`];
  assert.equal(flow.length,5);
  for (let i=1;i<participants.length;i++) assert(flow.some(e=>e.source===participants[i-1] && e.target===participants[i]));
  assert(!graph.edges.some(e=>e.source.startsWith('project:') && e.target.startsWith('model:')));
});


test('the demo fleet places CLI accounts on host-2/host-4 and MLX capacity on its Mac-like hosts', () => {
  const fleet = demoFleet(0,1_800_000_000_000);
  for (const node of fleet.nodes) for (const seat of node.seats) {
    if (seat.account !== 'local') assert(['host-4','host-2'].includes(node.id));
    if (['host-4','host-2'].includes(node.id) && seat.account === 'local') assert(seat.serves.every(s => ['llama-3b','llama-8b','qwen-7b'].includes(s.model)));
    if (node.id.startsWith('gpu-')) assert.equal(seat.engine,'managed');
    else if (!['host-4','host-2'].includes(node.id)) assert.equal(seat.engine,'mlx');
  }
});

test('an alias is a label on the model it names, never a vertex; a request by it flows to that model and keeps what it was asked as', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const base = demoRequest(fleet, 1, 1_800_000_000_000);
  const target = base.served.model;
  // one name given by two projects, one of them inherited, is one label
  const projects = fleet.projects.map((p, i) => (i < 2 ? { ...p, aliases: i === 0 ? [{ name: 'coding', model: target }] : [], resolved_aliases: [{ name: 'coding', model: target, from: fleet.projects[0].id }, ...(i === 0 ? [{ name: 'general', model: target, from: p.id }] : [])] } : p));
  const project = projects[0].id;
  const configured = buildGraph({ ...fleet, projects, usage: [] });
  assert(!configured.vertices.some((v) => v.kind === 'alias'), 'no alias vertices');
  assert(!configured.edges.some((e) => e.kind === 'names' || e.kind === 'resolves'));
  const m = configured.vertices.find((v) => v.id === entityId('model', target));
  assert.deepEqual(m.aliases, ['coding', 'general']);
  const by = m.details.find(([k]) => k === 'Aliases')?.[1] ?? '';
  assert(by.includes(`${projects[0].id}: coding`) && by.includes(`${projects[1].id}: coding`) && by.includes(`${projects[0].id}: general`), by);
  assert(!configured.vertices.some((v) => v.kind === 'model' && v.name === 'coding'), 'an alias is never a model');

  const record = { ...base, project, requested_model: 'coding', resolved_model: target };
  const graph = buildGraph({ ...fleet, projects, usage: [record] });
  const path = graph.requests.get(record.id);
  assert.equal(path.askedAs, 'coding');
  const vs = requestVertices(record, graph);
  for (const id of [entityId('project', project), entityId('node', record.served.node), entityId('seat', record.served.seat), entityId('account', record.served.account), entityId('model', target)]) assert(vs.has(id), id);
  assert(!graph.vertices.some((v) => v.id === entityId('model', 'coding')));

  // a record from before voice kept what an alias named reads the project's aliases now
  const { resolved_model: _, ...legacy } = record;
  const old = buildGraph({ ...fleet, projects, usage: [legacy] });
  assert.equal(old.requests.get(legacy.id).askedAs, 'coding');
  assert(requestVertices(legacy, old).has(entityId('model', target)));
  // a model named itself was asked as no alias
  const direct = { ...base, project, requested_model: target, resolved_model: target };
  assert.equal(buildGraph({ ...fleet, projects, usage: [direct] }).requests.get(direct.id).askedAs, undefined);
});

test('the standing topology is drawn without traffic, faint: projects to the api, the api to every host', () => {
  const fleet = { ...demoFleet(0, 1_800_000_000_000), usage: [], instances: [{ id: 'api-1', at: '2026-11-01T00:00:00Z', up: true }] };
  const graph = buildGraph(fleet);
  const api = entityId('api', 'api-1');
  for (const n of fleet.nodes) assert(graph.edges.some((e) => e.id === edgeId(api, entityId('node', n.id)) && e.kind === 'standing' && !e.flow), `api → ${n.id}`);
  for (const p of fleet.projects) assert(graph.edges.some((e) => e.id === edgeId(entityId('project', p.id), api) && e.kind === 'standing'), `${p.id} → api`);
  assert(!graph.edges.some((e) => e.kind === 'observed' || e.flow), 'nothing flows with no usage');
});

test("a request's flow edges are traffic, never standing links", () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...demoRequest(fleet, 1, 1_800_000_000_000), instance: 'api-1' };
  const graph = buildGraph({ ...fleet, usage: [record], instances: [{ id: 'api-1', at: '2026-11-01T00:00:00Z', up: true }] });
  const flow = requestFlowEdges(record, graph);
  const api = entityId('api', 'api-1');
  assert(flow.has(edgeId(entityId('project', record.project), api)));
  assert(flow.has(edgeId(api, entityId('node', record.served.node))));
  for (const id of flow) assert.notEqual(graph.edges.find((e) => e.id === id).kind, 'standing', id);
  // another host the api reaches stays a standing link
  const other = fleet.nodes.find((n) => n.id !== record.served.node);
  if (other) assert.equal(graph.edges.find((e) => e.id === edgeId(api, entityId('node', other.id))).kind, 'standing');
});

test('a request draws its conversation, keyed by its prompt_cache_key whatever the client, and metadata stays a label', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...demoRequest(fleet, 1, 1_800_000_000_000), id: 'turn', conversation: 'b909ae4b', metadata: { team: 'search' } };
  const graph = buildGraph({ ...fleet, usage: [record] }, { context: true });
  const c = graph.vertices.find((v) => v.id === entityId('context:conversation', 'b909ae4b'));
  assert(c, 'the conversation is a context node');
  assert.equal(c.href, '#/usage/c/b909ae4b');
  assert(graph.edges.some((e) => e.id === edgeId(entityId('project', record.project), c.id)));
  assert(graph.vertices.some((v) => v.id === entityId('context:team', 'search')), 'a metadata pair is still a label');
  const none = buildGraph({ ...fleet, usage: [{ ...record, conversation: null }] }, { context: true });
  assert(!none.vertices.some((v) => v.kind === 'context:conversation'), 'none without a conversation');
});

test("voice's own request for a project is drawn apart: project → its system key → model, dotted, never through the project's flow", () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const base = demoRequest(fleet, 1, 1_800_000_000_000);
  const record = { ...base, id: 'resp_internal', key: `${base.project}-system`, internal: true, requested_model: 'decide', served: { ...base.served, model: 'jev-2b' }, metadata: { annotates: base.id, side: 'request' } };
  const graph = buildGraph({ ...fleet, usage: [record] });
  const key = entityId('system', `${base.project}-system`);
  assert(graph.vertices.some((v) => v.id === key && v.kind === 'system'));
  const edges = requestEdges(record, graph);
  assert(edges.has(edgeId(entityId('project', base.project), key)));
  assert(edges.has(edgeId(key, entityId('model', 'jev-2b'))));
  assert.equal(requestFlowEdges(record, graph).size, 0, 'no flow: it never inflates the project');
  assert(!graph.edges.some((e) => e.target === entityId('seat', base.served.seat) && e.flow), 'and it lights no seat');
});

test('by default a project is the source of its requests: no conversation, repository or metadata node, and the project joined to the api that admitted it', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...demoRequest(fleet, 1, 1_800_000_000_000), id: 'turn', conversation: 'b909ae4b', metadata: { repository: 'repo-a', team: 'search', 'codex.session_id': '463f08e1' } };
  const graph = buildGraph({ ...fleet, usage: [record], contexts: { turn: { apiInstance: 'api-1' } } });
  assert(!graph.vertices.some((v) => v.kind === 'repository' || v.kind.startsWith('context:')), 'no request context by default');
  const flow = requestFlowEdges(record, graph);
  assert(flow.has(edgeId(entityId('project', record.project), entityId('api', 'api-1'))), 'project → api, a flow edge');
  assert(flow.has(edgeId(entityId('api', 'api-1'), entityId('node', record.served.node))), 'api → host');
  assert(!flow.has(edgeId(entityId('project', record.project), entityId('node', record.served.node))), 'never around the api when it is known');
});

test('a request whose record names no api instance still flows from its project, straight to its host', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const record = { ...demoRequest(fleet, 1, 1_800_000_000_000), id: 'old', metadata: {} };
  delete record.instance;
  const graph = buildGraph({ ...fleet, usage: [record] });
  assert(!requestVertices(record, graph).has('api:undefined'));
  assert(requestFlowEdges(record, graph).has(edgeId(entityId('project', record.project), entityId('node', record.served.node))), 'project → host, so the project is never apart from its flow');
});

// A model placed across host-a (leader) and host-b, cabled; a model of its
// own beside it on host-a; another alone on host-c.
const AT = '2026-11-01T00:00:00Z';
const labSeat = (node, id, extra = {}) => ({ id, ref: `${node}/${id}`, node, engine: 'managed', account: 'local', serves: [{ model: id }], status: 'up', in_flight: 0, concurrency: 4, enabled: true, problems: [], reason: null, placement: id, runtime: 'tensorfold-0.7.5', ...extra });
const labNode = (id, seats) => ({ id, name: id, status: 'up', seats, in_flight: seats.reduce((n, s) => n + s.in_flight, 0), created_at: AT });
const placed = (id, nodes) => ({ id, model: id, nodes, account: 'local', recipe: id, variant: 'v', runtime: 'tensorfold-0.7.5', chosen_by: 'coordinator', leader: nodes[0], seat: `${nodes[0]}/${id}`, ...(nodes[1] ? { follower_seat: `${nodes[1]}/${id}` } : {}), fit: [], created_at: AT });
function lab({ leaderInFlight = 0, follower = {}, pairs = [['big-model', 'host-a', 'host-b']] } = {}) {
  const seats = new Map([['host-a', [labSeat('host-a', 'small-model')]], ['host-c', [labSeat('host-c', 'mid-model')]]]);
  for (const [id, a, b] of pairs) {
    seats.set(a, [labSeat(a, id, { in_flight: leaderInFlight }), ...(seats.get(a) ?? [])]);
    seats.set(b, [...(seats.get(b) ?? []), labSeat(b, id, follower)]);
  }
  return {
    nodes: [...seats].map(([id, s]) => labNode(id, s)),
    accounts: [{ id: 'local', name: 'local', provider: null, billing: 'none', status: 'active', seats: [], windows: [], created_at: AT }],
    projects: [{ id: 'work', name: 'work', status: 'active', owners: [], data_classes: ['internal'], created_at: AT, aliases: [{ name: 'big', model: 'big-model' }], resolved_aliases: [{ name: 'big', model: 'big-model', from: 'work' }] }],
    placements: [...pairs.map(([id, a, b]) => placed(id, [a, b])), placed('small-model', ['host-a']), placed('mid-model', ['host-c'])],
    usage: [],
    instances: [{ id: 'api-1', at: AT, up: true }],
  };
}
const served = (id, seat, extra = {}) => ({ id, created_at: AT, project: 'work', key: 'k1', requested_model: seat.split('/')[1], resolved_model: seat.split('/')[1], status: 'served', served: { seat, node: seat.split('/')[0], account: 'local', model: seat.split('/')[1], engine: 'managed' }, input_tokens: 10, output_tokens: 5, price_micros: 0, currency: 'USD', timing: { wall_ms: 900, queue_ms: 0, load_ms: 0 }, instance: 'api-1', ...extra });
const LEADER = entityId('seat', 'host-a/big-model'), FOLLOWER = entityId('seat', 'host-b/big-model');

test('a placement across two hosts is one unit: its seats bonded, its hosts cabled, and the follower offers nothing of its own', () => {
  const graph = buildGraph(lab());
  const bond = graph.edges.find((e) => e.id === edgeId(LEADER, FOLLOWER));
  assert.equal(bond?.kind, 'bond');
  assert.equal(graph.edges.find((e) => e.id === edgeId(entityId('node', 'host-a'), entityId('node', 'host-b')))?.kind, 'cable');
  // the follower reaches its model only through the bond: its host's link and the bond, nothing else
  assert.deepEqual(graph.edges.filter((e) => e.source === FOLLOWER || e.target === FOLLOWER).map((e) => e.kind).sort(), ['bond', 'hosts']);
  assert(graph.edges.some((e) => e.id === edgeId(entityId('account', 'local'), entityId('model', 'big-model')) && e.kind === 'offers'), 'the leader offers it');
  const [pair] = graph.pairs;
  assert.equal(graph.pairs.length, 1);
  assert.deepEqual({ id: pair.id, leader: pair.leader, follower: pair.follower, hosts: pair.hosts, state: pair.state }, { id: 'big-model', leader: LEADER, follower: FOLLOWER, hosts: ['node:host-a', 'node:host-b'], state: 'up' });
  const leader = graph.vertices.find((v) => v.id === LEADER), follower = graph.vertices.find((v) => v.id === FOLLOWER);
  assert.deepEqual(leader.part, { placement: 'big-model', role: 'leader', partner: FOLLOWER });
  assert.deepEqual(follower.part, { placement: 'big-model', role: 'follower', partner: LEADER });
  const detail = (v, k) => v.details.find(([name]) => name === k)?.[1];
  assert.equal(detail(leader, 'Partner seat'), 'host-b/big-model');
  assert.equal(detail(leader, 'Runtime'), 'tensorfold-0.7.5');
  assert.match(detail(leader, 'Placement'), /big-model across host-a \+ host-b/);
  assert.match(detail(follower, 'Role'), /serves through its leader, host-a\/big-model/);
  assert.equal(detail(follower, 'Partner seat'), 'host-a/big-model');
  // the follower's seat is no capacity of its host's own
  assert.equal(detail(graph.vertices.find((v) => v.id === 'node:host-b'), 'In flight / capacity'), '0 / 0');
  assert.equal(detail(graph.vertices.find((v) => v.id === 'node:host-a'), 'In flight / capacity'), '0 / 8');
  assert.deepEqual(pairsOf([FOLLOWER], graph).map((p) => p.id), ['big-model'], 'either seat names the whole placement');
  assert.deepEqual(pairsOf([pair.bond], graph).map((p) => p.id), ['big-model'], 'and so does its bond');
});

test("a request to the leader is computed by both hosts: its path holds the follower's seat and host, the bond and the cable", () => {
  const fleet = lab();
  const record = served('r1', 'host-a/big-model');
  const alone = served('r2', 'host-a/small-model');
  const graph = buildGraph({ ...fleet, usage: [record, alone] });
  const vs = requestVertices(record, graph);
  for (const id of ['node:host-a', 'node:host-b', LEADER, FOLLOWER, 'account:local', 'model:big-model', 'api:api-1', 'project:work']) assert(vs.has(id), id);
  const flow = requestFlowEdges(record, graph);
  for (const id of [edgeId(LEADER, FOLLOWER), edgeId('node:host-a', 'node:host-b'), edgeId('node:host-b', FOLLOWER), edgeId('node:host-a', LEADER)]) assert(flow.has(id), id);
  assert.equal(graph.edges.find((e) => e.id === edgeId(LEADER, FOLLOWER)).kind, 'bond', 'lit, it stays a bond');
  // a model of its own on the same host lights neither the follower nor the bond
  const own = requestVertices(alone, graph);
  assert(!own.has('node:host-b') && !own.has(FOLLOWER));
  assert(!requestFlowEdges(alone, graph).has(edgeId(LEADER, FOLLOWER)));
});

test("a follower's host and seat are active while its leader's seat works, its own numbers its own", () => {
  const graph = buildGraph(lab({ leaderInFlight: 2 }));
  const followerHost = graph.vertices.find((v) => v.id === 'node:host-b'), follower = graph.vertices.find((v) => v.id === FOLLOWER);
  assert.equal(followerHost.active, 0, 'the follower node reports none of its own');
  assert.equal(followerHost.partnerActive, 2);
  assert.equal(follower.active, 0);
  assert.equal(follower.partnerActive, 2);
  assert.equal(graph.pairs[0].active, 2);
  assert.equal(graph.vertices.find((v) => v.id === 'node:host-c').partnerActive, undefined, 'a host with no follower derives nothing');
});

test('a placement on one node is drawn as it was: no bond, no cable, its own offer', () => {
  const fleet = lab({ pairs: [] });
  const graph = buildGraph(fleet);
  assert(!graph.edges.some((e) => e.kind === 'bond' || e.kind === 'cable'));
  assert.equal(graph.pairs.length, 0);
  assert.deepEqual(graph.edges, buildGraph({ ...fleet, placements: [] }).edges, 'its placement changes no edge');
  const seat = graph.vertices.find((v) => v.id === 'seat:host-c/mid-model');
  assert.equal(seat.part, undefined);
  assert.equal(seat.placement, 'mid-model');
});

test("a follower down while its leader is up marks the pair down, with the follower's reason", () => {
  const graph = buildGraph(lab({ follower: { status: 'down', reason: 'tensorfold exited: NCCL timeout' } }));
  const [pair] = graph.pairs;
  assert.equal(pair.state, 'down');
  assert.match(pair.reason, /host-b\/big-model is down: tensorfold exited: NCCL timeout/);
  assert(graph.edges.some((e) => e.id === pair.bond), 'the bond stays, to show it');
  const starting = buildGraph(lab({ follower: { status: 'starting' } })).pairs[0];
  assert.equal(starting.state, 'waiting');
});

test('a request in flight by an alias lights the model it is routed as: no phantom model, the alias kept as asked', () => {
  const fleet = lab();
  const flight = { id: 'f1', project: 'work', key: 'k1', requested_model: 'big', resolved_model: 'big-model', seat: 'host-a/big-model', account: 'local', started_at: AT, instance: 'api-1', conversation: null };
  const before = buildGraph(fleet);
  const graph = buildGraph({ ...fleet, usage: [provisional(flight)] });
  assert(!graph.vertices.some((v) => v.id === 'model:big'), 'no model named after the alias');
  assert.equal(graph.requests.get('f1').askedAs, 'big');
  const vs = requestVertices(provisional(flight), graph);
  assert(vs.has('model:big-model') && vs.has(FOLLOWER) && vs.has('node:host-b'));
  assert.equal(topologyKey(graph), topologyKey(before), 'and the map does not move');
  // an api from before `resolved_model` told the routed model as `requested_model`
  const { resolved_model: _, ...legacy } = { ...flight, requested_model: 'big-model' };
  const old = buildGraph({ ...fleet, usage: [provisional(legacy)] });
  assert(!old.vertices.some((v) => v.id === 'model:big'));
  assert(requestVertices(provisional(legacy), old).has('model:big-model'));
});

test('a request starting, running or ending never re-runs the layout; a new host does', () => {
  const fleet = lab();
  const flight = { id: 'f1', project: 'work', key: 'k1', requested_model: 'big-model', resolved_model: 'big-model', seat: 'host-a/big-model', account: 'local', started_at: AT, instance: 'api-1', conversation: null };
  const idle = buildGraph(fleet);
  const running = buildGraph({ ...fleet, usage: [provisional(flight)] });
  const done = buildGraph({ ...fleet, usage: [served('f1', 'host-a/big-model')] });
  assert(running.edges.some((e) => e.flow), 'the request flows');
  assert.equal(topologyKey(running), topologyKey(idle));
  assert.equal(topologyKey(done), topologyKey(idle));
  assert.deepEqual(layoutGraph(running, 1040, 740), layoutGraph(idle, 1040, 740), 'its flow never moves the map');
  const grown = { ...fleet, nodes: [...fleet.nodes, labNode('host-d', [labSeat('host-d', 'tiny')])] };
  assert.notEqual(topologyKey(buildGraph(grown)), topologyKey(idle));
  // the demo's traffic, tick by tick: work starting and ending, the key fixed
  const seed = demoFleet(0, 1_800_000_000_000);
  const keys = new Set();
  for (let tick = 0; tick < 40; tick++) {
    const now = 1_800_000_000_000 + tick * 1800;
    const f = demoFleet(tick, now);
    keys.add(topologyKey(buildGraph({ ...f, usage: [...seed.usage, ...demoInFlight(f, tick, now).map((j) => j.record), ...demoCompletions(f, tick, now)] })));
  }
  assert.equal(keys.size, 1);
});

test("a pair's hosts sit side by side and its seats face each other, beside other seats and other pairs", () => {
  const fleet = lab({ pairs: [['big-model', 'host-a', 'host-b'], ['chat-model', 'host-c', 'host-d']] });
  const graph = buildGraph(fleet);
  assert.equal(graph.pairs.length, 2);
  for (const height of [740, 900]) {
    const points = layoutGraph(graph, 1040, height);
    const between = (kind, a, b) => graph.vertices.filter((v) => v.kind === kind && v.id !== a && v.id !== b).some((v) => { const y = points.get(v.id).y; return y > Math.min(points.get(a).y, points.get(b).y) && y < Math.max(points.get(a).y, points.get(b).y); });
    for (const p of graph.pairs) {
      assert(!between('node', ...p.hosts), `${p.id}: no host between its hosts`);
      assert(!between('seat', p.leader, p.follower), `${p.id}: no seat between its seats`);
      assert(Math.abs(points.get(p.leader).y - points.get(p.follower).y) < 120, `${p.id}: its bond is short`);
      const hull = hullOf([...p.hosts, p.leader, p.follower].map((id) => points.get(id)), 30);
      assert(hull.path.startsWith('M') && Number.isFinite(hull.centre.y) && hull.bottom.y > hull.centre.y);
    }
  }
});

test('a filter that keeps one seat of a pair keeps its partner, so the pair stays one unit', () => {
  const fleet = lab({ leaderInFlight: 1 });
  const kept = filterFleet(fleet, { activity: 'in flight' });
  assert.deepEqual(kept.nodes.flatMap((n) => n.seats.map((s) => s.ref)).sort(), ['host-a/big-model', 'host-b/big-model']);
  assert.equal(buildGraph(kept).pairs.length, 1);
});

// A redeploy: api-old admitted the earlier requests and stopped beating;
// api-new beats now.
const redeployed = (instances = [{ id: 'api-old', at: AT, up: false }, { id: 'api-new', at: AT, up: true }]) => ({
  ...lab(),
  instances,
  usage: [served('before', 'host-c/mid-model', { instance: 'api-old' }), served('after', 'host-c/mid-model', { instance: 'api-new' })],
});
const OLD = entityId('api', 'api-old'), NEW = entityId('api', 'api-new');

test('by default the map shows only the live api instance; a request a retired one admitted flows project → host, and still names it', () => {
  const fleet = redeployed();
  const graph = buildGraph(fleet);
  assert.deepEqual(graph.vertices.filter((v) => v.kind === 'api').map((v) => v.id), [NEW], 'one api vertex');
  const before = fleet.usage[0], project = entityId('project', 'work'), host = entityId('node', 'host-c');
  const flow = requestFlowEdges(before, graph);
  assert(flow.has(edgeId(project, host)), 'project → host, as a record predating instance ids');
  assert(!flow.has(edgeId(project, NEW)) && !flow.has(edgeId(NEW, host)), 'never reattributed to the live instance');
  assert(!requestVertices(before, graph).has(NEW));
  const path = graph.requests.get('before');
  assert.equal(path.context.apiInstance, 'api-old', 'its trace names the instance that admitted it');
  assert.equal(path.retired, true);
  // the live instance's request flows through it, and its standing links reach every host
  assert(requestFlowEdges(fleet.usage[1], graph).has(edgeId(project, NEW)));
  assert.equal(graph.requests.get('after').retired, undefined);
  // the hub not yet heard: no instance is taken for retired
  assert.equal(liveInstances({ ...fleet, instances: undefined }), undefined);
  assert(buildGraph({ ...fleet, instances: undefined }).vertices.some((v) => v.id === OLD));
});

test('asked for, a retired api instance is drawn faint with the requests it admitted, as recorded; the live one stays', () => {
  const fleet = redeployed();
  const graph = buildGraph(fleet, { retired: true });
  const apis = new Map(graph.vertices.filter((v) => v.kind === 'api').map((v) => [v.id, v.state]));
  assert.deepEqual([...apis.keys()].sort(), [NEW, OLD]);
  assert.equal(apis.get(OLD), RETIRED);
  assert.equal(apis.get(NEW), 'up');
  const project = entityId('project', 'work'), host = entityId('node', 'host-c');
  const flow = requestFlowEdges(fleet.usage[0], graph);
  assert(flow.has(edgeId(project, OLD)) && flow.has(edgeId(OLD, host)), 'project → retired instance → host');
  assert(!flow.has(edgeId(project, host)));
  // a retired instance reaches nothing now: no standing links of its own
  assert(!graph.edges.some((e) => e.kind === 'standing' && (e.source === OLD || e.target === OLD)));
  assert(graph.edges.some((e) => e.kind === 'standing' && (e.source === NEW || e.target === NEW)));
});

test('a redeploy changes the api layer once; retired instances and their records never move the map while hidden', () => {
  // before: api-old beats and admitted a request
  const before = buildGraph({ ...lab(), instances: [{ id: 'api-old', at: AT, up: true }], usage: [served('r1', 'host-c/mid-model', { instance: 'api-old' })] });
  // after: api-old retired, api-new beats; more records, and an instance retired long ago
  const after = (usage, instances) => buildGraph({ ...lab(), instances, usage });
  const live = [{ id: 'api-new', at: AT, up: true }];
  const a = after([served('r1', 'host-c/mid-model', { instance: 'api-old' })], [{ id: 'api-old', at: AT, up: false }, ...live]);
  const b = after([served('r1', 'host-c/mid-model', { instance: 'api-old' }), served('r0', 'host-a/small-model', { instance: 'api-older' })], live);
  const c = after([], live);
  assert.notEqual(topologyKey(a), topologyKey(before), 'the api layer changed');
  const swap = (key) => key.replaceAll('api-old', 'api-new');
  assert.equal(topologyKey(a), swap(topologyKey(before)), 'and only it: the old instance swapped for the new');
  assert.equal(topologyKey(b), topologyKey(a), 'retired instances and their records come and go, the key fixed');
  assert.equal(topologyKey(c), topologyKey(a));
});

test('a request in flight on an instance that has just stopped beating keeps it live and drawn', () => {
  const flight = { id: 'f1', project: 'work', key: 'k1', requested_model: 'mid-model', resolved_model: 'mid-model', seat: 'host-c/mid-model', account: 'local', started_at: AT, instance: 'api-old', conversation: null };
  const fleet = { ...redeployed(), usage: [provisional(flight), served('before', 'host-c/mid-model', { instance: 'api-old' })], inFlight: ['f1'] };
  assert.deepEqual([...liveInstances(fleet)].sort(), ['api-new', 'api-old']);
  const graph = buildGraph(fleet);
  const old = graph.vertices.find((v) => v.id === OLD);
  assert.equal(old?.state, 'up', 'live while it serves');
  assert(requestFlowEdges(provisional(flight), graph).has(edgeId(entityId('project', 'work'), OLD)));
  assert.equal(graph.requests.get('before').retired, undefined, 'its records too, while it is live');
  // settled: it retires, and is drawn no more
  assert(!buildGraph({ ...fleet, inFlight: [] }).vertices.some((v) => v.id === OLD));
});

test("the demo fleet has a retired api instance, its oldest records' admitter, shown only when asked for", () => {
  const fleet = { ...demoFleet(0, 1_800_000_000_000), instances: demoInstances(1_800_000_000_000) };
  const contexts = Object.fromEntries(fleet.usage.map((r) => [r.id, demoContext(r)]));
  const apis = (g) => g.vertices.filter((v) => v.kind === 'api').map((v) => v.id).sort();
  assert.deepEqual(apis(buildGraph({ ...fleet, contexts })), ['api:api-1', 'api:api-2']);
  const shown = buildGraph({ ...fleet, contexts }, { retired: true });
  assert.deepEqual(apis(shown), ['api:api-0', 'api:api-1', 'api:api-2']);
  assert.equal(shown.vertices.find((v) => v.id === 'api:api-0').state, RETIRED);
  assert(fleet.usage.some((r) => shown.requests.get(r.id)?.retired));
});
