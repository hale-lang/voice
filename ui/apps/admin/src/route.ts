import { useEffect, useState } from 'react';

/**
 * Hash routes, so deep links survive any host: `#/nodes/laptop`. The
 * parts are the route; the query, if any, is opaque state.
 */
export type Route = { parts: string[]; query: URLSearchParams };

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', q = ''] = raw.split('?');
  // a part is decoded as `href` encoded it: an id may hold a slash
  return { parts: path.split('/').filter(Boolean).map(decode), query: new URLSearchParams(q) };
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

export function href(...parts: string[]): string {
  return '#/' + parts.map(encodeURIComponent).join('/');
}

export function go(...parts: string[]) {
  location.hash = href(...parts);
}
