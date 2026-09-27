# api/lib/pond — a pinned copy of pond's NATS client

`realtime/nats/` is `hale-lang/pond`'s `realtime/nats` at `ef90234`
(2026-09-24), its source files only (not its tests or examples), copied
verbatim. Pond is Apache-2.0 (`LICENSE`, beside this file).

The api binds its events to its `NatsAdapter` and carries them on a
pinned `NatsConn` (`api/events.hl`, `api/main.hl`). It lives under
`lib/`, which a project vendors by hand, not `vendor/`, which `hale
fetch` owns: only the one directory is taken, and nothing is fetched at
build.

Refresh it by copying the directory from pond again and updating the
commit here; `hale check api/lib/pond/realtime/nats` must stay clean.
