# ui

Voice's admin UI: one application that administers all of voice, the
nodes included. The api serves its built files from its own origin.

Nothing is here yet. This file records the decisions the UI is built on.

## The seam

The UI talks to voice only through [`../openapi.yaml`](../openapi.yaml):
`/admin/v1` for administration, `/v1` where it shows what a caller sees.
It never talks to a node; `../node.yaml` is for the machine a node runs on.

**The api is the trust boundary.** Voice's backend is Hale, and the
compiler proves what it can about the system graph up to the api's edge.
The UI is not Hale (Hale's front-end story is not far enough along to build
on), so to the compiler it is a black box, and to the api it is an untrusted
client like any other:

- Every rule is enforced by the api: validation, authorization, limits,
  budgets, which account a key may spend. The UI may check a form early for
  convenience; the api never relies on it.
- The UI holds no secrets. A key's secret and a node's enrollment token are
  shown once, as the api returns them, and never stored.
- Anything the UI can do, a script with the same credentials can do, and
  the api is designed for that.

## Stack (proposed)

- TypeScript, React, Vite.
- Types and client generated from `openapi.yaml` (`openapi-typescript`,
  `openapi-fetch`), so a contract change is a type error rather than a
  runtime surprise.
- TanStack Query for fetching and caching; live state from the admin event
  stream (`GET /admin/v1/events`) invalidating what it names.

## Developing

Against the stub, which answers every endpoint with a canned happy path:

```sh
hale build api && api/api --port 8080
```

The dev server proxies `/v1` and `/admin/v1` to it, so the UI runs on one
origin in development as it does in production.

## Shipping

`vite build` writes static files; the api serves them at `/`, with the
single-page fallback, beside `/v1` and `/admin/v1`. One origin, so no CORS.

## Screens

One per part of the admin API:

- **Overview:** quota headroom per account, node health, recent usage.
- **Usage:** summaries by project, account, model and day; the records.
- **Accounts:** quota windows, limits.
- **Nodes:** capabilities, cap, seats and their state, enrollment and token
  rotation.
- **Seats:** a form per engine, rendered from its `config_schema`.
- **Catalog, Projects and keys:** budgets, limits, a key's secret shown once.
- **Changes:** the audit log.
