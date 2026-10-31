# Recipes

The recipes voice ships: defaults an operator can use, one file per recipe,
`<id>.json`, matching `RecipeCreate` in
[`spec/openapi.yaml`](../spec/openapi.yaml). Each pins one revision of one
source and every file's digest, and lists only files that hold tensors, a
tokenizer or settings, never a pickle or code.

Most are generated: [`scripts/catalog-refresh.sh`](../scripts/catalog-refresh.sh)
simulates which current models fit each memory tier and platform
([`docs/catalog-sim.md`](../docs/catalog-sim.md)), then resolves each pick to
its publisher's weights at a pinned commit, or llama.cpp's own GGUF build
(`ggml-org`, the one fallback), keeping only what the pinned runtimes can
load and the license allows ([`docs/catalog-recipes.md`](../docs/catalog-recipes.md)
says why each is in or out). `qwen3-0.6b` is hand-made, the smallest
end-to-end check. A recipe's `context_length` is the longest context the
model is made for, from its config (`max_position_embeddings`). Its
`memory_bytes` provides for 32768 tokens of context, which is the most a
llama.cpp seat serves (`node/run.hl`, `SERVED_CONTEXT`); each seat reports
the context its server took.

<!-- recipes -->
| Recipe | License | Variants (download) | Served by |
|---|---|---|---|
| `deepseek-r1-0528-qwen3-8b` | mit | `safetensors-bf16` (16.4 GB) | vLLM, on CUDA |
| `deepseek-v4-flash-0731` | mit | `safetensors-fp8` (166.9 GB) | vLLM, on CUDA |
| `glm-4.7-flash` | mit | `gguf-q8_0` (31.8 GB), `safetensors-bf16` (62.5 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `gpt-oss-120b` | apache-2.0 | `gguf-mxfp4` (63.4 GB), `safetensors-mxfp4` (65.3 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `gpt-oss-20b` | apache-2.0 | `gguf-mxfp4` (12.1 GB), `safetensors-mxfp4` (13.8 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `granite-4.0-350m` | apache-2.0 | `gguf-q8_0` (0.4 GB), `safetensors-bf16` (0.7 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `granite-4.0-h-small` | apache-2.0 | `gguf-q4_k_m` (19.5 GB), `gguf-q6_k` (26.5 GB), `gguf-q8_0` (34.3 GB) | llama.cpp, on Metal or CUDA |
| `granite-4.0-h-tiny` | apache-2.0 | `gguf-q4_k_m` (4.2 GB), `gguf-q6_k` (5.7 GB), `gguf-q8_0` (7.4 GB) | llama.cpp, on Metal or CUDA |
| `mimo-v2.6-distill-qwen-9b` | mit | `gguf-q8_0` (9.5 GB), `safetensors-bf16` (18.8 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `openreasoning-nemotron-32b` | cc-by-4.0 | `safetensors-bf16` (65.5 GB) | vLLM, on CUDA |
| `phi-4-mini-reasoning` | mit | `safetensors-bf16` (7.7 GB) | vLLM, on CUDA |
| `phi-mini-moe-instruct` | mit | `safetensors-bf16` (15.3 GB) | vLLM, on CUDA |
| `phi-tiny-moe-instruct` | mit | `safetensors-bf16` (7.5 GB) | vLLM, on CUDA |
| `qwen2.5-1.5b-instruct` | apache-2.0 | `gguf-q8_0` (1.9 GB) | llama.cpp, on Metal or CUDA |
| `qwen3-0.6b` | apache-2.0 | `safetensors-bf16` (1.5 GB), `gguf-q8_0` (0.6 GB) | vLLM, on CUDA; llama.cpp, on Metal or CUDA |
| `qwen3-235b-a22b` | apache-2.0 | `gguf-q8_0` (249.9 GB) | llama.cpp, on Metal or CUDA |
| `qwen3-coder-30b-a3b-instruct` | apache-2.0 | `gguf-q8_0` (32.5 GB), `safetensors-bf16` (61.1 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `qwen3-coder-next` | apache-2.0 | `gguf-q8_0` (84.8 GB), `safetensors-bf16` (159.4 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
<!-- /recipes -->

The rest are voice's default catalog, generated: `scripts/catalog-refresh.sh`
simulates what fits each platform and memory tier per category
([`docs/catalog-sim.md`](../docs/catalog-sim.md)), resolves the picks to
pinned recipes here ([`docs/catalog-recipes.md`](../docs/catalog-recipes.md),
which lists every one and its variants), and writes which recipe a node of
each platform and memory is offered per category
([`catalog/picks.json`](../catalog/picks.json)).

The operator is the authority on which weights may run: they allow more
recipes on the admin plane (`POST /admin/v1/recipes`). These are read by the
api at start (`--recipes`), listed as `shipped`, and cannot be changed or
removed through the API. A shipped recipe never changes either: other
weights are another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when
it reads it.
