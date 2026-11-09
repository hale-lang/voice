#!/usr/bin/env bash
# compose.yaml as a habitat applies it, rendered with `docker compose config`
# (no container runs): standalone, and grafted with the heart roles voice
# brings left to it or provided by the habitat (`hale habitat graft voice
# --reuse database --reuse broker`), handed over as HALE_DNA_DATABASE_DSN
# and HALE_DNA_BROKER_*, with the profiles of the roles left to voice in
# COMPOSE_PROFILES. Each case says which services run, and what database
# and NATS `migrate`, the api and the brain are given.
#
#   scripts/compose-reuse.sh
set -euo pipefail
cd "$(dirname "$0")/.."

vault=/var/lib/hale/vault
dsn='postgres://heart_zz@db.habitat.lan:5544/heart_zz?sslmode=disable&vault=postgres-heart_zz'
broker='nats://habitat.lan:4333'
handed=(
  HALE_VAULT_DIR="$vault"
  HALE_DNA_DATABASE_DSN="$dsn"
  HALE_DNA_BROKER_URL="$broker"
  HALE_DNA_BROKER_USER=heart-zz
  HALE_DNA_BROKER_VAULT=nats-heart-zz
  HALE_DNA_BROKER_SUBJECTS='heart.zz.>'
  HALE_DNA_BROKER_NODE_USER=heart-zz-node
  HALE_DNA_BROKER_NODE_VAULT=nats-heart-zz-node
)

# the render under the environment given and none of the variables compose
# reads otherwise (the repository's .env, as compose reads it), as JSON
clean=(-u COMPOSE_PROFILES -u HALE_VAULT_DIR -u HALE_DNA_HOST_NAME -u HALE_DNA_HOST_LISTEN -u HALE_DNA_DATABASE_DSN
  -u HALE_DNA_BROKER_URL -u HALE_DNA_BROKER_USER -u HALE_DNA_BROKER_VAULT -u HALE_DNA_BROKER_SUBJECTS
  -u HALE_DNA_BROKER_INBOX -u HALE_DNA_BROKER_NODE_USER -u HALE_DNA_BROKER_NODE_VAULT
  -u VOICE_NODE_HOST -u VOICE_NATS_PORT -u VOICE_NATS_BIND -u VOICE_API_BIND)
render() {
  local out err
  err=$(mktemp)
  if ! out=$(env "${clean[@]}" "$@" docker compose config --format json 2>"$err"); then
    echo "docker compose config failed under: $*" >&2
    cat "$err" >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  printf '%s\n' "$out"
}

# check <case> <expected JSON> <render's JSON on stdin>
# (the program is an argument: stdin is the render)
check() {
  python3 -c "$checker" "$1" "$2"
}
checker=$(cat <<'PY'
import json, sys
case, want = sys.argv[1], json.loads(sys.argv[2])
cfg = json.load(sys.stdin)
svc = cfg["services"]
bad = []
def flag(name, f):
    cmd = svc[name]["command"]
    return cmd[cmd.index(f) + 1] if f in cmd else None
got = sorted(svc)
if got != sorted(want["services"]):
    bad.append(f"services {got}, not {sorted(want['services'])}")
for name in ("migrate", "api", "brain"):
    if flag(name, "--database") != want["database"]:
        bad.append(f"{name} --database {flag(name, '--database')!r}, not {want['database']!r}")
for name in ("api", "brain"):
    if flag(name, "--nats") != want["nats"]:
        bad.append(f"{name} --nats {flag(name, '--nats')!r}, not {want['nats']!r}")
    env = svc[name].get("environment") or {}
    for k, v in want.get("env", {}).items():
        if (env.get(k) or "") != v:
            bad.append(f"{name} {k}={env.get(k)!r}, not {v!r}")
if flag("api", "--node-nats") != want["node_nats"]:
    bad.append(f"api --node-nats {flag('api', '--node-nats')!r}, not {want['node_nats']!r}")
if (svc["api"].get("environment") or {}).get("VOICE_DATABASE_URL") != want["database"]:
    bad.append("api VOICE_DATABASE_URL is not its --database")
for name in ("migrate", "api", "brain"):
    if want.get("vault"):
        mounts = [v.get("source") for v in svc[name].get("volumes", [])]
        if want["vault"] not in mounts:
            bad.append(f"{name} does not mount the vault {want['vault']} ({mounts})")
        if (svc[name].get("environment") or {}).get("HALE_VAULT_DIR") != want["vault"]:
            bad.append(f"{name} is not handed HALE_VAULT_DIR")
    # no password on a command line: a habitat's DSN names its vault entry
    for word in svc[name]["command"]:
        if want.get("no_password") and ("voice:voice@" in word or "password" in word):
            bad.append(f"{name}'s command carries a password: {word}")
if bad:
    print(f"FAIL {case}:\n  " + "\n  ".join(bad))
    sys.exit(1)
print(f"ok   {case}: {', '.join(got)}")
PY
)

own_db='postgres://voice:voice@postgres:5432/voice?sslmode=disable'
own_nats='nats://nats:4222'
all='["api", "brain", "migrate", "nats", "postgres"]'
apps='["api", "brain", "migrate"]'
unset_broker='{"HALE_DNA_BROKER_URL": "", "HALE_DNA_BROKER_USER": ""}'
reused_broker="{\"HALE_DNA_BROKER_URL\": \"$broker\", \"HALE_DNA_BROKER_USER\": \"heart-zz\", \"HALE_DNA_BROKER_VAULT\": \"nats-heart-zz\", \"HALE_DNA_BROKER_SUBJECTS\": \"heart.zz.>\", \"HALE_DNA_BROKER_NODE_USER\": \"heart-zz-node\", \"HALE_DNA_BROKER_NODE_VAULT\": \"nats-heart-zz-node\"}"

render | check "standalone (.env's profiles)" \
  "{\"services\": $all, \"database\": \"$own_db\", \"nats\": \"$own_nats\", \"node_nats\": \"nats://127.0.0.1:4222\", \"env\": $unset_broker}"

render COMPOSE_PROFILES=database,broker HALE_DNA_HOST_NAME=box.lan | check "grafted, voice brings both" \
  "{\"services\": $all, \"database\": \"$own_db\", \"nats\": \"$own_nats\", \"node_nats\": \"nats://box.lan:4222\", \"env\": $unset_broker}"

# a habitat that sets no COMPOSE_PROFILES yet hands both over: compose's own
# servers start, unused
render HALE_DNA_HOST_NAME=box.lan "${handed[@]}" | check "grafted, both handed, no profiles named" \
  "{\"services\": $all, \"database\": \"$dsn\", \"nats\": \"$broker\", \"node_nats\": \"$broker\", \"env\": $reused_broker, \"vault\": \"$vault\", \"no_password\": true}"

for profiles in none ''; do
  render COMPOSE_PROFILES="$profiles" HALE_DNA_HOST_NAME=box.lan "${handed[@]}" | check "--reuse database --reuse broker (COMPOSE_PROFILES='$profiles')" \
    "{\"services\": $apps, \"database\": \"$dsn\", \"nats\": \"$broker\", \"node_nats\": \"$broker\", \"env\": $reused_broker, \"vault\": \"$vault\", \"no_password\": true}"
done

render COMPOSE_PROFILES=broker HALE_VAULT_DIR="$vault" HALE_DNA_DATABASE_DSN="$dsn" | check "--reuse database" \
  "{\"services\": [\"api\", \"brain\", \"migrate\", \"nats\"], \"database\": \"$dsn\", \"nats\": \"$own_nats\", \"node_nats\": \"nats://127.0.0.1:4222\", \"env\": $unset_broker, \"vault\": \"$vault\", \"no_password\": true}"

render COMPOSE_PROFILES=database HALE_VAULT_DIR="$vault" "${handed[@]:2}" | check "--reuse broker" \
  "{\"services\": [\"api\", \"brain\", \"migrate\", \"postgres\"], \"database\": \"$own_db\", \"nats\": \"$broker\", \"node_nats\": \"$broker\", \"env\": $reused_broker, \"vault\": \"$vault\"}"
