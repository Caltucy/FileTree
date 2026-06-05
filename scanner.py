import hashlib
import fnmatch
import re
import time
from pathlib import Path
from datetime import datetime


DEFAULT_IGNORE_NAMES = {
    '.git',
    '.hg',
    '.svn',
    '.cache',
    '.mypy_cache',
    '.pytest_cache',
    '.ruff_cache',
    '.venv',
    'venv',
    'env',
    'node_modules',
    '__pycache__',
    'dist',
    'build',
    'target',
}

DEFAULT_IGNORE_PATTERNS = {
    '*.log',
    '*.tmp',
    '*.temp',
    '*.pyc',
    '*.pyo',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '~$*',
}


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


def scan_directory(root_path, progress_callback=None, fast_mode=True, cancel_event=None, ignore_options=None):
    """扫描目录并返回树形结构。"""
    root = Path(root_path)
    if not root.exists():
        return None

    ignore_options = normalize_ignore_options(ignore_options)
    file_count = 0
    dir_count = 0
    bytes_count = 0
    ignored_count = 0
    ignored_files = 0
    ignored_dirs = 0
    ignored_bytes = 0
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
            'ignored': ignored_count,
            'ignored_files': ignored_files,
            'ignored_dirs': ignored_dirs,
            'ignored_bytes': ignored_bytes,
            'current_path': str(path),
        })

    def mark_ignored(path, is_dir):
        nonlocal ignored_count, ignored_files, ignored_dirs, ignored_bytes
        ignored_count += 1
        if is_dir:
            ignored_dirs += 1
        else:
            ignored_files += 1
            try:
                ignored_bytes += path.stat().st_size
            except (PermissionError, FileNotFoundError, OSError):
                pass
        emit_progress(path)

    def build_tree(path, is_root=False):
        nonlocal file_count, dir_count, bytes_count
        check_cancelled()

        is_dir = path.is_dir() and not path.is_symlink()
        if not is_root and should_ignore_path(path, root, is_dir, ignore_options):
            mark_ignored(path, is_dir)
            return None

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
            item['ignored_count'] = ignored_count
            item['ignored_files'] = ignored_files
            item['ignored_dirs'] = ignored_dirs
            item['ignored_bytes'] = ignored_bytes

        return item

    tree = build_tree(root, is_root=True)
    if tree:
        tree['ignored_count'] = ignored_count
        tree['ignored_files'] = ignored_files
        tree['ignored_dirs'] = ignored_dirs
        tree['ignored_bytes'] = ignored_bytes
    emit_progress(root, force=True)
    return tree


def normalize_ignore_options(options):
    options = options or {}
    return {
        'use_defaults': bool(options.get('use_defaults', False)),
        'rule_mode': options.get('rule_mode', 'any') if options.get('rule_mode') in {'any', 'all'} else 'any',
        'rules': [
            rule
            for rule in options.get('rules', [])
            if rule.get('enabled', True) and str(rule.get('value', '')).strip()
        ],
    }


def should_ignore_path(path, root, is_dir, options):
    if options['use_defaults'] and matches_default_ignore(path):
        return True

    rules = options['rules']
    if not rules:
        return False

    matches = [matches_custom_rule(path, root, is_dir, rule) for rule in rules]
    if options['rule_mode'] == 'all':
        return all(matches)
    return any(matches)


def matches_default_ignore(path):
    name = path.name
    lower_name = name.lower()
    if lower_name in DEFAULT_IGNORE_NAMES:
        return True

    return any(fnmatch.fnmatchcase(name, pattern) for pattern in DEFAULT_IGNORE_PATTERNS)


def matches_custom_rule(path, root, is_dir, rule):
    field = rule.get('field', 'path')
    operator = rule.get('operator', 'contains')
    expected = str(rule.get('value', ''))
    negate = bool(rule.get('negate', False))
    case_sensitive = bool(rule.get('case_sensitive', False))

    actual = get_rule_value(path, root, is_dir, field)
    matched = compare_rule_value(actual, expected, operator, case_sensitive)
    return not matched if negate else matched


def get_rule_value(path, root, is_dir, field):
    if field == 'name':
        return path.name
    if field == 'extension':
        return path.suffix
    if field == 'type':
        return 'dir' if is_dir else 'file'
    if field == 'size':
        if is_dir:
            return 0
        try:
            return path.stat().st_size
        except (PermissionError, FileNotFoundError, OSError):
            return 0

    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def compare_rule_value(actual, expected, operator, case_sensitive):
    if operator in {'greater_than', 'less_than'}:
        try:
            actual_number = float(actual)
            expected_number = parse_size_value(expected)
        except (TypeError, ValueError):
            return False
        if operator == 'greater_than':
            return actual_number > expected_number
        return actual_number < expected_number

    actual_text = str(actual)
    expected_text = str(expected)
    if not case_sensitive:
        actual_text = actual_text.lower()
        expected_text = expected_text.lower()

    if operator == 'not_contains':
        return expected_text not in actual_text
    if operator == 'equals':
        return actual_text == expected_text
    if operator == 'starts_with':
        return actual_text.startswith(expected_text)
    if operator == 'ends_with':
        return actual_text.endswith(expected_text)
    if operator == 'glob':
        return fnmatch.fnmatchcase(actual_text, expected_text)
    if operator == 'regex':
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            return re.search(str(expected), str(actual), flags) is not None
        except re.error:
            return False

    return expected_text in actual_text


def parse_size_value(value):
    text = str(value).strip().lower().replace(' ', '')
    multipliers = {
        'kb': 1024,
        'mb': 1024 ** 2,
        'gb': 1024 ** 3,
        'tb': 1024 ** 4,
        'b': 1,
    }

    for suffix, multiplier in multipliers.items():
        if text.endswith(suffix):
            return float(text[:-len(suffix)]) * multiplier
    return float(text)
