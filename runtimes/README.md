# Runtimes

The runtimes voice ships: what serves a local model on a node, one file per
runtime, `<id>.json`, matching `RuntimeCreate` in
[`spec/openapi.yaml`](../spec/openapi.yaml). Each names a server program
the node knows how to start (`vllm`, `llama-server`), the formats it reads,
the accelerator and platforms it runs on, and one artifact pinned by its
digest: a container image by `sha256:` digest, never a tag, or a tarball by
URL and sha256. A runtime names no command.

| Runtime | Serves | On | Artifact |
|---|---|---|---|
| `vllm-26.09` | safetensors | CUDA, linux arm64 and x86_64 | `nvcr.io/nvidia/vllm:26.09-py3` |
| `tensorfold-0.7.5` | exl3, DeepSeek-V4.1-Flash across two nodes | CUDA (DGX Spark, sm_121), linux arm64 | `nvcr.io/nvidia/pytorch:26.07-py3` and voice's engine archive, built by [`tensorfold/build.sh`](tensorfold/build.sh) |
| `llama-server-b11913-cuda` | gguf | CUDA, linux arm64 and x86_64 | `ghcr.io/ggml-org/llama.cpp:server-cuda-b11913` |
| `llama-server-b11913-rocm` | gguf | ROCm (AMD), linux x86_64 | `ghcr.io/ggml-org/llama.cpp:server-rocm-b11913` |
| `llama-server-b11913-vulkan` | gguf | Vulkan (AMD, Intel), linux arm64 and x86_64 | `ghcr.io/ggml-org/llama.cpp:server-vulkan-b11913` |
| `llama-server-b11913-metal` | gguf | Metal, macOS arm64 | llama.cpp's b11913 release for macOS arm64 |
| `decision-0.3.0-mlx` | mlx, decision models only | Metal, macOS arm64 | voice's own archive, built by [`decision-mlx/build.sh`](decision-mlx/build.sh) |
| `decision-0.1.2-metal` | gguf, decision models only | Metal, macOS 14+ arm64 | voice's own archive: `voice-decide` and `jev-score-v2`, built by [`decision/build.sh`](decision/build.sh) |
| `decision-0.1.2-cpu` | gguf, decision models only | CPU, linux arm64 and x86_64 | `ghcr.io/hale-lang/voice-decision:cpu-0.1.2` |
| `decision-0.1.2-vulkan` | gguf, decision models only | Vulkan (AMD, Intel), linux arm64 and x86_64 | `ghcr.io/hale-lang/voice-decision:vulkan-0.1.2` |
| `decision-0.1.2-rocm` | gguf, decision models only | ROCm (AMD), linux x86_64 | `ghcr.io/hale-lang/voice-decision:rocm-0.1.2` |
| `decision-0.1.2-cuda` | gguf, decision models only | CUDA, linux arm64 and x86_64 | `ghcr.io/hale-lang/voice-decision:cuda-0.1.2` |

`vllm-26.09` spans two nodes (`multi_node: mp`): a model too large for one
machine is placed across two cabled to each other, and each runs a rank of
vLLM's own multi-node executor (`--nnodes 2`, the follower `--headless`) in
this image, as NVIDIA's guide to serving vLLM across two DGX Sparks runs it,
with no Ray cluster. The field says how voice runs the same build; it added
no flag to a seat on one node, which runs as it did.

`vllm-26.09` reads a model's weights with fastsafetensors
(`load_format: fastsafetensors`): the node starts every seat of it with
`--load-format fastsafetensors`, on one node and on each rank across two,
each of which loads its shard. It is voice's choice, not a setting: the
field says what the image ships (NVIDIA's 26.09 image, vLLM 0.29.0, has the
`fastsafetensors` package), so it sits on the runtime rather than in the
node, and a vLLM runtime whose image lacks the package leaves it out and
starts with vLLM's default. vLLM's default maps the files lazily and reads
them a page at a time as the weights are copied to the GPU, which on a large
model is most of a start. Measured on a DGX Spark (GB10, 128 GiB unified
memory, local NVMe, ext4) with gpt-oss-120b (mxfp4, 65 GB) in this image,
`--gpu-memory-utilization 0.75 --max-model-len 8192`, the page cache
evicted before each start:

| Loader | Loading weights took | Ready | Peak host memory used | Greedy output |
|---|---|---|---|---|
| vLLM's default (lazy mmap) | 375.97 s | 468 s | 102 GiB | `" Paris.\n\nGreat! If you have"` |
| vLLM's default, started again with the warm caches (`cache/<runtime>/`) | 404.76 s | 494 s; init engine 46.15 → 17.96 s, compilation 9.37 → 1.05 s | 106 GiB | the same |
| `--safetensors-load-strategy eager` | 36.68 s | 127 s | 102 GiB | the same |
| `--load-format fastsafetensors` | 6.82 s | 96 s | 103 GiB | the same |

Fastsafetensors loads 55 times faster at that size, with no more memory and
the same output; on Qwen3-0.6B (1.5 GB) it took 0.36–0.42 s against the
default's 8.3–8.75 s and eager's 1.63–1.68 s. The warm caches save their 28 s
of a restart's initialization whatever the loader.

The operator is the authority on what may run: they allow more runtimes on
the admin plane (`POST /admin/v1/runtimes`). These are read by the api at
start (`--runtimes`), listed as `shipped`, and cannot be changed or removed
through the API. A shipped runtime never changes either: another build is
another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when it
reads it.

## `tensorfold-0.7.5`

DeepSeek-V4.1-Flash on [TensorFold](https://github.com/ashhart/TensorFold)'s
native engine, its `dsv41` family, tensor parallel across two DGX Sparks:
the engine of
[bertholomus/deepseek-v4.1-tensorfold-tp2-2xgb10](https://github.com/bertholomus/deepseek-v4.1-tensorfold-tp2-2xgb10)
v0.7.5 (`bertholomus/TensorFold@e100ee8b`, branch `deepseek-v41-zig-tp2`),
served as that recipe serves it. It is `server: tensorfold`,
`multi_node: lanes` (rank 0 `tensorfold-native serve`, rank 1
`tf-dsv41-lanes`), and runs only across two nodes. It reads `exl3` alone,
from a variant that brings the Engram tables and the kernel kit as file sets
and names its prepare step (`recipes/deepseek-v4.1-flash-1017.json`).

Its kernels are built for the GB10 alone (`sm_121`, with no PTX to fall
back on), so it names that GPU's compute capability
(`compute_capabilities: ["12.1"]`): a placement chooses it only for nodes
whose GPU declares it, and a node whose GPU does not refuses to start it.

Its artifact is two pins: NVIDIA's PyTorch 26.07 image by digest, which the
recipe builds and runs in, and the engine built from source apart from it
(`artifact.archive`), which the node fetches, checks and mounts read-only at
`/engine`. The
[`runtime: tensorfold`](../.github/workflows/runtime-tensorfold.yml)
workflow builds the archive in that image on an arm64 runner (no GPU is
needed to compile it; `zig build test` runs the engine's host-side tests)
and, run by hand, publishes it once as the release
`runtime-tensorfold-<version>`. No image is published, and the archive holds
nothing of NVIDIA's: its programs link only the C library and load CUDA at
run time. It holds the engine's programs, the RDMA ring's kernels, the
grammar library for structured output and forced tool calls (built from
xgrammar v0.2.8's source rather than taken prebuilt from the kit), the
engine's input tools and the recipe's `serving_1017.py` and chat template.
The kit's own kernels are the variant's, fetched as pinned data.

Two patches of voice's are applied ([`tensorfold/patches`](tensorfold/patches)):
the RDMA ring opens the GID index the link declares (`TF_RDMA_GID_INDEX`;
the engine line hard-wired 5, and the Sparks measured below have their RoCE v2
address at 3), and rank 1 waits for rank 0 as long as its seat is assigned
(`TF_TP_CONNECT_SECONDS`; it gave up after 300 s), since each node starts its
rank when its own inputs are ready. Unset, each behaves as before.

Measured on node-a and node-b (DGX Spark, GB10, ConnectX-7 link at GID index
3) on 2026-11-07, each rank started with the arguments and environment the
node gives it, with this archive (`80fc12b8…`) and the recipe's served shape
(32 streams, rounds of 64 rows, a window of 7,340,032 positions,
`--parallel 32`). One stream at a time, 512 output tokens, greedy, thinking
off, streamed (`/v1/chat/completions`), on a code prompt and a prose prompt,
the median of five; the baseline is `vllm-26.09` serving DeepSeek-V4-Flash-0731
`safetensors-fp8` across the same two nodes as voice runs it (median of three):

| | code tok/s | prose tok/s | time to first token |
|---|---|---|---|
| `tensorfold-0.7.5`, DeepSeek-V4.1-Flash-1017 EXL3 2.5 bpw | 115.7 | 65.9 | 0.16 s |
| `vllm-26.09`, DeepSeek-V4-Flash-0731 fp8 | 26.0 | 25.9 | 0.25 s |

The recipe's own figures for the same shape are 106.5 and 60.7. A first
start readied each node's inputs in under three minutes (the model folder's
files in 1 s, the 93 GB weight file and the token map in 108 to 117 s, their
check against the pins in 52 s), and each rank's output was the recipe's,
byte for byte (rank 1's weight file, made on both nodes, came out the same).
Rank 0 answered `/v1/models` 29 s after it started, 20 s on a restart.

## `decision-0.3.0-mlx`

Voice's decision server (`server: decision`, the program `voice-decide`),
which serves a decision model's requests (`contract: decision`), here
Jev-Style's own server for its v3 recipes on MLX. A Jev-Style
release ships its runtime as Python beside its weights, and voice runs no code
from a download. So this runtime is an archive voice builds, and its recipes
list only weights, settings and the tokenizer. The archive holds:

- **Python:** CPython 3.12 from python-build-standalone, pinned by sha256.
- **Packages:** Jev-Style 0.3.0, MLX and their dependencies, from
  hash-locked wheels ([`requirements.lock`](decision-mlx/requirements.lock)).
- **The runtime files:** each release's own, at the commit its recipe pins,
  checked against its sha256.
- **The launcher:** [`voice-decide`](decision-mlx/voice-decide). It
  serves the placed weights with that file, offline, on loopback.
- **Licenses:** every package's.

`decision-mlx/build.sh OUT_DIR` rebuilds it byte for byte. CI builds it
([`runtime-decision-mlx.yml`](../.github/workflows/runtime-decision-mlx.yml)):
a pull request that touches it is held to the pinned sha256, and the release
asset is published only by running that workflow, from a build that matches the pin, and the node runs it under the macOS sandbox
like every archive runtime.

A node hands each server it starts a key in its environment
(`VOICE_DECIDE_API_KEY` for a decision server, node/run.hl) and presents it
on every call. This archive's launcher predates that: Jev's server runs
without a key, open on loopback. The next build of the launcher passes the
variable on (`--api-key-env VOICE_DECIDE_API_KEY` when it is set), as a new
runtime id with its own pin.

## `decision-0.1.2-*`

Voice's decision server built natively: `voice-decide` (the
[`decide/`](../decide) seed) and the scorer it runs, `jev-score-v2`
([`decision/`](decision)), on llama.cpp. It serves a decision recipe's GGUF
on every backend a node has: an image per backend on Linux (CPU, Vulkan,
ROCm, CUDA), each pinned here by its manifest digest, and an archive on
macOS (Metal) pinned by its sha256, whose every program runs on macOS 14
and later (the workflow checks). The
[`runtime: decision`](../.github/workflows/runtime-decision.yml) workflow
builds and checks every backend on a pull request (the scorer against the
release's tokenizer and answers, `voice-decide` answering a request on Metal
and in the CPU image), and, run by hand, publishes a version once: the
images under one tag per backend and the archive as a release. Its summary
is what these files pin.

The node hands `voice-decide` a key in `VOICE_DECIDE_API_KEY` (node/run.hl);
started with one, it answers every route but `/healthz` only to that key as
a bearer. `decision-0.1.2`'s builds predate the check and answer without
one, until the next version is published and pinned.
