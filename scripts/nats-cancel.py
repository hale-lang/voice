"""Wait for a `serve` on a node's subject, then cancel that request.

    python3 scripts/nats-cancel.py HOST:PORT SUBJECT_PREFIX DELAY_SECONDS

Subscribes to SUBJECT_PREFIX.>, waits (up to 30 s) for the message on
SUBJECT_PREFIX.serve, waits DELAY_SECONDS, publishes `cancel` for the request
it named on SUBJECT_PREFIX.cancel, and prints the time it did, in
nanoseconds since the epoch.
"""
import json
import re
import socket
import sys
import time

addr, prefix, delay = sys.argv[1], sys.argv[2], float(sys.argv[3])
host, _, port = addr.rpartition(":")
s = socket.create_connection((host, int(port)), timeout=30)
s.recv(4096)
s.sendall(b'CONNECT {"verbose":false,"pedantic":false}\r\n')
s.sendall(b"SUB %s.> 1\r\n" % prefix.encode())
buf = b""
request_id = None
while request_id is None:
    data = s.recv(65536)
    if not data:
        sys.exit("NATS closed before a serve")
    buf += data
    m = re.search(rb"MSG %s\.serve \d+ (?:\S+ )?(\d+)\r\n" % re.escape(prefix.encode()), buf)
    if m:
        n = int(m.group(1))
        body = buf[m.end():m.end() + n]
        if len(body) >= n:
            request_id = json.loads(body)["request_id"]
    if b"PING\r\n" in buf:
        s.sendall(b"PONG\r\n")
        buf = buf.replace(b"PING\r\n", b"")
time.sleep(delay)
cancel = json.dumps({"type": "cancel", "request_id": request_id}).encode()
s.sendall(b"PUB %s.cancel %d\r\n%s\r\nPING\r\n" % (prefix.encode(), len(cancel), cancel))
print(time.time_ns(), flush=True)
s.settimeout(5)
try:
    while b"PONG" not in s.recv(4096):
        pass
except OSError:
    pass
