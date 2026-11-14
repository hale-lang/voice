"""An OpenAI-compatible upstream as strict as llama-server about a
conversation's past tool calls: a request whose history holds a call whose
arguments are not one JSON object with every number a finite double answers
500 with llama-server's message, as its chat template fails to parse them.
Any other request whose last message says `fail` answers 503; the rest are
answered with a call whose arguments hold a number no double holds,
`{"session_id":58e595,"chars":""}`, cut across two fragments, as a model once
wrote it. Each request's body is a line in the file named by the second
argument.

    python3 scripts/strict-upstream.py PORT REQUESTS_FILE
"""
import json
import math
import socket
import sys
import threading

port, log = int(sys.argv[1]), sys.argv[2]


def chunk(b):
    return b"%x\r\n" % len(b) + b + b"\r\n"


def finite(s):
    # as nlohmann::json reads a number: an integer past 64 bits, or any
    # number with a fraction or an exponent, as a double
    try:
        v = float(s)
    except OverflowError:
        raise ValueError("number overflow parsing '%s'" % s)
    if math.isinf(v) or math.isnan(v):
        raise ValueError("number overflow parsing '%s'" % s)
    return v


def refuse(word):
    raise ValueError("syntax error while parsing value: %s" % word)


def unparsable(messages):
    for m in messages:
        for tc in m.get("tool_calls") or []:
            args = tc.get("function", {}).get("arguments", "")
            try:
                v = json.loads(args, parse_float=finite, parse_int=finite, parse_constant=refuse)
                if not isinstance(v, dict):
                    raise ValueError("not an object")
            except ValueError as e:
                return str(e)
    return ""


def frag(args, first):
    call = {"index": 0, "function": {"arguments": args}}
    if first:
        call.update({"id": "call_s", "type": "function"})
        call["function"]["name"] = "write_stdin"
    delta = {"tool_calls": [call]}
    return b"data: " + json.dumps({"model": "stub-7b", "choices": [{"index": 0, "delta": delta}]}).encode() + b"\n\n"


def answer(conn, status, body):
    conn.sendall(
        b"HTTP/1.1 " + status + b"\r\nContent-Type: application/json\r\nContent-Length: "
        + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body
    )


def serve(conn):
    buf = b""
    try:
        while b"\r\n\r\n" not in buf:
            data = conn.recv(65536)
            if not data:
                return
            buf += data
        head, _, body = buf.partition(b"\r\n\r\n")
        want = 0
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"content-length:"):
                want = int(line.split(b":", 1)[1])
        while len(body) < want:
            data = conn.recv(65536)
            if not data:
                break
            body += data
        with open(log, "a") as f:
            f.write(body.decode("utf-8", "replace").replace("\n", " ") + "\n")
        req = json.loads(body)
        messages = req.get("messages", [])
        why = unparsable(messages)
        if why:
            answer(conn, b"500 Internal Server Error", json.dumps({"error": {"code": 500, "message": "Failed to parse tool call arguments as JSON: [json.exception.out_of_range.406] " + why, "type": "server_error"}}).encode())
            return
        if messages and messages[-1].get("content") == "fail":
            answer(conn, b"503 Service Unavailable", b'{"error":{"message":"model is loading"}}')
            return
        conn.sendall(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
            b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            + chunk(frag("", True))
            + chunk(frag('{"session_id":58', False))
            + chunk(frag('e595,"chars":""}', False))
            + chunk(b'data: {"model":"stub-7b","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n')
            + b"0\r\n\r\n"
        )
    except (OSError, ValueError):
        pass
    finally:
        conn.close()


srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", port))
srv.listen(8)
while True:
    c, _ = srv.accept()
    threading.Thread(target=serve, args=(c,), daemon=True).start()
