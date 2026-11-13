<!-- Generated from spec/node.yaml by spec/tools/apidocs/render.mjs. Do not edit: run spec/tools/apidocs.sh. -->

# voice node (0.1.0-draft)

> Generated from [`spec/node.yaml`](../../spec/node.yaml), the contract. Regenerate with `spec/tools/apidocs.sh`; CI fails when this file and the contract differ.

The local API of voice's own node.

A node is one machine running voice's node software, on the private
network with NATS. What it runs is configured on the coordinator
(`openapi.yaml`, `/admin/v1/nodes/{node}/seats`) and reaches it as an
assignment: over the api's node plane when it registers, over NATS
after (`protocol.yaml`). The node plane and the protocol are the seam
other node implementations plug into; this document is only voice's own
node, and a node written elsewhere need not serve it.

What stays on the machine is what only the machine can decide: which
engines it offers, with which logins (the capabilities file), and local
controls that pause it or its seats. It has no in-flight cap of its
own: it serves each seat up to the seat's concurrency.
This API reads them, sets the local controls, and reports the node's
state, including when it cannot reach the coordinator.

## Boot configuration

Set at start, as flags or environment variables:

- the node's id, as created on the coordinator (`POST /admin/v1/nodes`);
- the api's address, where the node registers;
- the enrollment token the coordinator issued for this node;
- its NATS credentials (the address comes with registration);
- the data directory, where local controls are kept;
- the capabilities file, `capabilities.json` in the data directory unless
  given;
- the address this API listens on (loopback by default).

## Who may call it

This API is for the machine's own operator and tools, on loopback. A
web page in a browser on the same machine reaches loopback too, so the
node answers only a request that is plainly not a page's:

- its `Host` names the loopback authority it serves at: `127.0.0.1`,
  `localhost` or `[::1]` at its port (or the one address it listens on,
  when given one). Any other, a missing one or two, is refused (`403`):
  a name a page made resolve to this machine is never its own.
- it carries no `Origin`, and no `Sec-Fetch-Site` but `none` (a person's
  own browser, at the address they typed): a browser adds them to a
  page's request, and no tool of voice's sends them. Refused (`403`).
- a write (`PUT /node/v1/local`, and any method but `GET` and `HEAD`)
  presents the node's admin token as `Authorization: Bearer` (`401`
  without it). The node draws a new one each time it starts and keeps it
  in `admin.token` in its data directory, mode `600`, readable by the
  node's own user alone; it is never logged. Reads take no token: the
  first two guard them.

```sh
printf 'Authorization: Bearer %s\n' "$(cat node-data/admin.token)" \
  | curl -fsS -X PUT -H @- http://127.0.0.1:8081/node/v1/local \
      -d '{"paused": true, "paused_seats": [], "reason": "maintenance"}'
```

(The token is read from its file into the request's headers, never put
on a command line. The coordinator's admin plane takes its operator
token.)

## The capabilities file

Written by the node's operator, and the only configuration edited on the
machine besides local controls. Nothing is discovered: the node offers
exactly the engines listed, each with the login it runs under. It is
`Capabilities` from the protocol plus, per engine, a `local` object the
node never declares (where the login is kept, and similar). Each CLI
keeps several logins apart in its own way (docs/coding-attempts.md,
"Logins"): a `harness` engine's logins are not in this file at all, they
are tokens in the node's vault or directories under `logins/` in its
data directory, which its seats name. A file from before that declares
the node's own cap (`max_in_flight`) is read past.

```json
{
  "engines": [
    { "id": "static", "kind": "static" },
    { "id": "ollama", "kind": "openai-compatible" },
    { "id": "coding", "kind": "harness" }
  ]
}
```

A `harness` engine runs agentic coding CLIs for coding attempts, each
as a harness definition says (`HarnessConfig` in the protocol): it
needs docker on the machine, and runs each attempt in a container of
its own. One engine serves every CLI and login: each seat names its
harness and its login. `claude-cli` is the claude harness under its
older name, and an engine of it keeps working.

A `managed` engine takes the models the coordinator places on the
node (openapi.yaml `Placement`): the node fetches each one's weights
from the hub and its runtime's archive into `blobs/` in the data
directory, keeps a file only when its sha256 matches the pin, and
reports the seat `fetching` with how far. Its `local` object says where
the hub is and the vault entry its token is in, both optional:

```json
{ "id": "managed", "kind": "managed",
  "local": { "hub_url": "https://huggingface.co", "hub_token_vault": "hf-token" } }
```

The token is sent only to the hub's own origin, never to the host a
download redirects to.

The file may also hold back memory from models, which the node
otherwise offers whole: `"hardware": {"model_memory_bytes": N}`. The node
measures the rest of `hardware` itself (the platform, memory, its
accelerators and free disk under the data directory) and declares it
with the engines.

The node fills in each engine's `config_schema` and `models` from its
kind. The kinds this build runs are `static`, `harness` (coding
attempts; see `HarnessConfig` in the protocol), `claude-cli` (a seat that runs
`claude -p` under a token the vault holds; see `ClaudeCliConfig` in the
protocol) and `openai-compatible`
(a seat that proxies to a chat-completions server: its seat config names
`base_url`, `model`, an optional `api_key_vault` and a price per million
tokens, 0 for a local server; see `OpenAICompatibleConfig` in the
protocol). The `openai-compatible` kind carries tools (a request's
`tools` go upstream, its tool calls come back); `managed` does under
llama-server or TensorFold, and under vLLM when the seat's variant names a
`tool_call_parser`; `static` does only as
its `tool_call` drill and `claude-cli` and `harness` never, and a request with `tools`
is refused there so the coordinator tries another seat. When the file changes, the node declares its capabilities again,
and the coordinator re-checks the assignment against them.

## Credentials

Voice holds no provider credentials. An engine that needs a login uses
its own, on this machine, named in the engine's `local` object. It is
never declared to the coordinator and never returned by this API.

## Contents

- [node](#tag-node) (4)
- [health](#tag-health) (1)
- [Schemas](#schemas)

## Authentication

- **nodeAdmin** (http, bearer): The node's admin token, from `admin.token` in its data directory (mode 600), drawn anew each time the node starts. Writes only.

## Servers

- `http://127.0.0.1`: Placeholder; the node's listen address is set at boot.

<a id="tag-node"></a>

## node

The node's state, what it offers, and its local controls.

### GET `/node/v1/status`

**The node, its connection, and its assigned seats** · `getNodeStatus`

Authentication: none

What the node is running and how it is going, as the node sees it.
Useful when the coordinator cannot be reached; otherwise the same is
visible in the coordinator's admin UI.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The node's status. | `application/json` [NodeStatus](#schema-nodestatus) |
| 403 | Not a local tool's request; a Host other than the loopback authority the API serves at, or what a web page sends (an Origin, cross-site fetch metadata). | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/node/v1/capabilities`

**What the node offers, as loaded from its capabilities file** · `getCapabilities`

Authentication: none

The declared capabilities, without the engines' `local` objects.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The capabilities. | `application/json` [Capabilities](#schema-capabilities) |
| 403 | Not a local tool's request; a Host other than the loopback authority the API serves at, or what a web page sends (an Origin, cross-site fetch metadata). | `application/json` [ErrorResponse](#schema-errorresponse) |

### GET `/node/v1/local`

**Read the local controls** · `getLocalControls`

Authentication: none

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The local controls. | `application/json` [LocalControls](#schema-localcontrols) |
| 403 | Not a local tool's request; a Host other than the loopback authority the API serves at, or what a web page sends (an Origin, cross-site fetch metadata). | `application/json` [ErrorResponse](#schema-errorresponse) |

### PUT `/node/v1/local`

**Pause the node or seats** · `setLocalControls`

Authentication: nodeAdmin

Replaces the local controls, with the node's admin token. They only
restrict: pausing takes no new requests (in-flight ones finish). The
node tells the coordinator at once. A local cap is gone: a body that
sets `max_in_flight` to a number is refused (400) naming its removal;
`null`, as a body from before sent it, is taken and dropped.

Request body

`application/json`

Schema: [LocalControls](#schema-localcontrols)

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `paused` | boolean | yes |  |  |
| `paused_seats` | array of string | yes |  | items ≤ 32 |
| `reason` | string \| null |  | Why, for the admin to read. |  |

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | The local controls, applied. | `application/json` [LocalControls](#schema-localcontrols) |
| 400 | Malformed. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 401 | A write without the node's admin token, or with another. | `application/json` [ErrorResponse](#schema-errorresponse) |
| 403 | Not a local tool's request; a Host other than the loopback authority the API serves at, or what a web page sends (an Origin, cross-site fetch metadata). | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="tag-health"></a>

## health

Liveness, for a supervisor. No credential.

### GET `/healthz`

**Is the node process alive** · `getNodeLiveness`

Authentication: none

Answers `200` while the process serves HTTP. Whether it is registered
and on NATS is not liveness; that is in `/node/v1/status`.

Responses:

| Status | Description | Body |
|---|---|---|
| 200 | Alive. | `application/json` [Health](#schema-health) |
| 403 | Not a local tool's request; a Host other than the loopback authority the API serves at, or what a web page sends (an Origin, cross-site fetch metadata). | `application/json` [ErrorResponse](#schema-errorresponse) |

<a id="schemas"></a>

## Schemas

<a id="schema-nodestatus"></a>

### NodeStatus

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `version` | string | yes |  |  |
| `coordinator` | object | yes |  |  |
| `coordinator.url` | string | yes | The api the node registers with. |  |
| `coordinator.state` | string, one of `connecting`, `connected`, `refused` | yes | `connected`: registered, and subscribed on NATS. `refused`: the coordinator rejected the enrollment token or the node was revoked. |  |
| `coordinator.connected_at` | string \| null (date-time) |  |  |  |
| `coordinator.last_error` | string \| null |  |  |  |
| `assignment_version` | integer \| null | yes | The assignment applied, or null before the first one. |  |
| `in_flight` | integer | yes | The requests it serves now, across its seats, each at most its seat's concurrency. |  |
| `local` | [LocalControls](#schema-localcontrols) | yes |  |  |
| `seats` | array of [Seat](#schema-seat) & [SeatState](#schema-seatstate) | yes | The assigned seats, each with its state on this node. |  |

<a id="schema-health"></a>

### Health

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `status` | string, one of `ok`, `unavailable` | yes |  |  |
| `version` | string |  |  |  |
| `checks` | object |  | Each dependency's state, on readiness. |  |

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

<a id="schema-localcontrols"></a>

### LocalControls

What the node's operator set on the machine. Each field only
restricts: a paused node or seat takes no new requests. A node from
before may send a local `max_in_flight`: the coordinator reads past
it, as no cap of a node's stands.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `paused` | boolean | yes |  |  |
| `paused_seats` | array of string | yes |  | items ≤ 32 |
| `reason` | string \| null |  | Why, for the admin to read. |  |

<a id="schema-slug"></a>

### Slug

Type: string

Notes: pattern `^[a-z0-9][a-z0-9-]{0,62}$`

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
| `concurrency` | integer |  | Requests this seat serves at once. A placement's seat's is what its runtime is started with (TensorFold's `--parallel`, 32; llama-server's slots, as many requests of the context its placement promises as its prompt cache holds, one to four; vLLM's `--max-num-seqs`, 32; the decision server's 1), derived from its config, and the node holds it to that whatever this says. Any other seat's is what its operator set. | default `1`; ≥ 1 |
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

<a id="schema-seatstate"></a>

### SeatState

One assigned seat's state on the node.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | string | yes |  |  |
| `status` | string, one of `starting`, `fetching`, `up`, `down`, `disabled`, `paused`, `refused` | yes | `fetching`: a managed seat whose weights or runtime the node is fetching and verifying; `progress` says how far. `starting`, for a managed seat: its node is readying the inputs its variant's prepare step makes (`reason` says the step and how far), or its server is loading the model. `down`: the engine cannot serve, e.g. its CLI is missing or logged out, or a managed seat's file did not verify. `paused`: a local control holds it. `refused`: the seat is outside the node's capabilities, e.g. an engine it does not offer or a config its engine rejects; `reason` says which. |  |
| `reason` | string \| null |  |  |  |
| `progress` | [FetchProgress](#schema-fetchprogress) |  |  |  |
| `context` | integer |  | A managed seat's server, once it answers: the context, in tokens, it took (llama-server's `n_ctx`, vLLM's `max_model_len`). Left out until it says. | ≥ 1 |
| `in_flight` | integer | yes |  | ≥ 0 |

<a id="schema-engine"></a>

### Engine

One engine the node offers: a kind of engine with the login it runs
under. Two logins for one CLI are two engines. How the login is held
is local to the node and is never declared.

Whether a seat carries `tools` is derived from its kind and its
config, not declared: an `openai-compatible` seat does; a `managed`
seat under llama-server does, and one under vLLM when its variant
names a `tool_call_parser`, which the node starts vLLM with; a
`static` seat only with its `tool_call` drill; any other never. A `serve` whose
request lists `tools` for a seat that does not carry them is
`refused` before any event, a seat failure, so the coordinator
offers the request to the next seat.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `id` | [Slug](#schema-slug) | yes | Unique on the node; seats name it. |  |
| `kind` | string | yes | What runs: `static`, `openai-compatible`, `harness` (an agentic coding CLI, as a harness definition says, `HarnessConfig`), `claude-cli` (the claude harness under an older name, kept so configs from before keep working), or `managed`: a model the coordinator placed on the node, whose weights and runtime the node fetches and verifies itself (`ManagedConfig`). |  |
| `description` | string |  |  |  |
| `models` | array \| null |  | The engine's own names for the models it can run, when it knows them. Null when any name may be tried. |  |
| `config_schema` | object | yes | JSON Schema of the `config` a seat on this engine takes. The coordinator checks seats against it, and a UI renders it as a form. The static engine's is `StaticConfig`, the openai-compatible engine's `OpenAICompatibleConfig`, the harness engine's `HarnessConfig`, the claude-cli engine's `ClaudeCliConfig`, the managed engine's `ManagedConfig`. |  |

<a id="schema-accelerator"></a>

### Accelerator

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `kind` | string, one of `cuda`, `rocm`, `vulkan`, `metal` | yes | How it is reached: `cuda` (NVIDIA, through its driver), `rocm` (AMD, when ROCm's compute device `/dev/kfd` is there), `vulkan` (a discrete AMD or Intel GPU through its Vulkan driver), `metal` (Apple silicon). An AMD card with ROCm is listed as both `rocm` and `vulkan`. |  |
| `name` | string | yes |  |  |
| `memory_bytes` | integer | yes | Its own memory; with `unified`, the machine's, which it shares. | ≥ 0 |
| `unified` | boolean | yes | True when it shares the machine's memory (Apple silicon, NVIDIA GB10) rather than having its own. |  |
| `compute_capability` | string |  | An NVIDIA GPU's compute capability, as `nvidia-smi` says it: what a runtime's kernels must be built for (`RuntimeCreate.compute_capabilities`). Left out when the driver does not say, and for other kinds. | pattern `^[0-9]+\.[0-9]+$` |

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

<a id="schema-linkport"></a>

### LinkPort

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `ifname` | string | yes | Its network interface, by the name the machine gives it. | pattern `^[A-Za-z0-9._-]{1,15}$` |
| `address` | string | yes | Its address on the link, without a prefix length: IPv4, or its IPv6 link-local address (`fe80::/64`, without a scope), which a node reaches on the interface of its own end of the link. | pattern `^([0-9]{1,3}(\.[0-9]{1,3}){3}\|fe80:[0-9a-f:]{2,35})$` |
| `hca` | string |  | Its RDMA (RoCE) device, when it has one. | pattern `^[A-Za-z0-9._-]{1,64}$` |

<a id="schema-link"></a>

### Link

One peer this node is cabled to, and the ports that reach it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `peer` | [Slug](#schema-slug) | yes | The node at the other end. |  |
| `ports` | array of [LinkPort](#schema-linkport) | yes | The local ports cabled to the peer, the first the one the two meet on: a model's ranks start from its address. Every port's RDMA device carries the model's traffic (`NCCL_IB_HCA`), and the first port's interface the rest (`NCCL_SOCKET_IFNAME`, `GLOO_SOCKET_IFNAME`, `TP_SOCKET_IFNAME`, `UCX_NET_DEVICES`), as NVIDIA's guide to serving vLLM across two DGX Sparks sets them. A DGX Spark's one cabled QSFP port is two ports here, one for each PCIe half of its ConnectX-7. | items ≥ 1; items ≤ 4 |
| `gid_index` | integer |  | The RoCE GID index the ports' RDMA devices use (`NCCL_IB_GID_INDEX`), when NCCL's own choice is not the one the link's addresses are on: 3 for RoCE v2 over IPv4 on a DGX Spark's ConnectX-7, 1 for RoCE v2 over its IPv6 link-local address. A link the coordinator finds has the RoCE v2 GID that carries its first port's address. | ≥ 0; ≤ 255 |

<a id="schema-cabledport"></a>

### CabledPort

One port of the machine with an RDMA (RoCE) device and a carrier:
what the coordinator pairs nodes' links from (`Capabilities.ports`).
Read from the kernel (`/sys/class/net`, `/sys/class/infiniband`)
and its neighbour tables, never configured.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `ifname` | string | yes |  | pattern `^[A-Za-z0-9._-]{1,15}$` |
| `mac` | string | yes | Its hardware address. | pattern `^[0-9a-f]{2}(:[0-9a-f]{2}){5}$` |
| `speed_mbps` | integer | yes | Its link speed, in Mb/s, as the kernel says it (`speed`); 0 when it does not. | ≥ 0 |
| `mtu` | integer |  |  | ≥ 0 |
| `hca` | string |  | Its RDMA device. | pattern `^[A-Za-z0-9._-]{1,64}$` |
| `addresses` | array of string |  | Its addresses with their prefix lengths, as the machine has them: IPv4 and IPv6 link-local. Others are left out. | items ≤ 8 |
| `gids` | array of object |  | Its RDMA device's RoCE v2 GIDs, each by its index, and the address it carries. | items ≤ 8 |
| `gids[].index` | integer | yes |  | ≥ 0; ≤ 255 |
| `gids[].address` | string | yes | The GID as an address, an IPv4-mapped GID as its IPv4 address. |  |
| `neighbors` | array of string |  | The hardware addresses the node sees on the link: its neighbour tables' (IPv6 neighbour discovery after a ping to all nodes on the link, `ff02::1`, and ARP after a ping to the other end of a /30 or /31) and LLDP's, where the machine runs it. | items ≤ 16 |

<a id="schema-capabilities"></a>

### Capabilities

What the node can run, as its operator configured it on the machine.
The coordinator assigns seats only within it, and the node refuses
any seat outside it.

Type: object

| Field | Type | Required | Description | Notes |
|---|---|---|---|---|
| `engines` | array of [Engine](#schema-engine) | yes |  | items ≤ 16 |
| `max_in_flight` | integer |  | Read past: a node has no cap of its own, its capacity is its seats' `concurrency`. A node declares the most it serves at once, its slots, for a coordinator from before, which requires it; a capabilities file that still says it is read past too. | ≥ 1; deprecated |
| `hardware` | [Hardware](#schema-hardware) |  |  |  |
| `links` | array of [Link](#schema-link) |  | The direct links to other nodes its operator declared on the machine, in the node's capabilities file beside its engines (each machine's own interfaces and addresses): for each peer, the local ports cabled to it. A link declared here wins over the one the coordinator finds from `ports` for the same peer. A model is placed across two nodes only when each has a link to the other, declared or found, and their link passed its check (openapi.yaml `checkNodeLink`). | items ≤ 4 |
| `ports` | array of [CabledPort](#schema-cabledport) |  | The machine's cabled ports, as the node finds them: each network interface with an RDMA (RoCE) device and a carrier. The node looks at start and again whenever a carrier comes or goes, and reports its capabilities again when what it found changed (`reportCapabilities`). The coordinator pairs two nodes' ports by what each sees on its link (`neighbors`), and uses the link it finds as a declared one (`Link`): its first port the pair of ports that share an address family (and an IPv4 subnet), each port at the address it already has, IPv4 before IPv6 link-local, and the RoCE v2 GID that carries that address as its `gid_index`. Voice configures no host networking: a port with neither address is cabled but not addressed. | items ≤ 8 |
