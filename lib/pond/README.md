# lib/pond: pinned copies of pond libraries

Copied verbatim from where each says, sources only (not tests or examples). Pond is Apache-2.0
(`LICENSE`, beside this file).

- `realtime/nats/`: `adapter.hl`, `client.hl`, `jetstream.hl`, `log.hl`,
  `proto.hl`, `pull.hl`, `state.hl` and `types.hl` of pond's
  `realtime/nats` at main `0e1501f` (2026-11-26, pond #40 merged), the
  test fake (`fake.hl`) not taken. Pond's main has what voice used to
  carry on top of `v0.9.0`: `NatsConn`'s `untyped` prefix and the
  `NatsInbound` topic, `NatsPublisher`, `max_ack_pending`, and voice's
  three patches (`NatsPublisher` logging through `std::log`,
  `NatsClient.inbox_prefix`, and the latest-value write's liveness), all
  upstreamed (pond issues #31 and #33, merged in #32 and #34); with it, JetStream's work queues (pond
  #37, #38, #39): `StreamSpec` with `js_stream_create_with` and
  `js_stream_update`, `ConsumerSpec.max_deliver`, `js_consumer_delete`,
  `NatsError.code`, the non-blocking `JsPuller`, `js_nak`, `js_term`,
  `js_meta`, `js_publish_headers` with `with_header`, `js_stream_info`,
  `js_consumer_info` and the stream-message calls; and `StreamInfo.created_ns`
  (pond #40), the stream's creation time, which the brain tells as the
  work stream's incarnation (spec/internal.yaml `QueuesReset`), once a
  patch of voice's own. The api (`api/link.hl`, its tickets and claims:
  `api/queue.hl`, and the organization's events: `api/main.hl`), the node
  (`node/session.hl`) and the brain (its route table's version,
  `brain/main.hl`; the work stream, `brain/work.hl`) import it. Voice's
  copy carries no change of its own. Its build warns that `NatsInbound`
  has no subscriber (hale-lang/hale#2207); the warning is harmless.
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
`hale verify api`, `hale verify node` and `hale verify brain` must stay
clean.
