"""Send one request to a NATS server, print the reply's payload and exit;
exit 1 when no reply comes within 5 s. For JetStream's API in the end to
end (`$JS.API.STREAM.INFO.<stream>`, `$JS.API.STREAM.DELETE.<stream>`).

    python3 scripts/nats-request.py HOST:PORT SUBJECT [BODY]
"""
import socket
import sys

host, _, port = sys.argv[1].rpartition(":")
subject = sys.argv[2]
body = sys.argv[3].encode() if len(sys.argv) > 3 else b""
inbox = b"_INBOX.e2e-request"
s = socket.create_connection((host, int(port)), timeout=5)
s.recv(4096)
s.sendall(b'CONNECT {"verbose":false,"pedantic":false,"headers":true,"no_responders":true}\r\n')
s.sendall(b"SUB %s 1\r\n" % inbox)
s.sendall(b"PUB %s %s %d\r\n%s\r\n" % (subject.encode(), inbox, len(body), body))
data = b""
try:
    while True:
        chunk = s.recv(65536)
        if not chunk:
            sys.exit(1)
        data += chunk
        while b"\r\n" in data:
            line, rest = data.split(b"\r\n", 1)
            if line.startswith(b"PING"):
                s.sendall(b"PONG\r\n")
                data = rest
                continue
            if line.startswith(b"MSG ") or line.startswith(b"HMSG "):
                size = int(line.split()[-1])
                if len(rest) < size + 2:
                    break
                payload = rest[:size]
                if line.startswith(b"HMSG "):
                    head = int(line.split()[-2])
                    payload = payload[head:]
                sys.stdout.write(payload.decode())
                sys.stdout.write("\n")
                sys.exit(0)
            data = rest
except socket.timeout:
    sys.exit(1)
