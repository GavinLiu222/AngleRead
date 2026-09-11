"""Dev-only static server with caching disabled (see .claude/launch.json)."""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 4173))
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
