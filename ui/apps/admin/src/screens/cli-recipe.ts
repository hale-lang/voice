/**
 * A CLI recipe as the admin UI edits it (`HarnessDefinition`): the recipe's
 * JSON is the one source of truth. The structured form reads and writes
 * fields of it by path; the raw tab edits the same object as text, so a
 * field the form does not show (a login's `describe`, `mcp`, `files`) is
 * kept as it was. Every rule is the api's: a refusal names its field
 * (`error.param`, `recipe.<path>`), which the form shows on that field.
 *
 * Pure (no React), so the tests read it as the app does.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Recipe = { [k: string]: Json };

/** The readers voice has for a CLI's output (`HarnessDefinition.reader`). */
export const READERS = ['text', 'claude-stream-json', 'codex-jsonl', 'agy-stream-json', 'vibe-streaming'] as const;

/** The wires voice serves a CLI's model calls on (`HarnessDefinition.protocol`). */
export const PROTOCOLS = ['openai-chat', 'openai-responses'] as const;

/** What a host run is, in plain words: the warning every host opt-in shows. */
export const HOST_WARNING =
  'A host run has no sandbox and no egress filter: the CLI runs as the node\'s user, in the attempt\'s workspace, and can read and write what that user can and reach any host. Its own permission policy is all that bounds it.';

/** A path into a recipe: names and list indexes, as `backends[1].detect.version` reads. */
export type Path = (string | number)[];

/** `backends[1].detect.version` as a path. */
export function parsePath(s: string): Path {
  const out: Path = [];
  for (const part of s.split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return [s];
    if (m[1]) out.push(m[1]);
    for (const i of m[2]!.matchAll(/\[(\d+)\]/g)) out.push(Number(i[1]));
  }
  return out;
}

/** A path as the api names a field: `backends[1].detect.version`. */
export function pathText(p: Path): string {
  let out = '';
  for (const k of p) out += typeof k === 'number' ? `[${k}]` : out ? `.${k}` : k;
  return out;
}

/** The value at `path`, or undefined. */
export function getIn(r: Json, path: Path): Json | undefined {
  let cur: Json | undefined = r;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? (typeof k === 'number' ? cur[k] : undefined) : (cur as Record<string, Json>)[k as string];
  }
  return cur;
}

/**
 * `r` with `value` at `path`, a new object (the old one is left as it
 * was); `undefined` removes the member. Objects and lists on the way are
 * made as the path needs them.
 */
export function setIn<T extends Json>(r: T, path: Path, value: Json | undefined): T {
  if (!path.length) return (value === undefined ? null : value) as T;
  const [k, ...rest] = path;
  if (typeof k === 'number') {
    const list = Array.isArray(r) ? [...r] : [];
    const next = setIn((list[k] ?? (typeof rest[0] === 'number' ? [] : {})) as Json, rest, value);
    if (value === undefined && !rest.length) list.splice(k, 1);
    else list[k] = next;
    return list as T;
  }
  const obj: Record<string, Json> = r !== null && typeof r === 'object' && !Array.isArray(r) ? { ...(r as Record<string, Json>) } : {};
  if (value === undefined && !rest.length) {
    delete obj[k as string];
    return obj as T;
  }
  obj[k as string] = setIn((obj[k as string] ?? (typeof rest[0] === 'number' ? [] : {})) as Json, rest, value);
  return obj as T;
}

/** A recipe's text member, "" when it is not one. */
export function textAt(r: Recipe, path: Path): string {
  const v = getIn(r, path);
  return typeof v === 'string' ? v : '';
}

/** A recipe's list of strings, one a line, as a text area edits it. */
export function linesAt(r: Recipe, path: Path): string {
  const v = getIn(r, path);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join('\n') : '';
}

/** Lines as a list of strings: each line one, an empty line none. */
export function linesOf(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0);
}

/** An object of strings as `NAME=value` lines. */
export function envLinesAt(r: Recipe, path: Path): string {
  const v = getIn(r, path);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  return Object.entries(v)
    .filter(([, x]) => typeof x === 'string')
    .map(([k, x]) => `${k}=${x as string}`)
    .join('\n');
}

/** `NAME=value` lines as an object of strings; a line with no `=` is left out. */
export function envOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of linesOf(text)) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return out;
}

export type Backend = { kind: 'container' | 'host'; [k: string]: Json };

/** A recipe's backends, the older `image` read as one container backend. */
export function backendsOf(r: Recipe): Backend[] {
  const image = r.image;
  if (image && typeof image === 'object' && !Array.isArray(image)) {
    return [{ kind: 'container', base: (image as Record<string, Json>).base ?? '', install: (image as Record<string, Json>).install ?? '' }];
  }
  return Array.isArray(r.backends) ? (r.backends.filter((b) => b && typeof b === 'object' && !Array.isArray(b)) as Backend[]) : [];
}

/** `r` in the backends shape: the older `image` as one container backend, so the form edits one list. */
export function normalized(r: Recipe): Recipe {
  if (r.image === undefined || r.image === null) return r;
  const out: Recipe = { ...r, backends: backendsOf(r) as Json[] };
  delete out.image;
  return out;
}

/** The kinds of a recipe's backends, in order: `container, host`. */
export function backendLine(r: Recipe): string {
  const kinds = backendsOf(r).map((b) => b.kind);
  return kinds.length ? kinds.join(', ') : 'none';
}

/** True when a recipe has a backend of `kind`. */
export function hasBackend(r: Recipe, kind: 'container' | 'host'): boolean {
  return backendsOf(r).some((b) => b.kind === kind);
}

/** A new backend of `kind`, empty but for its shape. */
export function newBackend(kind: 'container' | 'host'): Backend {
  return kind === 'container'
    ? { kind, base: '', install: '' }
    : { kind, detect: { command: [], version: '' }, install: { command: [] } };
}

/** `r` with backend `i` moved by `by` (-1 up, 1 down), or as it was at an end. */
export function moveBackend(r: Recipe, i: number, by: number): Recipe {
  const list = [...backendsOf(r)];
  const j = i + by;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return r;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { ...normalized(r), backends: list as Json[] };
}

/** `r` with backend `i` removed. */
export function removeBackend(r: Recipe, i: number): Recipe {
  const list = backendsOf(r).filter((_, k) => k !== i);
  return { ...normalized(r), backends: list as Json[] };
}

/** `r` with a host backend's install argv set from lines: none at all when they are empty (detect alone). */
export function withHostInstall(r: Recipe, i: number, lines: string): Recipe {
  const argv = linesOf(lines);
  const env = getIn(r, ['backends', i, 'install', 'env']);
  if (!argv.length && (!env || (typeof env === 'object' && !Object.keys(env).length))) return setIn(r, ['backends', i, 'install'], undefined);
  return setIn(r, ['backends', i, 'install', 'command'], argv);
}

/**
 * Where the api's refusal of a recipe belongs: `error.param` without its
 * `recipe.` prefix, as a path text; "" for the recipe as a whole.
 */
export function fieldOf(param: string | null | undefined): string {
  if (!param) return '';
  return param === 'recipe' ? '' : param.startsWith('recipe.') ? param.slice('recipe.'.length) : param;
}

/**
 * True when a refusal at `field` (a path text) is the form field at `at`'s:
 * the same path, or one inside it (`login.env` is the login's).
 */
export function refusedAt(field: string, at: string): boolean {
  if (!field || !at) return false;
  return field === at || field.startsWith(`${at}.`) || field.startsWith(`${at}[`);
}

/** The form fields' paths: a refusal at none of them is shown with the raw recipe. */
export const FORM_FIELDS = [
  'id', 'name', 'version', 'command', 'instruction', 'model', 'login', 'reader', 'egress', 'preamble', 'idle_seconds', 'base_url_env', 'protocol', 'backends', 'image',
];

/** True when the form shows a field a refusal at `field` belongs to. */
export function onForm(field: string): boolean {
  return FORM_FIELDS.some((f) => refusedAt(field, f));
}

/** A recipe as text for the raw tab. */
export function recipeText(r: Recipe): string {
  return JSON.stringify(r, null, 2);
}

/** The raw tab's text, read: the recipe, or why it is not one. */
export function parseRecipe(text: string): { recipe: Recipe } | { problem: string } {
  try {
    const v = JSON.parse(text) as Json;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { problem: 'a recipe is a JSON object' };
    return { recipe: v as Recipe };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
}

/** A blank recipe of the operator's: the shape the api asks for, to fill in. */
export function blankRecipe(): Recipe {
  return {
    id: '',
    name: '',
    version: '',
    backends: [newBackend('container')] as Json[],
    command: [],
    instruction: { via: 'stdin' },
    model: { flag: '--model' },
    login: { kind: 'env', env: '' },
    env: {},
    reader: 'text',
    commits: false,
    preamble:
      'You are working in a git repository checked out for you at /work, on a branch of its own. Leave your changes in the working tree: voice commits them when you finish. Do not push, and do not change the repository\'s remotes or git configuration. End with a short summary of what you changed; its first line is the change\'s title.',
    egress: [],
    idle_seconds: 1800,
  };
}

/** How a recipe's model is named: by `flag` or by `env`, and the name. */
export function modelBy(r: Recipe): { by: 'flag' | 'env'; name: string } {
  const env = textAt(r, ['model', 'env']);
  return env ? { by: 'env', name: env } : { by: 'flag', name: textAt(r, ['model', 'flag']) };
}

/** `r` with its model named by `by` as `name`, and by nothing else. */
export function withModel(r: Recipe, by: 'flag' | 'env', name: string): Recipe {
  return setIn(r, ['model'], { [by]: name });
}

/**
 * `r` with its login of `kind`: what that kind needs kept where it is the
 * same (its variable, its describe and setup), the rest of another kind's
 * left out; under voice's own key, the variable voice's address goes in and
 * the wire it speaks, which only that kind has.
 */
export function withLoginKind(r: Recipe, kind: 'env' | 'home' | 'voice'): Recipe {
  const old = (getIn(r, ['login']) ?? {}) as Record<string, Json>;
  const keep: Record<string, Json> = { kind };
  for (const k of ['env', 'entry', 'setup', 'describe']) if (old[k] !== undefined) keep[k] = old[k]!;
  if (kind === 'home') for (const k of ['mount', 'from', 'files']) keep[k] = old[k] ?? (k === 'files' ? [] : '');
  let out = setIn(r, ['login'], keep);
  if (kind === 'voice') {
    if (!textAt(out, ['base_url_env'])) out = setIn(out, ['base_url_env'], 'VOICE_BASE_URL');
    if (!textAt(out, ['protocol'])) out = setIn(out, ['protocol'], 'openai-chat');
  } else {
    out = setIn(setIn(out, ['base_url_env'], null), ['protocol'], null);
  }
  return out;
}

/** The ids of seats a recipe's view names, as `node/seat`. */
export function seatsLine(seats: readonly string[]): string {
  return seats.length ? seats.join(', ') : 'none';
}
