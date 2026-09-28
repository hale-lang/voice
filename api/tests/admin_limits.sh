#!/usr/bin/env bash
# api/tests/admin_limits.sh — a project's rate limit, from the admin who
# proposes it to the 429 a caller gets (hale-lang/voice#1). Run by
# admin_limits_test.hl, against a local hale checkout (HALE_SOURCE, with
# HALE_BIN built from it) and docker on PATH.
#
#   1. A fresh organization (`hale dna new`), running under `hale dna
#      dev`: memory and nerves from its seed compose.
#   2. The limit `operating/limits/personal` is proposed as an operating
#      practice, its text stating its own grammar (limits.hl).
#   3. The stub identity provider serves on the loopback under a key made
#      for this run, and answers the `client_credentials` grant for the
#      service `voice-api`, its secret in the vault. The head serves under
#      OIDC with the organization attached, and the record maps the
#      service (`dna.oidc.service`).
#   4. The admin signs in through the head and, holding the Board, approves
#      the limit through the head's command route. The organization
#      ratifies it.
#   5. Voice's api reads the ratified limits through the head as the
#      service. A project key's third request in the window is `429` with
#      `Retry-After`.
#   6. The admin proposes a superseding limit through the head and approves
#      it; the organization retires the first. Voice's api reads it, and
#      the project's requests are served up to the new limit.
#
# Everything lives under one directory made for the run; it and every
# process whose command line names it, and the organization's compose
# project, go when the script ends, however it ends.
set -euo pipefail

src=${HALE_SOURCE:?HALE_SOURCE names a hale checkout}
hale=${HALE_BIN:-$src/target/release/hale}
voice=$(cd "$(dirname "$0")/../.." && pwd)
for tool in curl docker openssl git; do command -v "$tool" >/dev/null || { echo "admin_limits: $tool is required" >&2; exit 2; }; done
[[ -x "$hale" ]] || { echo "admin_limits: no hale at $hale (HALE_BIN, or build HALE_SOURCE)" >&2; exit 2; }

root=$(mktemp -d "${TMPDIR:-/tmp}/voice-admin-limits.XXXXXXXX")
name=vl$$
app=$root/$name
export HALE_DNA_DISCOVER=off GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
unset HALE_DNA_TRUSTED_LOCAL HALE_VAULT_ADDR LOTUS_OBS

cleanup() {
  local code=$?
  # every process whose command line names this run's directory, by pid
  local pids
  pids=$(ps -eo pid=,args= | grep -F "$root" | grep -v grep | awk '{print $1}' | grep -vx "$$" || true)
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
  sleep 1
  pids=$(ps -eo pid=,args= | grep -F "$root" | grep -v grep | awk '{print $1}' | grep -vx "$$" || true)
  [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  [[ -f "$app/dna/compose.yaml" ]] && docker compose -f "$app/dna/compose.yaml" down -v >/dev/null 2>&1 || true
  if [[ "${VOICE_KEEP_SCRATCH:-}" == 1 ]]; then echo "admin_limits: kept $root" >&2; else rm -rf "$root"; fi
  exit "$code"
}
trap cleanup EXIT

fail() {
  echo "admin_limits: $*" >&2
  for log in dev head stub voice; do [[ -f "$root/$log.log" ]] && { echo "--- $log.log" >&2; tail -20 "$root/$log.log" >&2; }; done
  exit 1
}
# `until <seconds> <what> <command…>`: the command succeeds within the bound
until_ok() {
  local secs=$1 what=$2; shift 2
  local i
  for ((i = 0; i < secs * 2; i++)); do "$@" && return 0; sleep 0.5; done
  fail "$what did not happen within ${secs}s"
}
free_port() {
  local p
  for p in $(shuf -i 30000-46999 -n 64); do
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null || { echo "$p"; return; }
  done
  fail "no free port"
}

# ---- the builds: the head, its API child and the stub from the checkout,
# the stub from a copy of its sources; voice's api from this repository
"$hale" build "$src/dna/api/practice_review" >/dev/null || fail "the API child did not build"
"$hale" build "$src/dna/api/project_service" >/dev/null || fail "the head did not build"
mkdir -p "$root/oidc/serve" "$root/vault" "$root/state"
cp "$src/dna/oidc/stub.hl" "$root/oidc/" && cp "$src/dna/oidc/serve/main.hl" "$root/oidc/serve/"
"$hale" build "$root/oidc/serve" >/dev/null || fail "the stub provider did not build"
"$hale" build "$voice/api" >/dev/null || fail "voice's api did not build"

# ---- 1. the organization, under dev
(cd "$root" && "$hale" dna new "$name" >/dev/null) || fail "hale dna new"
git -C "$app" config user.name riley && git -C "$app" config user.email riley@example.invalid
git -C "$app" add -A && git -C "$app" commit -qm genome
(cd "$app" && exec "$hale" dna dev . --no-iris >"$root/dev.log" 2>&1) &
until_ok 300 "the organization reading its nerves" grep -q "reads its facts from the nerves" "$root/dev.log"

# ---- 2. the limit, proposed as an operating practice
grammar='The rate limit for the project personal: one name: value per line, from window_seconds (the window, in seconds), requests, input_tokens, output_tokens and concurrent, each a whole number; a name left out is unlimited.'
limit() { printf '%s\nwindow_seconds: 600\nrequests: %s' "$grammar" "$1"; }
(cd "$app" && "$hale" dna practice propose operating/limits/personal --text "$(limit 2)" --because "the first limit" --as riley >/dev/null) || fail "the limit was not proposed"
until_ok 60 "the limit's Review" bash -c "cd '$app' && '$hale' dna practice 2>/dev/null | grep 'operating/limits/personal' | grep -q 'awaiting the Board'"

# ---- 3. the stub, the head, the service mapped
(umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "$root/oidc.key" 2>/dev/null) || fail "no key for the stub"
pub() { openssl ec -in "$root/oidc.key" -pubout -outform DER 2>/dev/null; }
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
spki=$(pub | base64 -w0); key_x=$(pub | tail -c 64 | head -c 32 | b64url); key_y=$(pub | tail -c 32 | b64url)
head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$root/vault/oidc-service-voice-api"
oidc_port=$(free_port); issuer=http://127.0.0.1:$oidc_port
env HALE_VAULT_DIR="$root/vault" HALE_DNA_OIDC_SERVICES=voice-api HALE_DNA_OIDC_SECRET=dna-local-secret-run \
  HALE_DNA_OIDC_KEY_FILE="$root/oidc.key" HALE_DNA_OIDC_KEY_X="$key_x" HALE_DNA_OIDC_KEY_Y="$key_y" \
  "$root/oidc/serve/serve" "$oidc_port" dna-local >"$root/stub.log" 2>&1 &
until_ok 20 "the stub answering" curl -sf -o /dev/null "$issuer/.well-known/openid-configuration"
git -C "$app" config --local --add dna.oidc.service voice-api=voice
head_port=$(free_port); api_port=$(free_port); H=http://127.0.0.1:$head_port
(cd "$app" && exec env HALE_DNA_HEAD_STATE="$root/state" HALE_DNA_OIDC_ISSUER="$issuer" HALE_DNA_OIDC_CLIENT=dna-local \
  HALE_DNA_OIDC_SECRET=dna-local-secret-run HALE_DNA_OIDC_KEY="$spki" HALE_DNA_OIDC_MEMBER=local-sub=riley \
  "$src/dna/api/project_service/project_service" "$head_port" "$src/dna/face/web" \
  "$src/dna/api/practice_review/practice_review" "$api_port" "$app" >"$root/head.log" 2>&1) &
until_ok 60 "the head listening" grep -q "hale dna head: http://127.0.0.1:$head_port/" "$root/head.log"

# ---- 4. the admin signs in through the head, and approves as the Board
curl -s -L -c "$root/jar" -b "$root/jar" -o /dev/null "$H/?token=$(cat "$root/state/head.token")"
grep -q dna_session "$root/jar" || fail "the admin did not sign in"
id=$(curl -s -b "$root/jar" "$H/api/hale/v1/head" | grep -o '"active": "[0-9a-f]*"' | head -1 | grep -o '[0-9a-f]\{40\}')
[[ -n "$id" ]] || fail "the head names no active project"
send() { curl -s -b "$root/jar" -X POST -H "Origin: $H" -H 'X-Hale-Command: 1' -H 'Content-Type: application/json' --data "$1" "$H/api/hale/v1/applications/$id/commands"; }
# the pending proposal of the limit: its digest and Review, as the head reads them
pending() { curl -s -b "$root/jar" "$H/api/hale/v1/applications/$id/dna/practices" | tr '{' '\n' | grep '"name": "operating/limits/personal"' | grep '"state": "pending"' | head -1; }
approve() {
  local row digest review
  row=$(pending); digest=$(printf '%s' "$row" | grep -o '"digest": "sha256:[0-9a-f]*"' | grep -o 'sha256:[0-9a-f]*')
  review=$(printf '%s' "$row" | grep -o '"review_id": "k:[0-9a-f]*"' | grep -o 'k:[0-9a-f]*')
  [[ -n "$digest" && -n "$review" ]] || fail "no pending limit to approve"
  send "{\"call\":\"ReviewVerdict\",\"payload\":{\"request_id\":\"$1\",\"review_id\":\"$review\",\"subject_digest\":\"$digest\",\"verdict\":\"approve\",\"comment\":\"$2\"}}" | grep -q '"value":{"ok":true' || fail "the verdict $1 was refused"
}
approve v-1 "two in the window"
in_force() { curl -s -b "$root/jar" "$H/api/hale/v1/applications/$id/dna/practices" | tr '{' '\n' | grep '"name": "operating/limits/personal"' | grep '"state": "ratified"' | grep -q "requests: $1"; }
until_ok 90 "the limit of 2 ratified" in_force 2

# ---- 5. voice's api reads it through the head, as the service
voice_port=$(free_port); V=http://127.0.0.1:$voice_port
printf 'vk-personal=personal\n' >"$root/keys"
VOICE_SERVICE_SECRET=$(cat "$root/vault/oidc-service-voice-api") "$voice/api/api" --port "$voice_port" --canned "$voice/api/canned" \
  --head "$H" --issuer "$issuer" --client voice-api --keys "$root/keys" --limits-every 1 >"$root/voice.log" 2>&1 &
until_ok 20 "voice's api answering" curl -sf -o /dev/null "$V/healthz"
ask() { curl -s -o /dev/null -D "$root/last.headers" -w '%{http_code}' -X POST -H 'Authorization: Bearer vk-personal' -H 'Content-Type: application/json' --data '{"model":"echo-1","input":"hi"}' "$V/v1/responses"; }
[[ $(ask) == 200 && $(ask) == 200 ]] || fail "the first two requests were not served"
[[ $(ask) == 429 ]] || fail "the third request was not refused"
grep -qi '^Retry-After: [0-9]' "$root/last.headers" || fail "the 429 carries no Retry-After: $(cat "$root/last.headers")"

# ---- 6. a superseding limit, through the head
active=$(curl -s -b "$root/jar" "$H/api/hale/v1/applications/$id/dna/practices" | tr '{' '\n' | grep '"name": "operating/limits/personal"' | grep '"state": "ratified"' | grep -o '"digest": "sha256:[0-9a-f]*"' | grep -o 'sha256:[0-9a-f]*')
text=$(limit 5 | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')
send "{\"call\":\"PracticePropose\",\"payload\":{\"request_id\":\"p-2\",\"subject_digest\":\"$active\",\"text\":\"$text\",\"rationale\":\"more room\"}}" | grep -q '"value":{"ok":true' || fail "the superseding limit was refused"
until_ok 60 "the superseding limit's Review" bash -c "curl -s -b '$root/jar' '$H/api/hale/v1/applications/$id/dna/practices' | tr '{' '\n' | grep '\"name\": \"operating/limits/personal\"' | grep -q '\"state\": \"pending\"'"
approve v-2 "five in the window"
until_ok 90 "the limit of 5 ratified" in_force 5
sleep 2
served=0
for _ in 1 2 3 4; do [[ $(ask) == 200 ]] && served=$((served + 1)) || break; done
[[ $served == 3 ]] || fail "under the limit of 5, $served more were served in the window (3 expected)"
echo "admin_limits: the limit of 2 refused the third request; the superseding limit of 5 served three more"
