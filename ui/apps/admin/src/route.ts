import { useEffect, useState } from 'react';
import { href, resolve } from './nav.ts';

export { href };

/**
 * Hash routes, so deep links survive any host: `#/models/nodes/laptop`.
 * `parts` name the screen and its item, as `href` takes them
 * (`['nodes', 'laptop']`; nav.ts places each screen in its layer); the
 * query, if any, is opaque state.
 */
export type Route = { parts: string[]; query: URLSearchParams };

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', q = ''] = raw.split('?');
  // a part is decoded as `href` encoded it: an id may hold a slash
  const r = resolve(path.split('/').filter(Boolean).map(decode), new URLSearchParams(q));
  // a URL from before the layers opens where its screen lives now, in
  // place of the old one in the history
  if (r.redirect) history.replaceState(history.state, '', r.redirect);
  return { parts: r.parts, query: r.query };
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(...parts: string[]) {
  location.hash = href(...parts);
}
