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
        v                               v                   |
  +--------------------- api (x N) ---------------------+   |
  |  gateway -> admission -> claim -> node sessions     |   |
  |                                                     |   |
  |  settle, ledger                                     |   |
  +-----------------------------------------------------+   |
          |                                 ^               |
          | SQL                             | WebSocket,    |
          v                                 | opened by     |
  +--------- Postgres --------+             | the node      v
  |  configuration            |   +---------+ node (x N) ---+-----+
  |  route table, counters    |   |  session -> seats -> engines  |
  |  ledger                   |   |  data directory               |
  +---------------------------+   +-------------------------------+
          ^
          | SQL
  +------- brain (x 1) -------+
  |  reads state, writes      |
  |  the route table          |
  +---------------------------+
```

- **The api** is the endpoint. Every instance serves the caller plane and
  the admin plane, accepts nodes' connections, admits and routes requests,
  and settles them. Instances hold no state of their own beyond their open
  connections, so they scale out behind a load balancer and restart one at a
  time.
- **The brain** keeps the route table. It reads what the api instances write
  (seat declarations, heartbeats, quota windows, configuration) and decides
  which seats should take the next requests for each model. There is exactly
  one, it is not on the request path, and it talks to nothing but Postgres.
- **A node** runs on each machine that has engines. It runs the seats its
  operator configured and nothing else, and dials out to the api, so it needs
  no open port.
- **Postgres** is the shared state: configuration, the route table,
  counters and the ledger. Nodes have no database.

What the specs call the **coordinator** is the api and the brain together;
callers and nodes cannot tell how many api instances stand behind the
address.

**In the MVP there is one process.** The brain runs inside the api, and there
is one api instance. The brain still shares state with the rest only through
Postgres, never through memory or the bus, so moving it into its own program
later is a change of packaging, not of design. See [In Hale](#in-hale).

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

1. **Admit.** The api reads the key and finds its project. It checks that
   the model is visible to the key, the data class is one the project may
   send, and the named account, if any, is one the key may spend.
2. **Claim and reserve,** in one transaction. The api claims the best free
   slot in the route table for the model, among the permitted accounts, and
   reserves the estimated input plus the requested maximum output against
   every limit that applies (project, key, model and account) and against
   the project's budget, at the model's current price. If a limit does not
   fit, nothing is held and the answer is `429`.
3. **Wait, if there is no slot.** If the model's accounts are all exhausted,
   the answer is `503 no_capacity` with the earliest reset. If the seats are
   only busy, the api tries again as slots free or the route table changes,
   until the request's deadline.
4. **Serve.** The api publishes `serve` on a bus topic keyed by node, and
   the session holding that node's connection sends it on. The body is the
   standard Open Responses request; a Chat Completions request is converted
   first. The node's engine runs, and its standard streaming events come
   back on a topic keyed by request, to whichever instance holds the
   caller, and are relayed as they arrive, as server-sent events or
   collected into one response. See [Events](#events).
5. **Retry.** If the seat fails before anything reached the caller, the api
   releases the slot and claims another, on a different seat and within the
   named account if there is one. The move is recorded as an attempt. After
   output has begun, a failure fails the response.
6. **Settle,** in one transaction. The node's `result` carries the model
   that actually ran, cache writes, timing and, from the CLI engines, the
   account's quota windows. The api frees the slot, settles the reservation
   on actual usage, and writes the usage record. The response's `voice`
   object reports what served it and what it cost.

The coordinator never redirects and never stores prompts or responses. Content
passes through one api instance and one node in memory; what is kept is the
numbers and the caller's `metadata`.

## The route table

The brain turns the state of the fleet into rows the api can claim.

- **Slots.** Each seat that is up gets one slot per unit of its concurrency,
  for each model it serves. Slots are ranked: accounts with the most
  headroom first, then the least loaded seats. Accounts that are exhausted
  get no slots, and the table records, per model, that they are exhausted
  and until when.
- **Claims** use `SELECT ... FOR UPDATE SKIP LOCKED`: two api instances
  reaching for the same slot never wait on each other, and the loser takes
  the next one. That is the compare-and-swap, and Postgres already has it.
- **Versions.** Each rewrite bumps the table's version. `pond/pq` has no
  `LISTEN/NOTIFY` yet, so the api polls the version, and rereads the table
  when a claim misses. A change notice on the bus replaces the polling once
  there is more than one process (see [Events](#events)).
- **Leases.** Every api instance heartbeats a row. When one stops, the
  brain frees its claimed slots, releases its reservations, and records its
  in-flight requests as abandoned.

The brain being down does not stop serving. Slots already written can still
be claimed and are still bounded by each seat's concurrency; they only go
stale.

## Events

Voice is evented through Hale's bus, and has no message broker. Everything
that moves between the pieces of a request is a typed topic:

- `serve`, keyed by node: from the instance that claimed the slot to the
  session holding the node's connection.
- the node's events and its `result`, keyed by request: from that session
  to the child holding the caller's request.

Each subscriber names its own key (`where key == ...`), so nothing filters
traffic in a handler. In one process these are in-memory dispatches.

**Scaling out adds no code.** With several api instances, the node's
connection and the caller's request can be on different instances. The
request topics are then bound to NATS in `main`'s `bindings { }` block,
through pond's NATS adapter
([`pond/realtime/nats`](https://github.com/hale-lang/pond/tree/main/realtime/nats)),
and the same publishes and subscriptions cross instances. The same
connection carries the brain's notice that the route table changed, which
ends the polling. See Hale's
[across binaries](https://hale-lang.org/docs/services/multi-binary).

**What does not go on the bus: state.** The claim, the reservation and the
settlement are transactions, and a broker cannot make them atomic, so they
stay in Postgres. Usage is written once, to the ledger; publishing it to a
broker as well would be a second write that can disagree with the first. A
consumer that wants usage as it happens reads the ledger by cursor.

**Why not a broker from the start:** in one process there is nothing for it
to carry that the bus does not already deliver, and it would be one more
stateful service to run. It earns its place with the second api instance,
and adding it then is a binding, not a redesign.

## State

State lives in one of three places, and each piece has exactly one home.

### Postgres

- **Configuration.** The catalog, accounts and their limits, projects,
  budgets and limits, keys (only a digest of the secret), nodes (only a
  digest of the enrollment token), and pending policy changes. Every admin
  write is a transaction and appends a row to a change log (who, when, what
  was there before), so configuration has a history
  (`GET /admin/v1/changes`).
- **The route table**, as above.
- **Counters.** Rate-limit windows, reservations, and each project's spend
  in its current period. Every api instance updates them with conditional
  writes, so a limit holds across instances and across restarts.
- **The fleet as reported.** Api instances' heartbeats, which instance holds
  each node's connection, each node's declared seats and their health, and
  each account's quota windows as an engine last reported them.
- **The ledger.** One usage record per request: project, key, requested and
  served model, node, seat, account, tokens, price, timing, attempts and the
  caller's `metadata`. It is append-only. Usage summaries are queries over
  it, and in a DNA deployment it is the record DNA accounts from.

### Process memory

An api instance holds its open connections (callers' streams and nodes'
WebSockets) and may cache configuration, keyed by a version it checks.
Nothing in memory is the only copy of anything, so losing a process loses
only its own in-flight requests.

### A node's data directory

The node's seat configuration, written by its admin API. It is small and
local to the node, so it needs no database.

### Why Postgres, and not also Redis

The ledger grows without end and is read by aggregate queries (usage grouped
by project, key, account, day). Configuration writes need transactions. Api
instances need shared counters and an atomic claim. DNA reads the ledger.
Postgres does all of it, including the claim, so a second store would only
add something to run and keep consistent; there is also no Redis client in
pond. Hale reaches Postgres through
[`pond/pq`](https://github.com/hale-lang/pond/tree/main/pq), with schema
changes through
[`pond/migrations`](https://github.com/hale-lang/pond/tree/main/migrations).

### Metering is not optional

A request reserves in Postgres before it runs and writes its usage in the
same transaction that settles it. If Postgres is unreachable, nothing is
served (`503 metering_unavailable`): a budget is a circuit breaker, and an
unmetered request would go around it. There is no batch to lose; a request
that dies with its api instance is recorded as abandoned by the brain.

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
- **TLS** is terminated in front of the api, for callers and for nodes'
  `wss`. Hale's TLS reads block their thread and cannot park on an async
  pool yet, so the api speaks plain HTTP behind the terminator, which is
  also the load balancer.

## When things fail

| What fails | What happens |
|---|---|
| A seat | The request moves to another seat if nothing reached the caller; otherwise the response fails, with the attempt recorded. |
| A node's connection | Its in-flight requests fail over as above and its seats leave the route table. The node reconnects, possibly to another api instance, and declares its seats again. |
| An account's quota | The account gets no slots until its window resets. Requests that named it fail with `503 no_capacity` and `Retry-After`. |
| An api instance | Its callers' requests fail and its nodes reconnect elsewhere. The brain frees its slots and reservations when its heartbeat stops. |
| The brain | Serving continues on the last route table, which goes stale until the brain is back. |
| Postgres | Nothing is served and nothing is configured until it is back. |

## In Hale

The target is three Hale programs, the api, the brain and the node, plus
shared seeds for the protocol's message types and for the store (schema and
queries, used by both the api and the brain). In the MVP the api program
also runs the brain. The shapes come from Hale's
[styleguide](https://github.com/hale-lang/hale/blob/main/spec/styleguide.md).

**Api**

- The gateway serves both planes on `std::http`. Each caller request is an
  accepted child with `release`, so its memory is reclaimed when the request
  ends. A streaming request takes over its connection to write server-sent
  events itself.
- Each connected node is an accepted child holding its WebSocket (server
  side of `pond/websocket`). It subscribes to `serve` for its own node, and
  publishes the node's events on a topic keyed by `request_id`, to which
  each request child subscribes with its own key.
- The store owns the Postgres connections: a pool for reads and a dedicated
  connection for transactions, since `pq`'s pool does not do transactions.
  Because `pq` blocks, the store is pinned, away from the pool that serves
  requests.

**Brain**

- One locus with its own store and its own Postgres connection. It takes a
  Postgres advisory lock before doing anything, so there is only ever one
  brain, even when several api instances each start one.
- It shares no state with the api's loci except through Postgres; the only
  thing it may publish is the notice that the route table changed. That is
  the seam that makes the split cheap, and it is stated as a claim, so the
  compiler refuses a shortcut through memory.
- Splitting it out is a new `main` that instantiates it. Running a second api
  instance is a `bindings { }` entry per request topic, not new code.

**Node**

- The session holds the WebSocket client and reconnects. It is pinned,
  because `wss` reads block.
- Each seat is a locus running its engine: the static engine answers in
  process, and CLI engines run their CLI through `pond/subprocess`.
- The admin API serves `/node/v1` on loopback.

## Deployment

- **MVP:** one machine. Postgres, one api with the brain inside it, and one
  node, all on loopback. The node runs a static seat that answers every
  request with its configured text. Everything is set up through the APIs,
  in this order: a model, an account, a node (which yields a token), the
  node started with that token, its seat, a project and a key.
- **Personal:** the api and Postgres on a machine that stays up, with a node
  on each machine whose CLIs are logged in, one seat per account.
- **Scaled out:** several api instances behind a load balancer that also
  terminates TLS and sends traffic only to instances whose `/readyz` is ok, a NATS server carrying the request topics between them,
  the brain as its own process, and nodes anywhere.
