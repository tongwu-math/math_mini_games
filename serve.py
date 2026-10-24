"""Local dev server with caching disabled.

    python3 serve.py            # http://localhost:8000 (also reachable from an iPad on the same Wi-Fi)
    python3 serve.py 8765
"""
import http.server
import socket
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving on http://localhost:{port}  (iPad: http://{lan_ip()}:{port})")
    http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()
