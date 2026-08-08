# 开发笔记：背单词 PWA（西班牙语）迭代经验全记录

> 覆盖 v1 → v21 全过程的踩坑、解法与工程纪律。按类别整理，供后续迭代参考。

---

## 一、架构决策回顾

| 决策点 | 最终方案 | 备选与弃用原因 |
| --- | --- | --- |
| 运行形态 | PWA（纯 HTML/JS，无框架） | 原生 App 需开发者账号；网页可添加主屏幕全屏运行 |
| 部署 | GitHub Pages（HTTPS） | a-Shell 本地方案（iOS 杀进程不稳定）→ 最终 GitHub Pages |
| 词典 | 内置分片 JSON（西语 1.4 万词） | 全量词典太大；在线 API 不稳定 |
| AI | DeepSeek 浏览器直连（CORS 已验证） | 需后端代理的方案过重 |
| 发音 | 系统 TTS（Web Speech API） | 音频文件太大；在线 TTS CORS 受限 |
| 学习模式 | 互动答题（选择/拼写/反向）+ 经典翻卡可切换 | Duolingo 风格，用户指定 |

---

## 二、问题与解法（按类别）

### 1. CSS 与 hidden 属性（本项目最高频的坑，出现 5 次）

**症状**：元素设置了 `hidden` 属性仍显示，界面元素互相遮挡、按钮"失效"。

**根因**：CSS 中 `display: flex/grid/inline-flex` 的优先级**高于** HTML `hidden` 属性（UA 样式 `display:none` 被覆盖）。

**案例**：modal、study-actions、quiz-options/quiz-spell/quiz-feedback、audio-btn。

**解法**：凡是有 `display` 声明且按需显隐的元素，一律补：
```css
.xxx[hidden] { display: none; }
```

**教训**：新增任何"显隐切换"UI 时，先检查该元素的 CSS 是否声明了 display。

---

### 2. Service Worker 缓存机制（第二大坑）

**问题 A：版本号必须 bump**
- 修改了 js/css 但没升 `VERSION` → 旧缓存永远生效，用户看到旧代码
- 发生过 3 次（v4→v5 前、v7→v8 前等）
- **纪律**：任何前端代码变更发布，同步 bump `sw.js` 的 VERSION 和设置页版本号

**问题 B：SW 更新时序**
- 新版本安装 ≠ 当前页面立即用新代码（页面仍由旧 SW 控制）
- 用户需要"刷新 2-3 次"才能看到新版，体验差且反复被误解为 bug
- **最终解法**：`activate` 后 `clients.claim()` + 遍历 `clients.matchAll` 执行 `c.navigate(c.url)` 自动刷新——一次打开即更新到位

**问题 C：SW 预缓存大文件（词典 3.5MB）在 iOS 上被中断**
- `addAll` 一次性缓存 29 个文件，iOS 切后台/锁屏即 BrokenPipe → 整个安装失败 → 离线不可用
- **解法**：① SW 只缓存应用外壳（小、快）；② 词典由页面层逐个缓存（容错 + 进度条 + 可重试）

**问题 D：缓存阻塞启动**
- 启动时等待词典缓存完成 → 网络慢时"开始学习"按钮迟迟不出现
- **解法**：缓存流程后台并行（fire-and-forget），不阻塞主流程；单文件 10 秒超时

**教训**：SW 缓存与页面启动流程解耦；更新体验是 PWA 的核心体验之一。

---

### 3. IndexedDB 与数据兼容

**问题 A：升级清空旧数据的 live 集合迭代**
```js
for (const name of db.objectStoreNames) db.deleteObjectStore(name);
// objectStoreNames 是 live 集合，迭代中删除会抛异常
```
**解法**：先复制 `[...db.objectStoreNames]` 再删除。

**问题 B：旧记录缺字段导致运行时崩溃**
- 老数据 `studyRec` 无 `reviews` 字段 → `rec.reviews.includes()` 崩溃
- **解法**：读取时统一补全默认结构：
```js
{ date, learned: rec.learned || [], marks: rec.marks || {}, reviews: rec.reviews || [], done: !!rec.done }
```
**教训**：IndexedDB 数据结构升级时，读取端必须防御式补全。

**问题 C：残留学习记录导致"开始按钮消失"死锁**
- 昨天学 1 词未完成 → 今天 `learned.length > 0` → 按钮被误隐藏 → 界面死锁
- **解法**：按钮显隐只依据"会话是否已组装"（`!cards.length`），与历史记录无关

---

### 4. iOS 语音（TTS）四个连环坑

| 坑 | 症状 | 解法 |
| --- | --- | --- |
| 异步 speak | 点击后无声（iOS 静默拒绝） | 手势同步栈内调用；设置读取用 localStorage 内存镜像（`getSettingsSync`），零 await |
| 指定 voice | 显式 `u.voice` 可能无声 | 只设 `u.lang = "es-ES"`，按语言自动匹配 |
| cancel 后立即 speak | 每次先 cancel 再 speak → iOS 拒绝 | 不调用 cancel |
| speaking 状态卡死 | 一次失败后 `speaking` 永远 true → 自己加的守卫永久拦截 | 不加任何状态守卫，直接 speak |

**教训**：iOS Web Speech API 是"宁可排队也不要干预"——所有防御性逻辑都可能成为新的无声元凶。

---

### 5. AI 集成（DeepSeek）

- **CORS**：先用 OPTIONS 预检验证浏览器直连可行性（回显 origin + 允许 authorization 头）
- **语言漂移**：模型对"英文释义"要求偷懒返回中文 → 提示词加 `IMPORTANT: ALL definitions MUST be in ENGLISH. Never use Chinese.` + 英文 few-shot 示例
- **JSON 结构不稳定**：有时带 `{"words": {...}}` 包装、有时直接键值 → 解析兼容两种
- **Key 安全**：测试 key 用环境变量传入，不写入任何项目文件；提醒用户用完撤销

---

### 6. 测试方法论（jsdom）

**坑**：
- jsdom 不执行 `<script type="module">` → 手动 `await import()` 应用模块
- 手动派发 `DOMContentLoaded` 不冒泡到 window（真实浏览器特例）→ 需 `{ bubbles: true }`
- `globalThis.fetch = window.fetch` 造成无限递归 → 先保存 `nativeFetch`
- 测试间状态污染：quizMode 设置、cards 残留、旧 study 记录 → 每个测试组显式设置前置状态
- **测试覆盖盲区**：T11 的拼写分支因题型轮换从未执行 → `spellConfirm` 漏 `export` 的 bug 漏网 3 个版本
  → **教训**：测试断言必须真实执行目标路径，而不是"存在即通过"；关键函数导出后要核对

**经验**：
- 核心逻辑（复习调度、打卡、洗牌）写成与 DOM 解耦的纯函数（core.js），Node 直测
- 数据层用 fake-indexeddb；词典查询用真实数据（本地服务器）
- AI 测试用真实 API + 环境变量 key（端到端）

---

### 7. 环境与工具

- **IAB 自动化无法注入点击**（playwright/cua/dom_cua 全失败）→ 用 jsdom 验证逻辑，如实向用户报告工具限制
- **本地开发缓存**：`http.server` 无缓存头 → 浏览器启发式缓存旧代码 → 写 `dev_server.py` 强制 `Cache-Control: no-cache`
- **端口冲突**：8001 被其他应用占用 → 换端口；`&` 后台进程随 Bash 会话结束被杀 → 用独立后台任务
- **git push 网络不稳**（HTTP2 framing layer / 超时）→ `git -c http.version=HTTP/1.1` + 多次重试循环

---

### 8. 需求变更管理

- 用户中途从"英语+中文释义"切到"西语+英文释义" → 数据源（ECDICT → doozan/spanish_data）、AI 提示词、UI 文案、正则全链路替换
- 词库命中率低（49%）→ 用 frequency.csv 的 usage 字段做 词形→词头（lemma）归一化，覆盖率翻倍
- 常用词包过滤虚词：pos 必须收集**全部词性段**（Wiktionary 多词性词条首段不可靠），且注意"遍历字符串字符"的隐性 bug

---

## 三、工程纪律清单（注意事项）

1. **SW 版本号**：改前端代码 = bump VERSION + 同步设置页版本号；发布后验证线上文件
2. **hidden vs display**：新 UI 显隐元素先查 CSS
3. **iOS 特性**：TTS 手势同步、SW 大文件逐个缓存、clients.navigate 自动更新
4. **数据防御**：IndexedDB 读取补全字段；升级先复制集合
5. **测试真实性**：断言必须执行目标路径；新增导出核对 app.js 引用
6. **安全**：token/API key 不进代码、不进 zip、用完撤销；测试用环境变量
7. **网络**：GitHub raw 直连慢 → 用镜像；push 失败重试 + HTTP/1.1
8. **发布流程**：改代码 → 全量测试（core + quiz + dom）→ bump 版本 → 推送 → 验证线上资源 → 告知用户"打开一次自动更新"
9. **用户排查法**：先确认版本（设置页"缓存版本"诊断），再定位代码——避免在版本问题上反复
10. **诚实报告**：工具限制、测试盲区、无法验证的部分如实说明，不假装成功

---

## 四、当前版本状态（v21）

- 题型：选择题 / 拼写题 / 反向选择题（听力题已按需求移除）
- 发音：所有题型 🔊 + 设置自动朗读/语速
- 词典：西语 13,856 词（高频+变位归一化），91% 配 Tatoeba 双语例句
- 模式：互动答题（默认）/ 经典翻卡切换
- 部署：GitHub Pages（wr100-max.github.io/vocab-cards），离线可用
- 测试：core 16 + quiz 13 + dom 50 = 79 项全绿
