# One Mac serving models to a habitat

A Mac is not a host the habitat applies compose to. It joins as a voice
node, running natively under launchd from a toolchain built at the commit
in `hale.pin`, and serves its seats to voice's api on a
Linux host over the network. Its seats are what the Mac actually has: each
model a local Ollama holds, and the `claude` CLI (`claude-cli`) when it is
logged in. CI's `node (macOS)` job builds and tests the node on
`macos-14` with the same pinned toolchain, so the steps below start from a node
known to build and run there. See [internals.md](./internals.md) for the node itself.

## 1. The toolchain

The node is built from source with a toolchain built at the commit in
`hale.pin` (voice uses hale features that are merged and not yet released);
there is no prebuilt node binary. Apple silicon only; Xcode's command line
tools (`xcode-select --install`) supply the C compiler, Homebrew supplies
Rust and LLVM 18 for the build.

```sh
git clone https://github.com/hale-lang/voice && cd voice
brew install rustup llvm@18 zstd && rustup-init -y     # once
scripts/build-hale.sh                  # hale at the pin, with its dylibs, into ~/.hale/bin
export PATH="$HOME/.hale/bin:$PATH"    # and in ~/.zshrc
hale --version
```

To use a released toolchain instead, download its `aarch64-apple-darwin`
tarball from hale's releases, check its `.sha256`, and untar it into
`~/.hale/bin` (hale loads the `*.dylib` files from its own directory); a
release lacks hale features newer than itself, so a node may not build with it.

## 2. Build the node

```sh
hale build node                         # writes node/node
node/node                               # no --id: prints the usage and exits 2
```

## 3. The claude login (optional)

The `claude-cli` seat runs under a token the node holds in its vault: a
directory, one file per entry, mode 600 (`~/.voice/vault`). If `claude` is on
PATH, give the node its login before installing; without it the seat is not
offered.

```sh
mkdir -p -m 700 ~/.voice/vault
claude setup-token                      # prints a long-lived OAuth token
printf '%s' 'PASTE-THE-TOKEN' > ~/.voice/vault/claude-mac-token   # claude-<node id>-token
chmod 600 ~/.voice/vault/*
```

The token reaches the `claude` child only through its environment, and the
child runs with no tools, no MCP servers and no settings.

## 4. Install the node

With the api reachable (the admin API is open to the network the api listens
on, or pass `--admin-key`), one command finds the seats, records them on the
api and installs the launchd user agent:

```sh
node/node install --id mac --api https://voice.example.net
```

It:

- offers a seat for **each local Ollama model** (`ollama list`; `ollama` must be
  on PATH, and pull the models first: `ollama pull llama3.2`), and a seat for
  the **claude CLI** when `claude` is on PATH and the vault holds
  `claude-<id>-token`; with neither present, a **static** seat is the fallback;
- writes `~/.voice/node-data/capabilities.json` for exactly those engines;
- records on the api: the node (its enrollment token goes into the vault as
  `node-<id>-enrollment`, mode 600), a **local account** `local-<id>` that
  bills nothing, each model with **no price**, each seat under that account,
  and a **default project** `local-<id>` holding those models, with a key;
- prints the key **once** (`key     vk-...`): callers present it as a bearer.
  Installing again records nothing twice and does not show it again;
- writes `~/Library/LaunchAgents/net.hale-lang.voice-node.<id>.plist` and loads
  it (`launchctl bootstrap gui/$(id -u)`); the node's log is
  `~/Library/Logs/voice-node-<id>.log`.

Flags: `--port` (the node's local API, 8081), `--data`, `--vault`,
`--node-bin` (default: the running binary), `--admin-key`, `--no-start`
(write everything, load nothing).

The node serves requests that reach it over NATS, so the Mac needs a route to
the habitat's broker as well as to the api. A launch agent runs while the user
is logged in; the Mac must not sleep (`caffeinate` or Energy settings) for the
node to stay in service.

```sh
launchctl print gui/$(id -u)/net.hale-lang.voice-node.mac | grep state
tail -f ~/Library/Logs/voice-node-mac.log
curl -sS http://127.0.0.1:8081/node/v1/status
```

## 5. Check it from the api

```sh
curl -sS https://voice.example.net/admin/v1/nodes/mac -H "Authorization: Bearer $ADMIN_KEY"
curl -sS https://voice.example.net/v1/responses -H "Authorization: Bearer vk-..." \
  -H 'Content-Type: application/json' -d '{"model": "llama3.2:latest", "input": "hi"}'
```

The node's state, its declared engines and each seat's reported state show
on the first; the second reaches the Mac's Ollama seat from the Linux host.
A seat that names a missing vault entry reports `refused`, not `up`.

## 6. Remove it

```sh
node/node uninstall --id mac
```

stops the agent and removes the plist. The node's data, its vault and its
rows on the api stay; revoke the node on the api (`DELETE /admin/v1/nodes/mac`)
to retire it.

## By hand

The agent is only the node under launchd: `node --id mac --api URL
--token-vault node-mac-enrollment --data DIR --capabilities FILE --port 8081`
runs it in a terminal, and
[`deploy/node/capabilities.mac.json`](../deploy/node/capabilities.mac.json)
is a capabilities file for both engines (a test loads it against the node's
own check). Seats are then created on the api by hand, with configs
`{"base_url": "http://127.0.0.1:11434/v1", "model": "llama3.2"}` for Ollama
and `{"token_vault": "claude-mac-token"}` for `claude`.
