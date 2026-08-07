#!/usr/bin/env python3
"""开发服务器：静态文件 + 禁用浏览器缓存（确保每次刷新都拿到最新代码）。

用法: python3 dev_server.py [端口]   （默认 8000）
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".js": "text/javascript",
    }

    def end_headers(self):
        # 开发环境禁用缓存：每次请求都回源验证
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"开发服务器: http://localhost:{port}  (Cache-Control: no-cache)")
    HTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()


if __name__ == "__main__":
    main()
