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
| `hale check api --env api` | no: `--env` reads the nearest manifest, which is the program's own `api/hale.toml` (its `[deps]`), and that declares no environment (`no environment `api` in …/api/hale.toml`; [hale #2221](https://github.com/hale-lang/hale/issues/2221)) |
| `hale check api --adopt VoiceApi` | yes, for that program alone: `VoiceApi` extends `Voice`, so the base comes with it; for trying a claim without the matrix |

CI runs `hale check --matrix .` in the api, brain, decide and node jobs
(`.github/workflows/ci.yml`, "The constitution holds for every program").

## The invariants

| Invariant | Status | Enforced by, or why not |
|---|---|---|
| The node never reaches Postgres | enforced, except a connection built and used in one fn ([hale #2216](https://github.com/hale-lang/hale/issues/2216)) | `node_never_reaches_postgres` |
| Only the api grants (answers a seat's claim) | enforced | `node_never_grants`, `brain_never_grants` |
| Only the api enqueues tickets; only seats claim them | enforced | `node_never_writes_a_ticket`, `brain_never_writes_a_ticket`, `api_never_claims`, `api_never_reads_a_ticket`, `brain_never_reads_a_ticket`, `brain_never_claims` |
| Only seats take work off the stream | enforced, except a puller built and used in one fn ([hale #2216](https://github.com/hale-lang/hale/issues/2216)) | `api_never_consumes_work`, `brain_never_consumes_work` |
| Only the brain keeps the work stream and its consumers | enforced, for the calls that name it | `api_never_keeps_the_stream`, `node_never_keeps_the_stream`; a raw JetStream API request (`nats::js_call`, a client's `request`) is a subject, which no claim sees ([hale #2225](https://github.com/hale-lang/hale/issues/2225)) |
| The hosted tool is confined: its code reaches neither the store nor NATS | enforced, except a client or connection built and used in one fn ([hale #2216](https://github.com/hale-lang/hale/issues/2216)) | `fetch_reaches_no_driver` |
| Queue routing's codec is data alone: it does no I/O and touches no secret (every program) | enforced, except a locus literal whose `birth` does it ([hale #2220](https://github.com/hale-lang/hale/issues/2220)) | `protocol_codec_does_no_io`, `protocol_codec_holds_no_secret` (the base, `Voice`) |
| voice-decide is an engine: it knows nothing of the coordinator | enforced, except a connection or client built and used in one fn ([hale #2216](https://github.com/hale-lang/hale/issues/2216)), and a topic bound to pond's NATS adapter (not yet filed) | `decide_never_reaches_postgres`, `decide_never_reaches_nats`, `decide_speaks_no_voice_protocol` |
| The brain is never on the request path | partly | The brain never writes, reads, claims, grants or consumes a request's work, and never publishes into a stream (`brain_never_*`). Not what it subscribes to: its subjects are runtime strings handed to pond's NATS client, which no claim sees |
| Prompts never reach JetStream | partly | The node and the brain call none of pond's JetStream publishes (`node_never_publishes_into_a_stream`, `brain_never_publishes_into_a_stream`); a plain NATS publish on a work subject, which the stream stores, is a subject no claim sees ([hale #2225](https://github.com/hale-lang/hale/issues/2225)). The api does publish (tickets, and usage on the organization's nerves), and that what it publishes carries no body is data flow, which claims do not track: a ticket has no body because `work::Ticket` has no such field, a fact of the type, not of a claim |
| No credential leakage; secrets only through `std::secret` | partly | The brain's own code never handles secret material; only the drivers it dials with do (`brain_holds_no_secret`), except an imported (non-driver) locus built and used in one fn ([hale #2216](https://github.com/hale-lang/hale/issues/2216)) or a locus literal whose `birth` uses a secret ([hale #2220](https://github.com/hale-lang/hale/issues/2220)). A hosted fetch sending no credential is not provable yet ([hale #2218](https://github.com/hale-lang/hale/issues/2218), [hale #2224](https://github.com/hale-lang/hale/issues/2224)), nor where the vault is read ([hale #2222](https://github.com/hale-lang/hale/issues/2222)) |
| Logs are structured (internals.md, "Logs") | partly | The brain writes only through `std::log` (`brain_logs_structured`), except through an imported sink built and called in one fn ([hale #2216](https://github.com/hale-lang/hale/issues/2216)) or a literal whose `birth` prints ([hale #2220](https://github.com/hale-lang/hale/issues/2220)). The api and the node also print where the output is the product (`api admin-token`, `api arrange`, the node's install); saying "every server path logs through `std::log`" needs `program` minus those commands ([hale #2223](https://github.com/hale-lang/hale/issues/2223)), so CI's grep stays |
| The node never runs tool calls; hosted tools run only in the api | not yet | A tool call is an HTTP request or a process the model asked for; the node's engines make the same calls for the seat. Claims see effect classes (`syscall`, `block`) and named code, not what a call is for or where it goes ([hale #2219](https://github.com/hale-lang/hale/issues/2219), [hale #2222](https://github.com/hale-lang/hale/issues/2222)) |
| No bypass flags; voice runs no agent CLI | not yet | A flag is a value in an argv handed to `std::process::run`; claims see neither values nor the native process calls ([hale #2219](https://github.com/hale-lang/hale/issues/2219), [hale #2222](https://github.com/hale-lang/hale/issues/2222)) |
| The node's local API stays on loopback; only the api is exposed | not yet | The address a listener binds is a runtime value (`--host`, default `127.0.0.1`); claims see no values ([hale #2227](https://github.com/hale-lang/hale/issues/2227)) |
| Callers never name a node; nothing is discovered; local controls only restrict; a model's weights come only from an allowed recipe; state never travels as events | not | These are about values, messages and data, not who reaches what. The contract (`spec/`) and the code's own checks hold them |

**voice-decide** is held to the law like the others: it is an engine a node
starts, and knows nothing of the coordinator. Importing `lib/law` puts 2.9
KB of unused code in its binary ([hale #2230](https://github.com/hale-lang/hale/issues/2230)), and a change under `decide/`
rebuilds the decision runtime's images in CI, which publishes nothing
unless run by hand.

## What "enforced" means until hale fixes these

A green `hale check --matrix .` proves each claim over the program as the
checker models it, and four holes in that model can let a real violation
pass (fail open). Until hale closes them, a claim marked "enforced, except"
in the table above holds for every shape but the ones listed here. Each
listed shape was tried in a scratch copy, and the violation passed
`--matrix` (exit 0).

| Hole | The shape that passes | Claims it weakens |
|---|---|---|
| [hale #2216](https://github.com/hale-lang/hale/issues/2216): a method call on a literal of an imported seed's locus adds no edge | `let c = pq::PgConn { }; c.open()` or `pq::PgConn { }.open()`; `let p = nats::JsPuller { … }; p.fetch(c, …)`; `let c = nats::NatsClient { … }; c.open()`; `let s = logfmt::RecordSink { }; s.on_event(e)` | `node_never_reaches_postgres`, `decide_never_reaches_postgres`, `decide_never_reaches_nats`, `fetch_reaches_no_driver`, `api_never_consumes_work`, `brain_never_consumes_work`, `brain_logs_structured`, `brain_holds_no_secret` (an imported seed's locus, not a driver, that uses a secret: `let k = x::K { }; k.k(v)` passes, `k: x::K` as a parameter is refused), and the base's two should `lib/work` ever import a seed. The same object held in a field or passed as a parameter is seen |
| [hale #2220](https://github.com/hale-lang/hale/issues/2220): a locus literal does not reach its `birth` | in `lib/work`, `std::http::BodyReader { req: … }`, which sends its request in `birth`, with no method called | `protocol_codec_does_no_io`, `protocol_codec_holds_no_secret`, `brain_holds_no_secret`, `brain_logs_structured`: every claim over an effect, wherever a literal's `birth` performs it |
| [hale #2218](https://github.com/hale-lang/hale/issues/2218): `std::m::*` omits on-demand stdlib files | none today: the only module group here is the gate `std::log::*`, and a gate that masks too little fails closed | none |
| [hale #2219](https://github.com/hale-lang/hale/issues/2219): a stdlib path call is only a leaf `syscall` | none today: the claims over `effects(syscall)` still see it (`std::http::get` in `lib/work` is refused), and no claim names a stdlib module as a target | none (it blocks the tool-call and bypass-flag invariants instead) |

One refusal is luckier than it looks: a brain that builds a
`std::http::BodyReader` with a `bearer` is refused by `brain_holds_no_secret`,
but because the on-demand stdlib file that declares `BodyReader` joins the
brain's `program` (the witness starts at `std::http::BodyReader::__start`),
not because the literal reaches its `birth`.

Two shapes pass that no hale issue covers yet, and the claims do not
pretend to:

- **A topic bound to pond's NATS adapter.** `bindings { Pinged:
  nats::NatsAdapter { … }; }` with a publish on `Pinged` passes
  `decide_never_reaches_nats`: the binding is no edge from the publisher to
  the adapter. The same shape would publish onto a work subject past
  `node_never_publishes_into_a_stream`. (Not yet filed.)
- **Subjects.** A plain NATS publish on a work subject, which JetStream
  stores, or a raw JetStream API request (`nats::js_call`, a client's
  `request` on `$JS.API.…`), reaches the stream through no function the
  law names ([hale #2225](https://github.com/hale-lang/hale/issues/2225)).

The claims over queue routing's codec (`*_never_writes_a_ticket`,
`*_never_reads_a_ticket`, `*_never_claims`, `*_never_grants`) are weakened
by none of the four: `lib/work` declares no locus, so every use is a path
call the checker sees. What they do not stop is a program writing the same
JSON by hand; a claim names code, not a message's shape.

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
source `hale check --workspace` fails 18 test programs ([hale #2217](https://github.com/hale-lang/hale/issues/2217)). Bound in
`hale.toml`, the law applies to the entrypoints the matrix lists, and to no
test.

## Zero runtime code

Claims compile to nothing. Importing `lib/law` brings its imports into the
program: the api's binary is the same size with it as without, and so is
the brain's; the node's gains 144 bytes, one reclaim-site descriptor pond's
Postgres driver brings, and voice-decide's code 2.9 KB, pond NATS's wire
codecs for two of its types, none of it ever run ([hale #2230](https://github.com/hale-lang/hale/issues/2230)). To let the
checker follow every call, this change binds fourteen receivers to typed
locals, in the api (`api/inference.hl`, the offer of an attempt) and the
node (its metrics, its pullers, two files); the programs do as before, and
their tests pass.

## Gaps: what hale would need

Filed on hale; each reproduced on hale's main.

| Issue | Kind | What voice would state with it |
|---|---|---|
| [hale #2216](https://github.com/hale-lang/hale/issues/2216) | fail-open bug | closes the one-fn hole in the eight claims above |
| [hale #2217](https://github.com/hale-lang/hale/issues/2217) | bug | `adopt` in source without failing the tests that import a program |
| [hale #2218](https://github.com/hale-lang/hale/issues/2218) | fail-open bug | "a hosted fetch carries no credential", as `avoiding std::http::*` |
| [hale #2219](https://github.com/hale-lang/hale/issues/2219) | fail-open bug | stdlib calls as reaching their module: the node's tool-call ban, no agent CLI |
| [hale #2220](https://github.com/hale-lang/hale/issues/2220) | fail-open bug | closes the `birth` hole in the claims over effects |
| [hale #2221](https://github.com/hale-lang/hale/issues/2221) | bug | `hale check api --env api` and `hale build --env` under the law |
| [hale #2222](https://github.com/hale-lang/hale/issues/2222) | feature | `net`, `fs`, `process` under `syscall`: who dials, who reads the vault |
| [hale #2223](https://github.com/hale-lang/hale/issues/2223) | feature | `program except { … }`: every JetStream publish through the ticket gate, every server path through `std::log` |
| [hale #2224](https://github.com/hale-lang/hale/issues/2224) | feature | a claim over a construction site's fields: no `BodyReader` in `hosted_fetch` sets `bearer` |
| [hale #2225](https://github.com/hale-lang/hale/issues/2225) | feature | keyed topics with a broker subject per key and fleet claims: the brain never subscribes to a request or reply subject |
| [hale #2226](https://github.com/hale-lang/hale/issues/2226) | feature | information flow: no request's input reaches `js_publish*` |
| [hale #2227](https://github.com/hale-lang/hale/issues/2227) | feature | a listener's bind address: the node's local API on loopback, only the api exposed |
| [hale #2228](https://github.com/hale-lang/hale/issues/2228) | feature | typed receivers, so the fourteen typed locals this change adds are not needed |
| [hale #2229](https://github.com/hale-lang/hale/issues/2229) | feature | `extends std::law::Standard`, so `brain_logs_structured` need not restate it |
| [hale #2230](https://github.com/hale-lang/hale/issues/2230) | codegen | an import only claims use emits no code (voice-decide's 2.9 KB, the node's 144 B) |
| [hale #2231](https://github.com/hale-lang/hale/issues/2231) | docs | `///` on `group` and `constitution` |

Not yet filed: a topic bound in `bindings { }` to an imported adapter
locus adds no edge from its publishers to the adapter (above).
