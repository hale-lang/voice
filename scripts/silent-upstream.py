"""An OpenAI-compatible upstream that opens its stream and goes silent: it
answers a POST with the head of a chunked `text/event-stream` and one event,
then sends nothing and holds the connection open. Each request is a line in
the file named by the second argument.

    python3 scripts/silent-upstream.py PORT REQUESTS_FILE [nohead|kept]

With `nohead` it reads the request and never answers: not a byte of a head.
With `kept` it is an engine at work on a tool call it sends whole at the
end, as TensorFold's grammar-constrained path does: after its event, only
SSE keep-alive comments, every 2 s for 18 s, then the call, whole, and the
stream's end.
"""
import socket
import sys
import threading
import time

port, log = int(sys.argv[1]), sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else ""
nohead = mode == "nohead"

EVENT = b'data: {"model":"stub-7b","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n'
CALL = (
    b'data: {"model":"stub-7b","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_k","type":"function","function":{"name":"write","arguments":"{\\"path\\":\\"nums.txt\\"}"}}]}}]}\n\n'
    b'data: {"model":"stub-7b","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n'
    b"data: [DONE]\n\n"
)


def chunk(b):
    return b"%x\r\n" % len(b) + b + b"\r\n"


def serve(conn):
    buf = b""
    try:
        while b"\r\n\r\n" not in buf:
            data = conn.recv(65536)
            if not data:
                return
            buf += data
        with open(log, "a") as f:
            f.write("%.3f\n" % time.time())
        if not nohead:
            conn.sendall(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                + chunk(EVENT)
            )
        if mode == "kept":
            for _ in range(9):
                time.sleep(2)
                conn.sendall(chunk(b": keepalive\n\n"))
            conn.sendall(chunk(CALL) + b"0\r\n\r\n")
            return
        # silent from here, until the client goes away
        while conn.recv(4096):
            pass
    except OSError:
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
