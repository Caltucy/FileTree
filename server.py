import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from scanner import scan_directory
from comparator import compare_trees

class FileTreeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(__file__), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/scan':
            self.handle_scan(parsed)
        elif parsed.path == '/api/compare':
            self.handle_compare(parsed)
        elif parsed.path == '/':
            self.path = '/static/index.html'
            return SimpleHTTPRequestHandler.do_GET(self)
        else:
            return SimpleHTTPRequestHandler.do_GET(self)

    def handle_scan(self, parsed):
        params = parse_qs(parsed.query)
        path = params.get('path', [''])[0]

        if not path:
            self.send_json({'error': 'Path required'}, 400)
            return

        tree = scan_directory(path)
        if tree:
            self.send_json({'tree': tree})
        else:
            self.send_json({'error': 'Invalid path'}, 404)

    def handle_compare(self, parsed):
        params = parse_qs(parsed.query)
        path1 = params.get('path1', [''])[0]
        path2 = params.get('path2', [''])[0]

        if not path1 or not path2:
            self.send_json({'error': 'Both paths required'}, 400)
            return

        # 发送SSE头
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        def send_progress(msg):
            self.wfile.write(f"data: {json.dumps(msg)}\n\n".encode())
            self.wfile.flush()

        file_count1 = [0]
        def progress1(count):
            file_count1[0] = count
            send_progress({'status': 'scanning', 'message': f'正在扫描路径1... ({count}个文件)', 'progress': 10})

        send_progress({'status': 'scanning', 'message': '开始扫描路径1...', 'progress': 5})
        tree1 = scan_directory(path1, progress1)

        file_count2 = [0]
        def progress2(count):
            file_count2[0] = count
            send_progress({'status': 'scanning', 'message': f'正在扫描路径2... ({count}个文件)', 'progress': 40})

        send_progress({'status': 'scanning', 'message': '开始扫描路径2...', 'progress': 35})
        tree2 = scan_directory(path2, progress2)

        if tree1 and tree2:
            send_progress({'status': 'comparing', 'message': '正在比较差异...', 'progress': 75})
            comparison = compare_trees(tree1, tree2)
            send_progress({'status': 'done', 'comparison': comparison, 'progress': 100})
        else:
            send_progress({'status': 'error', 'message': '路径无效'})

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
