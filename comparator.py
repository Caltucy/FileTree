from scanner import get_file_hash


def compare_trees(tree1, tree2, fast_mode=True):
    """比较两个文件树，并附加面向备份审查的汇总信息。"""
    if not tree1 or not tree2:
        return None

    result = _compare_nodes(tree1, tree2, fast_mode)
    result['summary'] = summarize_comparison(result)
    return result


def _compare_nodes(tree1, tree2, fast_mode):
    result = _base_result(tree1, tree2)

    if tree1.get('is_dir') != tree2.get('is_dir'):
        result.update({
            'status': 'type_changed',
            'change_type': 'type_changed',
            'reason': '一侧是文件夹，另一侧是文件',
            'action': '类型冲突，需人工处理',
        })
        return result

    if tree1['is_dir']:
        children1 = {c['name']: c for c in tree1.get('children', [])}
        children2 = {c['name']: c for c in tree2.get('children', [])}

        children = []
        for name in sorted(set(children1.keys()) | set(children2.keys()), key=str.lower):
            c1 = children1.get(name)
            c2 = children2.get(name)

            if c1 and c2:
                child_result = _compare_nodes(c1, c2, fast_mode)
            elif c1:
                child_result = mark_only_in(c1, 'left')
            else:
                child_result = mark_only_in(c2, 'right')

            children.append(child_result)

        result['children'] = children
        has_changes = any(child['status'] != 'same' for child in children)
        result.update({
            'status': 'modified' if has_changes else 'same',
            'change_type': 'folder_changed' if has_changes else 'same',
            'reason': '包含差异子项' if has_changes else '内容一致',
            'action': '查看子项差异' if has_changes else '无需操作',
        })
        return result

    result['modified1'] = tree1.get('modified')
    result['modified2'] = tree2.get('modified')
    size1 = tree1.get('size', 0)
    size2 = tree2.get('size', 0)
    time1 = tree1.get('modified')
    time2 = tree2.get('modified')

    if size1 != size2:
        result.update({
            'status': 'modified',
            'change_type': 'size_changed',
            'reason': '文件大小不同',
            'action': '用初始文件更新备份',
        })
    elif fast_mode and time1 != time2:
        result.update({
            'status': 'modified',
            'change_type': 'time_changed',
            'reason': '修改时间不同',
            'action': '复核后更新备份',
        })
    elif not fast_mode and time1 != time2:
        hash1 = tree1.get('hash') or get_file_hash(tree1['path'])
        hash2 = tree2.get('hash') or get_file_hash(tree2['path'])
        if hash1 is None or hash2 is None:
            result.update({
                'status': 'modified',
                'change_type': 'hash_unreadable',
                'reason': '无法读取文件哈希',
                'action': '人工复核',
            })
        elif hash1 != hash2:
            result.update({
                'status': 'modified',
                'change_type': 'hash_changed',
                'reason': '文件内容不同',
                'action': '用初始文件更新备份',
            })
        else:
            result.update({
                'status': 'metadata',
                'change_type': 'metadata_only',
                'reason': '内容相同，仅修改时间不同',
                'action': '按需同步元数据',
            })
    else:
        result.update({
            'status': 'same',
            'change_type': 'same',
            'reason': '内容一致',
            'action': '无需操作',
        })

    return result


def _base_result(tree1, tree2):
    result = {
        'name': tree1['name'],
        'path1': tree1['path'],
        'path2': tree2['path'],
        'status': 'same',
        'change_type': 'same',
        'is_dir': tree1['is_dir'],
        'is_dir1': tree1['is_dir'],
        'is_dir2': tree2['is_dir'],
        'size1': tree1.get('size', 0),
        'size2': tree2.get('size', 0),
        'file_count1': tree1.get('file_count', 0),
        'file_count2': tree2.get('file_count', 0),
        'dir_count1': tree1.get('dir_count', 0),
        'dir_count2': tree2.get('dir_count', 0),
    }
    result['delta_size'] = result['size1'] - result['size2']
    return result


def mark_only_in(tree, side):
    """标记只存在于一侧的项。left 表示初始文件夹，right 表示备份文件夹。"""
    side_index = 1 if side == 'left' else 2
    missing_index = 2 if side == 'left' else 1
    status = f'only_{side}'

    result = {
        'name': tree['name'],
        'status': status,
        'change_type': status,
        'is_dir': tree['is_dir'],
        f'is_dir{side_index}': tree['is_dir'],
        f'size{side_index}': tree.get('size', 0),
        f'size{missing_index}': 0,
        f'file_count{side_index}': tree.get('file_count', 0),
        f'file_count{missing_index}': 0,
        f'dir_count{side_index}': tree.get('dir_count', 0),
        f'dir_count{missing_index}': 0,
        f'path{side_index}': tree['path'],
    }
    result['delta_size'] = result.get('size1', 0) - result.get('size2', 0)

    if side == 'left':
        result['reason'] = '初始文件夹中存在，备份中缺失'
        result['action'] = '复制到备份'
    else:
        result['reason'] = '备份中存在，初始文件夹中缺失'
        result['action'] = '确认是否保留或删除'

    if tree['is_dir']:
        result['children'] = [mark_only_in(c, side) for c in tree.get('children', [])]
    else:
        result[f'modified{side_index}'] = tree.get('modified')

    return result


def summarize_comparison(root):
    summary = {
        'source_size': root.get('size1', 0),
        'backup_size': root.get('size2', 0),
        'source_files': root.get('file_count1', 0),
        'backup_files': root.get('file_count2', 0),
        'same_files': 0,
        'modified_files': 0,
        'metadata_files': 0,
        'only_source_files': 0,
        'only_backup_files': 0,
        'type_conflicts': 0,
        'changed_dirs': 0,
        'only_source_dirs': 0,
        'only_backup_dirs': 0,
        'bytes_to_copy': 0,
        'bytes_to_review': 0,
        'source_bytes_to_update': 0,
        'backup_bytes_to_replace': 0,
    }

    def walk(node, is_root=False):
        status = node.get('status')
        is_dir = node.get('is_dir')

        if status == 'type_changed':
            summary['type_conflicts'] += 1
        elif is_dir and not is_root:
            if status == 'modified':
                summary['changed_dirs'] += 1
            elif status == 'only_left':
                summary['only_source_dirs'] += 1
            elif status == 'only_right':
                summary['only_backup_dirs'] += 1
        elif not is_dir:
            if status == 'same':
                summary['same_files'] += 1
            elif status == 'modified':
                summary['modified_files'] += 1
                summary['source_bytes_to_update'] += node.get('size1', 0)
                summary['backup_bytes_to_replace'] += node.get('size2', 0)
            elif status == 'metadata':
                summary['metadata_files'] += 1
            elif status == 'only_left':
                summary['only_source_files'] += 1
                summary['bytes_to_copy'] += node.get('size1', 0)
            elif status == 'only_right':
                summary['only_backup_files'] += 1
                summary['bytes_to_review'] += node.get('size2', 0)

        for child in node.get('children', []):
            walk(child)

    walk(root, is_root=True)
    summary['total_changed_files'] = (
        summary['modified_files']
        + summary['metadata_files']
        + summary['only_source_files']
        + summary['only_backup_files']
    )
    summary['size_delta'] = summary['source_size'] - summary['backup_size']
    return summary
