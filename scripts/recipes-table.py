#!/usr/bin/env python3
"""Write recipes/README.md's table of the shipped recipes from recipes/*.json,
between its `<!-- recipes -->` and `<!-- /recipes -->` markers. Run by
scripts/catalog-refresh.sh after it writes the recipes; by hand after editing one."""
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
readme = root / "recipes" / "README.md"
SERVED = {"gguf": "llama.cpp, on Metal or CUDA", "safetensors": "vLLM, on CUDA", "mlx": "MLX, on Metal"}

rows = ["| Recipe | License | Variants (download) | Served by |", "|---|---|---|---|"]
for path in sorted((root / "recipes").glob("*.json")):
    r = json.loads(path.read_text())
    variants, served = [], []
    for v in r["variants"]:
        gb = sum(f["bytes"] for f in v["files"]) / 1e9
        variants.append(f"`{v['id']}` ({gb:.1f} GB)")
        if SERVED.get(v["format"]) and SERVED[v["format"]] not in served:
            served.append(SERVED[v["format"]])
    rows.append(f"| `{r['id']}` | {r['license']['name']} | {', '.join(variants)} | {'; '.join(served)} |")

text = readme.read_text()
table = "<!-- recipes -->\n" + "\n".join(rows) + "\n<!-- /recipes -->"
new, n = re.subn(r"<!-- recipes -->.*?<!-- /recipes -->", lambda _: table, text, flags=re.S)
if n != 1:
    raise SystemExit(f"{readme}: no <!-- recipes --> ... <!-- /recipes --> markers")
readme.write_text(new)
print(f"wrote {readme.relative_to(root)}: {len(rows) - 2} recipes")
