import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV, PLACES, href, railOf, resolve } from './nav.ts';

/** What a hash opens, as route.ts reads it: the screen's parts, the query, and where it moved to, if it did. */
function open(hash) {
  const [path = '', q = ''] = hash.replace(/^#\/?/, '').split('?');
  const r = resolve(path.split('/').filter(Boolean).map(decodeURIComponent), new URLSearchParams(q));
  return { parts: r.parts, query: r.query.toString(), redirect: r.redirect ?? null };
}

test('every screen has a route of its own, which opens it with its item', () => {
  const table = {
    '': '#/',
    models: '#/models/catalogue',
    placements: '#/models/placements',
    nodes: '#/models/nodes',
    recipes: '#/models/recipes',
    runtimes: '#/models/runtimes',
    accounts: '#/models/accounts',
    routes: '#/models/routes',
    requests: '#/models/requests',
    network: '#/models/live',
    projects: '#/projects',
    chat: '#/conversations/chat',
    conversations: '#/conversations/history',
    annotators: '#/harness/annotators',
    tools: '#/harness/tools',
    attempts: '#/harness/attempts',
    changes: '#/changes',
    api: '#/api',
  };
  assert.deepEqual(Object.keys(PLACES).sort(), Object.keys(table).sort());
  for (const [screen, hash] of Object.entries(table)) {
    assert.equal(href(screen), hash, screen);
    assert.deepEqual(open(hash), { parts: screen ? [screen] : [], query: '', redirect: null }, hash);
    if (!screen) continue;
    // an item, and an id holding a slash
    assert.equal(href(screen, 'a/b', 'x'), `${hash}/a%2Fb/x`);
    assert.deepEqual(open(`${hash}/a%2Fb/x?q=1`), { parts: [screen, 'a/b', 'x'], query: 'q=1', redirect: null });
  }
  assert.equal(href(), '#/');
});

test('the deep links the screens write open on their new routes', () => {
  const cases = [
    [['nodes', 'laptop', 'seat-1'], '#/models/nodes/laptop/seat-1'],
    [['nodes', 'new'], '#/models/nodes/new'],
    [['models', 'qwen3'], '#/models/catalogue/qwen3'],
    [['placements', 'p1'], '#/models/placements/p1'],
    [['recipes', 'gpt-oss-20b', 'q4'], '#/models/recipes/gpt-oss-20b/q4'],
    [['requests', 'resp_1'], '#/models/requests/resp_1'],
    [['conversations', 'conv 7'], '#/conversations/history/conv%207'],
    [['chat', 'c1'], '#/conversations/chat/c1'],
    [['annotators', 'rules', 'r1'], '#/harness/annotators/rules/r1'],
    [['attempts', 'a1'], '#/harness/attempts/a1'],
    [['projects', 'work'], '#/projects/work'],
    [['api', 'schema', 'Model'], '#/api/schema/Model'],
    [['changes', 'ch1'], '#/changes/ch1'],
  ];
  for (const [parts, hash] of cases) {
    assert.equal(href(...parts), hash);
    assert.deepEqual(open(hash).parts, parts, hash);
  }
});

test('every route from before the layers opens where its screen lives now, its query kept', () => {
  const moved = [
    ['#/models', '#/models/catalogue', ['models']],
    ['#/models/qwen3', '#/models/catalogue/qwen3', ['models', 'qwen3']],
    ['#/models/new', '#/models/catalogue/new', ['models', 'new']],
    ['#/network', '#/models/live', ['network']],
    ['#/nodes', '#/models/nodes', ['nodes']],
    ['#/nodes?arrange', '#/models/nodes?arrange=', ['nodes']],
    ['#/nodes/laptop', '#/models/nodes/laptop', ['nodes', 'laptop']],
    ['#/nodes/laptop/seat-1', '#/models/nodes/laptop/seat-1', ['nodes', 'laptop', 'seat-1']],
    ['#/routes', '#/models/routes', ['routes']],
    ['#/accounts/paid', '#/models/accounts/paid', ['accounts', 'paid']],
    ['#/placements/p%2F1', '#/models/placements/p%2F1', ['placements', 'p/1']],
    ['#/recipes/gpt-oss-20b/q4?on=spark', '#/models/recipes/gpt-oss-20b/q4?on=spark', ['recipes', 'gpt-oss-20b', 'q4']],
    ['#/runtimes/llama', '#/models/runtimes/llama', ['runtimes', 'llama']],
    ['#/chat', '#/conversations/chat', ['chat']],
    ['#/chat/c1', '#/conversations/chat/c1', ['chat', 'c1']],
    ['#/annotators/rules/r1', '#/harness/annotators/rules/r1', ['annotators', 'rules', 'r1']],
    ['#/tools', '#/harness/tools', ['tools']],
    ['#/attempts/a1', '#/harness/attempts/a1', ['attempts', 'a1']],
    // Usage, by its view, or by what it opened
    ['#/usage', '#/models/requests', ['requests']],
    ['#/usage?view=requests&status=failed', '#/models/requests?status=failed', ['requests']],
    ['#/usage?view=conversations&project=work&failures=1', '#/conversations/history?project=work&failures=1', ['conversations']],
    ['#/usage/resp_1?project=work', '#/models/requests/resp_1?project=work', ['requests', 'resp_1']],
    ['#/usage/c/a%2Fb?view=conversations&model=m', '#/conversations/history/a%2Fb?model=m', ['conversations', 'a/b']],
    ['#/usage/c/conv-7?view=requests', '#/conversations/history/conv-7', ['conversations', 'conv-7']],
    // a layer's own path opens its first screen
    ['#/conversations', '#/conversations/chat', ['chat']],
    ['#/harness', '#/harness/annotators', ['annotators']],
  ];
  for (const [old, now, parts] of moved) {
    const r = open(old);
    assert.equal(r.redirect, now, old);
    assert.deepEqual(r.parts, parts, old);
    // and the route moved to is one of its own
    assert.deepEqual(open(now).parts, parts, now);
    assert.equal(open(now).redirect, null, now);
  }
});

test('the routes that kept their place stay, and an unknown one is left as it is', () => {
  for (const hash of ['#/', '#/projects', '#/projects/work', '#/changes/ch1', '#/api/op/listModels']) assert.equal(open(hash).redirect, null, hash);
  assert.deepEqual(open('#/nowhere/x'), { parts: ['nowhere', 'x'], query: '', redirect: null });
});

test('the rail: Overview, the Models layer, Projects, Conversations, Harness, and the system links apart', () => {
  const rail = railOf('');
  assert.deepEqual(
    rail.map((g) => [g.label ?? null, !!g.apart, g.items.map((it) => it.label)]),
    [
      [null, false, ['Overview']],
      ['Models', false, ['Catalogue', 'Placements', 'Nodes', 'Recipes', 'Runtimes', 'Accounts', 'Routes', 'Requests', 'Live']],
      [null, false, ['Projects']],
      ['Conversations', false, ['Chat', 'Conversations']],
      ['Harness', false, ['Annotators', 'Tools', 'Attempts']],
      [null, true, ['Changes', 'API']],
    ],
  );
  // every screen is on the rail once
  const screens = NAV.flatMap((g) => g.items.map((it) => it.screen));
  assert.deepEqual([...screens].sort(), Object.keys(PLACES).sort());
  // each link opens its screen
  for (const it of NAV.flatMap((g) => g.items)) assert.equal(railOf('').flatMap((g) => g.items).find((x) => x.label === it.label)?.href, href(it.screen));
  // each layer's screens live under its path
  for (const g of NAV.filter((g) => g.label)) {
    const [layer] = PLACES[g.items[0].screen];
    for (const it of g.items) assert.equal(PLACES[it.screen][0], layer, it.screen);
  }
});

test('the rail marks the current screen, and only it', () => {
  for (const screen of Object.keys(PLACES)) {
    const active = railOf(screen).flatMap((g) => g.items.filter((it) => it.active).map(() => g));
    assert.equal(active.length, 1, screen);
    assert.equal(active[0].items.find((it) => it.active).href, href(screen));
  }
  assert.equal(railOf('requests').find((g) => g.items.some((it) => it.active)).label, 'Models');
  assert.equal(railOf('conversations').find((g) => g.items.some((it) => it.active)).label, 'Conversations');
  assert.equal(railOf('nowhere').flatMap((g) => g.items).filter((it) => it.active).length, 0);
});
