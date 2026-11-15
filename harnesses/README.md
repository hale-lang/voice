# Harnesses

The agentic coding CLIs voice runs for coding attempts
([docs/coding-attempts.md](../docs/coding-attempts.md)), one file per CLI,
`<id>.json`, matching `HarnessDefinition` in
[`spec/openapi.yaml`](../spec/openapi.yaml). The api reads them at start
(`--harnesses`, this directory by default) and refuses one the rules refuse
(lib/harness): its image a base pinned by digest with one install command,
its command plain arguments with no flag that skips the CLI's permissions,
its login only by environment or a per-login directory, and its model calls
routed to voice (`base_url_env`, `protocol`) exactly when its login is
voice's own key (`login.kind` `voice`). The node holds the definition it is
handed to the same rules before it runs anything.

| Harness | CLI | Its policy | Its login | Its output |
|---|---|---|---|---|
| `claude` | Claude Code 2.1.283 | `acceptEdits`, an allow list, `git push` and web tools denied | a vault entry, `CLAUDE_CODE_OAUTH_TOKEN` | `claude-stream-json` |
| `codex` | Codex CLI 0.166.0 | `--sandbox workspace-write`, `approval_policy="never"` | a login directory, `CODEX_HOME` | `codex-jsonl` |
| `agy` | Antigravity CLI 1.5.6 | `--sandbox`, permission allow rules, `git push` denied | a login directory, `~/.gemini` | `agy-stream-json` |
| `vibe` | Mistral Vibe 3.0.1 | the `accept-edits` agent, a scoped bash allow list | a vault entry, `MISTRAL_API_KEY` | `vibe-streaming`, its usage from its export |
| `pi` | pi 1.5.2 | none of its own: pi runs its tools directly, so its container is its policy (the workspace its only mount, every capability dropped, the allow-list proxy its only way out, nothing pushed); no extension but voice's provider, no project-local configuration, no MCP | voice's own key, minted for each attempt, `VOICE_API_KEY` | `text` (its final message); its usage is the ledger's, a request at a time |

Each was run for real against a scratch repository with these flags, its
output read by its reader (events, summary, usage); pi against an
OpenAI-compatible stub, in voice's container behind the attempt's proxy.
pi calls voice's own models: its image installs pi with `--ignore-scripts`
and a provider extension, `voice`, which reads voice's address from
`VOICE_BASE_URL` (pi's `models.json` interpolates a key from the
environment but not a base URL) and the attempt's key from
`VOICE_API_KEY`; the model is named by `--model`, a name pi need not list.
Its telemetry, version check and network refreshes are off, its session in
memory. Inside voice's
container, codex's own sandbox was checked to start; the CLIs' logins in a
container are checked as far as docs/coding-attempts.md, "Logins", says.
agy's install is the vendor's
script, which publishes no pinned version: its image is built once per node
and kept.

`base_url_env` and `protocol` route a harness's own model calls through
voice: the node hands it the api's address, as the node reaches it, with
`/v1`, and its egress lets through exactly that host and port. pi sets
them; the others call their vendors and set neither. A field nothing uses
yet: `mcp` (an MCP configuration to inject).
