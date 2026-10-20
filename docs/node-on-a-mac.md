# One Mac serving models to a habitat

A Mac runs a voice node from the released `aarch64-apple-darwin` toolchain,
enrolls against an api it reaches over the network, and offers two
engines: a local Ollama (`openai-compatible`) and the `claude` CLI
(`claude-cli`). CI's `node (macOS)` job builds and tests the node on
`macos-14` with the same toolchain, so the steps below start from a node
known to build and run there. See [internals.md](./internals.md) for the node itself.

## 1. The toolchain

The node is built from source with the released toolchain; there is no
prebuilt node binary. Apple silicon only; Xcode's command line tools
(`xcode-select --install`) supply the C compiler.

```sh
v=v0.27.0
name=hale-$v-aarch64-apple-darwin.tar.gz
base=https://github.com/hale-lang/hale/releases/download/$v
mkdir -p ~/.hale/bin && cd "$(mktemp -d)"
curl -fsSLO $base/$name && curl -fsSLO $base/$name.sha256
shasum -a 256 -c $name.sha256          # must say OK
tar xzf $name -C ~/.hale/bin
export PATH="$HOME/.hale/bin:$PATH"    # and in ~/.zshrc
hale --version
```

## 2. Build the node

```sh
git clone https://github.com/hale-lang/voice && cd voice
hale build node                         # writes node/node
node/node                               # no --id: prints the usage and exits 2
```

## 3. The capabilities file

[`deploy/node/capabilities.mac.json`](../deploy/node/capabilities.mac.json)
declares the two engines, `ollama` (`openai-compatible`) and `claude`
(`claude-cli`), and a cap of two requests in flight. Copy it and edit the
cap. A test loads it against the node's own check, so it stays valid.

The file names engines; where each one points is a seat's config, set on
the api when the seat is created (step 5):

- `ollama`: `{"base_url": "http://127.0.0.1:11434/v1", "model": "llama3.2"}`
  (pull the model first: `ollama pull llama3.2`). A hosted server also
  takes `"api_key_vault": "<entry>"`.
- `claude`: `{"token_vault": "claude-mac-token"}`, optionally `"model"`.

## 4. The secrets

The vault is a directory, one file per entry, mode 600 (`HALE_VAULT_DIR`,
else `~/.cache/hale/vault`). Pin it so the node under launchd reads the
same one:

```sh
export HALE_VAULT_DIR="$HOME/.voice/vault"
mkdir -p -m 700 "$HALE_VAULT_DIR"

claude setup-token                      # prints a long-lived OAuth token
printf '%s' 'PASTE-THE-TOKEN' > "$HALE_VAULT_DIR/claude-mac-token"
printf '%s' 'vn-...' > "$HALE_VAULT_DIR/node-mac-enrollment"
chmod 600 "$HALE_VAULT_DIR"/*
```

`hale dna secret set <NAME>` fills the same directory when the Mac also
runs an organism. The token reaches the `claude` child only through its
environment, and the child runs with no tools, no MCP servers and no
settings.

## 5. Enroll against the api

On the api (an admin key), create the node and read its enrollment token
from the answer; then give it seats (`.../nodes/mac/seats`) with the
configs above:

```sh
curl -sS -X POST https://voice.example.net/admin/v1/nodes \
  -H "Authorization: Bearer $ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"id": "mac"}'
```

Run the node by hand once, with `--api` the api's URL:

```sh
HALE_VAULT_DIR=$HOME/.voice/vault node/node --id mac \
  --api https://voice.example.net --token-vault node-mac-enrollment \
  --data $HOME/.voice/node-data \
  --capabilities deploy/node/capabilities.mac.json --port 8081
curl -sS http://127.0.0.1:8081/node/v1/status
```

The node serves requests that reach it over NATS, so the Mac needs a route
to the habitat's broker as well as to the api.

## 6. Run it under launchd

`~/Library/LaunchAgents/net.example.voice-node.plist` (edit the paths; the
user name and `/Users/me` are placeholders):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>net.example.voice-node</string>
  <key>ProgramArguments</key><array>
    <string>/Users/me/voice/node/node</string>
    <string>--id</string><string>mac</string>
    <string>--api</string><string>https://voice.example.net</string>
    <string>--token-vault</string><string>node-mac-enrollment</string>
    <string>--data</string><string>/Users/me/.voice/node-data</string>
    <string>--capabilities</string><string>/Users/me/voice/deploy/node/capabilities.mac.json</string>
    <string>--port</string><string>8081</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>HALE_VAULT_DIR</key><string>/Users/me/.voice/vault</string>
    <key>PATH</key><string>/Users/me/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/Users/me/.voice/node.log</string>
</dict></plist>
```

`PATH` must reach the `claude` binary. Then:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/net.example.voice-node.plist
launchctl print gui/$(id -u)/net.example.voice-node | grep state
tail -f ~/.voice/node.log
```

A launch agent runs while the user is logged in; the Mac must not sleep
(`caffeinate` or Energy settings) for the node to stay in service.

## 7. Check it from the api

```sh
curl -sS https://voice.example.net/admin/v1/nodes/mac -H "Authorization: Bearer $ADMIN_KEY"
```

The node's state, its declared engines and each seat's reported state show
there; a seat that names a missing vault entry reports `refused`, not `up`.
