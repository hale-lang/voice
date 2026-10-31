import createClient, { type MaybeOptionalInit } from 'openapi-fetch';
import type { PathsWithMethod, RequiredKeysOf } from 'openapi-typescript-helpers';
import { useQuery, useQueries } from '@tanstack/react-query';
import type { paths, components } from './schema';
import { operatorToken, forgetOperatorToken } from './token';

/** The one way the UI reaches voice: spec/openapi.yaml, typed. */
export const api = createClient<paths>({ baseUrl: '' });

// Every admin request carries the operator token the admin plane takes
// (token.ts); a token it refuses (401) is forgotten, and the UI asks for it
// again. The probes take none.
const isAdmin = (url: string) => new URL(url, window.location.href).pathname.startsWith('/admin/');
api.use({
  onRequest({ request }) {
    const t = operatorToken();
    if (t && isAdmin(request.url)) request.headers.set('Authorization', `Bearer ${t}`);
    return request;
  },
  onResponse({ request, response }) {
    if (response.status === 401 && isAdmin(request.url)) forgetOperatorToken();
    return response;
  },
});

export type Schemas = components['schemas'];
export type Node = Schemas['Node'];
export type SeatView = Schemas['SeatView'];
export type Account = Schemas['Account'];
export type Project = Schemas['Project'];
export type UsageRecord = Schemas['UsageRecord'];
export type UsageSummary = Schemas['UsageSummary'];
export type Change = Schemas['Change'];
export type CatalogModel = Schemas['CatalogModel'];
export type Recipe = Schemas['Recipe'];
export type Runtime = Schemas['Runtime'];
export type Placement = Schemas['Placement'];

type GetPaths = PathsWithMethod<paths, 'get'>;

// openapi-fetch's own (unexported) shape for the optional init argument.
type InitParam<Init> = RequiredKeysOf<Init> extends never ? [(Init & { [key: string]: unknown })?] : [Init & { [key: string]: unknown }];

/**
 * A typed GET as a query. The response type follows from the path, so a
 * contract change is a type error here rather than a surprise on screen.
 */
export function useGet<P extends GetPaths>(path: P, ...init: InitParam<MaybeOptionalInit<paths[P], 'get'>>) {
  return useQuery({
    queryKey: [path, init[0] ?? null],
    queryFn: async () => {
      const r = await api.GET(path, ...init);
      if (r.error !== undefined || r.data === undefined) {
        throw new Error(describe(r.error, r.response.status));
      }
      return r.data;
    },
  });
}

/**
 * A typed GET of what never changes once written (a request's recording):
 * read once, kept, never refetched, and a miss is not retried.
 */
export function useGetOnce<P extends GetPaths>(path: P, ...init: InitParam<MaybeOptionalInit<paths[P], 'get'>>) {
  return useQuery({
    queryKey: [path, init[0] ?? null],
    queryFn: async () => {
      const r = await api.GET(path, ...init);
      if (r.error !== undefined || r.data === undefined) {
        throw new Error(describe(r.error, r.response.status));
      }
      return r.data;
    },
    staleTime: Infinity,
    refetchInterval: false,
    retry: false,
  });
}

/**
 * What a failure says. The control plane answers a class's variant,
 * `{"NotFound": {"code", "message"}}` (a transport refusal is
 * `{"refusal": {"kind", "reason"}}`); the data plane keeps the OpenAI-shaped
 * `{"error": {...}}`.
 */
export function describe(error: unknown, status: number): string {
  const body = (error ?? {}) as Record<string, unknown>;
  const problem = (body.error ?? Object.values(body).find((v) => v && typeof v === 'object' && 'message' in (v as object))) as { message?: string; code?: string } | undefined;
  const refusal = body.refusal as { kind?: string; reason?: string } | undefined;
  if (problem?.message !== undefined) return problem.code ? `${problem.code}: ${problem.message}` : problem.message;
  if (refusal) return `${refusal.kind ?? 'refused'}: ${refusal.reason ?? ''}`;
  return `${status}`;
}

/** A request's recording, as `getPeek` answers it. */
export type Peek = Schemas['Peek'];
export type Annotation = Schemas['Annotation'];

/**
 * The recordings of `ids`, each read once and kept, as `useGetOnce` reads
 * one (the same cache): a request not recorded is an error, not retried.
 */
export function usePeeks(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => {
      const init = { params: { path: { request_id: id } } };
      return {
        queryKey: ['/admin/v1/peeks/{request_id}', init] as const,
        queryFn: async () => {
          const r = await api.GET('/admin/v1/peeks/{request_id}', init);
          if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
          return r.data;
        },
        staleTime: Infinity,
        refetchInterval: false as const,
        retry: false,
      };
    }),
  });
}

/**
 * The annotations of `ids` (annotate.hl), each read once and kept: a
 * request not annotated (its project and key do not annotate, or it is not
 * read yet) answers 404, which is `null` here, not an error.
 */
export function useAnnotations(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => {
      const init = { params: { path: { request_id: id } } };
      return {
        queryKey: ['/admin/v1/annotations/{request_id}', init] as const,
        queryFn: async (): Promise<Annotation | null> => {
          const r = await api.GET('/admin/v1/annotations/{request_id}', init);
          if (r.response.status === 404) return null;
          if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
          return r.data;
        },
        staleTime: 30_000,
        retry: false,
      };
    }),
  });
}

/** Turns of one conversation read at most, newest first. */
const TURNS_MAX = 2000;

/**
 * Every usage record `query` matches, oldest first, following the ledger's
 * pages to at most `TURNS_MAX`. Its key is under `/admin/v1/usage`, so the
 * event stream refreshes it as turns land.
 */
export function useAllUsage(query: { conversation: string }) {
  return useQuery({
    queryKey: ['/admin/v1/usage', { all: query }],
    queryFn: async () => {
      const out: UsageRecord[] = [];
      let cursor: string | undefined;
      let more = false;
      do {
        const r = await api.GET('/admin/v1/usage', { params: { query: { ...query, limit: 1000, ...(cursor ? { cursor } : {}) } } });
        if (r.error !== undefined || r.data === undefined) throw new Error(describe(r.error, r.response.status));
        out.push(...r.data.data);
        cursor = r.data.next_cursor ?? undefined;
        more = !!cursor && out.length < TURNS_MAX;
      } while (more);
      return { turns: out.reverse(), truncated: !!cursor };
    },
  });
}
