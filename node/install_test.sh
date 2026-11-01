#!/bin/sh
# node/install_test.sh: node/install.sh's paths. Everywhere: its fallback
# finds the toolchain voice pins where a habitat provisions it, with no hale
# on PATH, and builds with it; a bad subcommand is 2. On a Mac on Apple
# silicon (CI's macOS job), its macOS path against a registry of our own on
# loopback: the artifact for a revision is fetched, checked against its
# layer's sha256 and run with the arguments given; one whose download is not
# its layer is never run. VOICE_NODE_REGISTRY points the script at the
# fixture.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
fx=$(mktemp -d)
srv=""
trap 'kill "$srv" 2>/dev/null || true; rm -rf "$fx"' EXIT INT TERM

# a bad subcommand: 2
if sh "$here/install.sh" frobnicate 2>/dev/null; then echo "a bad subcommand was taken"; exit 1; fi
sh "$here/install.sh" frobnicate 2>/dev/null || [ $? = 2 ] || { echo "a bad subcommand is not exit 2"; exit 1; }

# no revision: built with the pinned toolchain from the habitat's place for
# it, found though no hale is on PATH
pin=$(sed -n 's/^toolchain *= *"\(v[^"]*\)".*/\1/p' "$here/../hale.toml" | head -n 1)
mkdir -p "$fx/home/.local/share/hale/toolchains/$pin/bin"
printf '#!/bin/sh\necho "hale: $*"\n' >"$fx/home/.local/share/hale/toolchains/$pin/bin/hale"
chmod 755 "$fx/home/.local/share/hale/toolchains/$pin/bin/hale"
out=$(env -u HALE_DNA_REVISION -u SUDO_USER HOME="$fx/home" PATH=/usr/bin:/bin sh "$here/install.sh" install --id x --api http://a 2>"$fx/err")
[ "$out" = "hale: run node install --id x --api http://a" ] || { echo "the fallback did not build with the pinned toolchain: $out"; cat "$fx/err"; exit 1; }
grep -q "built here from source" "$fx/err" || { cat "$fx/err"; exit 1; }
# and none anywhere: 1, saying so
if env -u HALE_DNA_REVISION -u SUDO_USER HOME="$fx/nohome" PATH=/usr/bin:/bin sh "$here/install.sh" install --id x 2>"$fx/err"; then
    echo "with no toolchain and nothing published, the install went ahead"; exit 1
fi
grep -q "no hale toolchain" "$fx/err" || { cat "$fx/err"; exit 1; }

[ "$(uname -s)/$(uname -m)" = Darwin/arm64 ] || { echo "node/install.sh: its fallback and usage hold (the macOS path is checked on macOS arm64)"; exit 0; }
rev=0123456789abcdef0123456789abcdef01234567

# a stand-in voice-node: says what it was asked
printf '#!/bin/sh\necho "ran: $*"\n' >"$fx/good"
printf '#!/bin/sh\necho "TAMPERED"\n' >"$fx/bad"
digest="sha256:$(shasum -a 256 "$fx/good" | cut -d' ' -f1)"

cat >"$fx/serve.py" <<'PY'
import http.server, json, sys
fx, rev, digest, mode, port = sys.argv[1:6]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, ctype="application/json"):
        self.send_response(200); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        p = self.path
        if p.startswith("/token"):
            return self.send(json.dumps({"token": "anon"}).encode())
        if self.headers.get("Authorization") != "Bearer anon":
            self.send_response(401); self.end_headers(); return
        if p == f"/v2/hale-lang/voice-node/manifests/{rev}-darwin-arm64":
            m = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                 "config": {"mediaType": "application/vnd.oci.empty.v1+json",
                            "digest": "sha256:" + "4" * 64, "size": 2},
                 "layers": [{"mediaType": "application/vnd.voice.node.binary", "digest": digest,
                             "size": 1, "annotations": {"org.opencontainers.image.title": "voice-node"}}]}
            return self.send(json.dumps(m, indent=2).encode(), "application/vnd.oci.image.manifest.v1+json")
        if p == f"/v2/hale-lang/voice-node/blobs/{digest}":
            return self.send(open(f"{fx}/{mode}", "rb").read(), "application/octet-stream")
        self.send_response(404); self.end_headers()
http.server.HTTPServer(("127.0.0.1", int(port)), H).serve_forever()
PY

serve() {
    port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
    python3 "$fx/serve.py" "$fx" "$rev" "$digest" "$1" "$port" &
    srv=$!
    for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://127.0.0.1:$port/token" >/dev/null 2>&1 && break; sleep 0.2; done
}

# published: fetched, checked, run with the arguments given
serve good
out=$(HALE_DNA_REVISION=$rev VOICE_NODE_REGISTRY="http://127.0.0.1:$port" sh "$here/install.sh" install --id x --api http://a 2>"$fx/err")
[ "$out" = "ran: install --id x --api http://a" ] || { echo "the artifact did not run as asked: $out"; cat "$fx/err"; exit 1; }
grep -q "prebuilt, from hale-lang/voice-node:$rev-darwin-arm64 ($digest)" "$fx/err" || { cat "$fx/err"; exit 1; }
kill "$srv"; wait "$srv" 2>/dev/null || true

# a download that is not its layer: refused, never run
serve bad
if out=$(HALE_DNA_REVISION=$rev VOICE_NODE_REGISTRY="http://127.0.0.1:$port" sh "$here/install.sh" install --id x --api http://a 2>"$fx/err"); then
    echo "a tampered download was accepted: $out"; exit 1
fi
case "$out" in *TAMPERED*) echo "a tampered download ran"; exit 1 ;; esac
grep -q "is not the layer its manifest names" "$fx/err" || { cat "$fx/err"; exit 1; }
kill "$srv"; wait "$srv" 2>/dev/null || true

echo "node/install.sh: its fallback, the artifact path, its digest check and its usage hold"
