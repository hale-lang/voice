import type { RailGroup } from '@hale/components';

/**
 * Where each screen lives. A link names a screen and its item, as
 * `href('nodes', node, seat)`; the URL places it in its layer, as
 * `#/models/nodes/<node>/<seat>`. The screens read their parts the same
 * way (`route.parts`, `['nodes', node, seat]`), so moving a screen to
 * another layer is a line here, not a change to every link.
 *
 * Pure (no React), so the tests read it as the app does.
 */
export const PLACES = {
  '': [],
  models: ['models', 'catalogue'],
  placements: ['models', 'placements'],
  nodes: ['models', 'nodes'],
  recipes: ['models', 'recipes'],
  runtimes: ['models', 'runtimes'],
  accounts: ['models', 'accounts'],
  routes: ['models', 'routes'],
  requests: ['models', 'requests'],
  network: ['models', 'live'],
  projects: ['projects'],
  chat: ['conversations', 'chat'],
  conversations: ['conversations', 'history'],
  annotators: ['harness', 'annotators'],
  tools: ['harness', 'tools'],
  attempts: ['harness', 'attempts'],
  changes: ['changes'],
  api: ['api'],
} as const satisfies Record<string, readonly string[]>;

export type Screen = keyof typeof PLACES;

/** The rail: each layer and the screens in it, in order. A layer's label opens its first screen. */
export const NAV: { label?: string; system?: boolean; items: { screen: Screen; label: string }[] }[] = [
  { items: [{ screen: '', label: 'Overview' }] },
  {
    label: 'Models',
    items: [
      { screen: 'models', label: 'Catalogue' },
      { screen: 'placements', label: 'Placements' },
      { screen: 'nodes', label: 'Nodes' },
      { screen: 'recipes', label: 'Recipes' },
      { screen: 'runtimes', label: 'Runtimes' },
      { screen: 'accounts', label: 'Accounts' },
      { screen: 'routes', label: 'Routes' },
      { screen: 'requests', label: 'Requests' },
      { screen: 'network', label: 'Live' },
    ],
  },
  { items: [{ screen: 'projects', label: 'Projects' }] },
  {
    label: 'Conversations',
    items: [
      { screen: 'chat', label: 'Chat' },
      { screen: 'conversations', label: 'Conversations' },
    ],
  },
  {
    label: 'Harness',
    items: [
      { screen: 'annotators', label: 'Annotators' },
      { screen: 'tools', label: 'Tools' },
      { screen: 'attempts', label: 'Attempts' },
    ],
  },
  {
    system: true,
    items: [
      { screen: 'changes', label: 'Changes' },
      { screen: 'api', label: 'API' },
    ],
  },
];

/** The rail as `RailNav` draws it, `screen`'s item and its layer marked current. */
export function railOf(screen: string): RailGroup[] {
  return NAV.map((g) => ({
    ...(g.label ? { label: g.label } : {}),
    ...(g.system ? { apart: true } : {}),
    items: g.items.map((it) => ({ href: href(it.screen), label: it.label, active: it.screen === screen })),
  }));
}

function isScreen(s: string): s is Screen {
  return Object.hasOwn(PLACES, s);
}

/** The hash that opens a screen (`parts[0]`) and its item (the rest); a part may hold a slash. */
export function href(...parts: string[]): string {
  const [screen = '', ...rest] = parts;
  const path = isScreen(screen) ? [...PLACES[screen], ...rest] : parts;
  return '#/' + path.map(encodeURIComponent).join('/');
}

/** The screens before the layers, as their URLs named them, each a screen of the same name but `usage`. */
const OLD = new Set(['network', 'nodes', 'usage', 'routes', 'accounts', 'placements', 'recipes', 'runtimes', 'annotators', 'chat', 'tools', 'attempts']);

/** A layer's own path: the URL of its first screen. */
const LAYERS: Record<string, Screen> = Object.fromEntries(
  NAV.filter((g) => g.label).map((g) => [PLACES[g.items[0]!.screen][0], g.items[0]!.screen]),
);

/**
 * What a URL's path opens: the screen's parts, or, for a URL from before
 * the layers (or a layer's own path), the URL that opens it now
 * (`redirect`), its query kept. Unknown paths are left as they are (the
 * app shows the overview there, as it always has).
 */
export function resolve(path: readonly string[], query: URLSearchParams): { parts: string[]; query: URLSearchParams; redirect?: string } {
  if (!path.length) return { parts: [], query };
  // the longest place first: `models/nodes` before `models`
  let best: Screen | null = null;
  for (const s of Object.keys(PLACES) as Screen[]) {
    const place = PLACES[s];
    if (place.length && place.length <= path.length && place.every((p, i) => path[i] === p) && (best === null || place.length > PLACES[best].length)) best = s;
  }
  if (best !== null) return { parts: [best, ...path.slice(PLACES[best].length)], query };

  const [head = '', ...rest] = path;
  // `#/models/<model>` was the catalogue's own; a model named as a screen
  // of the layer (`nodes`) is shadowed by it
  if (head === 'models') return moved(['models', ...rest], query);
  if (Object.hasOwn(LAYERS, head)) return moved([LAYERS[head]!], query);
  if (head === 'usage') return moved(usageParts(rest, query), withoutView(query));
  if (OLD.has(head)) return moved([head, ...rest], query);
  return { parts: [...path], query };
}

function moved(parts: string[], query: URLSearchParams) {
  const q = query.toString();
  return { parts, query, redirect: href(...parts) + (q ? `?${q}` : '') };
}

/**
 * The Usage screen was one page with a Requests | Conversations switch
 * (`?view=`): a conversation it opened (`usage/c/<conversation>`) is the
 * conversations screen's now, a request (`usage/<request>`) the requests
 * screen's; with neither open, `view` says which.
 */
function usageParts(rest: string[], query: URLSearchParams): string[] {
  if (rest[0] === 'c') return ['conversations', ...rest.slice(1, 2)];
  if (rest[0]) return ['requests', rest[0]];
  return [query.get('view') === 'conversations' ? 'conversations' : 'requests'];
}

function withoutView(query: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(query);
  q.delete('view');
  return q;
}
