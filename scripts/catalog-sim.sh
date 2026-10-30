#!/usr/bin/env bash
# Simulate voice's default catalog: for each platform, each memory tier (powers
# of two from 4 GB) and each model class, ask llmfit what fits and take one
# opinion. Each generative class gets two picks: the class itself (System 2:
# the biggest that clears the speed floor) and `<class>/sys1`, its fast twin
# (small and quick, resident beside it). `sys1` on its own is the decision
# model: a Jev-Style release, which llmfit does not know. llmfit supplies fit, memory and speed estimates; the opinion (which
# publishers we trust, the speed floor per class, the memory headroom, how to
# rank) is ours and lives in this file.
#
#   scripts/catalog-sim.sh            # rewrites docs/catalog-sim.md, the capture
#   OUT=/tmp/x.md TIERS="64 128" scripts/catalog-sim.sh
#
# Needs llmfit (brew install llmfit), jq and bc. Read-only.
set -euo pipefail
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

OUT=${OUT:-$(cd "$(dirname "$0")/.." && pwd)/docs/catalog-sim.md}
TIERS=${TIERS:-"4 8 16 32 64 128 256 512"}
CLASSES=${CLASSES:-"chat coding reasoning multimodal embedding"}
# Picks that cannot ship, as "os<TAB>tier<TAB>model<TAB>why": written by
# scripts/catalog-recipes.py, skipped here at that os and tier.
# scripts/catalog-refresh.sh runs the two until nothing new is blocked.
BLOCKED=${BLOCKED:-$(cd "$(dirname "$0")/.." && pwd)/docs/catalog-blocked.tsv}
# Released on or after this date: the catalog ships the current generation.
SINCE=${SINCE:-2025-04-01}

# What voice can serve today: text in, text out over /v1/responses and
# /v1/chat/completions, GGUF on llama.cpp. Every class is still simulated
# (the plan); scripts/catalog-recipes.sh takes only the servable rows: chat,
# coding, reasoning and their /sys1 twins (the awk after the sweep).

# Publishers whose own releases we would ship. Matched on the repo's org.
TRUSTED='^(Qwen|google|microsoft|meta-llama|deepseek-ai|mistralai|openai|nvidia|ibm-granite|zai-org|LiquidAI|allenai|BAAI|nomic-ai|moonshotai|MiniMaxAI|CohereLabs|CohereForAI|jinaai|stepfun-ai|XiaomiMiMo|tencent|baidu|HuggingFaceTB|mixedbread-ai|Snowflake|Alibaba-NLP)/'
# Repackagings of a model we would take from its publisher instead.
REPACK='(GPTQ|AWQ|FP8|Int4|Int8|bnb|MLX|-mlx|NVFP4|W4A16|w4a16|W8A8|-ct$)'
# Specialists that land in a general bucket: not a default for the class.
NICHE='(Math|Guard|[Mm]ed|[Ss]afe|Prover|Lean|-[Bb]ase$|Base-|Embed|Reward|Distill-Qwen-1|Diffusion|Encoder|OCR|ocr|Parse|RADIO|t5gemma|Emo_|World|Cosmos|Research|Labs|preview|FP4|Local|UI2Code)'
# Below this the quantization costs more than the larger model gains.
LOWQUANT='^(Q2|Q3|IQ[123])'

# The class's llmfit use cases.
usecases() { case $1 in chat) echo "general chat" ;; *) echo "$1" ;; esac; }

# Decode tokens/s below which a class is not worth serving.
floor() { case $1 in coding|reasoning) echo 25 ;; chat) echo 15 ;; multimodal) echo 12 ;; *) echo 0 ;; esac; }

# Hardware per tier: "unified bandwidth_GBps". osx is Apple silicon (base,
# Pro, Max, Ultra as memory grows); linux is what a node would plausibly be
# at that size: one NVIDIA card, then unified boxes (Strix Halo, DGX Spark),
# then multi-card. linux is scored as discrete memory throughout: a unified
# profile scored on a Mac makes llmfit choose MLX. Edit to taste.
hw() {
  case $1:$2 in
    osx:4|osx:8|osx:16) echo "true 120" ;;
    osx:32)             echo "true 273" ;;
    osx:64|osx:128)     echo "true 546" ;;
    osx:*)              echo "true 819" ;;
    linux:4)            echo "false 192" ;;
    linux:8)            echo "false 272" ;;
    linux:16)           echo "false 448" ;;
    linux:32)           echo "false 1792" ;;
    linux:64)           echo "false 256" ;;
    linux:128)          echo "false 273" ;;
    linux:*)            echo "false 1792" ;;
  esac
}

# A fast twin must be this many times quicker than the class floor, and fit in
# this share of the budget (at most SYS1_MAX_GB): it stays resident.
SYS1_SPEEDUP=${SYS1_SPEEDUP:-3}
SYS1_SHARE=${SYS1_SHARE:-0.20}
SYS1_MAX_GB=${SYS1_MAX_GB:-16}

# Jev-Style decision releases (jev_style.models.RELEASES, v3), GGUF builds at
# their pinned revisions: "release params quant GB released", best first. They answer
# /v1/systemone (noul / choice / score), not chat, and the GGUF build needs the
# jev-score scorer (jev-score-v2 for 2B), not llama-server. In jevsploration
# the 2B was as accurate as the 0.8B and faster on MLX, so it wins when it fits.
JEV='jev-style-2b-decision-v3 2B Q8_0 2.01 2026-09-27
jev-style-2b-decision-v3 2B Q4_K_M 1.27 2026-09-27
jev-style-0.8b-decision-v3 0.8B Q8_0 0.81 2026-09-24
jev-style-0.8b-decision-v3 0.8B Q4_K_M 0.53 2026-09-24'

# Share of the tier a model may take: the rest is the OS, the KV cache, the
# other residents. Unified memory gives up more to the OS.
headroom() { [ "$1" = true ] && echo 0.70 || echo 0.90; }

# llmfit scores against this machine. --profile cannot be combined with
# --memory or --force-runtime, and a profile does not move the GPU memory it
# scores against, so every tier runs here with memory overridden and llama.cpp
# forced (voice serves GGUF through llama.cpp on Metal and CUDA; vLLM is not
# simulated), and speed is rescaled from this machine's bandwidth to the
# tier's. So linux differs from osx only in bandwidth and headroom here;
# multi-card tensor parallel is not modelled.
host_bw=$(llmfit --memory 8G recommend --no-dashboard -n 1 --force-runtime llamacpp \
  | jq -r '.system.gpus[0].memory_bandwidth_gbps // 400')

# One llmfit call per budget and bandwidth, every use case at once (each
# --use-case is one `category`), kept in SIM_CACHE with the filters that do
# not depend on the class already applied (publisher, repackaging, release
# date, on the accelerator, quantization): catalog-refresh.sh shares it
# across rounds, where only the blocked picks change.
SIM_CACHE=${SIM_CACHE:-$tmp}
llmfit_version=$(llmfit --version | awk '{print $2}')
filters=$(printf '%s' "$TRUSTED$REPACK$SINCE$LOWQUANT" | shasum | cut -c1-8)
candidates() { # budget_gb class bw
  local g=$1 class=$2 bw=$3 f="$SIM_CACHE/llmfit-${llmfit_version}-${filters}-${1}g-${3}.json"
  if [ ! -s "$f" ]; then
    llmfit --memory "${g}G" --ram "${g}G" recommend --no-dashboard -n 100000 \
      --force-runtime llamacpp --min-fit good \
      | jq -c --argjson k "$(echo "$bw / $host_bw" | bc -l)" --arg trusted "$TRUSTED" --arg repack "$REPACK" \
          --arg since "$SINCE" --arg lowq "$LOWQUANT" '
        [ .models[]
          | select((.name | test($trusted)) and (.name | test($repack) | not))
          | select((.release_date // "") >= $since and .run_mode == "GPU" and ((.best_quant // "") | test($lowq) | not))
          | {name, category, params_b, parameter_count, is_moe, best_quant, memory_required_gb, release_date,
             estimated_tps: (.estimated_tps * $k)} ]' > "$f.part"
    mv "$f.part" "$f"
  fi
  jq -c --arg cats "$(usecases "$class")" \
    '($cats | split(" ") | map((.[:1] | ascii_upcase) + .[1:])) as $want
     | .[] | select(.category as $c | $want | index($c))' "$f"
}

# The opinion (publisher, repackaging, generation, quantization and
# whole-on-the-accelerator already applied in candidates): not a specialist,
# at or above the class's speed floor, inside the cap, not blocked; then the
# most parameters (the best proxy for quality llmfit has: its own quality
# score saturates), then the newest.
# Fast twins use the same rule under a tighter floor and cap.
# Embeddings stay resident beside the chat model, so the
# smallest current one from a trusted publisher at >= 0.5B wins instead.
pick() { # class floor cap_gb excluded_json
  jq -s -r --argjson cap "$3" --argjson excl "${4:-[]}" --arg niche "$NICHE" \
    --arg class "$1" --argjson floor "$2" '
    [ .[] | select($class == "embedding" or (.name | test($niche) | not))
          | select(.estimated_tps >= $floor and .memory_required_gb <= $cap)
          | select(.name as $n | $excl | index($n) | not) ]
    | unique_by(.name)
    | if $class == "embedding"
      then map(select(.params_b >= 0.5)) | sort_by([.params_b, (.release_date | explode | map(-.))])
      else sort_by([-.params_b, (.release_date | explode | map(-.))]) end
    | first
    | if . == null then "-\t-\t-\t-\t-\t-\t-"
      else [.name, .parameter_count, (if .is_moe then "moe" else "dense" end), .best_quant,
            (.memory_required_gb*10|round/10), (.estimated_tps|round), .release_date] | @tsv end'
}

printf 'os\ttier_gb\tclass\tmodel\tparams\tarch\tquant\tmem_gb\ttps\treleased\n' > "$tmp/rows.tsv"
for os in osx linux; do
  for g in $TIERS; do
    read -r unified bw <<<"$(hw "$os" "$g")"
    budget=$(echo "$g * $(headroom "$unified")" | bc -l | xargs printf '%.1f')
    sys1_cap=$(echo "c=$budget * $SYS1_SHARE; if (c > $SYS1_MAX_GB) c=$SYS1_MAX_GB; c" | bc -l)
    excl=$(if [ -f "$BLOCKED" ]; then awk -F'\t' -v o="$os" -v t="$g" '$1 == o && $2 == t { print $3 }' "$BLOCKED"; fi \
      | jq -R . | jq -s -c .)
    for class in $CLASSES; do
      candidates "$budget" "$class" "$bw" > "$tmp/c.json"
      f=$(floor "$class")
      row=$(pick "$class" "$f" "$budget" "$excl" < "$tmp/c.json")
      # Nothing of its own: coding and reasoning fall back to the chat pick.
      case $class in coding|reasoning) [ "${row%%$'\t'*}" = - ] && [ "${chat_row%%$'\t'*}" != - ] && row="${chat_row/$'\t'/ (chat)$'\t'}" ;; esac
      [ "$class" = chat ] && chat_row=$row
      printf '%s\t%s\t%s\t%s\n' "$os" "$g" "$class" "$row" >> "$tmp/rows.tsv"
      [ "$class" = embedding ] && continue
      twin=$(pick "$class" "$((f * SYS1_SPEEDUP))" "$sys1_cap" "$excl" < "$tmp/c.json")
      case $class in coding|reasoning) [ "${twin%%$'\t'*}" = - ] && [ "${chat_twin%%$'\t'*}" != - ] && twin="${chat_twin/$'\t'/ (chat)$'\t'}" ;; esac
      [ "$class" = chat ] && chat_twin=$twin
      printf '%s\t%s\t%s\t%s\n' "$os" "$g" "$class/sys1" "$twin" >> "$tmp/rows.tsv"
    done
    # The decision model: the best Jev release that fits the sys1 share.
    jev=$(awk -v cap="$sys1_cap" '$4 <= cap { print; exit }' <<<"$JEV")
    if [ -n "$jev" ]; then
      read -r name params quant gb date <<<"$jev"
      printf '%s\t%s\tsys1\t%s\t%s\tdense\t%s\t%s\t-\t%s\n' "$os" "$g" "$name" "$params" "$quant" "$gb" "$date" >> "$tmp/rows.tsv"
    else
      printf '%s\t%s\tsys1\t-\t-\t-\t-\t-\t-\t-\n' "$os" "$g" >> "$tmp/rows.tsv"
    fi
  done
done

awk -F'\t' -v OFS='\t' '
  function servable(c) { return c ~ /^(chat|coding|reasoning)(\/sys1)?$/ ? "yes" : "no" }
  NR == 1 { print $0, "servable"; next } { print $0, servable($3) }' "$tmp/rows.tsv" > "$tmp/rows2.tsv"
mv "$tmp/rows2.tsv" "$tmp/rows.tsv"

# The capture: what produced it, then one table per platform.
{
  echo "# Catalog simulation"
  echo
  echo "Generated by \`scripts/catalog-sim.sh\`; rerun it to refresh. Do not edit by hand."
  echo
  echo "- date: $(date -u +%Y-%m-%d)"
  echo "- llmfit: $(llmfit --version | awk '{print $2}')"
  echo "- tiers: $TIERS GB; released since $SINCE; twins ${SYS1_SPEEDUP}x the class floor in ${SYS1_SHARE} of the budget (at most ${SYS1_MAX_GB} GB)"
  echo
  echo "How it was scored:"
  echo
  echo "- Every row, osx and linux, was scored by llmfit on one machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m) at ${host_bw} GB/s, with memory overridden to the tier's budget and the llama.cpp runtime forced (GGUF, what voice serves on Metal and CUDA). vLLM is not simulated."
  echo "- linux is that same run, not scored on Linux hardware: it differs from osx only in bandwidth and headroom (90% of the tier on discrete memory, 70% on unified)."
  echo "- Bandwidth per tier is a guess at the machine a node would be. osx: base M (120 GB/s) to 16, Pro (273) at 32, Max (546) at 64 and 128, Ultra (819) above. linux: one card to 32 (a 32 GB RTX 5090 is 1792 GB/s), unified boxes at 64 (Strix Halo, 256) and 128 (DGX Spark, 273), multi-card (1792) above. So linux:32 is faster than linux:64 and 128 on purpose: a 5090 out-reads a Spark; the Spark holds more."
  echo "- tok/s are llmfit's decode estimates rescaled by that bandwidth, not measurements. Voice records measured tok/s per request (voice#72); a later pass can check these picks against it."
  echo
  echo "Reading it: \`<class>\` is the System 2 pick, \`<class>/sys1\` its fast twin, \`sys1\` the Jev decision model."
  echo "\`(chat)\`: the class had nothing of its own and takes the chat pick. \`-\`: nothing fits."
  echo "Blocked: $(if [ -f "$BLOCKED" ]; then wc -l < "$BLOCKED" | tr -d ' '; else echo 0; fi) picks that cannot ship (docs/catalog-blocked.tsv) were skipped, so the next candidate stands at that tier."
  echo "\`servable\`: voice can serve the class today (text only, no /v1/embeddings, no /v1/systemone); \`scripts/catalog-recipes.sh\` takes only these rows."
  for os in osx linux; do
    echo
    echo "## $os"
    echo
    echo "| tier GB | class | model | params | arch | quant | mem GB | tok/s | released | servable |"
    echo "|---|---|---|---|---|---|---|---|---|---|"
    awk -F'\t' -v os="$os" '$1 == os { printf "|"; for (i = 2; i <= NF; i++) printf " %s |", $i; print "" }' "$tmp/rows.tsv"
  done
} > "$OUT"

column -t -s $'\t' "$tmp/rows.tsv"
echo "wrote $OUT" >&2
