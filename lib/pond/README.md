# lib/pond: pinned copies of pond libraries

Copied verbatim from where each says, sources only (not tests or examples). Pond is Apache-2.0
(`LICENSE`, beside this file).

- `realtime/nats/`: `adapter.hl`, `client.hl`, `jetstream.hl`, `proto.hl`,
  `types.hl` and `log.hl` of pond's `realtime/nats` at `v0.9.0`
  (`81500c0`), merged with what hale's copy of it (hale v0.25.1's
  `dna/core/pond/realtime/nats`, pond at `ef90234`) changed and pond does
  not have yet: `NatsConn`'s `untyped` prefix and the `NatsInbound` topic
  (hale-lang/hale#987, with `Outbound.ack`), `NatsPublisher`
  (hale-lang/hale#986), and `max_ack_pending` on a JetStream consumer;
  the test fake is not taken. The api (`api/link.hl`, and the
  organization's events: `api/main.hl`), the node (`node/session.hl`) and
  the brain (its route table's version, `brain/main.hl`) import it.
  Changes of voice's own, marked `voice:`: `NatsPublisher` (`adapter.hl`)
  logs through `std::log` rather than printing bare;
  `NatsClient.inbox_prefix` (`client.hl`) puts a request's reply inbox
  under a prefix of the caller's (`_INBOX` by default), for the habitat's
  broker account, whose subjects are one prefix; and a latest-value write
  (`Delivery::Latest`) the server has not confirmed in
  `latest_confirm_ms` drops the connection, dialled again after a wait
  that doubles from 1 s to `latest_backoff_max_ms`, reset only by a
  confirmed write, so a server that takes the connection and goes silent
  is not written to forever (`adapter.hl`). All three are for pond. Pond's
  own bounded dial (`NatsConn.timeout`, `connect_within`) replaced voice's.
- `pq/` and `db/`: taken from hale v0.24.0's `dna/core/pond/`, which is
  pond's `pq` and `db` at `01b8643` (2026-08-12), `db` unchanged and `pq`
  with hale's changes since (among them a password from a `std::secret`
  vault entry, hale-lang/hale#989), so they build clean on that toolchain. The api's Postgres store
  (`store/pg_store.hl`) and `api migrate` import them. One change of
  voice's own, marked `voice:` in `pq/pq.hl`: a result's rows are written
  into one buffer (`__pump`, `__append_row`) instead of growing the result
  text by `+` per row, which kept every prefix until the caller returned;
  and the plaintext fallback of `sslmode=prefer` is logged through
  `std::log` (logger `pq`) rather than printed bare.
- `migrations/`: pond's `migrations` at `e2dfe4e`, which `api migrate`
  runs. One change of voice's own, marked `voice:`: its verbose lines go
  through `std::log` (logger `migrate`) rather than printed bare. A pond issue it works around without changing it: `Migrator`
  creates `schema_migrations` before it takes its advisory lock, so two
  runs at once on a fresh database could both create it and one fail;
  `api migrate` takes an advisory lock of its own around the whole run.

Each is imported as `import "../lib/pond/<path>" as <alias>;`. They live
under `lib/`, a directory vendored by hand, not `vendor/`, which
`hale fetch` owns; nothing is fetched at build.

Refresh one by copying its files again and updating the commit here;
`hale verify api` and `hale verify node` must stay clean.
