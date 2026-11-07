#!/bin/bash
# The TensorFold runtime's engine archive (runtimes/tensorfold): DeepSeek-V4.1's
# dsv41 family on TensorFold's native Zig engine, built from source for the
# DGX Spark (aarch64, sm_121), with voice's patches (patches/), the grammar
# library built from xgrammar's source, and the recipe's two input tools.
#
#   build.sh ENGINE XGRAMMAR RECIPE OUT
#
# ENGINE   a checkout of bertholomus/TensorFold at the pinned commit, voice's
#          patches applied (the workflow does both)
# XGRAMMAR a checkout of mlc-ai/xgrammar at its pinned tag, with submodules
# RECIPE   the recipe's files the node runs to ready a model: serving_1017.py
#          and chat_template.jinja, with its LICENSE (the workflow fetches them
#          by sha256)
# OUT      where the archive is written: tensorfold-<version>-linux-arm64.tar.gz
#
# Run inside the CUDA build image the runtime pins (its nvcc, its glibc), with
# zig on PATH. Nothing here needs a GPU: `zig build test` runs the host-side
# unit tests. The archive holds the engine's programs and the files they read
# beside them, never weights, kernels the recipe's kit ships, or the image.
set -euo pipefail
src=${1:?ENGINE}; xg=${2:?XGRAMMAR}; recipe=${3:?RECIPE}; out=${4:?OUT}
: "${TENSORFOLD_VERSION:?the runtime version, e.g. 0.7.5}"
flags=(-Dtarget=aarch64-linux-gnu.2.28 -Doptimize=ReleaseFast -Dnvcc=/usr/local/cuda/bin/nvcc -Dsm=121)

cd "$src"
zig build install native "${flags[@]}"
zig build test
zig build fatbins "${flags[@]}"
zig build grammar -Dxgrammar="$xg" -Dtarget=aarch64-linux-gnu.2.28

name="tensorfold-$TENSORFOLD_VERSION"
stage=$(mktemp -d)/$name
mkdir -p "$stage/bin" "$stage/lib" "$stage/tools" "$stage/LICENSES"
install -m 0755 zig-out/native/bin/tensorfold-native zig-out/bin/tf-dsv41-lanes zig-out/bin/tf-dsv41-rank-cache "$stage/bin/"
# the RDMA ring's kernels for sm_121 (TF_DS_RDMA_KERNELS), as the recipe passes them
install -m 0644 zig-out/fatbin/dsv41_rdma.fatbin "$stage/bin/rdma_gather.fatbin"
install -m 0644 zig-out/lib/libtfgrammar.so "$stage/lib/"
# the node's prepare step: the rank caches and token map (node_inputs.sh runs
# tf-dsv41-rank-cache beside it and make_token_map.py), the model folder's two
# added files (serving_1017.py, the chat template)
install -m 0755 tools/dsv41-zig/inputs/node_inputs.sh "$stage/tools/"
install -m 0644 tools/dsv41-zig/inputs/make_token_map.py "$stage/tools/"
install -m 0644 "$recipe/serving_1017.py" "$recipe/chat_template.jinja" "$stage/tools/"
install -m 0644 LICENSE NOTICE ATTRIBUTION.md "$stage/LICENSES/"
cp -r LICENSES/. "$stage/LICENSES/"
install -m 0644 "$recipe/LICENSE" "$stage/LICENSES/recipe-Apache-2.0.txt"
install -m 0644 "$xg/LICENSE" "$stage/LICENSES/xgrammar-Apache-2.0.txt"
install -m 0644 "$xg/NOTICE" "$stage/LICENSES/xgrammar-NOTICE.txt"
git -C "$src" rev-parse HEAD > "$stage/ENGINE_COMMIT"
git -C "$src" diff --stat > "$stage/PATCHES"

# every program runs: no library it needs is missing from the image
for p in "$stage"/bin/tensorfold-native "$stage"/bin/tf-dsv41-lanes "$stage"/bin/tf-dsv41-rank-cache "$stage"/lib/libtfgrammar.so; do
  if ldd "$p" | grep -q 'not found'; then echo "$p: a library is missing" >&2; ldd "$p" >&2; exit 1; fi
done

mkdir -p "$out"
# flat: the node mounts the unpacked archive at /engine, its programs in bin/
tar -C "$stage" --owner=0 --group=0 --numeric-owner --sort=name --mtime=@0 -czf "$out/$name-linux-arm64.tar.gz" .
sha256sum "$out/$name-linux-arm64.tar.gz"
