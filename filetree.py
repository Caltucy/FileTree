#!/usr/bin/env python3
import sys
import webbrowser
from http.server import HTTPServer
from server import FileTreeHandler

def main():
    port = 8080

    # 解析命令行参数
    if len(sys.argv) > 2:
        path1 = sys.argv[1]
        path2 = sys.argv[2]
        print(f"路径1: {path1}")
        print(f"路径2: {path2}")

    # 启动服务器
    server = HTTPServer(('localhost', port), FileTreeHandler)
    print(f"服务器启动在 http://localhost:{port}")

    # 打开浏览器
    webbrowser.open(f'http://localhost:{port}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        server.shutdown()

if __name__ == '__main__':
    main()
