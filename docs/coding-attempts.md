# Running coding attempts

A **coding attempt** is one run of an agentic coding CLI on a repository:
voice checks out `repo` at `base` in a workspace on a node, runs the CLI
with the caller's instruction, and commits what it produced as the caller's
identity. A long task ("develop a feature, write tests for it, and get them
passing") is one attempt. The attempt ends at commits: the caller fetches
them as a git bundle, and pushing them and asking for a review are the
caller's.

Each CLI is a **CLI recipe** (a harness definition): voice ships five in
[`harnesses/`](../harnesses/README.md), `claude` (Claude Code), `codex`
(OpenAI Codex CLI), `agy` (Google Antigravity's CLI), `vibe` (Mistral
Vibe) and `pi` (the pi coding agent), and the operator adds their own
(below). The first four call their vendors' models under the vendor's
login; pi calls voice's own models, under a key voice mints for each
attempt. A recipe is data; the wrapper that runs it is the same for all of
them. A future voice-native harness is one more definition, and a DNA leg
is one more caller of the same API: neither changes the wrapper or the API.

The contract is [`spec/openapi.yaml`](../spec/openapi.yaml), tags `attempts`
and `cli-recipes` (and `HarnessDefinition`), and `HarnessConfig` in
[`spec/protocol.yaml`](../spec/protocol.yaml).

## CLI recipes

A recipe says where its CLI may run (its **backends**: a container voice
builds, or the node's own machine), its argv and permission policy, how a
login and a model reach it, and how its output is read
([`harnesses/README.md`](../harnesses/README.md) has the fields). The api
keeps every recipe in its store (`spec/store.md`, migration 43):

- **Voice's own** (`origin` `shipped`) are the files in `harnesses/`, which
  each api writes to the store as it starts. They are read-only: disable
  one, or duplicate it into one of your own and edit that.
- **The operator's** (`operator`) are made, edited (replaced whole, keeping
  their id), enabled or disabled and removed on the admin plane:
  `GET`, `POST /admin/v1/cli-recipes`; `GET`, `PUT`, `PATCH` (`{"enabled":
  false}`), `DELETE /admin/v1/cli-recipes/{id}`; `POST
  /admin/v1/cli-recipes/{id}/duplicate` (`{"id": ..., "name": ...}`).

Every recipe is checked by the same rules whichever way it came; a refusal
is 400 with the field at fault in `error.param` (`recipe.backends[1].detect.version`).
A **disabled** recipe's seats take no new attempt, say so among their
problems, and an attempt that asks for it is refused; one already running
runs on. A recipe a seat names is never removed, only disabled: point its
seats at another first. Each recipe in the list carries the seats that
name it.

## Where a CLI runs

A recipe lists its backends in order. A **seat** runs a container by
default; it runs on the host only when its config opts in, `"backend":
"host"`, and the recipe has a backend of that kind (a seat is refused one
that has none). As an attempt starts, its node runs the first backend of
that kind it can run:

- **`container`**, where the node has docker: the CLI installed on a base
  image pinned by digest, built once per node, and run in a container of
  the attempt's own behind its allow-list egress proxy ("Security", below).
- **`host`**: the CLI on the node's own machine at the recipe's pinned
  version. Its detect (an argv such as `claude --version`) finds one on the
  node's PATH, used only when the version its pattern reads is the pin;
  else its install puts that version in voice's own prefix,
  `<data>/clis/<recipe>/<version>` (`npm install --global --prefix
  $VOICE_CLI_PREFIX <package>@<pin>`, `uv tool install` with its
  directories under the prefix), once per node, kept and shared by every
  attempt of that version, and detect is asked again. An install never
  writes system-wide and never runs as another user: its argv may run no
  shell, `sudo` or `su`, and name no path outside the prefix (a check of
  the argv as written, best effort; the prefix it is handed is the
  contract). Detect and install run with no shell, a scrubbed environment
  and a time limit.

When none fits (no backend of the seat's kind, no docker for a container,
no CLI at the pin on the host and no install that puts it there), the
attempt fails `backend_unavailable`, saying what each backend found.

**A host run has no sandbox and no egress filter.** It runs as the node's
user, in the attempt's workspace, with a home and a temporary directory of
its own and none of the node's environment but its PATH (voice's prefix
first), its user, shell and language. The CLI's own permission policy is
all that bounds it: it can read and write what the node's user can and
reach any host; pi, which has no policy of its own, nothing at all. Opt a
seat in only on a machine you would let that CLI loose on.

## A node that runs attempts

A node runs attempts on a **harness engine**. Its container runs need docker
on the machine; a seat that opts in to the host needs none, only the CLI (or
what its install uses: npm, uv). Declare one in its capabilities file; one
engine serves every CLI and every login:

```json
{ "engines": [{ "id": "coding", "kind": "harness" }] }
```

A declared engine survives re-installs: `voice-node install`, which every
upgrade and re-place runs, writes its own engines (`managed`, and `claude`
when the machine has the claude CLI) afresh and keeps every other as it was,
after its own. Install never adds a harness engine itself, and a declared
engine with an id install writes (`managed`, `claude`) gives way to
install's, so name it something else ([adding a node](adding-a-node.md)).

A **harness seat** on it names the recipe it runs, the login it runs
under, and optionally the CLI's own name for its model, hosts its attempts
may reach besides the vendor's, and where it runs (`backend`, `container`
unless it opts in to `host`):

```json
{ "id": "codex-work", "engine": "coding", "account": "openai-work",
  "serves": [{ "model": "codex-default" }],
  "config": { "harness": "codex", "login": "codex-work" } }
```

A seat that runs codex on the node's own machine, with no sandbox:

```json
{ "id": "codex-host", "engine": "coding", "account": "openai-work",
  "serves": [{ "model": "codex-default" }],
  "config": { "harness": "codex", "login": "codex-work", "backend": "host" } }
```

A pi seat names no login, and its model is the voice model pi calls, a
catalog model's name:

```json
{ "id": "pi-coder", "engine": "coding", "account": "local",
  "serves": [{ "model": "pi-qwen3-coder" }],
  "config": { "harness": "pi", "model": "qwen3-coder" } }
```

The admin UI's Models screen adds one (served by: a coding CLI's login),
the same form for every CLI: the recipe says how a login of it is made
and named. A seat runs at most its `concurrency` attempts at once; a node
runs at most four in all. An older `claude-cli` engine is the claude
harness under its former name: its seats run attempts too, `token_vault`
their login, and keep answering requests as before. A seat of the claude
harness answers `/v1/responses` as the claude-cli engine does; a seat of any
other harness runs attempts alone, and is never offered a request.

## Logins

Each CLI holds its login in its own way, so each keeps several logins apart
on one node in its own way (hale-lang/voice#2). Voice never reads a login
itself: it hands it to the official binary, which talks to its vendor.

| Harness | The login | Several on one node | Set up on the node | Checked |
|---|---|---|---|---|
| `claude` | the long-lived token `claude setup-token` prints | one vault entry per account, `claude-token--<account>`, handed to the run in `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token`, its output kept in the node's vault | the token path is the claude-cli seat's, unchanged; the CLI's flags and reader run for real |
| `codex` | a ChatGPT plan's login, in `auth.json` under `CODEX_HOME` | one directory per login, `<data>/logins/<login>`; a run gets a scratch copy of `auth.json`, mounted as its `CODEX_HOME`, and codex's refresh of it is copied back | `CODEX_HOME=<data>/logins/<login> codex login --device-auth` | an empty `CODEX_HOME` is logged out while the default one is logged in: the directory is the login (`cli_auth_credentials_store="file"` keeps it off any keyring) |
| `agy` | a Google account's sign-in, `.gemini/jetski-standalone-oauth-token` under `HOME` | one directory per login, `<data>/logins/<login>`; a run gets a scratch copy of the token file, mounted at its `~/.gemini` | `HOME=<data>/logins/<login> agy`, then sign in (a headless machine prints a link and asks for the code) | a fresh `HOME` is signed out (on macOS); on Linux, from the CLI's documentation only |
| `vibe` | a Mistral API key (the one `vibe --setup` signs in for, or one from Mistral's console) | one vault entry per key, `mistral-key--<account>`, handed in `MISTRAL_API_KEY` | the key kept in the node's vault | the CLI's flags and reader run for real |
| `pi` | no vendor's login: a voice key voice mints for each attempt (`login.kind` `voice`) | one key per attempt, nothing held on the node: handed to the node in the claim's answer and to pi in `VOICE_API_KEY` | nothing | pi's image, flags, provider and reader run for real in voice's container, against an OpenAI-compatible stub behind the attempt's proxy |

pi's key is the attempt's project's: the project of the key, or of the
operator token with `Voice-Project`, that asked for the attempt. It is good
for the caller plane's inference alone (`/v1/responses`,
`/v1/chat/completions`, `/v1/models`): the attempts API, the admin plane
and the node plane refuse it, so a run cannot start or read attempts. Its
requests are charged as the key that asked for the attempt, each a turn of
the attempt's conversation (whatever session the CLI names), so they are in
the ledger under the attempt; the attempt's own record counts none of
their tokens again. It expires at the attempt's deadline and names nobody
once the attempt is done, failed or cancelled, its node is lost, or the key
that asked stops holding (revoked, or a habitat tenant's whose member is
rotated or removed from the vault). The api keeps only its digest; an attempt is started
once, so each run's key is its own. pi's model is the seat's `model` (or
the engine name its `serves` gives the model asked for), named to pi as
`--provider voice --model <name>`: pi accepts a name its provider does not
list, so any voice model is usable without a new image.

A login directory is shared by the seats that name it, but no run writes
into it except the CLI's own credential file, copied back when the CLI
refreshed it: nothing an attempt writes (settings, permission rules, MCP
servers, history) reaches the next. Two attempts at once on one login
directory each refresh their own copy, and the last one copied back wins,
so give a login directory's seat a concurrency of 1.

## The API

```sh
# ask for an attempt: answered at once, queued
curl -X POST $VOICE/v1/attempts -H "Authorization: Bearer $KEY" -d '{
  "repo": "https://forge.example.com/team/app.git", "base": "main",
  "instruction": "Add a /healthz endpoint that answers 200, with a test, and make the suite pass.",
  "harness": "claude", "budget": {"tokens": 2000000}, "deadline": "2026-11-12T06:00:00Z",
  "as": {"name": "Builder", "email": "builder@example.com"}}'
# follow it, or read it
curl -N $VOICE/v1/attempts/$ID/events -H "Authorization: Bearer $KEY"
curl $VOICE/v1/attempts/$ID -H "Authorization: Bearer $KEY"
# its commits, once it ended: in a clone holding base_sha
curl -o attempt.bundle $VOICE/v1/attempts/$ID/bundle -H "Authorization: Bearer $KEY"
git fetch attempt.bundle voice/attempt-$ID
# stop it
curl -X POST $VOICE/v1/attempts/$ID/cancel -H "Authorization: Bearer $KEY"
```

The operator's token with `Voice-Project` works as a project key does, as
Chat's requests do; `/admin/v1/attempts` lists every project's.

- `repo` is fetched by the node over https, http or git with no
  credential at all, neither the caller's nor the node's (no ssh key,
  credential helper or netrc of its user); ssh, a local path or `file://`
  is refused.
- `as` is the commits' author and committer, passed through unchanged; left
  out, `voice attempt <id>`.
- `budget.tokens` stops the attempt once the harness's own output reports
  more; pi reports none, so its budget is not enforced yet (its requests'
  tokens are in the ledger under the attempt, unindexed by conversation,
  and not summed while it runs); `deadline` (four hours by default, at most a day) fails it if it has
  not ended, queued or running.
- An attempt is never refused for capacity: it queues until a harness seat
  that can run it has room, chosen as a request's seat is (its account one
  the key may spend and not archived, data class `internal`, the harness and
  model asked for), and survives an api restart, since it is a row in the
  store.

The result is the evidence a caller cites: `state`, `branch`, `base_sha`,
`head_sha`, `summary` (the harness's final message), `usage` (as the
harness reported it; `reported: false` when it reports none, never an
invented count), `wall_ms`, and `transcript_digest`, the sha256 of the
stored transcript as `GET /v1/attempts/{id}/transcript` answers it, stable
once the attempt ended. Its usage is one record in the ledger under the
attempt's id, against the seat's account, the attempt its conversation
(`endpoint: attempt`), which the Attempts screen links to in Usage.

`done`, `failed` and `cancelled` are an attempt's end, and it never leaves
one: its evidence is final then, and the bundle is the result only after
`done`. A failed attempt names why twice: `failure`, in words, and
`failure_kind`, one of a fixed set a program maps onto its own disposition
(`over_budget`, `past_deadline`, `harness_failed`, `no_changes`,
`repo_unavailable`, `login_unavailable`, `sandbox_failed`,
`backend_unavailable`, `bundle_too_large`, `node_lost`, `key_revoked`, `internal`; the contract's
`AttemptFailureKind` says what each means).

## The run

The node asks the api for an attempt when it has a free slot
(`claimAttempt`), and reports it every couple of seconds until it ends
(`reportAttempt`); a cancel reaches it in the answer. For each attempt:

1. It fetches `base` into a bare repository voice keeps, and clones it on
   the attempt's branch, `voice/attempt-<id>`, as the workspace.
2. It picks the recipe's backend ("Where a CLI runs"). For a container, it
   builds the image once per recipe: its base image, pinned by digest, with
   the CLI installed as the recipe says. For the host, it finds the CLI at
   its pin, or installs it into voice's prefix.
3. It runs the CLI, in a container of its own (below) or on the host, the
   instruction after the recipe's short preamble, its output read as it
   comes into the transcript, its summary and its usage.
4. It commits what the harness left uncommitted, as `as`: in a container
   with no network, or, on the host, with voice's own git (no hooks, no
   fsmonitor).
5. It takes the branch's commits into the bare repository, checks they
   build on the base, and exports them as a git bundle the api holds.

## Security

- **No bypass flags.** Each CLI runs under its own permission policy:
  Claude's `acceptEdits` mode with an allow list (`git push` and web tools
  denied, the repository's own settings and MCP servers not loaded); Codex's
  `--sandbox workspace-write` with `approval_policy="never"`; agy's
  `--sandbox` with its permission allow rules (`git push` denied); Vibe's
  `accept-edits` agent with a scoped bash allow list. A definition whose
  command holds a flag that skips permissions is refused, by the api and by
  the node.
- **pi has no permission system.** pi runs its tools (read, bash, edit,
  write, grep, find, ls) directly, with no approval step and no policy to
  set: its container is its whole boundary. No host mount but the
  workspace, every capability dropped, a network of its own whose only way
  out is the allow-list proxy, no credential but its attempt's key, and
  nothing pushed. Voice passes it no flag that widens anything: it loads no
  extension but voice's provider, no project-local configuration
  (`--no-approve`) and no MCP server.
- **The container.** Only the workspace is mounted, and the login's scratch
  copy for a CLI that keeps its login in a directory; no host home, no
  docker socket, no other credential. It runs as the node's user with every
  capability dropped and `no-new-privileges`, a fresh home in memory, and a
  pid limit. Codex sandboxes its own commands with bubblewrap, which needs a
  user namespace docker's default seccomp profile refuses: its container
  runs without that profile and keeps every other bound. On a host whose
  AppArmor forbids unprivileged user namespaces, codex's sandbox cannot
  start and its attempts fail saying so.
- **Egress.** Each attempt has a docker network of its own with no route
  out. Its only way out is a proxy on that network (tinyproxy, pinned) that
  allows only the definition's vendor hosts, the common package registries
  (npm, PyPI, crates.io, the Go proxy, GitHub's release and download hosts)
  and the seat's own `egress`, tunnelled to on ports 443 and 80 (asked
  plainly on 80); the proxy matches each request's whole URL, so a port is
  allowed for its host alone. For pi, whose model calls go to voice, it also
  lets through exactly the api's host and port, as the node itself reaches
  the api (`--api`): the node hands pi that address with `/v1` in
  `VOICE_BASE_URL`. A node that reaches the api at a loopback address
  (`127.0.0.1`, `localhost`, the node's default) gives the proxy nothing it
  can reach: its pi attempts fail `sandbox_failed`, saying so; start it with
  `--api` set to the machine's host name or address. Anything else is
  refused, and a direct connection has nowhere to go. The CLIs and the usual
  toolchains read `HTTPS_PROXY`. This holds on Linux and on Docker Desktop
  alike.
- **Credentials.** A login from the vault is written by the sealed
  credential to a private file, which a shell reads into the docker client's
  environment and removes; `docker run` passes it by name, so it is never in
  an argv; pi's attempt key, from the claim's answer, goes the same way
  and the node keeps no copy. The caller hands voice no credential, and
  voice uses none of the node's to fetch the repository (git runs with an
  empty home, no credential helper and no ssh); it pushes nothing.
- **The workspace is the harness's.** Voice runs no git command of its own
  in it outside a container: the uncommitted work is committed in a
  container, and the commits are fetched out of it by voice into its own
  repository, under no configuration of the workspace's. A host run is the
  exception: its CLI already ran as the node's user, so voice commits what
  it left with git on the host, hooks and fsmonitor off.
- **The host backend.** A seat that opts in to the host gives up the
  container and the egress proxy ("Where a CLI runs"). What stays: no
  bypass flag, the CLI's own policy, its login by environment or a scratch
  copy of a login directory in the run's own home (a vault login or
  voice's key read by the run's shell from a private file, never an argv),
  a home and temporary directory of the attempt's own, none of the node's
  environment but its PATH, user and language, and everything removed when
  it ends.

## Cleanup

When an attempt ends (done, failed, cancelled, or past its deadline), its
node removes its containers, its network and its directory: the workspace,
the bare repository, the login's scratch copy and the bundle file. A host
run's process group is stopped as the run ends, and its home and temporary
directory go with the attempt's directory; the CLI installed in voice's
prefix stays, pinned and shared, and a node that starts removes an install
cut short. What
remains is the attempt's row, its transcript (the last 2000 events), and its
bundle in the api's store until the caller fetches it or a day passes. The
harness images and the egress proxy's image stay, one per definition, built
once and shared by every attempt. A node that starts removes every
container and network its attempts' label names and every directory under
its `attempts/` before it takes any; the api fails an attempt whose node
registered again or stopped reporting for ten minutes.

## Not yet

Routing a harness's own model calls through voice (`base_url_env`,
`protocol`) is used by pi, whose model calls voice serves; claude and codex
call their vendors under their logins and set neither. Injecting MCP
servers (`mcp`) is a field of the definition that nothing uses yet. pi's
output is read as plain text: its print mode writes only its final
message, so its transcript is that message, its summary that message's
last line, and its idle limit is the attempt's deadline; a reader of its
`--mode json` stream is to come, as is a budget that counts the ledger.
agy's and Vibe's subscription logins in a Linux container, and claude's
and codex's real runs in one, are checked only as far as the table above
says.
