# Adding a node

A node is a machine that serves models to voice: a Mac (Apple silicon,
Metal) or a Linux machine (CUDA, or none). Installing it is one command;
the models come to it afterwards, as the operator places them
([`internals.md`](./internals.md), "The node").

A habitat adds a node on a host it manages (`hale habitat organism place
voice node --host <h>`, through `[dna.host.node]` in
[`hale.toml`](../hale.toml)), and on its own machine with `--host local`:
voice on one laptop is the coordinator in the habitat's compose and the node
beside it, native, on the laptop's GPU. By hand it is the same command.

A node runs natively, never in a container: on a Mac only a native process
reaches Metal. Voice ships no node; each is added on purpose, the machine
the coordinator runs on included.

## What it needs

- On Linux, docker: voice runs a model's runtime there as a container. A
  Mac runs its runtime itself, and needs Apple silicon. (`[dna.host.node]
  requires` says so, per platform, so a habitat refuses a host that lacks
  them before installing.)
- A GPU for most models: NVIDIA on Linux (with its driver and container
  toolkit), Apple silicon on macOS. A Linux host without one is still a
  node: it serves a CPU runtime (a decision model's `decision-*-cpu`), an
  upstream or a Claude seat, and a placement is judged against the
  hardware the node declares, so nothing that needs a GPU is put on it.
- The node program for the revision the api runs. A habitat installs the
  one published for that commit (`node/install.sh`, with the revision as
  `HALE_DNA_REVISION`): on Linux, `voice-node` taken out of voice's image,
  `ghcr.io/hale-lang/voice:<commit>`; on a Mac on Apple silicon, the darwin
  build published beside it, `ghcr.io/hale-lang/voice-node:<commit>-darwin-arm64`,
  checked against its sha256 before it runs. Nothing is compiled on the
  host. Only where none is published (no revision handed, an unreleased
  commit, another platform) is it built here, from voice's source at that
  revision, with the hale toolchain at the release voice declares
  (`[dna] toolchain` in [`hale.toml`](../hale.toml)). Nothing the install
  leaves running needs hale.
- The api's URL, reachable from the machine, and the operator token. A
  habitat hands the install its own (hale.toml `[dna.secrets.operator-token]`);
  by hand, a file of it (`voice-api admin-token` on the api's host, copied
  with mode 600), named with `--operator-token-file`.
- sudo: the node runs as a system service. It runs as the account that ran
  the install, never as root.

## Install

```sh
sudo HALE_DNA_REVISION=<commit> sh node/install.sh install --id node-a --api http://192.0.2.5:8080 --operator-token-file admin.token
```

from voice's source at that commit; without `HALE_DNA_REVISION` it builds
the node here (`hale run node install …`, the same arguments).

A habitat runs the same command for you, without the token file:

```sh
hale habitat organism place voice node --host node-a
```

It:

- records the node on the api, or finds it there, and keeps its enrollment
  token in `~/.voice/vault` (mode 600); the operator token is used for that
  alone and kept nowhere;
- keeps each Claude account's token the habitat hands over in the node's
  vault as `claude-token--<account>`, and removes one no longer handed over
  (below);
- writes `~/.voice/node-data/capabilities.json`: the managed engine, which
  runs the models placed on the node, and the claude CLI when the vault holds
  a Claude account's token and the node's account has `claude` (below); and,
  on a machine it
  shares, the memory left for models (`hardware.model_memory_bytes`, never
  more than the machine's less a sixteenth kept for its system, at least
  4 GiB, which the node holds to however the file says it): in a
  habitat, the machine's less what the habitat said its own services may
  take there (`HALE_DNA_HOST_RESERVED_BYTES`), or less 8 GiB from a hale
  that does not say; outside one, less 8 GiB for the coordinator when
  `--api` is on this machine (localhost);
  the links its operator declared in the file (`links`, below) are kept as
  they are;
- copies the node program to `~/.voice/bin/voice-node`;
- installs and starts the service: a LaunchDaemon on macOS
  (`/Library/LaunchDaemons/voice-node-<id>.plist`, label `voice-node-<id>`, so a
  headless Mac serves with no one logged in; log `~/.voice/node-<id>.log`), a
  systemd unit on Linux (`voice-node-<id>.service`; `journalctl -u
  voice-node-<id>`), adding the account to the `docker` group. Stopping the
  unit (or the LaunchDaemon) signals the node, which drains: it tells the
  api it is stopping, finishes the requests its slots hold, then stops the
  model servers it started, within 15 s. Once it is gone, `voice-node
  stop-seats` (the unit's `ExecStopPost`) stops whatever of its is left,
  and anything still in the unit after 20 s is killed.

It prints no secret. Running it again changes nothing that is already right;
a node whose enrollment token is gone is given a new one. Exit codes: 0
installed, 2 a bad argument, 1 failed, with one line saying why.

### Claude accounts

A claude seat runs `claude -p` as one Claude subscription. Each
subscription's token is a long-lived `claude setup-token`, one per account,
labelled with the voice account it bills:

```sh
claude setup-token                                   # once per subscription, as that account
hale dna secret set claude-token --member work       # the token, for voice's account `work`
hale habitat organism place voice node --host node-a  # hands the node every member
```

The seat names its account's token: `{"engine": "claude", "account": "work",
"config": {"token_vault": "claude-token--work"}}`. Adding an account later
is setting another member and placing the node again. By hand, put the
token in `~/.voice/vault/claude-token--<account>` (mode 600) before
installing.

The claude CLI is the node's account's own, found where that account
installs it, in order: what its login shell finds (`command -v claude`,
given 5 s), `~/.local/bin/claude` (Claude Code's native installer),
`~/.claude/local/claude` (an older install), then the system's directories
(`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`). The install
prints the one it found, and the service's PATH (the LaunchDaemon's and the
unit's) puts its directory first, so the `claude` the node starts is that
one. With no CLI, or no token, the node offers no claude engine. Installing
the CLI later is placing the node again.

The node finds NATS where the api tells it when it registers (the api's
`--node-nats`), so the machine needs a route to that address as well as to
the api.

### Cabled to another node

Two machines cabled to each other (two DGX Sparks over their ConnectX-7
QSFP ports) can serve a model too large for either, split across the two.
Cable them, place a node on each, and the link appears on both nodes' pages:
nothing is declared or configured.

Each node finds its cabled ports itself, at start and whenever a carrier
comes or goes: every interface with an RDMA (RoCE) device and a carrier, its
hardware address, speed, addresses and RoCE v2 GIDs, and the hardware
addresses it sees on the link (its neighbour tables after a ping to every
node on the link, or to the other end of a /30, and LLDP where the machine
runs it). The coordinator pairs two nodes whose ports see each other, and
uses the ports at the addresses they have: IPv4 when both ends have it on
one subnet, else their IPv6 link-local addresses, which every port has
unless IPv6 is off on it. The GID index is the RoCE v2 GID that carries the
address (3 for IPv4 on a Spark, 1 for link-local). Voice changes no host
networking: a pair with neither address shows as cabled, not addressed.

The node's page says where its links stand: `2 ports cabled (200 Gb/s), no
peer found`; `cabled to node-b, not addressed`; `cabled to node-b · not
checked`; `cabled to node-b · link check passed 22.9 GB/s`; `degraded:
<why>`.

An operator may still declare a link in the node's capabilities file, beside
its engines, and a declared link wins over the one found for the same peer:
the other node's id, and the local ports cabled to it, each its interface,
its IPv4 or IPv6 link-local address on the link and its RDMA device; and the
RoCE GID index. A DGX Spark's one cabled port is two ports here, one per
half of its ConnectX-7:

```json
"links": [{"peer": "node-b", "gid_index": 3, "ports": [
  {"ifname": "enp1s0f0np0", "address": "198.51.100.1", "hca": "rocep1s0f0"},
  {"ifname": "enP2p1s0f0np0", "address": "203.0.113.1", "hca": "roceP2p1s0f0"}]}]
```

Once both nodes have the link and are up, check it (or press `check` on the
node's page): each runs a rank of an NCCL all-reduce over it, in the image a
model across the two would run in, and says what it measured.

```sh
curl -X POST $api/admin/v1/nodes/node-a/links/node-b/check -H @admin.h   # running
curl -sS $api/admin/v1/nodes/node-a -H @admin.h                          # links[].check: passed
```

A check whose sum is right passes; one under 10 GB/s passes `degraded`, with
the figure. Then a placement naming both nodes, the leader first, splits the
model across them (`"nodes": ["node-a", "node-b"]`): vLLM's own multi-node
executor, tensor parallel across the two GPUs, as NVIDIA's guide to serving
vLLM across two DGX Sparks runs it. The leader's seat serves it; the
follower's, of the same id, runs the other half and serves nothing itself;
the model is served while both are `up`.

## Put a model on it

Voice ships the recipe `qwen3-0.6b` (Qwen3-0.6B: safetensors for vLLM on
CUDA, GGUF for llama.cpp on Metal), so a first model is three calls: a
catalog model naming it, an account that bills nothing, and the placement.

```sh
curl -X POST $api/admin/v1/models   -H @admin.h -H "$json" -d '{"id": "qwen3-0.6b", "recipe": "qwen3-0.6b"}'
curl -X POST $api/admin/v1/accounts -H @admin.h -H "$json" -d '{"id": "local", "name": "Local"}'
curl -X POST $api/admin/v1/placements -H @admin.h -H "$json" \
  -d '{"id": "qwen-on-node-a", "model": "qwen3-0.6b", "nodes": ["node-a"], "account": "local"}'
```

On the Spark it is served by NVIDIA's vLLM (`vllm-26.09`), given the share
of the GPU's memory the model needs rather than vLLM's nine tenths; on a
Mac, by llama.cpp on Metal. A project with a key that may use the model
then asks it as any model (`POST /v1/chat/completions`).

The coordinator picks the form of the weights and the runtime that fit the
node, the node fetches and verifies them, starts the runtime in voice's
sandbox, and the seat goes `fetching`, `starting`, `up`
(`GET /admin/v1/nodes/node-a/seats/qwen-on-node-a`).

## Check it

```sh
curl -sS $api/admin/v1/nodes/node-a -H @admin.h        # up, its hardware, its engines
curl -sS http://127.0.0.1:8081/node/v1/status         # on the machine
```

The node also serves its readings at `http://<machine>:9476/metrics`, on
every interface, for a habitat's senses to scrape: its own runtime's series,
and each seat's `voice_node_seat_up`, `voice_node_seat_in_flight`,
`voice_node_seat_concurrency` (the most it serves at once) and a managed
seat's fetch bytes. They carry no secrets. A host running several
nodes gives each one its own port with `--readings-port`.

## Remove it

```sh
sudo HALE_DNA_REVISION=<commit> sh node/install.sh uninstall --id node-a --api $api --operator-token-file admin.token [--purge]
hale habitat organism unplace voice node --host node-a      # or, in a habitat
```

stops and removes the service and the model servers the node started; with
the operator token it revokes the node
on the api; with `--purge` it removes the node's data (the weights it
fetched) and its enrollment token.
