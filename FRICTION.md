# Friction

What building voice in Hale ran into: the cause and the shape that works.
Read it before the next task; append when something fights back. Versions
are the `hale` the entry was found with.

## A stateful handler literal given to `Router.add` in a builder fn dangles

**hale 0.21.0**, found at hale `3d9ea6ef`, still there at `bb0a2c55`.
Filed as [hale-lang/hale#1048](https://github.com/hale-lang/hale/issues/1048).

A route handler locus with a `String` param, constructed inline as the
argument to `Router.add` inside a function that builds and returns the
router, loses that string once the function returns: the handler later reads
garbage, and a server built this way crashed under load. `hale check` is
silent. The docs' `build_router()` example only uses a param-less handler, so
it does not show it.

```hale
locus Echo {
    params { s: String = ""; }
    fn handle(ctx: std::http::Context) -> std::http::Response {
        return std::http::Response { status: 200, body: "[" + self.s + "]" };
    }
}

fn build(dir: String) -> std::http::Router {
    let r = std::http::Router { };
    r.add("GET", "/x", Echo { s: dir + "/canned" });
    return r;
}
// build("some/dir").dispatch(...) answers "[some/dir<garbage>]"
```

It is not only builder functions: a `register(r, dir)` helper that fills a
caller's router dangles the same way, and so does a locus that owns a
`Router` param and fills it in `birth()`. Only a router filled and used in
one function is safe, which leaves no place to put a route table that a
server and its tests share.

**Working shape:** one handler locus for every endpoint, the styleguide's
one-locus-many-endpoints shape: `std::http::build_context(req)` and an
`if std::http::is_route(...)` ladder in its own `handle`, let-bound where the
`Server` is created (`api/endpoints.hl`). Shared state lives in its `params`.

**Resolved in hale 0.22.0** (hale-lang/hale#1048): `hale check` and `hale build` refuse a handler literal built in a function that returns the router, fills a router it was handed, or fills `self`'s router, so the shape above no longer builds instead of dangling. hale's migration, each handler a field of the locus that owns the router and the router filled in `birth()`, is a second safe shape; voice keeps its one handler locus.

## Triple-quoted and raw strings are in the grammar's comment, not the lexer

**hale 0.21.0.** `spec/grammar.ebnf` notes `STRING_LIT` as
`"..." with escapes; r"..." raw; """..."""`, but `"""{"a": 1}"""` lexes as
an empty string followed by another literal. Only `"..."` with `\"` escapes
exists.

**Working shape:** JSON bodies live in files and are read at request time
(`api/canned/`), not embedded in source.

**Resolved in hale 0.27.0** (hale-lang/hale#1677) for multi-line text: a block string opens with `"""` at the end of a line and closes with `"""` on a line of its own, nothing escaped. The one-line `"""{"a": 1}"""` is now refused by the lexer. Raw `r"..."` strings still do not lex on hale 0.32.6.

## `std::http` has no reason phrase for most statuses

**hale 0.21.0.** `__status_phrase` covers 101, 200, 301, 400, 404, 413 and
500. Everything else goes out as `Status`, e.g. `HTTP/1.1 201 Status`.
Clients ignore reason phrases, so nothing breaks, but it reads wrong in a
trace.

**Working shape:** none needed. Worth adding 201, 202, 204, 401, 403, 409,
429, 502, 503 and 504 upstream.

**Resolved in hale 0.24.0** (hale-lang/hale#1540): `__status_phrase` holds every RFC 9110 status.

## `is_route` writes its captures into the context, not into a copy of it

**hale 0.24.0.** `std::http::is_route(c, method, pattern)` puts the
pattern's `:name` captures in `c.params` when it matches. A router that
reads `let p = c.params;` once, before the ladder, holds a copy taken
before any match, so `std::http::path_param(p, "model")` is `""` for every
route, and nothing says so: the handler runs with an empty id and answers
404.

**Working shape:** read `c.params` after the match, in the branch that
matched (`std::http::path_param(c.params, "model")`, `api/endpoints.hl`).

## A surface's JSON codec has no `null`, enum or map, and code cannot call it

**hale 0.24.0.** The contract has lists that may be `null` (a project's
`models`: `null` is the whole catalog), a price that may be `null`, enums
(`kind`, `status`) and a map (`Health.checks`). The codec a surface's rows
are held to carries none of them, so a row's type says each with a shape
it does carry: `Restriction { any: Bool; names: Names; }` for the
nullable list, `priced: Bool` beside the price, a `String` for the enum,
-1 for a count that may be `null` (a limit's `requests`, a node's
`max_in_flight`), and JSON text in a `String` for a free-form object (a
seat's `config`, a change's `before` and `after`).
The description `hale api export` would print is then not the contract's
shape. And a program cannot run that codec itself (encode a typed value,
decode a body into a row's request), while `Type::from_json` carries no
list, so a router that speaks the contract's REST wire over the rows
writes every decoder and encoder by hand.

**Working shape:** the rows' types as close to the contract as the codec
allows (`api/surface.hl`), and the contract's JSON in one file of
hand-written readers and writers (`api/wire.hl`), checked against
`openapi.yaml` live in CI (`spec/validate/live.mjs`).

## A `bounded` field is never assigned whole

**hale 0.24.0.** `row.models = req.models;` between two records'
`bounded[String; 32]` fields is refused: the intrinsics are the only way
to change a bounded field, so copying one list into another record means
a `push` loop. A whole record copies its bounded fields with it.

**Working shape:** wrap the list in a record (`type Names { items:
bounded[String; 32]; }`) and assign the record.

**Resolved in hale 0.25.0** (hale-lang/hale#1601): `row.models = req.models` copies the count and the elements. `Names` stays, since a function still cannot return a bounded list by value (below).

## `hale verify` calls a hashmap row write in a long-lived locus unbounded

**hale 0.24.0.** `MemoryStore` keeps rows in `@form(hashmap)` loci for the
life of the process. `hale verify` warns that every `set` there grows the
store's region without bound, as a write in a per-message handler. The
first version of this entry took the warning at its word. Measured, it
does not hold here: 15,000 `PATCH`es of a key and 5,000 of a project,
each with a 120-character name, left the api's RSS flat (5224 to 5092 kB,
then 5096), and an outside review saw the same over 10,000. Nothing
measured grows.

**Working shape:** the in-memory store's writes carry `@unbounded`, which
is what `hale verify` needs; the warning is a check that does not see the
replaced row's text reclaimed. So a key's `last_used_at` is written as it
is used, at most once a minute per key (`KeyBearer`, `Store.touch_key`).

## `std::time::parse_time` rolls an impossible day into the next month

**hale 0.24.0.** `std::time::parse_time("2099-02-30T00:00:00Z")` answers
2 March 2099 instead of refusing it, so a reader that relies on it takes
a date that does not exist. It also reads only the `Z` form of RFC 3339,
not an offset.

**Working shape:** voice's own reader (`rfc3339` in `api/wire.hl`) checks
the date first (the month 1 to 12, the day within the month, leap years
counted) and takes an offset off by hand, with exactly two digits for its
hours and its minutes.

**Resolved in hale 0.25.0** (hale-lang/hale#1601) for the impossible day: `parse_time("2099-02-30T00:00:00Z")` is refused. An offset is still refused on hale 0.32.6 (`2099-03-02T00:00:00+02:00`), so `rfc3339` stays.

## A NATS client held for the api's life grows with every served request

**hale 0.24.0, pond `realtime/nats` at `697852f`.** The api first held one
`NatsClient` for its life and served every request over it: subscribe to
the request's reply subject, `request` the node's `serve`, `read_msg` a
dozen events and the result, unsubscribe. Its `NatsFramer` region grew by
about 700 bytes a request (`LOTUS_ARENA_RESIDENCY=1`, two dumps 2000
requests apart: the framer's `used=` from 312 to 1.4 MB; every other
arena flat), and `hale verify` said nothing. A program that publishes and
reads on a long-lived client in a loop, with subjects and payloads of
varying length, in bursts, or around a `request` nobody answers, stays
flat, so the shape that grows is narrower than "a long-lived client"; the
node's long-lived client, which receives one `serve` a request, stayed
flat over 3000.

**Working shape:** the api opens a connection for each use and closes it
after (`NatsLink` in `api/link.hl`), so the client and its framer are
reclaimed with the call. A connection to NATS on the private network
costs about a millisecond, against a request that waits for its seat.

## `draining` and `drain` cannot name a method

**hale 0.24.0.** The node plane's last report is `POST /node/v1/draining`,
and its handler is naturally `NodePlane::draining`. `draining` is the drain
flag every locus carries (`self.draining`) and `drain` is a lifecycle hook,
so both are refused as method names, and so as rpc members.

**Working shape:** `NodePlane::going_away`.

## `count` and `at` on a call's result pass the check and fail the build

**hale 0.24.0.** `count((s.keys("work") or KeyRows { }).rows)` typechecks,
and then the build refuses it: "unsupported in codegen v0: call to `count`:
no free fn / generic fn / fn-pointer binding with that name is in scope —
did you mean `t`?". The intrinsic needs a place (a local or a field), and
the message points at an unrelated fn.

**Working shape:** bind the result first (`let ks = s.keys("work") or
KeyRows { }; count(ks.rows)`).

## pond's pq: tab-separated rows, and a line on stdout

**pond `pq` as hale 0.24.0 carries it.** A query's rows come back as one
string, rows by newline and columns by tab, with no escaping, so a column
holding a tab or a newline (a JSON document, a name) cannot be split
back. And a connection with `sslmode=prefer` to a server without TLS
printed `[pq] tls: ... negotiated PLAINTEXT` on stdout, which failed a
`hale test` (a passing test is silent).

**Working shape:** every read is `SELECT row_to_json(t) FROM (...) t`, one
JSON object a line, since JSON escapes every tab and newline
(`store/pg_store.hl`, as DNA's ledger does); the DSN takes `?sslmode=`, and
the tests and compose use `sslmode=disable` on the private network. Since
voice#28 the plaintext notice goes through `std::log` (logger `pq`, a
change of voice's own in the vendored copy), so a test, which holds no
sink, prints nothing.

## A text built or read a line at a time is quadratic in memory

**hale 0.24.0.** Two shapes that read naturally both copy the whole text
per line, and every copy stays in the arena until the handler returns:
growing a result with `out = out + row`, and walking lines with
`rest = rest[(nl + 1)..len(rest)]` (a slice copies, and measures the
string first). pond's `pq` grew a query's rows the first way, and the
Postgres store read them the second: a 1000-row change page grew the
api's peak by 715 MB. `hale verify` says nothing about either.

**Working shape:** rows go into one `std::bytes::BytesBuilder` (voice's
change to `lib/pond/pq`, `JsonList` for list bodies), and lines are read by
index over one `std::str::bytes_view`, slicing only the line (`line_end`
in `store/types.hl`). The same page now grows the peak by 8 MB, and
`store/tests/pg_page_memory_test.hl` holds it under 32 MB.

## A shared seed's names are reached only through its alias

**hale 0.24.0.** An import binds one alias (`import "../store" as st;`),
and every name of the seed is reached through it (`st::ModelRow`); there is
no importing a name unqualified, and an alias binds in the seed that
declares it only, not in the seeds that import that one. Moving the store
out of the api into a seed the brain shares rewrote about 160 references
across the api's files by hand, and a test that reached a store type
through the api (`api::BudgetSet`) has to import the store itself.

**Working shape:** the api imports the store once, as `st`, in
`surface.hl`, and its files write `st::`; each test imports the seeds it
names. The surface's descriptions name the store's shapes `st::Names` and
so on, which is the open point on stable names for imported types.

## `hale verify` took `std::env::arg` for a seed's `one_arg`

**hale 0.24.0.** With the store seed declaring `fn one_arg(v: String) ->
db::Args`, `hale verify api` and `hale verify brain` flagged each
`std::env::arg(i)` in their argument loops as a hot-path allocation of
"the locus `db::Args`". The seed's own `hale verify` was clean, and so was
the api's while the same function lived in the api seed.

**Working shape:** the store's helper is named `single_value`.

## `release` cannot name a method either

**hale 0.24.0.** The store's "end the hold that wrote nothing" is naturally
`Store::release`, and `release` is a lifecycle hook, so it is refused as a
method name, as `draining` and `drain` are.

**Working shape:** `Store::let_go`.

## `hale api export`'s OpenAPI form does not lint

**hale 0.24.0; narrowed in 0.25.0.** The exported `Voice.openapi.json`
failed `redocly lint` with ten errors: nine component names (a type from an
imported seed was named by its alias, `st::Names`, and `::` is not allowed
in an OpenAPI component key) and the missing `servers`. hale 0.25.0 names
imported types plainly, so one error is left: no `servers`. Every field of
a row that has a default is optional in the export, so a type whose fields
all have defaults requires nothing.

**Working shape:** the bundle is committed as exported, and its drift is
checked with `hale api export --check`. Its fit to the contract is checked
field by field instead of by linting (`spec/validate/bundle.mjs`), with
each gap classed in `api/gaps.json`.

## A bounded list can't be returned by value from a fn

**hale 0.25.0.** `fn names() -> bounded[String; 4] { let mut r = Row { }; push(r.names, "a") or discard; return r.names; }` (with `type Row { names: bounded[String; 4]; }`) typechecks, then fails the build: "codegen error: unsupported in codegen v0: bounded[T; N] cannot be returned by value — it lives inline in its containing type".

**Working shape:** a function returns a record that holds the list (`Names { items }`), and since 0.25.0 a caller assigns the field whole (`row.owners = names_of(x).items`).

## `std::http::Server` does not read a chunked request body

**hale 0.25.0.** A request sent with `Transfer-Encoding: chunked` and no `Content-Length` reaches the handler with an empty body: the Server reads `Content-Length` bodies only, a deferral hale named with its streamed responses (hale-lang/hale#1596). The body cap and its `413` hold only for bodies with a `Content-Length`, which the usual SDKs send.

**Working shape:** the api refuses a chunked request body `400 invalid_request`, saying a chunked body is not accepted and `Content-Length` is required (`whole_body` in `api/endpoints.hl`), instead of reading it as a body that is not JSON.

## `std::http::Server` reassembles a request body in memory quadratic in its size

**hale 0.25.0.** The connection loop (`__http_handle_one_conn`, io_tcp_serve.hl) grows the request with `raw = raw + chunk` per 8 KiB `recv`, and every prefix stays until the connection is served. A handler that only answers `len(req.body)` peaks at 74 MB for a 1 MiB body, 274 MB for 2 MiB, 1.07 GB for 4 MiB and 4.2 GB for 8 MiB; an 11 MiB body took the api to 7.7 GB, before its handler ran (so before any key is checked). It stayed hidden under the 1 MiB default cap; `max_request_bytes` at the contract's 12 MiB makes a 12 MiB body cost about 9.5 GB.

**Resolved in hale 0.25.1** (hale-lang/hale#1628): the Server reads a body in linear memory, about 75 MB of peak for 12 MiB. The api's cap is back at the contract's 12 MiB; a request just under it peaks the api at about 160 MB, streamed about 210 MB, and e2e holds them under 200 and 256 MB. Until then the cap was 2 MiB (about 274 MB worst case), still answered `413 request_too_large` in the contract's envelope.

## An enum field's literal default is described as optional, but the codec requires the field

**hale 0.25.1.** With `type Scope = enum { project, key };` and `type L { scope: Scope = Scope::key; }`, `hale api export` leaves `scope` out of `L`'s `required`, but `L::api_decode("{}")` refuses the payload with `missing_field`. That matches the spec: an enum field has no default the codec reads (spec/api.md, Codecs). The description and the codec disagree, and a client built from the description would leave the field out.

**Working shape:** an enum field the contract requires has no declaration default (`Limit.scope`, `Key.status`, `Attempt.outcome`, ...), so the description lists it as required, as the codec reads it. An enum the contract leaves optional is a presence pair (`has_billing` with `billing`), and its handler reads `has_billing` rather than the field's zero, which the codec makes the first variant.

**Resolved in hale 0.26.0** (hale-lang/hale#1651): a field with any default, an enum's among them, is optional and decodes to its default. The rows keep the shapes above, which say the contract's required and optional enums either way.

## A record literal in a field default is not checked for a field with no default

**hale 0.25.1.** `type Row { budget: BudgetSet = BudgetSet { }; }`, where `BudgetSet` has a field with no default (here an enum, `period: Period;`), passes `hale check`; the build then fails: "codegen error: unsupported in codegen v0: type `st::BudgetSet` literal missing field `period`". The same literal in a function body is refused by the checker ("missing field `period`").

**Working shape:** a field default names every field without a default (`BudgetSet { period: Period::month }`).

**Resolved in hale 0.26.0** (hale-lang/hale#1651): `hale check` refuses the literal at the default ("type `BudgetSet`: missing field `period`").

## The codec has no free-form JSON value, no scalar-valued map and no third state for a PATCH's null

**hale 0.25.1.** The contract has three shapes no Hale type says:

- a free-form JSON object: a seat's `config` (valid against its engine's `config_schema`, itself free-form), a change's `before` and `after`. Closed by hale's `std::json::Value` (v0.26.0): each is one now, carried byte for byte, and a node's capabilities are a typed record around it;
- a map whose values are scalars: `Health.checks`, dependency to `"ok"` or `"unavailable"` (a hale map, `bounded[S; N] indexed_by <field>`, has records as its values). Closed by hale's map of values (`indexed_by name -> status`, hale-lang/hale#1656): `Health.checks` is one now;
- a PATCH field that may be left out (kept), `null` (cleared) or a value: an account's `provider`, a model's `price`, a key's `models`, `accounts` and `expires_at`, a node's `max_in_flight`, a project's `models` and `accounts` (a presence pair reads `null` as left out). Closed by hale's presence triple (`clear_x` beside `has_x` and `x`, hale-lang/hale#1664): each is one now;

**Working shape (until hale v0.26.0):** the row carried the object as JSON text (`config`, `before`, `after`, a node's `capabilities`), the check as a field of its own (`Health.store`), and the PATCH field as `set_<field>` beside a value that said `null` its own way. All three shapes are closed now; `api/gaps.json` lists no `map`, `json-text` or `tri-state` gap.

## A bounded list is never required

**hale 0.25.1.** A `bounded` field may be left out of a payload and is empty (spec/api.md, Codecs), so the export lists none under `required`. The contract requires several lists (a project's `owners` and `data_classes`, a node's `seats`, local controls' `paused_seats`); each is a `required` gap the row cannot close.

**Working shape:** the REST reader refuses a body without a required list; the gap stays listed.

## A Float does not survive `to_string`, nor the api codec

**hale 0.25.1.** `to_string(Float)` keeps six significant digits: `99.999995` is written `100` and `33.333333333333336` is written `33.3333`, so `parse_float(to_string(x)) == x` fails for most values. `T::api_encode` writes a Float field the same way (`{"used_percent":100}` for 99.999995), so a Float that crosses the api codec comes back as a different number.

**Working shape (until hale v0.26.0):** a quota window's `used_percent` was written by `float_text`, which wrote the fewest fraction digits that read back as the same Float. **Closed in hale v0.26.0:** `to_string(Float)` and the api codec both write a Float that reads back as itself; `float_text` is gone, and node_plane_test keeps the write-back and codec checks.

## The runtime writes to stderr outside any logger

**hale 0.25.1.** When a client hangs up while the api writes its answer, the runtime prints `lotus_tcp_send_str: write: Broken pipe` (a `perror` in the C runtime) on stderr. It is a write by Hale's runtime, outside `std::log` and outside the program, so a program that routes every line through its logger still has this one, unstructured.

**Working shape:** none in voice; docs/internals.md's Logs section names it as the one exception. hale's #1592 (structured stdout and runtime events) is where it belongs.

**Resolved in hale 0.26.0** (hale-lang/hale#1592, its second slice in hale-lang/hale#1661): the runtime's diagnostics are records in the format `std::log`'s sinks write, one line on stderr, so the hang-up now reads `time=... level=error logger=lotus.tcp msg="write failed" op="lotus_tcp_send_str: write" errno=32 error="Broken pipe"`, beside voice's own warnings and errors. docs/internals.md's Logs section still names it as the one exception.

## A program that reads `self.draining` waits out the whole drain grace, its HTTP server never ending on it

**hale 0.25.1.** The drain on SIGINT or SIGTERM is installed only in a program that reads `self.draining`. Once anything does (a pinned queue's `while !self.draining` loop, or pond's `NatsConn`), a signal waits for the main locus's `run()` to return, and the api's `run()` is `std::http::Server`, which does not end on the drain. So every stop waits out the grace: "the drain begun by signal 15 did not finish within 5000 ms ... live loci that read draining: `Teller` x1". The api took 5 s to stop instead of a few milliseconds.

**Working shape:** nothing in the api reads `self.draining`. The teller's loop (api/teller.hl) runs until the process ends, so a signal ends it at once, as before, and events not yet told go with it.

**Resolved in hale 0.26.0** (hale-lang/hale#1659): a drain stops the process's listeners. hale's serve loops end on a drain (its drain watcher stops every listener); what held the api was its own pinned loops never reading `self.draining`. Since hale v0.32.5 (#1851) a locus's `dissolve()` counts for the drain, so the api, the brain and their loops (teller, governance, pulse, the brain's tick) read `while !self.draining`: SIGTERM ends the api in under a second, exit 0, its hooks run.

## A binding's literal that reads the locus's params passes the check and fails the build

**hale 0.25.1.** In `bindings { T: nats::NatsPublisher { url: self.nerves_url, ... } codec(...); }` `hale check` accepts `self.nerves_url`; `hale build` then fails: "codegen error: unsupported in codegen v0: self.org read outside a locus method".

**Working shape:** no binding. The teller (api/teller.hl) is a pinned locus whose params the main locus's own literal sets from its params, which a params initializer may read.

**Resolved in hale 0.26.0** (hale-lang/hale#1657): `hale check` refuses a read of `self` in an adapter binding's literal, at the read, since the prelude builds the adapter before the main locus exists. A binding still cannot take the locus's params, so the working shape stays.

## `std::http::Client` bounds its dial, not its answer

**hale 0.25.1, and main at ec6fc8f.** `timeout_ms` bounds the TCP connect (and the TLS handshake); the request's write and the read of the answer have no bound, and `max_retries` (3 by default) repeats the whole exchange. A peer that takes the connection and never answers (a head stopped mid-run, a proxy that holds it) keeps the caller for as long as it holds, so a call a locus makes on a schedule has no deadline it can state.

**Working shape:** api/deadline.hl, an HTTP/1.1 exchange over `std::io::tcp` or `std::io::tls` under one deadline: `connect_within`, then `set_send_timeout` and `set_recv_timeout` set to what is left of it before each write and read, the answer read to its `Content-Length`, its last chunk or the close. A total deadline on `std::http::Client` (say `deadline_ms`) would retire it.

**Resolved in hale 0.26.0** (hale-lang/hale#1657): `timeout_ms` is one deadline for the whole call, the dial, every write and read, and the retries and their backoff, and a response the deadline cuts short is never handed back. api/deadline.hl is still voice's; a `Client` with `max_retries: 0` (deadline.hl never tries twice) would retire it.

## A pinned locus's log line waits for the main thread's next request

**hale 0.25.1, and main at ec6fc8f.** A `std::log::Logger` line written on a pinned locus's thread reaches `StdoutSink` only when the main thread next drains its bus queue, and a main thread serving `std::http::Server` drains it between requests. With no request coming in, the teller's and the limits reader's warnings (a head that stopped answering) are not written at all until one does. A probe (a pinned locus logging once a second beside a Server) wrote nothing for five seconds, then all five lines on the first request.

**Working shape:** none in the api. The DNA fixture (api/tests/admin_limits.sh) asks the api's `/healthz` while it waits for a reader's line.

**Resolved in hale 0.26.0** (hale-lang/hale#1659): an accept on the main thread also waits on main's bus queue, so a line another thread publishes to a sink on main is written while the server is idle. The fixture still asks `/healthz` while it waits (`more_unread`), which is no longer needed.

## `std::http`'s client reads a response whole, so an https upstream is relayed after it ends

**hale 0.27.0.** `std::http::request` returns a `ClientResponse` with the body read to its end. The openai-compatible engine (node/compat.hl) asks a chat-completions upstream for a stream, but over https the whole stream is read first and its events are published afterward: the caller sees no first token until the model has finished, and a tool call's argument fragments arrive all at once. Filed as [hale-lang/hale#1698](https://github.com/hale-lang/hale/issues/1698), modelled on the server side's chunked/SSE writer (#1596): a client that hands back the body as it arrives.

**Working shape:** an http upstream is spoken to over `std::io::tcp` and relayed chunk by chunk (`Upstream.open` and `next_data`); an https upstream goes through `std::http::request` and is played from the finished body (`compat_play`), the same events in the same order, only late.

**Resolved in hale 0.29.0** (hale-lang/hale#1698, in hale-lang/hale#1719): `std::http::BodyReader` and `SseReader` hand a body on as it arrives, over http and https, and the engine reads its upstream through `SseReader`. A keyed upstream is still read whole (`whole` in node/compat.hl, whose KNOWN GAP names #1719): since hale 0.30.0 a streamed reader presents a vault-held bearer itself (`bearer: std::secret::Credential`, hale-lang/hale#1762), which would let that path stream too.

## A payload's record stored into a bounded field with `set` or `push` dangles

**hale 0.29.0, and the stdlib/http-credential-redirects branch.** spec/semantics.md
says a payload's String or row is copied into a resident's own storage as it is
stored. The node's session kept each `FetchUpdated` it received with
`push(self.fetches, f)` and `set(self.fetches, i, f)` into a `bounded[FetchState; 16]`
field, and `set(self.seats.items, i, s)` for a seat whose strings came from it.
Once the handler returned, those strings read as other bytes (a seat's status
`2`, its reason `l`); the node then reported a status the api refused, and its
heartbeat with it, so the coordinator took it for offline. `hale check` is silent.

**Working shape:** wrap the list in a record (`type FetchStates { items:
bounded[FetchState; 16]; }`), build the next one in a local, and assign the
record whole (`self.fetches = next;`, `self.seats = next;`), which copies what it
holds (node/session.hl, `on_fetch`, `overlay`). To be filed upstream with a
reproduction.

## A write to a local record is lost once the record was handed by value to a call

**hale 0.30.1** (not 0.30.0). In `Nodes.rotate_token_held` (api/nodes.hl),
`let mut after = self.view(row) or raise;` was passed by value to
`node_change_json(after)` (inside `checked_change(...) or raise`, an
argument to `self.store.update_node(...)`), and then written:
`after.enrollment_token = token; return after;`. On 0.30.1 the caller
receives `after` without the write: `enrollment_token` empty. `hale check`
and `hale verify` are silent, and voice's `nodes_test` ("a new token") and
`node_plane_test` caught it. The create path, `v.enrollment_token = token`
after `node_change_json(v)`, still works, and a reduction with plain
records, one fallible call and one pass by value did not reproduce it, so
the trigger is narrower than that. Likely from hale-lang/hale#1767/#1770
("a method's write through a record parameter lands in its caller's
arena"). Reported to the compiler session with the voice reproduction
(revert the copy below; `hale test api/tests/nodes_test.hl` fails on
0.30.1, passes on 0.30.0).

**Working shape:** write into a fresh copy and return that
(`let mut out = after; out.enrollment_token = token; return out;`).

Still there on hale 0.32.6: with the copy reverted, `hale test api/tests/nodes_test.hl` fails "a new token".

## `hale build` tuned a binary to the CPU that built it

**hale 0.32.0.** `hale build` targeted the build machine's CPU, so a binary built on a CI runner could use instructions another machine of the same architecture lacks. voice-decide, built in CI for the decision runtimes, died with SIGILL on other CPUs.

**Working shape:** every program voice ships is built with `hale build --target-cpu baseline` (the Dockerfiles, `image.yml`, `runtime-decision.yml`), and CI refuses a shipped build without it (voice#143).

**Resolved in hale 0.32.1** (hale-lang/hale#1839): `hale build` targets the portable baseline by default, and `--target-cpu native` asks for the build machine's. Voice still passes `--target-cpu baseline` everywhere and CI still guards it; the flag is now the default, so both could go.

## A `drain()` hook never ran on SIGTERM unless something read `draining`

**hale 0.32.0.** The drain on a signal was installed only in a program that reads `self.draining`, so a locus that declared a `drain()` hook and read nothing died by the signal with its hook unrun (hale-lang/hale#1838).

**Resolved in hale 0.32.5** (hale-lang/hale#1851): a locus that declares `drain()` or `dissolve()` counts as able to answer a drain, as a reader of `self.draining` does, so a signal starts the drain and the hook runs.

## `hale verify` reported a hot-path copy whose presence moved with an unrelated constant

**hale 0.32.1.** `hale verify` failed on a "hot-path copy ... in a loop" at api/projects.hl, at a store written once, in a method with no loop. Whether it appeared depended on the length of the `MIGRATIONS` string in api/main.hl, which the code at that line has nothing to do with. The JSON codecs the compiler generates were parsed at offset 0, so their spans coincided with real files' code, and a copy recorded inside a generated decoder's loop was read back at the file's statement with the same offsets.

**Working shape:** none; voice did not reshape code around it, and voice#150 waited for the fix.

**Resolved in hale 0.32.2** (hale-lang/hale#1842): generated codecs are parsed in a position space of their own past every file, and a diagnostic inside one names the generated code.

## A codec- or hub-bound publish leaked into the bus payload arena until the api died

**hale 0.32.1.** voice-api died with SIGSEGV after about 6.5 h in the lab. Every publish on a topic bound through a codec or to a `ws::Hub` (here `NodeObserved`, once per node heartbeat) left its encoded payload in `g_bus_payload_arena`, which nothing reclaims. At its 64 MiB cap the arena returned NULL, and a caller dereferenced it.

**Resolved in hale 0.32.3** (hale-lang/hale#1845): a codec's encode runs in an arena freed when the publish's serializer returns. Reaching the cap now aborts with a report naming the arena, its cap and the frames that asked. Separately, voice#154 cut `NodeObserved` from about 37 KB to about 2.3 KB.

## A drain hook anywhere held every stop behind an endless `run()`

**hale 0.32.5.** After hale-lang/hale#1851, a `drain()` or `dissolve()` hook anywhere in a program installs the drain, which then waits for every `run()` to return. Voice's loops were `while true` (Teller, Governance, Pulse, the brain's tick), so none returned, and every stop waited out the 5 s grace and died by the signal: exit 143, measured at 5.20 s.

**Working shape:** each of those loops is `while !self.draining` (voice#160). The api stops in about 0.4 s, exit 0, with its hooks run. hale-lang/hale#1858 (an RFC) proposes a runtime-driven drain, `run()` loops stopped between iterations.

## The secrets drift check asked for `node` among the readers of a host command's secret

**hale 0.32.5.** `hale check`'s `[dna.secrets]` drift check named a reading program by its directory, so a secret read in node/install.hl, the program `[dna.host.node]` runs, demanded `node` among the secret's `readers` even when they rightly named the host command.

**Resolved in hale 0.32.6** (hale-lang/hale#1856): a host command's program reads as `host.<command>`.

## A sleep begun after the drain has begun runs its full length

**hale 0.32.6.** `std::time::sleep` snapshots the drain state when it starts, so a sleep that begins after the drain has begun is not cut short and runs its full length. A loop that checks `!self.draining` and then sleeps for its interval holds a stop that arrives between the two for the whole interval.

**Working shape:** governance and pulse sleep through `nap()`, a second at a time while `!self.draining` (voice#160). The fix is hale-lang/hale#1865, expected in hale 0.32.7.

**Resolved in hale 0.32.7 (hale-lang/hale#1865).** A timed wait that begins during a drain returns at once in a run() that watches it. `nap()` is gone; governance, pulse and the brain sleep plainly again, and SIGTERM ends the api and the brain in about 0.25 s, exit 0.
