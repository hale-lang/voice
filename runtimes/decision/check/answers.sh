#!/bin/sh
# answers.sh URL: a decision server at URL comes up (its /healthz) within
# ten minutes and answers a request: a choice, a noul and a score, each as
# the contract has it, with the release's readout (a likely answer).
set -eu
url=${1:?usage: answers.sh URL}
i=0
until curl -fsS "$url/healthz" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 600 ] || { echo "no /healthz at $url" >&2; exit 1; }
    sleep 1
done
got=$(curl -fsS "$url/v1/systemone" -H 'Content-Type: application/json' -d '{
  "state": "I was charged twice for the same order on my card.",
  "questions": {
    "route": {"type": "choice", "instructions": "Which team should handle it?",
              "criteria": {"billing": "Charges and refunds.", "security": "Account compromise.", "shipping": null}},
    "dup": {"type": "noul", "instructions": "Is it a duplicate charge?"},
    "urgency": {"type": "score", "instructions": "How urgent is it?", "criteria": ["low", "medium", "high"]}
  }
}')
echo "$got"
echo "$got" | python3 -c '
import json, sys
a = json.load(sys.stdin)["answers"]
assert a["route"]["choice"] == "billing", a["route"]
assert a["dup"]["noul"] > 0.5, a["dup"]
assert abs(sum(a["urgency"]["probabilities"].values()) - 1) < 1e-9, a["urgency"]
print("answers as expected")
'
