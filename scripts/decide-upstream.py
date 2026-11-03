"""A decision upstream (`POST <base>/systemone`), as the decision server
answers: every question its first option, likely, after a pause, so a seat
that takes one request at a time is kept busy. Each request is a line in the
file named by the second argument.

    python3 scripts/decide-upstream.py PORT REQUESTS_FILE [PAUSE_MS]
"""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port, log = int(sys.argv[1]), sys.argv[2]
pause = (int(sys.argv[3]) if len(sys.argv) > 3 else 400) / 1000
lock = threading.Lock()


def answer(q):
    t = q.get("type")
    if t == "noul":
        return {"type": "noul", "noul": 0.8}
    crit = q.get("criteria") or {}
    if t == "choice":
        names = list(crit)
        probs = {n: (0.9 if i == 0 else 0.1 / max(1, len(names) - 1)) for i, n in enumerate(names)}
        return {"type": "choice", "choice": names[0] if names else "", "confidence": 0.9, "probabilities": probs}
    levels = list(range(len(crit)))
    legend = {str(i): c.get("label", str(i)) for i, c in enumerate(crit)}
    probs = {str(i): (0.6 if i == 0 else 0.4 / max(1, len(levels) - 1)) for i in levels}
    return {"type": "score", "score": 0.5, "confidence": 0.5, "legend": legend, "probabilities": probs}


class Decide(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        qs = body.get("questions") or {}
        with lock:
            with open(log, "a") as f:
                f.write(json.dumps({"at": time.time(), "questions": list(qs)}) + "\n")
        time.sleep(pause)
        out = json.dumps({
            "model": body.get("model", "decide"),
            "answers": {k: answer(v) for k, v in qs.items()},
            "usage": {"input_tokens": 40, "output_tokens": 0},
        }).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", port), Decide).serve_forever()
