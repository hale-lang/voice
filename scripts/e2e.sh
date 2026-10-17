#!/usr/bin/env bash
# voice end to end on one machine: NATS, the api and a node, the node
# configured and enrolled through the admin plane, then a response and a
# chat completion served by its static seat, validated against the spec,
# and a local pause that takes the seat out of service.
#
#   scripts/e2e.sh            # starts NATS in a container of its own
#   NATS_URL=nats://127.0.0.1:4222 scripts/e2e.sh   # uses that NATS
#   DATABASE_URL=postgres://... scripts/e2e.sh      # the store in that
#                                                   # database, migrated first,
#                                                   # and two brains over it
#
# Needs api/api, node/node and brain/brain built, build/openapi.bundled.json,
# build/node.bundled.json and spec/validate's packages (see
# .github/workflows/ci.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT=${API_PORT:-18090}
NODE_PORT=${NODE_PORT:-18091}
NODE2_PORT=${NODE2_PORT:-18092}
SILENT_PORT=${SILENT_PORT:-14299}
NATS_PORT=${NATS_PORT:-14222}
work=$(mktemp -d)
container=""
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  if [ -n "$container" ]; then docker stop "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

if [ -z "${NATS_URL:-}" ]; then
  container="voice-e2e-nats-$$"
  docker run -d --rm --name "$container" -p "127.0.0.1:${NATS_PORT}:4222" nats:2.11-alpine >/dev/null
  NATS_URL="nats://127.0.0.1:${NATS_PORT}"
fi
for i in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/${NATS_URL##*:}") 2>/dev/null && break; sleep 0.2; done

api=http://127.0.0.1:${API_PORT}
store=()
if [ -n "${DATABASE_URL:-}" ]; then
  api/api migrate --database "$DATABASE_URL" --migrations store/migrations
  store=(--database "$DATABASE_URL")
fi
api/api --port "$API_PORT" --canned api/canned --nats "$NATS_URL" "${store[@]}" >"$work/api.log" 2>&1 &
pids+=($!)
for i in $(seq 1 50); do curl -fsS "$api/healthz" >/dev/null 2>&1 && break; sleep 0.2; done

post() { curl -fsS -X POST "$api$1" -H 'content-type: application/json' -d "$2"; }
field() { python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }

post /admin/v1/models '{"id": "echo-1", "price": {"input_per_mtok_micros": 3000000, "output_per_mtok_micros": 15000000}}' >/dev/null
post /admin/v1/accounts '{"id": "static", "name": "Static"}' >/dev/null
post /admin/v1/projects '{"id": "work", "name": "Work"}' >/dev/null
key=$(post /admin/v1/projects/work/keys '{"name": "e2e"}' | field secret)
token=$(post /admin/v1/nodes '{"id": "laptop"}' | field enrollment_token)
post /admin/v1/nodes/laptop/seats '{"id": "static", "engine": "static", "account": "static", "serves": [{"model": "echo-1"}], "config": {"text": "hello from voice", "chunk_chars": 8}}' >/dev/null

node/node --id laptop --api "$api" --token "$token" --data "$work/node-data" --capabilities deploy/node/capabilities.json --port "$NODE_PORT" >"$work/node.log" 2>&1 &
pids+=($!)

seat_status() { curl -fsS "$api/admin/v1/nodes/laptop/seats/static" | field status; }
wait_for() {
  for i in $(seq 1 100); do [ "$(seat_status)" = "$1" ] && return 0; sleep 0.2; done
  echo "the seat never became $1: $(curl -fsS "$api/admin/v1/nodes/laptop")"; echo "--- api"; cat "$work/api.log"; echo "--- node"; cat "$work/node.log"
  return 1
}
wait_for up
echo "laptop/static is up"

(cd spec/validate && node served.mjs ../../build/openapi.bundled.json "$api" "$key")

# a local pause only restricts: the seat is held, and nothing serves
curl -fsS -X PUT "http://127.0.0.1:${NODE_PORT}/node/v1/local" -d '{"paused": false, "paused_seats": ["static"], "max_in_flight": null, "reason": "e2e"}' >/dev/null
wait_for paused
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$api/v1/responses" -H "authorization: Bearer $key" -d '{"model": "echo-1", "input": "hi"}')
[ "$code" = "503" ] || { echo "a paused seat served: $code"; exit 1; }
curl -fsS -X PUT "http://127.0.0.1:${NODE_PORT}/node/v1/local" -d '{"paused": false, "paused_seats": [], "max_in_flight": null, "reason": null}' >/dev/null
wait_for up

# with a database: the brain's route table, and a standby that takes over
if [ -n "${DATABASE_URL:-}" ]; then
  brain/brain --database "$DATABASE_URL" --nats "$NATS_URL" >"$work/brain1.log" 2>&1 &
  first=$!
  pids+=($first)
  for i in $(seq 1 50); do grep -q 'working' "$work/brain1.log" && break; sleep 0.2; done
  brain/brain --database "$DATABASE_URL" --nats "$NATS_URL" >"$work/brain2.log" 2>&1 &
  pids+=($!)
  for i in $(seq 1 50); do grep -q 'standing by' "$work/brain2.log" && break; sleep 0.2; done
  grep -q 'standing by' "$work/brain2.log" || { echo "the second brain did not stand by"; cat "$work/brain2.log"; exit 1; }
  echo "one brain works, the other stands by"
  (cd spec/validate && node routes.mjs ../../build/openapi.bundled.json "$api" laptop/static)
  kill "$first"
  for i in $(seq 1 50); do grep -q 'working' "$work/brain2.log" && break; sleep 0.2; done
  grep -q 'working' "$work/brain2.log" || { echo "the standby did not take over"; cat "$work/brain2.log"; exit 1; }
  echo "the standby took over"
  (cd spec/validate && node routes.mjs ../../build/openapi.bundled.json "$api" laptop/static)
  # a brain that stops without its connection dropping (SIGSTOP stands in
  # for a host gone silent) loses the lock: Postgres ends its idle session
  # after 10 s, and the standby takes over
  second=${pids[${#pids[@]}-1]}
  brain/brain --database "$DATABASE_URL" --nats "$NATS_URL" >"$work/brain3.log" 2>&1 &
  pids+=($!)
  for i in $(seq 1 50); do grep -q 'standing by' "$work/brain3.log" && break; sleep 0.2; done
  before=$(curl -fsS "$api/admin/v1/routes" | field version)
  kill -STOP "$second"
  t0=$(date +%s)
  for i in $(seq 1 150); do grep -q 'working' "$work/brain3.log" && break; sleep 0.2; done
  kill -CONT "$second"
  grep -q 'working' "$work/brain3.log" || { echo "the standby did not take over from a stopped brain"; cat "$work/brain3.log"; exit 1; }
  echo "the standby took over from a stopped brain in $(( $(date +%s) - t0 )) s"
  sleep 1.5
  after=$(curl -fsS "$api/admin/v1/routes" | field version)
  [ "$after" -gt "$before" ] || { echo "the route table's version went from $before to $after"; exit 1; }
  (cd spec/validate && node routes.mjs ../../build/openapi.bundled.json "$api" laptop/static)
  # a NATS address that never answers holds no tick: the table goes on
  # every second and one brain keeps the lock
  for p in "${pids[@]}"; do case "$(ps -o comm= -p "$p" 2>/dev/null)" in brain*) kill "$p" 2>/dev/null || true ;; esac; done
  brain/brain --database "$DATABASE_URL" --nats nats://10.255.255.1:4222 >"$work/brain4.log" 2>&1 &
  pids+=($!)
  for i in $(seq 1 100); do grep -q 'working' "$work/brain4.log" && break; sleep 0.2; done
  grep -q 'working' "$work/brain4.log" || { echo "a brain with an unanswering NATS did not work"; cat "$work/brain4.log"; exit 1; }
  sleep 1
  before=$(curl -fsS "$api/admin/v1/routes" | field version)
  sleep 5
  after=$(curl -fsS "$api/admin/v1/routes" | field version)
  [ $(( after - before )) -ge 3000 ] || { echo "with NATS not answering the table went from $before to $after in 5 s"; cat "$work/brain4.log"; exit 1; }
  ! grep -q 'dropping' "$work/brain4.log" || { echo "the brain dropped its lock"; cat "$work/brain4.log"; exit 1; }
  echo "with NATS not answering, the table advanced $(( after - before )) ms in 5 s and the brain kept the lock"
  # a NATS that takes the connection and then never answers a PING: the
  # notifier backs off (1, 2, 4, 8 s), a dial alone does not reset it
  kill "${pids[${#pids[@]}-1]}" 2>/dev/null || true
  : >"$work/silent.log"
  python3 scripts/silent-nats.py "$SILENT_PORT" "$work/silent.log" &
  pids+=($!)
  sleep 0.5
  brain/brain --database "$DATABASE_URL" --nats "nats://127.0.0.1:$SILENT_PORT" >"$work/brain5.log" 2>&1 &
  pids+=($!)
  sleep 20
  dials=$(wc -l <"$work/silent.log")
  [ "$dials" -le 5 ] || { echo "the notifier dialled a silent NATS $dials times in 20 s, not backing off"; cat "$work/brain5.log"; exit 1; }
  echo "a NATS that handshakes and goes silent was dialled $dials times in 20 s"
fi

# a change on the coordinator reaches the node over NATS
curl -fsS -X PATCH "$api/admin/v1/nodes/laptop/seats/static" -H 'content-type: application/json' -d '{"config": {"text": "hello again"}}' >/dev/null
for i in $(seq 1 50); do
  out=$(curl -s -X POST "$api/v1/responses" -H "authorization: Bearer $key" -d '{"model": "echo-1", "input": "hi"}' || true)
  case "$out" in *'hello again'*) echo "the new assignment serves"; break ;; esac
  sleep 0.2
done
case "$out" in *'hello again'*) ;; *) echo "the node never applied the new assignment: $out"; cat "$work/node.log"; exit 1 ;; esac

responds() { curl -s -X POST "$api/v1/responses" -H "authorization: Bearer $key" -d '{"model": "echo-1", "input": "hi"}' || true; }

# an assign lost while NATS is down reaches the node when it is back: the
# node reads its assignment on reconnecting, and its heartbeat says the
# version it applied
if [ -n "$container" ]; then
  docker rm -f "$container" >/dev/null
  curl -fsS -X PATCH "$api/admin/v1/nodes/laptop/seats/static" -H 'content-type: application/json' -d '{"config": {"text": "after the blip"}}' >/dev/null
  docker run -d --rm --name "$container" -p "127.0.0.1:${NATS_PORT}:4222" nats:2.11-alpine >/dev/null
  t0=$(date +%s)
  for i in $(seq 1 100); do
    out=$(responds)
    case "$out" in *'after the blip'*) break ;; esac
    sleep 0.2
  done
  case "$out" in *'after the blip'*) echo "the assignment sent while NATS was down arrived $(( $(date +%s) - t0 )) s after it came back" ;; *) echo "the node never recovered the lost assignment: $out"; curl -fsS "$api/admin/v1/nodes/laptop"; cat "$work/node.log"; exit 1 ;; esac
else
  echo "NATS is not this script's own, so the NATS outage step is skipped"
fi

# failover after a slow failure: while the api waits on a seat that fails
# after 8 s, the other node keeps heartbeating to the busy api and still
# answers its offer at once (`mini` is added after `laptop`, and sorts after
# it, so either store offers laptop's seat first)
token2=$(post /admin/v1/nodes '{"id": "mini"}' | field enrollment_token)
post /admin/v1/nodes/mini/seats '{"id": "steady", "engine": "static", "account": "static", "serves": [{"model": "echo-1"}], "config": {"text": "from the mini"}}' >/dev/null
node/node --id mini --api "$api" --token "$token2" --data "$work/node2-data" --capabilities deploy/node/capabilities.json --port "$NODE2_PORT" >"$work/node2.log" 2>&1 &
pids+=($!)
curl -fsS -X PATCH "$api/admin/v1/nodes/laptop/seats/static" -H 'content-type: application/json' -d '{"config": {"text": "never", "fail_after_ms": 8000}}' >/dev/null
for i in $(seq 1 100); do
  [ "$(seat_status)" = "up" ] && [ "$(curl -fsS "$api/admin/v1/nodes/mini/seats/steady" | field status)" = "up" ] && break
  sleep 0.2
done
t0=$(date +%s%N)
out=$(responds)
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
echo "$out" | python3 -c '
import json, sys
r = json.load(sys.stdin)
a = r["voice"]["attempts"]
assert r["voice"]["served"]["seat"] == "mini/steady", r["voice"]["served"]
assert a[0]["seat"] == "laptop/static" and a[0]["outcome"] == "failed", a
' || { echo "failover after a slow failure did not serve: $out"; cat "$work/node2.log"; exit 1; }
[ "$ms" -lt 15000 ] || { echo "failover took $ms ms, more than the failure (8 s), the ack wait (5 s) and the second seat's own time"; exit 1; }
echo "failed over from laptop/static to mini/steady in $ms ms"

# every seat fails: a 502 that names the request and every attempt
curl -fsS -X PATCH "$api/admin/v1/nodes/mini/seats/steady" -H 'content-type: application/json' -d '{"config": {"text": "never", "fail_after_ms": 100}}' >/dev/null
for i in $(seq 1 100); do [ "$(curl -fsS "$api/admin/v1/nodes/mini/seats/steady" | field status)" = "up" ] && break; sleep 0.2; done
(cd spec/validate && node served.mjs ../../build/openapi.bundled.json "$api" "$key" 502)
# a seat that answers with a tool call (the static engine's drill), as a
# chat completion's tool_calls; the node says what it has in flight
curl -fsS -X PATCH "$api/admin/v1/nodes/laptop/seats/static" -H 'content-type: application/json' -d '{"config": {"text": "unused", "tool_call": {"name": "weather", "arguments": "{\"city\": \"Oslo\"}"}, "first_output_ms": 3000}}' >/dev/null
wait_for up
curl -fsS -X PATCH "$api/admin/v1/nodes/mini/seats/steady" -H 'content-type: application/json' -d '{"enabled": false}' >/dev/null
(cd spec/validate && node served.mjs ../../build/openapi.bundled.json "$api" "$key" tool) &
asked=$!
sleep 1.5
busy=$(curl -fsS "http://127.0.0.1:${NODE_PORT}/node/v1/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["in_flight"])')
wait $asked
[ "$busy" = "1" ] || { echo "the node did not count the request it was serving: in_flight $busy"; exit 1; }
echo "the node counted its request in flight"
curl -fsS -X PATCH "$api/admin/v1/nodes/laptop/seats/static" -H 'content-type: application/json' -d '{"config": {"text": "hello from voice", "chunk_chars": 8}}' >/dev/null
wait_for up

# the node's own API, with its seat, against node.yaml
(cd spec/validate && node node-live.mjs ../../build/node.bundled.json "http://127.0.0.1:${NODE_PORT}")
