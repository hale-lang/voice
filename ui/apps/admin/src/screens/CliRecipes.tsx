import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Panel, Table, Loading, Unavailable, Missing, Kv, Mono, Status, Form, Field, TextInput, TextArea, NumberInput, Select, ListInput, Button, Confirm, when } from '@hale/components';
import { useGet, type Schemas } from '../api/client';
import { useWrite } from '../api/mutate';
import type { ScreenProps } from '../App';
import { go, href } from '../route';
import { readout } from '../readout';
import {
  HOST_WARNING,
  argvCanon,
  envCanon,
  keepDraft,
  PROTOCOLS,
  READERS,
  backendLine,
  backendsOf,
  blankRecipe,
  envLinesAt,
  envOf,
  fieldOf,
  getIn,
  linesAt,
  linesOf,
  modelBy,
  moveBackend,
  newBackend,
  normalized,
  onForm,
  parseRecipe,
  recipeText,
  refusedAt,
  removeBackend,
  seatsLine,
  setIn,
  textAt,
  withHostInstall,
  withLoginKind,
  withModel,
  type Json,
  type Path,
  type Recipe,
} from './cli-recipe';

type CliRecipe = Schemas['CliRecipe'];

/** A recipe as the api answers it, as the editor's JSON. */
const recipeOf = (r: CliRecipe): Recipe => r.recipe as unknown as Recipe;

/**
 * The CLI recipes: the agentic coding CLIs coding attempts run, voice's own
 * (read-only: disable one, or duplicate it to edit) and the operator's, each
 * listing where it may run, in a container voice builds or on the node's
 * own machine. A seat names one; a disabled recipe's seats take no new
 * attempt, and one a seat names is never removed.
 */
export function CliRecipes({ route, setInspector }: ScreenProps) {
  const selected = route.parts[1];
  const q = useGet('/admin/v1/cli-recipes');
  const recipe = q.data?.data.find((r) => r.id === selected);
  const creating = selected === 'new';

  useEffect(() => {
    setInspector(creating ? <RecipeEditor /> : recipe ? <RecipeInspector recipe={recipe} /> : null);
  }, [creating, recipe, setInspector]);

  if (q.isPending) return <Loading what="CLI recipes" />;
  if (q.isError) return <Unavailable what="CLI recipes" detail={q.error.message} />;
  if (selected && !creating && !recipe) return <Missing what={`CLI recipe ${selected}`} />;

  const off = q.data.data.filter((r) => !r.enabled).length;
  return (
    <>
      <h1>CLI recipes</h1>
      <Panel title="CLI recipes" readout={readout(q, `${q.data.data.length} recipes${off ? ` · ${off} disabled` : ''}`)}>
        <Table<CliRecipe>
          rows={q.data.data}
          rowKey={(r) => r.id}
          selectedKey={selected}
          onSelect={(r) => go('clis', r.id)}
          columns={[
            { key: 'id', header: 'Recipe', render: (r) => <><Mono>{r.id}</Mono>{r.origin === 'shipped' && <span className="faint"> · voice's own</span>}</> },
            { key: 'name', header: 'CLI', render: (r) => textAt(recipeOf(r), ['name']) },
            { key: 'version', header: 'Version', render: (r) => <Mono>{textAt(recipeOf(r), ['version']) || '–'}</Mono> },
            { key: 'backends', header: 'Runs in', render: (r) => backendLine(recipeOf(r)) },
            { key: 'seats', header: 'Seats', render: (r) => (r.seats.length ? r.seats.join(', ') : <span className="faint">none</span>) },
            { key: 'on', header: 'State', render: (r) => <Status tone={r.enabled ? 'active' : 'quiet'} label={r.enabled ? 'enabled' : 'disabled'} /> },
          ]}
          empty="No CLI recipes: voice writes its own as its api starts."
        />
        <p style={{ marginBottom: 0 }}>
          <Button onClick={() => go('clis', 'new')} tone="primary">make a recipe</Button>
        </p>
      </Panel>
      <p className="muted">
        A seat runs its recipe in a container by default, behind the attempt's egress proxy; a seat opted in to the host runs it on its node's own machine. {HOST_WARNING}
      </p>
    </>
  );
}

/** One backend, in words. */
function backendWords(b: ReturnType<typeof backendsOf>[number]): ReactNode {
  if (b.kind === 'container') {
    return <>a container: <Mono>{String(b.base ?? '')}</Mono>, with <Mono>{String(b.install ?? '')}</Mono></>;
  }
  const detect = (getIn(b, ['detect', 'command']) ?? []) as string[];
  const install = (getIn(b, ['install', 'command']) ?? []) as string[];
  return (
    <>
      the host: detected by <Mono>{detect.join(' ')}</Mono> read as <Mono>{String(getIn(b, ['detect', 'version']) ?? '')}</Mono>
      {install.length ? <>, else installed into voice's prefix by <Mono>{install.join(' ')}</Mono></> : <>, installing nothing</>}
    </>
  );
}

/** A recipe: what it runs and where; enabled or disabled, duplicated, edited and removed as its origin allows. */
function RecipeInspector({ recipe: r }: { recipe: CliRecipe }) {
  const w = useWrite();
  const [editing, setEditing] = useState(false);
  const body = recipeOf(r);
  if (editing) return <RecipeEditor existing={r} done={() => setEditing(false)} />;
  const mine = r.origin === 'operator';
  const model = modelBy(body);
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-1)' }}>
        <Mono>{r.id}</Mono> <Status tone={r.enabled ? 'active' : 'quiet'} label={r.enabled ? 'enabled' : 'disabled'} />
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {textAt(body, ['name'])} {textAt(body, ['version'])} · {mine ? "the operator's" : "voice's own, read-only: duplicate it to edit"}
      </p>
      <Kv
        rows={[
          ...backendsOf(body).map((b, i) => ({ k: i === 0 ? 'runs in' : `then ${i + 1}`, v: backendWords(b) })),
          { k: 'command', v: <Mono>{linesAt(body, ['command']).replaceAll('\n', ' ')}</Mono> },
          { k: 'model', v: <>by {model.by === 'flag' ? 'the flag' : 'the variable'} <Mono>{model.name}</Mono></> },
          { k: 'login', v: <>{textAt(body, ['login', 'kind'])}{textAt(body, ['login', 'env']) ? <> · <Mono>{textAt(body, ['login', 'env'])}</Mono></> : null}</> },
          { k: 'reader', v: <Mono>{textAt(body, ['reader'])}</Mono> },
          { k: 'seats', v: seatsLine(r.seats) },
          { k: 'updated', v: when(r.updated_at) },
        ]}
      />
      {backendsOf(body).some((b) => b.kind === 'host') && <p className="c-wait">{HOST_WARNING}</p>}
      <p style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Button onClick={() => w.write('patch', '/admin/v1/cli-recipes/{cli_recipe}', { params: { path: { cli_recipe: r.id } }, body: { enabled: !r.enabled } })} disabled={w.busy}>
          {r.enabled ? 'disable' : 'enable'}
        </Button>
        {mine && <Button onClick={() => setEditing(true)}>edit</Button>}
        {mine && (
          <Confirm
            label="remove"
            confirm={r.seats.length ? 'a seat names it: disable it instead' : 'remove the recipe'}
            disabled={r.seats.length > 0}
            onConfirm={async () => {
              const x = await w.write('delete', '/admin/v1/cli-recipes/{cli_recipe}', { params: { path: { cli_recipe: r.id } } });
              if (x) go('clis');
            }}
          />
        )}
      </p>
      {r.enabled === false && <p className="faint">Disabled: its seats take no new attempt.</p>}
      {mine && r.seats.length > 0 && <p className="faint">Named by {seatsLine(r.seats)}: it is removed only once no seat names it.</p>}
      {w.error && <p className="c-fail">{w.error}</p>}
      <Duplicate from={r} />
      <p className="faint" style={{ fontSize: 'var(--size-xs)', marginTop: 'var(--space-4)' }}>
        <a href={href('clis')}>all CLI recipes</a>
      </p>
    </>
  );
}

/** A copy of a recipe as one of the operator's, under a new id: how voice's own are edited. */
function Duplicate({ from }: { from: CliRecipe }) {
  const w = useWrite();
  const [id, setId] = useState(`${from.id}-mine`);
  const [name, setName] = useState('');
  return (
    <>
      <h3 style={{ marginTop: 'var(--space-5)' }}>Duplicate</h3>
      <Form
        error={w.error}
        onSubmit={async () => {
          const r = await w.write('post', '/admin/v1/cli-recipes/{cli_recipe}/duplicate', { params: { path: { cli_recipe: from.id } }, body: { id, ...(name.trim() ? { name: name.trim() } : {}) } });
          if (r && 'id' in r) go('clis', r.id);
        }}
        actions={<Button type="submit" disabled={w.busy || !id}>duplicate</Button>}
      >
        <Field label="the copy's id" required help="the operator's, to edit; seats keep naming the original until pointed at it">
          <TextInput mono value={id} onChange={setId} required pattern="[a-z0-9][a-z0-9\-]{0,62}" />
        </Field>
        <Field label="its name" help="the original's when empty">
          <TextInput value={name} onChange={setName} placeholder={textAt(recipeOf(from), ['name'])} />
        </Field>
      </Form>
    </>
  );
}

/**
 * Lines edited as text: the operator's draft is kept as typed (a newline
 * before the next argument, a variable's name before its `=`), and what it
 * says goes to the recipe at once (`onText`); the recipe's own text replaces
 * the draft only when the recipe changed from elsewhere.
 */
function LinesArea(props: { text: string; onText: (draft: string) => void; canon: (s: string) => string; rows: number }) {
  const [draft, setDraft] = useState(props.text);
  const latest = useRef(draft);
  latest.current = draft;
  const { text, canon } = props;
  useEffect(() => {
    const kept = keepDraft(latest.current, text, canon);
    if (kept !== latest.current) setDraft(kept);
  }, [text, canon]);
  return (
    <TextArea
      mono
      rows={props.rows}
      value={draft}
      onChange={(v) => {
        setDraft(v);
        props.onText(v);
      }}
    />
  );
}

/** A form field at a recipe path, the api's refusal shown on it when it is this field's. */
function At(props: { label: string; at: string; refused: string; message: string | null; required?: boolean; help?: string; children: ReactNode }) {
  return (
    <>
      <Field label={props.label} required={props.required} help={props.help}>
        {props.children}
      </Field>
      {refusedAt(props.refused, props.at) && props.message && (
        <p className="c-fail" role="alert" style={{ marginTop: 'calc(-1 * var(--space-2))' }}>
          {props.message}
        </p>
      )}
    </>
  );
}

/**
 * Make or edit one of the operator's recipes: the common fields as a form,
 * the whole recipe as JSON for the rest. Every check is the api's; a
 * refusal is shown on the field it names.
 */
function RecipeEditor({ existing, done }: { existing?: CliRecipe; done?: () => void }) {
  const w = useWrite();
  const [recipe, setRecipe] = useState<Recipe>(() => normalized(existing ? recipeOf(existing) : blankRecipe()));
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [raw, setRaw] = useState('');
  const [rawProblem, setRawProblem] = useState<string | null>(null);
  const refused = fieldOf(w.param);
  const set = (path: Path, value: Json | undefined) => setRecipe((r) => setIn(r, path, value));
  const at = (label: string, path: string, children: ReactNode, opts: { required?: boolean; help?: string } = {}) => (
    <At label={label} at={path} refused={refused} message={w.error} {...opts}>
      {children}
    </At>
  );

  const toRaw = () => {
    setRaw(recipeText(recipe));
    setRawProblem(null);
    setTab('raw');
  };
  const toForm = () => {
    const p = parseRecipe(raw);
    if ('problem' in p) {
      setRawProblem(p.problem);
      return;
    }
    setRecipe(normalized(p.recipe));
    setTab('form');
  };

  const backends = backendsOf(recipe);
  const login = textAt(recipe, ['login', 'kind']) || 'env';
  const model = modelBy(recipe);
  const via = textAt(recipe, ['instruction', 'via']) || 'stdin';
  return (
    <>
      <h2 style={{ marginBottom: 'var(--space-3)' }}>{existing ? <>Edit <Mono>{existing.id}</Mono></> : 'Make a CLI recipe'}</h2>
      <p style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button tone={tab === 'form' ? 'primary' : 'default'} onClick={() => (tab === 'raw' ? toForm() : undefined)}>form</Button>
        <Button tone={tab === 'raw' ? 'primary' : 'default'} onClick={() => (tab === 'form' ? toRaw() : undefined)}>raw JSON</Button>
      </p>
      <Form
        error={rawProblem ?? (w.error && (tab === 'raw' || !onForm(refused)) ? w.error : null)}
        onSubmit={async () => {
          let body = recipe;
          if (tab === 'raw') {
            const p = parseRecipe(raw);
            if ('problem' in p) {
              setRawProblem(p.problem);
              return;
            }
            body = p.recipe;
            setRecipe(normalized(body));
          }
          setRawProblem(null);
          const r = existing
            ? await w.write('put', '/admin/v1/cli-recipes/{cli_recipe}', { params: { path: { cli_recipe: existing.id } }, body: body as never })
            : await w.write('post', '/admin/v1/cli-recipes', { body: body as never });
          if (r && 'id' in r) {
            done?.();
            go('clis', r.id);
          }
        }}
        actions={
          <>
            <Button type="submit" tone="primary" disabled={w.busy}>{existing ? 'save' : 'make'}</Button>
            <Button onClick={() => (done ? done() : go('clis'))}>cancel</Button>
          </>
        }
      >
        {tab === 'raw' ? (
          <Field label="the recipe" help="the whole recipe, every field the form does not show among it (`files`, a login's `describe` and `setup`, `env`, `commits`, `mcp`)">
            <TextArea mono value={raw} onChange={setRaw} rows={28} />
          </Field>
        ) : (
          <>
            {existing ? null : at('id', 'id', <TextInput mono value={textAt(recipe, ['id'])} onChange={(v) => set(['id'], v)} required pattern="[a-z0-9][a-z0-9\-]{0,62}" placeholder="my-cli" />, { required: true, help: 'what a seat names; kept for good' })}
            {at('name', 'name', <TextInput value={textAt(recipe, ['name'])} onChange={(v) => set(['name'], v)} required placeholder="My CLI" />, { required: true })}
            {at('version', 'version', <TextInput mono value={textAt(recipe, ['version'])} onChange={(v) => set(['version'], v)} placeholder="1.2.3" />, { help: 'the CLI\'s pinned version: what its backends install, and what a host backend\'s detect must find' })}
            <h3>Where it runs</h3>
            <p className="faint" style={{ marginTop: 0 }}>In order: a seat runs the first of the kind it allows (a container, unless it opts in to the host) that its node can run.</p>
            {backends.map((b, i) => (
              <Panel
                key={i}
                title={`${i + 1}. ${b.kind === 'container' ? 'a container' : 'the host'}`}
                readout={
                  <span style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
                    <Button onClick={() => setRecipe((r) => moveBackend(r, i, -1))} disabled={i === 0}>up</Button>
                    <Button onClick={() => setRecipe((r) => moveBackend(r, i, 1))} disabled={i === backends.length - 1}>down</Button>
                    <Button onClick={() => setRecipe((r) => removeBackend(r, i))}>remove</Button>
                  </span>
                }
              >
                {b.kind === 'container' ? (
                  <>
                    {at('base image', `backends[${i}].base`, <TextInput mono value={textAt(recipe, ['backends', i, 'base'])} onChange={(v) => set(['backends', i, 'base'], v)} required placeholder="docker.io/library/node@sha256:…" />, { required: true, help: 'pinned by digest' })}
                    {at('install', `backends[${i}].install`, <TextInput mono value={textAt(recipe, ['backends', i, 'install'])} onChange={(v) => set(['backends', i, 'install'], v)} required placeholder="npm install --global my-cli@1.2.3" />, { required: true, help: 'one shell command that installs the CLI on the image, pinned' })}
                  </>
                ) : (
                  <>
                    <p className="c-wait" style={{ marginTop: 0 }}>{HOST_WARNING}</p>
                    {at('detect', `backends[${i}].detect.command`, <LinesArea rows={2} canon={argvCanon} text={linesAt(recipe, ['backends', i, 'detect', 'command'])} onText={(v) => set(['backends', i, 'detect', 'command'], linesOf(v))} />, { required: true, help: 'the argv that prints its version, one argument a line: run with no shell' })}
                    {at('version pattern', `backends[${i}].detect.version`, <TextInput mono value={textAt(recipe, ['backends', i, 'detect', 'version'])} onChange={(v) => set(['backends', i, 'detect', 'version'], v)} required placeholder="my-cli ([0-9.]+)" />, { required: true, help: 'matched against a line of what detect prints; its first group must be the pinned version' })}
                    {at('install', `backends[${i}].install.command`, <LinesArea rows={3} canon={argvCanon} text={linesAt(recipe, ['backends', i, 'install', 'command'])} onText={(v) => setRecipe((r) => withHostInstall(r, i, v))} />, { help: 'the argv that installs the pin into voice\'s prefix, one argument a line, naming it as $VOICE_CLI_PREFIX; never sudo, never system-wide. Empty: detect alone' })}
                    {at('install variables', `backends[${i}].install.env`, <LinesArea rows={2} canon={envCanon} text={envLinesAt(recipe, ['backends', i, 'install', 'env'])} onText={(v) => { const env = envOf(v); set(['backends', i, 'install', 'env'], Object.keys(env).length ? env : undefined); }} />, { help: 'NAME=value, one a line, such as UV_TOOL_DIR=$VOICE_CLI_PREFIX/tools' })}
                  </>
                )}
              </Panel>
            ))}
            {refusedAt(refused, 'backends') && !/^backends\[\d+\]\./.test(refused) && w.error && <p className="c-fail" role="alert">{w.error}</p>}
            <p style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button onClick={() => setRecipe((r) => ({ ...normalized(r), backends: [...backendsOf(r), newBackend('container')] as Json[] }))} disabled={backends.length >= 4}>add a container</Button>
              <Button onClick={() => setRecipe((r) => ({ ...normalized(r), backends: [...backendsOf(r), newBackend('host')] as Json[] }))} disabled={backends.length >= 4}>add the host</Button>
            </p>
            <h3>What it runs</h3>
            {at('command', 'command', <LinesArea rows={6} canon={argvCanon} text={linesAt(recipe, ['command'])} onText={(v) => set(['command'], linesOf(v))} />, { required: true, help: 'its argv, one argument a line, its permission policy among it: never a flag that skips it. Paths are the container\'s (/work, /voice); a host run is handed its own' })}
            {at('instruction via', 'instruction.via', <Select value={via} onChange={(v) => set(['instruction'], v === 'file' ? { via: v, path: textAt(recipe, ['instruction', 'path']) || '/voice/instruction.md' } : { via: v })} options={[{ value: 'stdin' }, { value: 'argument', label: 'the last argument' }, { value: 'file', label: 'a file of /voice' }]} required />, { required: true })}
            {via === 'file' && at('instruction file', 'instruction.path', <TextInput mono value={textAt(recipe, ['instruction', 'path'])} onChange={(v) => set(['instruction', 'path'], v)} required />, { required: true })}
            {at('model by', 'model', <Select value={model.by} onChange={(v) => setRecipe((r) => withModel(r, v as 'flag' | 'env', modelBy(r).name))} options={[{ value: 'flag', label: 'a flag' }, { value: 'env', label: 'a variable' }]} required />, { required: true })}
            {at(model.by === 'flag' ? 'model flag' : 'model variable', `model.${model.by}`, <TextInput mono value={model.name} onChange={(v) => setRecipe((r) => withModel(r, model.by, v))} required placeholder={model.by === 'flag' ? '--model' : 'MY_CLI_MODEL'} />, { required: true })}
            {at('login', 'login.kind', <Select value={login} onChange={(v) => setRecipe((r) => withLoginKind(r, v as 'env' | 'home' | 'voice'))} options={[{ value: 'env', label: 'a vault entry, in a variable' }, { value: 'home', label: 'a directory per login' }, { value: 'voice', label: "voice's own key, minted for each attempt" }]} required />, { required: true })}
            {at(login === 'home' ? 'login variable' : 'login\'s variable', 'login.env', <TextInput mono value={textAt(recipe, ['login', 'env'])} onChange={(v) => set(['login', 'env'], v)} required={login !== 'home'} placeholder={login === 'voice' ? 'VOICE_API_KEY' : 'MY_CLI_TOKEN'} />, { required: login !== 'home', help: login === 'home' ? 'names the directory to the CLI, when it reads it from a variable' : 'handed to the CLI by name, never in its argv' })}
            {login === 'home' && (
              <>
                {at('mounted at', 'login.mount', <TextInput mono value={textAt(recipe, ['login', 'mount'])} onChange={(v) => set(['login', 'mount'], v)} required placeholder="/home/voice/.my-cli" />, { required: true, help: 'where the CLI reads it; on the host, that place in the run\'s own home' })}
                {at('its files', 'login.files', <ListInput mono value={((getIn(recipe, ['login', 'files']) ?? []) as string[])} onChange={(v) => set(['login', 'files'], v)} placeholder="auth.json" />, { required: true, help: 'the only files of it a run gets, copied back when the CLI refreshes them' })}
              </>
            )}
            {login === 'voice' && (
              <>
                {at("voice's address in", 'base_url_env', <TextInput mono value={textAt(recipe, ['base_url_env'])} onChange={(v) => set(['base_url_env'], v)} required />, { required: true })}
                {at('speaking', 'protocol', <Select value={textAt(recipe, ['protocol']) || 'openai-chat'} onChange={(v) => set(['protocol'], v)} options={PROTOCOLS.map((p) => ({ value: p }))} required />, { required: true })}
              </>
            )}
            {at('reader', 'reader', <Select value={textAt(recipe, ['reader']) || 'text'} onChange={(v) => set(['reader'], v)} options={READERS.map((r) => ({ value: r }))} required />, { required: true, help: 'how voice reads its output into the transcript, its summary and its usage' })}
            {at('egress', 'egress', <ListInput mono value={((getIn(recipe, ['egress']) ?? []) as string[])} onChange={(v) => set(['egress'], v)} placeholder="api.vendor.example, .vendor.example" />, { help: "its vendor's hosts, which a container's proxy lets through (a leading dot: any under it); a host run has no filter" })}
            {at('preamble', 'preamble', <TextArea rows={4} value={textAt(recipe, ['preamble'])} onChange={(v) => set(['preamble'], v)} />, { help: 'what it is told before the caller\'s instruction' })}
            {at('idle seconds', 'idle_seconds', <NumberInput value={typeof recipe.idle_seconds === 'number' ? recipe.idle_seconds : null} onChange={(v) => set(['idle_seconds'], v ?? undefined)} min={1} step={1} />, { help: 'how long it may write nothing before it has failed' })}
          </>
        )}
      </Form>
    </>
  );
}
