import { useSyncExternalStore } from 'react';
import { operatorToken } from '../api/token';
import { ChatStore, browserBacking, newId, type Conversation, type Message } from './store.ts';
import { apply, isOutput, newAnswer, paceOf, type Answer } from './responses.ts';
import { isRefused, refusedLine, stream } from './request.ts';

/**
 * Chat's conversations and the answers streaming into them, outside any
 * screen: an answer goes on while the operator looks elsewhere, and is
 * there when they come back.
 */
export const chats = new ChatStore(browserBacking());

let version = 0;
let queued = false;
const listeners = new Set<() => void>();

/** Tell the screen, at most once a frame while an answer streams. */
function changed(now = false): void {
  if (now) {
    version++;
    for (const l of listeners) l();
    return;
  }
  if (queued) return;
  queued = true;
  const run = () => {
    queued = false;
    changed(true);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-render on any change to the conversations. */
export function useChats(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

const running = new Map<string, AbortController>();

export function isRunning(id: string): boolean {
  return running.has(id);
}

/** Keep `c` as the operator changed it. */
export function save(c: Conversation): void {
  chats.put({ ...c, updated: Date.now() });
  changed(true);
}

export function remove(id: string): void {
  stop(id);
  chats.remove(id);
  changed(true);
}

/** Stop the answer streaming into `id`, keeping what came. */
export function stop(id: string): void {
  running.get(id)?.abort();
}

/** What an answer, as it stands, puts on its message. */
function fields(a: Answer): Partial<Message> {
  const { text, reasoning, ...rest } = a;
  return { text, reasoning: reasoning || undefined, answer: rest };
}

/**
 * Ask for the conversation's next answer: its turns so far are sent whole,
 * and the answer streams into a new message after them. `webFetch` lists
 * the hosted tool (the chat has it on, and it is offered).
 */
export async function answer(id: string, webFetch = false): Promise<void> {
  const c = chats.get(id);
  const token = operatorToken();
  if (!c || !token || running.has(id)) return;
  const msg: Message = { id: newId('msg'), role: 'assistant', text: '', at: Date.now() };
  chats.put({ ...c, messages: [...c.messages, msg], updated: Date.now() });
  const ctl = new AbortController();
  running.set(id, ctl);
  changed(true);

  const update = (patch: Partial<Message>, persist: boolean) => {
    const cur = chats.get(id);
    if (!cur) return;
    chats.put({ ...cur, messages: cur.messages.map((m) => (m.id === msg.id ? { ...m, ...patch } : m)) }, persist);
    changed(persist);
  };
  let a = newAnswer();
  const sentAt = performance.now();
  let firstAt: number | undefined;
  try {
    await stream(c, token, ctl.signal, (ev) => {
      if (firstAt === undefined && isOutput(ev)) firstAt = performance.now();
      a = apply(a, ev);
      update(fields(a), false);
    }, webFetch);
    update({ ...fields(a), pace: paceOf(a, sentAt, firstAt, performance.now()) }, true);
  } catch (e) {
    const pace = paceOf(a, sentAt, firstAt, performance.now());
    if (ctl.signal.aborted) update({ ...fields(a), pace, stopped: true }, true);
    else if (isRefused(e)) update({ ...fields(a), refused: refusedLine(e) }, true);
    else update({ ...fields(a), pace, refused: `the stream broke: ${e instanceof Error ? e.message : String(e)}` }, true);
  } finally {
    running.delete(id);
    changed(true);
  }
}
