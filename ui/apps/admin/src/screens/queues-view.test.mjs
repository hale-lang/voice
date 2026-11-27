import test from 'node:test';
import assert from 'node:assert/strict';
import { ageTone, age, shortSubject, shapeLabel, modelQueues, seatPlans, liveQueues, planTime, WAIT_MS, LONG_MS } from './queues-view.ts';

const queue = (subject, model, depth, oldest, over = {}) => ({
  subject, shape: subject.split('.')[2], model, provider_account: null, data_class: model ? 'internal' : null, need: model ? 'any' : null,
  depth, oldest_age_ms: oldest, waiting_pulls: depth ? 0 : 1, ack_pending: 0, service_ms: model ? 900 : null, seats: [], ...over,
});
const boardSeat = (seat, consume, over = {}) => ({ seat, hold: null, consume, concurrency: 2, in_flight: 1, conversations_held: 2, ...over });
const board = {
  version: 1764151200500, at: '2026-11-26T10:00:00.500Z', age_ms: 800,
  models: [
    { model: 'echo-1', shape: 'm', provider_account: 'local', next: null, previous: null },
    { model: 'glm', shape: 'p', provider_account: null, next: null, previous: { shape: 'm', provider_account: 'local', since: 1764151100000 } },
  ],
  queues: [
    queue('voice.work.s.n.a', null, 1, 200),
    queue('voice.work.m.echo-1.internal.any', 'echo-1', 0, null),
    queue('voice.work.p.glm.local.internal.any', 'glm', 3, 12_000, { provider_account: 'local', seats: ['n/a'] }),
    queue('voice.work.p.glm.other.internal.any', 'glm', 1, 400, { provider_account: 'other' }),
  ],
  seats: [
    boardSeat('n/a', ['voice.work.s.n.a', 'voice.work.p.glm.local.internal.any', 'voice.work.m.echo-1.internal.any']),
    boardSeat('z/b', [], { hold: 'its node is draining' }),
  ],
};

test("a queue's oldest ticket, as a tone and as said", () => {
  assert.equal(ageTone(0, null), 'idle', 'nothing waits');
  assert.equal(ageTone(2, 100), 'ok');
  assert.equal(ageTone(2, WAIT_MS), 'wait', 'waiting a while');
  assert.equal(ageTone(2, LONG_MS), 'fail', 'waiting long');
  assert.equal(ageTone(1, null), 'ok', 'a backlog whose age is not read yet');
  assert.equal(age(850), '850 ms');
  assert.equal(age(4210), '4.2 s');
  assert.equal(age(42_000), '42 s');
  assert.equal(age(185_000), '3 min 5 s');
  assert.equal(age(null), '—');
});

test('subjects and shapes as said', () => {
  assert.equal(shortSubject('voice.work.m.echo-1.internal.any'), 'echo-1.internal.any');
  assert.equal(shortSubject('heart.zz.work.p.glm.local.internal.tools'), 'glm.local.internal.tools', 'under a grafted root too');
  assert.equal(shortSubject('voice.work.s.n.a'), 'n.a');
  assert.equal(shapeLabel(board.models[0]), 'one account (local)');
  assert.equal(shapeLabel(board.models[1]), "per account; draining its one-account queues");
  assert.equal(shapeLabel({ model: 'x', shape: 'm', provider_account: 'local', next: { shape: 'p', provider_account: null, after: 1 }, previous: null }), 'one account (local); becoming per account');
});

test("each model's partitions, the deepest backlog first, and the model's backlog", () => {
  const ms = modelQueues(board);
  assert.deepEqual(ms.map((m) => m.model), ['glm', 'echo-1'], 'the model with a backlog first');
  const glm = ms[0];
  assert.equal(glm.depth, 4);
  assert.equal(glm.oldestMs, 12_000, 'its oldest ticket, across its partitions');
  assert.equal(glm.tone, 'wait');
  assert.deepEqual(glm.partitions.map((p) => [shortSubject(p.subject), p.tone]), [['glm.local.internal.any', 'wait'], ['glm.other.internal.any', 'ok']]);
  assert.equal(ms[1].tone, 'idle', 'nothing waiting');
  assert.equal(ms[1].oldestMs, null);
  assert.ok(!ms.some((m) => m.partitions.some((p) => p.shape === 's')), "a seat's own queue is no model's partition");
});

test("each seat's plan beside how its node says it pulls", () => {
  const nodes = [
    { id: 'n', seats: [{ ref: 'n/a', id: 'a', pull: { state: 'pulling', reason: null, plan_version: 1764151200400, queues: ['voice.work.s.n.a'] }, prefill_rate: 2400 }] },
    { id: 'z', seats: [{ ref: 'z/b', id: 'b', pull: { state: 'held', reason: 'its node is draining', plan_version: null, queues: [] } }] },
  ];
  const [a, b] = seatPlans(board, nodes);
  assert.equal(a.seat, 'n/a');
  assert.equal(a.held, null);
  assert.equal(a.ownQueue, 1, 'its own queue holds one');
  assert.equal(a.following, 'plan');
  assert.equal(a.prefillRate, 2400);
  assert.equal(planTime(a.pull.plan_version), '2025-11-26T10:00:00.400Z', 'a plan version is the time its board was written');
  assert.equal(b.held, 'its node is draining');
  assert.equal(b.following, 'own', 'a node on its own eligibility');
  const unseen = seatPlans(board, [])[0];
  assert.equal(unseen.following, 'unknown', 'a node that has not said');
  assert.equal(unseen.pull, undefined);
});

test("the live view's reading: each model's backlog; a board too old is stale", () => {
  const live = liveQueues(board);
  assert.equal(live.stale, false);
  assert.deepEqual(live.byModel.get('glm'), { depth: 4, oldestMs: 12_000, tone: 'wait', partitions: 2 });
  assert.equal(liveQueues({ ...board, age_ms: 9000 }).stale, true, 'the brain down');
  assert.equal(liveQueues(undefined).byModel.size, 0, 'no board: nothing');
});
