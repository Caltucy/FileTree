let comparisonData = null;

async function compare() {
    const path1 = document.getElementById('path1').value;
    const path2 = document.getElementById('path2').value;

    if (!path1 || !path2) {
        alert('请输入两个路径');
        return;
    }

    const progressDiv = document.getElementById('progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    progressDiv.style.display = 'block';
    progressFill.style.width = '0%';

    const eventSource = new EventSource(`/api/compare?path1=${encodeURIComponent(path1)}&path2=${encodeURIComponent(path2)}`);

    eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.status === 'scanning' || data.status === 'comparing') {
            progressFill.style.width = data.progress + '%';
            progressText.textContent = data.message;
        } else if (data.status === 'done') {
            progressFill.style.width = '100%';
            progressText.textContent = '完成！';
            comparisonData = data.comparison;
            renderTree();
            eventSource.close();
            setTimeout(() => progressDiv.style.display = 'none', 2000);
        } else if (data.status === 'error') {
            alert(data.message);
            eventSource.close();
            progressDiv.style.display = 'none';
        }
    };

    eventSource.onerror = () => {
        alert('连接失败');
        eventSource.close();
        progressDiv.style.display = 'none';
    };
}

function renderTree() {
    if (!comparisonData) return;

    const tree1 = document.getElementById('tree1');
    const tree2 = document.getElementById('tree2');

    tree1.innerHTML = '<h3>路径1</h3>' + buildTreeHTML(comparisonData, 'left');
    tree2.innerHTML = '<h3>路径2</h3>' + buildTreeHTML(comparisonData, 'right');
}

function buildTreeHTML(node, side) {
    const status = node.status || 'same';
    const isDir = node.is_dir;
    const name = node.name;

    let html = `<div class="tree-item ${isDir ? 'folder' : 'file'} status-${status}" onclick="toggleNode(event)">`;
    html += name;

    if (!isDir) {
        const size = node[`size${side === 'left' ? '1' : '2'}`] || 0;
        const sizeStr = formatSize(size);
        html += ` <span style="color:#666">(${sizeStr})</span>`;

        const maxSize = Math.max(node.size1 || 0, node.size2 || 0);
        if (maxSize > 0) {
            const width = Math.min(100, (size / maxSize) * 100);
            html += `<span class="size-bar" style="width:${width}px"></span>`;
        }
    }

    html += '</div>';

    if (isDir && node.children) {
        html += '<div class="tree-children">';
        for (const child of node.children) {
            html += buildTreeHTML(child, side);
        }
        html += '</div>';
    }

    return html;
}

function toggleNode(e) {
    e.stopPropagation();
    const children = e.target.nextElementSibling;
    if (children && children.classList.contains('tree-children')) {
        children.classList.toggle('expanded');
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
}

let searchTimeout = null;

function filterTree() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const query = document.getElementById('search').value.toLowerCase();
        if (!query) {
            document.querySelectorAll('.tree-item').forEach(item => item.style.display = 'block');
            return;
        }

        const items = document.querySelectorAll('.tree-item');
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(query) ? 'block' : 'none';
        });
    }, 300);
}
