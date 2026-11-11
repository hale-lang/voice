# Harnesses

The agentic coding CLIs voice runs for coding attempts
([docs/coding-attempts.md](../docs/coding-attempts.md)), one file per CLI,
`<id>.json`, matching `HarnessDefinition` in
[`spec/openapi.yaml`](../spec/openapi.yaml). The api reads them at start
(`--harnesses`, this directory by default) and refuses one the rules refuse
(lib/harness): its image a base pinned by digest with one install command,
its command plain arguments with no flag that skips the CLI's permissions,
its login only by environment or a per-login directory. The node holds the
definition it is handed to the same rules before it runs anything.

| Harness | CLI | Its policy | Its login | Its output |
|---|---|---|---|---|
| `claude` | Claude Code 2.1.283 | `acceptEdits`, an allow list, `git push` and web tools denied | a vault entry, `CLAUDE_CODE_OAUTH_TOKEN` | `claude-stream-json` |
| `codex` | Codex CLI 0.166.0 | `--sandbox workspace-write`, `approval_policy="never"` | a login directory, `CODEX_HOME` | `codex-jsonl` |
| `agy` | Antigravity CLI 1.5.6 | `--sandbox`, permission allow rules, `git push` denied | a login directory, `~/.gemini` | `agy-stream-json` |
| `vibe` | Mistral Vibe 3.0.1 | the `accept-edits` agent, a scoped bash allow list | a vault entry, `MISTRAL_API_KEY` | `vibe-streaming`, its usage from its export |

Each was run for real against a scratch repository with these flags, its
output read by its reader (events, summary, usage). Inside voice's
container, codex's own sandbox was checked to start; the CLIs' logins in a
container are checked as far as docs/coding-attempts.md, "Logins", says.
agy's install is the vendor's
script, which publishes no pinned version: its image is built once per node
and kept.

Fields nothing uses yet: `base_url_env` and `protocol` (routing a harness's
own model calls through voice) and `mcp` (an MCP configuration to inject).
