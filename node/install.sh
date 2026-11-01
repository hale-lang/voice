#!/bin/sh
# node/install.sh install|uninstall ARGS...: the node's install as a
# habitat runs it (hale.toml [dna.host.node]), with the voice-node built for
# the revision the habitat grafted rather than one compiled here:
#
# - Linux: voice-node from voice's image for that commit,
#   ghcr.io/hale-lang/voice:$HALE_DNA_REVISION (.github/workflows/image.yml),
#   taken out of it with docker, which a Linux node has already.
# - macOS on Apple silicon: the darwin build published beside it,
#   ghcr.io/hale-lang/voice-node:$HALE_DNA_REVISION-darwin-arm64, one layer
#   holding the binary, fetched with curl and checked against the layer's
#   sha256 before it runs.
# - Otherwise (no revision handed, none published for it, another
#   platform): compiled from this source with the hale toolchain,
#   `hale run node`, as before.
#
# Either way the program runs with the arguments given; `install` copies
# itself into place as <voice>/bin/voice-node (node/install.hl). It says
# which it took, on stderr. Exit codes: 0 done, 2 a bad argument, 1 failed.
set -eu

case "${1:-}" in
    install | uninstall) ;;
    *)
        echo "usage: node/install.sh install|uninstall --id ID --api URL [...]" >&2
        exit 2
        ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
rev=${HALE_DNA_REVISION:-}
registry=${VOICE_NODE_REGISTRY:-https://ghcr.io}
work=$(mktemp -d "${TMPDIR:-/tmp}/voice-node.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM

say() { echo "voice-node: $*" >&2; }

# the revision as a full commit sha, or nothing
case "$rev" in
    *[!0-9a-f]* | "") rev="" ;;
esac
[ "${#rev}" = 40 ] || rev=""

# Linux: the image's own voice-node
from_image() {
    command -v docker >/dev/null 2>&1 || return 1
    image="ghcr.io/hale-lang/voice:$rev"
    docker pull -q "$image" >/dev/null 2>&1 || return 1
    cid=$(docker create "$image") || return 1
    docker cp "$cid:/usr/local/bin/voice-node" "$work/voice-node" >/dev/null 2>&1
    ok=$?
    docker rm "$cid" >/dev/null 2>&1 || true
    [ "$ok" = 0 ] || return 1
    chmod 755 "$work/voice-node"
    say "prebuilt, from $image"
}

# macOS arm64: the artifact's one layer, its sha256 checked
from_artifact() {
    repo=hale-lang/voice-node
    tag="$rev-darwin-arm64"
    token=$(curl -fsS "$registry/token?scope=repository:$repo:pull" 2>/dev/null \
        | tr -d ' \n' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p') || return 1
    [ -n "$token" ] || return 1
    curl -fsS -H "Authorization: Bearer $token" \
        -H "Accept: application/vnd.oci.image.manifest.v1+json" \
        "$registry/v2/$repo/manifests/$tag" -o "$work/manifest" 2>/dev/null || return 1
    digest=$(tr -d ' \n\t\r' <"$work/manifest" \
        | sed -n 's/.*"layers":\[{[^}]*"digest":"\(sha256:[0-9a-f]\{64\}\)".*/\1/p')
    [ -n "$digest" ] || return 1
    curl -fsSL -H "Authorization: Bearer $token" \
        "$registry/v2/$repo/blobs/$digest" -o "$work/voice-node" 2>/dev/null || return 1
    got="sha256:$(shasum -a 256 "$work/voice-node" | cut -d' ' -f1)"
    if [ "$got" != "$digest" ]; then
        # what was published is not what arrived: never run it
        say "the download of $repo:$tag is not the layer its manifest names ($got, not $digest)"
        exit 1
    fi
    chmod 755 "$work/voice-node"
    say "prebuilt, from $repo:$tag ($digest)"
}

prebuilt=""
if [ -n "$rev" ]; then
    case "$(uname -s)/$(uname -m)" in
        Linux/*) from_image && prebuilt=1 || true ;;
        Darwin/arm64) from_artifact && prebuilt=1 || true ;;
    esac
fi

if [ -n "$prebuilt" ]; then
    # not exec: the trap removes the temporary copy once it has installed
    # itself (or uninstalled)
    "$work/voice-node" "$@"
    exit $?
fi

# the toolchain: on PATH, else where hale installs it for this account or
# for the one sudo ran as (a habitat need not put it on PATH)
hale=$(command -v hale 2>/dev/null || true)
sudo_home=""
case "${SUDO_USER:-}" in
    "" | *[!A-Za-z0-9._-]* | -*) ;;
    *) sudo_home=$(eval echo "~$SUDO_USER") ;;
esac
for h in "$HOME/.hale/bin/hale" "${sudo_home:-/nonexistent}/.hale/bin/hale"; do
    [ -n "$hale" ] || { [ -x "$h" ] && hale=$h; }
done
[ -n "$hale" ] || {
    say "no prebuilt voice-node for ${rev:-this checkout} on $(uname -s)/$(uname -m), and no hale toolchain to build one"
    exit 1
}
say "built here from source (hale run node): ${rev:+none published for $rev on $(uname -s)/$(uname -m)}${rev:-no revision handed}"
cd "$here"
"$hale" run node "$@"
