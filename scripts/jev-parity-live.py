#!/usr/bin/env python3
"""jev-serve's answers held to the Jev release's own runtime, on one GGUF.

    scripts/jev-parity-live.py RELEASE_DIR GGUF SCORER URL [SCENARIOS.jsonl]

RELEASE_DIR is a checkout of the GGUF release (its jev_style_decision_gguf.py
and tokenizer/); GGUF the weights jev-serve at URL serves; SCORER the
jev-score-v2 both run. Each request goes to jev-serve and, through
jev_style's adapter, to the release's runtime (its Python renderer and the
release's tokenizer.json): the answers must agree to within --tol on every
probability, with the same choice. jevsploration's routed views over its
scenarios make the requests (string states), and each scenario is asked
about as a structured state too.
"""
import argparse
import importlib.util
import json
import sys
import time
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("release")
ap.add_argument("gguf")
ap.add_argument("scorer")
ap.add_argument("url")
ap.add_argument("scenarios", nargs="?")
ap.add_argument("--tol", type=float, default=1e-6)
ap.add_argument("--limit", type=int, default=40)
a = ap.parse_args()

spec = importlib.util.spec_from_file_location("ref", f"{a.release}/jev_style_decision_gguf.py")
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)
from jev_style.adapter import Adapter  # noqa: E402

runtime = ref.JevStyleDecisionGGUF(a.release, gguf=a.gguf, binary=a.scorer)
adapter = Adapter(runtime, ref, "llama.cpp", "jev-style-2b-decision-v3")


def noul(text):
    return {"type": "noul", "instructions": text}


def requests(scenarios):
    out = []
    for line in open(scenarios).readlines()[: a.limit]:
        s = json.loads(line)
        orders = {o["id"]: f"{o['side']} {o['qty']} at {o['ticks']}t from mid" for o in s["orders"]}
        qs = {
            "risk": noul("Inventory risk needs attention: the position is near or at its limit, or the flow is against it."),
            "stale": noul("At least one resting order is stale."),
            "act": {"type": "choice", "instructions": "Which order needs attention first?",
                    "criteria": orders or {"none": None}},
            "size": {"type": "score", "instructions": "How large should a new quote be?",
                     "criteria": ["small, 0.5", {"label": "larger", "description": "1.0"}, "largest, 2.0"]},
        }
        out.append({"state": s, "questions": qs})
        view = "\n".join(f"{k}: {json.dumps(v)}" for k, v in s.items() if k not in ("label", "truths", "routing"))
        out.append({"state": view, "questions": qs})
    return out


def post(body):
    req = urllib.request.Request(a.url + "/v1/systemone", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)


worst, failed, n = 0.0, 0, 0
for body in requests(a.scenarios):
    t0 = time.perf_counter()
    got = post(body)
    t1 = time.perf_counter()
    want = adapter.systemone(body)
    t2 = time.perf_counter()
    n += 1
    if got["usage"]["input_tokens"] != want["usage"]["input_tokens"]:
        failed += 1
        print(f"tokens differ: {got['usage']} vs {want['usage']}", file=sys.stderr)
    for qid, w in want["answers"].items():
        g = got["answers"][qid]
        if w.get("choice") != g.get("choice"):
            failed += 1
            print(f"{qid}: choice {g.get('choice')} vs {w.get('choice')}", file=sys.stderr)
        pw = w.get("probabilities", {"true": w.get("noul")})
        pg = g.get("probabilities", {"true": g.get("noul")})
        for k, v in pw.items():
            worst = max(worst, abs(v - pg[k]))
    print(f"{n}: jev-serve {1000 * (t1 - t0):.0f} ms, release {1000 * (t2 - t1):.0f} ms, "
          f"{want['usage']['input_tokens']} tokens", file=sys.stderr)
print(json.dumps({"requests": n, "failed": failed, "max_abs_dp": worst, "tol": a.tol}))
sys.exit(1 if failed or worst > a.tol else 0)
