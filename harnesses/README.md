# CLI recipes

The agentic coding CLIs voice runs for coding attempts
([docs/coding-attempts.md](../docs/coding-attempts.md)) are **CLI recipes**,
each `HarnessDefinition` in [`spec/openapi.yaml`](../spec/openapi.yaml).
These files, one per CLI, `<id>.json`, are voice's own: the api reads them at
start (`--harnesses`, this directory by default) and writes them to its store
as `shipped` recipes, read-only. The operator adds recipes of their own, and
duplicates voice's into ones they can edit, in the admin UI (Harness, CLI
recipes: a form for the common fields and backends, the whole recipe as JSON
for the rest, each refusal shown on its field) or on the admin plane
(`/admin/v1/cli-recipes`, tag `cli-recipes`); either kind can be disabled, and
a recipe a seat names is never removed. Every recipe, whichever way it came,
is held to the same rules (lib/harness): its backends as below, its command
plain arguments with no flag that skips the CLI's permissions, its login only
by environment or a per-login directory, and its model calls routed to voice
(`base_url_env`, `protocol`) exactly when its login is voice's own key
(`login.kind` `voice`). A refusal names the field at fault. The node holds the
recipe it is handed to the same rules before it runs anything.

## Backends

A recipe lists where its CLI may run, in order (`backends`):

- **`container`**: an image built once per node from a base pinned by digest
  (`base`) and one shell command that installs the CLI on it (`install`). The
  attempt runs in a container of its own, behind its allow-list egress proxy,
  as [docs/coding-attempts.md](../docs/coding-attempts.md), "Security", says.
- **`host`**: the node's own machine. `detect.command` is an argv that prints
  the CLI's version; `detect.version` is a pattern, matched against a line of
  what it prints, whose first group must be the recipe's pinned `version`. A
  CLI already on the node is used only when it is that version. `install`
  (left out to detect alone) puts that version in voice's own prefix,
  `<data>/clis/<recipe>/<version>`: the install's argv and `env` name it as
  `$VOICE_CLI_PREFIX`, voice puts the path in (no shell runs either), and it
  is handed the same variable. It runs once per node per version; the
  install is kept and shared, its `bin` first on the run's PATH. Never
  system-wide and never as another user: an argv that runs a shell, `sudo`
  or `su`, or names a path outside the prefix, or a flag such as `--user`,
  is refused. That check reads the argv as it is written and is best
  effort: a program may write where its argv does not say, so the prefix it
  is handed is the contract. Detect and install run with no shell, a scrubbed
  environment (the node's PATH, user and language; a home of the attempt's
  own) and a time limit.

A seat runs a container by default; it runs the host only when its config
opts in (`"backend": "host"`), and the node runs the first backend of the
recipe of that kind it can run: a container where it has docker, the host
where detect finds the pinned version or the install puts it there. When none
fits, the attempt fails `backend_unavailable`, saying why.

**A host run has no sandbox and no egress filter.** It runs as the node's
user, in the attempt's workspace, with a home of its own and none of the
node's environment but its PATH, user and language. The CLI's own permission
policy (its flags in `command`, never a bypass) is all that bounds it: it can
read and write what the node's user can, and reach any host. Opt a seat in
only on a machine you would let that CLI loose on.

Paths in a recipe are the container's: `/work` (the workspace), `/voice` (what
voice writes for the run, read-only, its `files` among it), `/voice/out` (what
voice reads after it), `/home/voice` (its home). A host run is handed the
attempt's own directories in their place, in its argv, its variables and its
preamble. A login directory's scratch copy is mounted where `login.mount`
says in a container, and lives at that place in the run's own home on the host.
A recipe with the older `image` is read as one container backend.

## Voice's own

| Recipe | CLI | Its policy | Its login | Its output |
|---|---|---|---|---|
| `claude` | Claude Code 2.1.283 | `acceptEdits`, an allow list, `git push` and web tools denied | a vault entry, `CLAUDE_CODE_OAUTH_TOKEN` | `claude-stream-json` |
| `codex` | Codex CLI 0.166.0 | `--sandbox workspace-write`, `approval_policy="never"` | a login directory, `CODEX_HOME` | `codex-jsonl` |
| `agy` | Antigravity CLI 1.5.6 | `--sandbox`, permission allow rules, `git push` denied | a login directory, `~/.gemini` | `agy-stream-json` |
| `vibe` | Mistral Vibe 3.0.1 | the `accept-edits` agent, a scoped bash allow list | a vault entry, `MISTRAL_API_KEY` | `vibe-streaming`, its usage from its export |
| `pi` | pi 1.5.2 | none of its own: pi runs its tools directly, so its container is its policy (the workspace its only mount, every capability dropped, the allow-list proxy its only way out, nothing pushed), and on the host nothing bounds it; no extension but voice's provider, no project-local configuration, no MCP | voice's own key, minted for each attempt, `VOICE_API_KEY` | `text` (its final message); its usage is the ledger's, a request at a time |

Each was run for real against a scratch repository with these flags, its
output read by its reader (events, summary, usage); pi against an
OpenAI-compatible stub, in voice's container behind the attempt's proxy.
pi calls voice's own models: it is installed with `--ignore-scripts`, and
loads a provider extension, `voice`, which the recipe has voice write for
the run (`files`, `/voice/voice-pi.js`) and which reads voice's address from
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

Each has a host backend after its container, its detect the CLI's own
`--version` (its pattern checked against what that prints) and its install
the vendor's published package at the pin, into voice's prefix:

| Recipe | Detect (`--version` prints) | Install |
|---|---|---|
| `claude` | `2.1.283 (Claude Code)`, read by `([0-9][0-9.]*) \(Claude Code\)` | `npm install --global --prefix $VOICE_CLI_PREFIX @anthropic-ai/claude-code@2.1.283` |
| `codex` | `codex-cli 0.166.0`, read by `codex-cli ([0-9][0-9.]*)` | `npm install --global --prefix $VOICE_CLI_PREFIX @openai/codex@0.166.0` |
| `agy` | `1.5.6`, read by `([0-9][0-9.]*)` | none: the vendor's script publishes no pinned version, so the host backend uses an agy already on the node at 1.5.6, and none else |
| `vibe` | `vibe 3.0.1`, read by `vibe ([0-9][0-9.]*)` | `uv tool install mistral-vibe==3.0.1`, its tool, its entry point and any Python uv fetches under the prefix (`UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`, `UV_PYTHON_INSTALL_DIR`) |
| `pi` | `1.5.2`, read by `([0-9][0-9.]*)` | `npm install --global --prefix $VOICE_CLI_PREFIX --ignore-scripts @earendil-works/pi-coding-agent@1.5.2` |

An npm install needs node and npm on the node's PATH, and vibe's needs uv; the
CLIs then run on the node's own toolchain (pi wants a recent node).

`base_url_env` and `protocol` route a harness's own model calls through
voice: the node hands it the api's address, as the node reaches it, with
`/v1`, and its egress lets through exactly that host and port. pi sets
them; the others call their vendors and set neither. A field nothing uses
yet: `mcp` (an MCP configuration to inject).
