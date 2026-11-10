import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, newConversation, titleFrom } from './store.ts';

/** A storage in memory, that can refuse reads or writes, or hold a byte budget. */
function memory({ refuseRead = false, refuseWrite = false, quota = Infinity } = {}) {
  const m = new Map();
  return {
    m,
    getItem(k) {
      if (refuseRead) throw new Error('SecurityError');
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      if (refuseWrite) throw new Error('SecurityError');
      if (v.length > quota) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem(k) {
      m.delete(k);
    },
  };
}

test('conversations are kept, read back, renamed and removed', () => {
  const b = memory();
  const s = new ChatStore(b);
  const a = newConversation('work', 'm', 1);
  const c = newConversation('home', 'm', 2);
  s.put(a);
  s.put(c);
  assert.equal(s.persisted, true);
  const again = new ChatStore(b);
  assert.deepEqual(again.list().map((x) => x.id), [c.id, a.id], 'the latest touched first');
  again.put({ ...a, title: 'renamed', updated: 3 });
  assert.equal(new ChatStore(b).get(a.id).title, 'renamed');
  assert.deepEqual(new ChatStore(b).list().map((x) => x.id), [a.id, c.id]);
  again.remove(c.id);
  assert.deepEqual(new ChatStore(b).list().map((x) => x.id), [a.id]);
});

test('no storage at all: the conversations live for the visit', () => {
  const s = new ChatStore(null);
  s.put(newConversation('work', 'm'));
  assert.equal(s.list().length, 1);
  assert.equal(s.persisted, false);
});

test('storage that refuses reads or writes, or is full, never breaks the screen', () => {
  const r = new ChatStore(memory({ refuseRead: true }));
  assert.equal(r.persisted, false);
  assert.deepEqual(r.list(), []);
  const w = new ChatStore(memory({ refuseWrite: true }));
  w.put(newConversation('work', 'm'));
  assert.equal(w.list().length, 1, 'kept in memory');
  assert.equal(w.persisted, false);
  const full = new ChatStore(memory({ quota: 300 }));
  const big = newConversation('work', 'm');
  big.messages = [{ id: 'x', role: 'user', text: 'x'.repeat(1000), at: 0 }];
  full.put(big);
  assert.equal(full.list().length, 1);
  assert.equal(full.persisted, false, 'said not kept');
});

test('a corrupt or foreign document reads as none, and bad entries are dropped', () => {
  const b = memory();
  b.m.set('voice.chat.conversations', '{not json');
  assert.deepEqual(new ChatStore(b).list(), []);
  b.m.set('voice.chat.conversations', JSON.stringify({ version: 99, conversations: [] }));
  assert.deepEqual(new ChatStore(b).list(), []);
  const good = newConversation('work', 'm');
  b.m.set('voice.chat.conversations', JSON.stringify({ version: 1, conversations: [good, { id: 3 }, null] }));
  assert.deepEqual(new ChatStore(b).list().map((x) => x.id), [good.id]);
});

test('a title from the first words', () => {
  assert.equal(titleFrom('  what is\n a seat? '), 'what is a seat?');
  assert.equal(titleFrom(''), 'new chat');
  assert.equal(titleFrom('x'.repeat(100)).length, 58);
});
