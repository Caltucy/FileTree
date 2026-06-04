#!/usr/bin/env python3
import sys
import webbrowser
from urllib.parse import urlencode
from server import run_server

def main():
    port = 8080
    url = f'http://localhost:{port}'

    # 解析命令行参数
    if len(sys.argv) > 2:
        path1 = sys.argv[1]
        path2 = sys.argv[2]
        print(f"路径1: {path1}")
        print(f"路径2: {path2}")
        url = f'{url}?{urlencode({"path1": path1, "path2": path2})}'

    # 打开浏览器
    webbrowser.open(url)
    run_server(port)

if __name__ == '__main__':
    main()
