import hashlib
import time
from pathlib import Path
from datetime import datetime


class ScanCancelled(Exception):
    """扫描任务被用户取消。"""


def get_file_hash(filepath, chunk_size=8192, cancel_event=None):
    """计算文件MD5哈希。"""
    md5 = hashlib.md5()
    try:
        with open(filepath, 'rb') as f:
            while chunk := f.read(chunk_size):
                if cancel_event and cancel_event.is_set():
                    raise ScanCancelled()
                md5.update(chunk)
        return md5.hexdigest()
    except ScanCancelled:
        raise
    except (PermissionError, FileNotFoundError, OSError):
        return None


def scan_directory(root_path, progress_callback=None, fast_mode=True, cancel_event=None):
    """扫描目录并返回树形结构。"""
    root = Path(root_path)
    if not root.exists():
        return None

    file_count = 0
    dir_count = 0
    bytes_count = 0
    last_progress_at = 0

    def check_cancelled():
        if cancel_event and cancel_event.is_set():
            raise ScanCancelled()

    def emit_progress(path, force=False):
        nonlocal last_progress_at
        if not progress_callback:
            return

        now = time.monotonic()
        if not force and now - last_progress_at < 0.12:
            return

        last_progress_at = now
        progress_callback({
            'files': file_count,
            'dirs': dir_count,
            'bytes': bytes_count,
            'current_path': str(path),
        })

    def build_tree(path):
        nonlocal file_count, dir_count, bytes_count
        check_cancelled()

        is_dir = path.is_dir() and not path.is_symlink()
        item = {
            'name': path.name or str(path),
            'path': str(path),
            'is_dir': is_dir,
            'is_symlink': path.is_symlink(),
        }

        if not is_dir:
            try:
                stat = path.stat()
                item['size'] = stat.st_size
                item['modified'] = datetime.fromtimestamp(stat.st_mtime).isoformat()
                item['hash'] = None if fast_mode else get_file_hash(path, cancel_event=cancel_event)
                item['file_count'] = 1
                item['dir_count'] = 0
                file_count += 1
                bytes_count += item['size']
                emit_progress(path)
            except (PermissionError, FileNotFoundError, OSError):
                item['size'] = 0
                item['modified'] = None
                item['hash'] = None
                item['file_count'] = 1
                item['dir_count'] = 0
                item['inaccessible'] = True
                file_count += 1
                emit_progress(path)
        else:
            dir_count += 1
            emit_progress(path)
            item['children'] = []
            total_size = 0
            total_files = 0
            total_dirs = 1
            try:
                for child in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                    check_cancelled()
                    child_item = build_tree(child)
                    if child_item:
                        item['children'].append(child_item)
                        total_size += child_item.get('size', 0)
                        total_files += child_item.get('file_count', 0)
                        total_dirs += child_item.get('dir_count', 0)
            except (PermissionError, FileNotFoundError, OSError):
                item['inaccessible'] = True

            item['size'] = total_size
            item['file_count'] = total_files
            item['dir_count'] = total_dirs

        return item

    tree = build_tree(root)
    emit_progress(root, force=True)
    return tree
