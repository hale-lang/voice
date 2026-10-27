import { useSyncExternalStore } from 'react';

/**
 * The operator token: the admin plane's one credential. The api mints it on
 * its first start; `voice-api admin-token` prints it (under Compose,
 * `docker compose exec api voice-api admin-token`). The UI asks for it once
 * and keeps it in this browser, and sends it with every admin request. A
 * token the api refuses is forgotten, so the UI asks again.
 */
const KEY = 'voice.operator-token';
const listeners = new Set<() => void>();
// where the token lives when the browser keeps nothing (a private window)
let held: string | null = null;

export function operatorToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? held;
  } catch {
    return held;
  }
}

export function keepOperatorToken(token: string | null): void {
  held = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch { /* kept in memory alone */ }
  for (const l of listeners) l();
}

/** The api refused the token: forget it, and ask again. */
export function forgetOperatorToken(): void {
  if (operatorToken() !== null) keepOperatorToken(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useOperatorToken(): string | null {
  return useSyncExternalStore(subscribe, operatorToken, () => null);
}

/** The header the admin plane takes, none without a token. */
export function operatorHeaders(): Record<string, string> {
  const t = operatorToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}
