import type { Answer, Pace } from './responses.ts';

/**
 * Chat's conversations, kept in this browser alone: voice stores none.
 * Each turn sends the conversation whole. The store reads and writes one
 * JSON document under one key; where the browser keeps nothing (a private
 * window, storage refused, its quota full) the conversations live for
 * this visit, and the store says so (`persisted`).
 */
export type Options = {
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
  /** `reasoning.effort`, for a model that reasons; "" leaves it to the model */
  effort: '' | 'none' | 'low' | 'medium' | 'high';
  /** the hosted `web_fetch` tool, where it is offered (chat/tools.ts) */
  web_fetch?: boolean;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** an answer's: the model's thinking */
  reasoning?: string;
  /** an answer's: what the api said of it, and its pace */
  answer?: Omit<Answer, 'text' | 'reasoning'>;
  pace?: Pace;
  /** an answer the api refused, or the operator stopped */
  refused?: string;
  stopped?: boolean;
  at: number;
};

export type Conversation = {
  id: string;
  title: string;
  project: string;
  model: string;
  system: string;
  options: Options;
  messages: Message[];
  created: number;
  updated: number;
};

export const DEFAULT_OPTIONS: Options = { temperature: null, top_p: null, max_output_tokens: null, effort: '', web_fetch: false };

const KEY = 'voice.chat.conversations';
const VERSION = 1;

/** The part of `Storage` the store uses. */
export type Backing = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class ChatStore {
  private all: Conversation[] = [];
  /** whether what is here outlives the visit */
  persisted: boolean;
  private backing: Backing | null;

  constructor(backing: Backing | null) {
    this.backing = backing;
    this.persisted = backing !== null;
    this.all = this.read();
  }

  private read(): Conversation[] {
    if (!this.backing) return [];
    let raw: string | null;
    try {
      raw = this.backing.getItem(KEY);
    } catch {
      this.persisted = false;
      return [];
    }
    if (!raw) return [];
    try {
      const doc = JSON.parse(raw) as { version?: unknown; conversations?: unknown };
      if (doc.version !== VERSION || !Array.isArray(doc.conversations)) return [];
      return doc.conversations.filter(isConversation);
    } catch {
      return [];
    }
  }

  private write(): void {
    if (!this.backing) return;
    try {
      this.backing.setItem(KEY, JSON.stringify({ version: VERSION, conversations: this.all }));
      this.persisted = true;
    } catch {
      // refused or full: kept for this visit alone
      this.persisted = false;
    }
  }

  /** Every conversation, the latest touched first. */
  list(): Conversation[] {
    return [...this.all].sort((a, b) => b.updated - a.updated);
  }

  get(id: string): Conversation | undefined {
    return this.all.find((c) => c.id === id);
  }

  /**
   * Keep `c`, replacing the one with its id. A streaming answer is kept
   * in memory as it grows (`persist` false) and written once it ends.
   */
  put(c: Conversation, persist = true): void {
    const i = this.all.findIndex((x) => x.id === c.id);
    if (i < 0) this.all = [...this.all, c];
    else this.all = this.all.map((x, k) => (k === i ? c : x));
    if (persist) this.write();
  }

  remove(id: string): void {
    this.all = this.all.filter((c) => c.id !== id);
    this.write();
  }
}

function isConversation(v: unknown): v is Conversation {
  if (!v || typeof v !== 'object') return false;
  const c = v as Conversation;
  return typeof c.id === 'string' && typeof c.title === 'string' && typeof c.project === 'string' && typeof c.model === 'string' && Array.isArray(c.messages) && typeof c.updated === 'number';
}

/** This browser's storage, or none where reading it is refused. */
export function browserBacking(): Backing | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** An id for a conversation or a message: random, never the operator's words. */
export function newId(prefix: string): string {
  const c = globalThis.crypto;
  const r = c && 'randomUUID' in c ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(16).slice(2, 18);
  return `${prefix}_${r}`;
}

/** A new, empty conversation. */
export function newConversation(project: string, model: string, now = Date.now()): Conversation {
  return { id: newId('chat'), title: 'new chat', project, model, system: '', options: { ...DEFAULT_OPTIONS }, messages: [], created: now, updated: now };
}

/** A conversation's title from its first words, until the operator names it. */
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'new chat';
}
