# Direction

Voice is one inference endpoint over local hosts and hosted providers. A
caller names a model and presents a project key. Voice decides which host
serves it, enforces the project's limits and budget, and records what the
request used. The full design is in
[hale-lang/voice#1](https://github.com/hale-lang/voice/issues/1). This file
records the direction settled so far. It is the first thing in the repository
because the contract comes before the code.

## The contract

The API is specified in [`openapi.yaml`](./openapi.yaml). It is the source of
truth; code conforms to it.

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
- **Responses report what actually served them.** Model, quantization, host,
  tokens, price and timing come back on every response and every usage record.
  Hale's DNA accounts from those records.
- **Callers never name a host.** The coordinator proxies and never redirects.

## Phases

The API stays the same through every phase. Only what stands behind it
changes.

1. **MVP.** Every request gets a fixed response. This proves keys, projects,
   limits, budgets, usage records and streaming end to end without a model.
2. **v1.** A worker node wraps `claude -p` as the first real backend. Its
   default catalog is Haiku, Sonnet, Opus and Fable. It is a starting point,
   not a design constraint.
3. **Later.** Local engines (llama.cpp server, MLX, vLLM) join as hosts, with
   routing by memory fit, load and weights on disk.

The first useful version is the one that lets its operator route their own
tooling through voice and see how many tokens each project uses.

## Open questions

- **Anthropic Messages.** Claude Code and the Anthropic SDKs speak the
  Messages format. Routing them through voice needs a Messages endpoint beside
  Open Responses.
- **Default data class.** Requests default to `internal`. A host that
  forwards to a hosted provider must be allowed to carry `internal`, or the
  default must change.
- **Caller-defined tools.** A backend that cannot return tool calls should
  refuse caller tools with a clear error.
- **License.** Not chosen yet.
- The open questions in issue #1 on residency, coordinator placement and
  fair-share limits still stand.
