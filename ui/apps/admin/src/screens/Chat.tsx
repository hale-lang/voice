import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel, Field, TextArea, TextInput, NumberInput, Select, Button, Confirm, Empty, Mono, micros, count, ago } from '@hale/components';
import { api, describe, useGet, type CatalogModel, type Project } from '../api/client';
import { operatorToken } from '../api/token';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { Fold } from '../peek';
import { chats, useChats, isRunning, save, remove, stop, answer } from '../chat/run';
import { newConversation, newId, titleFrom, type Conversation, type Message, type Options } from '../chat/store';
import { Markdown, CopyButton } from '../chat/MarkdownView';
import s from '../chat/Chat.module.css';

/** The project a new chat starts in: the one used last, in this browser. */
const LAST_PROJECT = 'voice.chat.project';

function lastProject(): string {
  try {
    return localStorage.getItem(LAST_PROJECT) ?? '';
  } catch {
    return '';
  }
}

function keepProject(p: string): void {
  try {
    localStorage.setItem(LAST_PROJECT, p);
  } catch {
    // for this visit
  }
}

/**
 * Chat: the operator asks a model as a project's caller would. Each
 * request is the caller plane's own `/v1/responses`, streamed, charged to
 * the chat's project (its limits, its budget, its usage records) under
 * the project's operator key. The conversations are this browser's alone.
 */
export function Chat({ route }: ScreenProps) {
  useChats();
  const selected = route.parts[1];
  const list = chats.list();
  const conv = selected ? chats.get(selected) : undefined;
  const projects = useGet('/admin/v1/projects');
  const active = (projects.data?.data ?? []).filter((p) => p.status === 'active');

  const start = () => {
    const p = active.find((x) => x.id === (conv?.project ?? lastProject()))?.id ?? active[0]?.id ?? '';
    const c = newConversation(p, conv?.project === p ? conv.model : '');
    save(c);
    go('chat', c.id);
  };

  return (
    <>
      <h1>Chat</h1>
      <div className={s.layout}>
        <aside className={s.side}>
          <Panel title="Conversations" readout={`${list.length} kept · ${chats.persisted ? 'this browser' : 'this visit only'}`}>
            <p style={{ marginTop: 0 }}>
              <Button tone="primary" onClick={start} disabled={!active.length}>new chat</Button>
            </p>
            {!chats.persisted && <p className="c-wait" style={{ fontSize: 'var(--size-sm)' }}>◐ this browser keeps nothing: the conversations last this visit</p>}
            <Conversations list={list} selected={selected} />
          </Panel>
        </aside>
        <section className={s.main}>
          {projects.isError ? (
            <p className="c-fail">✕ projects are unavailable: {projects.error.message}</p>
          ) : !conv ? (
            <Empty>{selected ? `No conversation ${selected} in this browser. ` : ''}Start a new chat: it is charged to a project, as that project's callers' requests are.</Empty>
          ) : (
            <Thread key={conv.id} conv={conv} projects={active} />
          )}
        </section>
      </div>
    </>
  );
}

/** The conversations, the latest first: each a line to open, rename or delete. */
function Conversations({ list, selected }: { list: Conversation[]; selected?: string }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  if (!list.length) return <p className="faint">No conversations yet.</p>;
  return (
    <ul className={s.list}>
      {list.map((c) => (
        <li key={c.id} className={c.id === selected ? s.selected : undefined}>
          {renaming === c.id ? (
            <form
              className={s.rename}
              onSubmit={(e) => {
                e.preventDefault();
                save({ ...c, title: name.trim() || c.title });
                setRenaming(null);
              }}
            >
              <TextInput value={name} onChange={setName} />
              <Button type="submit">save</Button>
              <Button onClick={() => setRenaming(null)}>cancel</Button>
            </form>
          ) : (
            <>
              <a href={href('chat', c.id)} className={s.item}>
                <span className={s.itemTitle}>
                  {isRunning(c.id) && <span className="c-active pulse">● </span>}
                  {c.title}
                </span>
                <span className="faint mono">{c.project || 'no project'} · {c.model || 'no model'} · {ago(new Date(c.updated).toISOString())}</span>
              </a>
              {c.id === selected && (
                <span className={s.itemActions}>
                  <button
                    type="button"
                    className={s.quiet}
                    onClick={() => {
                      setName(c.title);
                      setRenaming(c.id);
                    }}
                  >
                    rename
                  </button>
                  <Confirm
                    label="delete"
                    confirm="delete it"
                    onConfirm={() => {
                      remove(c.id);
                      go('chat');
                    }}
                  />
                </span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The models the project may name (`/v1/models`, as charged to it): aliases among them. */
function useProjectModels(project: string) {
  return useQuery({
    queryKey: ['/v1/models', { project }],
    enabled: !!project,
    queryFn: async () => {
      const r = await api.GET('/v1/models', {
        params: { header: { 'Voice-Project': project } },
        headers: { authorization: `Bearer ${operatorToken() ?? ''}` },
      });
      if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
      return r.data.data;
    },
  });
}

/** Whether a model reasons: the catalog's word for it, through the project's alias when it is one. */
function reasons(model: string, project: Project | undefined, catalog: CatalogModel[] | undefined): boolean | undefined {
  if (!catalog) return undefined;
  const target = project?.resolved_aliases?.find((a) => a.name === model)?.model ?? model;
  return catalog.find((m) => m.id === target)?.reasoning;
}

function Thread({ conv, projects }: { conv: Conversation; projects: Project[] }) {
  const models = useProjectModels(conv.project);
  const catalog = useGet('/admin/v1/models');
  const project = projects.find((p) => p.id === conv.project);
  const busy = isRunning(conv.id);
  const [draft, setDraft] = useState('');
  const pane = useRef<HTMLDivElement>(null);
  const last = conv.messages.at(-1);

  // the newest words in view as they come, the page itself left where it is
  useEffect(() => {
    const p = pane.current;
    if (p) p.scrollTop = p.scrollHeight;
  }, [conv.messages.length, last?.text.length, last?.reasoning?.length]);

  // a chat with no model takes the project's first one that can answer
  const choices = useMemo(() => (models.data ?? []).filter((m) => m.voice.contract !== 'decision'), [models.data]);
  useEffect(() => {
    if (!conv.model && choices.length) save({ ...conv, model: (choices.find((m) => m.voice.available) ?? choices[0]!).id });
  }, [conv, choices]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !conv.project || !conv.model) return;
    const user: Message = { id: newId('msg'), role: 'user', text, at: Date.now() };
    const first = !conv.messages.some((m) => m.role === 'user');
    save({ ...conv, title: first && conv.title === 'new chat' ? titleFrom(text) : conv.title, messages: [...conv.messages, user] });
    setDraft('');
    void answer(conv.id);
  };
  const regenerate = () => {
    if (busy || last?.role !== 'assistant') return;
    save({ ...conv, messages: conv.messages.slice(0, -1) });
    void answer(conv.id);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'TEXTAREA') {
      e.preventDefault();
      send();
    }
  };

  const totals = conv.messages.reduce(
    (t, m) => ({ input: t.input + (m.answer?.usage?.input ?? 0), output: t.output + (m.answer?.usage?.output ?? 0), micros: t.micros + (m.answer?.priceMicros ?? 0) }),
    { input: 0, output: 0, micros: 0 },
  );
  const turns = conv.messages.filter((m) => m.role === 'user').length;
  const modelOptions = choices.map((m) => ({ value: m.id, label: `${m.id}${m.voice.available ? '' : ' · no seat up now'}` }));
  if (conv.model && !modelOptions.some((o) => o.value === conv.model)) modelOptions.unshift({ value: conv.model, label: `${conv.model} · not ${conv.project}'s` });

  return (
    <div className={s.threadLayout}>
      <div className={s.thread}>
        <div className={s.head}>
          <h2>{conv.title}</h2>
          <span className="readout">
            {turns} turn{turns === 1 ? '' : 's'} · {count(totals.input)} in · {count(totals.output)} out · {micros(totals.micros)}
          </span>
        </div>
        <div className={s.pickers}>
          <Field label="project">
            <Select
              value={conv.project}
              onChange={(p) => {
                keepProject(p);
                save({ ...conv, project: p });
              }}
              options={projects.map((p) => ({ value: p.id, label: p.name === p.id ? p.id : `${p.id} · ${p.name}` }))}
              empty={conv.project ? undefined : 'choose a project'}
            />
          </Field>
          <Field label="model">
            {models.isError ? (
              <span className="c-fail">✕ {models.error.message}</span>
            ) : (
              <Select value={conv.model} onChange={(m) => save({ ...conv, model: m })} options={modelOptions} empty={conv.model ? undefined : models.isPending ? 'reading…' : 'choose a model'} />
            )}
          </Field>
        </div>
        <div className={s.messages} ref={pane}>
          {!conv.messages.length && <p className="faint">Ask something. The request goes to <Mono>/v1/responses</Mono> as {conv.project || 'a project'}'s, charged to it, and voice keeps no copy of the conversation.</p>}
          {conv.messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={m.id} className={`${s.bubble} ${s.user}`}>
                <div className={s.plain}>{m.text}</div>
              </div>
            ) : (
              <AnswerView key={m.id} m={m} streaming={busy && i === conv.messages.length - 1} last={i === conv.messages.length - 1} onRegenerate={regenerate} busy={busy} />
            ),
          )}
        </div>
        <div className={s.composer} onKeyDown={onKey}>
          <TextArea value={draft} onChange={setDraft} rows={3} placeholder={conv.model ? `Message ${conv.model} · Enter sends, Shift+Enter a new line` : 'choose a model first'} />
          <div className={s.composerRow}>
            <span className="faint" style={{ fontSize: 'var(--size-xs)' }}>
              charged to <Mono>{conv.project || '–'}</Mono> as its operator key
            </span>
            {busy ? (
              <Button tone="danger" onClick={() => stop(conv.id)}>stop</Button>
            ) : (
              <Button tone="primary" onClick={send} disabled={!draft.trim() || !conv.model || !conv.project}>send</Button>
            )}
          </div>
        </div>
      </div>
      <aside className={s.settings}>
        <Settings conv={conv} reasons={reasons(conv.model, project, catalog.data?.data)} />
      </aside>
    </div>
  );
}

/** One answer: its thinking folded, its words, and what the api said of it. */
function AnswerView({ m, streaming, last, busy, onRegenerate }: { m: Message; streaming: boolean; last: boolean; busy: boolean; onRegenerate: () => void }) {
  const a = m.answer;
  const failedFirst = (a?.attempts ?? []).filter((t) => t.outcome !== 'served');
  return (
    <div className={`${s.bubble} ${s.assistant}`}>
      {m.reasoning && <Fold title={streaming && !m.text ? 'thinking…' : 'reasoning'} kind="reasoning" preview={m.reasoning} body={m.reasoning} />}
      {m.text ? <Markdown text={m.text} /> : streaming && <p className="c-active pulse" style={{ margin: 0 }}>{a?.alive ? 'the seat is at work' : 'waiting for a seat'}</p>}
      {failedFirst.length > 0 && (
        <p className="c-wait" style={{ fontSize: 'var(--size-sm)' }}>
          ◐ {failedFirst.map((t) => `${t.seat} ${t.outcome}${t.error ? ` (${t.error})` : ''}`).join('; ')}, then another seat
        </p>
      )}
      {m.refused && <p className="c-fail" role="alert">✕ {m.refused}</p>}
      {a?.error && <p className="c-fail" role="alert">✕ {a.error.code}: {a.error.message}</p>}
      {a?.status === 'incomplete' && <p className="c-wait">◐ cut short: {a.incomplete === 'max_output_tokens' ? 'the output cap was reached' : a.incomplete}</p>}
      {m.stopped && <p className="c-wait">◐ stopped</p>}
      {!streaming && (
        <div className={s.meta}>
          <Readout m={m} />
          <span className={s.actions}>
            {m.text && <CopyButton text={m.text} />}
            {last && (
              <button type="button" className={s.quiet} onClick={onRegenerate} disabled={busy}>
                regenerate
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** Usage and route as the api answered them, then the pace as the operator saw it. */
function Readout({ m }: { m: Message }) {
  const a = m.answer;
  const p = m.pace;
  const parts: (string | null)[] = [
    a?.usage ? `in ${count(a.usage.input)}` : null,
    a?.usage ? `out ${count(a.usage.output)}${a.usage.reasoning ? ` (${count(a.usage.reasoning)} thinking)` : ''}` : null,
    a?.priceMicros !== undefined ? micros(a.priceMicros, a.currency) : null,
    a?.served ? `seat ${a.served.seat}` : null,
    a?.served ? `node ${a.served.node}` : null,
    p?.ttftMs !== undefined ? `ttft ${secs(p.ttftMs)}` : null,
    p?.tokensPerSecond !== undefined ? `${p.tokensPerSecond.toFixed(1)} tok/s` : null,
    p?.totalMs !== undefined ? `total ${secs(p.totalMs)}` : null,
  ];
  const said = parts.filter(Boolean).join(' · ');
  if (!said && !a?.requestId) return <span />;
  return (
    <span className="readout" title={a?.served ? `account ${a.served.account}${a.served.engine ? ` · engine ${a.served.engine}` : ''} · model ${a.served.model}` : undefined}>
      {said}
      {a?.requestId && (
        <>
          {said ? ' · ' : ''}
          <a href={href('usage', a.requestId)}>{a.requestId}</a>
        </>
      )}
    </span>
  );
}

function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

const EFFORTS = [
  { value: '', label: "the model's default" },
  { value: 'none', label: 'none: answer without thinking' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

/** The chat's system prompt and sampling, sent with each of its turns. */
function Settings({ conv, reasons }: { conv: Conversation; reasons: boolean | undefined }) {
  const set = (o: Partial<Options>) => save({ ...conv, options: { ...conv.options, ...o } });
  const o = conv.options;
  // a model that does not reason is sent no effort
  useEffect(() => {
    if (reasons === false && conv.options.effort) save({ ...conv, options: { ...conv.options, effort: '' } });
  }, [reasons, conv]);
  return (
    <Panel title="This chat" readout="sent each turn">
      <div className={s.fields}>
        <Field label="system prompt" help="sent as the request's instructions">
          <TextArea value={conv.system} onChange={(v) => save({ ...conv, system: v })} rows={5} placeholder="none" />
        </Field>
        <Field label="temperature" help="0 to 2; blank leaves it to the model">
          <NumberInput value={o.temperature} onChange={(v) => set({ temperature: v })} min={0} max={2} step={0.1} placeholder="model default" />
        </Field>
        <Field label="top_p" help="0 to 1">
          <NumberInput value={o.top_p} onChange={(v) => set({ top_p: v })} min={0} max={1} step={0.05} placeholder="model default" />
        </Field>
        <Field label="max output tokens" help="the cap the project's limits reserve against">
          <NumberInput value={o.max_output_tokens} onChange={(v) => set({ max_output_tokens: v === null ? null : Math.max(1, Math.round(v)) })} min={1} step={1} placeholder="model default" />
        </Field>
        <Field label="reasoning effort" help={reasons === false ? 'this model answers without reasoning' : reasons === undefined ? 'sent when set' : 'how hard the model thinks first'}>
          {reasons === false ? (
            <span className="faint">–</span>
          ) : (
            <Select value={o.effort} onChange={(v) => set({ effort: v as Options['effort'] })} options={EFFORTS} />
          )}
        </Field>
      </div>
    </Panel>
  );
}
