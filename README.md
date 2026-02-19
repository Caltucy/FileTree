# 文件树比较工具

## 功能
- 比较两个路径的文件差异
- 可视化文件树结构
- 显示文件大小和修改时间
- 支持搜索和过滤

## 使用方法

### 方式1：命令行指定路径
```bash
python filetree.py /path/to/disk1 /path/to/disk2
```

### 方式2：启动后在网页输入路径
```bash
python filetree.py
```

然后在浏览器中输入两个路径进行比较。

## 文件结构
- `filetree.py` - CLI入口
- `server.py` - Web服务器
- `scanner.py` - 文件扫描模块
- `comparator.py` - 差异比较模块
- `static/` - 前端文件
  - `index.html` - 主页面
  - `style.css` - 样式
  - `app.js` - 交互逻辑
