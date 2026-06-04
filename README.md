# FileTree 备份审查工具

FileTree 用于审查初始文件夹与备份文件夹之间的差异，并辅助查看磁盘目录的空间占用。

## 功能

- 对比初始文件夹和备份文件夹
- 标记需要更新、缺失备份、备份多余、元数据差异和类型冲突
- 汇总待复制、待替换、待复核的文件数量和容量
- 双栏文件树查看差异位置
- 单路径空间占用分析
- 显示目录占比、最大文件列表和按大小排序的空间树

## 使用方法

```bash
python filetree.py
```

启动后打开：

```text
http://localhost:8080
```

也可以传入两个路径用于启动时记录：

```bash
python filetree.py /path/to/source /path/to/backup
```

## 文件结构

- `filetree.py` - CLI 入口
- `server.py` - Web 服务与 API
- `scanner.py` - 文件扫描与空间统计
- `comparator.py` - 备份差异比较与汇总
- `static/index.html` - 主页面
- `static/style.css` - 样式
- `static/app.js` - 前端交互
