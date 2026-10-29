"""Same-origin local static preview with browser caching disabled."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    project = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--directory', type=Path, default=project.parent)
    args = parser.parse_args()
    handler = functools.partial(PreviewHandler, directory=str(args.directory.resolve()))
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        print(f'Preview listening on http://127.0.0.1:{server.server_port}/ (no-store)', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
