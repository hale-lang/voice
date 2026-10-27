#!/usr/bin/env bash
# Two api instances on one Postgres, written at once.
#
#   DATABASE_URL=postgres://... scripts/race.sh
#
# The database is emptied first (its public schema dropped), so it must be
# one kept for testing. Checks:
#   - two `api migrate` runs at once both succeed;
#   - node PATCHes on one instance and seat PATCHes on the other, in
#     parallel, each move the node's assignment version on by one: the
#     final version is the first plus the number of writes;
#   - two PATCHes to different fields of one node, one on each instance,
#     both land.
#
# Needs api/api built, psql and python3.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL names a database to empty and race on}"
A_PORT=${A_PORT:-18190}
B_PORT=${B_PORT:-18191}
# each instance's runtime probes on a port of its own
A_PROBE_PORT=${A_PROBE_PORT:-18192}
B_PROBE_PORT=${B_PROBE_PORT:-18193}
N=${N:-40}
work=$(mktemp -d)
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

psql -q "$DATABASE_URL" -c 'SET client_min_messages = warning' -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public' >/dev/null

# two migrations at once
api/api migrate --database "$DATABASE_URL" --migrations store/migrations >"$work/m1.log" 2>&1 &
m1=$!
api/api migrate --database "$DATABASE_URL" --migrations store/migrations >"$work/m2.log" 2>&1 &
m2=$!
wait $m1 || { echo "the first migrate failed:"; cat "$work/m1.log"; exit 1; }
wait $m2 || { echo "the second migrate failed:"; cat "$work/m2.log"; exit 1; }
echo "two migrations at once: $(tail -1 "$work/m1.log"); $(tail -1 "$work/m2.log")"

# no NATS: the default address may be someone else's, and nothing here
# needs a node told anything
VOICE_PROBE_PORT="$A_PROBE_PORT" api/api --port "$A_PORT" --nats "" --database "$DATABASE_URL" >"$work/a.log" 2>&1 &
pids+=($!)
VOICE_PROBE_PORT="$B_PROBE_PORT" api/api --port "$B_PORT" --nats "" --database "$DATABASE_URL" >"$work/b.log" 2>&1 &
pids+=($!)
for port in "$A_PORT" "$B_PORT"; do
  for i in $(seq 1 50); do curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
done

# the admin plane takes the operator token both instances read from the
# database (api/operator.hl); it goes to the client in a file
api/api admin-token --database "$DATABASE_URL" >"$work/admin.token"

python3 - "$A_PORT" "$B_PORT" "$N" "$work/admin.token" <<'PY'
import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
a, b, n = f"http://127.0.0.1:{sys.argv[1]}", f"http://127.0.0.1:{sys.argv[2]}", int(sys.argv[3])
operator = open(sys.argv[4]).read().strip()

def call(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={"content-type": "application/json", "authorization": f"Bearer {operator}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.loads(r.read() or b"null")

call(a, "POST", "/admin/v1/accounts", {"id": "static", "name": "Static"})
call(a, "POST", "/admin/v1/nodes", {"id": "nv"})
call(a, "POST", "/admin/v1/nodes/nv/seats", {"id": "s", "engine": "static", "account": "static", "serves": [{"model": "echo-1"}], "config": {"text": "x"}})
start = call(a, "GET", "/admin/v1/nodes/nv")[1]["assignment_version"]

def node_write(i):
    return call(a, "PATCH", "/admin/v1/nodes/nv", {"name": f"n{i}"})[0]

def seat_write(i):
    return call(b, "PATCH", "/admin/v1/nodes/nv/seats/s", {"config": {"text": f"x{i}"}})[0]

with ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(node_write, i) for i in range(n)] + [pool.submit(seat_write, i) for i in range(n)]
    codes = [f.result() for f in futures]
assert all(c == 200 for c in codes), codes
end = call(a, "GET", "/admin/v1/nodes/nv")[1]["assignment_version"]
assert end == start + 2 * n, f"assignment version {start} -> {end}, expected {start + 2 * n}: bumps were lost"
print(f"{2 * n} concurrent writes on two instances: assignment version {start} -> {end}")

# two fields of one node, one on each instance, at once
with ThreadPoolExecutor(max_workers=2) as pool:
    x = pool.submit(call, a, "PATCH", "/admin/v1/nodes/nv", {"name": "both"})
    y = pool.submit(call, b, "PATCH", "/admin/v1/nodes/nv", {"max_in_flight": 3})
    x.result(); y.result()
node = call(a, "GET", "/admin/v1/nodes/nv")[1]
assert node["name"] == "both" and node["max_in_flight"] == 3, node
print("two fields written at once on two instances: both kept")
PY
