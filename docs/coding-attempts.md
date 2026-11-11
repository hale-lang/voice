# Running coding attempts

A **coding attempt** is one run of an agentic coding CLI on a repository:
voice checks out `repo` at `base` in a workspace on a node, runs the CLI
with the caller's instruction, and commits what it produced as the caller's
identity. A long task ("develop a feature, write tests for it, and get them
passing") is one attempt. The attempt ends at commits: the caller fetches
them as a git bundle, and pushing them and asking for a review are the
caller's.

Voice runs four CLIs, each a **harness definition** in
[`harnesses/`](../harnesses/README.md): `claude` (Claude Code), `codex`
(OpenAI Codex CLI), `agy` (Google Antigravity's CLI) and `vibe` (Mistral
Vibe). A harness is data; the wrapper that runs it is the same for all of
them. A future voice-native harness is one more definition, and a DNA leg
is one more caller of the same API: neither changes the wrapper or the API.

The contract is [`spec/openapi.yaml`](../spec/openapi.yaml), tag `attempts`
(and `HarnessDefinition`), and `HarnessConfig` in
[`spec/protocol.yaml`](../spec/protocol.yaml).

## A node that runs attempts

A node runs attempts on a **harness engine**, which needs docker on the
machine. Declare one in its capabilities file; one engine serves every CLI
and every login:

```json
{ "engines": [{ "id": "coding", "kind": "harness" }] }
```

A **harness seat** on it names the definition it runs, the login it runs
under, and optionally the CLI's own name for its model and hosts its
attempts may reach besides the vendor's:

```json
{ "id": "codex-work", "engine": "coding", "account": "openai-work",
  "serves": [{ "model": "codex-default" }],
  "config": { "harness": "codex", "login": "codex-work" } }
```

The admin UI's Models screen adds one (served by: a coding CLI's login),
the same form for every CLI: the definition says how a login of it is made
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
  more; `deadline` (four hours by default, at most a day) fails it if it has
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
`bundle_too_large`, `node_lost`, `key_revoked`, `internal`; the contract's
`AttemptFailureKind` says what each means).

## The run

The node asks the api for an attempt when it has a free slot
(`claimAttempt`), and reports it every couple of seconds until it ends
(`reportAttempt`); a cancel reaches it in the answer. For each attempt:

1. It fetches `base` into a bare repository voice keeps, and clones it on
   the attempt's branch, `voice/attempt-<id>`, as the workspace.
2. It builds the harness's image once per definition: its base image,
   pinned by digest, with the CLI installed as the definition says.
3. It runs the harness in a container of its own (below), the instruction
   after the definition's short preamble, its output read as it comes into
   the transcript, its summary and its usage.
4. It commits what the harness left uncommitted, as `as`, in a container
   with no network.
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
  and the seat's own `egress`, on ports 443 and 80; anything else is
  refused, and a direct connection has nowhere to go. The CLIs and the usual
  toolchains read `HTTPS_PROXY`. This holds on Linux and on Docker Desktop
  alike.
- **Credentials.** A login from the vault is written by the sealed
  credential to a private file, which a shell reads into the docker client's
  environment and removes; `docker run` passes it by name, so it is never in
  an argv. The caller hands voice no credential, and voice uses none of the node's
  to fetch the repository (git runs with an empty home, no credential
  helper and no ssh); it pushes nothing.
- **The workspace is the harness's.** Voice runs no git command of its own
  in it outside a container: the uncommitted work is committed in a
  container, and the commits are fetched out of it by voice into its own
  repository, under no configuration of the workspace's.

## Cleanup

When an attempt ends (done, failed, cancelled, or past its deadline), its
node removes its containers, its network and its directory: the workspace,
the bare repository, the login's scratch copy and the bundle file. What
remains is the attempt's row, its transcript (the last 2000 events), and its
bundle in the api's store until the caller fetches it or a day passes. The
harness images and the egress proxy's image stay, one per definition, built
once and shared by every attempt. A node that starts removes every
container and network its attempts' label names and every directory under
its `attempts/` before it takes any; the api fails an attempt whose node
registered again or stopped reporting for ten minutes.

## Not yet

Routing a harness's own model calls through voice (`base_url_env`,
`protocol`) and injecting MCP servers (`mcp`) are fields of the definition
that nothing uses yet. agy's and Vibe's subscription logins in a Linux
container, and claude's and codex's real runs in one, are checked only as
far as the table above says.
