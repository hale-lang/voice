#!/usr/bin/env bash
# Put a Linux hale toolchain in .hale-toolchain/, which the Dockerfile copies
# into the image build (no LLVM is compiled in the image).
#
#   scripts/hale-toolchain.sh                 build hale at the commit in hale.pin
#   scripts/hale-toolchain.sh --release v0.28.0   or take a released tarball
#
# Then: docker compose build
set -euo pipefail
cd "$(dirname "$0")/.."
out=.hale-toolchain
rm -rf "$out" && mkdir -p "$out"
if [ "${1:-}" = --release ]; then
  v=${2:?usage: hale-toolchain.sh --release <tag>}
  case "$(uname -m)" in x86_64) arch=x86_64 ;; aarch64|arm64) arch=aarch64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
  name=hale-$v-$arch-unknown-linux-gnu.tar.gz
  base=https://github.com/hale-lang/hale/releases/download/$v
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  (cd "$tmp" && curl -fsSLO "$base/$name" && curl -fsSLO "$base/$name.sha256" && sha256sum -c "$name.sha256" && tar xzf "$name" ./hale ./libhale_ts_shim.a)
  cp "$tmp/hale" "$tmp/libhale_ts_shim.a" "$out"/
else
  scripts/build-hale.sh "$(tr -d '[:space:]' < hale.pin)" "$out"
fi
