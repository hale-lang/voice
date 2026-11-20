# Friction

What building voice in Hale runs into that is still open in Hale: the cause
and the shape that works. Read it before the next task; append when something
fights back. Versions are the `hale` the entry was found with.

As of 2026-11-20 this file is re-read against hale v0.36.1 (tag commit
`8f20ea0f9`) and lists only what is still open there. Each entry has a status
line under its heading with the evidence. Entries hale has resolved since were
removed: they are in git history, and `FRICTION.md` at `6c066b3` holds every
entry with its 2026-11-06 status.

## `hale verify` calls a hashmap row write in a long-lived locus unbounded

**Status (2026-11-20, hale v0.36.1):** STILL REAL. A locus method that `set`s a row into a `@form(hashmap)` field, called from a `run()` loop, is reported "unbounded allocation: this hashmap-insert in a fn invoked unboundedly ... grows without bound", and `hale verify` fails on it. The same program with the method `@unbounded`, run: 60,000 replacements of one key's row, each with a fresh 105-byte name built in the method, held RSS at 2896 kB from the 15,000th replacement to the 60,000th. The survey still does not see the replaced row reclaimed, so `@unbounded` stays the acknowledgement it asks for.

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

## A NATS client held for the api's life grows with every served request

**Status (2026-11-20, hale v0.36.1):** not re-measured: the measurement needs a NATS broker, and this re-read ran none. Judged from hale's CHANGELOG through v0.36.1 and the issues of hale and pond, nothing names a `NatsFramer` or a long-lived client's growth, and it was never filed. The nearest fixes are a served program's per-call growth on a connection (v0.26.0, #1626), a codec- or hub-bound publish's encoded payload (v0.32.3, #1845), a replaced `bounded` field's elements (v0.32.12, #1905) and a helper's local records freed at its return (v0.36.1, #2095); none is known to cover the framer. The per-use connection stays until the framer is measured flat.

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

## pond's pq: tab-separated rows, and a line on stdout

**Status (2026-11-20):** STILL REAL upstream; worked around in voice. pond's `db::Rows` still carries a result as `csv`, rows by newline and columns by tab with no escaping, in pond's `main` (`35c2392`) and in the copy hale v0.36.1 carries (`dna/core/pond`). The `sslmode=prefer` plaintext notice is still a `println` in pond's `main` (an `eprintln` in hale's copy), outside `std::log`. Voice reads JSON rows and logs the notice through `std::log` in its vendored copy.

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

## A text read a line at a time by slicing off the rest is quadratic in memory

**Status (2026-11-20, hale v0.36.1):** narrowed to the read; re-run on v0.36.1. Building a text by appending is linear since hale v0.33.0 (#1960): 2000 appends of a 460-byte row to a local peak at 3.7 MB for the 922 kB result. Walking that text with `rest = rest[(nl + 1)..len(rest)]` still keeps a copy of the rest for every line until the fn returns: 2000 lines raised the peak by 916 MB, in a free fn and in a locus method alike, and `hale verify` reports nothing. `std::str::lines(text)` (one linear scan since v0.34.0, #2009) counted the same 2000 lines for 64 kB.

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

Since hale v0.34.0, `for line in std::str::lines(text)` is the same single
scan without the index arithmetic.

## A write to a local record is lost once the record was handed by value to a call

**Status (2026-11-20, hale v0.36.1):** unconfirmed either way. The 2026-11-06 status called it fixed by hale-lang/hale#1832 (v0.32.0), but that issue is a different shape (a fallible member's write through a record parameter), and voice's reproduction still failed on 0.32.6 (below). On v0.36.1 a reduction of `rotate_token_held`'s shape (a fallible `view` bound with `let mut`, the record handed by value to a call nested in another call's `or raise` arguments, then written and returned) keeps the write, but so did the 0.30.1 reduction. Voice's reproduction (revert the copy, run `api/tests/nodes_test.hl`) was not re-run for this re-read. Not filed upstream. The fresh copy stays.

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

## `hale build` tunes a binary to the CPU that built it

**Status (2026-11-20, hale v0.36.1):** by design, and still a trap for anything shipped. `hale build` tunes to the build machine's CPU by default again since v0.32.8 (hale-lang/hale#1870), and its `built:` line says so (`tuned for this host's CPU, <cpu>; --target-cpu portable for a binary that runs elsewhere`). Since v0.33.0 it adds a `warning:` when it builds a host-tuned binary on CI (`CI` set) or in a container build. `--target-cpu portable` (also spelled `baseline`) is the portable build. Voice's flag and its CI guard stay.

**hale 0.32.0.** `hale build` targeted the build machine's CPU, so a binary built on a CI runner could use instructions another machine of the same architecture lacks. voice-decide, built in CI for the decision runtimes, died with SIGILL on other CPUs.

**Working shape:** every program voice ships is built with `hale build --target-cpu baseline` (the Dockerfiles, `image.yml`, `runtime-decision.yml`), and CI refuses a shipped build without it (voice#143).

**Resolved in hale 0.32.1** (hale-lang/hale#1839): `hale build` targets the portable baseline by default, and `--target-cpu native` asks for the build machine's. Voice still passes `--target-cpu baseline` everywhere and CI still guards it, and both stay: hale-lang/hale#1870 makes `hale build` tune to the build machine's CPU by default again, so every program voice ships (the images built on CI runners, voice-decide in the decision runtimes, the darwin node tarball) needs the flag to run on another machine. Only a build that runs where it was built may drop it.

## `std::regex` reads an escape as a backslash

**Status (2026-11-20, hale v0.36.1):** STILL REAL, re-run on v0.36.1: `std::regex::matches(r"a\.b", "a.b")` is false and `matches(r"a\.b", r"a\b")` is true; `matches(r"\d", "7")` is false and `matches(r"\d", r"\")` is true; `matches(r"[\d]", "d")` is true and `matches(r"[\d]", "5")` false. `std::regex::valid` accepts each pattern. The runtime's pattern parser steps past the escaped character and emits the backslash in its place. Not filed upstream yet.

**hale 0.32.12.** Found while voice checked the version pattern of a
coding CLI's recipe (voice#236; the CLI recipes were removed with voice's
coding harnesses in voice#239). A pattern written with the usual escapes,
`v(\d+)\.(\d+)`, does not read as written. Outside a class, `\x` is a
literal backslash and the `x` is dropped: `a\.b` matches `a\b`, not `a.b`,
and `\d` matches `\`. Inside a class, `\x` is the character itself, so
`[\d]` matches `d` and not a digit. spec/stdlib.md lists "`\` escapes" in
`std::regex`'s syntax and no `\d`, `\w` or `\s` classes, and `valid` passes
every one of these patterns, so nothing says the pattern means something else.

**Working shape:** no escapes. A metacharacter goes in a class of its own
(`[.]`, `[(]`, `[+]`), and the shorthand classes are spelled out (`[0-9]`,
`[A-Za-z0-9_]`, `[ \t]`): `v([0-9]+)[.]([0-9]+)` matches `v1.22`. Voice's
recipe check rewrote each escape that way before matching (`std_pattern`,
removed with the recipes).
