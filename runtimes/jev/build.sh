#!/bin/sh
# Builds Jev-Style's scorer, jev-score-v2 (jev_score_v2.cpp, vendored with
# voice's changes), for one backend, against llama.cpp at the commit the
# Jev-Style release was tested with:
#
#   runtimes/jev/build.sh metal|cpu|vulkan|rocm|cuda OUT_DIR
#
# OUT_DIR/jev-runtime holds the program and the llama.cpp libraries it
# loads, side by side (it finds them, and the backends built as their own
# libraries, beside itself), and the licenses. With JEV_SERVE_BIN, the
# built jev/ seed, it holds voice's server too, as jev-style-serve: the
# program a jev-style runtime is, which runs the scorer beside itself. metal builds on macOS arm64;
# the others on Linux, in the builder `runtimes/jev/Dockerfile` names for
# each, which holds their toolchains (CUDA, ROCm, the Vulkan SDK) to a
# digest.
set -eu

BACKEND=${1:?usage: build.sh metal|cpu|vulkan|rocm|cuda OUT_DIR}
OUT=${2:?usage: build.sh metal|cpu|vulkan|rocm|cuda OUT_DIR}

# the llama.cpp the release's parity figures are for (release_config.json)
LLAMA_REPO=https://github.com/ggml-org/llama.cpp
LLAMA_COMMIT=441df11f65ea0b6d0c72965aaf70c8241070ddcb

# the GPUs a ROCm build serves: RDNA2 to RDNA4 and the Instinct parts, as
# llama.cpp's own ROCm image does
ROCM_TARGETS='gfx908;gfx90a;gfx942;gfx1030;gfx1100;gfx1101;gfx1102;gfx1150;gfx1151;gfx1200;gfx1201'

HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK="$OUT/work"
DEST="$OUT/jev-runtime"

# Linux builds are portable: no tuning for the machine that builds, the
# CPU's code in a library per instruction set, loaded for the CPU it runs on
linux="-DGGML_NATIVE=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON"
case "$BACKEND" in
    metal)  flags="-DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BLAS=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0" ;;
    cpu)    flags="$linux" ;;
    vulkan) flags="$linux -DGGML_VULKAN=ON" ;;
    rocm)   flags="$linux -DGGML_HIP=ON -DGPU_TARGETS=$ROCM_TARGETS" ;;
    cuda)   flags="$linux -DGGML_CUDA=ON" ;;
    *)      echo "build.sh: no backend $BACKEND (metal, cpu, vulkan, rocm, cuda)" >&2; exit 2 ;;
esac
case "$BACKEND" in
    metal) [ "$(uname -s)" = Darwin ] || { echo "build.sh: metal builds on macOS" >&2; exit 2; } ;;
    *)     [ "$(uname -s)" = Linux ] || { echo "build.sh: $BACKEND builds on Linux" >&2; exit 2; } ;;
esac

# llama.cpp by commit: what git fetches is the commit that hash names
rm -rf "$WORK" "$DEST"
mkdir -p "$WORK/llama.cpp" "$DEST/licenses"
git -C "$WORK/llama.cpp" init -q
git -C "$WORK/llama.cpp" fetch -q --depth 1 "$LLAMA_REPO" "$LLAMA_COMMIT"
git -C "$WORK/llama.cpp" checkout -q FETCH_HEAD

# every library, and the program, finds the others beside itself, never in
# the build
if [ "$BACKEND" = metal ]; then origin=@loader_path; else origin='$ORIGIN'; fi
if [ "$BACKEND" = rocm ]; then
    export HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)"
fi
jobs=$( (nproc || sysctl -n hw.ncpu) 2>/dev/null )
# shellcheck disable=SC2086 # flags is a list
cmake -S "$WORK/llama.cpp" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON \
    -DLLAMA_BUILD_COMMON=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TOOLS=OFF \
    -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF \
    -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON -DCMAKE_INSTALL_RPATH="$origin" $flags
cmake --build "$WORK/build" --config Release -j "$jobs"

# the libraries, as built (a library and the links that name it)
find "$WORK/build/bin" -maxdepth 1 \( -name '*.so*' -o -name '*.dylib' \) -exec cp -P {} "$DEST" \;

rpath="-Wl,-rpath,$origin"
if [ "$BACKEND" = metal ]; then rpath="$rpath -mmacosx-version-min=14.0"; fi
# shellcheck disable=SC2086
"${CXX:-c++}" -std=c++17 -O2 -Wall -Wno-unused-function \
    -I"$WORK/llama.cpp/include" -I"$WORK/llama.cpp/ggml/include" -I"$WORK/llama.cpp/vendor" \
    "$HERE/jev_score_v2.cpp" -o "$DEST/jev-score-v2" \
    -L"$DEST" -lllama -lggml -lggml-base $rpath

if [ -n "${JEV_SERVE_BIN:-}" ]; then cp "$JEV_SERVE_BIN" "$DEST/jev-style-serve"; fi

cp "$HERE/LICENSE" "$DEST/licenses/jev-style.LICENSE"
cp "$HERE/NOTICE" "$DEST/licenses/jev-style.NOTICE"
cp "$WORK/llama.cpp/LICENSE" "$DEST/licenses/llama.cpp.LICENSE"
cp "$WORK/llama.cpp/licenses/LICENSE-jsonhpp" "$DEST/licenses/nlohmann-json.LICENSE"

rm -rf "$WORK"
echo "$DEST"
