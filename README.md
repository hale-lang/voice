# voice

[![ci](https://github.com/hale-lang/voice/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hale-lang/voice/actions/workflows/ci.yml)

One inference endpoint in front of many model backends.

A caller names a model and presents a project key. Voice picks a seat that
can serve the model, enforces the project's limits and budget, and records
what the request used against the project, the key and the account that pays.
It speaks the OpenAI-compatible `/v1/chat/completions` and `/v1/responses`,
streamed or not.

Voice is written in [Hale](https://github.com/hale-lang/hale).

## How it works

```
 caller ──HTTP──▶ api ──NATS──▶ node ──▶ seat (an engine under an account)
                   │  ▲                   static, openai-compatible, claude-cli (a login per account), ...
                   ▼  │
                 Postgres ◀── brain (ranks seats into the route table)
```

- **api** serves the caller's endpoints and the admin plane: models,
  accounts, projects, keys, budgets, limits, nodes and seats. Its
  configuration lives in Postgres.
- **node** runs on a machine that can reach a model. It offers that
  machine's engines as **seats** and serves the requests the api assigns it.
- **brain** turns the state of the fleet into a ranked route table.

A request is checked against its key, its project's limits and budget, sent
to a seat over NATS, streamed back, and metered.

## Getting started

You need Docker with Compose.

```sh
git clone https://github.com/hale-lang/voice && cd voice
docker compose up --build -d
curl localhost:8080/healthz
```

To run voice as an organism of a hale habitat instead, graft it from the
toolchain's nursery with `hale habitat graft voice`; it needs no checkout or
build of its own (hale's habitat chapter, in `docs/src/habitat.md`, has the rest).

This starts Postgres, NATS, the api (on `localhost:8080`, with the admin UI
at `/`), the brain and a node. The node waits for an enrollment token.

## End to end

Set up a model, the account that pays for it, a project with a key, and a
node with a seat. Then ask.

```sh
api=localhost:8080; json='content-type: application/json'

# a model, the account that serves it, and a project with a key
curl -X POST $api/admin/v1/models   -H "$json" -d '{"id": "echo-1"}'
curl -X POST $api/admin/v1/accounts -H "$json" -d '{"id": "static", "name": "Static"}'
curl -X POST $api/admin/v1/projects -H "$json" -d '{"id": "work", "name": "Work"}'
curl -X POST $api/admin/v1/projects/work/keys -H "$json" -d '{"name": "laptop"}'
#   -> "secret": "vk-..."

# the node, and a seat on it running the static engine
curl -X POST $api/admin/v1/nodes -H "$json" -d '{"id": "local"}'
#   -> "enrollment_token": "vn-..."
curl -X POST $api/admin/v1/nodes/local/seats -H "$json" -d '{
  "id": "static", "engine": "static", "account": "static",
  "serves": [{"model": "echo-1"}], "config": {"text": "hello from voice"}}'
VOICE_ENROLLMENT_TOKEN=vn-... docker compose up -d node

# ask
curl $api/v1/chat/completions -H 'Authorization: Bearer vk-...' -H "$json" \
  -d '{"model": "echo-1", "messages": [{"role": "user", "content": "hi"}]}'
```

Add `"stream": true` to get server-sent events. `GET /admin/v1/changes`
lists every configuration change you just made.

## Developing

With the [Hale toolchain](https://github.com/hale-lang/hale) (the version
in [`Dockerfile`](./Dockerfile)):

```sh
hale build api && hale test api
hale build node && hale test node
hale build brain && hale test brain
```

| Path | What |
|---|---|
| [`api/`](./api/) | the api: caller endpoints, admin plane, node plane |
| [`node/`](./node/) | the node and its engines |
| [`brain/`](./brain/) | the route table |
| [`store/`](./store/) | the Postgres schema and migrations |
| [`ui/`](./ui/) | the admin UI |
| [`spec/`](./spec/) | the contract: OpenAPI, the node and internal protocols |

## Status

Configuration, the caller's endpoints, the node plane, the brain and
inference on a node's static seat are real. Usage reporting and the admin
event stream still answer a canned body.

## More

- [`docs/internals.md`](./docs/internals.md): how each piece works, the
  request path, state, security, failure and deployment.
- [`docs/node-on-a-mac.md`](./docs/node-on-a-mac.md): one Mac serving
  models (Ollama, the claude CLI) to a habitat, under launchd.
- [`DIRECTION.md`](./DIRECTION.md): where voice is going.
- [`FRICTION.md`](./FRICTION.md): what writing voice in Hale has run into.
