import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, entityId, edgeId, requestEdges, requestVertices, requestContext, relatedRequests, matchingRequests, graphKinds, requestFlowEdges, layoutGraph, resizeLayout } from './network-model.ts';
import { demoFleet, demoRequest, demoInFlight, demoCompletions } from './network-demo.ts';

test('graph relationships come from configuration or usage, never all-to-all guesses', () => {
  const fleet = demoFleet(0, 1_800_000_000_000);
  const graph = buildGraph(fleet);
  const model = entityId('model', 'sonnet');
  const account = entityId('account', fleet.nodes.find(n => n.id === 'h1').seats.find(s => s.ref === 'h1/seat-1').account);
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
  const result = filterFleet(fleet, { host: 'h1', engine: 'claude-cli', account: 'claude-work' });
  assert.deepEqual(result.nodes.map(n => n.id), ['h1']);
  assert.deepEqual(result.accounts.map(a => a.id), ['claude-work']);
  assert(result.usage.every(r => !r.served || r.served.node === 'h1'));
  assert.equal(filterFleet(fleet, { host: 'h1', engine: 'mlx' }).nodes.length, 0);
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
  const pins = new Map([['project:research', { x: 250, y: 200 }], ['node:h1', { x: -100, y: 900 }]]);
  const dragged = layoutGraph(graph, 940, 740, pins);
  assert.deepEqual(dragged.get('project:research'), { x: 250, y: 200 });
  assert.deepEqual(dragged.get('node:h1'), { x: 65, y: 675 });
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
  assert.equal(filterFleet(fleet, { host: 'studio1' }).usage.length, 0);
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
    for (const edge of graph.edges.filter(e => e.flow || e.kind === 'hosts' || e.kind === 'offers')) {
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
  for (const edge of graph.edges) assert(points.get(edge.target).x > points.get(edge.source).x);
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
  assert.equal(models.size,24);
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


test('homelab demo places CLI accounts on h1/h2 and MLX capacity on Macs', () => {
  const fleet = demoFleet(0,1_800_000_000_000);
  for (const node of fleet.nodes) for (const seat of node.seats) {
    if (seat.account !== 'local') assert(['h1','h2'].includes(node.id));
    if (['h1','h2'].includes(node.id) && seat.account === 'local') assert(seat.serves.every(s => ['llama-3b','llama-8b','qwen-7b'].includes(s.model)));
    if (!['h1','h2'].includes(node.id)) assert.equal(seat.engine,'mlx');
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
