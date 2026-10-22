"""Publish one message to a NATS server and exit.

    python3 scripts/nats-publish.py HOST:PORT SUBJECT BODY
"""
import socket
import sys

host, _, port = sys.argv[1].rpartition(":")
subject, body = sys.argv[2], sys.argv[3].encode()
s = socket.create_connection((host, int(port)), timeout=5)
s.recv(4096)
s.sendall(b'CONNECT {"verbose":false,"pedantic":false}\r\n')
s.sendall(b"PUB %s %d\r\n%s\r\nPING\r\n" % (subject.encode(), len(body), body))
data = b""
while b"PONG" not in data:
    chunk = s.recv(4096)
    if not chunk:
        break
    data += chunk
s.close()
