# Queue routing

Implementation status: phase 1: groundwork merged (#255), decisions recorded (#256); stream, node pull, api tickets, controller pending.

Proposed, 2026-11-26.

Requests reach seats through work queues on NATS JetStream instead of
through the route table. The api admits a request as it does today and
publishes a ticket for it to one queue; a seat with a free slot pulls the
next ticket from the queues it consumes and claims the request from the
api instance that holds the caller; the answer streams back on the
request's reply subject, as today. The brain leaves the request path and
becomes a controller: it reads demand (queue depth and age, seats' load,
waits) and tells each seat which queues to consume, in what order. In a
second phase it also loads and unloads unpinned models by sustained demand.

No measurement backs this design yet. Every number below is from this
repository, its pull requests and its docs, except one a client reported:
a 12k-token prompt took 8.8 s cold against 0.16 s warm on llama-server.

**Terms.** A **provider account** is what a seat runs under and what pays
upstream (local, or a hosted provider's key), with its provider windows and
billing kind: today's `account` (`openapi.yaml` `Account`, store.md
`account`), to be renamed in the API, the store and the UI as a change of
its own (Migration). A **project** restricts which provider accounts its
requests may spend (its `accounts` list), as today. A **billing account**
is a different thing, on the customer side, and routing never looks at it
(Billing accounts, not in this design).

## Why

Once a second the brain writes a ranked table per model
([`brain/routes.hl`](../../brain/routes.hl), `judge`, `model_routes`): a
seat's rank is its provider account's fullest quota window, then its load from
heartbeats (`in_flight` over `concurrency`, weighted 0.01), then jitter
(0.001). The api reads the table on every request and offers the model's
seats in that order ([`api/inference.hl`](../../api/inference.hl),
`admit`, `serve_held`).

The order is the same for every api instance for the whole second: the
jitter is drawn once per seat per tick, in the brain (`brain/main.hl`,
`judged`), so it breaks ties there and spreads nothing. In a burst every
instance offers the same first seat, collects `refused` with `refusal:
capacity` (a NATS round trip each), then the second, and so on. When every
seat refuses, each request waits in its own instance's queue
(`await_turn`) and is offered again when an attempt *on that instance*
ends, or every 250 ms (`SLOT_POLL`; `SLOT_TICK` 20 ms). Instances do not
see each other's slots free, so arrival order holds only within one
instance, and a freed slot goes to whichever instance polls first. The
load it ranks by is up to a heartbeat old (5 s, `HEARTBEAT_MS`,
`api/fleet.hl`).

The node is already the truth about its capacity
([`node/session.hl`](../../node/session.hl), `serve`, `at_capacity`); the
table only guesses at it. Pulling makes the node's own count the thing
that moves work: a seat takes a request only when it has a slot for it.

## The shape

```
  caller ──HTTP──▶ api instance
                   │ admit: key, limits, budget, data class, provider accounts
                   │ choose one partition
                   │ publish ticket ──▶ JetStream stream VOICE_WORK (work queue)
                   │                      <root>.work.m.<model>.<class>.<need>
                   │                      <root>.work.p.<model>.<provider>.<class>.<need>
                   │                      <root>.work.s.<node>.<seat>   (a seat's own)
                   │                              │
                   │                              │ pull, only with a free slot
                   │                              ▼
                   │◀── claim, <reply_to>.claim ── node: a slot of the seat
                   ├── grant (the serve body) ───▶ ack the ticket, run the engine
                   │◀── event / alive / result, <reply_to>.*        (as today)
  caller ◀──SSE────┘

  brain (one, advisory lock): reads consumer info, the fleet, the ledger
    ├─ ensures the stream, and one consumer per partition
    ├─ writes the board to Postgres: seat plans, queue readings
    └─ publishes each node's plan on <root>.node.<node>.consume
```

Four rules carry the design:

- **The queue holds tickets; the api holds the request.** A ticket names a
  request and what eligibility needs. The body stays in the memory of the
  api instance that holds the caller, which hands it to the seat that
  claims it, so content never reaches the stream's storage and "content is
  never written down" ([`docs/internals.md`](../internals.md), "Security")
  holds unchanged.
- **The api instance is the one arbiter of its request.** It grants each
  attempt to exactly one claim. Redelivery, a ticket in two queues and a
  ticket whose caller left are made harmless at the claim, not by the
  queue. The claim also checks that the seat may serve the request (its
  provider account, its data class), so a subject is how work finds a seat
  quickly, never what makes a seat eligible.
- **A seat pulls only with a free slot**, by the node's own count (`busy`
  in `node/session.hl`), as today. Nothing outside the node counts it.
- **The brain steers and never serves.** The data plane runs on the last
  plan it was given, or, with none, on what each node computes itself.

## Subjects and the stream

### Partitions

A partition is the set of requests the same seats may serve. A seat runs
under one provider account, carries some data classes, serves some models,
and carries tools or not (`node/capabilities.hl`, `seat_carries_tools`).
The provider account matters to a subject only when it splits a model's
seats, so a model has one of two shapes:

```
served under one provider account:      <root>.work.m.<model>.<class>.<need>
served under more than one:             <root>.work.p.<model>.<provider>.<class>.<need>
```

- `<root>`: `voice` standalone, the broker's prefix grafted (`heart.<id>`),
  as for every subject today (`lib/broker`).
- `m` and `p`: the shape, so the two never share a filter and a reader
  sees which it is without counting tokens.
- `<model>`: the catalog model the request is served as, after aliases
  (`served_as`).
- `<provider>`: in the `p` shape only, one provider account the request
  may spend.
- `<class>`: its data class. Classes are deployment policy, not a fixed set
  (`openapi.yaml` `DataClass`), and a request has exactly one, so it is a
  token, not a filter: a seat that may not carry a class never sees it.
- `<need>`: `tools` when the request lists tools, else `any`. A seat that
  carries tools consumes both; one that does not (a vLLM variant with no
  tool-call parser) consumes `any` and never pulls what it must put back.

A model's shape counts the provider accounts of the enabled seats that
serve it **in configuration**, not those up now, so it changes only when
an operator (or phase 2) adds or removes a seat, never because a seat went
down. A request for a model in the `m` shape that may not spend its one
provider account is refused at admission, as it is today. A model not on
the board yet (configured since the brain's last tick) is published in
the shape its configuration gives, the same rule the brain applies, and
its consumers come with the brain's next tick.

#### A model changing shape

The brain alone decides a model's shape and writes it on the board with
the board's version; the api publishes in the shape the board says, and
seats consume what their plans name. Both follow the board, so they
switch together, in this order:

1. **One → several** (a seat added under a second provider account). The
   brain creates the `p` consumers, then sends plans in which every seat
   of the model's first provider account consumes the old `m` subjects as
   well as its own `p` ones, and only then writes the board with the `p`
   shape. Tickets already on the `m` subjects were judged against the
   first provider account alone, and only its seats pull them.
2. **Several → one** (the last seat under the other provider accounts
   removed). The same in reverse: `m` consumers, plans adding the `m`
   subjects for the remaining provider account's seats beside their `p`
   one, then the board. Tickets on the removed provider account's subject
   were for seats that are gone; they wait their wait out (`429
   no_capacity`), as a request does today when its seats are removed while
   it waits.
3. **The old subjects drain.** The brain drops them from the plans and
   deletes their consumers once they are empty and the longest wait has
   passed since the switch, so nothing is left behind on them.

An api with a stale board publishes in the old shape, which is still
consumed until step 3, and step 3 waits out the longest wait. A node with
no plan (started while the brain is down) consumes, for each seat, both
the `m` subjects and its own provider account's `p` subjects; a ticket it
must not serve is declined `ineligible` at the claim and put back. The
subject routes; the claim decides.

Ids become tokens by percent-encoding `.`, `*`, `>`, `%`, whitespace and
anything outside printable ASCII; model ids carry dots (`glm-4.7-flash`),
and `glm-4%2E7-flash` stays readable in logs. Each seat also has a queue of
its own, for a conversation's turns (Conversations),
`<root>.work.s.<node>.<seat>`; a ticket there was judged eligible for that
seat by the api.

### The stream

One stream over `<root>.work.>`. Under voice's own NATS (the default
root, `voice`) it is `VOICE_WORK`. Under a habitat's broker (any other
root, `heart.<id>`) it is `VOICE_WORK_` and the first 12 hex digits of
the sha256 of the root, so two hearts on one broker do not collide; a
stream's name cannot carry the root's dots. Its settings:

| Setting | Value | Why |
|---|---|---|
| retention | work queue | a ticket goes when a consumer acks it |
| storage | file | tickets carry no content; they survive a NATS restart |
| max age | the longest wait voice allows (Open question 7) | no ticket outlives any request's wait |
| per-message TTL | the ticket's own wait (`Nats-TTL`; NATS 2.11, as Compose runs) | an expired ticket leaves the depth the brain reads |
| max messages per subject | 1024, a voice constant | a partition's backlog is bounded; past it the publish is refused and the caller answered `429 no_capacity` at once |
| discard | new | a full partition refuses the newcomer, not the oldest waiter |
| duplicate window | 2 min | a copy of a ticket published again (a lost ack, a reconnect) is kept once (`Nats-Msg-Id`); the window is the stream's, whatever the subject |

A ticket is under 1 KiB; the 16 MiB `max_payload`
(`deploy/nats/nats.conf`) is for bodies, which never enter the stream.
Expiry is hygiene, not correctness: a claim on a ticket whose request is
over is declined, so a stale ticket costs a seat one round trip.

**A stream recreated.** When the brain finds the stream gone and creates
it again, it publishes `<root>.queues.reset` (`internal.yaml`,
`QueuesReset`), outside the stream's subjects, with the new stream's
**incarnation**, its creation time in milliseconds:
`{"incarnation": 1764151200000}`. Each api instance remembers the last
incarnation it saw, and on a new one (any, when it has seen none)
publishes again every copy it holds that is not granted, each under that
copy's own message id. The same incarnation told twice is acted on once,
and a copy that reached the new stream already is kept once by its
message id.

### Consumers

A work-queue stream refuses two consumers whose filters overlap, so there
is one durable pull consumer per partition, filtered on its exact subject
and shared by every seat that consumes it. Moving a seat between queues
starts or stops its pulls and never changes a consumer. Its name is `w_`
and the first 16 hex digits of the sha256 of the whole subject, root
included. Ack explicit; ack wait
10 s (Delivery); max deliver unlimited (TTL bounds a ticket's life, claims
make repeats harmless); max ack pending 1024; deliver all. The brain
creates the stream and the consumers, idempotently each tick for every
partition some seat is eligible for, and deletes a consumer no seat has
been eligible for in an hour. Nodes never create consumers.

### Messages

All on the node seam, so in [`protocol.yaml`](../../spec/protocol.yaml):

- **`Ticket`**, published by the api into the stream: `request_id`,
  `attempt`, `reply_to`, `instance`, `model`, `provider_account` (the
  subject's, in the `p` shape; null in the `m` shape), `data_class`,
  `need`, `endpoint` (`responses` or `decision`), `conversation` (the
  first 32 lower-case hex digits of the sha256 of the affinity key, or
  null; Conversations), `enqueued_at`, `wait_until`, `copy` (`shared` or
  `seat`), `avoid` (seats that failed this request, at most 8, as a
  request's attempts are), `size` (voice's estimate of the input, a token
  per four characters, as `input_tokens_estimated`).
  It goes into the stream as one or two **copies**: `shared`, on a
  partition, and, for a conversation's turn, `seat`, on the home seat's
  own queue (The window). Each copy has a `Nats-Msg-Id` of its own,
  `<request_id>.<attempt>.<copy>`, and keeps it for every publish of that
  copy. Dedupe is per stream, not per subject, so two copies under one
  id would be stored once: the shared copy of a turn would be dropped as
  a duplicate of its seat copy, and the turn stranded on a busy seat.
- **`Claim`**, a NATS request from the node to `<reply_to>.claim`:
  `request_id`, `attempt`, `copy`, `seat` (`<node>/<seat>`). The api
  grants each attempt once, whichever copy was claimed; `copy` serves only
  to recognize a repeat (Delivery).
- **`Grant`**, the api's answer: today's `Serve` message, body and all,
  `type: serve`; or **`Decline`**, `type: decline`, with `reason` `taken`
  (another seat has it), `gone` (answered, its caller left, or its wait
  ended), `avoided`, or `ineligible` (the seat's provider account or data
  class is not one the request may use, from the configuration the api
  read at admission). `type` tells the two apart; a grant needs no
  wrapper, since it is the `Serve` message.
- **`ConsumePlan`**, from the brain on `<root>.node.<node>.consume`: per
  seat (at most 16, a node's most), `hold` with its reason, or the
  subjects to consume in order (at most 64). Its `version` is the board's:
  a node's plan is its seats' part of the board the brain wrote, and the
  plan carries that board's version, so a node can say which board its
  plan came from, and ignores a plan older than the one it holds.

`event`, `alive`, `result` and `cancel` are unchanged. `serve` and
`ServeAck` (with `refusal: capacity`) go with the push path (Migration).

**The protocol's version.** A node registers `protocol: 3` once it pulls
(step (c), Building phase 1); from then on the api accepts 2 and 3 for
exactly one release, then refuses 2 (Migration). Until step (c),
`protocol.yaml` marks each channel and message of pulling
`x-voice-protocol: 3`, and registration takes 2 alone.

## A request, end to end

1. **Admit**, as today: the key, the model and its aliases, the provider
   account it names (`voice.account`), the data class, the rate limits
   (`hold`, `api/admission.hl`); the budget's reservation when it lands
   (store.md, "Reserve").
2. **Choose a partition.** In the `m` shape there is one: the model, its
   class and need. In the `p` shape, the provider accounts the request may
   spend (the key's and the project's lists, or the one it names) that a
   seat of the model runs under give its eligible partitions (`allowed`,
   applied to partitions instead of seats). The api picks one (Choosing a
   partition), or a seat's own queue first for a conversation. If the board says nothing consumes any of them: `503
   no_eligible_seat` at once, with the reason `unmet` gives today.
3. **Publish** the ticket on the attempt's connection and wait for the
   stream's ack (`js_publish_id`). A full partition is `429 no_capacity`.
4. **Wait for a claim** until `wait_until`: the `voice.deadline`, or 60 s
   (`SLOT_WAIT`), as today. The caller is looked for every 250 ms
   (`caller_gone`); that look stays, the re-offer that shared its loop
   goes. Out of time: `429 no_capacity` or `504 deadline_exceeded`.
5. **Grant** the first claim for the attempt; any later one is `taken`.
   The request is in flight on that seat (`flying` writes `in_flight`, as
   at `accepted` today).
6. **Serve and relay**, unchanged: `read_over` and `api/stream.hl`, 120 s
   to the first output (`--seat-first-s`), 30 s between messages after
   (`--seat-idle-s`), `cancel` on `<root>.node.<node>.cancel`.
7. **Retry** before output: a new attempt and ticket, the failed seat in
   `avoid`, to the same partition when the board shows another seat
   consuming it; else `502` with the attempts, as when every seat fails
   today. After output, the response fails, as today.
8. **Settle**, unchanged. `timing.queue_ms` runs from the first publish to
   the grant that served it.

A node's slot with a free place pulls a ticket, checks it (a ticket that
avoids this seat is put back with a delay; one past `wait_until` is acked
and dropped), claims it, acks it on `Grant` or `Decline`, and on `Grant`
runs the engine as a slot runs an accepted `serve` today
([`node/serve.hl`](../../node/serve.hl)).

## Delivery semantics

- **Ack on grant**: before the engine starts, before any output. A grant
  is the seat accepting the request, as `accepted` is today. A `Decline`
  is acked too, the ticket having no further use, except `ineligible`,
  which is put back at once for a seat that may serve it.
- **Redelivery.** A ticket pulled and not acked within the ack wait (the
  node died or lost NATS between pull and grant) goes to another puller.
  The api dedupes by `request_id` and `attempt`, across copies: if the
  first claim was granted, the next is `taken`; if it never reached the
  api, the next is granted. Only a repeat of the granted claim itself
  (the same seat and the same copy, its answer lost) gets the grant
  again. The home seat consumes the shared partition too, so it may pull
  both copies of its own turn; the second is `taken` like any other, and
  no seat is ever granted an attempt twice.
- **A seat that dies between grant and ack.** The ticket comes back and
  every claim on it is `taken`; the api's wait for that seat's first
  output fails the attempt (120 s at most, as for a seat that accepted and
  went silent today), and step 7 publishes a new attempt. It needs a node
  to die within the milliseconds between grant and ack.
- **A seat that dies mid-stream** fails the reply as today (an `error`
  event and `response.failed`, or a last chunk finished `error`) and is
  never run again; nothing of it is left in the stream.
- **Ack wait against model load and first token.** They do not meet. A
  seat pulls only while `up`, its model loaded and smoke-tested
  (`node/smoke.hl`), so no load falls inside the ack wait; the first token
  comes after the ack, under the api's timers as today. The ack wait
  bounds pull, claim and ack, milliseconds on the private network; 10 s
  leaves room for a claim's 2 s timeout and one retry.
- **A publish whose ack is lost** is sent again with that copy's own
  `Nats-Msg-Id`, kept once within the duplicate window. Two message ids
  serve two copies; one grant serves one attempt. The message id keeps
  the stream from storing a copy twice; it never decides who serves.
- **Cancelled, expired and granted requests.** Nothing is deleted: the
  api declines every later claim on any copy (`gone`, or `taken` once
  granted), and the TTL removes a copy no seat pulled. A turn's other copy
  is left behind the same way once one is granted. Deleting a copy by its
  sequence (each copy's publish ack gives its own) would keep the depth
  exact sooner; optional, and pond work.
- **A model nothing serves.** No eligible seat: `503 no_eligible_seat` at
  admission, as today. Seats eligible but none consuming (down, held,
  draining): refused by the board, as the empty route table refuses it
  today. With the board stale (the brain down), the ticket waits its wait
  out, then `429 no_capacity`, and the TTL removes it.

## Choosing a partition

A model in the `m` shape has one partition per class and need, so its
requests have no choice to make; that is every model served under one
provider account, which is most of them: a placement names the provider
account its seats run under, commonly one for all of an operator's local
models. The choice arises only for a
model in the `p` shape when the request may spend more than one of the
provider accounts it is served under, and names none. It goes to exactly
one:

1. Exhausted provider accounts (a provider window at 100%, as `judge`
   reads it) are left out, as the route table leaves them out today.
2. The provider accounts with the most headroom first, as the rank's
   first term today; headroom within 10 points counts as equal.
3. Among those, two partitions drawn at random, weighted by their
   consuming free slots, and the one with the shorter expected wait on the
   board (depth over free slots, times recent service time) is taken.

**Headroom is read at admission.** The api reads each provider
account's windows from `quota_window` (`store.md`) when it admits the
request, the windows the nodes last reported, and never from the board.
The board carries queue readings (each with its recent service time),
models' shapes and seats' plans, and no provider account's headroom.

Every instance reads the same board, up to a second old, so step 3 draws
with randomness of its own rather than taking the best: a shared stale
view must not send every instance's next request to one partition, the
failure this design removes for seats. A wrong choice costs a wait in a
longer queue, never a refusal.

## Conversations

A turn should reach the seat whose engine holds its prompt cache. A miss
re-reads the whole prompt: on the client's report, 8.8 s cold against
0.16 s warm for 12k tokens. Today the api offers first the seat the
conversation's key hashes highest with (`first_for`, rendezvous hashing,
`key_hash`), the key being the request's `prompt_cache_key` or one derived
from its opening (`affinity_of`, `derived_conversation` in `api/usage.hl`,
#221).

A conversation is named, on a ticket and in `seat_conversation`, by the
first 32 lower-case hex digits of the sha256 of that key, the one
`affinity_of` returns: never the key itself, and the form
`seat_conversation`'s check takes.

### Where a conversation is

- **The api writes it at the grant**: `seat_conversation` (`conversation`
  hash, `seat`, `at`), upserted when an attempt is granted. An agent's next
  turn usually follows within seconds, sooner than a heartbeat, so the
  grant is the record.
- **The node corrects it.** It keeps, per seat, a least-recently-used list
  of the conversation hashes its tickets carried, as many as the engine
  holds, and sends it with every heartbeat; the list replaces that seat's
  rows older than the heartbeat, so a conversation the engine evicted
  stops pointing at it. This, and pruning old rows by age, come with steps
  (c) and (d) (Building phase 1): the node's list with its pulls, the
  api's use of it with its tickets. Until then no request's path writes
  or reads the table.
- **The api reads it at admission**, one indexed row. With none, or one
  whose seat no longer consumes the partition, the home seat is the one
  the key hashes highest with among the partition's consuming seats
  (`first_for`, unchanged), so a new conversation lands where every
  instance would put it.

No conversation map crosses NATS and the brain is not asked. The hint is a
Postgres read, and it cannot stampede: each conversation is its own.

How many conversations a seat holds is its runtime's, kept beside its
concurrency ([`lib/concurrency`](../../lib/concurrency/concurrency.hl), a
new `conversations_held`):

- **llama-server**: its slots, at most 4 (`LLAMA_SLOTS_MAX`; the placement
  sizes the prompt cache for `CACHED` conversations, `api/placements.hl`).
  A slot holds one prompt and the server restores a returning one itself,
  which naming `id_slot` defeats (#221). A miss is a full prefill.
- **TensorFold**: kept prompt states of a fixed ~6.4 MiB whatever the
  prompt's length (`TF_STATE_BYTES`), four per conversation, in 2 GiB
  (`--prompt-cache-gib`, `node/tensorfold.hl`): about 80 conversations.
  #221 saw resumes at 169,984 of 173,865 tokens; a miss there is a very
  long prompt read again.
- **vLLM**: prefix caching over paged blocks shared by every sequence,
  evicted least-recently-used under pressure, so not a count; the node
  reports its last 32 (`VLLM_MAX_SEQS`) as a floor.
- **Hosted upstreams**: none. A provider's prompt cache belongs to the
  provider account, not the seat, so such a turn goes straight to the
  shared partition.

### The window

The api publishes the turn's ticket to the home seat's own queue, which
that seat pulls before any shared partition: the `seat` copy,
`<request_id>.<attempt>.seat`. With no claim within `W`, it publishes the
`shared` copy of the same attempt, `<request_id>.<attempt>.shared`, to the
shared partition; its own message id is what lets the stream keep it.
The first claim on either copy is granted, any other on either is
declined `taken`, and nothing is withdrawn from the stream.

```
W    = min( miss / 2,  10 s,  (wait_until − now) / 2 )
miss = size / prefill_rate(seat)
```

`prefill_rate` is the seat's measured rate of reading uncached input
(input not cached over time to first output, from the node's readings,
`node/readings.hl`, reported with the heartbeat); until a seat has one,
`W` is 1 s. Waiting half the miss bounds the worst case at one and a half
misses (wait it out, then miss anyway) and keeps most of the gain when the
seat frees in time. On the client's report, `miss` is about 8.6 s and `W`
about 4.3 s. `W` is 0, straight to the shared partition, when the home
seat is held or not consuming, when its queue already holds as many
tickets as its concurrency, or when its runtime holds no conversations.

## The brain: from table writer to controller

Leadership stays: one brain works, holding the advisory lock
(`BRAIN_LOCK`); a standby takes over within about 11 s; the tick is a
second. Reclaim and node liveness stay in the tick. Each tick, the working
brain:

1. **Judges each seat** as `judge` does (`brain/routes.hl`): enabled, `up`
   for its node's current assignment, not held locally, on a node up and
   not draining, its provider account active and not exhausted, a pair's leader
   with its follower up (`part_routes`). A seat that fails is **held**,
   with why, where the table dropped it.
2. **Reads the queues**: per partition, its consumer's pending, waiting
   pulls (idle pullers) and ack pending, and its oldest ticket's age; from
   the ledger, the last minute's `queue_ms` and service times per model.
3. **Orders each seat's partitions**: its own queue first, then, for a
   seat that serves several models (an upstream; a placement's seat serves
   one), by pressure: oldest age over recent service time. The order
   changes only when a new head's pressure has been at least twice the old
   head's for three ticks, so it does not flap. Phase 1 orders and holds;
   it never takes a partition from a seat, so none loses its last consumer.
4. **Writes the board** in the same transaction as node liveness: one row,
   versioned as the route table is, with every seat's plan and every
   partition's reading.
5. **Publishes** each node's `ConsumePlan` when it changed and every 30 s
   regardless (core NATS delivers at most once); a heartbeat reporting an
   older plan is answered with the current one, as an assignment is today.
6. **Ensures** the stream and the consumers.

Plainly: a placement's seat serves one model, so on a fleet of placements
reordering moves nothing between models. There phase 1 gains the end of
the stampede and of the 250 ms re-offers, and delivery by free capacity.
Moving capacity between models on such a fleet is loading and unloading:
phase 2.

## Pairs

A placement across two nodes serves from its leader's seat (rank 0); the
follower's seat of the same id serves nothing (`protocol.yaml`, "A model
across two nodes"). Only the leader consumes: the follower's node knows its
rank from the seat's config (`cluster.rank`, `rank_of` in
`node/tensorfold.hl`) and never pulls for it. The brain holds the leader
while the follower is not up, as `part_routes` keeps it out of the table
today. With the brain down the leader pulls on; if the follower dies, the
leader's engine fails requests before output and they move as any failure.

## Fairness and priority

- **Within a partition**, first in, first out: JetStream delivers in
  stream order and a ticket put back before newer ones. That is stronger
  than today, whose order holds only within one api instance.
- **Across a seat's partitions**, its own queue, then the brain's order. A
  seat with free slots sweeps its partitions in order without waiting;
  only when all are empty does it hold a standing pull on each, and the
  first ticket to arrive is served. Order applies when there is a backlog,
  which is when it matters.
- **Per project, at admission.** Limits and budgets stay api-side, in
  front of the queue: a request past a limit never takes a place. A
  project's burst can fill a partition ahead of others; `requests` per
  window bounds it today, and `concurrent` becomes enforceable once the
  reservation lands (today it is shown, not enforced). A partition holds
  at most 1024 tickets whatever the projects.
- **Budgets are the project's**, enforced at admission as today; a
  billing account's rollup (below) enforces nothing on the request path.
- **No priority classes** in phase 1; one would be a further partition per
  model that seats sweep first.

## Billing accounts (not in this design)

A **billing account** is the customer-side umbrella: it owns one or more
projects, and each project belongs to exactly one, and it rolls their
usage up into one bill. It has no users; identity stays upstream. It does
not exist yet, and it lands as its own change: its table in the store,
each project's owner, its rollup of `usage_hourly` (store.md, Migration
40), and its admin API and UI.

Routing never looks at it. Eligibility is the project's (its provider
accounts, its data classes), limits and budgets are the project's and the
key's at admission, and a ticket names no billing account. Its rollup is
reporting and billing, read from the ledger after the fact.

It is not a project's `parent` (store.md, Migration 14). `parent` stays
what it is, the habitat's nesting of tenant projects, through which a
child inherits its parent's grants, aliases and peek. The billing account
is a separate owner: a child project and its parent may be billed to the
same billing account or to different ones, and nothing in `parent`
changes when billing accounts arrive.

## What changes, by component

**api.** Admission (`served_as`, `hold`, `admit`'s checks) stays. `admit`
returns the eligible partitions in the model's shape and a
conversation's home seat, reading the board, `seat_conversation` and the
provider accounts' `quota_window`, not the route table. `serve_held`
becomes publish, wait for a claim, grant, read; the offer loop,
`at_capacity` and its `busy` count go. The capacity wait goes:
`await_turn`, `waiting`, `queued`, `taken`, `leave`, the queue's text
(`queue_joined`, `queue_marked`, `queue_left`, `queue_waits`,
`queue_ahead`), `seats_key`, `SLOT_POLL` as a re-offer period, `SLOT_TICK`
and the instance's `ended`; `SLOT_WAIT` and `SLOT_RETRY_AFTER` stay.
`voice.attempts` lists grants that did not serve; a capacity refusal never
was an attempt and no longer exists, and a declined claim is none. `Link`
([`api/link.hl`](../../api/link.hl)): `offer` becomes `publish(ticket)`,
whose attempt subscribes to `<reply_to>.>` as now and answers `.claim`,
checking the claiming seat against the seats `admit` read (`allowed`);
`read_over`, `next`, `finish`, `cancel` and the connection per attempt
stay. The hosted tool's rounds (`serve_hosted`) each publish a ticket.
`getRoutes` gives way to `getQueues`; the node plane's heartbeat takes
seats' conversations and prefill rates and answers a newer plan.

**node.** Seats become pull clients. The session keeps per seat how many
slots it may still take (its concurrency less what it serves, within the
node's `SLOTS`, 40) and pulls only while that is above zero, and never for
a held seat, a follower or a seat not `up`. Pulls are requests on the
session's own connection, to the inbox it already reads (`read_msg`), so
none blocks a thread; a ticket is handed to a free slot as a `serve` is
(`ServeJob`), and a surplus from several standing pulls is put back at
once. The slot claims with its own client, acks and serves. The
accounting (`busy`, `free_slot`, `busy_without`, `in_flight`) is
unchanged; a claiming slot is busy. Its plan is the last `ConsumePlan`,
or, with none, every partition its assignment makes it eligible for (each
seat's `serves` × `data_classes` × needs, in the `m` shape and in the `p`
shape under its own provider account; a ticket it must not serve is
declined `ineligible` at the claim), so a node never
waits on the brain to serve. Draining stops every pull at once; what it
holds runs to its result. Heartbeats carry each seat's conversations,
prefill rate and plan version, from step (c) (Building phase 1); the
heartbeat has none of them before. `assign` and the node plane are
unchanged; `serve` stays until the push path goes.

**brain.** `routes.hl` becomes `plan.hl`: `judge`, `seat_concurrency` and
`part_routes` stay; `route_table` and `model_routes` go; the plan, the
board and the stream's upkeep come, over one more pinned NATS connection
on its own thread, so the tick never waits on it, as `route_conn` now.

**store.**

| Stays in Postgres | Changes |
|---|---|
| configuration, the change log | — |
| counters and reservations, `request`, reclaim | — |
| the ledger, `in_flight` | `in_flight` written at the grant |
| the fleet as reported | heartbeats add conversations and prefill rate |
| `route_table` | becomes `board`: one versioned row of seat plans and queue readings |
| — | `seat_conversation` (`conversation`, `seat`, `at`), pruned by age |

A waiting request has no row: until its grant it exists in its instance's
memory and as a ticket, as it exists only in memory in `await_turn` today.
Once the reservation lands, its `request` row covers it from admission.

**spec.** `protocol.yaml` (version 3): the work subjects, `Ticket`,
`Claim`, `Grant`, `Decline`, `ConsumePlan` and its subject (#255), the
heartbeat's new fields (step (c)); "Serving" rewritten for pull; node
permissions to pull from the work consumers, ack, and receive claims'
answers on an inbox; `serve` and `ServeAck` removed with the push path.
`internal.yaml`: `route` and `RouteNotice` go; the stream's and
consumers' configuration, `Board` (successor of `RouteTable`,
`ModelRoutes`, `SeatRoute`) (#255) and the reset notice
(`QueuesReset`) come. `node.yaml`: `/node/v1/status` shows each seat's
plan and standing pulls (step (c)). `openapi.yaml`: `getQueues` replaces
`getRoutes`; the heartbeat's body; `voice.attempts` described as grants.
`store.md`: the board, `seat_conversation`, and the migration dropping
`route_table`.

## Failure modes

| What fails | What happens |
|---|---|
| The brain | Nodes pull on their last plan; a node started meanwhile pulls on its own eligibility. The board goes stale: partition choice and windows use the last hints, and a model whose seats are all down waits its wait out instead of being refused at once. New partitions get no consumer until a brain works; a standby takes over within about 11 s. |
| NATS | Nothing is served, as today: the publish fails and the caller is answered `503` at once; granted requests fail by the api's timers. |
| JetStream alone (core NATS up) | The publish meets no responder: `503` at once. No fallback to offering a seat directly: a second path kept for outages is a second path to keep working. |
| A node, from NATS | Its pulls stop, so it takes no new work (today: an offer, 5 s without an ack, the next seat). Tickets it pulled and had not acked come back after the ack wait. What it was serving fails by the api's timers: retried elsewhere before output, failed after. |
| A node, from the api only | Missed heartbeats mark it down after 15 s; the brain holds its seats, and it stops pulling once the plan reaches it over NATS. |
| The stream lost | The brain recreates the stream and consumers on its next tick and publishes a reset on `<root>.queues.reset` (outside the stream's subjects) naming the new stream's incarnation (A stream recreated); each api instance, on an incarnation new to it, publishes again every copy of its requests not yet granted, each under that copy's own message id. Granted requests are out of the stream and run on. Postgres holds what is in flight (`in_flight`; `request` once reservations land), not what waits: only the waiting request's instance knows it, and it republishes. |
| An api instance | Its callers' connections end with it, and nobody else can answer them: a caller's HTTP connection is to one instance. Its unclaimed tickets are orphans: a claim meets no responder at once, and the seat acks and pulls the next; the TTL clears the rest. What it granted runs to a result nobody reads, as today. The brain reclaims its rows, as today. A stop it is told of (SIGTERM) answers its unclaimed callers `503` with `Retry-After: 1` and serves what it has granted. |
| A provider account's quota | The brain holds its seats until the window resets; the api leaves its partitions out; a request that named it is `503 no_capacity` with `Retry-After`, as today. |
| Postgres | Nothing is served and nothing is configured, as today. |

## Observability

- **`GET /admin/v1/queues`**, the board as the brain last wrote it: per
  partition, its shape, model, provider account (`p`), class and need,
  depth, oldest ticket's age, waiting pulls, ack pending and consuming seats; per seat, its plan
  (held and why, or partitions in order), concurrency, in flight and
  conversations held. Read from the store, as `getRoutes` is.
- **The admin UI.** The Routes screen (`ui/apps/admin/src/screens/Routes.tsx`)
  becomes Queues: per model its partitions with depth and oldest age, the
  seats consuming each with free slots, a held seat with its reason. The
  live view (`Network.tsx`) draws a queue between the api instances and a
  model's seats, depth as a badge and age by color, its edges the plan; a
  request is lit on the queue while it waits and on the seat once granted.
  The hub tells each new board version, as it tells the admin plane's
  rows, so neither screen polls.
- **The ledger**: `timing.queue_ms` per request; the usage summaries can
  show it per model and hour.
- **Logs and readings**: the brain logs a plan change once, per seat, with
  why; the node's readings count standing pulls, claims made, claims
  declined by reason and tickets put back.

## Pond: what JetStream support there is

The vendored copy ([`lib/pond/realtime/nats/jetstream.hl`](../../lib/pond/realtime/nats/jetstream.hl);
pond `v0.9.0` with hale's changes and `max_ack_pending`,
[`lib/pond/README.md`](../../lib/pond/README.md)) has:

- `js_stream_create(name, subjects)`: file storage over the subjects and
  nothing else, so limits retention, no age, count or size bound, the
  default duplicate window; created again unchanged, no error.
- `js_stream_delete`.
- `js_consumer_create(stream, ConsumerSpec)`: a durable pull consumer, ack
  explicit, a deliver policy, one `filter_subject`, `ack_wait_ms`,
  `max_ack_pending`.
- `js_publish`, `js_publish_id`: an acknowledged publish, optionally with
  `Nats-Msg-Id`; `PubAck` gives stream, sequence and `duplicate`.
- `js_next(stream, consumer, wait_ms)`: a pull of one message as a
  blocking request on the client's connection; 404 and 408 are
  `no_messages`.
- `js_ack`: `+ACK` on the message's reply subject.

Only the teller uses it, on the organization's nerves (`api/teller.hl`).
Voice's own NATS runs JetStream since #255 (`deploy/nats/nats.conf`: its
store in Compose's `nats` volume), which nothing uses yet.

The gaps this design needs closed, each by a pull request to pond:

1. **Stream settings**: work-queue retention, max age, max messages per
   subject, discard policy, duplicate window, per-message TTL
   (`allow_msg_ttl`); and `STREAM.UPDATE`, since a changed stream is
   refused by `js_stream_create`. hale-lang/pond#37 (`StreamSpec`,
   `js_stream_create_with`, `js_stream_update`).
2. **Consumers**: `max_deliver` (none is sent, so the server's default
   applies) and `CONSUMER.DELETE`. hale-lang/pond#37
   (`ConsumerSpec.max_deliver`, `js_consumer_delete`).
3. **Reading state**: `CONSUMER.INFO` (pending, waiting pulls, ack
   pending), `STREAM.MSG.GET` (the oldest ticket's time), stream info.
   hale-lang/pond#39 (`js_consumer_info`, `js_stream_msg_next`,
   `js_stream_info`).
4. **Acks**: `-NAK` with an optional delay, for a surplus ticket and one
   that avoids the seat. `+TERM` is useful, not required.
   hale-lang/pond#38 (`js_nak`, `js_term`).
5. **A pull that does not block**: `MSG.NEXT` published with a batch, an
   expiry and `no_wait` to an inbox the caller already reads, and the 404,
   408 and 409 statuses that arrive there. `js_next` holds its connection
   for the whole wait, so a node pulling several partitions would need a
   connection and a thread for each. hale-lang/pond#38 (`JsPuller`).
6. **Headers on an acknowledged publish** beyond the message id, for
   `Nats-TTL`. The client has `pub_headers` and `request_with`; the
   wrapper builds only `msg_id_headers`. hale-lang/pond#39
   (`js_publish_headers`, `with_header`; and `NatsError.code`, which
   tells a full partition from other refusals).
7. **Delivery metadata**: stream sequence, delivery count and time, which
   the `$JS.ACK.…` reply subject carries; a small parser.
   hale-lang/pond#38 (`js_meta`).
8. *Optional*: `STREAM.MSG.DELETE`, to remove a cancelled ticket at once.
   hale-lang/pond#39 (`js_stream_msg_delete`).

Voice's three local patches, marked `voice:` in its copy (`NatsPublisher`
logging through `std::log`, `NatsClient.inbox_prefix`, and the
latest-value write's liveness), are on pond's main already, with the older
pieces voice relies on. So voice re-vendors once, to pond's main after
those three pull requests merge, and its copy then carries no patch of
its own. Outside pond: grafted, the heart's broker account needs
JetStream with limits and the nodes' account permission to pull from the
work consumers and ack (`compose.yaml`'s header).

## Migration

Both paths run for one release, chosen per request by the fleet, with no
flag:

1. **Pond** gains the above; voice re-vendors it.
2. **JetStream is on** in Compose (#255) and, grafted, in the heart's NATS
   account.
3. **The brain** ensures the stream and consumers and writes the board
   and plans, and still writes the route table.
4. **The node** speaks protocol 3 and registers `protocol: 3`: it pulls
   and still answers `serve`, one `busy` count covering both, so a slot
   taken by a push is not pulled for. From the release that ships it, the
   api registers nodes of protocol 2 and 3 alike, for exactly that one
   release.
5. **The api** queues a request when every seat that could serve it is on
   a node of protocol 3, and offers it as today otherwise. A fleet moves
   model by model as its nodes upgrade, with nothing for the operator to
   set.
6. **The next release removes the push path**: `serve`, `ServeAck`,
   `refusal: capacity`, the offer loop and capacity wait, the route table
   in brain and store (a migration drops `route_table`), `getRoutes`, the
   `route` subject, the Routes screen. A node of protocol 2 is then
   refused at registration, naming the release it needs.

**The rename is a change of its own.** `account` becomes provider account
in the API (`/admin/v1/accounts`, `Account`, `voice.account`, a seat's
and a project's and a key's `account` and `accounts`, `account_not_permitted`),
the store (the `account` table, `seat.account`, `quota_window.account`,
`usage.account`, `request.requested_account`) and the UI, separately from this
design and in either order with it. Until it lands, read "provider
account" here as today's `account`, and the subjects' `<provider>` token
and the ticket's `provider_account` as an `account` id; the wire names
this design adds follow whichever name is current when they are built,
so it adds no second word for the same thing.

[`DIRECTION.md`](../../DIRECTION.md) holds the route table as an axiom
("Routing is client-side, from a published distribution", and the process
model's paragraph on the brain), describing a weighted distribution in a
key-value bucket that was never built. Accepting this design replaces it.
Proposed wording:

> `axiom` **Seats pull their work.** The api admits a request and
> publishes a ticket for it to one work queue on JetStream, partitioned by
> what eligibility needs; a seat with a free slot pulls from the queues it
> consumes and claims the request from the api instance that holds the
> caller, which grants it once. The brain plans which queues each seat
> consumes and is never on a request's path.

### Building phase 1

Phase 1 is built in five steps, each merged on its own, and none changes
how a request is served before (d):

- **(a) Groundwork** (#255): the contract of protocol 3, each channel and
  message marked `x-voice-protocol: 3`; `lib/work` (subjects, message
  ids, consumer names, the stream's settings, the messages' codecs); the
  `board` and `seat_conversation` tables (store.md, Migration 47);
  JetStream in Compose's NATS.
- **(b) The stream**: pond's gaps closed and re-vendored (Pond), and the
  brain ensuring the stream and the consumers (Migration, steps 1 and 2,
  and step 3's stream and consumers).
- **(c) Node pull**: Migration's step 4. The node registers
  `protocol: 3`, pulls, keeps each seat's conversations, and reports on
  its heartbeat each seat's plan version, conversations and prefill rate,
  and on `/node/v1/status` its plans and standing pulls.
- **(d) Api tickets**: Migration's step 5. The api publishes tickets and
  answers claims; it writes `seat_conversation` at the grant, corrects it
  from the heartbeats' conversations, and prunes its old rows.
- **(e) The controller**: the brain's board and plans (The brain).

## Phase 2: loading and unloading by demand

Not built first; a sketch, to show phase 1 leaves room for it.

**The loop.** Every 30 s the working brain reads each catalog model's
demand over the last 5 and 30 minutes: tickets published, the oldest
ticket's age at its 95th percentile, `queue_ms`, and requests refused for
want of a consuming seat (a row per model and minute the api writes when
it answers `503 no_eligible_seat`).

**Candidates to load**: catalog models whose recipe the operator allows,
fitted to a node or pair by the fit a placement is judged by
(`api/placements.hl`: `fit_recipe`, `beside_problem`, `pair_problem`,
`placeable_problem`), searched as the arranger searches (`api/arranger.hl`,
`plan_fleet`), preferring a variant a node's store holds whole
(`api/downloads.hl`: a reload, not a download), under a provider account
active, not exhausted and within its limits. Loading a model under a
second provider account changes its shape, which the brain handles as
any change of shape (Subjects and the stream). A load's cost is known
in part: on a DGX Spark serving gpt-oss-120b, vLLM started in 17.96 s with its compiled
graphs kept and 46.15 s without, and read 65 GB of weights in 6.82 s with
fastsafetensors (internals.md, "A node's data directory").

**Hysteresis.** Load when a model's demand has gone unmet for 5 minutes
(its oldest ticket past its service time several times over, or requests
refused for want of a seat). Unload only after 30 minutes with no ticket
and nothing in flight, *and* only when a load wants the memory. A loaded
model stays at least 15 minutes. One change in progress per node; after a
failed load, that model and node wait an hour. A swap only when the
newcomer's unmet demand exceeds the incumbent's recent use by a clear
margin.

**Safety.** **Pins are never touched.** This loosens the earlier rule that
the arranger proposes and never applies (README: an arrangement "plans
nothing on its own"); the loosening covers unpinned models only (Open
question 6). A model with requests in flight or tickets waiting is never
unloaded: its seats are held, drained, then removed. The last placement
of a model an alias points to (a project's, `api/aliases.hl`, or a
role's) is never unloaded. No load exceeds a node's memory for models or
runs under an exhausted provider account.

**Recording and display.** The brain writes no configuration: it shares
nothing with the api but Postgres, and placing is the api's write. It
queues a decision in Postgres, which any api instance applies through the
code an operator's placement runs, as annotations were once queued for any
instance (store.md, Migration 25). Each applied decision is a change in
`/admin/v1/changes`, its principal `voice`, its `before` and `after` the
placement, with the signals that moved it. The Placements screen marks a
placement voice made and why ("loaded for demand: oldest wait 40 s for
5 min"); the Arrange screen shows them apart from the operator's.

## Open questions

Each with a recommendation.

1. **Ticket or body in the stream?** A body would write prompts to NATS's
   disk, up to 12 MiB each, to a server Compose holds to 256 MiB of
   memory. *Recommend tickets and claims*, one round trip per request.
2. **What goes in the subject?** *Recommend model, class and need, and
   the provider account only for a model served under more than one*
   (the `m` and `p` shapes), never the project or the billing account: a
   token per project multiplies consumers by projects and makes every
   seat sweep them.
3. **Several provider accounts eligible.** With the provider account in
   the subject only for a model in the `p` shape, this arises only for
   such a model, and only for a request that may spend more than one of
   its provider accounts and names none. *Recommend the choice above*
   (headroom, then two random draws by expected wait). The alternative
   is to send a request that may spend every provider account the model
   is served under to the model's `m` subject, consumed by all its seats,
   and keep `p` subjects for restricted requests: one queue and no choice
   for the common case, but what "every" means moves with configuration,
   so more of the decision would rest on the claim's eligibility check.
   Not first; worth it if such models turn out common.
4. **The conversation window.** *Recommend `W` = half the estimated miss,
   at most 10 s and half the time left*, with no setting; revisit once
   there are measurements.
5. **Where the api learns a conversation's seat.** *Recommend
   `seat_conversation`*, written at the grant and corrected by heartbeats,
   with rendezvous hashing for a conversation no seat holds; not a hint
   from the brain, which would put it back on the request path.
6. **What is pinned in phase 2.** *Recommend: the controller unloads only
   placements it made itself* (marked by their origin). Every placement
   an operator made, by hand or by applying an arrangement, and every
   model a saved arrangement pins, is pinned.
7. **The longest wait.** A request with a `voice.deadline` waits for a
   slot until that deadline, however far; the stream's max age must bound
   every ticket. *Recommend at most 10 minutes whatever the deadline*, the
   stream's max age the same.
8. **Node permissions.** All nodes share one NATS account, so any node
   could pull any partition, as any can read every node's requests today.
   *Recommend accepting it for now*; per-node users, when they come, pull
   only from their seats' partitions.
9. **One release of both paths.** *Decided*: a node registers protocol 3
   once it pulls (step (c)); the api accepts 2 and 3 for exactly one
   release, then refuses 2 at registration.
10. **Failing a silent granted seat sooner.** A node sending `alive` each
    second from the grant until first output would let the api fail it in
    the idle span (30 s) rather than the first span (120 s). *Recommend
    leaving it out of phase 1*; today's timers apply alike.

## Rejected alternatives

- **Live views or credits in the api** (each instance tracking seats'
  load, or the brain handing out slot credits): every instance still acts
  on a shared, slightly stale view, and in a burst all act on the same
  one; credits move the stampede to their refill.
- **The brain per request**: one process on every request's path, a
  latency and a single point of failure, against the process model's
  split.
- **Core NATS queue groups**: NATS pushes to a subscriber at random,
  whether or not it has a free slot, so a busy seat refuses and the
  request moves on, as today; nothing waits durably, nothing redelivers.
- **The body in the stream**: Open question 1.
- **A consumer per seat** filtering several subjects: a work-queue stream
  refuses consumers whose filters overlap, so two seats could not share a
  partition.
