import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MaybeOptionalInit, FetchResponse } from 'openapi-fetch';
import type { PathsWithMethod, RequiredKeysOf } from 'openapi-typescript-helpers';
import { api, describe } from './client';
import type { paths } from './schema';

type Method = 'post' | 'put' | 'patch' | 'delete';
type InitParam<Init> = RequiredKeysOf<Init> extends never ? [(Init & { [key: string]: unknown })?] : [Init & { [key: string]: unknown }];
/** The success body of a write, from the contract. */
type Data<P extends keyof paths, M extends Method> = Extract<FetchResponse<paths[P][M] & Record<string | number, any>, MaybeOptionalInit<paths[P], M>, 'application/json'>, { error?: never }>['data'];

/**
 * A typed write. Every rule is the api's; the UI only reports what it
 * answered. After any write, everything shown is refetched: the api is the
 * only source of what changed. `pending` is a 202: proposed, not applied.
 */
export function useWrite() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function write<M extends Method, P extends PathsWithMethod<paths, M>>(method: M, path: P, ...init: InitParam<MaybeOptionalInit<paths[P], M>>): Promise<Data<P, M> | null> {
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      const fn = { post: api.POST, put: api.PUT, patch: api.PATCH, delete: api.DELETE }[method] as (p: P, ...i: unknown[]) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
      // a write with no body goes with `{}` as JSON: hale's REST guard
      // refuses a bodiless write from an origin it does not answer CORS
      // for, which the admin UI is when the habitat serves it at another
      const given = (init[0] ?? {}) as Record<string, unknown>;
      const r = await fn(path, 'body' in given ? given : { ...given, body: {} });
      if (r.error !== undefined) {
        setError(describe(r.error, r.response.status));
        return null;
      }
      if (r.response.status === 202) {
        const pc = r.data as { id?: string; review?: string | null } | undefined;
        setPending(pc?.review ?? pc?.id ?? 'pending review');
      }
      await qc.invalidateQueries();
      return (r.data ?? ({} as Data<P, M>)) as Data<P, M>;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Create a resource under an id of voice's making: `base`, else `base-2`,
   * `base-3`… An id taken by a live resource is skipped (`taken`); one the
   * api refuses because a removed resource held it (a model or placement id
   * is never reused, and the lists do not show removed ones) is passed over
   * for the next. Answers the id made, or null with the error set.
   */
  async function createFresh(path: '/admin/v1/models' | '/admin/v1/placements', base: string, taken: Set<string>, bodyOf: (id: string) => Record<string, unknown>): Promise<string | null> {
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      for (let n = 1; n <= 50; n++) {
        const id = n === 1 ? base : `${base}-${n}`;
        if (taken.has(id)) continue;
        const r = (await (api.POST as (p: string, i: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>)(path, { body: bodyOf(id) }));
        if (r.error !== undefined) {
          const why = describe(r.error, r.response.status);
          if (r.response.status === 409 && why.includes('never reused')) continue;
          setError(why);
          return null;
        }
        if (r.response.status === 202) {
          const pc = r.data as { id?: string; review?: string | null } | undefined;
          setPending(pc?.review ?? pc?.id ?? 'pending review');
        }
        await qc.invalidateQueries();
        return id;
      }
      setError(`no free id after ${base}-50`);
      return null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { write, createFresh, error, busy, pending, clear: () => setError(null) };
}
