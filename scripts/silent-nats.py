"""A NATS server that completes the handshake and then goes silent: it
answers the PING after CONNECT and never another. Each client that sends
CONNECT is a line in the file named by the second argument (a bare TCP
probe, which says nothing, is not).

    python3 scripts/silent-nats.py PORT CONNECTIONS_FILE
"""
import socket
import sys
import threading

port, log = int(sys.argv[1]), sys.argv[2]


def serve(conn):
    conn.sendall(b'INFO {"server_id":"silent","max_payload":1048576}\r\n')
    answered = False
    buf = b""
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                return
            if not buf.startswith(b"CONNECT") and (buf + data).startswith(b"CONNECT"):
                with open(log, "a") as f:
                    f.write("connection\n")
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
