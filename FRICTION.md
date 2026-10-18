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

## Triple-quoted and raw strings are in the grammar's comment, not the lexer

**hale 0.21.0.** `spec/grammar.ebnf` notes `STRING_LIT` as
`"..." with escapes; r"..." raw; """..."""`, but `"""{"a": 1}"""` lexes as
an empty string followed by another literal. Only `"..."` with `\"` escapes
exists.

**Working shape:** JSON bodies live in files and are read at request time
(`api/canned/`), not embedded in source.

## `std::http` has no reason phrase for most statuses

**hale 0.21.0.** `__status_phrase` covers 101, 200, 301, 400, 404, 413 and
500. Everything else goes out as `Status`, e.g. `HTTP/1.1 201 Status`.
Clients ignore reason phrases, so nothing breaks, but it reads wrong in a
trace.

**Working shape:** none needed. Worth adding 201, 202, 204, 401, 403, 409,
429, 502, 503 and 504 upstream.

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
prints `[pq] tls: ... negotiated PLAINTEXT` on stdout, which fails a
`hale test` (a passing test is silent).

**Working shape:** every read is `SELECT row_to_json(t) FROM (...) t`, one
JSON object a line, since JSON escapes every tab and newline
(`store/pg_store.hl`, as DNA's ledger does); the DSN takes `?sslmode=`, and
the tests and compose use `sslmode=disable` on the private network.

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

**Working shape:** the api's cap is 2 MiB until then (`MAX_REQUEST_BYTES`, api/main.hl; about 274 MB worst case), still answered `413 request_too_large` in the contract's envelope. The contract's 12 MiB returns when a hale release reads the body in linear memory (a `std::bytes::BytesBuilder` in place of `raw = raw + chunk`).
