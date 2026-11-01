#!/bin/sh
# archive.sh OUT NAME: OUT/decision-runtime (build.sh's, with voice-decide)
# as OUT/NAME, a gzipped tar that the same files always make byte for byte:
# entries in byte order, owned by root, dated by the source's commit. A node
# unpacks it and runs decision-runtime/voice-decide.
set -eu
out=${1:?usage: archive.sh OUT NAME}
name=${2:?usage: archive.sh OUT NAME}
[ -x "$out/decision-runtime/voice-decide" ] || { echo "no voice-decide in $out/decision-runtime" >&2; exit 1; }
epoch=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}
find "$out/decision-runtime" -exec touch -h -t "$(date -r "$epoch" +%Y%m%d%H%M.%S)" {} +
(cd "$out" && find decision-runtime -print0 | LC_ALL=C sort -z \
  | tar --null -T - --no-recursion --uid 0 --gid 0 --uname root --gname wheel -cf - | gzip -n -9 > "$out/$name")
echo "$(shasum -a 256 "$out/$name" | cut -d' ' -f1) $(stat -f %z "$out/$name") $out/$name"
