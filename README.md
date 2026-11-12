# voice

[![ci](https://github.com/hale-lang/voice/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hale-lang/voice/actions/workflows/ci.yml)

One inference endpoint in front of many model backends.

A caller names a model and presents a project key. Voice picks a seat that
can serve the model, enforces the project's limits and budget, and records
what the request used against the project, the key and the account that pays.
It speaks the OpenAI-compatible `/v1/chat/completions` and `/v1/responses`,
streamed or not, and serves many requests at once.

A seat is a hosted model under one of your accounts (an agent CLI logged in
per account, or any OpenAI-compatible endpoint) or a model voice runs itself
on your own GPUs, pinned to the byte.

Voice is written in [Hale](https://github.com/hale-lang/hale).

## How it works

```
 caller ──HTTP──▶ api ──NATS──▶ node ──▶ seat (an engine under an account)
                   │  ▲                   managed, openai-compatible, harness, claude-cli, static
                   ▼  │
                 Postgres ◀── brain (ranks seats into the route table)
```

- **api** serves the caller's endpoints and the admin plane: models,
  accounts, projects, keys, budgets, limits, nodes and seats. Its
  configuration lives in Postgres.
- **node** runs on a machine that can reach a model. It offers that
  machine's engines as **seats** and serves the requests the api assigns it:
  - `managed`: a local model voice fetches, verifies and runs (llama.cpp on
    Metal, vLLM or llama.cpp on CUDA), as the operator places it;
  - `openai-compatible`: an endpoint that speaks the OpenAI API;
  - `harness`: an agentic coding CLI (Claude Code, Codex, Antigravity,
    Vibe) under one login per seat, running coding attempts in a container
    of their own ([`docs/coding-attempts.md`](./docs/coding-attempts.md));
    `claude-cli` is the claude harness under its older name, and also
    answers requests;
  - `static`: a canned answer, for trying voice and for tests.
- **brain** turns the state of the fleet into a ranked route table.

A request is checked against its key, its project's limits and budget, sent
to a seat over NATS, streamed back, and metered. A conversation's turns (its
`prompt_cache_key`) go to the same seat each time, so that seat's prompt
cache holds what was said, and its usage records are grouped by it.

## Getting started

You need Docker with Compose 2.20 or later.

```sh
git clone https://github.com/hale-lang/voice && cd voice
docker compose up --build -d
curl localhost:8080/healthz
```

To run voice as an organism of a hale habitat instead, graft it from the
toolchain's nursery with `hale habitat graft voice`; it needs no checkout or
build of its own (hale's habitat chapter, in `docs/src/habitat.md`, has the rest).
Voice brings its own Postgres and NATS; `--reuse database --reuse broker` has
the habitat provide them instead, and voice's compose then connects to the
habitat's and starts neither of its own (compose.yaml says how).

This starts Postgres, NATS, the api (on `localhost:8080`, with the admin UI
at `/`; its live hub on `8085`) and the brain: the coordinator. Nodes serve the models, each on its
own machine, natively, where its GPU is: in a habitat, `hale habitat organism
place voice node --host <h>` (`--host local` for the habitat's own machine);
by hand, [docs/adding-a-node.md](docs/adding-a-node.md), this machine's
too. Compose runs no node: each is added on purpose.

The admin plane (`/admin/v1`, and the admin UI) takes the **operator token**,
which the api mints on its first start and keeps in Postgres. It is never in
the environment or a log; print it with

```sh
docker compose exec api voice-api admin-token
```

The UI asks for it once and keeps it in the browser.

## End to end

Set up a model, the account that pays for it, a project with a key, and a
node with a seat. Then ask.

```sh
api=localhost:8080; json='content-type: application/json'
# the operator token, as a header in a file (kept off the command line)
docker compose exec api voice-api admin-token | sed 's/^/Authorization: Bearer /' > admin.h

# a model, the account that serves it, and a project with a key
curl -X POST $api/admin/v1/models   -H @admin.h -H "$json" -d '{"id": "echo-1"}'
curl -X POST $api/admin/v1/accounts -H @admin.h -H "$json" -d '{"id": "static", "name": "Static"}'
curl -X POST $api/admin/v1/projects -H @admin.h -H "$json" -d '{"id": "work", "name": "Work"}'
curl -X POST $api/admin/v1/projects/work/keys -H @admin.h -H "$json" -d '{"name": "laptop"}'
#   -> "secret": "vk-..."

# the node, and a seat on it running the static engine
curl -X POST $api/admin/v1/nodes -H @admin.h -H "$json" -d '{"id": "local"}'
#   -> "enrollment_token": "vn-..."
curl -X POST $api/admin/v1/nodes/local/seats -H @admin.h -H "$json" -d '{
  "id": "static", "engine": "static", "account": "static",
  "serves": [{"model": "echo-1"}], "config": {"text": "hello from voice"}}'
# start it on this machine, natively, with the token that answered
hale build node && node/node --id local --api http://$api --token vn-... --capabilities deploy/node/capabilities.json

# ask
curl $api/v1/chat/completions -H 'Authorization: Bearer vk-...' -H "$json" \
  -d '{"model": "echo-1", "messages": [{"role": "user", "content": "hi"}]}'
```

Add `"stream": true` to get server-sent events. `GET /admin/v1/changes`
lists every configuration change you just made.

## From a shell

Three tools in [`scripts/`](./scripts/) work with a running voice as a
caller does, with a project key. Each takes `--help`.

- `voice-ask "a question"` streams the answer's text. With no `-m` it asks
  the `general` alias, else the first chat model the key may use. A
  decision model (`-m jev-style-2b-decision-v3 "blue or green?"`) answers
  the text as one question, a choice (`X or Y?`, or `-c a,b,c`) or yes or
  no, with its probabilities.
- `voice-codex` runs the [Codex CLI](https://github.com/openai/codex) on
  voice's coder model (`coder`, else `coding`, `coder-big`, `coder-med`;
  `VOICE_MODEL` names another), with the model's context window from
  voice so Codex compacts before it overflows. Its other arguments go to
  `codex`; nothing in `~/.codex` changes.
- `voice-saturate` loads voice and reports, per model, requests ok and
  failed (by status and error code), latency and time to first token,
  tokens per second, and answers cut at max tokens. `model:RATE` sends a
  fixed rate whether or not voice keeps up (capped by `--max-inflight`);
  `-c N` or `-c MIN-MAX` keeps that many in flight; `--sweep 1,2,4,8
  --csv curve.csv` measures one model at a time at each concurrency. A
  decision model is loaded only when named: it is asked coding questions
  with a choice or yes/no schema, and its row reports decisions a second
  and any answer that came back without a decision.

```sh
export VOICE_API=http://voice.example:8080   # or pass --local for http://127.0.0.1:8080
export VOICE_KEY_FILE=~/.config/voice/key    # the key alone, or `Authorization: Bearer vk-...`
scripts/voice-ask "Explain what a GPU does, in three sentences."
scripts/voice-saturate -c 8 -d 30 general
```

| Variable | What |
|---|---|
| `VOICE_API` | voice's address; required unless `--local` (given first) |
| `VOICE_API_KEY` | a project key (`vk-...`) |
| `VOICE_KEY_FILE` | without `VOICE_API_KEY`, a file holding the key |
| `VOICE_MODEL` | `voice-ask`'s default model, `voice-codex`'s model |
| `VOICE_CONTEXT_WINDOW`, `VOICE_COMPACT_AT` | `voice-codex`: the window, and where Codex compacts (four fifths of it) |

The key is never printed or passed on a command line. `voice-ask` and
`voice-codex` need curl and jq (and `codex`); `voice-saturate` needs only
python3.

## Local models

The operator decides which weights and which servers may run:

- a **recipe** pins a model's weights: one commit of one Hugging Face repo,
  every file by its sha256, and only tensor, tokenizer and settings files
  (never a pickle or code, so nothing runs when they load);
- a **runtime** pins the server that runs them (vLLM or llama-server) by its
  container digest or archive sha256;
- a **placement** puts a catalog model on a node: voice picks the variant
  and runtime that fit the node's hardware, the node fetches and checks every
  file, and the seat comes up. A model too large for one machine is placed
  across two cabled to each other, once their link passed its check
  ([`docs/adding-a-node.md`](./docs/adding-a-node.md));
- an **arrangement** states what the whole fleet is for: models pinned to
  nodes, and roles to fill (coder, decider, small…, from
  [`catalog/roles.json`](./catalog/roles.json)). Voice proposes a plan, a
  diff against what is placed now (keep, remove, add, alias), judged by the
  same fit a placement is, with what each node fetches and what goes down
  (`planArrangement`, `voice-api arrange plan --wants FILE`, the **Arrange**
  screen). A plan changes nothing until the operator applies it
  (`applyArrangement`, `voice-api arrange apply`, the screen's **apply**):
  voice plans again and refuses a plan the fleet has moved on from, then
  removes, adds and points aliases in that order, stopping at a step that
  fails and saying what was done. An arrangement may be kept under an id and
  planned again on demand, after a node joins, say (`voice-api arrange plan
  --arrangement ID`, the screen's **re-plan**); the screen says when the
  fleet has changed since it was last planned, and plans nothing on its own.

Voice ships a default catalog of recipes per memory tier and platform
([`recipes/README.md`](./recipes/README.md),
[`docs/catalog-recipes.md`](./docs/catalog-recipes.md)) and its runtimes in
[`runtimes/`](./runtimes/); the operator allows more on the admin plane.
Hardening the runtime's container is tracked in
[#109](https://github.com/hale-lang/voice/issues/109).

## The admin UI

Served by the api at `/`, under the operator token:

- **Overview**, **Network** (the fleet as a graph, lit while each request
  runs, the api instances live over the hub), **Route table**;
- **Usage**: a live board of conversations, the ledger with filters, and a
  request's recording (for a project or key that **peeks**: kept seven days)
  read as a conversation, its context beside the back and forth;
- **Chat**: talk to a model as a project's caller, with the hosted **web
  fetch** where its model takes tool calls; **Tools**: web fetch on or off,
  its limits and its denylist ([docs/internals.md](docs/internals.md));
- **Nodes**, **Accounts**, **Catalog**, **Placements**, **Arrange**, **Recipes**,
  **Runtimes**, **Projects** (subprojects, keys, limits, budgets, peek),
  **Changes** (every admin change, field by field), **API** (the contract);
- an event log docked at the foot of every screen: requests taking off and
  landing, nodes, changes.

## Developing

With the [Hale toolchain](https://github.com/hale-lang/hale) at the release
voice pins (`[dna] toolchain` in [`hale.toml`](./hale.toml), v0.32.8; the
Dockerfile and CI use the same):

```sh
hale build api && hale test api
hale build node && hale test node
hale build brain && hale test brain
hale test store   # and over Postgres: VOICE_TEST_DATABASE_URL=postgres://...
```

The UI (`ui/`, React) against a running api:

```sh
cd ui && npm ci && VOICE_API=http://127.0.0.1:8080 npm run dev
```

The api's own ports: `--port` (8080), the hub's `VOICE_HUB_PORT` (8085) and
the runtime probes' `VOICE_PROBE_PORT` (9090). Two api processes on one host
need their own of each.

| Path | What |
|---|---|
| [`api/`](./api/) | the api: caller endpoints, admin plane, node plane |
| [`node/`](./node/) | the node and its engines |
| [`brain/`](./brain/) | the route table |
| [`store/`](./store/) | the Postgres schema and migrations |
| [`ui/`](./ui/) | the admin UI |
| [`spec/`](./spec/) | the contract: OpenAPI, the node and internal protocols, the store's schema |
| [`docs/api/`](./docs/api/) | the API reference, generated from the contract: [the caller and admin API](./docs/api/voice.md), [the node's](./docs/api/node.md) (`spec/tools/apidocs.sh`) |
| [`recipes/`](./recipes/), [`runtimes/`](./runtimes/) | the models and servers voice ships |
| [`scripts/`](./scripts/) | end-to-end, race and catalog scripts; [the shell tools](#from-a-shell) |

CI checks format and `hale verify`, the tests (the store's over Postgres too),
the api's export against the contract, the UI's build, a node on macOS, an
end-to-end run over Postgres and NATS, a fresh clone as a graft takes it, and the image.

## Status

Running: configuration, the caller's endpoints (streamed and not, many at
once), coding attempts on four agentic coding CLIs, the node plane, the
brain, agent-CLI, OpenAI-compatible and managed local seats, usage metering and the ledger, peek recordings, the admin event
stream and the live hub, and voice as a habitat organism (a provider of
models to the habitat's other organisms, each a project under the habitat's).

## More

- [`docs/internals.md`](./docs/internals.md): how each piece works, the
  request path, state, security, failure and deployment.
- [`docs/adding-a-node.md`](./docs/adding-a-node.md): a Mac or a Linux
  machine joining as a node, in one command.
- [`docs/coding-attempts.md`](./docs/coding-attempts.md): running agentic
  coding CLIs on repositories, their logins, the sandbox and cleanup.
- [`DIRECTION.md`](./DIRECTION.md): where voice is going.
- [`FRICTION.md`](./FRICTION.md): what writing voice in Hale has run into.
