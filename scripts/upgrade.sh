#!/usr/bin/env bash
# A store from before migration 33, with nodes and seats in it, upgraded:
# an api from before ran on it (a node with the coordinator's cap, a node
# from before registered with its own cap and a local one, a TensorFold and
# a llama-server placement whose seats' rows say concurrency 1, and an
# operator's seat of concurrency 3), then `api migrate` brings it to the
# head and an api now serves it. Then voice's retired system project
# (migration 34), on a store made from nothing and on stores at migration
# 33 with projects of their own.
#
#   DATABASE_URL=postgres://... scripts/upgrade.sh
#
# The database is emptied first (its public schema dropped), so it must be
# one kept for testing. Checks:
#   - the migrations apply on the store as it was: the coordinator's cap
#     gone, every node and seat kept;
#   - the placed seats are served at their runtime's concurrency with no
#     placement made again (TensorFold 32, llama-server 2 from its cache),
#     and the operator's seat at its own, in the admin plane's view and in
#     the assignment a node reads, whose deprecated `max_in_flight` is their
#     sum for a node from before;
#   - a node from before registers with its own cap and a local one, read
#     past; a PATCH from before that sets a node's cap is refused (422,
#     the contract's refusal of a field it does not take), naming the
#     removal;
#   - a store made from nothing holds no project and no key: no retired
#     `voice-system`;
#   - on a store at migration 33 where nothing was recorded under
#     `voice-system`, it goes with its key and what hangs off them alone (a
#     budget, limits), and the projects' own `-system` keys, their other
#     keys and their usage are untouched;
#   - where anything was recorded under it (a request, its usage, peek,
#     annotation, step, turn or title, a budget spent, a change, a child, an
#     annotator naming it), it stays, archived, its key revoked.
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

head=$(ls store/migrations/*.sql | wc -l | tr -d ' ')
test "$head" -ge 34
names=$(sed -n 's/^const MIGRATIONS: String = "\(.*\)";$/\1/p' api/main.hl | sed 's/\\n/\n/g')
q() { psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "$1"; }
empty() {
  psql -q "$DATABASE_URL" -c 'SET client_min_messages = warning' -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public' >/dev/null
}
# the store as migration $1 left it, its ledger as pond's migrator keeps it
# (the names are api/main.hl's MIGRATIONS)
store_at() {
  empty
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "CREATE TABLE schema_migrations (version int PRIMARY KEY, name text NOT NULL, dirty int NOT NULL DEFAULT 0, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
  while read -r version name file; do
    [ -n "$version" ] && [ "$version" -le "$1" ] || continue
    psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "store/migrations/$file" >/dev/null
    psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "INSERT INTO schema_migrations (version, name) VALUES ($version, '$name')" >/dev/null
  done <<<"$names"
}
# `api migrate`, applying $1 migrations to the head
migrate() {
  api/api migrate --database "$DATABASE_URL" --migrations store/migrations >"$work/migrate.log" 2>&1 || { cat "$work/migrate.log"; exit 1; }
  grep -q "applied=$1 version=$head" "$work/migrate.log" || { cat "$work/migrate.log"; exit 1; }
}

store_at 32

# what an api from before wrote, and a node from before reported
token=vn-upgrade-0123456789abcdef0123456789abcdef
digest=$(python3 -c 'import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())' "$token")
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" >/dev/null <<SQL
INSERT INTO account (id, name, billing) VALUES ('local', 'Local', 'none');
INSERT INTO catalog_model (id, kind) VALUES ('dsv4', 'local'), ('qwen', 'local'), ('echo-1', 'local');
INSERT INTO node (id, name, token_digest, max_in_flight, assignment_version) VALUES
  ('spark', 'spark', decode('$digest', 'hex'), 3, 4),
  ('mini', 'mini', decode('00', 'hex'), NULL, 1);
INSERT INTO seat (node, id, engine, account, serves, concurrency, config) VALUES
  ('spark', 'dsv4', 'managed', 'local', '[{"model": "dsv4", "as": null}]', 1,
   '{"placement": "dsv4", "model": "dsv4", "context_length": 1048576, "cache_tokens": 7340032, "reserved_bytes": 1, "variant": {"id": "v"}, "runtime": {"id": "tensorfold-0.7.5", "server": "tensorfold"}}'),
  ('spark', 'qwen', 'managed', 'local', '[{"model": "qwen", "as": null}]', 1,
   '{"placement": "qwen", "model": "qwen", "context_length": 131072, "cache_tokens": 65536, "reserved_bytes": 1, "variant": {"id": "v"}, "runtime": {"id": "llama-server-b11913-cuda", "server": "llama-server"}}'),
  ('spark', 'relay', 'static', 'local', '[{"model": "echo-1", "as": null}]', 3, '{"text": "hi"}');
INSERT INTO node_state (node, version, capabilities, local, registered_at, last_heartbeat_at, applied_version) VALUES
  ('spark', '0.1.0', '{"max_in_flight": 4, "engines": [{"id": "managed", "kind": "managed", "config_schema": {}}, {"id": "static", "kind": "static", "config_schema": {}}]}',
   '{"paused": false, "paused_seats": [], "max_in_flight": 2, "reason": null}', now(), now(), 4);
SQL

migrate $((head - 32))
test "$(psql -tA "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'node' AND column_name = 'max_in_flight'")" = 0
test "$(psql -tA "$DATABASE_URL" -c "SELECT count(*) FROM node")" = 2
test "$(psql -tA "$DATABASE_URL" -c "SELECT string_agg(id || ':' || concurrency, ',' ORDER BY id) FROM seat")" = "dsv4:1,qwen:1,relay:3"
echo "migrations 33 to $head applied on a store with nodes and seats: $(tail -1 "$work/migrate.log")"

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
status, node = call("GET", "/admin/v1/nodes/spark")
assert status == 200, (status, node)
got = {s["id"]: s["concurrency"] for s in node["seats"]}
assert got == want, f"the admin plane's seats: {got}"
assert "max_in_flight" not in node and "effective_max_in_flight" not in node, node
status, seat = call("GET", "/admin/v1/nodes/spark/seats/dsv4")
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
status, node = call("GET", "/admin/v1/nodes/spark")
assert "max_in_flight" not in json.dumps(node["capabilities"]) and "max_in_flight" not in json.dumps(node["local"]), node

# a PATCH from before that sets a node's cap, or clears it: refused by name
for cap in (3, None):
    status, err = call("PATCH", "/admin/v1/nodes/spark", {"max_in_flight": cap})
    assert status == 422 and "`max_in_flight` was removed" in err["Invalid"]["message"], (status, err)
# a placed seat's concurrency is its runtime's; an operator's stays editable
status, err = call("PATCH", "/admin/v1/nodes/spark/seats/dsv4", {"concurrency": 4})
assert status == 422 and err["Invalid"]["param"] == "concurrency", (status, err)
status, seat = call("PATCH", "/admin/v1/nodes/spark/seats/relay", {"concurrency": 5})
assert status == 200 and seat["concurrency"] == 5, (status, seat)
print("an upgraded api serves the placed seats at their runtime's concurrency, and a node from before as it did")
PY

# voice's retired system project (migration 34)
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
pid=

# a store made from nothing holds none
empty
migrate "$head"
test "$(q "SELECT count(*) FROM project")" = 0
test "$(q "SELECT count(*) FROM api_key")" = 0
echo "a store made from nothing holds no retired system project"

# a store at migration 33 with projects of its own: one with a caller's key
# and usage under it and its system key, and one with no key but its system
# key and a limit on it; voice-system with a budget and limits of its own
store_at 33
test "$(q "SELECT status || ':' || internal FROM project WHERE id = 'voice-system'")" = "archived:true"
own() {
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" >/dev/null <<'SQL'
INSERT INTO project (id, name, owners, created_at) VALUES ('old', 'Old', '{op}', '2026-01-01T00:00:00Z'), ('work', 'Work', '{op}', '2026-06-01T00:00:00Z');
INSERT INTO api_key (id, project, name, prefix, secret_digest, created_at, internal) VALUES
  ('old-system', 'old', 'old-system', '', '\x'::bytea, '2026-01-01T00:00:00Z', true),
  ('work-system', 'work', 'work-system', '', '\x'::bytea, '2026-06-01T00:00:00Z', true),
  ('k_work', 'work', 'ci', 'vk_ab', '\x01'::bytea, '2026-06-02T00:00:00Z', false);
INSERT INTO "limit" (scope, key, window_seconds, requests) VALUES ('key', 'old-system', 60, 5);
INSERT INTO usage (id, created_at, project, key, requested_model, status, record) VALUES
  ('u_work', now(), 'work', 'k_work', 'm', 'served', '{}'),
  ('u_work_voice', now(), 'work', 'work-system', 'decide', 'served', '{}');
SQL
}
own
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" >/dev/null <<'SQL'
INSERT INTO budget (project, allowance_micros, period, period_anchor) VALUES ('voice-system', 1000, 'month', now());
INSERT INTO "limit" (scope, project, window_seconds, requests) VALUES ('project', 'voice-system', 60, 1);
INSERT INTO "limit" (scope, key, window_seconds, requests) VALUES ('key', 'voice-system', 60, 1);
SQL
keys="SELECT string_agg(k::text, ';' ORDER BY k.id) FROM api_key k WHERE project <> 'voice-system'"
before=$(q "$keys")
migrate $((head - 33))
test "$(q "SELECT count(*) FROM project WHERE id = 'voice-system'")" = 0
test "$(q "SELECT count(*) FROM api_key WHERE id = 'voice-system' OR project = 'voice-system'")" = 0
test "$(q "SELECT count(*) FROM budget")" = 0
test "$(q "SELECT string_agg(coalesce(key, project), ',') FROM \"limit\"")" = "old-system"
test "$(q "SELECT string_agg(id, ',' ORDER BY id) FROM project")" = "old,work"
test "$(q "$keys")" = "$before"
test "$(q "SELECT string_agg(id || ':' || key, ',' ORDER BY id) FROM usage")" = "u_work:k_work,u_work_voice:work-system"
echo "on a store at migration 33 where nothing was recorded under it, it goes; the projects' own system keys stay"

# where anything was recorded under it, it stays: each kind of record, on
# the migration's SQL in a transaction rolled back
store_at 33
own
retired=store/migrations/0034_retired_system_project.sql
while IFS= read -r record; do
  [ -n "$record" ] || continue
  got=$(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL" -c BEGIN -c "$record" -f "$retired" \
    -c "SELECT p.status || ':' || k.status FROM project p JOIN api_key k ON k.id = p.id WHERE p.id = 'voice-system'" -c ROLLBACK \
    | grep -E '^[a-z]+:[a-z]+$' || true)
  test "$got" = "archived:revoked" || { echo "voice-system went, though recorded under it: $record" >&2; exit 1; }
done <<'SQL'
INSERT INTO usage (id, created_at, project, key, requested_model, status, record) VALUES ('u_vs', now(), 'voice-system', 'voice-system', 'decide', 'served', '{}')
INSERT INTO usage (id, created_at, project, key, requested_model, status, record) VALUES ('u_vs', now(), 'old', 'voice-system', 'decide', 'served', '{}')
INSERT INTO api_instance (id) VALUES ('i'); INSERT INTO request (id, instance, project, key, requested_model, endpoint, data_class, reserved_input, reserved_output, reserved_micros, limits, period_start) VALUES ('r', 'i', 'voice-system', 'voice-system', 'decide', 'chat', 'internal', 0, 0, 0, '{}', now())
INSERT INTO in_flight (request_id, project, key, model, seat, account, started_at) VALUES ('r', 'voice-system', 'voice-system', 'decide', 's', 'a', now())
INSERT INTO peek (request_id, project, key, model, created_at, input, output) VALUES ('r', 'voice-system', 'voice-system', 'decide', now(), '', '')
INSERT INTO annotation (request_id, project, key, created_at, status) VALUES ('r', 'voice-system', 'voice-system', now(), 'annotated')
INSERT INTO annotation_step (request_id, project, at, step) VALUES ('r', 'voice-system', now(), 'queued')
INSERT INTO annotation_turn (project, conversation, user_hash, request_id, at) VALUES ('voice-system', 'c', 'h', 'r', now())
INSERT INTO conversation_title (project, conversation, title, annotator, version, made_at) VALUES ('voice-system', 'c', 't', 'conversation-title', 1, now())
INSERT INTO budget_state (project, period_start, spent_micros) VALUES ('voice-system', now(), 1)
INSERT INTO change (action, target) VALUES ('update', 'projects/voice-system')
INSERT INTO change (action, target) VALUES ('revoke', 'projects/voice-system/keys/voice-system')
INSERT INTO project (id, name, owners, parent) VALUES ('child', 'Child', '{op}', 'voice-system')
INSERT INTO annotator (id, version, body) VALUES ('mine', 1, '{"scope": {"projects": ["voice-system"], "keys": []}}')
SQL
# and through `api migrate`, its usage and an annotation kept
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" >/dev/null <<'SQL'
INSERT INTO usage (id, created_at, project, key, requested_model, status, record) VALUES ('u_vs', now(), 'voice-system', 'voice-system', 'decide', 'served', '{}');
INSERT INTO annotation (request_id, project, key, created_at, status) VALUES ('u_vs', 'voice-system', 'voice-system', now(), 'annotated');
SQL
migrate $((head - 33))
test "$(q "SELECT p.status || ':' || p.internal || ':' || k.status FROM project p JOIN api_key k ON k.id = p.id WHERE p.id = 'voice-system'")" = "archived:true:revoked"
test "$(q "SELECT count(*) FROM api_key WHERE internal AND id LIKE '%-system'")" = 2
echo "where anything was recorded under it, it stays, archived, its key revoked"
