# Adding a node

A node is a machine that serves models to voice: a Mac (Apple silicon,
Metal) or a Linux machine (CUDA, or none). Installing it is one command;
the models come to it afterwards, as the operator places them
([`internals.md`](./internals.md), "The node").

A habitat adds a node on a host it manages (`hale habitat organism place
voice node --host <h>`, through `[dna.host.node]` in
[`hale.toml`](../hale.toml)). By hand it is the same command.

## What it needs

- The hale toolchain, at the release voice's pin names
  ([`Dockerfile`](../Dockerfile), `HALE_VERSION`), and voice's source at
  the revision the api runs.
- The api's URL, reachable from the machine, and the operator token in a
  file (`voice-api admin-token` on the api's host, copied with mode 600).
- sudo: the node runs as a system service. It runs as the account that ran
  the install, never as root.
- On Linux, docker (and NVIDIA's container toolkit on a CUDA machine): voice
  runs a model's runtime there as a container. The install says when docker
  is missing.

## Install

```sh
sudo hale run node install --id spark --api http://10.73.20.5:8080 --operator-token-file admin.token
```

It:

- records the node on the api, or finds it there, and keeps its enrollment
  token in `~/.voice/vault` (mode 600); the operator token is used for that
  alone and kept nowhere;
- writes `~/.voice/node-data/capabilities.json`: the managed engine, which
  runs the models placed on the node, and the claude CLI when the vault holds
  `claude-<id>-token` and `claude` is on PATH;
- copies the node program to `~/.voice/bin/voice-node`;
- installs and starts the service: a LaunchDaemon on macOS
  (`/Library/LaunchDaemons/voice-node-<id>.plist`, label `voice-node-<id>`, so a
  headless Mac serves with no one logged in; log `~/.voice/node-<id>.log`), a
  systemd unit on Linux (`voice-node-<id>.service`; `journalctl -u
  voice-node-<id>`), adding the account to the `docker` group.

It prints no secret. Running it again changes nothing that is already right;
a node whose enrollment token is gone is given a new one. Exit codes: 0
installed, 2 a bad argument, 1 failed, with one line saying why.

The node finds NATS where the api tells it when it registers (the api's
`--node-nats`), so the machine needs a route to that address as well as to
the api.

## Put a model on it

```sh
curl -X POST $api/admin/v1/placements -H @admin.h -H "$json" \
  -d '{"id": "qwen-on-spark", "model": "qwen3-8b", "nodes": ["spark"], "account": "local"}'
```

The coordinator picks the form of the weights and the runtime that fit the
node, the node fetches and verifies them, starts the runtime in voice's
sandbox, and the seat goes `fetching`, `starting`, `up`
(`GET /admin/v1/nodes/spark/seats/qwen-on-spark`).

## Check it

```sh
curl -sS $api/admin/v1/nodes/spark -H @admin.h        # up, its hardware, its engines
curl -sS http://127.0.0.1:8081/node/v1/status         # on the machine
```

## Remove it

```sh
sudo hale run node uninstall --id spark --api $api --operator-token-file admin.token [--purge]
```

stops and removes the service; with the operator token it revokes the node
on the api; with `--purge` it removes the node's data (the weights it
fetched) and its enrollment token.
