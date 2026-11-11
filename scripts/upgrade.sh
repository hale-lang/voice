#!/usr/bin/env bash
# A store from before migration 33, with nodes and seats in it, upgraded:
# an api from before ran on it (a node with the coordinator's cap, a node
# from before registered with its own cap and a local one, a TensorFold and
# a llama-server placement whose seats' rows say concurrency 1, and an
# operator's seat of concurrency 3), then `api migrate` brings it to the
# head and an api now serves it.
#
#   DATABASE_URL=postgres://... scripts/upgrade.sh
#
# The database is emptied first (its public schema dropped), so it must be
# one kept for testing. Checks:
#   - the migration applies on the store as it was: one migration, the
#     coordinator's cap gone, every node and seat kept;
#   - the placed seats are served at their runtime's concurrency with no
#     placement made again (TensorFold 32, llama-server 2 from its cache),
#     and the operator's seat at its own, in the admin plane's view and in
#     the assignment a node reads, whose deprecated `max_in_flight` is their
#     sum for a node from before;
#   - a node from before registers with its own cap and a local one, read
#     past; a PATCH from before that sets a node's cap is refused (422,
#     the contract's refusal of a field it does not take), naming the
#     removal.
#
# Needs api/api built, psql, curl and python3.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL names a database to empty and upgrade}"
PORT=${PORT:-18290}
PROBE_PORT=${PROBE_PORT:-18292}
HUB_PORT=${HUB_PORT:-18294}
work=$(mktemp -d)
pid=
cleanup() {
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

psql -q "$DATABASE_URL" -c 'SET client_min_messages = warning' -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public' >/dev/null

# the store as migration 32 left it, its ledger as pond's migrator keeps it
# (the names are api/main.hl's MIGRATIONS)
head=$(ls store/migrations/*.sql | wc -l | tr -d ' ')
test "$head" -ge 33
names=$(sed -n 's/^const MIGRATIONS: String = "\(.*\)";$/\1/p' api/main.hl | sed 's/\\n/\n/g')
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "CREATE TABLE schema_migrations (version int PRIMARY KEY, name text NOT NULL, dirty int NOT NULL DEFAULT 0, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
while read -r version name file; do
  [ -n "$version" ] && [ "$version" -le 32 ] || continue
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "store/migrations/$file" >/dev/null
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "INSERT INTO schema_migrations (version, name) VALUES ($version, '$name')" >/dev/null
done <<<"$names"

# what an api from before wrote, and a node from before reported
token=vn-upgrade-0123456789abcdef0123456789abcdef
digest=$(python3 -c 'import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())' "$token")
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" >/dev/null <<SQL
INSERT INTO account (id, name, billing) VALUES ('local', 'Local', 'none');
INSERT INTO catalog_model (id, kind) VALUES ('dsv4', 'local'), ('qwen', 'local'), ('echo-1', 'local');
INSERT INTO node (id, name, token_digest, max_in_flight, assignment_version) VALUES
  ('node-a', 'node-a', decode('$digest', 'hex'), 3, 4),
  ('mini', 'mini', decode('00', 'hex'), NULL, 1);
INSERT INTO seat (node, id, engine, account, serves, concurrency, config) VALUES
  ('node-a', 'dsv4', 'managed', 'local', '[{"model": "dsv4", "as": null}]', 1,
   '{"placement": "dsv4", "model": "dsv4", "context_length": 1048576, "cache_tokens": 7340032, "reserved_bytes": 1, "variant": {"id": "v"}, "runtime": {"id": "tensorfold-0.7.5", "server": "tensorfold"}}'),
  ('node-a', 'qwen', 'managed', 'local', '[{"model": "qwen", "as": null}]', 1,
   '{"placement": "qwen", "model": "qwen", "context_length": 131072, "cache_tokens": 65536, "reserved_bytes": 1, "variant": {"id": "v"}, "runtime": {"id": "llama-server-b11913-cuda", "server": "llama-server"}}'),
  ('node-a', 'relay', 'static', 'local', '[{"model": "echo-1", "as": null}]', 3, '{"text": "hi"}');
INSERT INTO node_state (node, version, capabilities, local, registered_at, last_heartbeat_at, applied_version) VALUES
  ('node-a', '0.1.0', '{"max_in_flight": 4, "engines": [{"id": "managed", "kind": "managed", "config_schema": {}}, {"id": "static", "kind": "static", "config_schema": {}}]}',
   '{"paused": false, "paused_seats": [], "max_in_flight": 2, "reason": null}', now(), now(), 4);
SQL

api/api migrate --database "$DATABASE_URL" --migrations store/migrations >"$work/migrate.log" 2>&1 || { cat "$work/migrate.log"; exit 1; }
grep -q "applied=1 version=$head" "$work/migrate.log" || { cat "$work/migrate.log"; exit 1; }
test "$(psql -tA "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'node' AND column_name = 'max_in_flight'")" = 0
test "$(psql -tA "$DATABASE_URL" -c "SELECT count(*) FROM node")" = 2
test "$(psql -tA "$DATABASE_URL" -c "SELECT string_agg(id || ':' || concurrency, ',' ORDER BY id) FROM seat")" = "dsv4:1,qwen:1,relay:3"
echo "migration $head applied on a store with nodes and seats: $(tail -1 "$work/migrate.log")"

VOICE_PROBE_PORT="$PROBE_PORT" VOICE_HUB_PORT="$HUB_PORT" api/api --port "$PORT" --nats "" --database "$DATABASE_URL" >"$work/api.log" 2>&1 &
pid=$!
for i in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
api/api admin-token --database "$DATABASE_URL" >"$work/admin.token"

python3 - "$PORT" "$work/admin.token" "$token" <<'PY' || { cat "$work/api.log"; exit 1; }
import json, sys, urllib.request, urllib.error
base, operator, token = f"http://127.0.0.1:{sys.argv[1]}", open(sys.argv[2]).read().strip(), sys.argv[3]

def call(method, path, body=None, bearer=operator):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={"content-type": "application/json", "authorization": f"Bearer {bearer}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

want = {"dsv4": 32, "qwen": 2, "relay": 3}
status, node = call("GET", "/admin/v1/nodes/node-a")
assert status == 200, (status, node)
got = {s["id"]: s["concurrency"] for s in node["seats"]}
assert got == want, f"the admin plane's seats: {got}"
assert "max_in_flight" not in node and "effective_max_in_flight" not in node, node
status, seat = call("GET", "/admin/v1/nodes/node-a/seats/dsv4")
assert status == 200 and seat["concurrency"] == 32, seat

# the assignment a node reads: each seat at its runtime's, and their sum as
# the cap a node from before reads
status, a = call("GET", "/node/v1/assignment", bearer=token)
assert status == 200, (status, a)
got = {s["id"]: s["concurrency"] for s in a["seats"]}
assert got == want and a["max_in_flight"] == sum(want.values()), a

# a node from before registers as it did, its own cap and a local one read past
caps = {"max_in_flight": 4, "engines": [{"id": "managed", "kind": "managed", "models": None, "config_schema": {"type": "object"}}, {"id": "static", "kind": "static", "models": None, "config_schema": {"type": "object"}}]}
local = {"paused": False, "paused_seats": [], "max_in_flight": 2, "reason": None}
status, reg = call("POST", "/node/v1/register", {"protocol": 2, "version": "0.1.0", "capabilities": caps, "local": local}, bearer=token)
assert status == 200 and reg["assignment"]["max_in_flight"] == 37, (status, reg)
status, node = call("GET", "/admin/v1/nodes/node-a")
assert "max_in_flight" not in json.dumps(node["capabilities"]) and "max_in_flight" not in json.dumps(node["local"]), node

# a PATCH from before that sets a node's cap, or clears it: refused by name
for cap in (3, None):
    status, err = call("PATCH", "/admin/v1/nodes/node-a", {"max_in_flight": cap})
    assert status == 422 and "`max_in_flight` was removed" in err["Invalid"]["message"], (status, err)
# a placed seat's concurrency is its runtime's; an operator's stays editable
status, err = call("PATCH", "/admin/v1/nodes/node-a/seats/dsv4", {"concurrency": 4})
assert status == 422 and err["Invalid"]["param"] == "concurrency", (status, err)
status, seat = call("PATCH", "/admin/v1/nodes/node-a/seats/relay", {"concurrency": 5})
assert status == 200 and seat["concurrency"] == 5, (status, seat)
print("an upgraded api serves the placed seats at their runtime's concurrency, and a node from before as it did")
PY
