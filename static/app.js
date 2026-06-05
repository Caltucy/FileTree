let comparisonData = null;
let spaceData = null;
let reviewFilter = 'diff';
let searchQuery = '';
let searchTimer = null;
let diffTaskId = null;
let spaceTaskId = null;
let diffEventSource = null;
let spaceEventSource = null;
let ignoreRules = [];
let recoveredTaskKind = null;

const SPACE_TREE_LIMIT = 1800;
const SPACE_CHILD_LIMIT = 18;
const SPACE_TREE_CHILD_LIMIT = 24;
const DIFF_TASK_KEY = 'filetree.diffTaskId';
const SPACE_TASK_KEY = 'filetree.spaceTaskId';
const IGNORE_CONFIG_KEY = 'filetree.ignoreConfig';

document.addEventListener('DOMContentLoaded', () => {
    hydratePathsFromQuery();
    initHelpPopovers();
    loadIgnoreConfig();
    renderIgnoreRules();

    document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => switchView(button.dataset.view));
    });

    document.getElementById('compareBtn').addEventListener('click', compare);
    document.getElementById('scanSpaceBtn').addEventListener('click', analyzeSpace);
    document.getElementById('cancelDiffBtn').addEventListener('click', () => cancelTask('diff'));
    document.getElementById('cancelSpaceBtn').addEventListener('click', () => cancelTask('space'));
    document.getElementById('useDefaultIgnore').addEventListener('change', saveIgnoreConfig);
    document.getElementById('ignoreRuleMode').addEventListener('change', saveIgnoreConfig);
    document.getElementById('addIgnoreRuleBtn').addEventListener('click', () => {
        ignoreRules.push({
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
            enabled: true,
            field: 'path',
            operator: 'contains',
            value: '',
            negate: false,
        });
        renderIgnoreRules();
        saveIgnoreConfig();
    });
    document.getElementById('focusRecoveredTaskBtn').addEventListener('click', focusRecoveredTask);
    document.getElementById('cancelRecoveredTaskBtn').addEventListener('click', () => {
        if (recoveredTaskKind) {
            cancelTask(recoveredTaskKind);
        }
        hideRecoveryBanner();
    });
    document.getElementById('dismissRecoveredTaskBtn').addEventListener('click', hideRecoveryBanner);

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

    restoreTasks();
});

function initHelpPopovers() {
    const popovers = document.querySelectorAll('[data-help-popover]');
    if (!popovers.length) {
        return;
    }

    const closePopover = (popover) => {
        const trigger = popover.querySelector('.help-trigger');
        const card = popover.querySelector('.mode-tooltip-card');
        if (!trigger || !card) {
            return;
        }
        popover.classList.remove('is-open', 'is-pinned');
        trigger.setAttribute('aria-expanded', 'false');
        card.hidden = true;
    };

    const openPopover = (popover) => {
        const trigger = popover.querySelector('.help-trigger');
        const card = popover.querySelector('.mode-tooltip-card');
        if (!trigger || !card) {
            return;
        }
        popovers.forEach((item) => {
            if (item !== popover) {
                closePopover(item);
            }
        });
        card.hidden = false;
        popover.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
    };

    popovers.forEach((popover) => {
        const trigger = popover.querySelector('.help-trigger');
        if (!trigger) {
            return;
        }

        trigger.addEventListener('mouseenter', () => openPopover(popover));
        popover.addEventListener('mouseleave', () => {
            if (!popover.classList.contains('is-pinned')) {
                closePopover(popover);
            }
        });
        trigger.addEventListener('focus', () => openPopover(popover));
        trigger.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (!popover.contains(document.activeElement) && !popover.classList.contains('is-pinned')) {
                    closePopover(popover);
                }
            }, 0);
        });
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (popover.classList.contains('is-pinned')) {
                closePopover(popover);
            } else {
                openPopover(popover);
                popover.classList.add('is-pinned');
            }
        });
    });

    document.addEventListener('click', (event) => {
        popovers.forEach((popover) => {
            if (!popover.contains(event.target)) {
                closePopover(popover);
            }
        });
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            popovers.forEach(closePopover);
        }
    });
}

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

function loadIgnoreConfig() {
    try {
        const config = JSON.parse(localStorage.getItem(IGNORE_CONFIG_KEY) || '{}');
        document.getElementById('useDefaultIgnore').checked = config.use_defaults !== false;
        document.getElementById('ignoreRuleMode').value = config.rule_mode === 'all' ? 'all' : 'any';
        ignoreRules = Array.isArray(config.rules) ? config.rules : [];
    } catch {
        ignoreRules = [];
    }
}

function saveIgnoreConfig() {
    const config = getIgnoreOptions();
    localStorage.setItem(IGNORE_CONFIG_KEY, JSON.stringify(config));
}

function getIgnoreOptions() {
    return {
        use_defaults: document.getElementById('useDefaultIgnore').checked,
        rule_mode: document.getElementById('ignoreRuleMode').value,
        rules: ignoreRules
            .map((rule) => ({
                enabled: rule.enabled !== false,
                field: rule.field || 'path',
                operator: rule.operator || 'contains',
                value: rule.value || '',
                negate: Boolean(rule.negate),
            }))
            .filter((rule) => rule.value.trim()),
    };
}

function getIgnoreQuery() {
    return encodeURIComponent(JSON.stringify(getIgnoreOptions()));
}

function renderIgnoreRules() {
    const container = document.getElementById('ignoreRules');
    if (!ignoreRules.length) {
        container.classList.add('empty-state');
        container.innerHTML = '暂无自定义规则';
        return;
    }

    container.classList.remove('empty-state');
    container.innerHTML = ignoreRules.map((rule, index) => `
        <div class="ignore-rule-row" data-index="${index}">
            <label>
                <input type="checkbox" data-role="enabled" ${rule.enabled === false ? '' : 'checked'}>
            </label>
            <select data-role="field">
                <option value="path" ${rule.field === 'path' ? 'selected' : ''}>路径</option>
                <option value="name" ${rule.field === 'name' ? 'selected' : ''}>名称</option>
                <option value="extension" ${rule.field === 'extension' ? 'selected' : ''}>后缀</option>
                <option value="type" ${rule.field === 'type' ? 'selected' : ''}>类型</option>
                <option value="size" ${rule.field === 'size' ? 'selected' : ''}>大小</option>
            </select>
            <select data-role="operator">
                ${renderOperatorOptions(rule.operator)}
            </select>
            <input type="text" data-role="value" value="${escapeHtml(rule.value || '')}" placeholder="例如 node_modules / .log / 100 MB">
            <label class="toggle-field compact-toggle">
                <input type="checkbox" data-role="negate" ${rule.negate ? 'checked' : ''}>
                <span>非</span>
            </label>
            <button class="ghost-button danger-button" type="button" data-role="remove">删除</button>
        </div>
    `).join('');

    container.querySelectorAll('.ignore-rule-row').forEach((row) => {
        row.addEventListener('change', updateIgnoreRuleFromRow);
        row.addEventListener('input', updateIgnoreRuleFromRow);
        row.querySelector('[data-role="remove"]').addEventListener('click', () => {
            const index = Number(row.dataset.index);
            ignoreRules.splice(index, 1);
            renderIgnoreRules();
            saveIgnoreConfig();
        });
    });
}

function renderOperatorOptions(selected) {
    const operators = [
        ['contains', '包含'],
        ['not_contains', '不包含'],
        ['equals', '等于'],
        ['starts_with', '开头是'],
        ['ends_with', '结尾是'],
        ['glob', '通配符'],
        ['regex', '正则'],
        ['greater_than', '大于'],
        ['less_than', '小于'],
    ];
    return operators.map(([value, label]) => (
        `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`
    )).join('');
}

function updateIgnoreRuleFromRow(event) {
    const row = event.currentTarget;
    const index = Number(row.dataset.index);
    const rule = ignoreRules[index];
    if (!rule) {
        return;
    }

    rule.enabled = row.querySelector('[data-role="enabled"]').checked;
    rule.field = row.querySelector('[data-role="field"]').value;
    rule.operator = row.querySelector('[data-role="operator"]').value;
    rule.value = row.querySelector('[data-role="value"]').value;
    rule.negate = row.querySelector('[data-role="negate"]').checked;
    saveIgnoreConfig();
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

    setTaskUi('diff', {
        status: 'queued',
        progress: 0,
        message: '正在创建审查任务...',
        stats: {},
    });
    setReviewLoading('正在审查...');

    try {
        const url = `/api/task/start-compare?path1=${encodeURIComponent(path1)}&path2=${encodeURIComponent(path2)}&fastMode=${fastMode}&ignoreOptions=${getIgnoreQuery()}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || '创建审查任务失败');
        }
        diffTaskId = data.task.id;
        localStorage.setItem(DIFF_TASK_KEY, diffTaskId);
        subscribeTask('diff', diffTaskId);
    } catch (error) {
        alert(error.message || '创建审查任务失败');
        clearTaskState('diff');
        setReviewLoading('审查失败');
    }
}

async function restoreTasks() {
    await restoreTask('diff', localStorage.getItem(DIFF_TASK_KEY));
    await restoreTask('space', localStorage.getItem(SPACE_TASK_KEY));
}

async function restoreTask(kind, taskId) {
    if (!taskId) {
        return;
    }

    try {
        const response = await fetch(`/api/task/status?id=${encodeURIComponent(taskId)}`);
        const data = await response.json();
        if (!response.ok || data.error) {
            localStorage.removeItem(kind === 'diff' ? DIFF_TASK_KEY : SPACE_TASK_KEY);
            return;
        }

        if (kind === 'diff') {
            diffTaskId = taskId;
        } else {
            spaceTaskId = taskId;
        }

        handleTaskUpdate(kind, data.task);
        if (!isTerminalTask(data.task)) {
            showRecoveryBanner(kind, data.task);
            subscribeTask(kind, taskId);
        }
    } catch {
        localStorage.removeItem(kind === 'diff' ? DIFF_TASK_KEY : SPACE_TASK_KEY);
    }
}

function subscribeTask(kind, taskId) {
    closeTaskStream(kind);
    const eventSource = new EventSource(`/api/task/events?id=${encodeURIComponent(taskId)}`);

    if (kind === 'diff') {
        diffEventSource = eventSource;
    } else {
        spaceEventSource = eventSource;
    }

    eventSource.onmessage = (event) => {
        const task = JSON.parse(event.data);
        handleTaskUpdate(kind, task);
        if (isTerminalTask(task)) {
            closeTaskStream(kind);
        }
    };

    eventSource.onerror = () => {
        closeTaskStream(kind);
        const activeId = kind === 'diff' ? diffTaskId : spaceTaskId;
        if (activeId) {
            setTaskUi(kind, {
                status: 'running',
                progress: getTaskProgressValue(kind),
                message: '进度连接中断，刷新后可恢复',
                stats: {},
            });
        }
    };
}

function handleTaskUpdate(kind, task) {
    setTaskUi(kind, task);

    if (kind === 'diff') {
        if (task.status === 'done' && task.result?.comparison) {
            comparisonData = task.result.comparison;
            renderDiff();
            clearTaskState('diff', { keepProgress: true });
        } else if (task.status === 'cancelled') {
            setReviewLoading('审查已停止');
            clearTaskState('diff', { keepProgress: true });
        } else if (task.status === 'error') {
            setReviewLoading(task.error || '审查失败');
            clearTaskState('diff', { keepProgress: true });
        }
    } else if (kind === 'space') {
        if (task.status === 'done' && task.result?.tree) {
            spaceData = task.result.tree;
            renderSpace();
            clearTaskState('space', { keepProgress: true });
        } else if (task.status === 'cancelled') {
            document.getElementById('spaceMeta').textContent = '扫描已停止';
            clearTaskState('space', { keepProgress: true });
        } else if (task.status === 'error') {
            document.getElementById('spaceMeta').textContent = task.error || '扫描失败';
            clearTaskState('space', { keepProgress: true });
        }
    }

    if (isTerminalTask(task) && recoveredTaskKind === kind) {
        hideRecoveryBanner();
    }
}

async function cancelTask(kind) {
    const taskId = kind === 'diff' ? diffTaskId : spaceTaskId;
    if (!taskId) {
        return;
    }

    setTaskUi(kind, {
        status: 'cancelling',
        progress: getTaskProgressValue(kind),
        message: '正在停止...',
        stats: {},
    });

    try {
        await fetch(`/api/task/cancel?id=${encodeURIComponent(taskId)}`);
    } catch {
        setTaskUi(kind, {
            status: 'error',
            progress: getTaskProgressValue(kind),
            message: '停止请求失败',
            stats: {},
        });
    }
}

function closeTaskStream(kind) {
    const source = kind === 'diff' ? diffEventSource : spaceEventSource;
    if (source) {
        source.close();
    }
    if (kind === 'diff') {
        diffEventSource = null;
    } else {
        spaceEventSource = null;
    }
}

function clearTaskState(kind, options = {}) {
    closeTaskStream(kind);
    if (kind === 'diff') {
        diffTaskId = null;
        localStorage.removeItem(DIFF_TASK_KEY);
        document.getElementById('compareBtn').disabled = false;
        document.getElementById('cancelDiffBtn').disabled = true;
    } else {
        spaceTaskId = null;
        localStorage.removeItem(SPACE_TASK_KEY);
        document.getElementById('scanSpaceBtn').disabled = false;
        document.getElementById('cancelSpaceBtn').disabled = true;
    }

    if (!options.keepProgress) {
        getTaskElements(kind).section.classList.add('hidden');
    }
}

function setTaskUi(kind, task) {
    const elements = getTaskElements(kind);
    const progress = Number(task.progress) || 0;

    elements.section.classList.remove('hidden');
    elements.fill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    elements.text.textContent = task.message || getTaskStatusLabel(task.status);
    elements.detail.textContent = formatTaskDetail(task);
    elements.startButton.disabled = !isTerminalTask(task) && task.status !== 'error';
    elements.cancelButton.disabled = isTerminalTask(task) || task.status === 'queued';
}

function getTaskElements(kind) {
    if (kind === 'diff') {
        return {
            section: document.getElementById('progress'),
            fill: document.getElementById('progress-fill'),
            text: document.getElementById('progress-text'),
            detail: document.getElementById('progress-detail'),
            startButton: document.getElementById('compareBtn'),
            cancelButton: document.getElementById('cancelDiffBtn'),
        };
    }
    return {
        section: document.getElementById('spaceProgress'),
        fill: document.getElementById('spaceProgressFill'),
        text: document.getElementById('spaceProgressText'),
        detail: document.getElementById('spaceProgressDetail'),
        startButton: document.getElementById('scanSpaceBtn'),
        cancelButton: document.getElementById('cancelSpaceBtn'),
    };
}

function getTaskProgressValue(kind) {
    const width = getTaskElements(kind).fill.style.width || '0';
    return Number(width.replace('%', '')) || 0;
}

function isTerminalTask(task) {
    return ['done', 'error', 'cancelled'].includes(task.status);
}

function getTaskStatusLabel(status) {
    const labels = {
        queued: '等待开始',
        running: '正在运行',
        cancelling: '正在停止',
        done: '完成',
        error: '失败',
        cancelled: '已停止',
    };
    return labels[status] || status || '';
}

function showRecoveryBanner(kind, task) {
    recoveredTaskKind = kind;
    const label = kind === 'diff' ? '备份差异审查' : '空间占用分析';
    document.getElementById('taskRecoveryText').textContent =
        `检测到上次未完成的${label}：${task.message || getTaskStatusLabel(task.status)}`;
    document.getElementById('taskRecoveryBanner').classList.remove('hidden');
}

function hideRecoveryBanner() {
    recoveredTaskKind = null;
    document.getElementById('taskRecoveryBanner').classList.add('hidden');
}

function focusRecoveredTask() {
    if (!recoveredTaskKind) {
        return;
    }
    switchView(recoveredTaskKind === 'diff' ? 'diff' : 'space');
    hideRecoveryBanner();
}

function formatTaskDetail(task) {
    const stats = task.stats || {};
    if (task.type === 'compare') {
        const left = stats.path1 || {};
        const right = stats.path2 || {};
        const current = left.current_path || right.current_path || '';
        return [
            `初始 ${formatCount(left.files || 0)} 文件 / ${formatSize(left.bytes || 0)}`,
            `备份 ${formatCount(right.files || 0)} 文件 / ${formatSize(right.bytes || 0)}`,
            `忽略 ${formatCount((left.ignored || 0) + (right.ignored || 0))} 项`,
            current ? `当前 ${current}` : '',
        ].filter(Boolean).join(' · ');
    }

    const current = stats.current_path || task.params?.path || '';
    return [
        `${formatCount(stats.files || 0)} 文件`,
        `${formatCount(stats.dirs || 0)} 目录`,
        formatSize(stats.bytes || 0),
        `忽略 ${formatCount(stats.ignored || 0)} 项`,
        current ? `当前 ${current}` : '',
    ].filter(Boolean).join(' · ');
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

function renderTreeRow({ name, path, isDir, size, rootSize, status, statusLabel, reason, kindLabel }) {
    const sizePercent = rootSize > 0 ? Math.max(1, Math.min(100, (size / rootSize) * 100)) : 0;
    const title = [path, reason].filter(Boolean).join(' · ');
    return `
        <div class="tree-row" title="${escapeHtml(title)}">
            <span class="node-name"><span class="node-kind">${escapeHtml(kindLabel || (isDir ? '目录' : '文件'))}</span> ${escapeHtml(name)}</span>
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

    setTaskUi('space', {
        status: 'queued',
        progress: 0,
        message: '正在创建空间分析任务...',
        stats: {},
    });
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
        const response = await fetch(`/api/task/start-scan?path=${encodeURIComponent(path)}&ignoreOptions=${getIgnoreQuery()}`);
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || '创建扫描任务失败');
        }
        spaceTaskId = data.task.id;
        localStorage.setItem(SPACE_TASK_KEY, spaceTaskId);
        subscribeTask('space', spaceTaskId);
    } catch (error) {
        alert(error.message || '创建扫描任务失败');
        clearTaskState('space');
        document.getElementById('spaceMeta').textContent = '扫描失败';
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
    const children = aggregateSpaceChildren(spaceData.children || [], SPACE_CHILD_LIMIT);

    if (!children.length) {
        treemap.innerHTML = emptyText('没有可展示的子项');
        return;
    }

    const rootSize = Math.max(spaceData.size || 0, 1);
    treemap.classList.remove('empty-state');
    treemap.innerHTML = children.map((node, index) => {
        const share = (node.size || 0) / rootSize;
        const basis = Math.max(16, Math.min(72, share * 100));
        const grow = Math.max(1, Math.round(share * 100));
        const tileClass = node.is_other ? 'is-other' : `palette-${index % 6}`;
        return `
            <div class="treemap-tile ${tileClass}" style="flex-basis:${basis}%; flex-grow:${grow}" title="${escapeHtml(node.path || node.name)}">
                <div class="tile-top">
                    <div class="tile-name">${escapeHtml(node.name)}</div>
                    <div class="tile-rank">#${index + 1}</div>
                </div>
                <div class="tile-bottom">
                    <div class="tile-size">${formatSize(node.size || 0)}</div>
                    <div class="tile-share">${formatPercent(share)} · ${formatCount(node.file_count || 0)} 文件</div>
                    <div class="tile-meter"><span style="width:${Math.max(2, Math.min(100, share * 100))}%"></span></div>
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
        const children = aggregateSpaceChildren(node.children || [], SPACE_TREE_CHILD_LIMIT);
        const rowHtml = renderTreeRow({
            name: node.name,
            path: node.path,
            isDir: node.is_dir,
            size: node.size || 0,
            rootSize,
            status: 'same',
            statusLabel: formatPercent((node.size || 0) / rootSize),
            reason: node.path,
            kindLabel: node.is_other ? '聚合' : undefined,
        });

        if (node.is_other) {
            return `<div class="tree-node status-same">${rowHtml}</div>`;
        }

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

function aggregateSpaceChildren(children, limit) {
    const sorted = sortSpaceChildren(children);
    if (sorted.length <= limit) {
        return sorted;
    }

    const visible = sorted.slice(0, Math.max(1, limit - 1));
    const hidden = sorted.slice(visible.length);
    return [...visible, makeOtherNode(hidden)];
}

function sortSpaceChildren(children) {
    const dirs = children.filter((node) => node.is_dir).sort((a, b) => (b.size || 0) - (a.size || 0));
    const files = children.filter((node) => !node.is_dir).sort((a, b) => (b.size || 0) - (a.size || 0));
    return dirs.length ? [...dirs, ...files] : files;
}

function makeOtherNode(nodes) {
    return {
        name: `其他 ${formatCount(nodes.length)} 项`,
        path: '',
        is_dir: false,
        is_other: true,
        size: nodes.reduce((total, node) => total + (node.size || 0), 0),
        file_count: nodes.reduce((total, node) => total + (node.file_count || (node.is_dir ? 0 : 1)), 0),
        dir_count: nodes.reduce((total, node) => total + (node.dir_count || (node.is_dir ? 1 : 0)), 0),
    };
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
