import os
import hashlib
from pathlib import Path
from datetime import datetime

def get_file_hash(filepath, chunk_size=8192):
    """计算文件MD5哈希"""
    md5 = hashlib.md5()
    try:
        with open(filepath, 'rb') as f:
            while chunk := f.read(chunk_size):
                md5.update(chunk)
        return md5.hexdigest()
    except:
        return None

def scan_directory(root_path, progress_callback=None, fast_mode=True):
    """扫描目录并返回树形结构"""
    root = Path(root_path)
    if not root.exists():
        return None

    file_count = 0

    def build_tree(path):
        nonlocal file_count
        item = {
            'name': path.name or str(path),
            'path': str(path),
            'is_dir': path.is_dir(),
        }

        if path.is_file():
            try:
                stat = path.stat()
                item['size'] = stat.st_size
                item['modified'] = datetime.fromtimestamp(stat.st_mtime).isoformat()
                # 快速模式：先不计算哈希，留到比较时按需计算
                item['hash'] = None if fast_mode else get_file_hash(path)
                file_count += 1
                if progress_callback and file_count % 10 == 0:
                    progress_callback(file_count)
            except:
                item['size'] = 0
                item['modified'] = None
                item['hash'] = None
        else:
            item['children'] = []
            total_size = 0
            try:
                for child in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name)):
                    child_item = build_tree(child)
                    if child_item:
                        item['children'].append(child_item)
                        total_size += child_item.get('size', 0)
            except (PermissionError, FileNotFoundError, OSError):
                pass
            item['size'] = total_size

        return item

    return build_tree(root)
