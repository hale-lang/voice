#!/usr/bin/env bash
# Refresh the default catalog: simulate, resolve what ships, and simulate
# again without what cannot ship, until nothing new is blocked. Then the
# capture (docs/catalog-sim.md) lists only picks that resolve, and recipes/
# holds them.
#
#   scripts/catalog-refresh.sh
#
# Starts from an empty docs/catalog-blocked.tsv so a pick that can ship again
# (upstream published a GGUF, the runtime pin moved) comes back.
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_ROUNDS=${MAX_ROUNDS:-20}
blocked=docs/catalog-blocked.tsv
rm -f "$blocked"
# llmfit's answers per budget, shared by every round: only the blocked change.
# Upstream's answers too (Hugging Face, GitHub, the registry): read once per
# refresh, so every round resolves against the same snapshot.
export SIM_CACHE=$(mktemp -d) RUN_CACHE=$(mktemp -d); trap 'rm -rf "$SIM_CACHE" "$RUN_CACHE"' EXIT

for round in $(seq 1 "$MAX_ROUNDS"); do
  before=$(if [ -f "$blocked" ]; then wc -l < "$blocked" | tr -d ' '; else echo 0; fi)
  echo "round $round: simulating ($before blocked)" >&2
  scripts/catalog-sim.sh > /dev/null
  echo "round $round: resolving" >&2
  if ! python3 scripts/catalog-recipes.py 2> "$RUN_CACHE/log"; then
    grep -E "error|could not" "$RUN_CACHE/log" | tail -5 >&2
    echo "round $round: catalog-recipes.py failed; recipes/ and the blocked picks are as they were" >&2
    exit 1
  fi
  tail -1 "$RUN_CACHE/log" >&2
  after=$(if [ -f "$blocked" ]; then wc -l < "$blocked" | tr -d ' '; else echo 0; fi)
  if [ "$after" = "$before" ]; then
    echo "settled after $round round(s): $after blocked" >&2
    python3 scripts/recipes-table.py >&2
    exit 0
  fi
done
echo "not settled after $MAX_ROUNDS rounds; rerun with MAX_ROUNDS higher" >&2
exit 1
