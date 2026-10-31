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

The operator is the authority on what may run: they allow more runtimes on
the admin plane (`POST /admin/v1/runtimes`). These are read by the api at
start (`--runtimes`), listed as `shipped`, and cannot be changed or removed
through the API. A shipped runtime never changes either: another build is
another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when it
reads it.
