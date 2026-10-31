#!/usr/bin/env python3
"""Voice's default picks, as the api reads them: catalog/picks.json.

For each platform, memory tier and category, the recipe voice suggests for
a node of that platform and memory (`GET /admin/v1/nodes/{node}/suggestions`).
Read from the simulation (docs/catalog-sim.md) and what of it ships
(docs/catalog-recipes.md: each model's recipe, and the tiers no variant of
it serves at). Only a servable pick with a recipe in recipes/ is kept.

    scripts/catalog-picks.py      # rewrites catalog/picks.json

scripts/catalog-refresh.sh runs it last.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# the categories voice ships, as a client names them, and the simulation's
# class each is read from: `general` is the sim's chat class, `decide` its
# Jev-style decision model
CATEGORIES = {"general": "chat", "coding": "coding", "reasoning": "reasoning", "decide": "sys1"}

# the simulation's platform names, as a node's hardware says them
PLATFORMS = {"osx": "darwin", "linux": "linux"}


def rows(text, header):
    """The table rows under `## <header>`, each as its cells."""
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line[3:].strip() == header
            continue
        if inside and line.startswith("| ") and not line.startswith("| tier") and not line.startswith("|---"):
            out.append([c.strip() for c in line.strip("|").split("|")])
    return out


def main():
    sim = open(os.path.join(ROOT, "docs/catalog-sim.md")).read()
    shipped = open(os.path.join(ROOT, "docs/catalog-recipes.md")).read()
    # each model's recipe, and the tiers it is not served at, per platform
    recipe_of, not_at = {}, {}
    for line in shipped.splitlines():
        if not line.startswith("| ") or line.startswith("| model") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        m = re.search(r"recipes/([a-z0-9.-]+)\.json", cells[-1])
        if not m or not os.path.exists(os.path.join(ROOT, "recipes", m.group(1) + ".json")):
            continue
        recipe_of[cells[0]] = m.group(1)
        not_at[cells[0]] = {t.strip() for t in cells[-2].split(",") if t.strip() not in ("", "-")}
    # a decision model (the sim's `sys1`, a Jev-style release, which the sim
    # marks not servable: it knows llama.cpp and vLLM only) is served where a
    # shipped jev-style runtime runs, from the recipe named for it
    decision_os = set()
    for f in sorted(os.listdir(os.path.join(ROOT, "runtimes"))):
        if f.endswith(".json"):
            r = json.load(open(os.path.join(ROOT, "runtimes", f)))
            if r.get("server") == "jev-style":
                decision_os |= {p["os"] for p in r.get("platforms", [])}
    picks = []
    for sim_os, os_name in PLATFORMS.items():
        for cells in rows(sim, sim_os):
            tier, klass, model, servable = cells[0], cells[1], cells[2], cells[-1]
            category = next((c for c, k in CATEGORIES.items() if k == klass), None)
            if category == "decide" and model != "-" and os_name in decision_os \
                    and os.path.exists(os.path.join(ROOT, "recipes", model + ".json")):
                picks.append({"os": os_name, "tier_gb": int(tier), "category": category, "recipe": model})
                continue
            if category is None or servable != "yes" or model == "-":
                continue
            model = re.sub(r"\s*\(chat\)$", "", model)
            recipe = recipe_of.get(model)
            if recipe is None or f"{sim_os}:{tier}" in not_at.get(model, set()):
                continue
            picks.append({"os": os_name, "tier_gb": int(tier), "category": category, "recipe": recipe})
    out = {
        "categories": list(CATEGORIES),
        "picks": sorted(picks, key=lambda p: (p["os"], p["tier_gb"], list(CATEGORIES).index(p["category"]))),
    }
    os.makedirs(os.path.join(ROOT, "catalog"), exist_ok=True)
    with open(os.path.join(ROOT, "catalog/picks.json"), "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"catalog/picks.json: {len(picks)} picks", file=sys.stderr)


if __name__ == "__main__":
    main()
