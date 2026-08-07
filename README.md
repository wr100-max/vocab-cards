# 单词卡 · 背西班牙语（PWA）

在 iPhone / Mac 浏览器上运行的西班牙语单词学习应用。每日按规定数量生成单词卡片，内置西英词典即时返回**英文释义**，查不到的单词由 DeepSeek AI 兜底生成英文释义与例句。

## 功能

| 模块 | 说明 |
| --- | --- |
| 📇 背单词 | 每日 N 个单词卡片（默认 20，可调 5–50）；卡片翻面看英文释义与西语例句；标记 认识/模糊/不认识；模糊与不认识自动进入间隔复习队列（1/2/4/7/15/30 天递进）并在当天重学；完成打卡、连续天数统计 |
| 🔍 查词 | 输入西班牙语单词 → 内置词典即时返回词性、**英文释义**、西语例句 + 英文翻译；动词变位词自动映射词头（如 llevé → llevar）；无重音输入自动容错（podria → podría）；词典未收录时自动调用 DeepSeek AI 生成（标注「AI 生成」并缓存）；可一键收藏进生词本 |
| 📚 生词本 | 查看/搜索/筛选全部生词；详情页含完整释义与学习记录；手动添加（支持批量粘贴）；标记已掌握；导出 CSV 或复制文本 |
| 📊 统计·设置 | 今日/本周/累计/连续打卡/生词统计；每日数量、自定义词表优先开关；DeepSeek API Key、模型、地址配置；数据备份导出、清空学习数据 |

数据全部存储在浏览器本地（IndexedDB），无需注册账号。

## 本地运行（Mac）

```bash
cd vocab-app
npm run serve        # 或: python3 dev_server.py 8000
```

浏览器打开 <http://localhost:8000> 即可使用。

> 开发服务器已禁用浏览器缓存（Cache-Control: no-cache），代码修改后刷新即生效。
> 若之前用旧服务器访问过并遇到异常（页面只显示静态外壳、按钮无法点击），
> 请换一个端口（如 `python3 dev_server.py 8003`）访问，或在浏览器中清除该站点的
> Service Worker / 站点数据后刷新。

> 提示：词典数据（`data/dict-*.json`，约 1.4 万高频词 + 变位形式，3.5MB）在首次打开时由浏览器自动加载。

## 在 iPhone 上试用

1. 确保 Mac 与 iPhone 连接**同一个 Wi-Fi**；
2. 在 Mac 上启动本地服务器，并记下 Mac 的局域网 IP：
   ```bash
   ipconfig getifaddr en0   # 输出如 192.168.1.23
   ```
3. iPhone 上打开 Safari，访问 `http://192.168.1.23:8000`；
4. 点「分享」→「添加到主屏幕」，之后可像 App 一样全屏打开（离线可用）。

## 部署到公网（可选，实现「永久安装」）

PWA 只有通过 HTTPS 访问才具备完整离线安装能力。推荐 GitHub Pages：

1. 在 GitHub 新建仓库，把本项目推上去；
2. 仓库 Settings → Pages → Source 选择 `main` 分支根目录；
3. 约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`；
4. iPhone Safari 打开该地址 → 分享 → 添加到主屏幕。

> 其他免费静态托管（Netlify / Vercel / Cloudflare Pages）同样适用。

## DeepSeek AI 配置（可选）

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com/) 注册并创建 API Key；
2. 在应用「统计 → AI 生成」中粘贴 Key（**仅保存在本机浏览器**）；
3. 默认模型 `deepseek-chat`（V3，适合释义生成），可切换 `deepseek-reasoner`；API 地址可自定义（默认官方地址）。

未配置 Key 时，应用仍可正常使用词典功能与背单词，仅查不到的单词无法 AI 补充。

## 开发

```
vocab-app/
├── index.html            # 单页应用外壳
├── manifest.webmanifest  # PWA 清单
├── sw.js                 # Service Worker（离线缓存）
├── css/style.css
├── js/
│   ├── app.js            # 入口：Tab 路由、查词页
│   ├── core.js           # 纯逻辑：日期/复习调度/打卡（可单测）
│   ├── db.js             # IndexedDB 封装
│   ├── dict.js           # 内置词典分片查询（支持西语重音容错）
│   ├── ai.js             # DeepSeek API 集成（西语→英文释义，批量生成+缓存）
│   ├── study.js          # 背单词引擎
│   ├── saved.js          # 生词本
│   ├── stats.js          # 统计与设置
│   └── ui.js             # 通用 UI 工具
├── data/                 # 西语词典分片（build 生成）
├── build/
│   ├── build_spanish.py  # 从 doozan/spanish_data 构建词典数据
│   └── make_icons.py     # 生成 PWA 图标
└── tests/
    ├── core.test.mjs     # 核心逻辑单元测试（Node 原生，直接运行）
    └── dom.test.mjs      # DOM 交互测试（jsdom + fake-indexeddb）

# 单元测试（Node 原生，无需依赖）
node tests/core.test.mjs

# DOM 交互测试（需先安装 jsdom 依赖并启动本地服务器）
#   cd /tmp && mkdir -p vocab-jsdom && cd vocab-jsdom && npm init -y && npm install jsdom fake-indexeddb
#   python3 -m http.server 8000   （另开终端）
#   node tests/dom.test.mjs
```

词典数据来源：[doozan/spanish_data](https://github.com/doozan/spanish_data)（CC BY-SA / CC BY 许可），由
Wiktionary 西语词条（英文释义）+ 高频词频率表 + Tatoeba 西英双语例句构建；构建脚本从高频前 5 万词中选取
约 1.4 万词（含动词变位/性数变化形式，自动映射词头），并尽量配齐双语例句，生成浏览器友好的按字母分片数据。

## 隐私说明

- 所有学习数据、生词本、API Key 均保存在本机浏览器（IndexedDB/localStorage），不上传任何服务器；
- AI 功能仅在启用并配置 Key 后调用 DeepSeek API，调用内容为需要查询的单词本身；
- 部署到公网后，同一浏览器下的数据仍仅存于该设备。
