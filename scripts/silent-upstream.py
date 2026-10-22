"""An OpenAI-compatible upstream that opens its stream and goes silent: it
answers a POST with the head of a chunked `text/event-stream` and one event,
then sends nothing and holds the connection open. Each request is a line in
the file named by the second argument.

    python3 scripts/silent-upstream.py PORT REQUESTS_FILE
"""
import socket
import sys
import threading
import time

port, log = int(sys.argv[1]), sys.argv[2]

EVENT = b'data: {"model":"stub-7b","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n'


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
        conn.sendall(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
            b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            + b"%x\r\n" % len(EVENT) + EVENT + b"\r\n"
        )
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
