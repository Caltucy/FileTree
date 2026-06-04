import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Condition, Event, Lock
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from comparator import compare_trees
from scanner import ScanCancelled, scan_directory


TASK_TTL_SECONDS = 60 * 60
TERMINAL_STATES = {'done', 'error', 'cancelled'}


class Task:
    def __init__(self, task_type, params):
        self.id = uuid4().hex
        self.type = task_type
        self.params = params
        self.status = 'queued'
        self.phase = 'queued'
        self.progress = 0
        self.message = '等待开始'
        self.stats = {}
        self.result = None
        self.error = None
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.version = 0
        self.cancel_event = Event()
        self.condition = Condition()

    def update(self, **changes):
        with self.condition:
            for key, value in changes.items():
                setattr(self, key, value)
            self.updated_at = time.time()
            self.version += 1
            self.condition.notify_all()

    def cancel(self):
        self.cancel_event.set()
        if self.status not in TERMINAL_STATES:
            self.update(status='cancelling', phase='cancelling', message='正在停止...', progress=self.progress)

    def snapshot(self, include_result=True):
        data = {
            'id': self.id,
            'type': self.type,
            'params': self.params,
            'status': self.status,
            'phase': self.phase,
            'progress': self.progress,
            'message': self.message,
            'stats': self.stats,
            'error': self.error,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'version': self.version,
        }
        if include_result and self.result is not None:
            data['result'] = self.result
        return data


class TaskManager:
    def __init__(self):
        self.tasks = {}
        self.lock = Lock()
        self.executor = ThreadPoolExecutor(max_workers=4)

    def create(self, task_type, params):
        self.cleanup()
        task = Task(task_type, params)
        with self.lock:
            self.tasks[task.id] = task

        if task_type == 'space_scan':
            self.executor.submit(run_space_scan_task, task)
        elif task_type == 'compare':
            self.executor.submit(run_compare_task, task)
        else:
            task.update(status='error', phase='error', error='Unknown task type', message='未知任务类型')
        return task

    def get(self, task_id):
        with self.lock:
            return self.tasks.get(task_id)

    def cleanup(self):
        cutoff = time.time() - TASK_TTL_SECONDS
        with self.lock:
            old_ids = [
                task_id
                for task_id, task in self.tasks.items()
                if task.status in TERMINAL_STATES and task.updated_at < cutoff
            ]
            for task_id in old_ids:
                del self.tasks[task_id]


TASK_MANAGER = TaskManager()


def progress_from_counts(files, dirs):
    return min(72, 6 + int((files + dirs) ** 0.5 * 2.8))


def run_space_scan_task(task):
    path = task.params['path']
    try:
        task.update(
            status='running',
            phase='scanning',
            progress=4,
            message='开始扫描...',
            stats={'files': 0, 'dirs': 0, 'bytes': 0, 'current_path': path},
        )

        def on_progress(info):
            files = info.get('files', 0)
            dirs = info.get('dirs', 0)
            task.update(
                status='running',
                phase='scanning',
                progress=progress_from_counts(files, dirs),
                message=f'已扫描 {files} 个文件 / {dirs} 个目录',
                stats=info,
            )

        tree = scan_directory(path, on_progress, cancel_event=task.cancel_event)
        if task.cancel_event.is_set():
            raise ScanCancelled()
        if not tree:
            task.update(status='error', phase='error', progress=100, error='Invalid path', message='路径无效')
            return

        task.update(
            status='done',
            phase='done',
            progress=100,
            message='扫描完成',
            result={'tree': tree},
            stats={
                'files': tree.get('file_count', 0),
                'dirs': tree.get('dir_count', 0),
                'bytes': tree.get('size', 0),
                'current_path': path,
            },
        )
    except ScanCancelled:
        task.update(status='cancelled', phase='cancelled', progress=task.progress, message='已停止')
    except Exception as exc:
        task.update(status='error', phase='error', progress=100, error=str(exc), message='扫描失败')


def run_compare_task(task):
    path1 = task.params['path1']
    path2 = task.params['path2']
    fast_mode = task.params.get('fastMode', True)
    scan_state = {
        'path1': {'files': 0, 'dirs': 0, 'bytes': 0, 'current_path': path1},
        'path2': {'files': 0, 'dirs': 0, 'bytes': 0, 'current_path': path2},
    }
    state_lock = Lock()

    def publish_scan_progress():
        files = scan_state['path1']['files'] + scan_state['path2']['files']
        dirs = scan_state['path1']['dirs'] + scan_state['path2']['dirs']
        task.update(
            status='running',
            phase='scanning',
            progress=min(68, progress_from_counts(files, dirs)),
            message=(
                f'初始 {scan_state["path1"]["files"]} 个文件 / '
                f'备份 {scan_state["path2"]["files"]} 个文件'
            ),
            stats=scan_state.copy(),
        )

    def make_progress(side):
        def on_progress(info):
            with state_lock:
                scan_state[side] = info
                publish_scan_progress()
        return on_progress

    try:
        task.update(
            status='running',
            phase='scanning',
            progress=4,
            message='开始扫描两个路径...',
            stats=scan_state.copy(),
        )

        with ThreadPoolExecutor(max_workers=2) as executor:
            future1 = executor.submit(scan_directory, path1, make_progress('path1'), fast_mode, task.cancel_event)
            future2 = executor.submit(scan_directory, path2, make_progress('path2'), fast_mode, task.cancel_event)
            tree1 = future1.result()
            tree2 = future2.result()

        if task.cancel_event.is_set():
            raise ScanCancelled()
        if not tree1 or not tree2:
            task.update(status='error', phase='error', progress=100, error='Invalid path', message='路径无效')
            return

        task.update(status='running', phase='comparing', progress=76, message='正在比较差异...', stats=scan_state.copy())

        def on_compare_progress(info):
            nodes = info.get('nodes', 0)
            task.update(
                status='running',
                phase='comparing',
                progress=min(96, 76 + int(nodes ** 0.5)),
                message=f'正在比较差异...已处理 {nodes} 个节点',
                stats={**scan_state, 'compare': info},
            )

        comparison = compare_trees(
            tree1,
            tree2,
            fast_mode,
            cancel_event=task.cancel_event,
            progress_callback=on_compare_progress,
        )
        if task.cancel_event.is_set():
            raise ScanCancelled()

        task.update(
            status='done',
            phase='done',
            progress=100,
            message='比较完成',
            result={'comparison': comparison},
            stats=scan_state.copy(),
        )
    except ScanCancelled:
        task.update(status='cancelled', phase='cancelled', progress=task.progress, message='已停止')
    except Exception as exc:
        task.update(status='error', phase='error', progress=100, error=str(exc), message='比较失败')


class FileTreeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(__file__), **kwargs)

    def log_message(self, format, *args):
        if sys.stderr:
            super().log_message(format, *args)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/scan':
            self.handle_scan(parsed)
        elif parsed.path == '/api/compare':
            self.handle_compare(parsed)
        elif parsed.path == '/api/task/start-scan':
            self.handle_start_scan(parsed)
        elif parsed.path == '/api/task/start-compare':
            self.handle_start_compare(parsed)
        elif parsed.path == '/api/task/status':
            self.handle_task_status(parsed)
        elif parsed.path == '/api/task/events':
            self.handle_task_events(parsed)
        elif parsed.path == '/api/task/cancel':
            self.handle_task_cancel(parsed)
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
        task = self.create_compare_task(parsed)
        if not task:
            return
        self.stream_task(task)

    def handle_start_scan(self, parsed):
        params = parse_qs(parsed.query)
        path = params.get('path', [''])[0]
        if not path:
            self.send_json({'error': 'Path required'}, 400)
            return

        task = TASK_MANAGER.create('space_scan', {'path': path})
        self.send_json({'task': task.snapshot(include_result=False)})

    def handle_start_compare(self, parsed):
        task = self.create_compare_task(parsed)
        if task:
            self.send_json({'task': task.snapshot(include_result=False)})

    def create_compare_task(self, parsed):
        params = parse_qs(parsed.query)
        path1 = params.get('path1', [''])[0]
        path2 = params.get('path2', [''])[0]
        fast_mode = params.get('fastMode', ['true'])[0].lower() == 'true'

        if not path1 or not path2:
            self.send_json({'error': 'Both paths required'}, 400)
            return None

        return TASK_MANAGER.create('compare', {
            'path1': path1,
            'path2': path2,
            'fastMode': fast_mode,
        })

    def handle_task_status(self, parsed):
        task = self.get_task_from_query(parsed)
        if task:
            self.send_json({'task': task.snapshot()})

    def handle_task_cancel(self, parsed):
        task = self.get_task_from_query(parsed)
        if task:
            task.cancel()
            self.send_json({'task': task.snapshot(include_result=False)})

    def handle_task_events(self, parsed):
        task = self.get_task_from_query(parsed)
        if task:
            self.stream_task(task)

    def get_task_from_query(self, parsed):
        params = parse_qs(parsed.query)
        task_id = params.get('id', [''])[0]
        if not task_id:
            self.send_json({'error': 'Task id required'}, 400)
            return None

        task = TASK_MANAGER.get(task_id)
        if not task:
            self.send_json({'error': 'Task not found'}, 404)
            return None

        return task

    def stream_task(self, task):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        def send_event(payload):
            self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
            self.wfile.flush()

        try:
            send_event(task.snapshot())
            last_version = task.version
            if task.status in TERMINAL_STATES:
                return

            while True:
                with task.condition:
                    task.condition.wait_for(
                        lambda: task.version > last_version or task.status in TERMINAL_STATES,
                        timeout=15,
                    )
                    snapshot = task.snapshot()
                    last_version = task.version

                send_event(snapshot)
                if snapshot['status'] in TERMINAL_STATES:
                    return
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def run_server(port=8080):
    server = ThreadingHTTPServer(('localhost', port), FileTreeHandler)
    if sys.stdout:
        print(f"服务器启动在 http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if sys.stdout:
            print("\n服务器已停止")
        server.shutdown()


if __name__ == '__main__':
    run_server()
