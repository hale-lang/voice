"""The organization's nerves, as scripts/e2e.sh reaches them: a TCP proxy
to the real server that can be stalled. While the file named by the third
argument exists, every proxied connection is closed and each new one is
accepted and never answered (no INFO, nothing forwarded), as a server that
takes connections and goes silent does.

    python3 scripts/nerves-proxy.py PORT UPSTREAM_PORT STALL_FILE
"""
import os
import socket
import sys
import threading
import time

port, upstream, stall = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
live = set()
lock = threading.Lock()


def pipe(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    for s in (a, b):
        try:
            s.close()
        except OSError:
            pass


def silent(conn):
    try:
        while conn.recv(4096):
            pass
    except OSError:
        pass


def watch():
    while True:
        if os.path.exists(stall):
            with lock:
                for s in list(live):
                    try:
                        s.close()
                    except OSError:
                        pass
                live.clear()
        time.sleep(0.05)


threading.Thread(target=watch, daemon=True).start()
listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", port))
listener.listen(16)
while True:
    conn, _ = listener.accept()
    if os.path.exists(stall):
        threading.Thread(target=silent, args=(conn,), daemon=True).start()
        continue
    up = socket.create_connection(("127.0.0.1", upstream))
    with lock:
        live.add(conn)
        live.add(up)
    threading.Thread(target=pipe, args=(conn, up), daemon=True).start()
    threading.Thread(target=pipe, args=(up, conn), daemon=True).start()
