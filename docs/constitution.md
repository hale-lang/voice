# Voice's constitution

Proposed. What `hale check` proves of voice's programs, as
[claims](https://github.com/hale-lang/hale/blob/v0.38.0/docs/src/claims.md)
over each program's closed world: the architectural invariants that [DIRECTION.md](../DIRECTION.md),
[internals.md](./internals.md) and
[queue-routing.md](./design/queue-routing.md) state in prose, as far as
hale v0.38.0 (voice's pin) can say them. A claim compiles to nothing; one
that a change breaks fails the check with the path that breaks it.

The law is one policy seed, [`lib/law`](../lib/law/law.hl): the vocabulary
(groups over the libraries the programs share), a base constitution every
program is held to, `Voice`, and one constitution per program, since what
each may reach differs. The repository's [`hale.toml`](../hale.toml) binds
them, hale's mechanism for a project of several programs:

```toml
[claims]
base = "Voice"

[environments.api]
constitution = "VoiceApi"
entrypoints = ["api"]
# ... and node (VoiceNode), brain (VoiceBrain), decide (VoiceDecide)
```

| Program | Held to | Environment |
|---|---|---|
| api | `Voice` + `VoiceApi` | `api` |
| node | `Voice` + `VoiceNode` | `node` |
| brain | `Voice` + `VoiceBrain` | `brain` |
| decide (voice-decide) | `Voice` + `VoiceDecide` | `decide` |

Each program imports `lib/law`, so the names resolve in its world; the
import itself binds nothing. `program` in a claim is the checked program's
own declarations: every locus and fn of its seed, none of an import's. The
api declares one group of its own the law names, `hosted_fetch`
([`api/web_fetch.hl`](../api/web_fetch.hl)). An environment here names a
program, not a deployment: one per program, because each is held to a
different law, and hale requires every entrypoint in an environment to
resolve its constitution alike. The api's roles are mapped to `[]`: what
holds them is a token a request presents, never an OS account.

### Which commands enforce it

| Command | Holds a program to the law |
|---|---|
| `hale check --matrix .` at the repository's root | yes: every (program, environment) pair, base and environment constitution; a seed with a `main locus` that no environment lists fails (`entrypoint ./decide is in no environment`) |
| `hale check api`, `hale build api`, `hale test api` | no: a plain check reads no environment, so a violation passes it (proved below) |
| `hale check api --env api` | no: `--env` reads the nearest manifest, which is the program's own `api/hale.toml` (its `[deps]`), and that declares no environment (`no environment `api` in …/api/hale.toml`) |
| `hale check api --adopt VoiceApi` | yes, for that program alone: `VoiceApi` extends `Voice`, so the base comes with it; for trying a claim without the matrix |

CI runs `hale check --matrix .` in the api, brain, decide and node jobs
(`.github/workflows/ci.yml`, "The constitution holds for every program").

## The invariants

| Invariant | Status | Enforced by, or why not |
|---|---|---|
| The node never reaches Postgres | enforced | `node_never_reaches_postgres`, with one hole: a connection built and used in the same fn is not seen (Gap 2) |
| Only the api grants (answers a seat's claim) | enforced | `node_never_grants`, `brain_never_grants` |
| Only the api enqueues tickets; only seats claim and take them | enforced | `node_never_writes_a_ticket`, `brain_never_writes_a_ticket`, `api_never_claims`, `api_never_reads_a_ticket`, `api_never_consumes_work`, `brain_never_reads_a_ticket`, `brain_never_claims`, `brain_never_consumes_work` |
| Only the brain keeps the work stream and its consumers | enforced | `api_never_keeps_the_stream`, `node_never_keeps_the_stream` |
| The hosted tool is confined: its code reaches neither the store nor NATS | enforced | `fetch_reaches_no_driver` |
| Queue routing's codec is data alone: it does no I/O and touches no secret (every program) | enforced | `protocol_codec_does_no_io`, `protocol_codec_holds_no_secret` (the base, `Voice`) |
| voice-decide is an engine: it knows nothing of the coordinator | enforced | `decide_never_reaches_postgres`, `decide_never_reaches_nats`, `decide_speaks_no_voice_protocol` |
| The brain is never on the request path | partly | The brain never writes, reads, claims, grants or consumes a request's work, and never publishes into a stream (`brain_never_*`). Not what it subscribes to: its subjects are runtime strings handed to pond's NATS client, which no claim sees |
| Prompts never reach JetStream | partly | The node and the brain publish nothing into a stream (`node_never_publishes_into_a_stream`, `brain_never_publishes_into_a_stream`). The api does publish (tickets, and usage on the organization's nerves), and that what it publishes carries no body is data flow, which claims do not track: a ticket has no body because `work::Ticket` has no such field, a fact of the type, not of a claim |
| No credential leakage; secrets only through `std::secret` | partly | The brain's own code never handles secret material; only the drivers it dials with do (`brain_holds_no_secret`). A hosted fetch sending no credential is not provable yet (Gaps 3 and 6), nor where the vault is read (Gap 4) |
| Logs are structured (internals.md, "Logs") | partly | The brain writes only through `std::log` (`brain_logs_structured`). The api and the node also print where the output is the product (`api admin-token`, `api arrange`, the node's install); saying "every server path logs through `std::log`" needs `program` minus those commands (Gap 5), so CI's grep stays |
| The node never runs tool calls; hosted tools run only in the api | not yet | A tool call is an HTTP request or a process the model asked for; the node's engines make the same calls for the seat. Claims see effect classes (`syscall`, `block`) and named code, not what a call is for or where it goes (Gap 4) |
| No bypass flags; voice runs no agent CLI | not yet | A flag is a value in an argv handed to `std::process::run`; claims see neither values nor the native process calls (Gap 4) |
| The node's local API stays on loopback; only the api is exposed | not yet | The address a listener binds is a runtime value (`--host`, default `127.0.0.1`); claims see no values (Gap 9) |
| Callers never name a node; nothing is discovered; local controls only restrict; a model's weights come only from an allowed recipe; state never travels as events | not | These are about values, messages and data, not who reaches what. The contract (`spec/`) and the code's own checks hold them |

**voice-decide** is held to the law like the others: it is an engine a node
starts, and knows nothing of the coordinator. Importing `lib/law` puts 2.9
KB of unused code in its binary (Gap 12), and a change under `decide/`
rebuilds the decision runtime's images in CI, which publishes nothing
unless run by hand.

## The claims, by program

`Voice`, the base (queue routing's codec is data alone: it does no I/O and
touches no secret, so a ticket, a claim or a plan carries only what its
caller put in it):

```hale,fragment
protocol_codec_does_no_io: forbid reaches(work_protocol, effects(syscall));
protocol_codec_holds_no_secret: forbid reaches(work_protocol, effects(secret_use));
```

`VoiceApi` (the api enqueues tickets and answers claims, and never takes a
seat's part):

```hale,fragment
api_never_claims: forbid reaches(program, claiming);
api_never_reads_a_ticket: forbid reaches(program, ticket_reading);
api_never_consumes_work: forbid reaches(program, stream_consume);
api_never_keeps_the_stream: forbid reaches(program, stream_keeping);
fetch_reaches_no_driver: forbid reaches(hosted_fetch, drivers);
```

`VoiceNode` (a seat pulls and claims, and never takes the api's part):

```hale,fragment
node_never_reaches_postgres: forbid reaches(program, postgres);
node_never_writes_a_ticket: forbid reaches(program, ticket_writing);
node_never_grants: forbid reaches(program, granting);
node_never_publishes_into_a_stream: forbid reaches(program, stream_publish);
node_never_keeps_the_stream: forbid reaches(program, stream_keeping);
```

`VoiceBrain` (the brain steers and never serves):

```hale,fragment
brain_never_writes_a_ticket: forbid reaches(program, ticket_writing);
brain_never_reads_a_ticket: forbid reaches(program, ticket_reading);
brain_never_claims: forbid reaches(program, claiming);
brain_never_grants: forbid reaches(program, granting);
brain_never_consumes_work: forbid reaches(program, stream_consume);
brain_never_publishes_into_a_stream: forbid reaches(program, stream_publish);
brain_holds_no_secret: forbid reaches(program, effects(secret_use)) avoiding drivers;
brain_logs_structured: forbid reaches(program, effects(stdio)) avoiding std::log::*;
```

`VoiceDecide` (an engine, which knows nothing of the coordinator):

```hale,fragment
decide_never_reaches_postgres: forbid reaches(program, postgres);
decide_never_reaches_nats: forbid reaches(program, drivers);
decide_speaks_no_voice_protocol: forbid reaches(program, work_protocol);
```

The vocabulary, in `lib/law`: `postgres` (pond's `pq`, `db` and
`migrations`), `drivers` (those and pond's NATS client), `stream_publish`
(`js_publish`, `js_publish_id`, `js_publish_headers`), `stream_consume`
(`JsPuller`, `js_next`, `js_ack`, `js_nak`, `js_term`), `stream_keeping`
(creating, updating and deleting streams and consumers), and queue routing's
codec ([`lib/work`](../lib/work/work.hl)) by side: `ticket_writing`
(`ticket_json`), `ticket_reading` (`ticket_of`), `claiming` (`claim_json`,
`claim_subject`, `answer_of`) and `granting` (`claim_of`, `decline_json`),
and `work_protocol` (all of it).

## What claims can say on v0.38.0

- **Predicates.** `forbid reaches(SRC, DST)`, with `via { calls, bus }`,
  `during <hook>` and `avoiding <gate>`; `only edges A -> B { publish T; }`;
  `bound C <= N on paths from G`; `require subscribes|publishes(some G,
  topic T)`, `require sealed(all G)`, `require attributed(all C)`, `require
  separate_domains(all A, all B)`, `require no_silent_loss(topic T | all
  G)`; `cover topic in seed(a)`, `cover keys(topic T)`; `count
  publishers|subscribers(topic T) <op> N`; `adopt` and `extends` for
  constitutions.
- **Groups** hold loci (each projecting to all its methods and hooks), free
  fns, an import's declarations (`alias::Name`, `alias::*`), the handlers a
  role may call (`role R`), and Hale-source stdlib modules (`std::log::*`,
  `std::http::*`), these only as a target or a gate. Not a method on its
  own, and not a native module (`std::io::fs::*` and `std::env::*` are
  refused). `program` is built in.
- **What they see** is one process: the call graph (into imported seeds
  and Hale-source stdlib bodies) and the in-process bus of declared topics.
  NATS reached through pond's client is calls into pond, with subjects as
  runtime strings; `api::serve` rows are visible as `role` groups; `std::http`,
  files and the environment only as effect classes. A `fleet locus` joins
  programs, but only along topics bound in `bindings { }`, which voice's
  request plane is not.
- **Effects** a claim can name: `effects(C)` for a built-in class
  (`syscall`, `stdio`, `block`, `time`, `entropy`, `env`, `ffi`, `publish`,
  `spawn`, `recursion`, `alloc`, `secret_use`, `client(S)`) or a user one
  (`effect c;` with `@effects(is: {c})`). There is no `net`, `fs` or
  `process`: those are all `syscall`.
- **A policy seed** (no `main locus`) shares constitutions and groups;
  its groups may glob its own imports (`pq::*`), and an adopter sees them as
  `law::postgres`. `[claims] base` and `[environments]` in the workspace
  manifest (checked by `hale check --matrix`), `adopt` in a main locus, and
  `--adopt` on `hale check` each bind one; importing one binds nothing.

## Adding a claim

1. Name what it is about. A part of a shared library goes in `lib/law` as
   a group (`group granting = { work::claim_of, work::decline_json };`); a
   program's own code goes in a group in that program, which every program
   adopting the constitution must then declare (`hosted_fetch`).
2. Add the sentence to `Voice` if every program holds it, else to the
   program's own constitution in `lib/law`, under a name that says the
   invariant (`node_never_grants`). A new program gets an environment in
   `hale.toml`; `--matrix` refuses one that has none.
3. `hale check --matrix .`. A claim that does not
   hold names the path; one the checker cannot follow (an untyped receiver,
   an indirect call) fails closed as `cannot be certified` and names the
   call, which a typed local fixes (this change binds fourteen).
4. Prove it bites: break it on purpose in a scratch copy, check that the
   refusal is the one expected, and throw the copy away.

## What a refusal looks like

`hale check --matrix .` names the pair that failed, then the claim, the
path and where to edit:

```text
=== ./node @ node ===
lib/law/law.hl:91:5: type error: claim `node_never_grants` violated: `program` reaches `law::granting` — witness: `bite` -> `work::decline_json`
node/pull.hl:973:30: type error: claim `node_never_grants`: the boundary into `law::granting` is crossed by this call
lib/work/work.hl:429:4: type error: claim `node_never_grants`: the forbidden destination `work::decline_json` is declared here

1 pair(s) failed:
  node @ node
```

An edge the checker cannot follow fails closed (here, before
`api/inference.hl` typed its `offer`):

```text
lib/law/law.hl:64:5: type error: claim `api_never_claims` cannot be certified: `Inference::serve_held` (reachable from `program`) calls `ack` on a receiver the compiler cannot type, so the walk cannot follow the edge. An unresolvable edge fails closed — bind the receiver to a typed field or local so the call resolves
```

## Each claim refuses its violation

Each claim was broken in a scratch copy of the repository, with the change
shown, and `hale check --matrix .` refused it (exit 1) in that program's
pair alone, with the line shown; the base's two in every pair.

| Claim | The violation | The refusal |
|---|---|---|
| `api_never_claims` | api: `work::claim_json(work::Claim { })` | `` `program` reaches `law::claiming` — witness: `bite` -> `work::claim_json` `` |
| `api_never_reads_a_ticket` | api: `work::ticket_of(json)` | `` `program` reaches `law::ticket_reading` — witness: `bite` -> `work::ticket_of` `` |
| `api_never_consumes_work` | api: `nats::js_ack(c, m)` | `` `program` reaches `law::stream_consume` — witness: `bite` -> `nats::js_ack` `` |
| `api_never_keeps_the_stream` | api: `nats::js_stream_delete(c, work::STREAM)` | `` `program` reaches `law::stream_keeping` — witness: `bite` -> `nats::js_stream_delete` `` |
| `fetch_reaches_no_driver` | `web_fetch` calls `nats::new_inbox()` | `` `hosted_fetch` reaches `law::drivers` — witness: `web_fetch` -> `nats::new_inbox` `` |
| `node_never_reaches_postgres` | node: a locus holding `pq::PgConn` calls `open()` | `` `program` reaches `law::postgres` — witness: `BiteStore::ready` -> `pq::PgConn::open` `` |
| `node_never_writes_a_ticket` | node: `work::ticket_json(work::Ticket { })` | `` `program` reaches `law::ticket_writing` — witness: `bite` -> `work::ticket_json` `` |
| `node_never_grants` | node: `work::decline_json("taken")` | `` `program` reaches `law::granting` — witness: `bite` -> `work::decline_json` `` |
| `node_never_publishes_into_a_stream` | node: `nats::js_publish(c, …)` | `` `program` reaches `law::stream_publish` — witness: `bite` -> `nats::js_publish` `` |
| `node_never_keeps_the_stream` | node: `nats::js_consumer_delete(c, …)` | `` `program` reaches `law::stream_keeping` — witness: `bite` -> `nats::js_consumer_delete` `` |
| `brain_never_writes_a_ticket` | brain: `work::ticket_json(…)` | `` `program` reaches `law::ticket_writing` — witness: `bite` -> `work::ticket_json` `` |
| `brain_never_reads_a_ticket` | brain: `work::ticket_of(json)` | `` `program` reaches `law::ticket_reading` — witness: `bite` -> `work::ticket_of` `` |
| `brain_never_claims` | brain: `work::claim_subject(reply_to)` | `` `program` reaches `law::claiming` — witness: `bite` -> `work::claim_subject` `` |
| `brain_never_grants` | brain: `work::decline_json("gone")` | `` `program` reaches `law::granting` — witness: `bite` -> `work::decline_json` `` |
| `brain_never_consumes_work` | brain: `nats::js_ack(c, m)` | `` `program` reaches `law::stream_consume` — witness: `bite` -> `nats::js_ack` `` |
| `brain_never_publishes_into_a_stream` | brain: `nats::js_publish(c, …)` | `` `program` reaches `law::stream_publish` — witness: `bite` -> `nats::js_publish` `` |
| `brain_holds_no_secret` | brain: `std::secret::Credential { vault: v }.fingerprint()` | `` `program` reaches `effects(secret_use)` — witness: `bite` -> `std::secret::Credential::fingerprint` `` |
| `brain_logs_structured` | brain: `println("tick")` | `` `program` reaches `effects(stdio)` — witness: `bite` `` |
| `decide_never_reaches_postgres` | decide: a locus holding `pq::PgConn` calls `open()` | `` `program` reaches `law::postgres` — witness: `BiteStore::ready` -> `pq::PgConn::open` `` |
| `decide_never_reaches_nats` | decide: `nats::new_inbox()` | `` `program` reaches `law::drivers` — witness: `bite` -> `nats::new_inbox` `` |
| `decide_speaks_no_voice_protocol` | decide: `work::consume_subject("voice", node)` | `` `program` reaches `law::work_protocol` — witness: `bite` -> `work::consume_subject` `` |
| `protocol_codec_does_no_io` (base) | lib/work: a fn reading a file | `` `law::work_protocol` reaches `effects(syscall)` — witness: `work::bite_read` ``, in all four pairs |
| `protocol_codec_holds_no_secret` (base) | lib/work: a fn fingerprinting a credential | `` `law::work_protocol` reaches `effects(secret_use)` — witness: `work::bite_key` -> `std::secret::Credential::fingerprint` ``, in all four pairs |

And the converse, so an import is not mistaken for enforcement:

- **Importing is not binding.** With `api_never_claims` broken the same way,
  a plain `hale check api` passes (`ok: 52 file(s) typechecked`, exit 0):
  the api imports `lib/law` and is held to none of it. `hale check --matrix
  .` refuses the same tree.
- **An unbound program is refused.** With `[environments.decide]` removed
  from `hale.toml`, `hale check --matrix .` fails (exit 1): `entrypoint
  ./decide is in no environment. Every entrypoint must say where it deploys
  — one that is listed nowhere is checked against no claimset at all`, and
  `1 pair(s) failed: ./decide (unbound)`.

## Why not adopt in source

`claims { adopt VoiceNode; }` in a main locus would also hold `hale check
node` and `hale build node` to the law, and the toml binding needs no such
line, so there is none. It would also break voice's tests on v0.38.0: a
test that imports a program is a world of its own, the imported main's law
is evaluated there, and `program` is then the test's own code. Voice's
tests play the program's peers (a test of the api pulls and claims as a
node does, a test of the brain serves as the api does), so with `adopt` in
source `hale check --workspace` fails 18 test programs (Gap 1). Bound in
`hale.toml`, the law applies to the entrypoints the matrix lists, and to no
test.

## Zero runtime code

Claims compile to nothing. Importing `lib/law` brings its imports into the
program: the api's binary is the same size with it as without, and so is
the brain's; the node's gains 144 bytes, one reclaim-site descriptor pond's
Postgres driver brings, and voice-decide's code 2.9 KB, pond NATS's wire
codecs for two of its types, none of it ever run (Gap 12). To let the
checker follow every call, this change binds fourteen receivers to typed
locals, in the api (`api/inference.hl`, the offer of an attempt) and the
node (its metrics, its pullers, two files); the programs do as before, and
their tests pass.

## Gaps: what hale would need

Each is something the hale toolchain would add or fix; voice states the
invariant as soon as it can.

1. **`program` in an imported main's law is the importer's code.** A
   constitution adopted by a main is evaluated in a test that imports it
   with `program` resolving to the test's seed, so a test playing the
   program's peers violates it (`fn test_a_peer() { dep::touch(1); }` in a
   test of a program adopting `forbid reaches(program, store)` fails with
   `` witness: `test_a_peer` -> `dep::touch` ``). Ask: evaluate an imported
   main's law with `program` as that main's seed, as GH #733 holds for its
   groups, or let a test world leave an imported main's law to the main's
   own check.
2. **A call on a local locus literal of an imported seed is no edge.**
   `let c = dep::Conn { }; c.query(1)` (typed or not) adds no call from the
   fn, so `forbid reaches(f, dep_group)` holds while the call runs; a
   parameter `c: dep::Conn` or a field resolves. It fails open, where an
   untyped receiver fails closed. Ask: resolve it, or fail closed.
3. **`avoiding std::http::*` does not mask the module's loci.** `forbid
   reaches(fetch, effects(secret_use)) avoiding std::http::*` over a fn that
   reads a `std::http::BodyReader` is refused with the witness
   `` Fetch::f -> std::http::BodyReader::chunk -> … -> std::secret::Credential::__send_in_head ``,
   which runs through the gate; a declared group of `std::http::*` as the
   gate does the same. Ask: a gate masks every declaration of its module.
4. **Effects too coarse to tell the network from a file or a process.**
   `std::http::get`, `std::http::request`, `std::process::run` and
   `std::io::tcp::connect` are calls into no module group
   (`forbid reaches(f, std::http::*)` holds over `std::http::request`), and
   `std::io::fs::*` and `std::env::*` cannot be named. All of them are
   `syscall`. Ask: path calls count as reaching their module, or built-in
   classes `net`, `fs` and `process` (with `env` as it is), so "the node's
   serving path dials nothing but its engine" or "only the vault's reader
   reads the vault" can be said. (`require attributed(all syscall)` is the
   road open today: it asks a purpose of 115 of the node's fns.)
5. **No "all but".** `avoiding G` may not overlap the source, so `forbid
   reaches(program, stream_publish) avoiding ticket_gate` is refused
   (`masking an endpoint makes the claim weaker than it reads`), and a
   group cannot be `program` minus a few commands. Ask: a difference
   (`program except { … }`), so "every JetStream publish passes through the
   ticket gate or the teller" and "every server path logs through
   `std::log`" can be said without listing every locus.
6. **A locus literal does not reach its `birth`.** A fn building `Reads { }`
   whose `birth` reads the environment is not judged to reach
   `effects(env)`, nor a `std::secret::Credential { vault: … }` its vault
   read, nor a `BodyReader { bearer: … }` its header. Ask: a construction
   edge to the literal's `birth`, and a claim over what a construction site
   sets ("no `BodyReader` in `hosted_fetch` sets `bearer`").
7. **Subjects across processes.** Voice's request plane (tickets, claims,
   grants, events, replies) is pond's NATS client with runtime subjects,
   because a keyed topic over a binding is one subject every subscriber
   filters (internals.md, "Subjects"). Ask: keyed topics bound to a broker
   with a subject per key (`voice.node.{node}.serve`), so the plane is
   declared topics, and fleet claims over them; then "the brain never
   subscribes to a request or reply subject" is a `fleet locus` claim.
8. **Data flow.** "No prompt reaches JetStream" is that no value derived
   from a request's input is an argument of `js_publish*`. Ask: an
   information-flow claim over a type's fields and a call's arguments
   (hale's spec puts information flow out of scope today).
9. **Values of a listener.** Ask: a claim over the addresses a program
   listens on, proven constant (`require listens(G, loopback)`), from rows
   like the topology's `observe` ones; then "the node's local API stays on
   loopback" and "only the api is exposed" are claims.
10. **Receivers the checker cannot type.** A method call on a stdlib call's
    result (`std::metrics::gauge(…).set(v)`), on an `or`-unwrapped stdlib
    call (`std::io::file::open(…) or { … }`), on an `if` whose branches
    return an interface (`Offer`), or on an element of an array of loci
    (`self.ps[i].close(c)`) is uncertified. This change binds each to a
    typed local; ask: type them.
11. **A constitution cannot extend `std::law::Standard`** (`constitution X
    extends std::law::Standard` is a parse error), so `brain_logs_structured`
    restates its clause.
12. **An import used only by claims emits code.** Importing `lib/law` puts
    pond NATS's wire codecs into voice-decide (2.9 KB of code) and a
    reclaim-site descriptor into the node, none of it reachable. Ask: emit
    nothing for an imported type nothing uses.
13. **Doc comments on groups and constitutions** are refused as
    documenting nothing; `lib/law` uses `//`.
14. **`--env` reads the nearest manifest.** Voice's programs each have a
    `hale.toml` of their own (`[deps]`), so `hale check api --env api` finds
    no environment, and only `hale check --matrix` at the root applies the
    law; `hale build --env` likewise. Ask: `--env` resolves environments
    from the workspace manifest that lists the entrypoint, so a single
    program can be checked, built and run under its law.
