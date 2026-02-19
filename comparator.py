def compare_trees(tree1, tree2):
    """比较两个文件树"""
    if not tree1 or not tree2:
        return None

    result = {
        'name': tree1['name'],
        'path1': tree1['path'],
        'path2': tree2['path'],
        'status': 'same',
        'is_dir': tree1['is_dir']
    }

    if tree1['is_dir']:
        result['children'] = []
        children1 = {c['name']: c for c in tree1.get('children', [])}
        children2 = {c['name']: c for c in tree2.get('children', [])}

        all_names = set(children1.keys()) | set(children2.keys())
        for name in sorted(all_names):
            c1 = children1.get(name)
            c2 = children2.get(name)

            if c1 and c2:
                child_result = compare_trees(c1, c2)
            elif c1:
                child_result = mark_only_in(c1, 'left')
            else:
                child_result = mark_only_in(c2, 'right')

            result['children'].append(child_result)
            if child_result['status'] != 'same':
                result['status'] = 'modified'
    else:
        result['size1'] = tree1.get('size', 0)
        result['size2'] = tree2.get('size', 0)
        result['modified1'] = tree1.get('modified')
        result['modified2'] = tree2.get('modified')

        if tree1.get('hash') != tree2.get('hash'):
            result['status'] = 'modified'

    return result

def mark_only_in(tree, side):
    """标记只存在于一侧的项"""
    result = {
        'name': tree['name'],
        'status': f'only_{side}',
        'is_dir': tree['is_dir']
    }
    if side == 'left':
        result['path1'] = tree['path']
    else:
        result['path2'] = tree['path']

    if tree['is_dir']:
        result['children'] = [mark_only_in(c, side) for c in tree.get('children', [])]
    else:
        result[f'size{1 if side == "left" else 2}'] = tree.get('size', 0)

    return result
