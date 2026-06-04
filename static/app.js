let comparisonData = null;
let spaceData = null;
let reviewFilter = 'diff';
let searchQuery = '';
let searchTimer = null;

const SPACE_TREE_LIMIT = 1800;

document.addEventListener('DOMContentLoaded', () => {
    hydratePathsFromQuery();

    document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => switchView(button.dataset.view));
    });

    document.getElementById('compareBtn').addEventListener('click', compare);
    document.getElementById('scanSpaceBtn').addEventListener('click', analyzeSpace);

    document.getElementById('search').addEventListener('input', (event) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchQuery = event.target.value.trim().toLowerCase();
            renderDiff();
        }, 180);
    });

    document.querySelectorAll('#reviewFilters .filter-button').forEach((button) => {
        button.addEventListener('click', () => {
            reviewFilter = button.dataset.filter;
            document.querySelectorAll('#reviewFilters .filter-button').forEach((item) => {
                item.classList.toggle('active', item === button);
            });
            renderDiff();
        });
    });

    document.getElementById('expandDiffBtn').addEventListener('click', () => setDetailsOpen('#diffView', true));
    document.getElementById('collapseDiffBtn').addEventListener('click', () => setDetailsOpen('#diffView', false));
    document.getElementById('expandSpaceBtn').addEventListener('click', () => setDetailsOpen('#spaceTree', true));
    document.getElementById('collapseSpaceBtn').addEventListener('click', () => setDetailsOpen('#spaceTree', false));
});

function hydratePathsFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const path1 = params.get('path1');
    const path2 = params.get('path2');
    if (path1) {
        document.getElementById('path1').value = path1;
    }
    if (path2) {
        document.getElementById('path2').value = path2;
    }
}

function switchView(viewName) {
    document.querySelectorAll('.tab-button').forEach((button) => {
        button.classList.toggle('active', button.dataset.view === viewName);
    });
    document.querySelectorAll('.view').forEach((view) => {
        view.classList.toggle('active', view.id === `${viewName}View`);
    });
}

async function compare() {
    const path1 = document.getElementById('path1').value.trim();
    const path2 = document.getElementById('path2').value.trim();
    const fastMode = document.getElementById('fastMode').checked;

    if (!path1 || !path2) {
        alert('请输入初始文件夹和备份文件夹');
        return;
    }

    const compareBtn = document.getElementById('compareBtn');
    const progressDiv = document.getElementById('progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    compareBtn.disabled = true;
    progressDiv.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = '正在扫描...';
    setReviewLoading('正在审查...');

    let completed = false;
    const url = `/api/compare?path1=${encodeURIComponent(path1)}&path2=${encodeURIComponent(path2)}&fastMode=${fastMode}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'scanning' || data.status === 'comparing') {
            progressFill.style.width = `${data.progress}%`;
            progressText.textContent = data.message;
        } else if (data.status === 'done') {
            completed = true;
            progressFill.style.width = '100%';
            progressText.textContent = '完成';
            comparisonData = data.comparison;
            renderDiff();
            eventSource.close();
            compareBtn.disabled = false;
            setTimeout(() => progressDiv.classList.add('hidden'), 900);
        } else if (data.status === 'error') {
            completed = true;
            alert(data.message || '路径无效');
            eventSource.close();
            compareBtn.disabled = false;
            progressDiv.classList.add('hidden');
            setReviewLoading('审查失败');
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
        compareBtn.disabled = false;
        progressDiv.classList.add('hidden');
        if (!completed) {
            alert('连接失败');
            setReviewLoading('连接失败');
        }
    };
}

function renderDiff() {
    if (!comparisonData) {
        return;
    }

    renderDiffSummary();
    renderActionList();

    const rootSize = Math.max(comparisonData.size1 || 0, comparisonData.size2 || 0, 1);
    const tree1 = document.getElementById('tree1');
    const tree2 = document.getElementById('tree2');
    tree1.classList.remove('empty-state');
    tree2.classList.remove('empty-state');
    tree1.innerHTML = buildDiffTreeHTML(comparisonData, 'left', rootSize, true) || emptyText('无匹配项');
    tree2.innerHTML = buildDiffTreeHTML(comparisonData, 'right', rootSize, true) || emptyText('无匹配项');

    const summary = comparisonData.summary || {};
    document.getElementById('diffMeta').textContent =
        `初始 ${formatSize(summary.source_size)} / ${formatCount(summary.source_files)} 文件 · ` +
        `备份 ${formatSize(summary.backup_size)} / ${formatCount(summary.backup_files)} 文件 · ` +
        `差值 ${formatSignedSize(summary.size_delta)}`;
}

function renderDiffSummary() {
    const summary = comparisonData.summary || {};
    const cards = [
        {
            label: '需要更新',
            value: formatCount(summary.modified_files || 0),
            hint: `源文件 ${formatSize(summary.source_bytes_to_update || 0)}`,
            className: 'is-amber',
        },
        {
            label: '缺失备份',
            value: formatCount(summary.only_source_files || 0),
            hint: `待复制 ${formatSize(summary.bytes_to_copy || 0)}`,
            className: 'is-red',
        },
        {
            label: '备份多余',
            value: formatCount(summary.only_backup_files || 0),
            hint: `待复核 ${formatSize(summary.bytes_to_review || 0)}`,
            className: 'is-blue',
        },
        {
            label: '元数据差异',
            value: formatCount(summary.metadata_files || 0),
            hint: '内容一致',
            className: 'is-green',
        },
        {
            label: '类型冲突',
            value: formatCount(summary.type_conflicts || 0),
            hint: '需要人工处理',
            className: 'is-purple',
        },
    ];
    document.getElementById('diffSummary').innerHTML = cards.map(renderSummaryCard).join('');
}

function buildDiffTreeHTML(node, side, rootSize, isRoot = false) {
    if (!isRoot && !sideHasNode(node, side)) {
        return '';
    }
    if (!isRoot && !subtreeMatchesReview(node)) {
        return '';
    }

    const sideIndex = side === 'left' ? 1 : 2;
    const isDir = node[`is_dir${sideIndex}`] ?? node.is_dir;
    const children = node.children || [];
    const childHtml = children
        .map((child) => buildDiffTreeHTML(child, side, rootSize, false))
        .filter(Boolean)
        .join('');
    const rowHtml = renderTreeRow({
        name: node.name,
        path: node[`path${sideIndex}`],
        isDir,
        size: node[`size${sideIndex}`] || 0,
        rootSize,
        status: node.status,
        statusLabel: getStatusLabel(node.status, side),
        reason: node.reason,
    });
    const statusClass = `status-${node.status || 'same'}`;

    if (isDir) {
        const shouldOpen = isRoot || node.status !== 'same' || Boolean(searchQuery);
        return `
            <div class="tree-node ${statusClass}">
                <details ${shouldOpen ? 'open' : ''}>
                    <summary>${rowHtml}</summary>
                    <div class="tree-children">${childHtml}</div>
                </details>
            </div>
        `;
    }

    return `<div class="tree-node ${statusClass}">${rowHtml}</div>`;
}

function renderTreeRow({ name, path, isDir, size, rootSize, status, statusLabel, reason }) {
    const sizePercent = rootSize > 0 ? Math.max(1, Math.min(100, (size / rootSize) * 100)) : 0;
    const title = [path, reason].filter(Boolean).join(' · ');
    return `
        <div class="tree-row" title="${escapeHtml(title)}">
            <span class="node-name"><span class="node-kind">${isDir ? '目录' : '文件'}</span> ${escapeHtml(name)}</span>
            <span class="node-size">${formatSize(size)}</span>
            <span class="status-pill">${escapeHtml(statusLabel || getStatusLabel(status))}</span>
            <span class="size-track"><span class="size-fill" style="width:${sizePercent}%"></span></span>
        </div>
    `;
}

function sideHasNode(node, side) {
    return side === 'left' ? Boolean(node.path1) : Boolean(node.path2);
}

function subtreeMatchesReview(node) {
    if (nodeMatchesReview(node)) {
        return true;
    }
    return (node.children || []).some(subtreeMatchesReview);
}

function nodeMatchesReview(node) {
    const status = node.status || 'same';
    const filterMatch = (
        (reviewFilter === 'all') ||
        (reviewFilter === 'diff' && status !== 'same') ||
        (reviewFilter === 'update' && (status === 'modified' || status === 'metadata')) ||
        (reviewFilter === 'copy' && status === 'only_left') ||
        (reviewFilter === 'extra' && status === 'only_right') ||
        (reviewFilter === 'conflict' && status === 'type_changed')
    );

    if (!filterMatch) {
        return false;
    }
    if (!searchQuery) {
        return true;
    }

    const haystack = [
        node.name,
        node.path1,
        node.path2,
        node.reason,
        node.action,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(searchQuery);
}

function renderActionList() {
    const list = document.getElementById('actionList');
    const actions = collectActionNodes(comparisonData)
        .filter(nodeMatchesReview)
        .slice(0, 80);

    if (!actions.length) {
        list.innerHTML = emptyText('没有匹配的审查项');
        return;
    }

    list.classList.remove('empty-state');
    list.innerHTML = actions.map((node) => {
        const path = node.path1 || node.path2 || '';
        const size = node.size1 || node.size2 || 0;
        return `
            <div class="action-item status-${node.status}">
                <strong title="${escapeHtml(path)}">${escapeHtml(node.name)}</strong>
                <span>${escapeHtml(node.action || '')} · ${formatSize(size)}</span>
                <span>${escapeHtml(node.reason || '')}</span>
            </div>
        `;
    }).join('');
}

function collectActionNodes(node, items = []) {
    const status = node.status || 'same';
    if (!node.is_dir && status !== 'same') {
        items.push(node);
    } else if (status === 'type_changed') {
        items.push(node);
    }

    (node.children || []).forEach((child) => collectActionNodes(child, items));
    return items;
}

function setReviewLoading(text) {
    document.getElementById('actionList').innerHTML = emptyText(text);
    document.getElementById('tree1').innerHTML = emptyText(text);
    document.getElementById('tree2').innerHTML = emptyText(text);
}

async function analyzeSpace() {
    const path = document.getElementById('spacePath').value.trim();
    if (!path) {
        alert('请输入扫描路径');
        return;
    }

    const button = document.getElementById('scanSpaceBtn');
    button.disabled = true;
    document.getElementById('spaceSummary').innerHTML = renderSummaryCard({
        label: '扫描中',
        value: '...',
        hint: path,
        className: 'is-blue',
    });
    document.getElementById('treemap').innerHTML = emptyText('正在扫描...');
    document.getElementById('largestFiles').innerHTML = emptyText('正在扫描...');
    document.getElementById('spaceTree').innerHTML = emptyText('正在扫描...');

    try {
        const response = await fetch(`/api/scan?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || '扫描失败');
        }
        spaceData = data.tree;
        renderSpace();
    } catch (error) {
        alert(error.message || '扫描失败');
        document.getElementById('spaceMeta').textContent = '扫描失败';
    } finally {
        button.disabled = false;
    }
}

function renderSpace() {
    if (!spaceData) {
        return;
    }

    const nodes = collectSpaceNodes(spaceData);
    const files = nodes.filter((node) => !node.is_dir).sort((a, b) => (b.size || 0) - (a.size || 0));
    const dirs = nodes.filter((node) => node.is_dir && node !== spaceData).sort((a, b) => (b.size || 0) - (a.size || 0));
    const largestFile = files[0];
    const largestDir = dirs[0];

    document.getElementById('spaceSummary').innerHTML = [
        renderSummaryCard({
            label: '总占用',
            value: formatSize(spaceData.size || 0),
            hint: spaceData.path,
            className: 'is-blue',
        }),
        renderSummaryCard({
            label: '文件数量',
            value: formatCount(spaceData.file_count || 0),
            hint: `${formatCount(Math.max(0, (spaceData.dir_count || 1) - 1))} 个子目录`,
            className: 'is-green',
        }),
        renderSummaryCard({
            label: '最大文件',
            value: largestFile ? formatSize(largestFile.size || 0) : '0 B',
            hint: largestFile ? largestFile.name : '无文件',
            className: 'is-amber',
        }),
        renderSummaryCard({
            label: '最大目录',
            value: largestDir ? formatSize(largestDir.size || 0) : '0 B',
            hint: largestDir ? largestDir.name : '无子目录',
            className: 'is-purple',
        }),
        renderSummaryCard({
            label: '平均文件',
            value: formatSize(files.length ? (spaceData.size || 0) / files.length : 0),
            hint: '按总占用估算',
            className: '',
        }),
    ].join('');

    renderTreemap();
    renderLargestFiles(files);
    renderSpaceTree();
    document.getElementById('spaceMeta').textContent =
        `${spaceData.name} · ${formatSize(spaceData.size || 0)} · ${formatCount(spaceData.file_count || 0)} 文件`;
}

function renderTreemap() {
    const treemap = document.getElementById('treemap');
    const children = (spaceData.children || [])
        .slice()
        .sort((a, b) => (b.size || 0) - (a.size || 0))
        .slice(0, 18);

    if (!children.length) {
        treemap.innerHTML = emptyText('没有可展示的子项');
        return;
    }

    const rootSize = Math.max(spaceData.size || 0, 1);
    treemap.classList.remove('empty-state');
    treemap.innerHTML = children.map((node) => {
        const share = (node.size || 0) / rootSize;
        const basis = Math.max(16, Math.min(72, share * 100));
        const grow = Math.max(1, Math.round(share * 100));
        return `
            <div class="treemap-tile" style="flex-basis:${basis}%; flex-grow:${grow}" title="${escapeHtml(node.path)}">
                <div class="tile-name">${escapeHtml(node.name)}</div>
                <div>
                    <div class="tile-size">${formatSize(node.size || 0)}</div>
                    <div class="tile-share">${formatPercent(share)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderLargestFiles(files) {
    const list = document.getElementById('largestFiles');
    const topFiles = files.slice(0, 40);
    if (!topFiles.length) {
        list.innerHTML = emptyText('无文件');
        return;
    }

    list.classList.remove('empty-state');
    list.innerHTML = topFiles.map((file) => `
        <div class="action-item">
            <strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong>
            <span>${formatSize(file.size || 0)}</span>
            <span>${escapeHtml(file.path)}</span>
        </div>
    `).join('');
}

function renderSpaceTree() {
    const panel = document.getElementById('spaceTree');
    let rendered = 0;
    const rootSize = Math.max(spaceData.size || 0, 1);

    function build(node, isRoot = false) {
        if (rendered >= SPACE_TREE_LIMIT) {
            return '';
        }
        rendered += 1;
        const children = (node.children || [])
            .slice()
            .sort((a, b) => (b.size || 0) - (a.size || 0));
        const rowHtml = renderTreeRow({
            name: node.name,
            path: node.path,
            isDir: node.is_dir,
            size: node.size || 0,
            rootSize,
            status: 'same',
            statusLabel: formatPercent((node.size || 0) / rootSize),
            reason: node.path,
        });

        if (node.is_dir) {
            return `
                <div class="tree-node status-same">
                    <details ${isRoot ? 'open' : ''}>
                        <summary>${rowHtml}</summary>
                        <div class="tree-children">${children.map((child) => build(child)).join('')}</div>
                    </details>
                </div>
            `;
        }
        return `<div class="tree-node status-same">${rowHtml}</div>`;
    }

    panel.classList.remove('empty-state');
    panel.innerHTML = build(spaceData, true);
}

function collectSpaceNodes(node, items = []) {
    items.push(node);
    (node.children || []).forEach((child) => collectSpaceNodes(child, items));
    return items;
}

function renderSummaryCard(card) {
    return `
        <div class="summary-card ${card.className || ''}">
            <div class="label">${escapeHtml(card.label)}</div>
            <div class="value">${escapeHtml(card.value)}</div>
            <div class="hint" title="${escapeHtml(card.hint || '')}">${escapeHtml(card.hint || '')}</div>
        </div>
    `;
}

function getStatusLabel(status, side = '') {
    const labels = {
        same: '一致',
        modified: '需更新',
        metadata: '元数据',
        only_left: side === 'left' ? '待复制' : '缺失',
        only_right: side === 'right' ? '待复核' : '多余',
        type_changed: '冲突',
    };
    return labels[status] || status || '';
}

function setDetailsOpen(rootSelector, open) {
    document.querySelectorAll(`${rootSelector} details`).forEach((detail) => {
        detail.open = open;
    });
}

function formatSize(bytes) {
    const value = Number(bytes) || 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = Math.abs(value);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    const formatted = unitIndex === 0 ? String(Math.round(size)) : size.toFixed(size >= 10 ? 1 : 2);
    return `${value < 0 ? '-' : ''}${formatted} ${units[unitIndex]}`;
}

function formatSignedSize(bytes) {
    const value = Number(bytes) || 0;
    if (value === 0) {
        return '0 B';
    }
    return `${value > 0 ? '+' : '-'}${formatSize(Math.abs(value))}`;
}

function formatPercent(value) {
    const percent = Math.max(0, Number(value) || 0) * 100;
    return `${percent >= 10 ? percent.toFixed(1) : percent.toFixed(2)}%`;
}

function formatCount(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function emptyText(text) {
    return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}
