"""A NATS server that completes the handshake and then goes silent: it
answers the PING after CONNECT and never another. Each client that sends
CONNECT is a line in the file named by the second argument, the time it
came in seconds and the name the client gave, `-` for none (a bare TCP
probe, which says nothing, is not).

    python3 scripts/silent-nats.py PORT CONNECTIONS_FILE
"""
import json
import socket
import sys
import threading
import time

port, log = int(sys.argv[1]), sys.argv[2]


def serve(conn):
    conn.sendall(b'INFO {"server_id":"silent","max_payload":1048576}\r\n')
    answered = False
    logged = False
    buf = b""
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                return
            if not logged and (buf + data).startswith(b"CONNECT") and b"\r\n" in buf + data:
                line = (buf + data).split(b"\r\n", 1)[0][len(b"CONNECT"):]
                try:
                    name = json.loads(line).get("name") or "-"
                except ValueError:
                    name = "-"
                with open(log, "a") as f:
                    f.write("%.3f %s\n" % (time.time(), name))
                logged = True
            buf += data
            if not answered and b"PING\r\n" in buf:
                conn.sendall(b"PONG\r\n")
                answered = True
    except OSError:
        return


listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", port))
listener.listen(16)
while True:
    conn, _ = listener.accept()
    threading.Thread(target=serve, args=(conn,), daemon=True).start()
