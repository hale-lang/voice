#!/usr/bin/env python3
"""Writes jev/tests/fixtures/render_cases.hl: the texts the Jev release's own renderer
tokenizes for each of a set of systemone requests, which jev-serve's renderer
must give byte for byte (jev/tests/render_test.hl), and, tokenized with the
release's tokenizer.json, the request its runtime sends jev-score-v2: the
tokens, blocks and slots, or the budget refused.

    scripts/jev-parity.py RELEASE_DIR [SCENARIOS.jsonl]

RELEASE_DIR is a checkout of the GGUF release (its jev_style_decision_gguf.py,
the reference renderer); the requests are jev_style's contract (schema.py,
from the jev_style package on the path). With SCENARIOS (jevsploration's
data/scenarios.jsonl), each scenario is asked about as a structured state
too (the first 12). Every request is either rendered (its texts: the state, then each
question's head and options) or refused (its error code and question).
"""
import importlib.util
import json
import sys

release, scenarios = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
spec = importlib.util.spec_from_file_location("ref", f"{release}/jev_style_decision_gguf.py")
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)
from jev_style.adapter import Adapter  # noqa: E402
from jev_style.schema import ApiError, parse_json, parse_request  # noqa: E402

enc = ref.TextEncoder(f"{release}/tokenizer/tokenizer.json")
cfg = json.load(open(f"{release}/readout_config.json"))
renderer = ref.Renderer(enc, cfg)
GLUE = ["State:\n", "\n\n", "\n", "- ", " ->", "Judge each numbered option in the complete catalogue above:\n",
        " yes", " no"] + [t for i in range(1, 256) for t in (f"Option {i}: ", f"Option {i}")]

TRIAGE = {
    "risk": {"type": "noul", "instructions": "Inventory risk needs attention: the position is near its limit."},
    "quote": {"type": "noul", "instructions": "The standing quotes need maintenance.",
              "criteria": {"false": "they are fresh", "true": {"why": ["stale", 2.5]}}},
}
OPP = {
    "side": {"type": "choice", "instructions": "Which side, if any, should receive a new quote?",
             "criteria": {"bid": "place a new bid", "ask": "place a new ask", "none": None}},
    "distance": {"type": "score", "instructions": "How far from mid should a new quote rest?",
                 "criteria": ["at the touch, 1 tick", {"label": "2 ticks", "description": "out"},
                              {"label": "3 ticks", "description": ""}, {"label": "far", "note": 1},
                              {"rank": 5}, [1, "x"]]},
}
EDGE_STATES = [
    "plain text state\nwith a line",
    "",
    "unicode: é 日本 😀 \u0000 tab\t <|im_end|>",
    {"floats": [1.0, 2.50, 1e16, 1e15, 1E2, 1e-5, 0.0001, -0.0, 123456789.123, 1e22, 5e-324, 1.5e300],
     "ints": [0, -0, 12345678901234567890, -7], "nested": {"a": [], "b": {}, "c": [{"d": None, "e": True}]}},
    ["array", "state", {"k": "v"}],
    {"escapes": "q\"b\\s/\b\f\n\r\t\u0001\u001f\u007f ", "key \"quoted\"": 1},
]
BAD = [
    "not json",
    "[1, 2]",
    {"state": "s"},
    {"state": 5, "questions": TRIAGE},
    {"state": "s", "questions": {}},
    {"state": "s", "questions": {"": {"type": "noul", "instructions": "x"}}},
    {"state": "s", "questions": {"q": {"type": "maybe", "instructions": "x"}}},
    {"state": "s", "questions": {"q": {"type": "noul"}}},
    {"state": "s", "questions": {"q": {"type": "noul", "instructions": "   "}}},
    {"state": "s", "questions": {"q": {"type": "noul", "instructions": {}}}},
    {"state": "s", "questions": {"q": {"type": "noul", "instructions": "x", "criteria": {"maybe": "y"}}}},
    {"state": "s", "questions": {"q": {"type": "noul", "instructions": "x", "criteria": {"true": 3}}}},
    {"state": "s", "questions": {"q": {"type": "choice", "instructions": "x", "criteria": {}}}},
    {"state": "s", "questions": {"q": {"type": "choice", "instructions": "x", "criteria": {" ": None}}}},
    {"state": "s", "questions": {"q": {"type": "choice", "instructions": "x", "criteria": ["a"]}}},
    {"state": "s", "questions": {"q": {"type": "score", "instructions": "x", "criteria": ["one"]}}},
    {"state": "s", "questions": {"q": {"type": "score", "instructions": "x", "criteria": ["a", ""]}}},
    {"state": "s", "questions": {"q": {"type": "score", "instructions": "x", "criteria": ["a", {"label": ""}]}}},
    {"state": "s", "questions": {"q": {"type": "score", "instructions": "x",
                                       "criteria": ["a", {"label": "b", "description": 2}]}}},
    {"state": "s", "questions": {"q": {"type": "score", "instructions": "x", "criteria": ["a", 7]}}},
]


def texts(body):
    """The texts the reference renderer tokenizes, in jev-serve's order."""
    parsed = parse_request(parse_json(body.encode()))
    out = [ref.serialize_state(parsed.state)]
    for q in parsed.questions:
        question = ref.make_question(q.internal)
        out.append(f"Question [{question['t']}]: {question['ins']}\nOptions:\n")
        out.extend(ref.render_options(question))
    return out


def scorer_request(body, limit):
    """The request the release's runtime sends jev-score-v2 (JevStyleDecisionGGUF._scores_many)."""
    parsed = parse_request(parse_json(body.encode()))
    qs = [ref.make_question(q.internal) for q in parsed.questions]
    prefix = renderer.prefix_ids(parsed.state)
    rs = [renderer.render(parsed.state, q, limit, prefix=prefix) for q in qs]
    p = rs[0].prefix_len
    rows = [renderer.yes, renderer.no]
    return {"prefix": rs[0].ids[:p], "prefix_blocks": [list(b) for b in rs[0].state_blocks], "keep_prefix": True,
            "questions": [{"ids": r.ids[p:], "blocks": [list(b) for b in r.question_blocks], "slots": list(r.slots),
                           "rows": rows} for r in rs]}


def case(body, limit=ref.CONTEXT_LIMIT):
    try:
        t = texts(body)
    except ApiError as e:
        return {"body": body, "error": e.code, "question": e.question or ""}
    out = {"body": body, "texts": t, "limit": limit, "tokens": {"ids": [enc(x) for x in t]}}
    try:
        out["request"] = scorer_request(body, limit)
    except ref.InputBudgetError:
        out["budget"] = True
        return out
    # scores as the scorer would give them, fixed per option, and the
    # answers the release's readout and jev_style's adapter make of them
    parsed = parse_request(parse_json(body.encode()))
    t = cfg["temperatures"]["global"]
    results, answers = [], {}
    for n, q in enumerate(parsed.questions):
        k = len(q.options)
        scores = [((7 * i + 3 * n) % 11 - 5) * 0.9 for i in range(k)]
        results.append({"scores": scores})
        p = ref.softmax_probabilities(scores, t)
        names = q.options if q.type != "noul" else ["false", "true"]
        answers[q.id] = Adapter._answer(q, {"probabilities": dict(zip(names, p.tolist()))})
    out["scored"] = {"results": results}
    out["answers"] = answers
    return out


bodies = []
for s in EDGE_STATES:
    bodies.append(json.dumps({"state": s, "questions": {**TRIAGE, **OPP}}, ensure_ascii=False))
bodies.append(json.dumps({"model": "jev", "state": "s", "questions": OPP}, separators=(",", ":")))
bodies.append('{"state":"s","questions":{"q":{"type":"noul","instructions":{"ask":"why?","n":[1.0,2]}}}}')
# numbers as a caller spells them, which a Python literal cannot
bodies.append('{"state":{"x":[1e400,-1e400,1E2,-0,2.50,1e-400,0.1e1,-12.5E-3]},"questions":{"q":{"type":"noul","instructions":"x"}}}')
bodies.append('{"state":"\\u00e9\\ud83d\\ude00","questions":{"\\u0071":{"type":"noul","instructions":"x"}}}')
for b in BAD:
    bodies.append(b if isinstance(b, str) else json.dumps(b))
if scenarios:
    for line in open(scenarios).readlines()[:12]:
        s = json.loads(line)
        orders = {o["id"]: f"order {o['id']}: {o['side']} {o['qty']} at {o['ticks']}t" for o in s["orders"]}
        q = {"act": {"type": "choice", "instructions": "Which order needs attention first?",
                     "criteria": orders or {"none": None}}, **TRIAGE}
        bodies.append(json.dumps({"state": s, "questions": q}, ensure_ascii=False))

# a catalogue: options too long for one block, so a catalogue and a rubric
long = {f"opt{i}": f"option {i}: " + "a long description of what this choice means, " * 6 for i in range(40)}
bodies.append(json.dumps({"state": "s", "questions": {"pick": {"type": "choice", "instructions": "Which?",
                                                               "criteria": long}}}))
cases = [case(b) for b in bodies]
# over the budget: a request of its own, held to 40 tokens
cases.append(case(json.dumps({"state": "a state " * 20, "questions": TRIAGE}), 40))
cases = "\n".join(json.dumps(c, ensure_ascii=False) for c in cases)
with open("jev/tests/fixtures/render_cases.hl", "w") as f:
    f.write("// Generated by scripts/jev-parity.py from the Jev release's own renderer;\n")
    f.write("// one case a line: a request's body and the texts it renders, or its refusal.\n\n")
    f.write('const RENDER_CASES: String = """\n')
    for line in cases.split("\n"):
        f.write("    " + line + "\n")
    f.write('    """;\n\n')
    f.write("// The release's tokenization of the fixed pieces (jev::glue_texts), and its readout_config.json.\n")
    f.write('const GLUE_TOKENS: String = """\n    ' + json.dumps({"ids": [enc(x) for x in GLUE]}) + '\n    """;\n\n')
    f.write('const READOUT_CONFIG: String = """\n    ' + json.dumps(cfg, ensure_ascii=False) + '\n    """;\n')
print(f"{len(bodies)} cases")
