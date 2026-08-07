# iPhone 离线安装指南（不经过 GitHub/公网）

把背单词应用**直接拷贝到手机**，在 iPhone 本地运行，无需任何账号与公网服务。
安装完成后**离线可用**（无需联网、无需 Mac 开机）。

## 需要的东西

1. **iPhone 上的免费 App：[a-Shell](https://apps.apple.com/app/a-shell/id1473805438)**（App Store 搜索 "a-Shell"，作者 Nicolas Holzschuch，免费开源）
2. 本仓库打包好的 `vocab-app-iphone.zip`（Mac 上在 `vocab-app` 的上一级目录）

## 安装步骤（约 3 分钟）

### 1. 拷贝 zip 到手机
- Mac 上找到 `vocab-app-iphone.zip`
- 右键 → **共享 → 隔空投送（AirDrop）** → 选择你的 iPhone
- iPhone 上收到后选择"存储到"文件 App

### 2. 解压到 a-Shell
- iPhone 打开 **文件** App → 找到 `vocab-app-iphone.zip`
- **长按** zip → 菜单选 **共享** → 选择 **a-Shell**
- a-Shell 打开后自动解压，你会看到 `vocab-app` 文件夹

### 3. 在手机上启动服务器
- a-Shell 里输入（注意换成你实际的路径，可用 `ls` 查看）：
  ```
  cd vocab-app
  python3 dev_server.py 8000
  ```
- 看到 `开发服务器: http://localhost:8000` 即成功
- **保持 a-Shell 在前台**（或按 Home 键让它挂后台，iOS 允许继续运行）

### 4. 安装到主屏幕
- iPhone 打开 **Safari**，地址栏输入：
  ```
  http://localhost:8000
  ```
- **首次访问务必保持在线**：应用会自动把词典（3.5MB）与全部代码缓存到本机（Service Worker 预缓存，约 10~30 秒，期间保持 Safari 打开）
- 确认应用界面正常（能看到底部 4 个 Tab）后，点 **分享按钮**（方框+箭头）→ **添加到主屏幕** → 添加

### 5. 使用与离线
- 点主屏幕上的「单词卡」图标即全屏运行
- **之后完全离线可用**（词典已在本机缓存，无需联网、无需 a-Shell 开着）
- 需要**更新版本**时：把新 zip 再隔空投送一次 → 文件 App 里覆盖 → a-Shell 重新启动服务器 → **Safari 打开 `http://localhost:8000` 刷新两次**（第一次安装新版缓存，第二次完全生效）→ 主屏幕图标直接使用新版本

## 常见问题

| 问题 | 解决 |
| --- | --- |
| 添加主屏幕后打开是空白 | 先在 Safari 里完整打开一次（等词典加载完）再添加主屏幕 |
| a-Shell 里找不到文件夹 | 用 `ls` 查看当前目录；`cd vocab-app` 前先确认在 `~/Documents` |
| 想彻底卸载 | 主屏幕长按图标 → 移除 App；a-Shell 里 `rm -rf vocab-app` |
| 想回到「Mac 局域网」方式 | 随时可以用，两者数据互相独立（数据存在各自浏览器） |

## 技术说明（为什么这样可行）

- iPhone 的 `localhost` 属于**安全上下文**（secure context），Service Worker / IndexedDB / PWA 全部可用
- a-Shell 内置 Python 3，`dev_server.py` 是纯标准库脚本，无需安装任何依赖
- 数据（生词本、学习记录、AI Key）全部存在 iPhone 浏览器的 IndexedDB 里，与 Mac 端互不影响
