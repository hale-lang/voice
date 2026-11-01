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
| `llama-server-b11913-cuda` | gguf | CUDA, linux arm64 and x86_64 | `ghcr.io/ggml-org/llama.cpp:server-cuda-b11913` |
| `llama-server-b11913-rocm` | gguf | ROCm (AMD), linux x86_64 | `ghcr.io/ggml-org/llama.cpp:server-rocm-b11913` |
| `llama-server-b11913-vulkan` | gguf | Vulkan (AMD, Intel), linux arm64 and x86_64 | `ghcr.io/ggml-org/llama.cpp:server-vulkan-b11913` |
| `llama-server-b11913-metal` | gguf | Metal, macOS arm64 | llama.cpp's b11913 release for macOS arm64 |
| `decision-0.3.0-mlx` | mlx, decision models only | Metal, macOS arm64 | voice's own archive, built by [`decision-mlx/build.sh`](decision-mlx/build.sh) |
| `decision-0.1.1-metal` | gguf, decision models only | Metal, macOS 14+ arm64 | voice's own archive: `voice-decide` and `jev-score-v2`, built by [`decision/build.sh`](decision/build.sh) |
| `decision-0.1.0-cpu` | gguf, decision models only | CPU, linux arm64 and x86_64 | `ghcr.io/hale-lang/voice-decision:cpu-0.1.0` |
| `decision-0.1.0-vulkan` | gguf, decision models only | Vulkan (AMD, Intel), linux arm64 and x86_64 | `ghcr.io/hale-lang/voice-decision:vulkan-0.1.0` |
| `decision-0.1.0-rocm` | gguf, decision models only | ROCm (AMD), linux x86_64 | `ghcr.io/hale-lang/voice-decision:rocm-0.1.0` |
| `decision-0.1.0-cuda` | gguf, decision models only | CUDA, linux arm64 and x86_64 | `ghcr.io/hale-lang/voice-decision:cuda-0.1.0` |

The operator is the authority on what may run: they allow more runtimes on
the admin plane (`POST /admin/v1/runtimes`). These are read by the api at
start (`--runtimes`), listed as `shipped`, and cannot be changed or removed
through the API. A shipped runtime never changes either: another build is
another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when it
reads it.

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

## `decision-0.1.0-*`

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
