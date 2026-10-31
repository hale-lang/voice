"""Resolve the catalog simulation's servable picks to shipped recipes.

    python3 scripts/catalog-recipes.py            # writes recipes/<id>.json and docs/catalog-recipes.md
    python3 scripts/catalog-recipes.py --dry-run  # the report only

Reads docs/catalog-sim.md (scripts/catalog-sim.sh writes it) and takes the
rows marked servable. Each model resolves, through the Hugging Face API, to
up to two kinds of variant, each at its repo's current commit with every
file's size and sha256:

- GGUF, for llama.cpp (osx and linux): one variant per quant the tiers
  chose, split GGUFs included. From the publisher's own `<org>/<model>-GGUF`
  when it has one; otherwise from ggml-org, the llama.cpp project's own
  conversions, and the report says so. ggml-org is a repackager too: taking
  it is a deliberate exception (gpt-oss, GLM-4.7-Flash and Qwen3-Coder-30B
  have no GGUF of their publisher's). No other repackager (unsloth,
  bartowski, ...) is taken. Checked against the llama.cpp build the shipped
  llama-server runtimes pin: the GGUF's `general.architecture` must be in
  that build's architecture table.
- safetensors, for vLLM (linux with CUDA): the publisher's own repo, at its
  published precision (bf16, or fp8 when the publisher ships fp8), when the
  model is picked for a linux tier its weights fit. Checked against the
  vLLM in the pinned vllm runtime's container: the config's architecture
  must be in that vLLM's model registry. A config with `auto_map` (pointing
  at the repo's own code, which no recipe lists) is taken only when vLLM
  implements the architecture itself and the model type is one transformers
  (at vLLM's floor) or vLLM's own config classes know, so nothing from the
  repo runs; voice starts vLLM without trust_remote_code.

The license is the publisher's, from the base model's card. A license in
LICENSE_DENY keeps the model out of the defaults: lfm1.0 (LFM Open License
v1.0) limits commercial use above a revenue threshold, and voice ships as a
product. LFS files' sha256
comes from the API; the few small config and tokenizer files a safetensors
variant needs are plain git files with no sha256 there, so those are fetched
at the pinned commit and hashed. Weights are never downloaded.

One recipe per model, held to the api's own limits (api/recipes.hl: files per
variant, a variant's and a recipe's size as JSON). memory_bytes is the
variant's files, 5% more for compute buffers, and the KV cache for CONTEXT
tokens (default 32768, at most the model's own), from the base model's
config: full-attention layers hold every token, sliding-window layers their
window, linear-attention, Mamba and conv layers no per-token cache, and MLA
its compressed latent. The server must then serve at most CONTEXT tokens.

Every pick a variant cannot serve (at that tier's budget, on that platform:
osx needs GGUF) is added to docs/catalog-blocked.tsv, which catalog-sim.sh
skips; scripts/catalog-refresh.sh runs the two until nothing new is blocked.

Output is a function of the capture and upstream: run it twice, get the same
files unless a repo moved. Small files' digests are cached by commit in
~/.cache/voice-catalog-recipes (a commit never changes). Set HF_TOKEN to
raise the API's rate limit; no token is needed.

It fails closed: if any pick cannot be resolved (the network, a rate limit),
it changes no recipe and no blocked pick, writes the report, and exits 1.
"""
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURE = os.path.join(ROOT, "docs", "catalog-sim.md")
REPORT = os.path.join(ROOT, "docs", "catalog-recipes.md")
BLOCKED = os.path.join(ROOT, "docs", "catalog-blocked.tsv")
LIMITS = os.path.join(ROOT, "api", "recipes.hl")
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "voice-catalog-recipes")
RECIPES = os.path.join(ROOT, "recipes")
RUNTIMES = os.path.join(ROOT, "runtimes")
HF = "https://huggingface.co"
SPLIT = re.compile(r"-(\d{5})-of-(\d{5})\.gguf$")
MAX_VARIANTS = 8
# Licenses kept out of the defaults; an operator can still allow the model.
LICENSE_DENY = {"lfm1.0": "LFM Open License v1.0 limits commercial use above a revenue threshold"}
# The context memory_bytes provides for, in tokens.
CONTEXT = int(os.environ.get("CONTEXT", "32768"))
# The one repackager taken, when the publisher ships no GGUF.
GGUF_FALLBACK = "ggml-org"
# Compute buffers and the runtime's own, beyond weights and KV cache.
OVERHEAD = 1.05
# The sim's share of a tier a model may take (catalog-sim.sh headroom()).
SHARE = {"osx": 0.70, "linux": 0.90}
# What a safetensors variant lists besides its weights: top-level settings and
# tokenizer files, in the extensions the recipe contract allows.
SETTINGS = re.compile(r"^[A-Za-z0-9._-]+\.(json|txt|model|tiktoken|jinja)$")


def get(url, headers=None):
    """A GET, retried on 429 and 5xx with backoff (Retry-After when given).

    Within a refresh (RUN_CACHE set by catalog-refresh.sh) every response is
    kept, so upstream is read once and every round sees the same snapshot."""
    run_cache = os.environ.get("RUN_CACHE")
    cached = os.path.join(run_cache, hashlib.sha256(url.encode()).hexdigest()) if run_cache else None
    if cached and os.path.exists(cached):
        return open(cached, "rb").read()
    req = urllib.request.Request(url, headers={"User-Agent": "voice-catalog-recipes", **(headers or {})})
    if os.environ.get("HF_TOKEN") and url.startswith(HF):
        req.add_header("Authorization", "Bearer " + os.environ["HF_TOKEN"])
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500 or attempt == 5:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 2 ** (attempt + 2)
            print(f"  {e.code} from {urllib.parse.urlparse(url).netloc}; retrying in {wait}s", file=sys.stderr)
            time.sleep(min(wait, 300))
    if cached:
        with open(cached, "wb") as f:
            f.write(body)
    return body


def hf(path, **query):
    q = urllib.parse.urlencode(query, doseq=True)
    return json.loads(get(f"{HF}/api/{path}" + (f"?{q}" if q else "")))


def hf_at_main(repo):
    """(sha, info) for the repo's current commit, with config, card, gguf header and file digests."""
    sha = hf(f"models/{repo}/revision/main")["sha"]
    info = hf(f"models/{repo}/revision/{sha}", blobs="true",
              **{"expand[]": ["gguf", "cardData", "siblings", "sha", "config"]})
    return sha, info


def tiers():
    """The sim's tiers, from the capture's header."""
    for line in open(CAPTURE):
        m = re.match(r"- tiers: ([\d ]+) GB", line)
        if m:
            return [int(t) for t in m.group(1).split()]
    sys.exit("no tiers line in the capture")


def picks():
    """model -> quant -> {mem_gb, uses: {(os, tier, class)}}, from the capture's servable rows."""
    out = defaultdict(lambda: defaultdict(lambda: {"mem_gb": 0.0, "uses": set()}))
    os_name, header = None, None
    for line in open(CAPTURE):
        if line.startswith("## "):
            os_name, header = line[3:].strip(), None
            continue
        if not line.startswith("|") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = cells
            continue
        row = dict(zip(header, cells))
        if row.get("servable") != "yes" or row["model"] == "-":
            continue
        model = re.sub(r" \(chat\)$", "", row["model"])
        p = out[model][row["quant"]]
        p["mem_gb"] = max(p["mem_gb"], float(row["mem GB"]))
        p["uses"].add((os_name, int(row["tier GB"]), row["class"]))
    return out


def api_limits():
    """The api's own limits on a recipe, from api/recipes.hl."""
    src = open(LIMITS).read()
    val = lambda n: int(re.search(r"const " + n + r": Int = (\d+);", src).group(1))
    return {"files": val("VARIANT_FILES_MAX"), "variant": val("VARIANT_MAX"), "recipe": val("RECIPE_MAX")}


def api_json(x):
    """A value as the api serializes it, to measure it as the api does."""
    return json.dumps(x, separators=(", ", ": "))


def runtime_files():
    for f in sorted(os.listdir(RUNTIMES)):
        if f.endswith(".json"):
            yield json.load(open(os.path.join(RUNTIMES, f)))


def llama_build():
    """The llama.cpp build the shipped llama-server runtimes pin, and its architectures."""
    tags = {t for rt in runtime_files() if rt.get("server") == "llama-server" for t in re.findall(r"\bb\d+\b", rt["id"])}
    if len(tags) != 1:
        sys.exit(f"expected one llama.cpp build across the llama-server runtimes, found {sorted(tags)}")
    tag = tags.pop()
    src = get(f"https://raw.githubusercontent.com/ggml-org/llama.cpp/{tag}/src/llama-arch.cpp").decode()
    return tag, set(re.findall(r'\{\s*LLM_ARCH_\w+,\s*"([^"]+)"\s*\}', src))


def vllm_build():
    """The vLLM in the pinned vllm runtime's container, read from the image's labels, and its registry.

    NVIDIA builds vLLM from its own commit; the registry is upstream's at the
    same release, the nearest public source."""
    rts = [rt for rt in runtime_files() if rt.get("server") == "vllm"]
    if len(rts) != 1 or rts[0]["artifact"].get("kind") != "container":
        sys.exit(f"expected one vllm container runtime, found {[r['id'] for r in rts]}")
    art = rts[0]["artifact"]
    registry, _, name = art["image"].partition("/")
    token = json.loads(get(f"https://{registry}/proxy_auth?scope=repository:{name}:pull"))["token"]
    accept = ("application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.index.v1+json,"
              "application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json")
    h = {"Authorization": f"Bearer {token}", "Accept": accept}
    m = json.loads(get(f"https://{registry}/v2/{name}/manifests/{art['digest']}", h))
    if "manifests" in m:
        m = json.loads(get(f"https://{registry}/v2/{name}/manifests/{m['manifests'][0]['digest']}", h))
    cfg = json.loads(get(f"https://{registry}/v2/{name}/blobs/{m['config']['digest']}", h))
    version = (cfg["config"].get("Labels") or {}).get("com.nvidia.vllm.version", "")
    release = re.match(r"\d+\.\d+\.\d+", version)
    if not release:
        sys.exit(f"{rts[0]['id']}: no vLLM version in the image's labels")
    tag = "v" + release.group(0)
    raw = f"https://raw.githubusercontent.com/vllm-project/vllm/{tag}"
    src = get(f"{raw}/vllm/model_executor/models/registry.py").decode()
    archs = set(re.findall(r'^\s+"(\w+)"\s*:\s*\(', src, re.M))
    # Model types whose config loads without the repo's code: vLLM's own
    # config classes, and transformers' at the floor vLLM requires.
    own = json.loads(get(f"https://api.github.com/repos/vllm-project/vllm/contents/vllm/transformers_utils/configs?ref={tag}"))
    types = {f["name"][:-3] for f in own if f["name"].endswith(".py") and not f["name"].startswith("_")}
    floor = re.search(r"^transformers\s*>=\s*([\d.]+)", get(f"{raw}/requirements/common.txt").decode(), re.M).group(1)
    tf_tag = transformers_tag(floor)
    mapping = get(f"https://raw.githubusercontent.com/huggingface/transformers/{tf_tag}/src/transformers/models/auto/auto_mappings.py").decode()
    block = mapping[mapping.index("CONFIG_MAPPING_NAMES"):]
    block = block[:block.index("\n)")]
    types |= set(re.findall(r'\(\s*"([A-Za-z0-9_-]+)"\s*,\s*"\w+"\s*\)', block))
    label = f"{rts[0]['id']} (vLLM {version}; upstream {tag}'s registry; transformers {tf_tag}, at most its floor {floor})"
    return label, archs, types


def transformers_tag(version):
    """The release tag for a transformers version, or the nearest patch below it: a patch release adds no model types."""
    major_minor = ".".join(version.split(".")[:2])
    refs = json.loads(get(f"https://api.github.com/repos/huggingface/transformers/git/matching-refs/tags/v{major_minor}."))
    tags = sorted((tuple(int(x) for x in r["ref"].rsplit("/v", 1)[1].split(".")), r["ref"].rsplit("/", 1)[1])
                  for r in refs if re.fullmatch(r"refs/tags/v[\d.]+", r["ref"]))
    want = tuple(int(x) for x in version.split("."))
    below = [t for v, t in tags if v <= want]
    if not below:
        sys.exit(f"no transformers release tag at or below {version}")
    return below[-1]


def quant_files(siblings, quant):
    """The quant's GGUF files: one file, or every part of one split. None if absent or ambiguous."""
    token = re.compile(r"(^|[-_./])" + re.escape(quant.lower()) + r"([-_./]|$)")
    groups = defaultdict(list)
    for s in siblings:
        path = s["rfilename"]
        if not path.endswith(".gguf") or "mmproj" in path.lower():
            continue
        if not token.search(path.lower()[:-len(".gguf")]):
            continue
        groups[SPLIT.sub("", path)].append(s)
    if len(groups) != 1:
        return None, sorted(groups)
    files = sorted(next(iter(groups.values())), key=lambda s: s["rfilename"])
    m = SPLIT.search(files[0]["rfilename"])
    if m and len(files) != int(m.group(2)):
        return None, [f"{files[0]['rfilename']}: {len(files)} of {int(m.group(2))} parts"]
    if any(not (s.get("lfs") or {}).get("sha256") for s in files):
        return None, ["a file without an LFS digest"]
    return files, []


def available_quants(siblings):
    qs = set()
    for s in siblings:
        p = s["rfilename"]
        if p.endswith(".gguf") and "mmproj" not in p.lower():
            m = re.search(r"[-_.]((?:I?Q\d[\w]*?|F16|BF16|F32|MXFP4))(?:-\d{5}-of-\d{5})?\.gguf$", p, re.I)
            if m:
                qs.add(m.group(1).upper())
    return sorted(qs)


def license_of(repo, sha, card, siblings):
    name = card.get("license") or ""
    if name == "other" and card.get("license_name"):
        name = card["license_name"]
    link = card.get("license_link") or ""
    names = {s["rfilename"] for s in siblings}
    if link.startswith("http"):
        url = link
    elif link and link in names:
        url = f"{HF}/{repo}/blob/{sha}/{link}"
    else:
        lic = next((n for n in sorted(names) if re.fullmatch(r"LICEN[CS]E(\.\w+)?", n)), None)
        url = f"{HF}/{repo}/blob/{sha}/{lic or 'README.md'}"
    return (name[:64] or None), url


def recipe_id(model):
    return re.sub(r"[^a-z0-9.-]+", "-", model.split("/", 1)[1].lower()).strip("-.")[:63]


def kv_bytes(cfg, ctx):
    """The KV cache for ctx tokens at 16 bits, from a model's config. None when the config does not say."""
    c = {**cfg, **(cfg.get("text_config") or {})}
    layers = c.get("num_hidden_layers")
    if not layers:
        return None
    ctx = min(ctx, c.get("max_position_embeddings") or ctx)
    if c.get("kv_lora_rank"):  # MLA: one compressed latent and the rope key per token per layer
        return layers * (c["kv_lora_rank"] + (c.get("qk_rope_head_dim") or 64)) * 2 * ctx
    heads = c.get("num_attention_heads")
    kv_heads = c.get("num_key_value_heads") or heads
    head_dim = c.get("head_dim") or (c.get("hidden_size") // heads if heads and c.get("hidden_size") else None)
    if not (kv_heads and head_dim):
        return None
    per_token = 2 * kv_heads * head_dim * 2
    window = c.get("sliding_window") or ctx
    types = c.get("layer_types")
    if isinstance(types, list) and types:
        tokens = 0
        for t in types:
            t = str(t).lower()
            if "linear" in t or t in ("mamba", "conv", "ssm", "recurrent"):
                continue
            tokens += min(ctx, window) if "sliding" in t else ctx
        return per_token * tokens
    if c.get("full_attention_interval"):
        return per_token * ctx * (layers // c["full_attention_interval"])
    for k in ("full_attn_idxs", "attn_layer_indices"):
        if isinstance(c.get(k), list):
            return per_token * ctx * len(c[k])
    return per_token * ctx * layers


def need_bytes(files, kv):
    """Weights, buffers and the KV cache; a fifth more than the weights when the cache is not known."""
    size = sum(f["bytes"] for f in files)
    need = size * OVERHEAD + kv if kv is not None else size * 1.25
    return int(math.ceil(need / 1e8)) * 100_000_000


def budget(os_name, tier):
    return tier * SHARE[os_name] * 1e9


def gguf_source(org, base):
    """(repo, 'publisher' | GGUF_FALLBACK) or (None, None)."""
    for author, kind in ((org, "publisher"), (GGUF_FALLBACK, GGUF_FALLBACK)):
        want = f"{author}/{base}-GGUF".lower()
        repo = next((m["id"] for m in hf("models", author=author, search=base, limit=100) if m["id"].lower() == want), None)
        if repo:
            return repo, kind
    return None, None


def gguf_variants(model, quants, arches, tag, row, kv):
    org, base = model.split("/", 1)
    repo, kind = gguf_source(org, base)
    if not repo:
        row["gguf"] = "none"
        return [], f"GGUF: neither the publisher nor {GGUF_FALLBACK} ships one"
    sha, info = hf_at_main(repo)
    siblings = info.get("siblings") or []
    arch = (info.get("gguf") or {}).get("architecture") or "?"
    row["gguf"] = f"{repo} @{sha[:12]}" + ("" if kind == "publisher" else f" ({kind})")
    row["gguf_arch"] = f"{arch}: " + ("yes" if arch in arches else "no")
    if arch not in arches:
        return [], f"GGUF: llama.cpp {tag} has no architecture {arch!r}"
    out, missing = [], []
    for q in sorted(quants):
        files, why = quant_files(siblings, q)
        if not files:
            missing.append(f"{q} ({'; '.join(why) if why else 'not published'})")
            continue
        listed = [{"path": s["rfilename"], "bytes": s["lfs"]["size"], "sha256": s["lfs"]["sha256"]} for s in files]
        v = {"id": f"gguf-{q.lower()}", "format": "gguf", "quantization": q.lower(),
             "source": {"hub": "huggingface", "repo": repo, "revision": sha},
             "files": listed, "memory_bytes": need_bytes(listed, kv)}
        out.append(v)
    note = ""
    if missing:
        note = "GGUF: no " + ", ".join(missing) + f" in {repo} (it has: {', '.join(available_quants(siblings)) or 'none'})"
    return out, note


def small_file(repo, sha, path):
    """(bytes, sha256) of a plain git file at a commit, cached by commit."""
    cached = os.path.join(CACHE, repo, sha, path + ".sha256")
    if os.path.exists(cached):
        n, digest = open(cached).read().split()
        return int(n), digest
    body = get(f"{HF}/{repo}/resolve/{sha}/{path}")
    os.makedirs(os.path.dirname(cached), exist_ok=True)
    with open(cached, "w") as f:
        f.write(f"{len(body)} {hashlib.sha256(body).hexdigest()}\n")
    return len(body), hashlib.sha256(body).hexdigest()


def config_json(repo, sha):
    """The repo's config.json at a commit, cached by commit; {} when it has none.

    The API's expanded `config` is a summary without the layer shapes the KV
    cache needs, so the file itself is read."""
    cached = os.path.join(CACHE, repo, sha, "config.json")
    if not os.path.exists(cached):
        try:
            body = get(f"{HF}/{repo}/resolve/{sha}/config.json")
        except urllib.error.HTTPError as e:
            if e.code in (401, 404):
                return {}
            raise
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with open(cached, "wb") as f:
            f.write(body)
    return json.load(open(cached))


def safetensors_variant(model, sha, info, cfg, quants, registry, types, row, kv):
    linux = sorted({t for q in quants.values() for o, t, _ in q["uses"] if o == "linux"})
    if not linux:
        return None, ""
    arch = (cfg.get("architectures") or ["?"])[0]
    row["st_arch"] = f"{arch}: " + ("yes" if arch in registry else "no")
    if arch not in registry:
        return None, f"safetensors: vLLM has no {arch}"
    if cfg.get("auto_map") and cfg.get("model_type") not in types:
        return None, f"safetensors: its config type {cfg.get('model_type')!r} needs the repo's own code (auto_map)"
    siblings = info.get("siblings") or []
    weights = [s for s in siblings if "/" not in s["rfilename"] and s["rfilename"].endswith(".safetensors")]
    if not weights:
        return None, "safetensors: the publisher ships none"
    if any(not (s.get("lfs") or {}).get("sha256") for s in weights):
        return None, "safetensors: a weight file without an LFS digest"
    files = [{"path": s["rfilename"], "bytes": s["lfs"]["size"], "sha256": s["lfs"]["sha256"]} for s in weights]
    for s in siblings:
        p = s["rfilename"]
        if SETTINGS.match(p):
            if (s.get("lfs") or {}).get("sha256"):
                files.append({"path": p, "bytes": s["lfs"]["size"], "sha256": s["lfs"]["sha256"]})
            else:
                n, digest = small_file(model, sha, p)
                files.append({"path": p, "bytes": n, "sha256": digest})
    files.sort(key=lambda f: f["path"])
    qc = cfg.get("quantization_config") or {}
    dtype = str(cfg.get("torch_dtype") or cfg.get("dtype") or "bf16")
    precision = qc.get("quant_method") or {"bfloat16": "bf16", "float16": "fp16", "float32": "fp32"}.get(dtype, dtype)
    mem = need_bytes([f for f in files if f["path"].endswith(".safetensors")], kv)
    fits = [t for t in linux if mem <= budget("linux", t)]
    if not fits:
        return None, f"safetensors: {precision} needs {mem / 1e9:.0f} GB, more than any linux tier it is picked for ({', '.join(map(str, linux))} GB)"
    return {"id": f"safetensors-{precision}", "format": "safetensors", "quantization": precision,
            "source": {"hub": "huggingface", "repo": model, "revision": sha},
            "files": files, "memory_bytes": mem}, ""


def served(v, o, t, q):
    """Whether variant v serves a pick of quant q at os o, tier t."""
    if v["memory_bytes"] > budget(o, t):
        return False
    if v["format"] == "gguf":
        return v["quantization"] == q.lower()
    return o == "linux"  # safetensors: vLLM, CUDA only


def fit_limits(variants, limits, notes):
    """The variants the api's limits allow; why the others are not, in notes."""
    out = []
    for v in variants:
        size = len(api_json(v).encode())
        if len(v["files"]) > limits["files"]:
            notes.append(f"{v['id']}: {len(v['files'])} files, the api allows {limits['files']}")
        elif size > limits["variant"]:
            notes.append(f"{v['id']}: {size} bytes as JSON, the api allows {limits['variant']}")
        else:
            out.append(v)
    return out


def resolve(model, quants, arches, tag, registry, types, limits):
    """(recipe or None, report row, blocked uses)."""
    uses = sorted((o, t, c, q) for q in quants for o, t, c in quants[q]["uses"])
    row = {"model": model, "license": "-", "gguf": "-", "gguf_arch": "-", "st_arch": "-", "kv": "-", "unserved": [],
           "quants": sorted(quants), "uses": [f"{o}:{t} {c}" for o, t, c, _ in uses], "result": ""}
    sha, info = hf_at_main(model)
    lic_name, lic_url = license_of(model, sha, info.get("cardData") or {}, info.get("siblings") or [])
    row["license"] = lic_name or "?"
    if not lic_name or lic_name in LICENSE_DENY:
        why = "the publisher's card names no license" if not lic_name else f"{lic_name}: {LICENSE_DENY[lic_name]}"
        row["result"] = "skipped: " + why
        return None, row, [(o, t, why) for o in ("osx", "linux") for t in tiers()]
    cfg = config_json(model, sha)
    kv = kv_bytes(cfg, CONTEXT)
    row["kv"] = "?" if kv is None else f"{kv / 1e9:.1f} GB"
    variants, notes = [], []
    st, note = safetensors_variant(model, sha, info, cfg, quants, registry, types, row, kv)
    variants += [st] if st else []
    notes += [note] if note else []
    gg, note = gguf_variants(model, quants, arches, tag, row, kv)
    variants += gg
    notes += [note] if note else []
    variants = sorted(fit_limits(variants, limits, notes), key=lambda v: v["id"])
    if len(variants) > MAX_VARIANTS:
        notes.append(f"{len(variants)} variants, the api allows {MAX_VARIANTS}")
        variants = []
    recipe = None
    if variants:
        rid = recipe_id(model)
        recipe = {"id": rid, "license": {"name": lic_name, "url": lic_url}, "variants": variants}
        size = len(api_json(recipe).encode())
        if size > limits["recipe"]:
            notes.append(f"the recipe is {size} bytes as JSON, the api allows {limits['recipe']}")
            recipe, variants = None, []
    blocked = []
    for o, t, c, q in uses:
        if not any(served(v, o, t, q) for v in variants):
            why = "nothing that ships fits" if variants else "nothing ships"
            blocked.append((o, t, why))
            row["unserved"].append(f"{o}:{t}")
    # Every other tier where nothing could serve it either, so the sim does not
    # pick it there next round: osx takes only GGUF; linux is known only when
    # the model was picked there (only then is its safetensors resolved).
    gguf = [v for v in variants if v["format"] == "gguf"]
    linux_known = any(o == "linux" for o, _, _, _ in uses)
    for t in tiers():
        if not any(v["memory_bytes"] <= budget("osx", t) for v in gguf):
            blocked.append(("osx", t, "no GGUF ships" if not gguf else "every GGUF that ships is bigger"))
        if linux_known and not any(v["memory_bytes"] <= budget("linux", t) for v in variants):
            blocked.append(("linux", t, "nothing ships" if not variants else "everything that ships is bigger"))
    row["unserved"] = sorted(set(row["unserved"]), key=lambda w: (w.split(":")[0], int(w.split(":")[1])))
    if recipe:
        row["result"] = f"recipes/{recipe['id']}.json: " + ", ".join(v["id"] for v in variants)
        row["result"] += "" if not notes else ". " + "; ".join(notes)
    else:
        row["result"] = "skipped. " + "; ".join(notes)
    return recipe, row, blocked


WRITTEN_HEADER = "Recipes this script wrote (it removes these before writing, never another recipe):"


def previously_written():
    """The recipe files the last run wrote, from its report."""
    if not os.path.exists(REPORT):
        return []
    lines = open(REPORT).read().split("\n")
    if WRITTEN_HEADER not in lines:
        return []
    out = []
    for line in lines[lines.index(WRITTEN_HEADER) + 2:]:
        m = re.fullmatch(r"- `recipes/([a-z0-9][a-z0-9.-]*\.json)`", line)
        if not m:
            break
        out.append(m.group(1))
    return out


def report(rows, tag, vllm, limits, written):
    out = ["# Catalog recipes", "",
           "Generated by `scripts/catalog-recipes.py` from `docs/catalog-sim.md`; rerun it to refresh. Do not edit by hand.", "",
           "Each servable pick, resolved at each repo's current commit:", "",
           f"- GGUF, for llama.cpp {tag} (the shipped llama-server runtimes): the publisher's own `-GGUF` repo, else {GGUF_FALLBACK}'s,",
           f"  a deliberate exception to taking no repackager. `GGUF arch`: the GGUF's architecture, and whether {tag}'s table has it.",
           f"- safetensors, for {vllm}: the publisher's own repo, for models picked on linux. `safetensors arch`: the",
           "  config's architecture, and whether that registry has it. A config needing the repo's code (auto_map) is taken only",
           "  when vLLM implements the architecture and the model type loads without that code.",
           f"- Held to the api's limits (api/recipes.hl): {limits['files']} files and {limits['variant']} bytes a variant, {limits['recipe']} bytes a recipe.",
           "- Licenses kept out of the defaults: " + "; ".join(f"{k} ({v})" for k, v in sorted(LICENSE_DENY.items())) + ".",
           f"- memory_bytes: weights, 5% for buffers, and the KV cache for {CONTEXT} tokens (`KV`), from the model's config.",
           f"  The server must serve at most {CONTEXT} tokens of context for that to hold.",
           "- `not served at`: tiers where the sim picked the model but no variant that ships fits (osx needs GGUF). Each is in",
           "  docs/catalog-blocked.tsv, which the next sim run skips.", "",
           "| model | license | GGUF | GGUF arch | safetensors arch | KV | not served at | result |",
           "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['model']} | {r['license']} | {r['gguf']} | {r['gguf_arch']} | {r['st_arch']} | {r['kv']} | "
                   f"{', '.join(r['unserved']) or '-'} | {r['result']} |")
    out += ["", "Where each model is picked:", ""]
    for r in rows:
        out.append(f"- `{r['model']}`: {', '.join(r['uses'])}")
    out += ["", WRITTEN_HEADER, ""] + [f"- `recipes/{f}`" for f in sorted(written)]
    return "\n".join(out) + "\n"


def write_blocked(new):
    """Add the blocked picks to docs/catalog-blocked.tsv, keeping what is there: the sim no longer picks those."""
    seen = {}
    if os.path.exists(BLOCKED):
        for line in open(BLOCKED):
            o, t, m, why = line.rstrip("\n").split("\t", 3)
            seen[(o, int(t), m)] = why
    for o, t, m, why in new:
        seen.setdefault((o, t, m), why)
    with open(BLOCKED, "w") as f:
        for (o, t, m), why in sorted(seen.items()):
            f.write(f"{o}\t{t}\t{m}\t{why}\n")
    return len(seen)


def main():
    dry = "--dry-run" in sys.argv[1:]
    limits = api_limits()
    tag, arches = llama_build()
    vllm, registry, types = vllm_build()
    rows, recipes, blocked, errors = [], [], [], 0
    for model, quants in sorted(picks().items()):
        try:
            recipe, row, b = resolve(model, quants, arches, tag, registry, types, limits)
        except Exception as e:  # reported, then nothing is changed
            errors += 1
            recipe, b = None, []
            row = {"model": model, "license": "-", "gguf": "-", "gguf_arch": "-", "st_arch": "-", "kv": "-",
                   "unserved": [], "quants": sorted(quants), "uses": [], "result": f"error: {e}"}
        rows.append(row)
        blocked += [(o, t, model, why) for o, t, why in b]
        recipes += [recipe] if recipe else []
        print(f"{model}: {row['result']}", file=sys.stderr)
    stale = previously_written()
    if errors or dry:
        with open(REPORT, "w") as f:
            f.write(report(rows, tag, vllm, limits, stale))
        if errors:
            print(f"{errors} pick(s) could not be resolved: no recipe or blocked pick changed", file=sys.stderr)
            sys.exit(1)
        print(f"dry run: {len(recipes)} recipe(s), {len(blocked)} blocked pick(s)", file=sys.stderr)
        return
    for r in recipes:
        name = r["id"] + ".json"
        if name not in stale and os.path.exists(os.path.join(RECIPES, name)):
            sys.exit(f"recipes/{name} exists and this script did not write it: not overwriting")
    for f in stale:
        if os.path.exists(os.path.join(RECIPES, f)):
            os.remove(os.path.join(RECIPES, f))
    written = []
    for r in recipes:
        name = r["id"] + ".json"
        with open(os.path.join(RECIPES, name), "w") as f:
            f.write(json.dumps(r, indent=2) + "\n")
        written.append(name)
    with open(REPORT, "w") as f:
        f.write(report(rows, tag, vllm, limits, written))
    total = write_blocked(blocked)
    print(f"wrote {len(written)} recipe(s), {os.path.relpath(REPORT, ROOT)}; {total} blocked pick(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
