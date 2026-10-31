"""A jev-score-v2 build, held to the Jev-Style release it serves.

    python3 check.py RUNTIME_DIR MODEL_DIR

RUNTIME_DIR is build.sh's decision-runtime; MODEL_DIR the Jev-Style-2B-Decision-v3-GGUF
repository at the revision the scorer is vendored from (its Q8_0 GGUF, tokenizer/,
readout_config.json and jev_style_decision_gguf.py, the reference runtime). Needs
numpy and tokenizers. It checks, on whatever backend the build runs:

  * tokenize and tokenize_many give the ids the release's tokenizer gives (no
    BOS/EOS, special tokens split as text), on the text the reference renderer
    tokenises and on text made to be awkward;
  * meta reads the GGUF's architecture, depth and width as the reference checks
    them, and null for a key the GGUF has not;
  * the reference runtime, scoring through this build, answers cases.json as the
    MLX bf16 release does: the same answer, each probability within MAX_DIFF.
"""
import json
import random
import subprocess
import sys
from pathlib import Path

MAX_DIFF = 0.02

runtime, model = Path(sys.argv[1]), Path(sys.argv[2])
binary = runtime / "jev-score-v2"
gguf = model / "Jev-Style-2B-Decision-v3-Q8_0.gguf"
sys.path.insert(0, str(model))
import jev_style_decision_gguf as ref  # noqa: E402

failures = []


def fail(msg):
    failures.append(msg)
    print("FAIL", msg)


class Scorer:
    def __init__(self):
        self.p = subprocess.Popen([str(binary), "--model", str(gguf), "--n-ctx", "8192"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.ready = json.loads(self.p.stdout.readline())

    def ask(self, req):
        self.p.stdin.write(json.dumps(req) + "\n")
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())

    def close(self):
        self.p.stdin.write('{"cmd":"quit"}\n')
        self.p.stdin.close()
        self.p.wait(timeout=60)


cases = json.load(open(Path(__file__).with_name("cases.json")))["cases"]
encode = ref.TextEncoder(model / "tokenizer" / "tokenizer.json")
s = Scorer()
if not s.ready.get("ready"):
    sys.exit(f"jev-score-v2 did not start: {s.ready}")
print(f"backend: gpu_offload={s.ready['gpu_offload']} flash_attn={s.ready['flash_attn']}")

# the text a rendering tokenises: every segment the reference renderer encodes
seen = []
renderer = ref.Renderer(lambda t: (seen.append(t), encode(t))[1],
                        json.load(open(model / "readout_config.json")))
for c in cases:
    for q in c["questions"]:
        renderer.render(c["state"], ref.make_question(q["question"]))
rng = random.Random(7)
alphabet = "abc XYZ\n\t.,;:!?-_'\"()[]{}<>|/\\0123é中🎉​ "
texts = seen + ["", "<|im_start|>user hi<|im_end|>", "<|endoftext|>", "a" * 5000, "  \r\n\r\n  ",
                "émoji 🎉 中文 ελληνικά", "123456789 3.14159 -42"]
texts += ["".join(rng.choice(alphabet) for _ in range(rng.randint(1, 200))) for _ in range(300)]
many = s.ask({"cmd": "tokenize_many", "texts": texts}).get("ids")
if many is None or len(many) != len(texts):
    fail(f"tokenize_many: {len(texts)} texts, {many and len(many)} answers")
else:
    for t, got in zip(texts, many):
        want = encode(t)
        one = s.ask({"cmd": "tokenize", "text": t}).get("ids")
        if got != want or one != want:
            fail(f"tokenize {t[:40]!r}: the tokenizer gives {want[:8]}, tokenize {one and one[:8]}, "
                 f"tokenize_many {got[:8]}")
print(f"tokenize: {len(texts)} texts ({len(seen)} from renderings)")

keys = list(ref.EXPECTED_GGUF) + ["voice.no.such.key"]
meta = s.ask({"cmd": "meta", "keys": keys}).get("meta", {})
want = {k: str(v) for k, v in ref.EXPECTED_GGUF.items()} | {"voice.no.such.key": None}
if meta != want:
    fail(f"meta: {meta}, expected {want}")
print(f"meta: {meta}")
s.close()

engine = ref.JevStyleDecisionGGUF(model, gguf=gguf, binary=binary)
for c in cases:
    got = engine.score_many(c["state"], [q["question"] for q in c["questions"]])
    for q, r in zip(c["questions"], got):
        want = q["mlx_bf16"]
        diff = max(abs(r["probabilities"][k] - p) for k, p in want.items())
        answer = max(want, key=want.get)
        name = f"{c['name']}/{q['id']}"
        print(f"score {name}: {r['answer']} ({r['top_probability']:.4f}), max |dp| {diff:.4f} "
              f"vs MLX bf16 ({answer})")
        if r["answer"] != answer:
            fail(f"score {name}: answers {r['answer']}, MLX bf16 answers {answer}")
        if diff > MAX_DIFF:
            fail(f"score {name}: a probability {diff:.4f} from MLX bf16's (at most {MAX_DIFF})")
engine.close()

if failures:
    sys.exit(f"{len(failures)} failed")
print("ok")
