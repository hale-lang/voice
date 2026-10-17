# lib/pond: a pinned copy of pond's NATS client

`realtime/nats/` holds four source files of `hale-lang/pond`'s
`realtime/nats` at `697852f` (2026-09-24): `client.hl`, `proto.hl`,
`types.hl` and `log.hl`, copied verbatim. They are the core NATS client
(`NatsClient`) and what it needs; the bus adapter, JetStream and the test
fake are not taken. Pond is Apache-2.0 (`LICENSE`, beside this file).

The api (`api/link.hl`) and the node (`node/session.hl`) import it as
`import "../lib/pond/realtime/nats" as nats;`. It lives under `lib/`, a
directory vendored by hand, not `vendor/`, which `hale fetch` owns; nothing
is fetched at build.

Refresh it by copying the four files from pond again and updating the
commit here; `hale verify api` and `hale verify node` must stay clean.
