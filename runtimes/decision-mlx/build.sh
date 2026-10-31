#!/usr/bin/env bash
# Build voice's decision runtime archive for MLX (runtimes/decision-0.3.0-mlx.json):
# a standalone CPython, Jev-Style 0.3.0 and MLX from hash-locked wheels, the
# release's own runtime file pinned by its sha256, and a launcher. Nothing in
# it is fetched at run time, and a model download brings no code: the
# runtime file a Jev-Style release ships beside its weights is this one,
# reviewed and pinned, never the copy in the download.
#
#   runtimes/decision-mlx/build.sh OUT_DIR
#
# Runs on macOS 14 and later. Writes
# OUT_DIR/decision-0.3.0-mlx-darwin-arm64.tar.gz and prints its
# sha256 and size. Byte for byte the same each run: files in name order,
# owned by 0:0, dated SOURCE_DATE_EPOCH, no bytecode. Runs on macOS arm64.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: build.sh OUT_DIR}
mkdir -p "$out"
out=$(cd "$out" && pwd)
# a fixed place: pip writes the build's own path into the console scripts it
# installs (and their hashes into each RECORD), so the same path each run is
# the same bytes each run; the launcher runs `python -m`, never those scripts
work=/tmp/voice-decision-mlx-build
rm -rf "$work"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

# CPython 3.12, python-build-standalone's install_only build
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.12.16%2B20261026-aarch64-apple-darwin-install_only.tar.gz"
PY_SHA256=fbf4afef53c2a6b72bb741bc06d5671a9dfaf87bd84e5aa73ac9b3d0d589f14e
# each release's runtime file, at the commit its recipe pins, by its sha256:
# "<repo> <commit> <sha256>"; the launcher picks the one the weights' repo is
RUNTIME_FILES="chaoliangUNSW/Jev-Style-2B-Decision-v3-MLX 11ce5d718e22412b38624bb863a1eee73c0a5934 025daab9b374d740e743c519bd3aa3385791e08c81f4515b2ae525af57788030
chaoliangUNSW/Jev-Style-0.8B-Decision-v3-MLX 7f14c9fa1491d168a7f70b16acf68baf9d4f7353 e4670140ee8a2b6a38e0d19c2c71bc103633a4fabf5402ac988deb57de3cfd48"
SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-1793404800}

fetch() { curl -fsSL --retry 3 -o "$2" "$1"; echo "$3  $2" | shasum -a 256 -c - >/dev/null || { echo "build.sh: $1 is not the pinned file" >&2; exit 1; }; }

root="$work/decision-0.3.0-mlx"
mkdir -p "$root/share/licenses"
fetch "$PY_URL" "$work/python.tar.gz" "$PY_SHA256"
tar -xzf "$work/python.tar.gz" -C "$root"
while read -r repo commit sha; do
  mkdir -p "$root/share/$repo"
  fetch "https://huggingface.co/$repo/resolve/$commit/jev_style_decision_mlx.py" "$root/share/$repo/jev_style_decision_mlx.py" "$sha"
done <<<"$RUNTIME_FILES"
# the wheels for macOS 14, whatever macOS builds it: a package with a wheel
# per macOS version (MLX) would otherwise take the builder's, so the archive
# would differ by where it was built and not run on an older node
PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 "$root/python/bin/python3" -m pip install -q \
  --no-deps --require-hashes --only-binary :all: --no-compile \
  --platform macosx_14_0_arm64 --python-version 3.12 --implementation cp --abi cp312 \
  --target "$root/python/lib/python3.12/site-packages" --upgrade \
  -r "$here/requirements.lock"
"$root/python/bin/python3" -c 'import jev_style, mlx.core, mlx_lm, fastapi, uvicorn'
# at the top, where a node looks for a runtime's program
install -m 0755 "$here/voice-decide" "$root/voice-decide"
# every package's license, as each distribution states it
"$root/python/bin/python3" - "$root/share/licenses" <<'PY'
import importlib.metadata as md, pathlib, sys
out = pathlib.Path(sys.argv[1])
for d in sorted(md.distributions(), key=lambda d: d.metadata["Name"].lower()):
    name = d.metadata["Name"]
    files = [f for f in (d.files or []) if f.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE"))]
    text = "\n\n".join(pathlib.Path(f.locate()).read_text(errors="replace") for f in files if pathlib.Path(f.locate()).exists())
    meta = d.metadata.get("License-Expression") or d.metadata.get("License") or ""
    (out / f"{name}.txt").write_text(f"{name} {d.version}\nLicense: {meta}\n\n{text}")
PY
# no bytecode, no caches: what runs is the source shipped
find "$root" -name '__pycache__' -type d -prune -exec rm -rf {} +
find "$root" -exec touch -h -t "$(date -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)" {} +
name=decision-0.3.0-mlx-darwin-arm64.tar.gz
(cd "$work" && find decision-0.3.0-mlx -print0 | LC_ALL=C sort -z \
  | tar --null -T - --no-recursion --uid 0 --gid 0 --uname root --gname wheel -cf - | gzip -n -9 > "$out/$name")
echo "$(shasum -a 256 "$out/$name" | cut -d' ' -f1) $(stat -f %z "$out/$name") $out/$name"
