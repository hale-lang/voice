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
| `jev-style-0.3.0-mlx` | mlx, decision models only | Metal, macOS arm64 | voice's own archive, built by [`jev-style-mlx/build.sh`](jev-style-mlx/build.sh) |

The operator is the authority on what may run: they allow more runtimes on
the admin plane (`POST /admin/v1/runtimes`). These are read by the api at
start (`--runtimes`), listed as `shipped`, and cannot be changed or removed
through the API. A shipped runtime never changes either: another build is
another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when it
reads it.

## `jev-style-0.3.0-mlx`

Jev-Style's decision server (`server: jev-style`), which serves a decision
model's requests (`contract: decision`): the Jev-Style v3 recipes. A Jev-Style
release ships its runtime as Python beside its weights, and voice runs no code
from a download. So this runtime is an archive voice builds, and its recipes
list only weights, settings and the tokenizer. The archive holds:

- **Python:** CPython 3.12 from python-build-standalone, pinned by sha256.
- **Packages:** Jev-Style 0.3.0, MLX and their dependencies, from
  hash-locked wheels ([`requirements.lock`](jev-style-mlx/requirements.lock)).
- **The runtime files:** each release's own, at the commit its recipe pins,
  checked against its sha256.
- **The launcher:** [`jev-style-serve`](jev-style-mlx/jev-style-serve). It
  serves the placed weights with that file, offline, on loopback.
- **Licenses:** every package's.

`jev-style-mlx/build.sh OUT_DIR` rebuilds it byte for byte. CI builds it
([`runtime-jev-style-mlx.yml`](../.github/workflows/runtime-jev-style-mlx.yml)):
a pull request that touches it is held to the pinned sha256, and the release
asset is published only by running that workflow, from a build that matches the pin, and the node runs it under the macOS sandbox
like every archive runtime.

