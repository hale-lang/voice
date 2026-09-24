# voice

One inference endpoint in front of many model backends. A caller names a
model and presents a project key. Voice picks a seat that can serve it,
enforces the project's limits and budget, and records what the request used,
per project, key and paying account.

Voice is written in [Hale](https://github.com/hale-lang/hale). The design is
in [hale-lang/voice#1](https://github.com/hale-lang/voice/issues/1), and the
settled direction in [`DIRECTION.md`](./DIRECTION.md).

**Status:** specification only. There is no code yet; the contract comes
first.

## The contract

| Document | What it specifies |
|---|---|
| [`openapi.yaml`](./openapi.yaml) | The coordinator: the caller plane (`/v1`) and the admin plane (`/admin/v1`). |
| [`node.yaml`](./node.yaml) | A node's own admin API (`/node/v1`), where its seats are configured. |
| [`protocol.yaml`](./protocol.yaml) | The connection between a node and the coordinator (AsyncAPI). |
| [`spec/vendor/open-responses/`](./spec/vendor/open-responses/) | The [Open Responses](https://www.openresponses.org/specification) standard, `2026-04-24`, which the caller plane is. |

The code conforms to these documents, not the other way round.

## The pieces

```
     callers                                operator, UI
        |                               +-------------------+
        | /v1                           | /admin/v1         | /node/v1
        |                               |                   |
        v                               v                   |
  +-------------------- coordinator --------------------+   |
  |  gateway -> enforcer -> router -> node sessions     |   |
  |                                                     |   |
  |  config store   ledger writer                       |   |
  |                                                     |   |
  +-----------------------------------------------------+   |
          |             |                   ^               |
          |   SQL       |                   |               |
          v             v                   | WebSocket,    |
  +-----------------------------+           | opened by     |
  |          Postgres           |           | the node      |
  +-----------------------------+           |               |
                                            |               v
                                  +---------+--- node ------+-----+
                                  |  session -> seats -> engines  |
                                  |  data directory               |
                                  +-------------------------------+
```

- **The coordinator** is the one endpoint. It serves callers and the admin
  plane, holds every node's connection, decides which seat serves each
  request, and meters it. There is one, on a machine that stays up.
- **A node** runs on each machine that has engines. It runs the seats its
  operator configured and nothing else, and it dials out to the coordinator,
  so it needs no open port.
- **Postgres** is the coordinator's only durable store. Nodes have no
  database.

### Nouns

- **Model:** a catalog entry: an id callers name, its context, output
  ceiling and price. Configured on the coordinator.
- **Account:** what pays and what has limits: a subscription, a metered API
  key, or nothing for a local engine. Configured on the coordinator. Voice
  never holds the credential.
- **Node:** one machine running voice's node software. Created on the
  coordinator, which issues its enrollment token.
- **Seat:** one engine on one node, spending one account, serving some
  models. Configured on the node, because the engine and its login live
  there. Several seats may spend one account and share its limits.
- **Project and key:** who is asking. Every request belongs to one project
  and one key, and keys name the accounts they may spend.

Nothing is discovered. A node runs exactly the seats configured on it, and
the coordinator admits only nodes it issued a token to.

## A request, end to end

1. **Admit.** The gateway reads the key and finds its project, from memory.
   It checks that the model is visible to the key, the data class is one the
   project may send, and the named account, if any, is one the key may
   spend.
2. **Reserve.** The enforcer reserves the estimated input plus the requested
   maximum output against every limit that applies (project, key, model and
   account) and against the project's budget, at the model's current price.
   Anything that doesn't fit is refused with `429` before any work is done.
3. **Route.** The router takes the seats that serve the model, sit on a
   connected node, carry the data class and spend a permitted account. It
   drops accounts with no headroom and seats at their concurrency, then
   picks the account with the most headroom and its least-loaded seat. If
   every account is exhausted the answer is `503 no_capacity`. If the seats
   are only busy, the request waits for one until its deadline.
4. **Serve.** The coordinator sends `serve` to the seat's node over that
   node's connection. The body is the standard Open Responses request; a
   Chat Completions request is converted first. The node's engine runs, and
   its standard streaming events come back and are relayed to the caller as
   they arrive, as server-sent events or collected into one response.
5. **Retry.** If the seat fails before anything reached the caller, the
   request moves to another seat (within the named account, if there is
   one), and the move is recorded as an attempt. After output has begun, a
   failure fails the response.
6. **Settle.** The node's `result` carries the model that actually ran,
   cache writes, timing and, from the CLI engines, the account's quota
   windows. The enforcer settles the reservation on actual usage, the ledger
   writer queues the usage record, and the response's `voice` object reports
   what served it and what it cost.

The coordinator never redirects and never stores prompts or responses. Content
passes through the coordinator and one node in memory; what is kept is the
numbers and the caller's `metadata`.

## State

State lives in one of three places, and each piece has exactly one home.

### Postgres

- **Configuration.** The catalog, accounts and their limits, projects,
  budgets and limits, keys (only a digest of the secret), nodes (only a
  digest of the enrollment token), and pending policy changes. Every admin
  write is a transaction and appends a row to a change log (who, when, what
  was there before), so configuration has a history.
- **The ledger.** One usage record per request: project, key, requested and
  served model, node, seat, account, tokens, price, timing, attempts and the
  caller's `metadata`. It is append-only. Usage summaries are queries over
  it, and in a DNA deployment it is the record DNA accounts from.
- **Declared state.** Each node's seats as it last declared them, and each
  account's quota windows as an engine last reported them. The admin plane
  can show them while a node is offline, and routing does not forget an
  exhausted account on restart.

### Coordinator memory

- **A projection of the configuration**, loaded at start. Each admin write
  commits to Postgres first and updates memory after, so a failed commit
  changes nothing. The request path reads only memory.
- **Counters.** Rate-limit windows, in-flight reservations, each project's
  spend in its current period, and each account's headroom. Spend is rebuilt
  from the ledger at start, so a budget survives a restart; rate-limit
  windows start fresh.
- **Live state.** Node connections, seat health and load, and the queue of
  requests waiting for a seat.

### A node's data directory

The node's seat configuration, written by its admin API. It is small and
local to the node, so it needs no database.

### Why Postgres

The ledger grows without end and is read by aggregate queries (usage grouped
by project, key, account, day), configuration writes need transactions, and
DNA reads the ledger. SQLite would carry one coordinator, but not a second one
or DNA reading alongside it. Postgres covers all three, and Hale reaches it
through [`pond/pq`](https://github.com/hale-lang/pond/tree/main/pq) with
schema changes through
[`pond/migrations`](https://github.com/hale-lang/pond/tree/main/migrations).

### Metering is not optional

The ledger writer flushes usage in batches at most a second apart, off the
request path. If Postgres is unreachable, records wait in a bounded buffer.
When the buffer is full, the coordinator refuses new requests with `503`
rather than serve anything it cannot meter: a budget is a circuit breaker,
and an unmetered request would go around it. A crash can lose the last
unflushed batch, which is the one way the ledger can undercount.

## Security

- **Callers** present project keys. The coordinator stores digests, never
  secrets.
- **Nodes** present their enrollment token on every connection. The
  coordinator never connects to a node; revoking a node closes its
  connection and refuses its token.
- **Admins** authenticate through middleware in front of the admin APIs:
  OIDC later, nothing in the MVP, which listens on loopback only.
- **Provider credentials** stay with the engines on their nodes. A CLI seat
  names its CLI's configuration directory; voice never reads the login.
- **Content** is never written down. A seat sees only the data classes its
  operator allowed it.
- **TLS** is terminated in front of the coordinator, for callers and for
  nodes' `wss`. Hale's TLS reads block their thread and cannot park on an
  async pool yet, so the coordinator speaks plain HTTP behind the
  terminator.

## When things fail

| What fails | What happens |
|---|---|
| A seat | The request moves to another seat if nothing reached the caller; otherwise the response fails, with the attempt recorded. |
| A node's connection | Its in-flight requests fail over as above and its seats leave routing. The node reconnects with backoff and declares its seats again. |
| An account's quota | The account is skipped until its window resets. Requests that named it fail with `503 no_capacity` and `Retry-After`. |
| The coordinator | In-flight requests fail. On start it loads configuration, rebuilds spend from the ledger, and nodes reconnect on their own. |
| Postgres | Admin writes fail. Serving continues from memory until the ledger buffer fills, then stops. The coordinator will not start without it. |

## In Hale

Voice is two Hale programs, a coordinator and a node, plus a shared seed for
the protocol's message types. The shapes come from Hale's
[styleguide](https://github.com/hale-lang/hale/blob/main/spec/styleguide.md).

**Coordinator**

- The gateway serves both planes on `std::http`. Each caller request is an
  accepted child with `release`, so its memory is reclaimed when the request
  ends. A streaming request takes over its connection to write server-sent
  events itself.
- Each connected node is an accepted child holding its WebSocket (server
  side of `pond/websocket`). It publishes the node's events on a topic keyed
  by `request_id`, and each request child subscribes to its own key, so no
  handler filters traffic.
- The enforcer and the router are single-writer loci: every counter and the
  seat table have one owner, and other loci reach them through the bus.
- The configuration store and the ledger writer own the Postgres
  connections. Because `pq` blocks, they are pinned, away from the pool that
  serves requests.

**Node**

- The session holds the WebSocket client and reconnects. It is pinned,
  because `wss` reads block.
- Each seat is a locus running its engine: the static engine answers in
  process, and CLI engines run their CLI through `pond/subprocess`.
- The admin API serves `/node/v1` on loopback.

Where the compiler can check the architecture, it will. Two intended claims:
the request path reaches Postgres only through the ledger writer's queue, and
only the enforcer writes counters.

## Deployment

- **MVP:** one machine. Postgres, the coordinator and one node, all on
  loopback. The node runs a static seat that answers every request with its
  configured text. Everything is set up through the APIs, in this order: a
  model, an account, a node (which yields a token), the node started with
  that token, its seat, a project and a key.
- **Personal:** the coordinator and Postgres on a machine that stays up,
  with a node on each machine whose CLIs are logged in, one seat per account.
- **Later:** nodes running local engines, and more than one coordinator,
  which means rate-limit state shared through Postgres instead of held in
  one process's memory.
