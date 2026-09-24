# Direction

Voice is one inference endpoint over local engines and hosted providers. A
caller names a model and presents a project key. Voice decides which seat
serves it, enforces the project's limits and budget, and records what the
request used. The full design is in
[hale-lang/voice#1](https://github.com/hale-lang/voice/issues/1). This file
records the direction settled so far. It is the first thing in the repository
because the contract comes before the code.

## The contract

The API is specified in [`openapi.yaml`](./openapi.yaml) (the coordinator) and
[`node.yaml`](./node.yaml) (a node), and the connection between them in
[`protocol.yaml`](./protocol.yaml) (AsyncAPI). They are the source of truth;
code conforms to them.

- **The caller API is an open standard.** The core endpoint is
  [Open Responses](https://www.openresponses.org/specification), version
  `2026-04-24`. Its shapes are taken by reference from the upstream document,
  vendored in `spec/vendor/open-responses/`.
- **Voice extends the standard only in the ways it allows.** Extra fields live
  in one optional `voice` object. New stream events carry the `voice:` prefix.
  Caller tags use the standard `metadata` field, which voice stores untouched.
- **Chat Completions is a compatibility surface.** It exists so clients that
  speak only the older format work unchanged.
- **Every request belongs to one project and one key.** Tokens and spend are
  tracked per project and broken down per key. A project's budget is a hard
  cap on spend per period.
- **Responses report what actually served them.** Model, quantization, node,
  seat, account, tokens, price and timing come back on every response and every usage record.
  Hale's DNA accounts from those records.
- **Callers never name a node.** They may name the account that pays, for
  when billing depends on it. The coordinator proxies and never redirects.

## Configuration

Nothing is discovered. Everything that serves is configured by an operator,
and the API is the first-class way to do it; the UI is one client of it.

- **A node** is one machine running voice's node software. An operator
  creates it on the coordinator, which issues an enrollment token, and starts
  the node with that token and the coordinator's address. The node dials out
  over a WebSocket and serves requests over that same connection, so a node
  behind NAT needs no open port.
- **A seat** is one engine on one node: the static engine, or a CLI logged
  in to one account. Seats are configured on the node, through the node's
  API, because the engines and their logins live there. The node declares its
  seats to the coordinator.
- **An account** is what pays and what has limits. Several seats may spend
  one account (the same login on two machines) and share its limits. Voice
  never holds the credential; the engine does, on its node.
- **The catalog** of models is configured on the coordinator. Seats refer to
  its ids, so one model routes across every seat that serves it.
- **Projects and keys** name the accounts they may spend. A request may name
  one account; it is then served on that account or refused, never moved to
  another. A key for client work names the work account, so everything it
  sends is billed there.

Only what a process needs before its API answers is set at boot: addresses,
the data directory, tokens.

Admin authentication is middleware in front of the admin APIs, not part of
them. The MVP runs without it, on loopback; OIDC drops in later with no change
to the endpoints. Project keys and nodes' enrollment tokens are enforced from
the start, because the MVP exists to prove them.

## Process model

The coordinator is two roles. **Api** instances serve callers, the admin
plane and nodes' connections; they hold no state of their own and scale out.
One **brain** turns the fleet's reported state into a route table in
Postgres, and api instances claim slots from it atomically. Postgres holds
all shared state: configuration, the route table, counters and the ledger.

The MVP runs the brain inside a single api process. The brain reaches the
rest only through Postgres, so moving it into its own process later changes
packaging, not design.

Requests move between the pieces as Hale bus topics, keyed by node and by
request. There is no message broker: with more than one api instance those
topics are bound to NATS, which is a binding on `main`, not new code. State
never travels as events; it stays in Postgres. The [README](./README.md) documents the architecture.

## Phases

The API stays the same through every phase. Only what stands behind it
changes.

1. **MVP.** One coordinator and one node on one machine. The node runs a
   static seat that answers every request with its configured text. Every
   piece is set up through the APIs: a model, an account, the node, its seat,
   a project and a key. This proves configuration, routing, keys, projects,
   limits, budgets, usage records and streaming end to end without a model.
2. **v1.** Seats wrap the operator's own agent CLIs, several accounts at
   once: `claude -p` on each Claude account, `codex exec`, and others. They
   report the usage and quota windows the CLIs return, so usage across every
   account is visible in one place. The CLIs are a starting point, not a
   design constraint.
3. **Later.** Local engines (llama.cpp server, MLX, vLLM) join as seats, with
   routing by memory fit, load and weights on disk.

The first useful version is the one that lets its operator route their own
tooling through voice and see how many tokens each project uses.

## Open questions

- **Anthropic Messages.** Claude Code and the Anthropic SDKs speak the
  Messages format. Routing them through voice needs a Messages endpoint beside
  Open Responses.
- **Default data class.** Requests default to `internal`. A seat that
  forwards to a hosted provider must be allowed to carry `internal`, or the
  default must change.
- **Configuring a node through the coordinator.** The UI talks to the
  coordinator. Relaying seat changes to nodes is convenient, but lets the
  coordinator write configuration onto machines. Nodes' own APIs come first.
- **Caller-defined tools.** A backend that cannot return tool calls should
  refuse caller tools with a clear error.
- **License.** Not chosen yet.
- The open questions in issue #1 on residency, coordinator placement and
  fair-share limits still stand.
