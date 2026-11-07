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
says why each is in or out), and writes which recipe a node of each
platform and memory tier is offered per category
([`catalog/picks.json`](../catalog/picks.json), by
[`scripts/catalog-picks.py`](../scripts/catalog-picks.py)). `qwen3-0.6b` is hand-made, the smallest
end-to-end check. A recipe's `context_length` is the longest context the
model is made for, from its config (`max_position_embeddings`). Its
`memory_bytes` provides for 32768 tokens of context, which is the most a
llama.cpp seat serves (`node/run.hl`, `SERVED_CONTEXT`); each seat reports
the context its server took. A safetensors variant vLLM must be told how to
serve says so (`VLLM_SERVES` in the script): DeepSeek-V4's fp8 weights are
served from an fp8 KV cache alone (`kv_cache_dtype`), at what a token costs
in it (`kv_bytes_per_token`, the variant's own, which the fit takes over the
recipe's 16-bit figure), with DeepSeek-V4's reasoning parser
(`reasoning_parser`). A model that calls tools names the parser vLLM reads
its calls with (`tool_call_parser`, one vLLM v0.29.0 registers): DeepSeek-V4
`deepseek_v4`, gpt-oss `openai`, GLM-4.7-Flash `glm47`, the Qwen3-Coders
`qwen3_coder`, Granite 4.0 `granite4`, and the hand-made `qwen3-0.6b`
`hermes`. Only a vLLM seat whose variant names one carries `tools`; the
rest are served text only under vLLM (a GGUF seat carries them, through the
model's own chat template).

`deepseek-v4.1-flash-1017` is hand-made too: DeepSeek-V4.1-Flash-1017 as
bertholomus/deepseek-v4.1-tensorfold-tp2-2xgb10 v0.7.5 serves it, on
TensorFold across two DGX Sparks (`runtimes/tensorfold-0.7.5.json`). Its one
variant is `exl3`, the recipe's 2.5 bpw EXL3 quant, and it brings what
TensorFold reads beside the weights as file sets, each pinned in its own
repository: the original checkpoint's two Engram shards (`engram`, 203 GB),
and the kernel kit (`kit`), pinned by the sha256 of its `MANIFEST`, whose
383 files the node fetches and checks against the sha256 each line gives.
Before a node first starts its rank, it readies the inputs that rank reads
(`prepare: dsv41-tp2`): the model folder's two added files, then its rank's
weight file (93 GB) and Engram's token map. Each is pinned under `prepared`,
as this release's own inputs measured them, and kept for the next seat that
would make the same. Its `memory_bytes` gives each node
a share of 120 GB, about all a 128 GB Spark gives models (122.5 GB), which
is what the engine holds there at the served window (the recipe measured
10.3 GiB left free on rank 0's node during a 1M-token prompt). So a node
runs it alone: the fit refuses it beside another seat, and another seat
beside it. Its server reads DeepSeek's DSML tool calls itself, so its seats
carry `tools`.

<!-- recipes -->
| Recipe | License | Variants (download) | Served by |
|---|---|---|---|
| `deepseek-r1-0528-qwen3-8b` | mit | `safetensors-bf16` (16.4 GB) | vLLM, on CUDA |
| `deepseek-v4-flash-0731` | mit | `gguf-q2_k_s` (98.6 GB), `safetensors-fp8` (166.9 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `deepseek-v4.1-flash-1017` | mit | `exl3-2.5bpw` (388.5 GB) | TensorFold, on CUDA across two nodes |
| `glm-4.7-flash` | mit | `gguf-q8_0` (31.8 GB), `safetensors-bf16` (62.5 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `gpt-oss-120b` | apache-2.0 | `gguf-mxfp4` (63.4 GB), `safetensors-mxfp4` (65.3 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `gpt-oss-20b` | apache-2.0 | `gguf-mxfp4` (12.1 GB), `safetensors-mxfp4` (13.8 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `granite-4.0-350m` | apache-2.0 | `gguf-q8_0` (0.4 GB), `safetensors-bf16` (0.7 GB) | llama.cpp, on Metal or CUDA; vLLM, on CUDA |
| `granite-4.0-h-small` | apache-2.0 | `gguf-q4_k_m` (19.5 GB), `gguf-q6_k` (26.5 GB), `gguf-q8_0` (34.3 GB) | llama.cpp, on Metal or CUDA |
| `granite-4.0-h-tiny` | apache-2.0 | `gguf-q4_k_m` (4.2 GB), `gguf-q6_k` (5.7 GB), `gguf-q8_0` (7.4 GB) | llama.cpp, on Metal or CUDA |
| `jev-style-0.8b-decision-v3` | apache-2.0 | `mlx-bf16` (1.5 GB), `mlx-8bit` (0.8 GB) | MLX, on Metal |
| `jev-style-2b-decision-v3` | apache-2.0 | `mlx-bf16` (3.8 GB), `mlx-8bit` (2.0 GB), `gguf-q8_0` (2.0 GB), `gguf-q4_k_m` (1.3 GB), `gguf-f16` (3.8 GB) | MLX, on Metal; llama.cpp, on Metal or CUDA |
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

The operator is the authority on which weights may run: they allow more
recipes on the admin plane (`POST /admin/v1/recipes`). These are read by the
api at start (`--recipes`), listed as `shipped`, and cannot be changed or
removed through the API. A shipped recipe never changes either: other
weights are another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when
it reads it.
