#!/bin/sh
# apidocs.sh: the API reference in docs/api, generated from the contract:
# spec/openapi.yaml as docs/api/voice.md and spec/node.yaml as
# docs/api/node.md. Each is bundled by the pinned redocly (spec/tools/redocly,
# as CI bundles them), then written as Markdown by apidocs/render.mjs. Run it
# after changing either contract; CI regenerates and fails on any difference.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
[ -x spec/tools/redocly/node_modules/.bin/redocly ] \
    || npm ci --prefix spec/tools/redocly --no-audit --no-fund --silent
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p docs/api
for pair in openapi:voice node:node; do
    spec=${pair%%:*}
    name=${pair#*:}
    REDOCLY_SUPPRESS_UPDATE_NOTICE=true REDOCLY_TELEMETRY=off spec/tools/redocly/node_modules/.bin/redocly bundle "spec/$spec.yaml" -o "$work/$name.json" >/dev/null
    node spec/tools/apidocs/render.mjs "$work/$name.json" "spec/$spec.yaml" "docs/api/$name.md"
    echo "docs/api/$name.md"
done
