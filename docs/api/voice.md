<!-- Generated from spec/openapi.yaml by spec/tools/apidocs/render.mjs. Do not edit: run spec/tools/apidocs.sh. -->

# voice (0.1.0-draft)

> Generated from [`spec/openapi.yaml`](../../spec/openapi.yaml), the contract. Regenerate with `spec/tools/apidocs.sh`; CI fails when this file and the contract differ.

One inference endpoint over local engines and hosted providers.

Voice serves inference over a catalog that holds local models and hosted
providers' models as peers. A caller names a **model** and presents a
**project key**; it never names a node. It may name the **account** that
pays. Which nodes exist and which seats they run is voice's internal
concern (hale-lang/voice#1).

## The standard at the core

The caller API **is** [Open Responses](https://www.openresponses.org/specification)
(spec version `2026-04-24`), the open, multi-provider standard derived from
the OpenAI Responses API. Request, response, item, streaming-event and
usage shapes are taken by reference from the upstream OpenAPI document,
vendored at `spec/vendor/open-responses/openapi.json`; this file adds only
what voice needs on top, following the standard's extension rules:

- Extra fields on existing objects live in one optional `voice` object.
- New streaming events are prefixed with voice's slug (`voice:attempt`).
- Caller tags use the standard `metadata` field (16 pairs, keys up to 64
  characters, values up to 512). Voice echoes it on the response and
  stores it on the usage record untouched. DNA puts the attempt id there.

`POST /v1/chat/completions` is kept as a **compatibility** surface so
clients that only speak Chat Completions work unchanged. It carries the
same `voice` extension and `metadata`.

## Two planes

- **Caller plane** (`/v1/...`): authenticated by a project key.
- **Admin plane** (`/admin/v1/...`): authenticated by the operator token.
  Configures the model catalog, accounts, nodes, projects, their budgets
  and limits, and their keys; reads usage.
- **Node plane** (`/node/v1/...`): authenticated by a node's enrollment
  token. A node registers here, reads its assignment, and reports its
  state. Requests reach a node over NATS on the private network
  (`protocol.yaml`); this plane is the node's control plane.

The admin plane takes the operator token, `Authorization: Bearer va-...`:
the api mints it on its first start and keeps it in its store, and
`voice-api admin-token` prints it. A request without it is refused
(`401`, or `403` for one with no credential at all). OIDC principals drop
in later with no change to these endpoints. Project keys on the caller
plane and nodes' enrollment tokens are enforced from the MVP on.

Every request is attributed to exactly one project and one key, so usage
can be tracked and budgeted per project and broken down per key.

Under DNA, projects are positions, budgets are grants and limits are policy
rows, and changing them is a reviewed decision. A deployment that requires
review answers a policy write with `202` and a `PolicyChange` naming the
pending review instead of applying it; a deployment without that
requirement answers `200` and applies it. The request shape is the same.

## Nodes, seats and accounts

Nothing is discovered. Everything that serves is configured by an
operator, through an API.

- A **node** is one machine running voice's node software, on the private
  network with NATS. The operator creates it here, which issues an
  enrollment token, then starts the node with that token and the api's
  address. The node registers itself on start; one live node per id.
- A node **offers engines**: the static engine, or a CLI logged in to one
  login. Its operator lists them, with the node's hard limits, in a file
  on the machine, and the node declares them when it connects. Logins
  never leave the machine.
- A **seat** is configured here, on a node: one of the node's engines,
  spending one account, serving some catalog models. The coordinator
  sends every node its seats as an assignment; the node runs them,
  refuses any outside what it offers, and reports their state. A node
  that is offline gets its seats when it returns.
- A node's operator can **pause** the node or a seat, or lower its
  in-flight cap, on the machine. Local controls only restrict, and the
  node reports them.
- An **account** is what pays and what has limits: a subscription, a
  metered API key, or nothing for a local engine. Several seats may share
  one account (the same login on two machines), and they share its
  limits.
- The **catalog** is configured here: model ids, context, output
  ceilings and prices. Seats on every node refer to the same ids, so the
  coordinator can route one model across all of them.

**Routing.** For a request, the eligible seats are those that serve the
model, are up on a connected node, carry the request's data class, and
spend an account the key permits (narrowed by `voice.account` when the
request names one). Accounts with no headroom left are skipped, and
seats at their concurrency, or on a node at its in-flight cap, are
skipped. Voice picks the account with the
most headroom, then the least loaded of its seats.

The coordinator reaches nodes over NATS on the private network, and nodes
report to it on this plane; `protocol.yaml` and the node plane together
are the seam any node implementation plugs into. Only the api is
exposed. It proxies and never redirects.

**One admin UI.** The api serves the admin UI itself, from the same
origin as this plane, and every node is administered through it: seats,
caps and state all live here. A node's own API (`node.yaml`) is only for
the machine it runs on.

## Phases

The API is the same in every phase; only what stands behind it changes.

- **MVP: static.** One api, one brain and one node on one machine. The node
  offers the `static` engine, and a seat on it answers every request with
  its configured text. Everything is set up through the APIs: a model, an
  account, a node and its seat, a project and a key. This proves the whole surface
  end to end: configuration, routing, keys, projects, limits, budgets,
  usage records and both streaming formats. Tokens are counted from the
  fixed text and priced at the model's configured price.
- **v1: agent CLIs.** Seats wrap the CLIs of the operator's own accounts
  (`claude -p`, `codex exec`), with engines `claude-cli` and `codex-cli`,
  and report the usage and quota windows the CLIs return.
- **Later: local engines.** llama.cpp server, MLX and vLLM seats, with
  routing by memory fit, load and weights on disk.

## Conventions

- Money is integer **micros** of `currency` (default USD), matching
  `cost_micros` on hale's `ModelEvidence`.
- Durations are integer milliseconds, suffixed `_ms`.
- Timestamps in voice's own objects are RFC 3339. Timestamps inside
  standard objects stay Unix seconds, as the standard defines them.
- Errors on the caller plane and the node plane use the standard's
  envelope with voice-specific `code` values. The admin plane is the
  api's surface, served by `http::Rest` from its rows' routes: a handler's
  failure is its class's variant (`{"NotFound": {...}}`, with the class
  in `Hale-Error-Class`), and a request the transport cannot decode is
  `{"refusal": {...}}`.
- A request body is at most 1 MiB, the transport's own limit. (The
  contract meant 12 MiB, `413 request_too_large`, to keep a request,
  wrapped for a node, inside the node protocol's 16 MiB message; hale's
  `http::Rest` has no knob for it yet, and refuses a larger body
  `400 malformed` before the data plane sees it.)

## What of the standard is served

`POST /v1/responses`, streaming and not, is the core. Two parts of Open
Responses `2026-04-24` are not served yet:

- `POST /v1/responses/compact` answers `404 not_found`.
- The standard's WebSocket mode on `/v1/responses`: an upgrade request
  answers `400 unsupported`. Stream with server-sent events instead.

Stored responses are not served either; see `createResponse`.

## Rate limits, budgets and quota

Limits apply per project, per key and per model: requests, input tokens and
output tokens per window, and concurrent in-flight requests. The project's
budget is a hard cap on spend per period. The coordinator reserves against
every applicable limit and the budget before dispatch, using estimated
input tokens plus the requested maximum output (the model's default maximum
when the request sets none), and settles on actual usage. A refusal is
`429` with `Retry-After`. Seat saturation is a routing fact and never
produces a 429; the request queues.

An account that is out of headroom is not the caller's limit. When every
account that could serve a request is exhausted, the answer is `503`
with code `no_capacity` and `Retry-After` set to the earliest reset. A
request that names an account fails this way at once rather than
falling back to another account.

Every caller-plane response carries the remaining-quota headers, so a
client can pace itself instead of discovering the wall by failing.

## Contents

- [inference](#tag-inference) (2)
- [catalog](#tag-catalog) (2)
- [capabilities](#tag-capabilities) (1)
- [projects](#tag-projects) (9)
- [keys](#tag-keys) (5)
- [usage](#tag-usage) (11)
- [models](#tag-models) (5)
- [recipes](#tag-recipes) (4)
- [runtimes](#tag-runtimes) (4)
- [placements](#tag-placements) (4)
- [accounts](#tag-accounts) (5)
- [nodes](#tag-nodes) (12)
- [changes](#tag-changes) (1)
- [events](#tag-events) (1)
- [routes](#tag-routes) (2)
- [node](#tag-node) (8)
- [health](#tag-health) (2)
- [annotations](#tag-annotations) (11)
- [Schemas](#schemas)

## Authentication

- **projectKey** (http, bearer): A project key, presented as `Authorization: Bearer vk-...`; or, from an organism of voice's habitat, the key the habitat drew for it, which voice makes a project of its own, `tenant-<organism>`, a child of the habitat's project, `habitat-<name>`, that inherits its accounts.
- **enrollmentToken** (http, bearer): A node's enrollment token, presented as `Authorization: Bearer vn-...` on the node plane.
- **operatorToken** (http, bearer): The operator token, presented as `Authorization: Bearer va-...` on the admin plane. The api mints it on its first start and keeps it in its store; `voice-api admin-token` prints it.

## Servers

- `https://voice.example.invalid`: Placeholder; the coordinator's address is deployment-local.

<a id="tag-inference"></a>

## inference

Caller plane. Open Responses, plus Chat Completions for compatibility.

### POST `/v1/responses`

**Create a response (Open Responses)** · `createResponse`

Authentication: projectKey

Conforms to Open Responses `2026-04-24` `POST /responses`, extended with
an optional `voice` object on the request and a required `voice` object
on the response.

**Routing.** Voice selects a seat as described under *Nodes, seats
and accounts*. With `voice.account` set, only that account's seats are
eligible; the key must permit the account (`403
account_not_permitted` otherwise), and when the account has no
headroom the request fails with `503 no_capacity` rather than moving
to another account. The coordinator proxies and never redirects.

**Retries.** If a seat fails before any output has been sent, the
request is retried on another eligible seat, within the named account
when there is one. Each try is listed in `voice.attempts`, and when
streaming a `voice:attempt` event marks the switch. If a seat fails
after output has begun, the response fails with that evidence rather
than restarting, because the v1 engines cannot resume from partial
output. Continuing on another seat is a later capability for engines
that support it.

**Streaming.** With `stream: true` the response is the standard event
stream. The terminal `response.completed`, `response.incomplete` or
`response.failed` event carries the full response object, including
`voice`. A stream whose seat fails once it has begun ends with an
`error` event, then `response.failed` carrying the response as far as
it came (its output so far and its `error`) with `voice` and every
attempt, then `data: [DONE]`. A seat has 120 seconds from one message
to the next until its first output (a slow model, or an engine that
answers at the end), then 30 seconds between events; one that sends
nothing for that long has failed. While a seat that accepted is waited
for, the stream carries an SSE comment (`: keep-alive`) whenever 15
seconds pass with nothing sent, the first opening the stream if no
event has; a request failed after that ends as a failed stream, not a
`502`. Each keep-alive is followed a second later by an empty comment
(`:`). A caller that goes away is found by the next write that fails,
so within about 16 seconds, and its seat is told to stop. A request body is
sent with `Content-Length`; a chunked one is refused `400`.

**State (MVP).** Voice does not store responses in the MVP. `store` is
accepted and treated as false; a request with `previous_response_id`
fails with `previous_response_not_found`. `background` is not supported.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Idempotency-Key` | header | string |  | When a client retries with the same key within the retention window, voice returns the original result instead of serving and billing again. |

Request body

`application/json`

Schema: [CreateResponseRequest](#schema-createresponserequest)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [CreateResponseBody](#schema-createresponsebody) |  |  |  |
| `voice` | [VoiceRequestExtension](#schema-voicerequestextension) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The response, or the standard event stream when `stream` is true. | `application/json` [Response](#schema-response)<br>`text/event-stream` [schema](#schema-schema) \| [VoiceAttemptEvent](#schema-voiceattemptevent) |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No model by that name in the catalog. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 413 | The request body is over 12 MiB. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 429 | A rate limit or the project's budget refuses the request. `code` is `rate_limited` or `budget_exhausted`; `voice.limit` names the limit. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 502 | Every eligible seat failed; `voice.attempts` lists them. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | Nothing can serve the request now. `no_eligible_seat`: no enabled seat on a connected node serves this model for this data class and these accounts. `no_capacity`: seats exist, but every account they spend is out of headroom; `Retry-After` is the earliest reset. `metering_unavailable`: the ledger cannot record usage, so nothing is served until it can. Seat saturation alone never produces this; it queues. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 504 | The request's `voice.deadline` passed before it was served. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/v1/chat/completions`

**Create a chat completion (compatibility)** · `createChatCompletion`

Authentication: projectKey

OpenAI Chat Completions, for clients that do not speak Open Responses.
Routing, retries, limits and the `voice` extension behave exactly as on
`/v1/responses`. With `stream: true` the final chunk before
`data: [DONE]` carries `usage` and `voice`. A stream whose seat fails
once it has begun ends with a final chunk whose `finish_reason` is
`error`, carrying an `error` object, `usage: null` and `voice`, then
`data: [DONE]`: a truncated answer never ends as a complete one.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Idempotency-Key` | header | string |  | When a client retries with the same key within the retention window, voice returns the original result instead of serving and billing again. |

Request body

`application/json`

Schema: [ChatCompletionRequest](#schema-chatcompletionrequest)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string | yes |  |  |
| `messages` | array of [ChatMessage](#schema-chatmessage) | yes |  | items ≥ 1 |
| `max_tokens` | integer |  |  | ≥ 1 |
| `max_completion_tokens` | integer |  | Newer spelling of `max_tokens`; if both are set this wins. | ≥ 1 |
| `temperature` | number |  |  | ≥ 0; ≤ 2 |
| `top_p` | number |  |  | ≥ 0; ≤ 1 |
| `stop` | string \| array of string |  |  |  |
| `seed` | integer |  |  |  |
| `n` | `1` |  |  |  |
| `prompt_cache_key` | string |  | One value per conversation, the same on each of its turns (as on `/v1/responses`). Voice sends a conversation to the same seat each turn when several serve its model, so the seat's prompt cache holds what it said and a turn reads only what it added. A routing key, never a secret or user data; leave it out for one-shot calls. |  |
| `stream` | boolean |  |  | default `false` |
| `stream_options` | object |  |  |  |
| `stream_options.include_usage` | boolean |  |  |  |
| `tools` | array of object |  | Function tools, passed to the seat as they are. Only a seat that carries tools serves a request that lists them (an `openai-compatible` seat; a `static` seat only as its drill); the others refuse it and the request moves to the next seat. The answer's calls come back as `tool_calls` (deltas when streamed) with `finish_reason: "tool_calls"`. |  |
| `tool_choice` | any |  |  |  |
| `response_format` | object |  |  |  |
| `metadata` | [Metadata](#schema-metadata) |  |  |  |
| `voice` | [VoiceRequestExtension](#schema-voicerequestextension) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The completion, or a stream of chunks when `stream` is true. | `application/json` [ChatCompletion](#schema-chatcompletion)<br>`text/event-stream` [ChatCompletionChunk](#schema-chatcompletionchunk) |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No model by that name in the catalog. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 413 | The request body is over 12 MiB. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 429 | A rate limit or the project's budget refuses the request. `code` is `rate_limited` or `budget_exhausted`; `voice.limit` names the limit. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 502 | Every eligible seat failed; `voice.attempts` lists them. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | Nothing can serve the request now. `no_eligible_seat`: no enabled seat on a connected node serves this model for this data class and these accounts. `no_capacity`: seats exist, but every account they spend is out of headroom; `Retry-After` is the earliest reset. `metering_unavailable`: the ledger cannot record usage, so nothing is served until it can. Seat saturation alone never produces this; it queues. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 504 | The request's `voice.deadline` passed before it was served. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-catalog"></a>

## catalog

Caller plane. Models visible to the presented key.

### GET `/v1/models`

**List models visible to this key** · `listModels`

Authentication: projectKey

Local and hosted models appear together; the `voice` extension says
which is which, its price, and which data classes it may carry. Nodes,
seats and accounts are never listed here. A name the key's project
gives a model (`ModelAlias`) is listed too, as that model by the name.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The catalog as this key sees it. | `application/json` [ModelList](#schema-modellist) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | Nothing can serve the request now. `no_eligible_seat`: no enabled seat on a connected node serves this model for this data class and these accounts. `no_capacity`: seats exist, but every account they spend is out of headroom; `Retry-After` is the earliest reset. `metering_unavailable`: the ledger cannot record usage, so nothing is served until it can. Seat saturation alone never produces this; it queues. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/v1/models/{model}`

**Describe one model** · `getModel`

Authentication: projectKey

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `model` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The model. | `application/json` [Model](#schema-model) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No model by that name in the catalog. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | Nothing can serve the request now. `no_eligible_seat`: no enabled seat on a connected node serves this model for this data class and these accounts. `no_capacity`: seats exist, but every account they spend is out of headroom; `Retry-After` is the earliest reset. `metering_unavailable`: the ledger cannot record usage, so nothing is served until it can. Seat saturation alone never produces this; it queues. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-capabilities"></a>

## capabilities

Caller plane. What the presented key may do, and how much is left.

### GET `/v1/capabilities`

**What this key may do, and how much is left** · `getCapabilities`

Authentication: projectKey

Read at start so a client can pace itself. Returns the project and key,
the models the key may name, every limit that applies with its
remaining quota, and the project's budget.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Capabilities of the presented key. | `application/json` [Capabilities](#schema-capabilities) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | Nothing can serve the request now. `no_eligible_seat`: no enabled seat on a connected node serves this model for this data class and these accounts. `no_capacity`: seats exist, but every account they spend is out of headroom; `Retry-After` is the earliest reset. `metering_unavailable`: the ledger cannot record usage, so nothing is served until it can. Seat saturation alone never produces this; it queues. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-projects"></a>

## projects

Admin plane. Projects, their budgets and their limits.

### GET `/admin/v1/projects`

**List projects the principal may see** · `listProjects`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `include_archived` | query | boolean |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Projects. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/projects`

**Create a project** · `createProject`

Authentication: operatorToken

A project is the unit usage is tracked and budgeted by. The caller
becomes an owner. Budget and limits may be set here or later.

Request body

`application/json`

Schema: [ProjectCreate](#schema-projectcreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [ProjectIdValue](#schema-projectidvalue) | yes |  |  |
| `name` | string | yes |  | length ≤ 128 |
| `peek` | boolean |  | Each request it sends is recorded whole, its request as served and its final response, reasoning included, for the operator to read (`listPeeks`); kept seven days. Left out, a child follows its parent's, read when a request is admitted, and a project of its own does not peek. A request is recorded when its project peeks or its key does. |  |
| `annotate` | boolean |  | After each request it sends is answered, a decision model is asked the questions of the annotators in force for it (`listAnnotators`), off the request's path: the caller waits for none of it. The questions are asked of the decision model its `decide` alias names (its own, else its parent's), as requests of its system key (`Key.internal`): they spend its accounts, their usage is kept apart from its callers' (`UsageRecord.internal`) and held to that key's limits alone. `true` is refused (`409`) while `decide` names no decision model. Left out, a child follows its parent's, read when a request is admitted, and a project of its own does not annotate. A request is annotated when its project annotates or its key does. |  |
| `aliases` | array of [ModelAlias](#schema-modelalias) |  | The names it gives models: a caller asks for `coding` and is served the catalog model the alias names, moved out of band. Voice's categories (`general`, `coding`, `reasoning`, `decide`) are the names it suggests. A child's are its own over its parent's, name by name. | items ≤ 32 |
| `owners` | array of string |  | Principals who may administer the project. The creator is always added. |  |
| `data_classes` | array of [DataClass](#schema-dataclass) |  | Data classes the project may send. Defaults to `[internal]`. |  |
| `models` | array \| null |  | Catalog visibility. Null means the whole catalog. |  |
| `parent` | [ProjectIdValue](#schema-projectidvalue) |  | The project it is a child of: one of no parent of its own, not archived. With no `accounts` of its own, a child inherits its parent's, read when it is used; giving it `accounts` narrows it. |  |
| `accounts` | array \| null |  | Accounts the project may spend. Null means any. |  |
| `budget` | [BudgetSet](#schema-budgetset) |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The project, created and applied. | `application/json` [Project](#schema-project) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/projects/{project}`

**Describe a project, its budget and its limits** · `getProject`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The project. | `application/json` [Project](#schema-project) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/projects/{project}`

**Change a project's name, owners, data classes, catalog or accounts** · `updateProject`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Request body

`application/json`

Schema: [ProjectUpdate](#schema-projectupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `peek` | boolean \| null |  | `true` or `false` sets its own; `null` follows its parent's again (off for a project of its own). Each request it sends is recorded whole (`listPeeks`), kept seven days. |  |
| `annotate` | boolean \| null |  | `true` or `false` sets its own; `null` follows its parent's again (off for a project of its own). Each request it sends is annotated (`getAnnotation`), as requests of its system key. `true` is refused (`409`) while its `decide` alias, as this update leaves it, names no decision model. |  |
| `aliases` | array of [ModelAlias](#schema-modelalias) |  | Its own model aliases, whole; its parent's still apply where it gives none. | items ≤ 32 |
| `owners` | array of string |  |  |  |
| `data_classes` | array of [DataClass](#schema-dataclass) |  |  |  |
| `models` | array \| null |  |  |  |
| `accounts` | array \| null |  |  |  |
| `parent` | string \| null |  | Moves it under a project of no parent of its own, or, `null`, makes it a project of its own, keeping the accounts it spent. A project that is a parent cannot become a child. |  |
| `inherits` | boolean |  | A child's (a tenant, `tenant-<organism>`, is its habitat's project's): `true` to inherit its parent's accounts again, its own cleared. Setting `accounts` narrows it instead, and it no longer inherits. Only a project with a parent inherits. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The project, changed. | `application/json` [Project](#schema-project) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/projects/{project}`

**Archive a project** · `archiveProject`

Authentication: operatorToken

Archiving revokes the project's keys and refuses new requests. Its
usage history stays queryable; the id is never reused. The change
log records each key's revocation under the key, with the archive.
The retired `voice-system` project, voice's old project for its own
requests (now each project's system key's), is never archived again
(`409`). Archiving a project revokes its system key with its keys.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The archived project. | `application/json` [Project](#schema-project) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/projects/{project}/budget`

**Read the project's budget and what is spent** · `getBudget`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The budget in its current period. | `application/json` [Budget](#schema-budget) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PUT `/admin/v1/projects/{project}/budget`

**Set the project's budget** · `setBudget`

Authentication: operatorToken

Replaces the allowance and period. Spend already settled in the current
period still counts. Lowering the allowance below what is spent stops
new requests at once.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Request body

`application/json`

Schema: [BudgetSet](#schema-budgetset)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `allowance_micros` | integer | yes |  | ≥ 0 |
| `currency` | string |  |  | default `"USD"` |
| `period` | string, one of `day`, `week`, `month`, `none` | yes | How often the spend resets. `none` is a lifetime cap. |  |
| `period_anchor` | string (date-time) |  | When periods start counting from. Defaults to the start of the current UTC calendar period. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The budget, applied. | `application/json` [Budget](#schema-budget) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/projects/{project}/limits`

**Read the project's rate limits** · `getLimits`

Authentication: operatorToken

Project-scope and model-scope limits. Key-scope limits live on each key.
When voice runs under an organization's head, a project's limit is its
ratified practice `operating/limits/<project>`, and this answers that
limit with `source: practice` and the practice it came from, as last
read through the head; until a read has landed, `503
metering_unavailable`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The limits, with what remains in the current window. | `application/json` [LimitSet](#schema-limitset) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | Nothing can serve the request now. `no_eligible_seat`: no enabled seat on a connected node serves this model for this data class and these accounts. `no_capacity`: seats exist, but every account they spend is out of headroom; `Retry-After` is the earliest reset. `metering_unavailable`: the ledger cannot record usage, so nothing is served until it can. Seat saturation alone never produces this; it queues. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PUT `/admin/v1/projects/{project}/limits`

**Replace the project's rate limits** · `setLimits`

Authentication: operatorToken

Under an organization's head the limits are the organization's
practice, which its Board decides: this answers `409 conflict`, and a
limit is changed by proposing a superseding `operating/limits/<project>`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Request body

`application/json`

Schema: [LimitSet](#schema-limitset)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `limits` | array of [Limit](#schema-limit) | yes |  |  |
| `source` | string, one of `stored`, `practice` |  | Where the limits come from: the ones stored through this API, or, when voice runs under an organization's head, the organization's ratified practice. Ignored on writes. | read-only |
| `practice` | object |  | The ratified practice a `practice` limit was read from. | read-only |
| `practice.name` | string | yes | `operating/limits/<project>`. |  |
| `practice.id` | string | yes |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The limits, applied. | `application/json` [LimitSet](#schema-limitset) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-keys"></a>

## keys

Admin plane. Keys under a project.

### GET `/admin/v1/projects/{project}/keys`

**List keys under a project** · `listKeys`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Keys. Secrets are never returned after creation. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/projects/{project}/keys`

**Create a key under a project** · `createKey`

Authentication: operatorToken

One key per client is the intended use: usage is recorded per key, so a
project's spend can be broken down by which client made it. The secret
is returned once, in this response only.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |

Request body

`application/json`

Schema: [KeyCreate](#schema-keycreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string | yes | Name the client this key is for; usage is broken down by key. | length ≤ 128 |
| `peek` | boolean |  | Each request it sends is recorded whole, its request as served and its final response, reasoning included, for the operator to read (`listPeeks`); kept seven days. A request is recorded when its project or its key peeks. |  |
| `annotate` | boolean |  | Each request it sends is annotated (`getAnnotation`), by the annotators in force for it, as requests of its project's system key; refused (`409`) while its project's `decide` names no decision model. A request is annotated when its project or its key annotates. |  |
| `models` | array \| null |  | Restrict the key to these models. Null means the project's catalog. |  |
| `accounts` | array \| null |  | Restrict the key to these accounts, within the project's. Null means the project's. A key for client work names the work account here, so everything it sends is billed there. |  |
| `limits` | array of [Limit](#schema-limit) |  | Key-scope limits, on top of the project's. |  |
| `expires_at` | string (date-time) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The key, with its secret. | `application/json` [KeyWithSecret](#schema-keywithsecret) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/projects/{project}/keys/{key}`

**Describe a key** · `getKey`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |
| `key` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The key. | `application/json` [Key](#schema-key) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/projects/{project}/keys/{key}`

**Change a key's name, models, accounts, limits or expiry** · `updateKey`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |
| `key` | path | string | yes |  |

Request body

`application/json`

Schema: [KeyUpdate](#schema-keyupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `peek` | boolean |  | Each request it sends is recorded whole, its request as served and its final response, reasoning included, for the operator to read (`listPeeks`); kept seven days. A request is recorded when its project or its key peeks. |  |
| `annotate` | boolean |  | Each request it sends is annotated (`getAnnotation`), by the annotators in force for it, as requests of its project's system key; refused (`409`) while its project's `decide` names no decision model. A request is annotated when its project or its key annotates. |  |
| `models` | array \| null |  |  |  |
| `accounts` | array \| null |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |
| `expires_at` | string \| null (date-time) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The key, changed. | `application/json` [Key](#schema-key) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/projects/{project}/keys/{key}`

**Revoke a key** · `revokeKey`

Authentication: operatorToken

Revocation is immediate at the coordinator; in-flight requests finish.
A project's system key (`Key.internal`), which no token names, is
never revoked (`409`); archive the project instead.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | path | [ProjectIdValue](#schema-projectidvalue) | yes |  |
| `key` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The revoked key. | `application/json` [Key](#schema-key) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-usage"></a>

## usage

Admin plane. Per-request usage and summaries from the ledger.

### GET `/admin/v1/usage`

**List usage records** · `listUsage`

Authentication: operatorToken

One record per request, newest first, across the projects the principal may see.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | query | array of string |  | Only these projects. Repeatable. |
| `key` | query | array of string |  | Only these keys. Repeatable. |
| `model` | query | array of string |  | Only these requested models. Repeatable. |
| `account` | query | array of string |  | Only requests served on these accounts. Repeatable. |
| `conversation` | query | string |  | Only the turns of this conversation (`UsageRecord.conversation`). |
| `metadata` | query | string |  | Only requests whose `metadata` has every pair asked: one pair written `name=value`, or several as a JSON object of them, `{"name": "value", …}` (at most 16), all of which must match. The parameter is given once. |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |
| `limit` | query | integer |  |  |
| `cursor` | query | string |  |  |
| `include_internal` | query | boolean |  | Voice's own requests for its projects, under each project's system key (`UsageRecord.internal`: annotations, conversation titles), are left out unless this is `true`, or `key` names a system key. |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | A page of usage records. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/usage/summary`

**Summarise usage, grouped** · `summarizeUsage`

Authentication: operatorToken

Totals of requests, tokens and spend, grouped by any of project, key,
model, account, seat, node, conversation and time bucket. The
tracking view: what each project and each of its keys spent over a
period, and which account paid for it. Groups come most recently
active first: at most 1000, the least recent left out. Voice's own
requests for its projects (their system keys') are left out of the
totals unless `include_internal` is `true`. Grouped by `internal`
too (`"true"` or `"false"`), they are a line of their own: with
`group_by=account,internal&include_internal=true`, each account's
spend for its callers and what voice itself spent through it.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `group_by` | query | array of string, one of `project`, `key`, `model`, `account`, `seat`, `node`, `conversation`, `internal`, `day`, `hour` | yes |  |
| `project` | query | array of string |  | Only these projects. Repeatable. |
| `key` | query | array of string |  | Only these keys. Repeatable. |
| `model` | query | array of string |  | Only these requested models. Repeatable. |
| `account` | query | array of string |  | Only requests served on these accounts. Repeatable. |
| `conversation` | query | string |  | Only the turns of this conversation (`UsageRecord.conversation`). |
| `metadata` | query | string |  | Only requests whose `metadata` has every pair asked: one pair written `name=value`, or several as a JSON object of them, `{"name": "value", …}` (at most 16), all of which must match. The parameter is given once. |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |
| `include_internal` | query | boolean |  | Voice's own requests for its projects, under each project's system key (`UsageRecord.internal`: annotations, conversation titles), are left out unless this is `true`, or `key` names a system key. |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | One row per group. | `application/json` [UsageSummary](#schema-usagesummary) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/usage/{request_id}`

**Get one usage record** · `getUsage`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `request_id` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The usage record. | `application/json` [UsageRecord](#schema-usagerecord) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/peeks`

**List recorded requests** · `listPeeks`

Authentication: operatorToken

The requests recorded whole for a project or key that peeks, newest
first, without their bodies (`getPeek`). Kept seven days.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | query | string |  |  |
| `key` | query | string |  |  |
| `limit` | query | integer |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Recorded requests. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/peeks/{request_id}`

**Get a recorded request whole** · `getPeek`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `request_id` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The request as it was served and its final response. | `application/json` [Peek](#schema-peek) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/conversations`

**List conversations' titles** · `listConversationTitles`

Authentication: operatorToken

Conversations' titles, the newest written first: a project's (its
children's too), or one conversation's. A title is written by the
title annotator (`AnnotatorStage` `title`) on a conversation's first
annotated request, and again when a later one is answered as
another task.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | query | string |  | Only this project's requests. |
| `conversation` | query | string |  | Only the turns of this conversation (`UsageRecord.conversation`). |
| `limit` | query | integer |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The titles. | `application/json` object |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotations`

**Search requests by their annotations** · `listAnnotations`

Authentication: operatorToken

The requests whose project or key annotates, newest first, at most
`limit` (50 by default, 200 at most): each annotated, or not and
why. `answer` keeps only those with every answer it names, at
`min_probability` or more; the other filters narrow them as usage's
do. Each request's answers are read with `getAnnotation`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `project` | query | string |  | Only this project's requests. |
| `key` | query | string |  | Only this key's requests. |
| `conversation` | query | string |  | Only the turns of this conversation (`UsageRecord.conversation`). |
| `metadata` | query | string |  | Only requests whose `metadata` has every pair asked: one pair written `name=value`, or several as a JSON object of them, `{"name": "value", …}` (at most 16), all of which must match. The parameter is given once. |
| `answer` | query | string |  | Only requests with every answer named: one written `<annotator>.<question>=<answer>`, or several as a JSON object of them (at most 16). A yes or no is `true` or `false`, a score its level's value. |
| `min_probability` | query | number |  | The least probability an answer `answer` names (or a counted one) has, 0 to 1. |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |
| `limit` | query | integer |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The requests, newest first. | `application/json` object |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotations/facets`

**Count each answer to a question** · `annotationFacets`

Authentication: operatorToken

How many requests gave each answer to `question`
(`<annotator>.<question>`), at `min_probability` or more, over the
requests the filters keep; the most given first. Skipped questions
are not counted.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `question` | query | string | yes | The question counted, `<annotator>.<question>`. |
| `project` | query | string |  | Only this project's requests. |
| `key` | query | string |  | Only this key's requests. |
| `conversation` | query | string |  | Only the turns of this conversation (`UsageRecord.conversation`). |
| `metadata` | query | string |  | Only requests whose `metadata` has every pair asked: one pair written `name=value`, or several as a JSON object of them, `{"name": "value", …}` (at most 16), all of which must match. The parameter is given once. |
| `answer` | query | string |  | Only requests with every answer named: one written `<annotator>.<question>=<answer>`, or several as a JSON object of them (at most 16). A yes or no is `true` or `false`, a score its level's value. |
| `min_probability` | query | number |  | The least probability an answer `answer` names (or a counted one) has, 0 to 1. |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The counts. | `application/json` [AnnotationFacets](#schema-annotationfacets) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotations/trend`

**Count each answer to a question over time** · `annotationTrend`

Authentication: operatorToken

`annotationFacets` by `bucket`, hour or day, oldest first: each
bucket's count of each answer. At most 1000 points, the newest.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `question` | query | string | yes | The question counted, `<annotator>.<question>`. |
| `bucket` | query | string, one of `hour`, `day` |  |  |
| `project` | query | string |  | Only this project's requests. |
| `key` | query | string |  | Only this key's requests. |
| `conversation` | query | string |  | Only the turns of this conversation (`UsageRecord.conversation`). |
| `metadata` | query | string |  | Only requests whose `metadata` has every pair asked: one pair written `name=value`, or several as a JSON object of them, `{"name": "value", …}` (at most 16), all of which must match. The parameter is given once. |
| `answer` | query | string |  | Only requests with every answer named: one written `<annotator>.<question>=<answer>`, or several as a JSON object of them (at most 16). A yes or no is `true` or `false`, a score its level's value. |
| `min_probability` | query | number |  | The least probability an answer `answer` names (or a counted one) has, 0 to 1. |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The counts, by bucket. | `application/json` [AnnotationTrend](#schema-annotationtrend) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotations/{request_id}`

**Get a request's annotation** · `getAnnotation`

Authentication: operatorToken

Every answer it was given, each naming the annotator and version
that asked it, and every enabled rule scored on them.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `request_id` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The request's annotation. | `application/json` [Annotation](#schema-annotation) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/annotation-backfills`

**Annotate past requests from their recordings** · `backfillAnnotations`

Authentication: operatorToken

Asks `annotator` (at `version`, its current one by default) of past
requests whose recording still exists (`peek`, seven days), the
newest 200 at most that `project`, `key`, `from` and `to` keep.
Voice keeps no other text, so a request not recorded cannot be. It
answers at once with how many it will ask about, then asks, as
requests of each one's project's system key; each answer names the
version asked.
A response annotator reads the request answers already kept.

Request body

`application/json`

Schema: [AnnotationBackfill](#schema-annotationbackfill)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `annotator` | string | yes |  |  |
| `version` | integer |  | The version asked; its current one by default. | ≥ 1 |
| `project` | string |  |  |  |
| `key` | string |  |  |  |
| `from` | string (date-time) |  |  |  |
| `to` | string (date-time) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 202 | Queued. | `application/json` object |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-models"></a>

## models

Admin plane. The model catalog.

### GET `/admin/v1/models`

**List the model catalog** · `listCatalogModels`

Authentication: operatorToken

Every configured model, with the seats that serve it. `/v1/models` is the caller's filtered view of the same list.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The catalog. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/models`

**Add a model to the catalog** · `createCatalogModel`

Authentication: operatorToken

A model id is what callers name and what seats serve.
Adding it makes no seat serve it; a model with no seat is listed as
unavailable.

Request body

`application/json`

Schema: [CatalogModelCreate](#schema-catalogmodelcreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | What callers name and seats serve. Stable; never reused for a different model. |  |
| `owned_by` | string |  | The provider, or `local`. | default `"local"` |
| `kind` | string, one of `local`, `hosted` |  |  | default `"local"` |
| `context_length` | integer |  | The longest context, in tokens, the model is made for. A model made from a recipe takes the recipe's when this is left out. | ≥ 1 |
| `max_output_tokens` | integer |  | Default and maximum output; used for reservation when a request sets none. | ≥ 1 |
| `price` | [ModelPrice](#schema-modelprice) \| null |  | What a request costs. For a subscription account this is the list-price equivalent. Null means free. |  |
| `recipe` | string |  | The recipe a local model's weights come from (`Recipe`): one voice ships or the operator allowed. Refused for a hosted model and for a recipe there is not. Fixed at creation, like the id. |  |
| `contract` | string, one of `generative`, `decision` |  | What it answers. `generative` (the default): text. `decision`: a model that answers only a structured request: `response_format` (or `text.format`) a `json_schema` whose every property is a question, a string `enum` (or `oneOf` of `{const, description}`) a choice of 1 to 255, a `boolean` a yes or no, an integer `enum` (or `oneOf`) of 2 to 10 levels in order a score; each property's `description` its instructions. Its messages are text only, and it takes no `tools`, sampling or length settings, nor `stream`. The answer's text is JSON matching the schema, each question's most likely answer, and `voice.decision` holds every probability. Whatever serves it, a Jev-Style decision model on a node or one behind a service, is asked as `/v1/systemone` asks. Left out, its recipe's, else `generative`. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The model, created. | `application/json` [CatalogModel](#schema-catalogmodel) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/models/{model}`

**Describe a catalog model** · `getCatalogModel`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `model` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The model. | `application/json` [CatalogModel](#schema-catalogmodel) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/models/{model}`

**Change a model's context, output ceiling or price** · `updateCatalogModel`

Authentication: operatorToken

A price change applies to requests accepted after it; settled usage keeps the price it was served at.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `model` | path | string | yes |  |

Request body

`application/json`

Schema: [CatalogModelUpdate](#schema-catalogmodelupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `owned_by` | string |  |  |  |
| `kind` | string, one of `local`, `hosted` |  |  |  |
| `context_length` | integer |  |  | ≥ 1 |
| `max_output_tokens` | integer |  |  | ≥ 1 |
| `price` | [ModelPrice](#schema-modelprice) \| null |  |  |  |
| `contract` | string, one of `generative`, `decision` |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The model, changed. | `application/json` [CatalogModel](#schema-catalogmodel) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/models/{model}`

**Remove a model from the catalog** · `removeCatalogModel`

Authentication: operatorToken

Callers naming it get `model_not_found`. Seats that still serve it
keep the entry and show it as a problem until it is removed from
them. Usage history keeps the id. Refused while a placement places
it.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `model` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The removed model. | `application/json` [CatalogModel](#schema-catalogmodel) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-recipes"></a>

## recipes

Admin plane. Where local models' weights come from, as the operator allows them.

### GET `/admin/v1/recipes`

**List the recipes** · `listRecipes`

Authentication: operatorToken

The recipes voice ships (`origin` `shipped`) and the ones the operator added (`operator`). A local model may name only one of these.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The recipes. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/recipes`

**Allow a recipe** · `createRecipe`

Authentication: operatorToken

The operator allows a model's weights: from one revision of one
source, every file pinned by its digest, in a format that holds only
tensors. A recipe never changes; other weights are another recipe.
An id voice ships is taken.

Request body

`application/json`

Schema: [RecipeCreate](#schema-recipecreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Stable; never reused for other weights. A shipped recipe's is its file's name without `.json`. | pattern `^[a-z0-9][a-z0-9.-]{0,62}$` |
| `license` | object | yes |  |  |
| `license.name` | string | yes |  | length ≥ 1; length ≤ 64 |
| `license.url` | string (uri) | yes |  | length ≤ 512 |
| `context_length` | integer |  | The longest context, in tokens, the model is made for (its config's `max_position_embeddings`). A catalog model made from the recipe takes it as its `context_length` unless one is given, and a seat is never started with more. What a seat actually serves can be less; each seat reports its own (`SeatState.context`). | ≥ 1; ≤ 16777216 |
| `kv_bytes_per_token` | integer |  | What one more token of context costs in KV cache, in bytes at 16 bits: the layers that keep every token (full attention, or MLA's latent), not the linear, recurrent or sliding-window ones. A placement sizes its seat's prompt cache by it. | ≥ 1; ≤ 16777216 |
| `contract` | string, one of `generative`, `decision` |  | What a catalog model made from it answers (`CatalogModel.contract`), unless the model says otherwise. Left out, `generative`. |  |
| `variants` | array of [RecipeVariant](#schema-recipevariant) | yes |  | items ≥ 1; items ≤ 8 |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The recipe, allowed. | `application/json` [Recipe](#schema-recipe) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/recipes/{recipe}`

**Describe a recipe** · `getRecipe`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `recipe` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The recipe. | `application/json` [Recipe](#schema-recipe) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/recipes/{recipe}`

**Withdraw a recipe** · `removeRecipe`

Authentication: operatorToken

Refused for a recipe voice ships, and for one a model in the catalog
names. Its id is never reused.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `recipe` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The withdrawn recipe. | `application/json` [Recipe](#schema-recipe) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-runtimes"></a>

## runtimes

Admin plane. What serves a local model on a node, pinned, as the operator allows it.

### GET `/admin/v1/runtimes`

**List the runtimes** · `listRuntimes`

Authentication: operatorToken

The runtimes voice ships (`origin` `shipped`) and the ones the operator allowed (`operator`). A model is placed only where one of these runs it.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The runtimes. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/runtimes`

**Allow a runtime** · `createRuntime`

Authentication: operatorToken

The operator allows what may serve local models: one server program
voice knows how to start, from one artifact pinned by its digest,
for the platforms and the accelerator it runs on and the formats it
reads. A runtime never changes; another build is another runtime.
An id voice ships, or the operator has held, is taken.

Request body

`application/json`

Schema: [RuntimeCreate](#schema-runtimecreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Stable; never reused for another build. A shipped runtime's is its file's name without `.json`. | pattern `^[a-z0-9][a-z0-9.-]{0,62}$` |
| `license` | object | yes |  |  |
| `license.name` | string | yes |  | length ≥ 1; length ≤ 64 |
| `license.url` | string (uri) | yes |  | length ≤ 512 |
| `server` | string, one of `vllm`, `llama-server`, `decision` | yes | The server program, which the node knows how to start and stop. `decision`: voice's decision server, `voice-decide`, which answers a decision model's requests (`CatalogModel.contract: decision`, asked as `/v1/systemone`): its MLX build, an archive that reads `mlx` on `metal`, or its native build, which reads `gguf` on any accelerator (an archive on macOS, a container on Linux). A decision recipe is placed only with a `decision` runtime, and a generative one never. |  |
| `formats` | array of string, one of `safetensors`, `gguf`, `mlx` | yes | The weight formats it reads. | items ≥ 1; items ≤ 3 |
| `accelerator` | string, one of `cuda`, `rocm`, `vulkan`, `metal`, `cpu` | yes | What it runs on. `cuda`: an NVIDIA GPU. `rocm`: an AMD GPU through ROCm. `vulkan`: an AMD or Intel GPU (or any with a Vulkan driver). `metal`: Apple silicon. `cpu` runs on any machine. A machine's GPU is placed on through its native API first (CUDA, ROCm, Metal), then Vulkan, then the processors. |  |
| `platforms` | array of object | yes |  | items ≥ 1; items ≤ 4 |
| `platforms[].os` | string, one of `linux`, `darwin` | yes |  |  |
| `platforms[].arch` | string, one of `arm64`, `x86_64` | yes |  |  |
| `artifact` | any | yes | Where it comes from. `container`: an image, pulled by its digest, never a tag; for several platforms, a manifest list's digest. `archive`: a tarball, fetched from `url` and used only when its sha256 matches. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The runtime, allowed. | `application/json` [Runtime](#schema-runtime) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/runtimes/{runtime}`

**Describe a runtime** · `getRuntime`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `runtime` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The runtime. | `application/json` [Runtime](#schema-runtime) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/runtimes/{runtime}`

**Withdraw a runtime** · `removeRuntime`

Authentication: operatorToken

Refused for a runtime voice ships, and for one a placement uses.
Its id is never reused.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `runtime` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The withdrawn runtime. | `application/json` [Runtime](#schema-runtime) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-placements"></a>

## placements

Admin plane. Which nodes a local model is to run on, and in which form.

### GET `/admin/v1/placements`

**List the placements** · `listPlacements`

Authentication: operatorToken

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The placements. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/placements`

**Place a model on nodes** · `createPlacement`

Authentication: operatorToken

The operator puts a local model on nodes; the coordinator picks the
form of its weights (a variant of its recipe) and the runtime that
serves it: a runtime that reads the variant's format on the nodes'
platform and accelerator, and a variant that fits them as they
declared their hardware. It says why for each variant. A variant or
runtime the operator names is taken only if it fits. Refused when
none fits, with each variant's reason.

It creates the seat that serves it: `<leader>/<id>`, on the leader's
managed engine, spending `account`, serving `model`, its config the
chosen variant and runtime, pinned (protocol.yaml `ManagedConfig`).
Refused when the leader offers no managed engine. The node fetches
and verifies what the seat names; withdrawing the placement removes
the seat.

Request body

`application/json`

Schema: [PlacementCreate](#schema-placementcreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Chosen at creation, stable forever, never reused; the id of the seat it creates on its leader. | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `account` | string | yes | The account the seat spends, as any seat names one; a local account that bills nothing, for a model on the operator's own machines. |  |
| `model` | string | yes | A local catalog model that names a recipe. |  |
| `nodes` | array of [NodeIdValue](#schema-nodeidvalue) | yes | The nodes it runs on, the first of them its leader, which holds the seat that serves it. One node today; a model too large for one is placed across several when engines can split it. | items ≥ 1; items ≤ 1 |
| `variant` | string |  | The operator's choice of form, taken only if it fits; left out, the coordinator picks. |  |
| `runtime` | string |  | The operator's choice of runtime, taken only if it runs the variant on the nodes; left out, the coordinator picks. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The placement, decided. | `application/json` [Placement](#schema-placement) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/placements/{placement}`

**Describe a placement** · `getPlacement`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `placement` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The placement. | `application/json` [Placement](#schema-placement) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/placements/{placement}`

**Withdraw a placement** · `removePlacement`

Authentication: operatorToken

Its seat is removed with it. Its id is never reused. A different form or set of nodes is a new placement.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `placement` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The withdrawn placement. | `application/json` [Placement](#schema-placement) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-accounts"></a>

## accounts

Admin plane. Accounts that pay for serving, and their limits.

### GET `/admin/v1/accounts`

**List accounts** · `listAccounts`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `include_archived` | query | boolean |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Accounts, with their seats, limits and headroom. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/accounts`

**Create an account** · `createAccount`

Authentication: operatorToken

An account is what pays for serving and what has limits. Voice never
holds its credential: the engine on each seat logs in on its own
node. Seats name the account by id.

Request body

`application/json`

Schema: [AccountCreate](#schema-accountcreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [AccountIdValue](#schema-accountidvalue) | yes |  |  |
| `name` | string | yes |  | length ≤ 128 |
| `provider` | string \| null |  | Who the account is with; null for a local engine. |  |
| `billing` | string, one of `subscription`, `metered`, `none` |  | `subscription`: a flat plan whose limits are windows the provider reports. `metered`: pay per token. `none`: a local engine. | default `"none"` |
| `limits` | array of [Limit](#schema-limit) |  | Account-scope limits, on top of what the provider allows. `scope` is `account`. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The account, created. | `application/json` [Account](#schema-account) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/accounts/{account}`

**Describe an account** · `getAccount`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `account` | path | [AccountIdValue](#schema-accountidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The account. | `application/json` [Account](#schema-account) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/accounts/{account}`

**Change an account's name, billing or limits** · `updateAccount`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `account` | path | [AccountIdValue](#schema-accountidvalue) | yes |  |

Request body

`application/json`

Schema: [AccountUpdate](#schema-accountupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `provider` | string \| null |  |  |  |
| `billing` | string, one of `subscription`, `metered`, `none` |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The account, changed. | `application/json` [Account](#schema-account) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/accounts/{account}`

**Archive an account** · `archiveAccount`

Authentication: operatorToken

Its seats stop serving. Keys and projects that name it keep the name
and can no longer spend it. Usage history stays queryable; the id is
never reused.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `account` | path | [AccountIdValue](#schema-accountidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The archived account. | `application/json` [Account](#schema-account) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-nodes"></a>

## nodes

Admin plane. Nodes, their enrollment, what they offer, and their seats.

### GET `/admin/v1/nodes`

**List nodes, what they offer, and their seats** · `listNodes`

Authentication: operatorToken

Every node an operator created, whether or not it has connected, with
the capabilities and local controls it last declared and the state of
its seats.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Nodes. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/nodes`

**Create a node and issue its enrollment token** · `createNode`

Authentication: operatorToken

The node is `pending` until it connects with the token. A node that
presents no valid token is refused; nothing joins on its own. The
token is returned once, in this response only.

Request body

`application/json`

Schema: [NodeCreate](#schema-nodecreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [NodeIdValue](#schema-nodeidvalue) | yes |  |  |
| `name` | string |  |  | length ≤ 128 |
| `max_in_flight` | integer \| null |  | The coordinator's cap for the node. Null leaves the node's declared cap in charge. | ≥ 1 |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The node, with its enrollment token. | `application/json` [NodeWithToken](#schema-nodewithtoken) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/nodes/{node}`

**Describe a node and its seats** · `getNode`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The node. | `application/json` [Node](#schema-node) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/nodes/{node}`

**Rename a node or set its in-flight cap** · `updateNode`

Authentication: operatorToken

The cap cannot exceed the node's declared `max_in_flight`; the node's
effective cap is the smallest of the declared, this, and any local
cap. The change reaches the node as a new assignment.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Request body

`application/json`

Schema: [NodeUpdate](#schema-nodeupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `max_in_flight` | integer \| null |  |  | ≥ 1 |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The node, changed. | `application/json` [Node](#schema-node) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/nodes/{node}`

**Revoke a node** · `revokeNode`

Authentication: operatorToken

Its connection is closed and its token no longer admits it; its seats
stop serving. In-flight requests on it fail over like any seat
failure. The id is never reused.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The revoked node. | `application/json` [Node](#schema-node) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/nodes/{node}/seats`

**List a node's seats** · `listSeats`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The node's seats, each with its state. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/nodes/{node}/seats`

**Add a seat to a node** · `createSeat`

Authentication: operatorToken

The seat names one of the engines the node declared, and its `config`
must be valid against that engine's `config_schema`. A node that has
not connected yet has declared nothing; the seat is accepted and
reported with a problem until the node connects and takes it or
refuses it. The seat reaches the node as a new assignment.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Request body

`application/json`

Schema: [Seat](#schema-seat)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [Slug](#schema-slug) | yes | Unique on the node. Its full name is `<node>/<seat>`. |  |
| `engine` | string | yes | The id of one of the node's declared engines. |  |
| `account` | string | yes | The coordinator account this seat spends. Several seats, on one node or many, may name the same account and share its limits. |  |
| `serves` | array of [SeatModel](#schema-seatmodel) | yes |  | items ≥ 1 |
| `data_classes` | array of string |  | Data classes this seat may carry. Defaults to `[internal]`. |  |
| `concurrency` | integer |  | Requests this seat serves at once. | default `1`; ≥ 1 |
| `enabled` | boolean |  |  | default `true` |
| `config` | object |  | Engine-specific, valid against the engine's `config_schema`. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The seat, created. | `application/json` [SeatView](#schema-seatview) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/nodes/{node}/seats/{seat}`

**Describe a seat and its state** · `getSeat`

Authentication: operatorToken

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |
| `seat` | path | [Slug](#schema-slug) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The seat. | `application/json` [SeatView](#schema-seatview) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/nodes/{node}/seats/{seat}`

**Change a seat** · `updateSeat`

Authentication: operatorToken

Only the fields present change; `id` cannot. In-flight requests finish
on the configuration they started with. `enabled: false` drains the
seat: it takes no new requests.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |
| `seat` | path | [Slug](#schema-slug) | yes |  |

Request body

`application/json`

Schema: [SeatUpdate](#schema-seatupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `engine` | string |  |  |  |
| `account` | string |  |  |  |
| `serves` | array of [SeatModel](#schema-seatmodel) |  |  | items ≥ 1 |
| `data_classes` | array of string |  |  |  |
| `concurrency` | integer |  |  | ≥ 1 |
| `enabled` | boolean |  |  |  |
| `config` | object |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The seat, changed. | `application/json` [SeatView](#schema-seatview) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/nodes/{node}/seats/{seat}`

**Remove a seat from a node** · `removeSeat`

Authentication: operatorToken

It takes no new requests; in-flight requests finish. Usage history keeps its name.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |
| `seat` | path | [Slug](#schema-slug) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The removed seat. | `application/json` [SeatView](#schema-seatview) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/nodes/{node}/suggestions`

**What voice would place on a node, a model per category** · `suggestNodeModels`

Authentication: operatorToken

For each category voice ships (`general`, `coding`, `reasoning`,
`decide`), the model voice suggests placing on this node.
Suggestions come from voice's default catalog: for each platform,
memory tier and category, the recipe that suits a machine of that
tier (`catalog/picks.json`, from the catalog simulation).
The node's tier is the largest it has the memory of, within a tenth,
since a machine reports a little less than it is sold as. A category's
suggestion is the first pick, from that tier down, that is already
placed there, or that the operator has (shipped or allowed) and that
fits what the node has left for models after its other placements.
The variant and runtime are the ones `createPlacement` would choose.
A category with no suggestion says why.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The node's platform and tier, and a suggestion per category. | `application/json` [NodeSuggestions](#schema-nodesuggestions) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/nodes/{node}/token`

**Issue a node a new enrollment token** · `rotateNodeToken`

Authentication: operatorToken

For a lost or leaked token. The old token stops admitting the node at
once, and a connection made with it is closed with `4003`. The node
connects again once it is restarted with the new token, which is
returned once, in this response only.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `node` | path | [NodeIdValue](#schema-nodeidvalue) | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The node, with its new token. | `application/json` [NodeWithToken](#schema-nodewithtoken) |
| 202 | This deployment requires review for policy changes. Nothing changed yet; the change is proposed and waits for a decision. | `application/json` [PolicyChange](#schema-policychange) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The node is revoked; a revoked node gets no token. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-changes"></a>

## changes

Admin plane. The history of every configuration change.

### GET `/admin/v1/changes`

**List configuration changes** · `listChanges`

Authentication: operatorToken

Every applied admin write, newest first: who made it, when, and the
resource before and after. Secrets, digests and tokens are never
included. Usage is not configuration and is not listed here. A
`cursor` is a page's `next_cursor`; one that names no change, a
`from` or `to` that is not an RFC 3339 time, or a `limit` outside 1
to 1000 is a `400`.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `target` | query | string |  | Only changes to resources under this path, e.g. `projects/work` or `nodes`. |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |
| `limit` | query | integer |  |  |
| `cursor` | query | string |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | A page of changes. | `application/json` object |
| 400 | The transport refuses the request before the handler sees it: a body that is not the request's JSON, a field missing or of the wrong type (`reason` names it), a path or query value that is not the field's type. The control plane is served by `http::Rest` from the surface's routes; its refusals are `{"refusal": {"kind", "reason"}}`. | `application/json` [Refusal](#schema-refusal) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-events"></a>

## events

Admin plane. What changes as it happens, for the admin UI.

### GET `/admin/v1/events`

**Follow changes as they happen** · `streamAdminEvents`

Authentication: operatorToken

A server-sent event stream for the admin UI, so it need not poll.
Each event carries the whole resource as it now is, the same shape
its `GET` returns: a node that connected or changed state, a seat
whose state changed, an account whose quota windows moved, a usage
record as each request settles, a configuration change as it is
applied.

Each event has an `id`. A client that reconnects sends the last one
in `Last-Event-ID` and receives what it missed, while the coordinator
still holds it; otherwise it receives a `reset` event and should
reread what it shows. A comment line (`: ping`) keeps an idle stream
open every 15 seconds. The stream never ends on its own.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `type` | query | array of string, one of `node`, `seat`, `account`, `usage`, `change`, `request` |  | Only these event types. Repeatable. |
| `Last-Event-ID` | header | string |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The event stream: each event is `id:`, `event:` (its type) and `data:` (an `AdminEvent`). | `text/event-stream` [AdminEvent](#schema-adminevent) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-routes"></a>

## routes

Admin plane. The route table as this api instance holds it.

### GET `/admin/v1/routes`

**The route table, as the brain last wrote it** · `getRoutes`

Authentication: operatorToken

The latest table the brain wrote to Postgres: per model, the seats
that can serve it ranked best first with the capacity they had,
and the accounts that are exhausted. A snapshot at the moment of
the call, not a stream; it is what explains where the next request
would go. It is read from the store, so it answers at once.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The route table. | `application/json` [RouteTable](#schema-routetable) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 503 | No table yet: no brain has written one. `code` is `route_table_unavailable`. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/hub`

**Where the fleet's heartbeats stream live** · `getHub`

Authentication: operatorToken

The api's hub: a WebSocket on a port of the api's own (until it can
share this one, hale-lang/hale#1818), on the host this api is reached
at. A client connects to `ws://<host>:<port>/` with the operator
token (`Authorization: Bearer`, or `?access_token=` from a browser)
and sends `{"type": "subscribe", "topic": "<topic>"}` for each topic.
Each `{"type": "event", "topic", "seq", "payload"}` that follows is
one report as it arrives; a gap in `seq` is reports shed for a slow
subscriber, and the next report says the node whole again.

- `NodeObserved`: a node made a report (`register`, `heartbeat`,
  `seats`, `capabilities`, `local`) and it was recorded. `payload`
  is `{node, report, at, body}`; `body` is the node as
  `GET /admin/v1/nodes/{node}` answers it, as a JSON string.
- `InstanceBeat`: an api instance is alive. `payload` is
  `{instance, at}`, every five seconds per instance.

The store keeps only each one's latest (what the other reads
answer); the hub carries each as it happens.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The hub. | `application/json` [Hub](#schema-hub) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-node"></a>

## node

Node plane. A node registers, reads its assignment and reports its state.

### POST `/node/v1/register`

**A node registers on start** · `registerNode`

Authentication: enrollmentToken

The node presents its capabilities and local controls, and gets the
heartbeat interval, where NATS is, and its current assignment. One
live node per id: registering again replaces the earlier
registration, so a restarted node takes over from its own ghost. A
node whose token was rotated or revoked is refused.

Request body

`application/json`

Schema: [Registration](#schema-registration)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `protocol` | `2` | yes | This document's version. |  |
| `version` | string | yes | The node software's version. |  |
| `capabilities` | [schemas-Capabilities](#schema-schemas-capabilities) | yes |  |  |
| `local` | [LocalControls](#schema-localcontrols) | yes |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Registered. | `application/json` [Registered](#schema-registered) |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/node/v1/assignment`

**The node's current assignment** · `getAssignment`

Authentication: enrollmentToken

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The whole desired state, at its current version. | `application/json` [Assignment](#schema-assignment) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/node/v1/heartbeat`

**The node is alive, and how its seats are** · `nodeHeartbeat`

Authentication: enrollmentToken

Every `heartbeat_interval_ms`. Three missed intervals mark the node down.

Request body

`application/json`

Schema: [Heartbeat](#schema-heartbeat)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `in_flight` | integer | yes | Requests in flight across the node. | ≥ 0 |
| `seats` | array of [SeatState](#schema-seatstate) | yes |  | items ≤ 16 |
| `assignment_version` | integer |  | The assignment version the node has applied. Core NATS delivers an `assign` at most once; a coordinator that sees this behind the node's current version publishes the assignment again. | ≥ 0 |

Responses:

| Status | Description | Body |
|---|---|---|
| 204 | Received. |  |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/node/v1/seats`

**Every assigned seat's state, for an assignment version** · `reportSeatStates`

Authentication: enrollmentToken

Sent after applying an assignment and whenever a seat's state changes.

Request body

`application/json`

Schema: [SeatStates](#schema-seatstates)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `assignment_version` | integer | yes | The assignment these states answer. |  |
| `seats` | array of [SeatState](#schema-seatstate) | yes |  | items ≤ 16 |

Responses:

| Status | Description | Body |
|---|---|---|
| 204 | Received. |  |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PUT `/node/v1/capabilities`

**What the node offers changed** · `reportCapabilities`

Authentication: enrollmentToken

The coordinator re-checks the node's assignment against the new capabilities.

Request body

`application/json`

Schema: [schemas-Capabilities](#schema-schemas-capabilities)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `engines` | array of [Engine](#schema-engine) | yes |  | items ≤ 16 |
| `max_in_flight` | integer | yes | The most requests the node will serve at once, across all its seats. | ≥ 1 |
| `hardware` | [Hardware](#schema-hardware) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 204 | Received. |  |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PUT `/node/v1/local`

**The node's local controls changed** · `reportLocalControls`

Authentication: enrollmentToken

Request body

`application/json`

Schema: [LocalControls](#schema-localcontrols)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `paused` | boolean | yes |  |  |
| `paused_seats` | array of string | yes |  | items ≤ 32 |
| `max_in_flight` | integer \| null |  | A local cap on requests in flight, or null for none. | ≥ 0 |
| `reason` | string \| null |  | Why, for the admin to read. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 204 | Received. |  |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/node/v1/quota`

**Provider windows an engine reported for a seat's account** · `reportQuota`

Authentication: enrollmentToken

Request body

`application/json`

Schema: [QuotaReport](#schema-quotareport)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `seat` | string | yes |  |  |
| `windows` | array of [QuotaWindow](#schema-quotawindow) | yes |  | items ≤ 16 |

Responses:

| Status | Description | Body |
|---|---|---|
| 204 | Received. |  |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/node/v1/draining`

**The node is about to stop** · `nodeDraining`

Authentication: enrollmentToken

The coordinator sends it no new requests; the node exits once its in-flight requests have their results.

Request body (optional)

`application/json`

Schema: [Draining](#schema-draining)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `reason` | string |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 204 | Received. |  |
| 400 | The request is malformed or names an unsupported option. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The node is revoked: its token is known but no longer admits it. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-health"></a>

## health

Liveness and readiness, for supervisors and load balancers. No credential.

### GET `/healthz`

**Is this api process alive** · `getLiveness`

Authentication: none

Answers `200` while the process can serve HTTP at all. Checks nothing else.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Alive. | `application/json` [Health](#schema-health) |

### GET `/readyz`

**Should this api process get traffic** · `getReadiness`

Authentication: none

Ready when Postgres answers and the configuration is loaded. A load
balancer sends traffic only to ready instances. Having no seats up is
not unreadiness: requests are still admitted and answered.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Ready. | `application/json` [Health](#schema-health) |
| 503 | Not ready; `NotReady.checks` says which failed. | `application/json` [AdminUnavailable](#schema-adminunavailable) |

<a id="tag-annotations"></a>

## annotations

### GET `/admin/v1/annotators`

**List annotators** · `listAnnotators`

Authentication: operatorToken

The annotators, built in and the operator's, each at its current
version: the questions asked of each request whose project or key
annotates (`annotate`), at its stage.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The annotators. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/annotators`

**Create an annotator** · `createAnnotator`

Authentication: operatorToken

Request body

`application/json`

Schema: [AnnotatorCreate](#schema-annotatorcreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `name` | string | yes |  | length ≥ 1; length ≤ 128 |
| `stage` | [AnnotatorStage](#schema-annotatorstage) | yes |  |  |
| `questions` | array of [AnnotatorQuestion](#schema-annotatorquestion) | yes | Its questions, at least one; a `title` annotator asks none (`[]`). The enabled annotators of one stage ask at most 64 together, in one request to the decision model; at most 64 KiB as JSON. | items ≤ 64 |
| `title` | [AnnotatorTitle](#schema-annotatortitle) |  | A `title` annotator's model and instruction, which it needs; no other has one. |  |
| `scope` | [AnnotatorScope](#schema-annotatorscope) |  |  |  |
| `reads_request` | boolean |  | A response annotator that also reads the request's answers, as a short labelled block beside the text: its answers are `conditioned`, searchable apart from those given on the text alone. | default `false` |
| `enabled` | boolean |  |  | default `true` |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The annotator. | `application/json` [Annotator](#schema-annotator) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotators/{annotator}`

**Get an annotator** · `getAnnotator`

Authentication: operatorToken

An annotator at its current version, or at `version`, as it was then:
the version each answer names.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `annotator` | path | string | yes |  |
| `version` | query | integer |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The annotator. | `application/json` [Annotator](#schema-annotator) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/annotators/{annotator}`

**Update an annotator** · `updateAnnotator`

Authentication: operatorToken

A new version of it: what the body sets, the rest as it was. It is
asked from the next request on; answers already given keep naming
the version that asked them. Its stage never changes.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `annotator` | path | string | yes |  |

Request body

`application/json`

Schema: [AnnotatorUpdate](#schema-annotatorupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≥ 1; length ≤ 128 |
| `questions` | array of [AnnotatorQuestion](#schema-annotatorquestion) |  |  | items ≤ 64 |
| `scope` | [AnnotatorScope](#schema-annotatorscope) |  |  |  |
| `reads_request` | boolean |  |  |  |
| `enabled` | boolean |  |  |  |
| `title` | [AnnotatorTitle](#schema-annotatortitle) |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The annotator as it now is. | `application/json` [Annotator](#schema-annotator) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/annotators/{annotator}`

**Remove an annotator** · `removeAnnotator`

Authentication: operatorToken

Removed: it asks no more, and its answers stay, naming it. A
built-in annotator is never removed (`409`): disable it
(`enabled: false`).

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `annotator` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The removed annotator. | `application/json` [Annotator](#schema-annotator) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotators/{annotator}/stats`

**What an annotator's runs did** · `annotatorStats`

Authentication: operatorToken

Over the newest 200 annotations in the range: the runs that asked
this annotator, how many were made, skipped or not made and why,
the tokens of those runs, and the newest reason one was not made.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `annotator` | path | string | yes |  |
| `from` | query | string (date-time) |  |  |
| `to` | query | string (date-time) |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Its runs, counted. | `application/json` [AnnotatorStats](#schema-annotatorstats) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotation-rules`

**List annotation rules** · `listAnnotationRules`

Authentication: operatorToken

The rules that pair a request answer with the response answer it
expects, built in and the operator's: each scored met or missed on
every annotation read.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The annotation rules. | `application/json` object |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### POST `/admin/v1/annotation-rules`

**Create an annotation rule** · `createAnnotationRule`

Authentication: operatorToken

Request body

`application/json`

Schema: [AnnotationRuleCreate](#schema-annotationrulecreate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `name` | string | yes |  | length ≥ 1; length ≤ 128 |
| `condition` | [AnnotationCondition](#schema-annotationcondition) \| null |  | When the rule applies, a request answer; left out, always. |  |
| `expect` | [AnnotationExpect](#schema-annotationexpect) | yes |  |  |
| `enabled` | boolean |  |  | default `true` |

Responses:

| Status | Description | Body |
|---|---|---|
| 201 | The annotation rule. | `application/json` [AnnotationRule](#schema-annotationrule) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/admin/v1/annotation-rules/{rule}`

**Get an annotation rule** · `getAnnotationRule`

Authentication: operatorToken

A rule.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `rule` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The annotation rule. | `application/json` [AnnotationRule](#schema-annotationrule) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### PATCH `/admin/v1/annotation-rules/{rule}`

**Update an annotation rule** · `updateAnnotationRule`

Authentication: operatorToken

A rule changed: what the body sets, the rest as it was. Rules are
scored when an annotation is read, so a change applies to every
annotation from then on, old ones too.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `rule` | path | string | yes |  |

Request body

`application/json`

Schema: [AnnotationRuleUpdate](#schema-annotationruleupdate)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≥ 1; length ≤ 128 |
| `condition` | [AnnotationCondition](#schema-annotationcondition) \| null |  | A request answer, or `null` for always. |  |
| `expect` | [AnnotationExpect](#schema-annotationexpect) |  |  |  |
| `enabled` | boolean |  |  |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The annotation rule as it now is. | `application/json` [AnnotationRule](#schema-annotationrule) |
| 400 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 422 | The request is well formed and the handler judged it invalid. The body is the variant `Invalid` with its problem; `Hale-Error-Class: invalid` names the class. | `application/json` [AdminInvalid](#schema-admininvalid) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

### DELETE `/admin/v1/annotation-rules/{rule}`

**Remove an annotation rule** · `removeAnnotationRule`

Authentication: operatorToken

Removed. A built-in rule is never removed (`409`): disable it.

Parameters:

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `rule` | path | string | yes |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The removed annotation rule. | `application/json` [AnnotationRule](#schema-annotationrule) |
| 401 | Missing, unknown or revoked credential. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | The credential may not do this: the model is not visible to the key, the data class is not one the project may send, or the principal does not own the project. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 404 | No such resource. `Hale-Error-Class: not_found`. | `application/json` [AdminNotFound](#schema-adminnotfound) |
| 409 | The request conflicts with the state it meets (a resource with that id exists, a restriction a key outruns). `Hale-Error-Class: conflict`. | `application/json` [AdminConflict](#schema-adminconflict) |
| 500 | `internal_error`: the server could not complete the request, as when its store refuses a read or a write. Nothing the request asked for was applied unless the response says so; retrying is safe. | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="schemas"></a>

## Schemas

<a id="schema-projectidvalue"></a>

### ProjectIdValue

Chosen at creation, stable forever, never reused. Up to 127, room for
a habitat's caller, `<habitat>-<caller>`.

Type: string

Notes: pattern `^[a-z0-9][a-z0-9-]{0,126}$`

<a id="schema-accountidvalue"></a>

### AccountIdValue

Chosen at creation, stable forever, never reused.

Type: string

Notes: pattern `^[a-z0-9][a-z0-9-]{0,62}$`

<a id="schema-nodeidvalue"></a>

### NodeIdValue

Chosen at creation, stable forever, never reused.

Type: string

Notes: pattern `^[a-z0-9][a-z0-9-]{0,62}$`

<a id="schema-metadata"></a>

### Metadata

The standard's `metadata`: up to 16 caller pairs, keys up to 64
characters, values up to 512. Voice never interprets it; it echoes it
and stores it on the usage record. DNA sends the attempt id here.

Type: object

<a id="schema-dataclass"></a>

### DataClass

The sensitivity of the request's content. A request is routed only to
seats whose data classes include it. Values are deployment policy;
`internal` is the default.

Type: string

<a id="schema-voicerequestextension"></a>

### VoiceRequestExtension

Voice's fields on a request. All optional.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `data_class` | [DataClass](#schema-dataclass) |  |  |  |
| `deadline` | string (date-time) |  | Absolute time after which the caller no longer wants the answer. |  |
| `account` | [AccountIdValue](#schema-accountidvalue) |  | Serve on this account only, for when who pays matters (client billing). The key must permit it. No fallback to another account: when it has no headroom the request fails with `no_capacity`. |  |

<a id="schema-served"></a>

### Served

What actually served the request. Evidence, not a choice.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string | yes | The model that ran, as the engine or provider reported it. |  |
| `quantization` | string \| null |  | Null when the provider does not say. |  |
| `node` | string | yes | The node the seat runs on. |  |
| `seat` | string | yes | The seat that served, written `<node>/<seat>`. |  |
| `account` | string | yes | The account the seat spent. |  |
| `engine` | string |  |  |  |
| `provider` | string \| null |  | The hosted provider, or null for a local engine. |  |

<a id="schema-timing"></a>

### Timing

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `wall_ms` | integer | yes | From the coordinator accepting the request to the last byte. |  |
| `queue_ms` | integer | yes | Time waiting for a seat slot. |  |
| `load_ms` | integer | yes | Time spent fetching or loading weights before serving; 0 when warm. |  |
| `first_output_ms` | integer |  | From the seat receiving the request to its first output, as its node measured it: what the seat spent before it began to generate (reading the prompt, a cold start). Present when the seat produced output. | ≥ 0 |
| `engine_ms` | integer |  | From the seat receiving the request to its result, as its node measured it. Generation is `engine_ms - first_output_ms`, and the seat's throughput `output_tokens` over that. Present with `first_output_ms`. | ≥ 0 |

<a id="schema-attempt"></a>

### Attempt

One try on one seat. A retry elsewhere is evidence, never hidden.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `seat` | string | yes | Written `<node>/<seat>`. |  |
| `account` | string | yes |  |  |
| `outcome` | string, one of `served`, `failed`, `abandoned` | yes |  |  |
| `error` | string |  | Why the seat failed, when it did. |  |
| `output_tokens_before_failure` | integer |  | Tokens already sent to the client when this seat failed. Non-zero means the response failed rather than moving seats. |  |
| `wall_ms` | integer |  |  |  |

<a id="schema-voiceresponseextension"></a>

### VoiceResponseExtension

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `request_id` | string | yes | Equals the `X-Request-Id` header and the usage record's id. |  |
| `project` | string | yes | The project the request was attributed to. |  |
| `key` | string | yes | The key the request was made with. |  |
| `served` | [Served](#schema-served) | yes |  |  |
| `price_micros` | integer | yes | What this request cost, in micros of `currency`. 0 for a model with no price. |  |
| `currency` | string | yes |  | default `"USD"` |
| `timing` | [Timing](#schema-timing) | yes |  |  |
| `attempts` | array of [Attempt](#schema-attempt) | yes |  |  |
| `decision` | object |  | A decision model's answer to each question (`CatalogModel.contract`), by the schema's property: `choice` (its option, `confidence`, `probabilities` of every option), `noul` (the probability of yes), or `score` (the expected level, `confidence`, `probabilities` by level index, and `legend`, each index's value). Absent for a generative model. |  |

<a id="schema-createresponserequest"></a>

### CreateResponseRequest

The standard `CreateResponseBody` plus an optional `voice` object.

Type: [CreateResponseBody](#schema-createresponsebody) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [CreateResponseBody](#schema-createresponsebody) |  |  |  |
| `voice` | [VoiceRequestExtension](#schema-voicerequestextension) |  |  |  |

<a id="schema-response"></a>

### Response

The standard `ResponseResource` plus the required `voice` object.

Type: [ResponseResource](#schema-responseresource) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [ResponseResource](#schema-responseresource) |  |  |  |
| `voice` | [VoiceResponseExtension](#schema-voiceresponseextension) | yes |  |  |

<a id="schema-voiceattemptevent"></a>

### VoiceAttemptEvent

Voice's one extended streaming event: a seat failed and the request
moved to another. Emitted before the next seat's first event.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | `"voice:attempt"` | yes |  |  |
| `sequence_number` | integer | yes |  |  |
| `attempt` | [Attempt](#schema-attempt) | yes |  |  |
| `next_seat` | string |  |  |  |

<a id="schema-chatmessage"></a>

### ChatMessage

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `role` | string, one of `system`, `developer`, `user`, `assistant`, `tool` | yes |  |  |
| `content` | string \| null \| array of object |  | Text, or an array of content parts. |  |
| `name` | string |  |  |  |
| `reasoning_content` | string |  | An answer's: the model's thinking before it, when it thought (llama-server's and vLLM's `reasoning_content`; on `/v1/responses` a `reasoning` output item). A stream carries it as `delta.reasoning_content`. An answer whose output cap ran out while it thought has its thinking and finish reason `length`. |  |
| `tool_calls` | array of object |  |  |  |
| `tool_call_id` | string |  |  |  |

<a id="schema-chatcompletionrequest"></a>

### ChatCompletionRequest

The OpenAI Chat Completions request. Fields voice does not recognise
are passed through to engines that accept them. `n` greater than 1 is
not supported in the MVP.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string | yes |  |  |
| `messages` | array of [ChatMessage](#schema-chatmessage) | yes |  | items ≥ 1 |
| `max_tokens` | integer |  |  | ≥ 1 |
| `max_completion_tokens` | integer |  | Newer spelling of `max_tokens`; if both are set this wins. | ≥ 1 |
| `temperature` | number |  |  | ≥ 0; ≤ 2 |
| `top_p` | number |  |  | ≥ 0; ≤ 1 |
| `stop` | string \| array of string |  |  |  |
| `seed` | integer |  |  |  |
| `n` | `1` |  |  |  |
| `prompt_cache_key` | string |  | One value per conversation, the same on each of its turns (as on `/v1/responses`). Voice sends a conversation to the same seat each turn when several serve its model, so the seat's prompt cache holds what it said and a turn reads only what it added. A routing key, never a secret or user data; leave it out for one-shot calls. |  |
| `stream` | boolean |  |  | default `false` |
| `stream_options` | object |  |  |  |
| `stream_options.include_usage` | boolean |  |  |  |
| `tools` | array of object |  | Function tools, passed to the seat as they are. Only a seat that carries tools serves a request that lists them (an `openai-compatible` seat; a `static` seat only as its drill); the others refuse it and the request moves to the next seat. The answer's calls come back as `tool_calls` (deltas when streamed) with `finish_reason: "tool_calls"`. |  |
| `tool_choice` | any |  |  |  |
| `response_format` | object |  |  |  |
| `metadata` | [Metadata](#schema-metadata) |  |  |  |
| `voice` | [VoiceRequestExtension](#schema-voicerequestextension) |  |  |  |

<a id="schema-chatusage"></a>

### ChatUsage

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `prompt_tokens` | integer | yes |  |  |
| `completion_tokens` | integer | yes |  |  |
| `total_tokens` | integer | yes |  |  |

<a id="schema-chatcompletion"></a>

### ChatCompletion

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `object` | `"chat.completion"` | yes |  |  |
| `created` | integer | yes | Unix seconds. |  |
| `model` | string | yes | The model id the caller named. |  |
| `choices` | array of object | yes |  |  |
| `choices[].index` | integer | yes |  |  |
| `choices[].message` | [ChatMessage](#schema-chatmessage) | yes |  |  |
| `choices[].finish_reason` | string \| null | yes |  |  |
| `usage` | [ChatUsage](#schema-chatusage) | yes |  |  |
| `metadata` | [Metadata](#schema-metadata) |  |  |  |
| `voice` | [VoiceResponseExtension](#schema-voiceresponseextension) | yes |  |  |

<a id="schema-chatcompletionchunk"></a>

### ChatCompletionChunk

One server-sent event; the stream ends with `data: [DONE]`.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `object` | `"chat.completion.chunk"` | yes |  |  |
| `created` | integer | yes |  |  |
| `model` | string | yes |  |  |
| `choices` | array of object | yes |  |  |
| `choices[].index` | integer | yes |  |  |
| `choices[].delta` | object | yes |  |  |
| `choices[].finish_reason` | string \| null |  | The standard's reasons, and `error` on the final chunk of a stream whose seat failed once it had begun. |  |
| `usage` | [ChatUsage](#schema-chatusage) \| null |  | Final chunk only; `null` when the stream failed. |  |
| `error` | object |  | Final chunk only, when the stream failed once it had begun. |  |
| `error.message` | string | yes |  |  |
| `error.type` | string | yes |  |  |
| `error.code` | string | yes |  |  |
| `voice` | [VoiceResponseExtension](#schema-voiceresponseextension) |  | Final chunk only. |  |

<a id="schema-modelprice"></a>

### ModelPrice

Price per million tokens, in micros of `currency`.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `input_per_mtok_micros` | integer | yes |  |  |
| `output_per_mtok_micros` | integer | yes |  |  |
| `currency` | string | yes |  | default `"USD"` |

<a id="schema-model"></a>

### Model

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `object` | `"model"` | yes |  |  |
| `created` | integer | yes |  |  |
| `owned_by` | string | yes | The provider for a hosted model, or `local`. |  |
| `voice` | object | yes |  |  |
| `voice.kind` | string, one of `local`, `hosted` | yes |  |  |
| `voice.context_length` | integer |  | The context, in tokens, a request can count on: the least any seat that could serve it took, never more than the model is made for; the catalog's when no seat has said. |  |
| `voice.max_output_tokens` | integer |  | Default and maximum output; used for reservation when a request sets none. |  |
| `voice.quantizations` | array of string |  | Quantizations available across seats, for a local model. |  |
| `voice.data_classes` | array of [DataClass](#schema-dataclass) | yes | Data classes some eligible seat may carry for this model. |  |
| `voice.price` | [ModelPrice](#schema-modelprice) \| null |  |  |  |
| `voice.available` | boolean | yes | True when at least one enabled seat on a connected node serves it, spending an account this key may spend, and its account has headroom. |  |
| `voice.contract` | string, one of `generative`, `decision` |  | What it answers (`CatalogModel.contract`); a decision model answers only a structured request. |  |
| `voice.capabilities` | object |  | What a seat that could serve this key carries through to the model. |  |
| `voice.capabilities.tools` | boolean | yes | A request's `tools` reach the model and come back as tool calls: an openai-compatible seat, a managed seat under llama-server, or the static engine's tool-call drill. False under vLLM until voice starts it with a tool-call parser, and for the claude CLI. |  |

<a id="schema-modellist"></a>

### ModelList

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `object` | `"list"` | yes |  |  |
| `data` | array of [Model](#schema-model) | yes |  |  |

<a id="schema-capabilities"></a>

### Capabilities

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `project` | object | yes |  |  |
| `project.id` | string | yes |  |  |
| `project.name` | string | yes |  |  |
| `key` | object | yes |  |  |
| `key.id` | string | yes |  |  |
| `key.name` | string |  |  |  |
| `data_classes` | array of [DataClass](#schema-dataclass) |  | Data classes this project may send. |  |
| `models` | array of string | yes | Model ids this key may name. |  |
| `accounts` | array \| null |  | Accounts this key may spend, and so may name in `voice.account`. Null means any. |  |
| `limits` | array of [Limit](#schema-limit) | yes | Every limit that applies to this key, at any scope. |  |
| `budget` | [Budget](#schema-budget) \| null | yes | The project's budget, or null when it has none. |  |

<a id="schema-limit"></a>

### Limit

One rate limit. Null counters are unlimited. `remaining` and
`resets_at` are read-only and ignored on writes.
A project's limits (and its model-scope ones) count its callers'
requests, never voice's own for it under its system key
(`Key.internal`): only limits set on that key cap those.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `scope` | string, one of `project`, `key`, `model`, `account` | yes |  |  |
| `model` | string |  | Required when `scope` is `model`. |  |
| `account` | string |  | Required when `scope` is `account`. Set on the account itself; operator policy on top of what the provider allows. |  |
| `window_seconds` | integer | yes |  | ≥ 1 |
| `requests` | integer \| null |  |  | ≥ 0 |
| `input_tokens` | integer \| null |  |  | ≥ 0 |
| `output_tokens` | integer \| null |  |  | ≥ 0 |
| `concurrent` | integer \| null |  |  | ≥ 0 |
| `remaining` | object |  |  | read-only |
| `remaining.requests` | integer \| null |  |  |  |
| `remaining.input_tokens` | integer \| null |  |  |  |
| `remaining.output_tokens` | integer \| null |  |  |  |
| `remaining.concurrent` | integer \| null |  |  |  |
| `resets_at` | string (date-time) |  |  | read-only |

<a id="schema-limitset"></a>

### LimitSet

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `limits` | array of [Limit](#schema-limit) | yes |  |  |
| `source` | string, one of `stored`, `practice` |  | Where the limits come from: the ones stored through this API, or, when voice runs under an organization's head, the organization's ratified practice. Ignored on writes. | read-only |
| `practice` | object |  | The ratified practice a `practice` limit was read from. | read-only |
| `practice.name` | string | yes | `operating/limits/<project>`. |  |
| `practice.id` | string | yes |  |  |

<a id="schema-budgetset"></a>

### BudgetSet

A hard cap on the project's spend per period.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `allowance_micros` | integer | yes |  | ≥ 0 |
| `currency` | string |  |  | default `"USD"` |
| `period` | string, one of `day`, `week`, `month`, `none` | yes | How often the spend resets. `none` is a lifetime cap. |  |
| `period_anchor` | string (date-time) |  | When periods start counting from. Defaults to the start of the current UTC calendar period. |  |

<a id="schema-budget"></a>

### Budget

The project's budget in its current period. A circuit breaker: it stops
spend even if a client misbehaves or a key leaks.

Type: [BudgetSet](#schema-budgetset) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [BudgetSet](#schema-budgetset) |  |  |  |
| `spent_micros` | integer | yes | Settled spend this period. |  |
| `reserved_micros` | integer | yes | Held by in-flight requests, not yet settled. |  |
| `remaining_micros` | integer | yes |  |  |
| `window_start` | string (date-time) |  |  |  |
| `window_end` | string \| null (date-time) |  |  |  |

<a id="schema-projectcreate"></a>

### ProjectCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [ProjectIdValue](#schema-projectidvalue) | yes |  |  |
| `name` | string | yes |  | length ≤ 128 |
| `peek` | boolean |  | Each request it sends is recorded whole, its request as served and its final response, reasoning included, for the operator to read (`listPeeks`); kept seven days. Left out, a child follows its parent's, read when a request is admitted, and a project of its own does not peek. A request is recorded when its project peeks or its key does. |  |
| `annotate` | boolean |  | After each request it sends is answered, a decision model is asked the questions of the annotators in force for it (`listAnnotators`), off the request's path: the caller waits for none of it. The questions are asked of the decision model its `decide` alias names (its own, else its parent's), as requests of its system key (`Key.internal`): they spend its accounts, their usage is kept apart from its callers' (`UsageRecord.internal`) and held to that key's limits alone. `true` is refused (`409`) while `decide` names no decision model. Left out, a child follows its parent's, read when a request is admitted, and a project of its own does not annotate. A request is annotated when its project annotates or its key does. |  |
| `aliases` | array of [ModelAlias](#schema-modelalias) |  | The names it gives models: a caller asks for `coding` and is served the catalog model the alias names, moved out of band. Voice's categories (`general`, `coding`, `reasoning`, `decide`) are the names it suggests. A child's are its own over its parent's, name by name. | items ≤ 32 |
| `owners` | array of string |  | Principals who may administer the project. The creator is always added. |  |
| `data_classes` | array of [DataClass](#schema-dataclass) |  | Data classes the project may send. Defaults to `[internal]`. |  |
| `models` | array \| null |  | Catalog visibility. Null means the whole catalog. |  |
| `parent` | [ProjectIdValue](#schema-projectidvalue) |  | The project it is a child of: one of no parent of its own, not archived. With no `accounts` of its own, a child inherits its parent's, read when it is used; giving it `accounts` narrows it. |  |
| `accounts` | array \| null |  | Accounts the project may spend. Null means any. |  |
| `budget` | [BudgetSet](#schema-budgetset) |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |

<a id="schema-modelalias"></a>

### ModelAlias

A name a project gives a model. A request for `name` is served as
`model`, read when it is admitted, and its usage keeps `name` as the
model asked for. The name is not a catalog model's own; `model` is.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string | yes |  | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `model` | string | yes | A catalog model's id. |  |

<a id="schema-projectupdate"></a>

### ProjectUpdate

Only the fields present change. Budget and limits have their own endpoints.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `peek` | boolean \| null |  | `true` or `false` sets its own; `null` follows its parent's again (off for a project of its own). Each request it sends is recorded whole (`listPeeks`), kept seven days. |  |
| `annotate` | boolean \| null |  | `true` or `false` sets its own; `null` follows its parent's again (off for a project of its own). Each request it sends is annotated (`getAnnotation`), as requests of its system key. `true` is refused (`409`) while its `decide` alias, as this update leaves it, names no decision model. |  |
| `aliases` | array of [ModelAlias](#schema-modelalias) |  | Its own model aliases, whole; its parent's still apply where it gives none. | items ≤ 32 |
| `owners` | array of string |  |  |  |
| `data_classes` | array of [DataClass](#schema-dataclass) |  |  |  |
| `models` | array \| null |  |  |  |
| `accounts` | array \| null |  |  |  |
| `parent` | string \| null |  | Moves it under a project of no parent of its own, or, `null`, makes it a project of its own, keeping the accounts it spent. A project that is a parent cannot become a child. |  |
| `inherits` | boolean |  | A child's (a tenant, `tenant-<organism>`, is its habitat's project's): `true` to inherit its parent's accounts again, its own cleared. Setting `accounts` narrows it instead, and it no longer inherits. Only a project with a parent inherits. |  |

<a id="schema-project"></a>

### Project

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `peek` | boolean \| null |  | Its own setting; `null` when it follows its parent's. |  |
| `peeks` | boolean |  | Whether its requests are recorded whole now (`listPeeks`): its own `peek`, else its parent's. |  |
| `annotate` | boolean \| null |  | Its own setting; `null` when it follows its parent's. |  |
| `annotates` | boolean |  | Whether its requests are annotated now (`getAnnotation`): its own `annotate`, else its parent's. |  |
| `internal` | boolean |  | The retired `voice-system` project, where voice once made its own requests: archived, its key revoked, never a caller's. Each project's own system key makes them now (`Key.internal`). |  |
| `aliases` | array of [ModelAlias](#schema-modelalias) |  | Its own model aliases. |  |
| `resolved_aliases` | array of object |  | The aliases in force for it: its own, then its parent's it gives none of. `from` is the project each is set on. |  |
| `resolved_aliases[].name` | string | yes |  |  |
| `resolved_aliases[].model` | string | yes |  |  |
| `resolved_aliases[].from` | string | yes |  |  |
| `name` | string | yes |  |  |
| `status` | string, one of `active`, `archived` | yes |  |  |
| `owners` | array of string | yes |  |  |
| `data_classes` | array of [DataClass](#schema-dataclass) | yes |  |  |
| `models` | array \| null |  |  |  |
| `accounts` | array \| null |  |  |  |
| `budget` | [Budget](#schema-budget) \| null |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |
| `parent` | string \| null |  | The project this one is a child of. Voice makes each organism of its habitat a project, `tenant-<organism>`, on its first call, a child of the habitat's project, `habitat-<name>`, the habitat itself, voice's customer: what the habitat may spend is that project's accounts. |  |
| `inherits` | boolean |  | A child's that spends its parent's accounts, read when it is used, not its own `accounts`: a change to the parent's reaches it on its next call. |  |
| `key_count` | integer |  |  |  |
| `position` | string \| null |  | The DNA position this project is, in a DNA deployment. |  |
| `created_at` | string (date-time) | yes |  |  |
| `archived_at` | string \| null (date-time) |  |  |  |

<a id="schema-policychange"></a>

### PolicyChange

A proposed change waiting for review. Nothing is applied until it is decided.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `status` | string, one of `pending_review`, `applied`, `rejected` | yes |  |  |
| `target` | string | yes | What would change, e.g. `projects/work/budget`. |  |
| `proposed` | object | yes | The request body as submitted. |  |
| `review` | string \| null |  | Where the decision is made, e.g. a DNA review id or URL. |  |

<a id="schema-keycreate"></a>

### KeyCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string | yes | Name the client this key is for; usage is broken down by key. | length ≤ 128 |
| `peek` | boolean |  | Each request it sends is recorded whole, its request as served and its final response, reasoning included, for the operator to read (`listPeeks`); kept seven days. A request is recorded when its project or its key peeks. |  |
| `annotate` | boolean |  | Each request it sends is annotated (`getAnnotation`), by the annotators in force for it, as requests of its project's system key; refused (`409`) while its project's `decide` names no decision model. A request is annotated when its project or its key annotates. |  |
| `models` | array \| null |  | Restrict the key to these models. Null means the project's catalog. |  |
| `accounts` | array \| null |  | Restrict the key to these accounts, within the project's. Null means the project's. A key for client work names the work account here, so everything it sends is billed there. |  |
| `limits` | array of [Limit](#schema-limit) |  | Key-scope limits, on top of the project's. |  |
| `expires_at` | string (date-time) |  |  |  |

<a id="schema-keyupdate"></a>

### KeyUpdate

Only the fields present change.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `peek` | boolean |  | Each request it sends is recorded whole, its request as served and its final response, reasoning included, for the operator to read (`listPeeks`); kept seven days. A request is recorded when its project or its key peeks. |  |
| `annotate` | boolean |  | Each request it sends is annotated (`getAnnotation`), by the annotators in force for it, as requests of its project's system key; refused (`409`) while its project's `decide` names no decision model. A request is annotated when its project or its key annotates. |  |
| `models` | array \| null |  |  |  |
| `accounts` | array \| null |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |
| `expires_at` | string \| null (date-time) |  |  |  |

<a id="schema-key"></a>

### Key

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `peek` | boolean |  | Each request it sends is recorded whole (`listPeeks`). |  |
| `annotate` | boolean |  | Each request it sends is annotated (`getAnnotation`). |  |
| `internal` | boolean |  | Its project's system key, `<project>-system`, made with the project: voice's own requests for it (annotations, titles) are made under it. No token names it; it is never revoked, renamed, peeked or annotated; its models, accounts and limits are the operator's to set, the only limits voice's requests are held to. |  |
| `project` | string | yes |  |  |
| `name` | string | yes |  |  |
| `prefix` | string |  | The first characters of the secret, for recognition. |  |
| `models` | array \| null |  |  |  |
| `accounts` | array \| null |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `created_by` | string |  | The principal who created it. |  |
| `expires_at` | string \| null (date-time) |  |  |  |
| `last_used_at` | string \| null (date-time) |  |  |  |
| `status` | string, one of `active`, `revoked`, `expired` | yes |  |  |
| `revoked_at` | string \| null (date-time) |  |  |  |

<a id="schema-keywithsecret"></a>

### KeyWithSecret

Type: [Key](#schema-key) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [Key](#schema-key) |  |  |  |
| `secret` | string | yes | Shown once. Voice stores only a digest. |  |

<a id="schema-usagerecord"></a>

### UsageRecord

One request, as the ledger holds it. This is the supplier's fact DNA
accounts from; it carries every field hale needs back: served model,
quantization, node, seat and account, tokens, price, wall, queue and
load time, and the caller's metadata untouched.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `project` | string | yes |  |  |
| `key` | string | yes |  |  |
| `requested_model` | string | yes | The model the caller named: a catalog model's id, or a name its project gives one (`ModelAlias`). |  |
| `resolved_model` | string |  | The catalog model the request was routed and served as: `requested_model` itself when the caller named a model, the model it named when it is a name the project gives one, read when the request was admitted. Absent from a record written before it was kept, and from an abandoned one (its instance stopped before it settled). |  |
| `requested_account` | string \| null |  | The account the request named in `voice.account`, if any. |  |
| `endpoint` | string, one of `responses`, `chat.completions` | yes |  |  |
| `status` | string, one of `served`, `incomplete`, `failed`, `rate_limited`, `budget_exhausted`, `no_capacity`, `deadline_exceeded`, `cancelled`, `abandoned` | yes | `abandoned`: the api instance serving it stopped before it settled. The brain records it when the instance's heartbeat stops, with the reservation released and tokens as far as they were known. |  |
| `served` | [Served](#schema-served) \| null | yes |  |  |
| `data_class` | [DataClass](#schema-dataclass) |  |  |  |
| `input_tokens` | integer | yes |  |  |
| `cached_input_tokens` | integer |  |  |  |
| `cache_write_input_tokens` | integer |  | Input tokens written to the provider's cache, as the engine reported them; counted in `input_tokens`. |  |
| `output_tokens` | integer | yes |  |  |
| `reasoning_tokens` | integer |  |  |  |
| `price_micros` | integer | yes |  |  |
| `currency` | string | yes |  |  |
| `timing` | [Timing](#schema-timing) | yes |  |  |
| `attempts` | array of [Attempt](#schema-attempt) |  |  |  |
| `instance` | string \| null |  | The api instance that admitted the request (`api-<id>`, the id the hub's `InstanceBeat` announces): which of an api's replicas the caller reached. `null` for a record from before instances were kept. |  |
| `conversation` | string \| null |  | The conversation the request was a turn of: its `prompt_cache_key`, the same on each turn. `null` when the caller sent none. The ledger's turns of one conversation share it. |  |
| `internal` | boolean |  | A request of its project's system key (`Key.internal`): voice's own for the project, an annotation or a conversation's title, its `metadata` naming the request it annotated (`annotates`) and its stage (`side`). It counts against the **account** that served it, which paid the provider for it: an account's spend and its provider windows include it, and an account's summary shows it as its own line (`group_by` `internal`). It does not count against the project's usage: left out of usage lists and summaries unless asked for (`include_internal`), out of the project's, its parents', tenants' and habitat's totals and limits, and out of the usage told to the organization. Only limits on the system key itself cap it. |  |
| `metadata` | [Metadata](#schema-metadata) | yes |  |  |

<a id="schema-usagesummary"></a>

### UsageSummary

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `group_by` | array of string | yes |  |  |
| `from` | string (date-time) |  |  |  |
| `to` | string (date-time) |  |  |  |
| `data` | array of object | yes |  |  |
| `data[].group` | object | yes | The group's values, keyed by the `group_by` fields, e.g. `{"project": "work", "key": "k_ci"}`. |  |
| `data[].requests` | integer | yes |  |  |
| `data[].refused` | integer |  | Requests refused by a limit or the budget. |  |
| `data[].input_tokens` | integer | yes |  |  |
| `data[].output_tokens` | integer | yes |  |  |
| `data[].price_micros` | integer | yes |  |  |
| `data[].currency` | string | yes |  |  |
| `data[].first_at` | string (date-time) | yes | When the group's earliest request was made. |  |
| `data[].last_at` | string (date-time) | yes | When its latest was. |  |
| `data[].last_request` | string | yes | The latest request's id, as `getUsage` reads it. |  |

<a id="schema-catalogmodelcreate"></a>

### CatalogModelCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | What callers name and seats serve. Stable; never reused for a different model. |  |
| `owned_by` | string |  | The provider, or `local`. | default `"local"` |
| `kind` | string, one of `local`, `hosted` |  |  | default `"local"` |
| `context_length` | integer |  | The longest context, in tokens, the model is made for. A model made from a recipe takes the recipe's when this is left out. | ≥ 1 |
| `max_output_tokens` | integer |  | Default and maximum output; used for reservation when a request sets none. | ≥ 1 |
| `price` | [ModelPrice](#schema-modelprice) \| null |  | What a request costs. For a subscription account this is the list-price equivalent. Null means free. |  |
| `recipe` | string |  | The recipe a local model's weights come from (`Recipe`): one voice ships or the operator allowed. Refused for a hosted model and for a recipe there is not. Fixed at creation, like the id. |  |
| `contract` | string, one of `generative`, `decision` |  | What it answers. `generative` (the default): text. `decision`: a model that answers only a structured request: `response_format` (or `text.format`) a `json_schema` whose every property is a question, a string `enum` (or `oneOf` of `{const, description}`) a choice of 1 to 255, a `boolean` a yes or no, an integer `enum` (or `oneOf`) of 2 to 10 levels in order a score; each property's `description` its instructions. Its messages are text only, and it takes no `tools`, sampling or length settings, nor `stream`. The answer's text is JSON matching the schema, each question's most likely answer, and `voice.decision` holds every probability. Whatever serves it, a Jev-Style decision model on a node or one behind a service, is asked as `/v1/systemone` asks. Left out, its recipe's, else `generative`. |  |

<a id="schema-catalogmodelupdate"></a>

### CatalogModelUpdate

Only the fields present change. The id and the recipe cannot change.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `owned_by` | string |  |  |  |
| `kind` | string, one of `local`, `hosted` |  |  |  |
| `context_length` | integer |  |  | ≥ 1 |
| `max_output_tokens` | integer |  |  | ≥ 1 |
| `price` | [ModelPrice](#schema-modelprice) \| null |  |  |  |
| `contract` | string, one of `generative`, `decision` |  |  |  |

<a id="schema-catalogmodel"></a>

### CatalogModel

Type: [CatalogModelCreate](#schema-catalogmodelcreate) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [CatalogModelCreate](#schema-catalogmodelcreate) |  |  |  |
| `seats` | array of string | yes | Seats that serve this model, written `<node>/<seat>`. |  |
| `available` | boolean | yes | As on `/v1/models`. |  |
| `served_context_length` | integer |  | The least context, in tokens, a seat that could serve it now took (`SeatView.context`); left out when none has said. Less than `context_length` when its seats serve less than the model is made for. | ≥ 1 |
| `created_at` | string (date-time) | yes |  |  |

<a id="schema-recipecreate"></a>

### RecipeCreate

Where a local model's weights come from, pinned: what the operator
allows (`createRecipe`), and the form of a file voice ships in
`recipes/<id>.json`. A recipe says only what the weights are; what
callers name, the price and the limits are the catalog's.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Stable; never reused for other weights. A shipped recipe's is its file's name without `.json`. | pattern `^[a-z0-9][a-z0-9.-]{0,62}$` |
| `license` | object | yes |  |  |
| `license.name` | string | yes |  | length ≥ 1; length ≤ 64 |
| `license.url` | string (uri) | yes |  | length ≤ 512 |
| `context_length` | integer |  | The longest context, in tokens, the model is made for (its config's `max_position_embeddings`). A catalog model made from the recipe takes it as its `context_length` unless one is given, and a seat is never started with more. What a seat actually serves can be less; each seat reports its own (`SeatState.context`). | ≥ 1; ≤ 16777216 |
| `kv_bytes_per_token` | integer |  | What one more token of context costs in KV cache, in bytes at 16 bits: the layers that keep every token (full attention, or MLA's latent), not the linear, recurrent or sliding-window ones. A placement sizes its seat's prompt cache by it. | ≥ 1; ≤ 16777216 |
| `contract` | string, one of `generative`, `decision` |  | What a catalog model made from it answers (`CatalogModel.contract`), unless the model says otherwise. Left out, `generative`. |  |
| `variants` | array of [RecipeVariant](#schema-recipevariant) | yes |  | items ≥ 1; items ≤ 8 |

<a id="schema-recipe"></a>

### Recipe

Type: [RecipeCreate](#schema-recipecreate) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [RecipeCreate](#schema-recipecreate) |  |  |  |
| `origin` | string, one of `shipped`, `operator` | yes | `shipped`: in voice's `recipes/`, read-only. `operator`: allowed through `createRecipe`. |  |
| `created_at` | string (date-time) |  | When the operator allowed it; left out for a shipped recipe. |  |

<a id="schema-recipevariant"></a>

### RecipeVariant

One form of the weights: a format and a quantization, from one
revision of one source, every file pinned by its digest. A variant
is what is placed: `memory_bytes` is its whole need, whatever nodes
it is placed across.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Distinct within its recipe. | pattern `^[a-z0-9][a-z0-9_.-]{0,62}$` |
| `format` | string, one of `safetensors`, `gguf`, `mlx` | yes | Formats that hold only tensors; none runs code when loaded. |  |
| `quantization` | string | yes |  | length ≥ 1; length ≤ 64 |
| `source` | object | yes |  |  |
| `source.hub` | string, one of `huggingface` | yes |  |  |
| `source.repo` | string | yes |  | length ≤ 128; pattern `^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `source.revision` | string | yes | A commit, never a branch or a tag. | pattern `^[0-9a-f]{40}$` |
| `files` | array of object | yes | At most 300, and the variant at most 45 KiB as JSON, which a frontier model's 160–250 shards fit: a placed seat's config carries the variant whole, and a seat's config is at most 48 KiB. Every file the variant needs, and nothing else: a file is fetched only when it is listed here, and used only when its digest matches. Each holds tensors, a tokenizer or settings (`.safetensors`, `.gguf`, `.json`, `.txt`, `.model`, `.tiktoken`, `.jinja`); a pickled checkpoint or code is never listed. | items ≥ 1; items ≤ 300 |
| `files[].path` | string | yes |  | length ≤ 256; pattern `^(?!/)(?!.*(^\|/)\.\.(/\|$))[A-Za-z0-9._/-]+\.(safetensors\|gguf\|json\|txt\|model\|tiktoken\|jinja)$` |
| `files[].bytes` | integer | yes |  | ≥ 1 |
| `files[].sha256` | string | yes |  | pattern `^[0-9a-f]{64}$` |
| `memory_bytes` | integer | yes | What serving the variant needs, weights and the engine's own, before any context. | ≥ 1 |

<a id="schema-runtimecreate"></a>

### RuntimeCreate

What serves a local model on a node, pinned: what the operator
allows (`createRuntime`), and the form of a file voice ships in
`runtimes/<id>.json`. A node starts only a `server` it knows, from
this artifact and nothing else, so a runtime names no command.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Stable; never reused for another build. A shipped runtime's is its file's name without `.json`. | pattern `^[a-z0-9][a-z0-9.-]{0,62}$` |
| `license` | object | yes |  |  |
| `license.name` | string | yes |  | length ≥ 1; length ≤ 64 |
| `license.url` | string (uri) | yes |  | length ≤ 512 |
| `server` | string, one of `vllm`, `llama-server`, `decision` | yes | The server program, which the node knows how to start and stop. `decision`: voice's decision server, `voice-decide`, which answers a decision model's requests (`CatalogModel.contract: decision`, asked as `/v1/systemone`): its MLX build, an archive that reads `mlx` on `metal`, or its native build, which reads `gguf` on any accelerator (an archive on macOS, a container on Linux). A decision recipe is placed only with a `decision` runtime, and a generative one never. |  |
| `formats` | array of string, one of `safetensors`, `gguf`, `mlx` | yes | The weight formats it reads. | items ≥ 1; items ≤ 3 |
| `accelerator` | string, one of `cuda`, `rocm`, `vulkan`, `metal`, `cpu` | yes | What it runs on. `cuda`: an NVIDIA GPU. `rocm`: an AMD GPU through ROCm. `vulkan`: an AMD or Intel GPU (or any with a Vulkan driver). `metal`: Apple silicon. `cpu` runs on any machine. A machine's GPU is placed on through its native API first (CUDA, ROCm, Metal), then Vulkan, then the processors. |  |
| `platforms` | array of object | yes |  | items ≥ 1; items ≤ 4 |
| `platforms[].os` | string, one of `linux`, `darwin` | yes |  |  |
| `platforms[].arch` | string, one of `arm64`, `x86_64` | yes |  |  |
| `artifact` | any | yes | Where it comes from. `container`: an image, pulled by its digest, never a tag; for several platforms, a manifest list's digest. `archive`: a tarball, fetched from `url` and used only when its sha256 matches. |  |

<a id="schema-runtime"></a>

### Runtime

Type: [RuntimeCreate](#schema-runtimecreate) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [RuntimeCreate](#schema-runtimecreate) |  |  |  |
| `origin` | string, one of `shipped`, `operator` | yes | `shipped`: in voice's `runtimes/`, read-only. `operator`: allowed through `createRuntime`. |  |
| `created_at` | string (date-time) |  | When the operator allowed it; left out for a shipped runtime. |  |

<a id="schema-placementcreate"></a>

### PlacementCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | Chosen at creation, stable forever, never reused; the id of the seat it creates on its leader. | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `account` | string | yes | The account the seat spends, as any seat names one; a local account that bills nothing, for a model on the operator's own machines. |  |
| `model` | string | yes | A local catalog model that names a recipe. |  |
| `nodes` | array of [NodeIdValue](#schema-nodeidvalue) | yes | The nodes it runs on, the first of them its leader, which holds the seat that serves it. One node today; a model too large for one is placed across several when engines can split it. | items ≥ 1; items ≤ 1 |
| `variant` | string |  | The operator's choice of form, taken only if it fits; left out, the coordinator picks. |  |
| `runtime` | string |  | The operator's choice of runtime, taken only if it runs the variant on the nodes; left out, the coordinator picks. |  |

<a id="schema-nodesuggestions"></a>

### NodeSuggestions

A node's platform and memory tier, and what voice would place on it per category.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `node` | string | yes |  |  |
| `os` | string |  | The node's platform, as its hardware says it; left out when it has declared none. |  |
| `tier_gb` | integer |  | The catalog tier the node is suggested from, in GB; left out below the smallest, or with no hardware declared. |  |
| `data` | array of [NodeSuggestion](#schema-nodesuggestion) | yes |  |  |

<a id="schema-nodesuggestion"></a>

### NodeSuggestion

One category's suggestion, or why there is none.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `category` | string | yes |  |  |
| `recipe` | string |  | The recipe voice suggests; left out when none can be placed. |  |
| `variant` | string |  | The variant a placement would take; left out when it is placed already. |  |
| `runtime` | string |  | The runtime that would serve it. |  |
| `tier_gb` | integer |  | The tier whose pick it is, which is the node's own or one below it. |  |
| `placed` | string |  | The placement already serving the recipe on this node, when there is one. |  |
| `reason` | string | yes | Why it fits (as a placement's fit says), that it is placed, or why there is no suggestion. |  |

<a id="schema-placement"></a>

### Placement

Type: [PlacementCreate](#schema-placementcreate) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [PlacementCreate](#schema-placementcreate) |  |  |  |
| `recipe` | string | yes | The model's recipe. |  |
| `variant` | string | yes | The form chosen. |  |
| `runtime` | string | yes | The runtime chosen to serve it. |  |
| `chosen_by` | string, one of `coordinator`, `operator` | yes |  |  |
| `leader` | string | yes | The node that holds the seat, the first of `nodes`. |  |
| `seat` | string | yes | The seat it created, `<leader>/<id>`. |  |
| `fit` | array of [VariantFit](#schema-variantfit) | yes | Each variant of the recipe, judged against the nodes as they declared their hardware when the placement was made. |  |
| `cache_tokens` | integer |  | The prompt cache its seat keeps, in tokens, shared by the conversations it holds: room for four of the model's context (at most 128k each) from at most half the memory its variant leaves on the node, and no larger than the variant itself; never less than the 32k its variant's memory provides. Left out of a placement made before voice sized it. | ≥ 1 |
| `reserved_bytes` | integer |  | What is reserved for it of its node's memory for models: its variant's need and its cache, all of it from when it is placed. Its seat holds that and its server's own, 2 GiB (the process, its GPU context and compute buffers; vLLM is given that sum as its share of the GPU). A later placement on the node fits in what the others leave. | ≥ 1 |
| `created_at` | string (date-time) | yes |  |  |

<a id="schema-peeksummary"></a>

### PeekSummary

A recorded request, listed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `request_id` | string | yes |  |  |
| `project` | string | yes |  |  |
| `key` | string | yes |  |  |
| `model` | string | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |

<a id="schema-peek"></a>

### Peek

A recorded request whole.

Type: [PeekSummary](#schema-peeksummary) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [PeekSummary](#schema-peeksummary) |  |  |  |
| `input` | string | yes | The standard request as it was served, a JSON document as text. |  |
| `output` | string | yes | The final response, reasoning included, a JSON document as text. |  |

<a id="schema-annotatorstage"></a>

### AnnotatorStage

When an annotator asks: `request`, of the request; `response`, of its
response, read beside the request; `title`, which asks no questions
but writes the conversation's title with its project's text model
(`AnnotatorTitle`), on the conversation's first request and again
when a later one is answered as another `task`.

Type: string, one of `request`, `response`, `title`

<a id="schema-annotatortitle"></a>

### AnnotatorTitle

A `title` annotator's model, by the alias its project gives a text
model, and what it is asked: a few words. Its runs are requests of
the project's system key.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string | yes | The project's alias for the text model asked, e.g. `general`. |  |
| `instruction` | string | yes |  | length ≥ 1; length ≤ 1000 |
| `max_output_tokens` | integer | yes |  | ≥ 4; ≤ 64 |

<a id="schema-annotationcondition"></a>

### AnnotationCondition

A request answer: holds when `annotator`'s `question` gave `answer`
a probability of `min_probability` or more.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `annotator` | string | yes |  |  |
| `question` | string | yes |  |  |
| `answer` | string | yes | A choice's option, `true` or `false`, or a score's level. |  |
| `min_probability` | number |  |  | default `0.5`; ≥ 0; ≤ 1 |

<a id="schema-annotatorquestion"></a>

### AnnotatorQuestion

One question, as a decision model answers it: a `choice` of 1 to 255
options, each a `value` and what it means; a `noul`, yes or no
(`true`, `false`), which takes no options; or a `score` of 2 to 10
levels in order, each an integer `value`. `instructions` is the
question. A response annotator's question may carry a `condition`
on the request's answers: asked only when it holds, and kept as
`skipped` when it does not.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string | yes |  | pattern `^[a-z0-9_]{1,64}$` |
| `type` | string, one of `choice`, `noul`, `score` | yes |  |  |
| `instructions` | string | yes |  | length ≥ 1; length ≤ 2000 |
| `options` | array of object |  |  | items ≤ 255 |
| `options[].value` | string | yes |  | length ≥ 1; length ≤ 128 |
| `options[].description` | string |  |  | length ≤ 500 |
| `condition` | [AnnotationCondition](#schema-annotationcondition) |  |  |  |

<a id="schema-annotatorscope"></a>

### AnnotatorScope

The requests it reads, of those whose project or key annotates:
these projects' (and their children's) and these keys'. Both empty,
every one.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `projects` | array of string | yes |  | items ≤ 32 |
| `keys` | array of string | yes |  | items ≤ 32 |

<a id="schema-annotatorcreate"></a>

### AnnotatorCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `name` | string | yes |  | length ≥ 1; length ≤ 128 |
| `stage` | [AnnotatorStage](#schema-annotatorstage) | yes |  |  |
| `questions` | array of [AnnotatorQuestion](#schema-annotatorquestion) | yes | Its questions, at least one; a `title` annotator asks none (`[]`). The enabled annotators of one stage ask at most 64 together, in one request to the decision model; at most 64 KiB as JSON. | items ≤ 64 |
| `title` | [AnnotatorTitle](#schema-annotatortitle) |  | A `title` annotator's model and instruction, which it needs; no other has one. |  |
| `scope` | [AnnotatorScope](#schema-annotatorscope) |  |  |  |
| `reads_request` | boolean |  | A response annotator that also reads the request's answers, as a short labelled block beside the text: its answers are `conditioned`, searchable apart from those given on the text alone. | default `false` |
| `enabled` | boolean |  |  | default `true` |

<a id="schema-annotatorupdate"></a>

### AnnotatorUpdate

What it sets makes a new version; its id and stage never change.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≥ 1; length ≤ 128 |
| `questions` | array of [AnnotatorQuestion](#schema-annotatorquestion) |  |  | items ≤ 64 |
| `scope` | [AnnotatorScope](#schema-annotatorscope) |  |  |  |
| `reads_request` | boolean |  |  |  |
| `enabled` | boolean |  |  |  |
| `title` | [AnnotatorTitle](#schema-annotatortitle) |  |  |  |

<a id="schema-annotator"></a>

### Annotator

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `stage` | [AnnotatorStage](#schema-annotatorstage) | yes |  |  |
| `version` | integer | yes | Its version, 1 when made, one more at each edit. |  |
| `questions` | array of [AnnotatorQuestion](#schema-annotatorquestion) | yes |  |  |
| `scope` | [AnnotatorScope](#schema-annotatorscope) | yes |  |  |
| `reads_request` | boolean | yes |  |  |
| `enabled` | boolean | yes |  |  |
| `builtin` | boolean | yes | Voice's own, shipped; edited and disabled, never removed. |  |
| `title` | [AnnotatorTitle](#schema-annotatortitle) |  | A `title` annotator's; left out for any other. |  |
| `created_at` | string (date-time) | yes |  |  |
| `updated_at` | string (date-time) | yes |  |  |

<a id="schema-annotatorstats"></a>

### AnnotatorStats

What one annotator's runs did, over the newest 200 annotations in the
range: how many asked it, what they came to, why the others were not
made, and the tokens of the requests that asked it (shared by the
annotators asked in one request).

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `annotator` | string | yes |  |  |
| `annotations` | integer | yes | The annotations read. |  |
| `runs` | integer | yes |  |  |
| `annotated` | integer | yes |  |  |
| `skipped` | integer | yes | Runs whose questions' conditions all did not hold. |  |
| `not_annotated` | integer | yes |  |  |
| `reasons` | array of object | yes |  |  |
| `reasons[].reason` | string | yes |  |  |
| `reasons[].count` | integer | yes |  |  |
| `input_tokens` | integer | yes |  |  |
| `output_tokens` | integer | yes |  |  |
| `last_error` | string |  | The newest reason one was not made; left out when none was. |  |
| `last_error_at` | string (date-time) |  |  |  |

<a id="schema-annotationrun"></a>

### AnnotationRun

One request voice made for an annotation, as a request of the
project's system key: a stage's questions asked of the decision
model, or a conversation's title written.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `stage` | [AnnotatorStage](#schema-annotatorstage) | yes |  |  |
| `annotators` | array of string | yes | The annotators it asked for, `<id>@<version>` each. |  |
| `request_id` | string \| null | yes | Its own request (its usage record, `internal`); null when none was made. |  |
| `model` | string \| null | yes |  |  |
| `input_tokens` | integer | yes |  |  |
| `output_tokens` | integer | yes |  |  |
| `ms` | integer | yes | How long it took. |  |
| `status` | string, one of `annotated`, `skipped`, `not_annotated` | yes |  |  |
| `reason` | string | yes | Why it was not made or was skipped; empty when it was made. |  |

<a id="schema-conversationtitle"></a>

### ConversationTitle

A conversation's title, as the title annotator last wrote it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `project` | string | yes |  |  |
| `conversation` | string | yes |  |  |
| `title` | string | yes |  |  |
| `task` | string |  | The request's `task` it was written under; left out when none was asked. |  |
| `model` | string | yes |  |  |
| `annotator` | string | yes |  |  |
| `version` | integer | yes |  |  |
| `made_at` | string (date-time) | yes |  |  |

<a id="schema-annotationexpect"></a>

### AnnotationExpect

The response answer a rule expects: `answer`, or for a score
`at_least`, a level's value or a higher one.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `annotator` | string | yes |  |  |
| `question` | string | yes |  |  |
| `answer` | string |  |  |  |
| `at_least` | string |  |  |  |

<a id="schema-annotationrulecreate"></a>

### AnnotationRuleCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | pattern `^[a-z0-9][a-z0-9-]{0,62}$` |
| `name` | string | yes |  | length ≥ 1; length ≤ 128 |
| `condition` | [AnnotationCondition](#schema-annotationcondition) \| null |  | When the rule applies, a request answer; left out, always. |  |
| `expect` | [AnnotationExpect](#schema-annotationexpect) | yes |  |  |
| `enabled` | boolean |  |  | default `true` |

<a id="schema-annotationruleupdate"></a>

### AnnotationRuleUpdate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≥ 1; length ≤ 128 |
| `condition` | [AnnotationCondition](#schema-annotationcondition) \| null |  | A request answer, or `null` for always. |  |
| `expect` | [AnnotationExpect](#schema-annotationexpect) |  |  |  |
| `enabled` | boolean |  |  |  |

<a id="schema-annotationrule"></a>

### AnnotationRule

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `name` | string | yes |  |  |
| `condition` | [AnnotationCondition](#schema-annotationcondition) |  | When the rule applies, a request answer; left out when it always does. |  |
| `expect` | [AnnotationExpect](#schema-annotationexpect) | yes |  |  |
| `enabled` | boolean | yes |  |  |
| `builtin` | boolean | yes |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `updated_at` | string (date-time) | yes |  |  |

<a id="schema-annotationsummary"></a>

### AnnotationSummary

A request's annotation, listed; its answers are `getAnnotation`'s.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `request_id` | string | yes |  |  |
| `project` | string | yes |  |  |
| `key` | string | yes |  |  |
| `conversation` | string |  | Its conversation (`UsageRecord.conversation`); left out when it has none. |  |
| `created_at` | string (date-time) | yes |  |  |
| `status` | string, one of `annotated`, `not_annotated` | yes |  |  |
| `reason` | string | yes | Why it was not annotated, empty when it was: its project has no decision model it may use, its system key is past its limits, or the model failed. |  |
| `clipped` | boolean | yes | A text read was cut to fit the decision model: its start and end were read, the middle left out and marked so. |  |
| `title` | string |  | The conversation's title, when this request's annotation wrote it; left out otherwise. |  |

<a id="schema-annotationanswer"></a>

### AnnotationAnswer

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `annotator` | string | yes |  |  |
| `version` | integer | yes |  |  |
| `stage` | [AnnotatorStage](#schema-annotatorstage) | yes |  |  |
| `question` | string | yes |  |  |
| `answer` | string |  | The likeliest answer; left out when skipped. |  |
| `probability` | number | yes |  |  |
| `probabilities` | object | yes | Every answer's probability. |  |
| `score` | number |  | A score's expected level, its levels weighed by their probabilities; left out for any other question. |  |
| `conditioned` | boolean | yes | Given by an annotator that read the request's answers too. |  |
| `skipped` | boolean | yes | Not asked, its condition not holding. |  |

<a id="schema-annotationpair"></a>

### AnnotationPair

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `rule` | string | yes |  |  |
| `name` | string | yes |  |  |
| `applies` | boolean | yes |  |  |
| `met` | boolean | yes |  |  |
| `probability` | number | yes | The probability of the answer it expects. |  |

<a id="schema-annotation"></a>

### Annotation

A request's annotation whole.

Type: [AnnotationSummary](#schema-annotationsummary) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [AnnotationSummary](#schema-annotationsummary) |  |  |  |
| `model` | string |  | The decision model that answered; left out when none did. |  |
| `input_tokens` | integer | yes | What its questions read, as requests of its project's system key. |  |
| `answers` | array of [AnnotationAnswer](#schema-annotationanswer) | yes |  |  |
| `pairs` | array of [AnnotationPair](#schema-annotationpair) | yes |  |  |
| `runs` | array of [AnnotationRun](#schema-annotationrun) | yes | Each request voice made for it, in order. |  |

<a id="schema-annotationfacets"></a>

### AnnotationFacets

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `question` | string | yes |  |  |
| `total` | integer | yes |  |  |
| `counts` | array of object | yes |  |  |
| `counts[].answer` | string | yes |  |  |
| `counts[].count` | integer | yes |  |  |

<a id="schema-annotationtrend"></a>

### AnnotationTrend

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `question` | string | yes |  |  |
| `bucket` | string, one of `hour`, `day` | yes |  |  |
| `points` | array of object | yes |  |  |
| `points[].at` | string (date-time) | yes |  |  |
| `points[].answer` | string | yes |  |  |
| `points[].count` | integer | yes |  |  |

<a id="schema-annotationbackfill"></a>

### AnnotationBackfill

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `annotator` | string | yes |  |  |
| `version` | integer |  | The version asked; its current one by default. | ≥ 1 |
| `project` | string |  |  |  |
| `key` | string |  |  |  |
| `from` | string (date-time) |  |  |  |
| `to` | string (date-time) |  |  |  |

<a id="schema-variantfit"></a>

### VariantFit

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `variant` | string | yes |  |  |
| `runtime` | string \| null | yes | The runtime that would serve it there; null when none runs it. |  |
| `fits` | boolean | yes |  |  |
| `reason` | string | yes | Why it fits or does not, in a line. |  |

<a id="schema-accountcreate"></a>

### AccountCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [AccountIdValue](#schema-accountidvalue) | yes |  |  |
| `name` | string | yes |  | length ≤ 128 |
| `provider` | string \| null |  | Who the account is with; null for a local engine. |  |
| `billing` | string, one of `subscription`, `metered`, `none` |  | `subscription`: a flat plan whose limits are windows the provider reports. `metered`: pay per token. `none`: a local engine. | default `"none"` |
| `limits` | array of [Limit](#schema-limit) |  | Account-scope limits, on top of what the provider allows. `scope` is `account`. |  |

<a id="schema-accountupdate"></a>

### AccountUpdate

Only the fields present change.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `provider` | string \| null |  |  |  |
| `billing` | string, one of `subscription`, `metered`, `none` |  |  |  |
| `limits` | array of [Limit](#schema-limit) |  |  |  |

<a id="schema-quotawindow"></a>

### QuotaWindow

A limit the provider enforces on the account, as an engine last reported it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string | yes |  |  |
| `used_percent` | number | yes |  | ≥ 0; ≤ 100 |
| `resets_at` | string \| null (date-time) |  |  |  |
| `observed_at` | string (date-time) | yes |  |  |
| `seat` | string |  | The seat whose engine reported it. |  |

<a id="schema-account"></a>

### Account

What pays and has limits. Its spend includes voice's own requests
for the projects it serves (each project's system key's,
`UsageRecord.internal`: annotations, titles), which it paid the
provider for; its usage summary shows them as their own line
(`summarizeUsage` with `group_by=account,internal` and
`include_internal=true`).

Type: [AccountCreate](#schema-accountcreate) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [AccountCreate](#schema-accountcreate) |  |  |  |
| `status` | string, one of `active`, `archived` | yes |  |  |
| `seats` | array of string | yes | Seats that spend this account, written `<node>/<seat>`. |  |
| `windows` | array of [QuotaWindow](#schema-quotawindow) | yes | Provider windows. Empty until an engine reports them; the static engine never does. |  |
| `exhausted_until` | string \| null (date-time) |  | Set while a provider window or an account limit is spent; routing skips the account until then. |  |
| `created_at` | string (date-time) | yes |  |  |
| `archived_at` | string \| null (date-time) |  |  |  |

<a id="schema-nodecreate"></a>

### NodeCreate

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [NodeIdValue](#schema-nodeidvalue) | yes |  |  |
| `name` | string |  |  | length ≤ 128 |
| `max_in_flight` | integer \| null |  | The coordinator's cap for the node. Null leaves the node's declared cap in charge. | ≥ 1 |

<a id="schema-nodeupdate"></a>

### NodeUpdate

Only the fields present change.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string |  |  | length ≤ 128 |
| `max_in_flight` | integer \| null |  |  | ≥ 1 |

<a id="schema-node"></a>

### Node

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `name` | string |  |  |  |
| `status` | string, one of `pending`, `up`, `down`, `revoked` | yes | `pending` until it first connects with its token. |  |
| `version` | string \| null |  | The node software's version, as it reported on connecting. |  |
| `capabilities` | [schemas-Capabilities](#schema-schemas-capabilities) \| null |  | What the node offers, as it last declared. Null until it first connects. |  |
| `local` | [LocalControls](#schema-localcontrols) \| null |  | Its local controls, as it last reported. Null until it first connects. |  |
| `max_in_flight` | integer \| null |  | The coordinator's cap for the node, or null for none. |  |
| `effective_max_in_flight` | integer \| null |  | The smallest of the declared, coordinator and local caps. Null until it first connects. |  |
| `in_flight` | integer |  |  |  |
| `assignment_version` | integer |  | The latest assignment for this node. |  |
| `applied_version` | integer \| null |  | The assignment the node last reported applying. |  |
| `seats` | array of [SeatView](#schema-seatview) | yes |  |  |
| `connected_at` | string \| null (date-time) |  |  |  |
| `last_heartbeat_at` | string \| null (date-time) |  |  |  |
| `created_at` | string (date-time) | yes |  |  |
| `revoked_at` | string \| null (date-time) |  |  |  |

<a id="schema-nodewithtoken"></a>

### NodeWithToken

Type: [Node](#schema-node) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [Node](#schema-node) |  |  |  |
| `enrollment_token` | string | yes | Shown once. The node is started with it. Voice stores only a digest. |  |

<a id="schema-seatupdate"></a>

### SeatUpdate

Only the fields present change. The id cannot.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `engine` | string |  |  |  |
| `account` | string |  |  |  |
| `serves` | array of [SeatModel](#schema-seatmodel) |  |  | items ≥ 1 |
| `data_classes` | array of string |  |  |  |
| `concurrency` | integer |  |  | ≥ 1 |
| `enabled` | boolean |  |  |  |
| `config` | object |  |  |  |

<a id="schema-seatview"></a>

### SeatView

A seat as configured here, with its state on its node.

Type: [Seat](#schema-seat) & object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| … | all of [Seat](#schema-seat) |  |  |  |
| `ref` | string | yes | The seat's full name, `<node>/<seat>`. |  |
| `node` | string | yes |  |  |
| `status` | string, one of `pending`, `offline`, `starting`, `fetching`, `up`, `down`, `disabled`, `paused`, `refused` | yes | `pending`: the node has not yet reported on the assignment that carries this version of the seat. `offline`: its node is not connected. The rest are as the node reported them (`SeatState` in the protocol). |  |
| `reason` | string \| null |  | The node's reason, for `down`, `paused` and `refused`. |  |
| `progress` | [FetchProgress](#schema-fetchprogress) |  |  |  |
| `context` | integer |  | A managed seat's: the context, in tokens, its server took, as its node last reported (`SeatState.context`). Left out until it says. It is never more than the recipe's `context_length`, and a llama.cpp seat's is at most 32768. | ≥ 1 |
| `in_flight` | integer | yes |  |  |
| `problems` | array of string | yes | What the coordinator sees wrong with it, e.g. a model not in the catalog or an archived account. |  |

<a id="schema-hub"></a>

### Hub

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `port` | integer | yes | The hub's port, on the host this api is reached at. |  |
| `topics` | array of string, one of `NodeObserved`, `InstanceBeat` | yes | The topics a subscriber may follow. |  |

<a id="schema-adminevent"></a>

### AdminEvent

One event on the admin stream. `data` is the resource as it now is.

Type: object \| object \| object \| object \| object \| object \| object \| object

<a id="schema-change"></a>

### Change

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `at` | string (date-time) | yes |  |  |
| `principal` | string \| null |  | Who made it. Null while admin authentication is off, as in the MVP. |  |
| `action` | string, one of `create`, `update`, `delete`, `archive`, `revoke`, `rotate` | yes |  |  |
| `target` | string | yes | The resource's path under `/admin/v1`. |  |
| `before` | object \| null |  | The resource as it was; null for a create. A node's change holds the node's own fields, not its seats: each seat's changes are recorded under the seat's own target. |  |
| `after` | object \| null |  | The resource as it became; null for a delete. A node's holds its own fields, as in `before`. |  |

<a id="schema-health"></a>

### Health

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `status` | string, one of `ok`, `unavailable` | yes |  |  |
| `version` | string |  |  |  |
| `checks` | object |  | Each dependency's state, on readiness. |  |

<a id="schema-refusal"></a>

### Refusal

A transport refusal, before or instead of the handler.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `refusal` | object | yes |  |  |
| `refusal.kind` | string | yes |  |  |
| `refusal.reason` | string | yes |  |  |

<a id="schema-adminproblem"></a>

### AdminProblem

What a control-plane handler found wrong, in the contract's words:
the error's `code`, a `message`, the request field at fault, and,
for a store failure, the incident it was logged under.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `code` | string, one of `invalid_request`, `unsupported`, `request_too_large`, `context_length_exceeded`, `invalid_key`, `model_not_found`, `model_not_permitted`, `account_not_permitted`, `data_class_refused`, `previous_response_not_found`, `rate_limited`, `budget_exhausted`, `no_eligible_seat`, `no_capacity`, `metering_unavailable`, `upstream_failed`, `deadline_exceeded`, `not_found`, `conflict`, `internal_error`, `route_table_unavailable` | yes |  |  |
| `message` | string | yes |  |  |
| `param` | string |  | The request field at fault. |  |
| `incident` | string |  | The id a store failure was logged under. |  |

<a id="schema-admininvalid"></a>

### AdminInvalid

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `Invalid` | [AdminProblem](#schema-adminproblem) | yes |  |  |

<a id="schema-adminnotfound"></a>

### AdminNotFound

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `NotFound` | [AdminProblem](#schema-adminproblem) | yes |  |  |

<a id="schema-adminconflict"></a>

### AdminConflict

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `Conflict` | [AdminProblem](#schema-adminproblem) | yes |  |  |

<a id="schema-adminunavailable"></a>

### AdminUnavailable

What the handler needs is unavailable (503, `Hale-Error-Class:
unavailable`): the store, or, for readiness, the `Health` that says so.

Type: object \| object

<a id="schema-errorresponse"></a>

### ErrorResponse

The Open Responses error envelope, with voice's codes and an optional `voice` object.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `error` | object | yes |  |  |
| `error.message` | string | yes |  |  |
| `error.type` | string, one of `invalid_request`, `not_found`, `too_many_requests`, `server_error`, `model_error`, `authentication_error`, `permission_error` | yes | The standard's types, plus `authentication_error` and `permission_error` for the admin plane and key checks. |  |
| `error.code` | string, one of `invalid_request`, `unsupported`, `request_too_large`, `context_length_exceeded`, `invalid_key`, `model_not_found`, `model_not_permitted`, `account_not_permitted`, `data_class_refused`, `previous_response_not_found`, `rate_limited`, `budget_exhausted`, `no_eligible_seat`, `no_capacity`, `metering_unavailable`, `upstream_failed`, `deadline_exceeded`, `not_found`, `conflict`, `internal_error`, `route_table_unavailable` | yes |  |  |
| `error.param` | string \| null |  |  |  |
| `error.voice` | object |  |  |  |
| `error.voice.request_id` | string |  |  |  |
| `error.voice.limit` | [Limit](#schema-limit) |  | The limit that refused the request, for `rate_limited`. |  |
| `error.voice.budget` | [Budget](#schema-budget) |  | The budget that refused the request, for `budget_exhausted`. |  |
| `error.voice.attempts` | array of [Attempt](#schema-attempt) |  |  |  |

<a id="schema-itemreferenceparam"></a>

### ItemReferenceParam

An internal identifier for an item to reference.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `item_reference` \| null |  | The type of item to reference. Always `item_reference`. |  |
| `id` | string | yes | The ID of the item to reference. |  |

<a id="schema-reasoningsummarycontentparam"></a>

### ReasoningSummaryContentParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `summary_text` | yes | The content type. Always `summary_text`. | default `"summary_text"` |
| `text` | string | yes | The reasoning summary text. | length ≤ 10485760 |

<a id="schema-reasoningitemparam"></a>

### ReasoningItemParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of this reasoning item. |  |
| `type` | string, one of `reasoning` | yes | The item type. Always `reasoning`. | default `"reasoning"` |
| `summary` | array of [ReasoningSummaryContentParam](#schema-reasoningsummarycontentparam) | yes | Reasoning summary content associated with this item. |  |
| `content` | null |  |  |  |
| `encrypted_content` | string \| null |  | An encrypted representation of the reasoning content. |  |

<a id="schema-compactionsummaryitemparam"></a>

### CompactionSummaryItemParam

A compaction item generated by the [`v1/responses/compact` API](/docs/api-reference/responses/compact).

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The ID of the compaction item. |  |
| `type` | string, one of `compaction` | yes | The type of the item. Always `compaction`. | default `"compaction"` |
| `encrypted_content` | string | yes | The encrypted content of the compaction summary. | length ≤ 10485760 |

<a id="schema-inputtextcontentparam"></a>

### InputTextContentParam

A text input to the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_text` | yes | The type of the input item. Always `input_text`. | default `"input_text"` |
| `text` | string | yes | The text input to the model. | length ≤ 10485760 |

<a id="schema-imagedetail"></a>

### ImageDetail

Type: string, one of `low`, `high`, `auto`

<a id="schema-inputimagecontentparamautoparam"></a>

### InputImageContentParamAutoParam

An image input to the model. Learn about [image inputs](/docs/guides/vision)

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_image` | yes | The type of the input item. Always `input_image`. | default `"input_image"` |
| `image_url` | string \| null |  | The URL of the image to be sent to the model. A fully qualified URL or base64 encoded image in a data URL. |  |
| `detail` | [ImageDetail](#schema-imagedetail) \| null |  |  |  |

<a id="schema-inputfilecontentparam"></a>

### InputFileContentParam

A file input to the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_file` | yes | The type of the input item. Always `input_file`. | default `"input_file"` |
| `filename` | string \| null |  | The name of the file to be sent to the model. |  |
| `file_data` | string \| null |  | The base64-encoded data of the file to be sent to the model. |  |
| `file_url` | string \| null |  | The URL of the file to be sent to the model. |  |

<a id="schema-usermessageitemparam"></a>

### UserMessageItemParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of this message item. |  |
| `type` | string, one of `message` | yes | The item type. Always `message`. | default `"message"` |
| `role` | string, one of `user` | yes | The message role. Always `user`. | default `"user"` |
| `content` | array of [InputTextContentParam](#schema-inputtextcontentparam) \| [InputImageContentParamAutoParam](#schema-inputimagecontentparamautoparam) \| [InputFileContentParam](#schema-inputfilecontentparam) \| string | yes | The message content, as an array of content parts. |  |
| `status` | string \| null |  | The status of the message item. |  |

<a id="schema-systemmessageitemparam"></a>

### SystemMessageItemParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of this message item. |  |
| `type` | string, one of `message` | yes | The item type. Always `message`. | default `"message"` |
| `role` | string, one of `system` | yes | The message role. Always `system`. | default `"system"` |
| `content` | array of [InputTextContentParam](#schema-inputtextcontentparam) \| string | yes | The message content, as an array of content parts. |  |
| `status` | string \| null |  | The status of the message item. |  |

<a id="schema-developermessageitemparam"></a>

### DeveloperMessageItemParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of this message item. |  |
| `type` | string, one of `message` | yes | The item type. Always `message`. | default `"message"` |
| `role` | string, one of `developer` | yes | The message role. Always `developer`. | default `"developer"` |
| `content` | array of [InputTextContentParam](#schema-inputtextcontentparam) \| string | yes | The message content, as an array of content parts. |  |
| `status` | string \| null |  | The status of the message item. |  |

<a id="schema-urlcitationparam"></a>

### UrlCitationParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `url_citation` | yes | The citation type. Always `url_citation`. | default `"url_citation"` |
| `start_index` | integer | yes | The index of the first character of the citation in the message. | ≥ 0 |
| `end_index` | integer | yes | The index of the last character of the citation in the message. | ≥ 0 |
| `url` | string | yes | The URL of the cited resource. |  |
| `title` | string | yes | The title of the cited resource. |  |

<a id="schema-outputtextcontentparam"></a>

### OutputTextContentParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `output_text` | yes | The content type. Always `output_text`. | default `"output_text"` |
| `text` | string | yes | The text content. | length ≤ 10485760 |
| `annotations` | array of [UrlCitationParam](#schema-urlcitationparam) |  | Citations associated with the text content. |  |

<a id="schema-refusalcontentparam"></a>

### RefusalContentParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `refusal` | yes | The content type. Always `refusal`. | default `"refusal"` |
| `refusal` | string | yes | The refusal text. | length ≤ 10485760 |

<a id="schema-assistantmessageitemparam"></a>

### AssistantMessageItemParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of this message item. |  |
| `type` | string, one of `message` | yes | The item type. Always `message`. | default `"message"` |
| `role` | string, one of `assistant` | yes | The role of the message author. Always `assistant`. | default `"assistant"` |
| `content` | array of [OutputTextContentParam](#schema-outputtextcontentparam) \| [RefusalContentParam](#schema-refusalcontentparam) \| string | yes | The message content, as an array of content parts. |  |
| `phase` | string, one of `commentary`, `final_answer` |  | Labels an `assistant` message as intermediate commentary (`commentary`) or the final answer (`final_answer`). For models like `gpt-5.3-codex` and beyond, when sending follow-up requests, preserve and resend phase on all assistant messages. Omitting it can degrade performance. Not used for user messages. |  |
| `status` | string \| null |  | The status of the message item. |  |

<a id="schema-functioncallstatus"></a>

### FunctionCallStatus

Type: string, one of `in_progress`, `completed`, `incomplete`

<a id="schema-functioncallitemparam"></a>

### FunctionCallItemParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of this function tool call. |  |
| `call_id` | string | yes | The unique ID of the function tool call generated by the model. | length ≥ 1; length ≤ 64 |
| `type` | string, one of `function_call` | yes | The item type. Always `function_call`. | default `"function_call"` |
| `name` | string | yes | The name of the function to call. | length ≥ 1; length ≤ 64; pattern `^[a-zA-Z0-9_-]+$` |
| `arguments` | string | yes | The function arguments as a JSON string. |  |
| `status` | [FunctionCallStatus](#schema-functioncallstatus) \| null |  |  |  |

<a id="schema-inputvideocontent"></a>

### InputVideoContent

A content block representing a video input to the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_video` | yes | The type of the input content. Always `input_video`. |  |
| `video_url` | string | yes | A base64 or remote url that resolves to a video file. |  |

<a id="schema-functioncalloutputitemparam"></a>

### FunctionCallOutputItemParam

The output of a function tool call.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string \| null |  | The unique ID of the function tool call output. Populated when this item is returned via API. |  |
| `call_id` | string | yes | The unique ID of the function tool call generated by the model. | length ≥ 1; length ≤ 64 |
| `type` | string, one of `function_call_output` | yes | The type of the function tool call output. Always `function_call_output`. | default `"function_call_output"` |
| `output` | string \| array of [InputTextContentParam](#schema-inputtextcontentparam) \| [InputImageContentParamAutoParam](#schema-inputimagecontentparamautoparam) \| [InputFileContentParam](#schema-inputfilecontentparam) \| [InputVideoContent](#schema-inputvideocontent) | yes | Text, image, or file output of the function tool call. |  |
| `status` | [FunctionCallStatus](#schema-functioncallstatus) \| null |  |  |  |

<a id="schema-itemparam"></a>

### ItemParam

Type: [ItemReferenceParam](#schema-itemreferenceparam) \| [ReasoningItemParam](#schema-reasoningitemparam) \| [CompactionSummaryItemParam](#schema-compactionsummaryitemparam) \| [UserMessageItemParam](#schema-usermessageitemparam) \| [SystemMessageItemParam](#schema-systemmessageitemparam) \| [DeveloperMessageItemParam](#schema-developermessageitemparam) \| [AssistantMessageItemParam](#schema-assistantmessageitemparam) \| [FunctionCallItemParam](#schema-functioncallitemparam) \| [FunctionCallOutputItemParam](#schema-functioncalloutputitemparam)

<a id="schema-includeenum"></a>

### IncludeEnum

Type: string, one of `reasoning.encrypted_content`, `message.output_text.logprobs`

<a id="schema-emptymodelparam"></a>

### EmptyModelParam

Type: object

<a id="schema-functiontoolparam"></a>

### FunctionToolParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `name` | string | yes |  | length ≥ 1; length ≤ 64; pattern `^[a-zA-Z0-9_-]+$` |
| `description` | string \| null |  |  |  |
| `parameters` | [EmptyModelParam](#schema-emptymodelparam) \| null |  |  |  |
| `strict` | boolean |  |  |  |
| `type` | string, one of `function` | yes |  | default `"function"` |

<a id="schema-responsestoolparam"></a>

### ResponsesToolParam

Type: [FunctionToolParam](#schema-functiontoolparam)

<a id="schema-specificfunctionparam"></a>

### SpecificFunctionParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `function` | yes | The tool to call. Always `function`. | default `"function"` |
| `name` | string | yes | The name of the function tool to call. |  |

<a id="schema-specifictoolchoiceparam"></a>

### SpecificToolChoiceParam

Type: [SpecificFunctionParam](#schema-specificfunctionparam)

<a id="schema-toolchoicevalueenum"></a>

### ToolChoiceValueEnum

Type: string, one of `none`, `auto`, `required`

<a id="schema-allowedtoolsparam"></a>

### AllowedToolsParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `allowed_tools` | yes | The tool choice type. Always `allowed_tools`. | default `"allowed_tools"` |
| `tools` | array of [SpecificToolChoiceParam](#schema-specifictoolchoiceparam) | yes | The list of tools that are permitted for this request. | items ≥ 1; items ≤ 128 |
| `mode` | [ToolChoiceValueEnum](#schema-toolchoicevalueenum) |  | How to select a tool from the allowed set. |  |

<a id="schema-toolchoiceparam"></a>

### ToolChoiceParam

Controls which tool the model should use, if any.

Type: [SpecificToolChoiceParam](#schema-specifictoolchoiceparam) \| [ToolChoiceValueEnum](#schema-toolchoicevalueenum) \| [AllowedToolsParam](#schema-allowedtoolsparam)

<a id="schema-metadataparam"></a>

### MetadataParam

Set of 16 key-value pairs that can be attached to an object. This can be         useful for storing additional information about the object in a structured         format, and querying for objects via API or the dashboard.
        Keys are strings with a maximum length of 64 characters. Values are strings         with a maximum length of 512 characters.

Type: object

<a id="schema-textresponseformat"></a>

### TextResponseFormat

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `text` | yes |  | default `"text"` |

<a id="schema-jsonschemaresponseformatparam"></a>

### JsonSchemaResponseFormatParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `json_schema` |  | The type of response format being defined. Always `json_schema`. |  |
| `description` | string |  | A description of what the response format is for, used by the model to determine how to respond in the format. |  |
| `name` | string |  | The name of the response format. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64. |  |
| `schema` | object |  | The schema for the response format, described as a JSON Schema object. |  |
| `strict` | boolean \| null |  | Whether to enable strict schema adherence when generating the output. If set to true, the model will always follow the exact schema defined in the `schema` field. Only a subset of JSON Schema is supported when `strict` is `true`. |  |

<a id="schema-textformatparam"></a>

### TextFormatParam

Type: [TextResponseFormat](#schema-textresponseformat) \| [JsonSchemaResponseFormatParam](#schema-jsonschemaresponseformatparam)

<a id="schema-verbosityenum"></a>

### VerbosityEnum

Type: string, one of `low`, `medium`, `high`

<a id="schema-textparam"></a>

### TextParam

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `format` | [TextFormatParam](#schema-textformatparam) \| null |  | The format configuration for text output. |  |
| `verbosity` | [VerbosityEnum](#schema-verbosityenum) |  | Controls the level of detail in generated text output. |  |

<a id="schema-streamoptionsparam"></a>

### StreamOptionsParam

Options that control streamed response behavior.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `include_obfuscation` | boolean |  | Whether to obfuscate sensitive information in streamed output. Defaults to `true`. |  |

<a id="schema-reasoningeffortenum"></a>

### ReasoningEffortEnum

Type: string, one of `none`, `low`, `medium`, `high`, `xhigh`

<a id="schema-reasoningsummaryenum"></a>

### ReasoningSummaryEnum

Type: string, one of `concise`, `detailed`, `auto`

<a id="schema-reasoningparam"></a>

### ReasoningParam

**gpt-5 and o-series models only** Configuration options for [reasoning models](https://platform.openai.com/docs/guides/reasoning).

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `effort` | [ReasoningEffortEnum](#schema-reasoningeffortenum) \| null |  | Controls the level of reasoning effort the model should apply. Higher effort may increase latency and cost. |  |
| `summary` | [ReasoningSummaryEnum](#schema-reasoningsummaryenum) \| null |  |  |  |

<a id="schema-truncationenum"></a>

### TruncationEnum

Type: string, one of `auto`, `disabled`

<a id="schema-servicetierenum"></a>

### ServiceTierEnum

Type: string, one of `auto`, `default`, `flex`, `priority`

<a id="schema-createresponsebody"></a>

### CreateResponseBody

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string \| null |  | The model to use for this request, e.g. 'gpt-5.2'. |  |
| `input` | string \| array of [ItemParam](#schema-itemparam) \| null |  | Context to provide to the model for the scope of this request. May either be a string or an array of input items. If a string is provided, it is interpreted as a user message. |  |
| `previous_response_id` | string \| null |  | The ID of the response to use as the prior turn for this request. |  |
| `include` | array of [IncludeEnum](#schema-includeenum) |  |  |  |
| `tools` | array of [ResponsesToolParam](#schema-responsestoolparam) \| null |  | A list of tools that the model may call while generating the response. |  |
| `tool_choice` | [ToolChoiceParam](#schema-toolchoiceparam) \| null |  |  |  |
| `metadata` | [MetadataParam](#schema-metadataparam) \| null |  |  |  |
| `text` | [TextParam](#schema-textparam) \| null |  |  |  |
| `temperature` | number \| null |  | Sampling temperature to use, between 0 and 2. Higher values make the output more random. |  |
| `top_p` | number \| null |  | Nucleus sampling parameter, between 0 and 1. The model considers only the tokens with the top cumulative probability. |  |
| `presence_penalty` | number \| null |  | Penalizes new tokens based on whether they appear in the text so far. |  |
| `frequency_penalty` | number \| null |  | Penalizes new tokens based on their frequency in the text so far. |  |
| `parallel_tool_calls` | boolean \| null |  | Whether the model may call multiple tools in parallel. |  |
| `stream` | boolean |  | Whether to stream response events as server-sent events. |  |
| `stream_options` | [StreamOptionsParam](#schema-streamoptionsparam) \| null |  |  |  |
| `background` | boolean |  | Whether to run the request in the background and return immediately. |  |
| `max_output_tokens` | integer \| null |  | The maximum number of tokens the model may generate for this response. |  |
| `max_tool_calls` | integer \| null |  | The maximum number of tool calls the model may make while generating the response. |  |
| `reasoning` | [ReasoningParam](#schema-reasoningparam) \| null |  |  |  |
| `safety_identifier` | string \| null |  | A stable identifier used for safety monitoring and abuse detection. |  |
| `prompt_cache_key` | string \| null |  | A key to use when reading from or writing to the prompt cache. |  |
| `truncation` | [TruncationEnum](#schema-truncationenum) |  | Controls how the service truncates the input when it exceeds the model context window. |  |
| `instructions` | string \| null |  | Additional instructions to guide the model for this request. |  |
| `store` | boolean |  | Whether to store the response so it can be retrieved later. |  |
| `service_tier` | [ServiceTierEnum](#schema-servicetierenum) |  | The service tier to use for this request. |  |
| `top_logprobs` | integer \| null |  | The number of most likely tokens to return at each position, along with their log probabilities. |  |

<a id="schema-incompletedetails"></a>

### IncompleteDetails

Details about why the response was incomplete.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `reason` | string | yes | The reason the response could not be completed. |  |

<a id="schema-messagestatus"></a>

### MessageStatus

Type: string, one of `in_progress`, `completed`, `incomplete`

<a id="schema-messagerole"></a>

### MessageRole

Type: string, one of `user`, `assistant`, `system`, `developer`

<a id="schema-inputtextcontent"></a>

### InputTextContent

A text input to the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_text` | yes | The type of the input item. Always `input_text`. | default `"input_text"` |
| `text` | string | yes | The text input to the model. |  |

<a id="schema-urlcitationbody"></a>

### UrlCitationBody

A citation for a web resource used to generate a model response.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `url_citation` | yes | The type of the URL citation. Always `url_citation`. | default `"url_citation"` |
| `url` | string | yes | The URL of the web resource. |  |
| `start_index` | integer | yes | The index of the first character of the URL citation in the message. |  |
| `end_index` | integer | yes | The index of the last character of the URL citation in the message. |  |
| `title` | string | yes | The title of the web resource. |  |

<a id="schema-schemas-annotation"></a>

### schemas-Annotation

An annotation that applies to a span of output text.

Type: [UrlCitationBody](#schema-urlcitationbody)

<a id="schema-toplogprob"></a>

### TopLogProb

The top log probability of a token.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `token` | string | yes |  |  |
| `logprob` | number | yes |  |  |
| `bytes` | array of integer | yes |  |  |

<a id="schema-logprob"></a>

### LogProb

The log probability of a token.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `token` | string | yes |  |  |
| `logprob` | number | yes |  |  |
| `bytes` | array of integer | yes |  |  |
| `top_logprobs` | array of [TopLogProb](#schema-toplogprob) | yes |  |  |

<a id="schema-outputtextcontent"></a>

### OutputTextContent

A text output from the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `output_text` | yes | The type of the output text. Always `output_text`. | default `"output_text"` |
| `text` | string | yes | The text output from the model. |  |
| `annotations` | array of [schemas-Annotation](#schema-schemas-annotation) | yes | The annotations of the text output. |  |
| `logprobs` | array of [LogProb](#schema-logprob) |  |  |  |

<a id="schema-textcontent"></a>

### TextContent

A text content.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `text` | yes |  | default `"text"` |
| `text` | string | yes |  |  |

<a id="schema-summarytextcontent"></a>

### SummaryTextContent

A summary text from the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `summary_text` | yes | The type of the object. Always `summary_text`. | default `"summary_text"` |
| `text` | string | yes | A summary of the reasoning output from the model so far. |  |

<a id="schema-reasoningtextcontent"></a>

### ReasoningTextContent

Reasoning text from the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `reasoning_text` | yes | The type of the reasoning text. Always `reasoning_text`. | default `"reasoning_text"` |
| `text` | string | yes | The reasoning text from the model. |  |

<a id="schema-refusalcontent"></a>

### RefusalContent

A refusal from the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `refusal` | yes | The type of the refusal. Always `refusal`. | default `"refusal"` |
| `refusal` | string | yes | The refusal explanation from the model. |  |

<a id="schema-inputimagecontent"></a>

### InputImageContent

An image input to the model. Learn about [image inputs](/docs/guides/vision).

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_image` | yes | The type of the input item. Always `input_image`. | default `"input_image"` |
| `image_url` | string \| null | yes | The URL of the image to be sent to the model. A fully qualified URL or base64 encoded image in a data URL. |  |
| `detail` | [ImageDetail](#schema-imagedetail) | yes | The detail level of the image to be sent to the model. One of `high`, `low`, or `auto`. Defaults to `auto`. |  |

<a id="schema-inputfilecontent"></a>

### InputFileContent

A file input to the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `input_file` | yes | The type of the input item. Always `input_file`. | default `"input_file"` |
| `filename` | string |  | The name of the file to be sent to the model. |  |
| `file_url` | string |  | The URL of the file to be sent to the model. |  |

<a id="schema-message"></a>

### Message

A message to or from the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `message` | yes | The type of the message. Always set to `message`. | default `"message"` |
| `id` | string | yes | The unique ID of the message. |  |
| `status` | [MessageStatus](#schema-messagestatus) | yes | The status of item. One of `in_progress`, `completed`, or `incomplete`. Populated when items are returned via API. |  |
| `role` | [MessageRole](#schema-messagerole) | yes | The role of the message. One of `unknown`, `user`, `assistant`, `system`, `critic`, `discriminator`, `developer`, or `tool`. |  |
| `content` | array of [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) \| [InputVideoContent](#schema-inputvideocontent) | yes | The content of the message |  |
| `phase` | string, one of `commentary`, `final_answer` |  | Labels an `assistant` message as intermediate commentary (`commentary`) or the final answer (`final_answer`). For models like `gpt-5.3-codex` and beyond, when sending follow-up requests, preserve and resend phase on all assistant messages. Omitting it can degrade performance. Not used for user messages. |  |

<a id="schema-functioncall"></a>

### FunctionCall

A function tool call that was generated by the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `function_call` | yes | The type of the item. Always `function_call`. | default `"function_call"` |
| `id` | string | yes | The unique ID of the function call item. |  |
| `call_id` | string | yes | The unique ID of the function tool call that was generated. |  |
| `name` | string | yes | The name of the function that was called. |  |
| `arguments` | string | yes | The arguments JSON string that was generated. |  |
| `status` | [FunctionCallStatus](#schema-functioncallstatus) | yes | The status of the function call item that was recorded. |  |

<a id="schema-functioncalloutputstatusenum"></a>

### FunctionCallOutputStatusEnum

Similar to `FunctionCallStatus`. All three options are allowed here for compatibility, but because in practice these items will be provided by developers, only `completed` should be used.

Type: string, one of `in_progress`, `completed`, `incomplete`

<a id="schema-functioncalloutput"></a>

### FunctionCallOutput

A function tool call output that was returned by the tool.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `function_call_output` | yes | The type of the function tool call output. Always `function_call_output`. | default `"function_call_output"` |
| `id` | string | yes | The unique ID of the function tool call output. Populated when this item is returned via API. |  |
| `call_id` | string | yes | The unique ID of the function tool call generated by the model. |  |
| `output` | string \| array of [InputTextContent](#schema-inputtextcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) | yes | A JSON string of the output of the function tool call. |  |
| `status` | [FunctionCallOutputStatusEnum](#schema-functioncalloutputstatusenum) | yes | The status of the item. One of `in_progress`, `completed`, or `incomplete`. Populated when items are returned via API. |  |

<a id="schema-reasoningbody"></a>

### ReasoningBody

A reasoning item that was generated by the model.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `reasoning` | yes | The type of the item. Always `reasoning`. | default `"reasoning"` |
| `id` | string | yes | The unique ID of the reasoning item. |  |
| `content` | array of [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) |  | The reasoning content that was generated. |  |
| `summary` | array of [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) | yes | The reasoning summary content that was generated. |  |
| `encrypted_content` | string |  | The encrypted reasoning content that was generated. |  |

<a id="schema-compactionbody"></a>

### CompactionBody

A compaction item generated by the [`v1/responses/compact` API](/docs/api-reference/responses/compact).

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `compaction` | yes | The type of the item. Always `compaction`. | default `"compaction"` |
| `id` | string | yes | The unique ID of the compaction item. |  |
| `encrypted_content` | string | yes | The encrypted content that was produced by compaction. |  |
| `created_by` | string |  | The identifier of the actor that created the item. |  |

<a id="schema-itemfield"></a>

### ItemField

An item representing a message, tool call, tool output, reasoning, or other response element.

Type: [Message](#schema-message) \| [FunctionCall](#schema-functioncall) \| [FunctionCallOutput](#schema-functioncalloutput) \| [ReasoningBody](#schema-reasoningbody) \| [CompactionBody](#schema-compactionbody)

<a id="schema-error"></a>

### Error

An error that occurred while generating the response.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `code` | string | yes | A machine-readable error code that was returned. |  |
| `message` | string | yes | A human-readable description of the error that was returned. |  |

<a id="schema-functiontool"></a>

### FunctionTool

Defines a function in your own code the model can choose to call. Learn more about [function calling](https://platform.openai.com/docs/guides/function-calling).

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `function` | yes | The type of the function tool. Always `function`. | default `"function"` |
| `name` | string | yes | The name of the function to call. |  |
| `description` | string \| null | yes | A description of the function. Used by the model to determine whether or not to call the function. |  |
| `parameters` | object \| null | yes | A JSON schema object describing the parameters of the function. |  |
| `strict` | boolean \| null | yes | Whether to enforce strict parameter validation. Default `true`. |  |

<a id="schema-tool"></a>

### Tool

A tool that can be used to generate a response.

Type: [FunctionTool](#schema-functiontool)

<a id="schema-functiontoolchoice"></a>

### FunctionToolChoice

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `function` | yes |  | default `"function"` |
| `name` | string |  |  |  |

<a id="schema-allowedtoolchoice"></a>

### AllowedToolChoice

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `allowed_tools` | yes |  | default `"allowed_tools"` |
| `tools` | array of [FunctionToolChoice](#schema-functiontoolchoice) | yes |  |  |
| `mode` | [ToolChoiceValueEnum](#schema-toolchoicevalueenum) | yes |  |  |

<a id="schema-jsonobjectresponseformat"></a>

### JsonObjectResponseFormat

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `json_object` | yes |  | default `"json_object"` |

<a id="schema-jsonschemaresponseformat"></a>

### JsonSchemaResponseFormat

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `json_schema` | yes |  | default `"json_schema"` |
| `name` | string | yes |  |  |
| `description` | string \| null | yes |  |  |
| `schema` | null | yes |  |  |
| `strict` | boolean | yes |  |  |

<a id="schema-textfield"></a>

### TextField

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `format` | [TextResponseFormat](#schema-textresponseformat) \| [JsonObjectResponseFormat](#schema-jsonobjectresponseformat) \| [JsonSchemaResponseFormat](#schema-jsonschemaresponseformat) | yes |  |  |
| `verbosity` | [VerbosityEnum](#schema-verbosityenum) |  |  |  |

<a id="schema-reasoning"></a>

### Reasoning

Reasoning configuration and metadata that were used for the response.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `effort` | [ReasoningEffortEnum](#schema-reasoningeffortenum) \| null | yes | The reasoning effort that was requested for the model, if specified. |  |
| `summary` | [ReasoningSummaryEnum](#schema-reasoningsummaryenum) \| null | yes |  |  |

<a id="schema-inputtokensdetails"></a>

### InputTokensDetails

A breakdown of input token usage that was recorded.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `cached_tokens` | integer | yes | The number of input tokens that were served from cache. |  |

<a id="schema-outputtokensdetails"></a>

### OutputTokensDetails

A breakdown of output token usage that was recorded.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `reasoning_tokens` | integer | yes | The number of output tokens that were attributed to reasoning. |  |

<a id="schema-usage"></a>

### Usage

Token usage statistics that were recorded for the response.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `input_tokens` | integer | yes | The number of input tokens that were used to generate the response. |  |
| `output_tokens` | integer | yes | The number of output tokens that were generated by the model. |  |
| `total_tokens` | integer | yes | The total number of tokens that were used. |  |
| `input_tokens_details` | [InputTokensDetails](#schema-inputtokensdetails) | yes | A breakdown of input token usage that was recorded. |  |
| `output_tokens_details` | [OutputTokensDetails](#schema-outputtokensdetails) | yes | A breakdown of output token usage that was recorded. |  |

<a id="schema-responseresource"></a>

### ResponseResource

The complete response object that was returned by the Responses API.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes | The unique ID of the response that was created. |  |
| `object` | string, one of `response` | yes | The object type, which was always `response`. | default `"response"` |
| `created_at` | integer | yes | The Unix timestamp (in seconds) for when the response was created. |  |
| `completed_at` | integer \| null | yes | The Unix timestamp (in seconds) for when the response was completed, if it was completed. |  |
| `status` | string | yes | The status that was set for the response. |  |
| `incomplete_details` | [IncompleteDetails](#schema-incompletedetails) \| null | yes |  |  |
| `model` | string | yes | The model that generated this response. |  |
| `previous_response_id` | string \| null | yes | The ID of the previous response in the chain that was referenced, if any. |  |
| `instructions` | string \| null | yes | Additional instructions that were used to guide the model for this response. |  |
| `output` | array of [ItemField](#schema-itemfield) | yes | The output items that were generated by the model. |  |
| `error` | [Error](#schema-error) \| null | yes |  |  |
| `tools` | array of [Tool](#schema-tool) | yes | The tools that were available to the model during response generation. |  |
| `tool_choice` | [FunctionToolChoice](#schema-functiontoolchoice) \| [ToolChoiceValueEnum](#schema-toolchoicevalueenum) \| [AllowedToolChoice](#schema-allowedtoolchoice) | yes |  |  |
| `truncation` | [TruncationEnum](#schema-truncationenum) | yes | How the input was truncated by the service when it exceeded the model context window. |  |
| `parallel_tool_calls` | boolean | yes | Whether the model was allowed to call multiple tools in parallel. |  |
| `text` | [TextField](#schema-textfield) | yes | Configuration options for text output that were used. |  |
| `top_p` | number | yes | The nucleus sampling parameter that was used for this response. |  |
| `presence_penalty` | number | yes | The presence penalty that was used to penalize new tokens based on whether they appear in the text so far. |  |
| `frequency_penalty` | number | yes | The frequency penalty that was used to penalize new tokens based on their frequency in the text so far. |  |
| `top_logprobs` | integer | yes | The number of most likely tokens that were returned at each position, along with their log probabilities. |  |
| `temperature` | number | yes | The sampling temperature that was used for this response. |  |
| `reasoning` | [Reasoning](#schema-reasoning) \| null | yes |  |  |
| `usage` | [Usage](#schema-usage) \| null | yes |  |  |
| `max_output_tokens` | integer \| null | yes | The maximum number of tokens the model was allowed to generate for this response. |  |
| `max_tool_calls` | integer \| null | yes | The maximum number of tool calls the model was allowed to make while generating the response. |  |
| `store` | boolean | yes | Whether this response was stored so it can be retrieved later. |  |
| `background` | boolean | yes | Whether this request was run in the background. |  |
| `service_tier` | string | yes | The service tier that was used for this response. |  |
| `metadata` | any | yes | Developer-defined metadata that was associated with the response. |  |
| `safety_identifier` | string \| null | yes | A stable identifier that was used for safety monitoring and abuse detection. |  |
| `prompt_cache_key` | string \| null | yes | A key that was used to read from or write to the prompt cache. |  |

<a id="schema-responsecreatedstreamingevent"></a>

### ResponseCreatedStreamingEvent

A streaming event that indicated the response was created.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.created` | yes | The type of the event, always `response.created`. | default `"response.created"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `response` | [ResponseResource](#schema-responseresource) | yes | The response snapshot that was emitted with the event. |  |

<a id="schema-responsequeuedstreamingevent"></a>

### ResponseQueuedStreamingEvent

A streaming event that indicated the response was queued.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.queued` | yes | The type of the event, always `response.queued`. | default `"response.queued"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `response` | [ResponseResource](#schema-responseresource) | yes | The response snapshot that was emitted with the event. |  |

<a id="schema-responseinprogressstreamingevent"></a>

### ResponseInProgressStreamingEvent

A streaming event that indicated the response was in progress.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.in_progress` | yes | The type of the event, always `response.in_progress`. | default `"response.in_progress"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `response` | [ResponseResource](#schema-responseresource) | yes | The response snapshot that was emitted with the event. |  |

<a id="schema-responsecompletedstreamingevent"></a>

### ResponseCompletedStreamingEvent

A streaming event that indicated the response was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.completed` | yes | The type of the event, always `response.completed`. | default `"response.completed"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `response` | [ResponseResource](#schema-responseresource) | yes | The response snapshot that was emitted with the event. |  |

<a id="schema-responsefailedstreamingevent"></a>

### ResponseFailedStreamingEvent

A streaming event that indicated the response had failed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.failed` | yes | The type of the event, always `response.failed`. | default `"response.failed"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `response` | [ResponseResource](#schema-responseresource) | yes | The response snapshot that was emitted with the event. |  |

<a id="schema-responseincompletestreamingevent"></a>

### ResponseIncompleteStreamingEvent

A streaming event that indicated the response was incomplete.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.incomplete` | yes | The type of the event, always `response.incomplete`. | default `"response.incomplete"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `response` | [ResponseResource](#schema-responseresource) | yes | The response snapshot that was emitted with the event. |  |

<a id="schema-responseoutputitemaddedstreamingevent"></a>

### ResponseOutputItemAddedStreamingEvent

A streaming event that indicated an output item was added to the response.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.output_item.added` | yes | The type of the event, always `response.output_item.added`. | default `"response.output_item.added"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `output_index` | integer | yes | The index of the output item that was added. |  |
| `item` | [ItemField](#schema-itemfield) \| null | yes |  |  |

<a id="schema-responseoutputitemdonestreamingevent"></a>

### ResponseOutputItemDoneStreamingEvent

A streaming event that indicated an output item was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.output_item.done` | yes | The type of the event, always `response.output_item.done`. | default `"response.output_item.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `output_index` | integer | yes | The index of the output item that was completed. |  |
| `item` | [ItemField](#schema-itemfield) \| null | yes |  |  |

<a id="schema-responsereasoningsummarypartaddedstreamingevent"></a>

### ResponseReasoningSummaryPartAddedStreamingEvent

A streaming event that indicated a reasoning summary part was added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.reasoning_summary_part.added` | yes | The type of the event, always `response.reasoning_summary_part.added`. | default `"response.reasoning_summary_part.added"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `summary_index` | integer | yes | The index of the summary part that was added. |  |
| `part` | [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) | yes | A content part that makes up an input or output item. |  |

<a id="schema-responsereasoningsummarypartdonestreamingevent"></a>

### ResponseReasoningSummaryPartDoneStreamingEvent

A streaming event that indicated a reasoning summary part was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.reasoning_summary_part.done` | yes | The type of the event, always `response.reasoning_summary_part.done`. | default `"response.reasoning_summary_part.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `summary_index` | integer | yes | The index of the summary part that was completed. |  |
| `part` | [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) | yes | A content part that makes up an input or output item. |  |

<a id="schema-responsecontentpartaddedstreamingevent"></a>

### ResponseContentPartAddedStreamingEvent

A streaming event that indicated a content part was added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.content_part.added` | yes | The type of the event, always `response.content_part.added`. | default `"response.content_part.added"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the content part that was added. |  |
| `part` | [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) | yes | A content part that makes up an input or output item. |  |

<a id="schema-responsecontentpartdonestreamingevent"></a>

### ResponseContentPartDoneStreamingEvent

A streaming event that indicated a content part was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.content_part.done` | yes | The type of the event, always `response.content_part.done`. | default `"response.content_part.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the content part that was completed. |  |
| `part` | [InputTextContent](#schema-inputtextcontent) \| [OutputTextContent](#schema-outputtextcontent) \| [TextContent](#schema-textcontent) \| [SummaryTextContent](#schema-summarytextcontent) \| [ReasoningTextContent](#schema-reasoningtextcontent) \| [RefusalContent](#schema-refusalcontent) \| [InputImageContent](#schema-inputimagecontent) \| [InputFileContent](#schema-inputfilecontent) | yes | A content part that makes up an input or output item. |  |

<a id="schema-responseoutputtextdeltastreamingevent"></a>

### ResponseOutputTextDeltaStreamingEvent

A streaming event that indicated output text was incrementally added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.output_text.delta` | yes | The type of the event, always `response.output_text.delta`. | default `"response.output_text.delta"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the content part that was updated. |  |
| `delta` | string | yes | The text delta that was appended. |  |
| `logprobs` | array of [LogProb](#schema-logprob) |  | The token log probabilities that were emitted with the delta, if any. |  |
| `obfuscation` | string |  | An obfuscation string that was added to pad the event payload. |  |

<a id="schema-responseoutputtextdonestreamingevent"></a>

### ResponseOutputTextDoneStreamingEvent

A streaming event that indicated output text was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.output_text.done` | yes | The type of the event, always `response.output_text.done`. | default `"response.output_text.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the content part that was completed. |  |
| `text` | string | yes | The final text that was emitted. |  |
| `logprobs` | array of [LogProb](#schema-logprob) |  | The token log probabilities that were emitted with the final text, if any. |  |

<a id="schema-responserefusaldeltastreamingevent"></a>

### ResponseRefusalDeltaStreamingEvent

A streaming event that indicated refusal text was incrementally added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.refusal.delta` | yes | The type of the event, always `response.refusal.delta`. | default `"response.refusal.delta"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the refusal content that was updated. |  |
| `delta` | string | yes | The refusal text delta that was appended. |  |

<a id="schema-responserefusaldonestreamingevent"></a>

### ResponseRefusalDoneStreamingEvent

A streaming event that indicated refusal text was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.refusal.done` | yes | The type of the event, always `response.refusal.done`. | default `"response.refusal.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the refusal content that was completed. |  |
| `refusal` | string | yes | The final refusal text that was emitted. |  |

<a id="schema-responsereasoningdeltastreamingevent"></a>

### ResponseReasoningDeltaStreamingEvent

A streaming event that indicated reasoning text was incrementally added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.reasoning.delta` | yes | The type of the event, always `response.reasoning.delta`. | default `"response.reasoning.delta"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the reasoning content that was updated. |  |
| `delta` | string | yes | The reasoning text delta that was appended. |  |
| `obfuscation` | string |  | An obfuscation string that was added to pad the event payload. |  |

<a id="schema-responsereasoningdonestreamingevent"></a>

### ResponseReasoningDoneStreamingEvent

A streaming event that indicated reasoning text was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.reasoning.done` | yes | The type of the event, always `response.reasoning.done`. | default `"response.reasoning.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the reasoning content that was completed. |  |
| `text` | string | yes | The final reasoning text that was emitted. |  |

<a id="schema-responsereasoningsummarydeltastreamingevent"></a>

### ResponseReasoningSummaryDeltaStreamingEvent

A streaming event that indicated a reasoning summary was incrementally added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.reasoning_summary_text.delta` | yes | The type of the event, always `response.reasoning_summary.delta`. | default `"response.reasoning_summary_text.delta"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `summary_index` | integer | yes | The index of the summary content that was updated. |  |
| `delta` | string | yes | The summary text delta that was appended. |  |
| `obfuscation` | string |  | An obfuscation string that was added to pad the event payload. |  |

<a id="schema-responsereasoningsummarydonestreamingevent"></a>

### ResponseReasoningSummaryDoneStreamingEvent

A streaming event that indicated a reasoning summary was completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.reasoning_summary_text.done` | yes | The type of the event, always `response.reasoning_summary.done`. | default `"response.reasoning_summary_text.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `summary_index` | integer | yes | The index of the summary content that was completed. |  |
| `text` | string | yes | The final summary text that was emitted. |  |

<a id="schema-responseoutputtextannotationaddedstreamingevent"></a>

### ResponseOutputTextAnnotationAddedStreamingEvent

A streaming event that indicated an output text annotation was added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.output_text.annotation.added` | yes | The type of the event, always `response.output_text.annotation.added`. | default `"response.output_text.annotation.added"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `content_index` | integer | yes | The index of the output text content that was updated. |  |
| `annotation_index` | integer | yes | The index of the annotation that was added. |  |
| `annotation` | [schemas-Annotation](#schema-schemas-annotation) \| null | yes |  |  |

<a id="schema-responsefunctioncallargumentsdeltastreamingevent"></a>

### ResponseFunctionCallArgumentsDeltaStreamingEvent

A streaming event that indicated function call arguments were incrementally added.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.function_call_arguments.delta` | yes | The type of the event, always `response.function_call_arguments.delta`. | default `"response.function_call_arguments.delta"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the tool call item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `delta` | string | yes | The arguments delta that was appended. |  |
| `obfuscation` | string |  | An obfuscation string that was added to pad the event payload. |  |

<a id="schema-responsefunctioncallargumentsdonestreamingevent"></a>

### ResponseFunctionCallArgumentsDoneStreamingEvent

A streaming event that indicated function call arguments were completed.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `response.function_call_arguments.done` | yes | The type of the event, always `response.function_call_arguments.done`. | default `"response.function_call_arguments.done"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `item_id` | string | yes | The ID of the tool call item that was updated. |  |
| `output_index` | integer | yes | The index of the output item that was updated. |  |
| `arguments` | string | yes | The final arguments string that was emitted. |  |

<a id="schema-errorpayload"></a>

### ErrorPayload

An error payload that was emitted for a streaming error event.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string | yes | The error type that was emitted. |  |
| `code` | string \| null | yes | The error code that was emitted, if any. |  |
| `message` | string | yes | The human-readable error message that was emitted. |  |
| `param` | string \| null | yes | The parameter name that was associated with the error, if any. |  |
| `headers` | object |  | The response headers that were emitted with the error, if any. |  |

<a id="schema-errorstreamingevent"></a>

### ErrorStreamingEvent

A streaming event that indicated an error was emitted.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `type` | string, one of `error` | yes | The type of the event, always `error`. | default `"error"` |
| `sequence_number` | integer | yes | The sequence number of the event that was emitted. |  |
| `error` | [ErrorPayload](#schema-errorpayload) | yes | The error payload that was emitted. |  |

<a id="schema-schema"></a>

### schema

Type: [ResponseCreatedStreamingEvent](#schema-responsecreatedstreamingevent) \| [ResponseQueuedStreamingEvent](#schema-responsequeuedstreamingevent) \| [ResponseInProgressStreamingEvent](#schema-responseinprogressstreamingevent) \| [ResponseCompletedStreamingEvent](#schema-responsecompletedstreamingevent) \| [ResponseFailedStreamingEvent](#schema-responsefailedstreamingevent) \| [ResponseIncompleteStreamingEvent](#schema-responseincompletestreamingevent) \| [ResponseOutputItemAddedStreamingEvent](#schema-responseoutputitemaddedstreamingevent) \| [ResponseOutputItemDoneStreamingEvent](#schema-responseoutputitemdonestreamingevent) \| [ResponseReasoningSummaryPartAddedStreamingEvent](#schema-responsereasoningsummarypartaddedstreamingevent) \| [ResponseReasoningSummaryPartDoneStreamingEvent](#schema-responsereasoningsummarypartdonestreamingevent) \| [ResponseContentPartAddedStreamingEvent](#schema-responsecontentpartaddedstreamingevent) \| [ResponseContentPartDoneStreamingEvent](#schema-responsecontentpartdonestreamingevent) \| [ResponseOutputTextDeltaStreamingEvent](#schema-responseoutputtextdeltastreamingevent) \| [ResponseOutputTextDoneStreamingEvent](#schema-responseoutputtextdonestreamingevent) \| [ResponseRefusalDeltaStreamingEvent](#schema-responserefusaldeltastreamingevent) \| [ResponseRefusalDoneStreamingEvent](#schema-responserefusaldonestreamingevent) \| [ResponseReasoningDeltaStreamingEvent](#schema-responsereasoningdeltastreamingevent) \| [ResponseReasoningDoneStreamingEvent](#schema-responsereasoningdonestreamingevent) \| [ResponseReasoningSummaryDeltaStreamingEvent](#schema-responsereasoningsummarydeltastreamingevent) \| [ResponseReasoningSummaryDoneStreamingEvent](#schema-responsereasoningsummarydonestreamingevent) \| [ResponseOutputTextAnnotationAddedStreamingEvent](#schema-responseoutputtextannotationaddedstreamingevent) \| [ResponseFunctionCallArgumentsDeltaStreamingEvent](#schema-responsefunctioncallargumentsdeltastreamingevent) \| [ResponseFunctionCallArgumentsDoneStreamingEvent](#schema-responsefunctioncallargumentsdonestreamingevent) \| [ErrorStreamingEvent](#schema-errorstreamingevent)

<a id="schema-slug"></a>

### Slug

Type: string

Notes: pattern `^[a-z0-9][a-z0-9-]{0,62}$`

<a id="schema-engine"></a>

### Engine

One engine the node offers: a kind of engine with the login it runs
under. Two logins for one CLI are two engines. How the login is held
is local to the node and is never declared.

Whether a seat carries `tools` is derived from its kind, not
declared: an `openai-compatible` seat does, a `static` seat only
with its `tool_call` drill, any other kind never. A `serve` whose
request lists `tools` for a seat that does not carry them is
`refused` before any event, a seat failure, so the coordinator
offers the request to the next seat.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [Slug](#schema-slug) | yes | Unique on the node; seats name it. |  |
| `kind` | string | yes | What runs, e.g. `static`, `claude-cli`, `codex-cli`, `agy`, or `managed`: a model the coordinator placed on the node, whose weights and runtime the node fetches and verifies itself (`ManagedConfig`). |  |
| `description` | string |  |  |  |
| `models` | array \| null |  | The engine's own names for the models it can run, when it knows them. Null when any name may be tried. |  |
| `config_schema` | object | yes | JSON Schema of the `config` a seat on this engine takes. The coordinator checks seats against it, and a UI renders it as a form. The static engine's is `StaticConfig`, the openai-compatible engine's `OpenAICompatibleConfig`, the claude-cli engine's `ClaudeCliConfig`, the managed engine's `ManagedConfig`. |  |

<a id="schema-accelerator"></a>

### Accelerator

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `kind` | string, one of `cuda`, `rocm`, `vulkan`, `metal` | yes | How it is reached: `cuda` (NVIDIA, through its driver), `rocm` (AMD, when ROCm's compute device `/dev/kfd` is there), `vulkan` (a discrete AMD or Intel GPU through its Vulkan driver), `metal` (Apple silicon). An AMD card with ROCm is listed as both `rocm` and `vulkan`. |  |
| `name` | string | yes |  |  |
| `memory_bytes` | integer | yes | Its own memory; with `unified`, the machine's, which it shares. | ≥ 0 |
| `unified` | boolean | yes | True when it shares the machine's memory (Apple silicon, NVIDIA GB10) rather than having its own. |  |

<a id="schema-hardware"></a>

### Hardware

What the machine has, as the node measures it when it declares its
capabilities: the machine describing itself, so a model can be
placed where it fits. Nothing here is a control. A node that does
not measure leaves it out, and no model is placed on it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `os` | string, one of `linux`, `darwin` | yes |  |  |
| `arch` | string, one of `arm64`, `x86_64` | yes |  |  |
| `memory_bytes` | integer | yes | The machine's memory. | ≥ 1 |
| `model_memory_bytes` | integer | yes | What models may use of it: `memory_bytes` less what the machine keeps for its own system (a sixteenth, at least 4 GiB; on a machine whose GPU shares its memory, the one pool both draw on), or less when the node's operator holds some back in the capabilities file, which only lowers it. The seats the node runs hold at most this together: a seat that would take more is not started, and says so. | ≥ 0 |
| `accelerators` | array of [Accelerator](#schema-accelerator) | yes | At most 16; a machine with more declares its first 16, and its node says so in its log. | items ≤ 16 |
| `disk_free_bytes` | integer | yes | Free space under the node's data directory, where weights are kept. | ≥ 0 |

<a id="schema-schemas-capabilities"></a>

### schemas-Capabilities

What the node can run, as its operator configured it on the machine.
The coordinator assigns seats only within it, and the node refuses
any seat outside it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `engines` | array of [Engine](#schema-engine) | yes |  | items ≤ 16 |
| `max_in_flight` | integer | yes | The most requests the node will serve at once, across all its seats. | ≥ 1 |
| `hardware` | [Hardware](#schema-hardware) |  |  |  |

<a id="schema-localcontrols"></a>

### LocalControls

What the node's operator set on the machine. Each field only
restricts: a paused node or seat takes no new requests, and a local
cap only lowers the effective one.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `paused` | boolean | yes |  |  |
| `paused_seats` | array of string | yes |  | items ≤ 32 |
| `max_in_flight` | integer \| null |  | A local cap on requests in flight, or null for none. | ≥ 0 |
| `reason` | string \| null |  | Why, for the admin to read. |  |

<a id="schema-seatmodel"></a>

### SeatModel

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string | yes | A catalog model id. |  |
| `as` | string \| null |  | The engine's own name for it, when that differs, e.g. `sonnet` for `claude-sonnet-5`. |  |

<a id="schema-seat"></a>

### Seat

One seat as the coordinator assigns it: an engine the node offers,
spending one account, serving some catalog models.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [Slug](#schema-slug) | yes | Unique on the node. Its full name is `<node>/<seat>`. |  |
| `engine` | string | yes | The id of one of the node's declared engines. |  |
| `account` | string | yes | The coordinator account this seat spends. Several seats, on one node or many, may name the same account and share its limits. |  |
| `serves` | array of [SeatModel](#schema-seatmodel) | yes |  | items ≥ 1 |
| `data_classes` | array of string |  | Data classes this seat may carry. Defaults to `[internal]`. |  |
| `concurrency` | integer |  | Requests this seat serves at once. | default `1`; ≥ 1 |
| `enabled` | boolean |  |  | default `true` |
| `config` | object |  | Engine-specific, valid against the engine's `config_schema`. |  |

<a id="schema-fetchprogress"></a>

### FetchProgress

How far a managed seat's fetch is, in bytes, across its files and its runtime's archive.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `done_bytes` | integer | yes |  | ≥ 0 |
| `total_bytes` | integer | yes |  | ≥ 0 |

<a id="schema-seatroute"></a>

### SeatRoute

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `seat` | string | yes | `<node>/<seat>`. |  |
| `node` | string | yes |  |  |
| `account` | string | yes |  |  |
| `engine_model` | string \| null |  | The seat's own name for the model, passed through in `serve`. |  |
| `rank` | number | yes | Lower is better. Account headroom first, then seat load, with a little jitter so instances spread. |  |
| `free` | integer | yes | Slots the seat had free as of this table, bounded by its concurrency and its node's effective cap. An instance decrements its copy when it sends `serve`; the node's answer is the truth. | ≥ 0 |
| `data_classes` | array of string | yes |  |  |

<a id="schema-modelroutes"></a>

### ModelRoutes

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `model` | string | yes | A catalog model id. |  |
| `seats` | array of [SeatRoute](#schema-seatroute) | yes | The seats that can serve it now, best first. |  |
| `exhausted` | array of object | yes | Accounts that could serve it but have no headroom, and when they will again. |  |
| `exhausted[].account` | string | yes |  |  |
| `exhausted[].until` | string \| null (date-time) | yes |  |  |

<a id="schema-routetable"></a>

### RouteTable

The route table as `route_table` holds it and `GET /admin/v1/routes` answers it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `version` | integer | yes | Milliseconds of Postgres's clock when the table was written, and always above the version before it (the stored version plus one when the clock has not passed it), so it increases with every write across a takeover and a clock step. An instance ignores a table older than the one it holds. |  |
| `at` | string (date-time) | yes |  |  |
| `models` | array of [ModelRoutes](#schema-modelroutes) | yes |  |  |

<a id="schema-registration"></a>

### Registration

What a node presents when it registers.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `protocol` | `2` | yes | This document's version. |  |
| `version` | string | yes | The node software's version. |  |
| `capabilities` | [schemas-Capabilities](#schema-schemas-capabilities) | yes |  |  |
| `local` | [LocalControls](#schema-localcontrols) | yes |  |  |

<a id="schema-assignment"></a>

### Assignment

Everything the coordinator wants the node to run. The whole state each time, never a diff.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `version` | integer | yes | Increases with every change. The node applies the newest it has. |  |
| `max_in_flight` | integer | yes | The coordinator's cap for this node, at most the node's declared `max_in_flight`. | ≥ 1 |
| `seats` | array of [Seat](#schema-seat) | yes | A seat the node is running and this list leaves out is stopped once its in-flight requests finish. | items ≤ 16 |

<a id="schema-registered"></a>

### Registered

The coordinator's answer to a registration.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `protocol` | `2` | yes |  |  |
| `heartbeat_interval_ms` | integer | yes |  | ≥ 1000 |
| `nats` | object | yes |  |  |
| `nats.url` | string | yes | Where NATS is, from the node's side of the private network. |  |
| `nats.subject` | string | yes | The node's own subject prefix. |  |
| `nats.user` | string |  | Grafted into a DNA habitat, the nodes' account on its broker, which may subscribe on `heart.<id>.node.>` and publish on `heart.<id>.reply.>` and `heart.<id>._INBOX.>`; absent standalone. |  |
| `nats.password` | string |  | That account's password, present with `user` alone; the answer is sent `Cache-Control: no-store`. |  |
| `assignment` | [Assignment](#schema-assignment) | yes |  |  |

<a id="schema-seatstate"></a>

### SeatState

One assigned seat's state on the node.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `status` | string, one of `starting`, `fetching`, `up`, `down`, `disabled`, `paused`, `refused` | yes | `fetching`: a managed seat whose weights or runtime the node is fetching and verifying; `progress` says how far. `starting`, for a managed seat: its server is loading the model. `down`: the engine cannot serve, e.g. its CLI is missing or logged out, or a managed seat's file did not verify. `paused`: a local control holds it. `refused`: the seat is outside the node's capabilities, e.g. an engine it does not offer or a config its engine rejects; `reason` says which. |  |
| `reason` | string \| null |  |  |  |
| `progress` | [FetchProgress](#schema-fetchprogress) |  |  |  |
| `context` | integer |  | A managed seat's server, once it answers: the context, in tokens, it took (llama-server's `n_ctx`, vLLM's `max_model_len`). Left out until it says. | ≥ 1 |
| `in_flight` | integer | yes |  | ≥ 0 |

<a id="schema-heartbeat"></a>

### Heartbeat

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `in_flight` | integer | yes | Requests in flight across the node. | ≥ 0 |
| `seats` | array of [SeatState](#schema-seatstate) | yes |  | items ≤ 16 |
| `assignment_version` | integer |  | The assignment version the node has applied. Core NATS delivers an `assign` at most once; a coordinator that sees this behind the node's current version publishes the assignment again. | ≥ 0 |

<a id="schema-seatstates"></a>

### SeatStates

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `assignment_version` | integer | yes | The assignment these states answer. |  |
| `seats` | array of [SeatState](#schema-seatstate) | yes |  | items ≤ 16 |

<a id="schema-quotareport"></a>

### QuotaReport

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `seat` | string | yes |  |  |
| `windows` | array of [QuotaWindow](#schema-quotawindow) | yes |  | items ≤ 16 |

<a id="schema-draining"></a>

### Draining

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `reason` | string |  |  |  |
