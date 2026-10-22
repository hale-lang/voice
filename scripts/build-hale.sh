#!/usr/bin/env bash
# Build the Hale toolchain from hale-lang/hale at one commit and install it.
#
#   scripts/build-hale.sh [<sha> [<dest>]]
#
# <sha> defaults to the commit in hale.pin; <dest> to ~/.hale/bin. It installs
# `hale` and `libhale_ts_shim.a` there (and, on macOS, the dylibs hale loads
# from its own directory), as hale's release tarball carries them. The steps
# are hale's own release.yml: the whole workspace is built, because the ts
# shim is a staticlib no other crate depends on.
#
# Needs git, Rust (cargo), and LLVM 18 development files:
#   Linux: apt-get install llvm-18-dev libpolly-18-dev libzstd-dev clang-18 libclang-18-dev zlib1g-dev
#   macOS: brew install llvm@18 zstd
set -euo pipefail
cd "$(dirname "$0")/.."
sha=${1:-$(tr -d '[:space:]' < hale.pin)}
dest=${2:-$HOME/.hale/bin}
case "$sha" in
  [0-9a-f]*) [ ${#sha} -eq 40 ] || { echo "build-hale: $sha is not a full commit SHA" >&2; exit 2; } ;;
  *) echo "build-hale: $sha is not a full commit SHA" >&2; exit 2 ;;
esac

case "$(uname -s)" in
  Linux) prefix=${LLVM_SYS_180_PREFIX:-/usr/lib/llvm-18} ;;
  Darwin) prefix=${LLVM_SYS_180_PREFIX:-$(brew --prefix llvm@18)} ;;
  *) echo "build-hale: unsupported OS" >&2; exit 1 ;;
esac
export LLVM_SYS_180_PREFIX=$prefix

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git -C "$src" init -q
git -C "$src" fetch -q --depth 1 https://github.com/hale-lang/hale "$sha"
git -C "$src" checkout -q FETCH_HEAD
(cd "$src" && cargo build --release --workspace)

mkdir -p "$dest"
bin=$src/target/release
if [ "$(uname -s)" = Darwin ]; then
  # vendor the homebrew dylibs beside hale (release.yml, "Vendor libunwind")
  for pass in 1 2; do
    for f in "$bin/hale" "$bin"/*.dylib; do
      [ -e "$f" ] || continue
      for lib in $(otool -L "$f" | awk '/\/opt\/homebrew|\/usr\/local\/Cellar/ {print $1}'); do
        base=$(basename "$lib")
        [ -e "$bin/$base" ] || cp "$lib" "$bin/$base"
        install_name_tool -change "$lib" "@executable_path/$base" "$f"
      done
    done
  done
  for d in "$bin"/*.dylib; do
    [ -e "$d" ] || continue
    install_name_tool -id "@executable_path/$(basename "$d")" "$d"
    codesign --force --sign - "$d"
  done
  codesign --force --sign - "$bin/hale"
  cp "$bin"/*.dylib "$dest"/ 2>/dev/null || true
fi
cp "$bin/hale" "$bin/libhale_ts_shim.a" "$dest"/
"$dest/hale" --version
