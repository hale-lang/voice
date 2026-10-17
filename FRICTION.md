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

## `std::http::Server` refuses a body over 1 MiB before the handler sees it

**hale 0.24.0.** A request whose body is over 1 MiB is answered by the
server itself: `413 Content Too Large`, `Content-Type: text/plain`, body
`payload too large`. The handler never runs, so the answer is neither the
contract's limit (a request body may be up to 12 MiB) nor its shape (an
`ErrorResponse` with `code`). The cap is not a knob of `std::http::Server`.

**Working shape:** none in voice; the contract stays at 12 MiB and the
JSON error. A request between 1 and 12 MiB (a long conversation, an
attached file) is refused with plain text until the server's cap can be
set (`TODO` in `api/inference.hl`, a line in the README).
