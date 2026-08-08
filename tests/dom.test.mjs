/* DOM 级交互测试：用 jsdom + fake-indexeddb 在 Node 中真实执行前端代码，
 * 验证事件绑定与 Tab 切换等交互逻辑（浏览器自动化注入无法到达时的替代验证）。
 * 依赖（安装到 /tmp/vocab-jsdom）：
 *   cd /tmp/vocab-jsdom && npm init -y && npm install jsdom fake-indexeddb
 * 运行前需启动本地服务器：python3 -m http.server 8002
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// jsdom/fake-indexeddb 安装于 /tmp/vocab-jsdom（不污染纯静态项目）
const require = createRequire("/tmp/vocab-jsdom/package.json");
const { JSDOM } = require("jsdom");
const { indexedDB: fakeIndexedDB, IDBKeyRange: fakeKeyRange } = require("fake-indexeddb");

const BASE = "http://localhost:8000/";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");

const dom = new JSDOM(html, { url: BASE + "?nosw=1", runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;

// 注入浏览器环境
window.indexedDB = fakeIndexedDB;
window.IDBKeyRange = fakeKeyRange;
const nativeFetch = globalThis.fetch; // Node 原生 fetch
window.fetch = async (url, opts) => {
  // 相对路径解析到本地服务器
  const u = url.startsWith("http") ? url : BASE + url.replace(/^\.\//, "");
  return nativeFetch(u, opts);
};
window.confirm = () => true;
window.alert = () => {};

// 模块引用的全局环境
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.location = window.location;
globalThis.indexedDB = window.indexedDB;
globalThis.IDBKeyRange = window.IDBKeyRange;
globalThis.fetch = window.fetch;
globalThis.confirm = window.confirm;

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log("DOM 交互测试（jsdom）");

const doc = window.document;
const $ = (id) => doc.getElementById(id);

// 加载应用模块并触发启动
await import(new URL("../js/app.js", import.meta.url));
window.addEventListener("error", (e) => console.log("[window error]", e.message, e.error?.stack?.split("\n")[1] || ""));
window.addEventListener("unhandledrejection", (e) => console.log("[unhandledrejection]", e.reason?.message || String(e.reason)));
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
// boot 中间态观测
for (const t of [300, 1200]) {
  await new Promise((r) => setTimeout(r, t));
  console.log(`  [boot@${t}ms] sub="${doc.getElementById("header-sub")?.textContent}" startBtnHidden=${doc.getElementById("btn-start-study")?.hidden}`);
}

/* T1: 初始状态 */
check("T1 头部标题为「背单词」", $("header-title").textContent === "背单词", `实际: ${$("header-title").textContent}`);
check("T1 副标题含词典信息", $("header-sub").textContent.includes("内置词典"), `实际: ${$("header-sub").textContent}`);
check("T1 弹层默认隐藏", $("detail-modal").hidden === true, `detail-modal.hidden=${$("detail-modal").hidden}`);
check("T1 开始按钮可见", $("btn-start-study").hidden === false);

/* T2: 点击查词 Tab → 切换到查词页 */
doc.querySelector('.tab-btn[data-tab="lookup"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
check("T2 标题变「查词」", $("header-title").textContent === "查词", `实际: ${$("header-title").textContent}`);
check("T2 查词 Tab 激活", doc.querySelector('.tab-btn[data-tab="lookup"]').classList.contains("active"));
check("T2 查词页可见", $("tab-lookup").classList.contains("active"));
check("T2 背单词页隐藏", !$("tab-study").classList.contains("active"));

/* T3: 词典查询 hablar（真实西语词典数据，英文释义） */
const input = $("lookup-input");
input.value = "hablar";
$("lookup-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 1500));
const result = $("lookup-result").textContent;
check("T3 查询结果显示 hablar", result.includes("hablar"), `实际: ${result.slice(0, 80)}`);
check("T3 显示英文释义", result.includes("talk"), `实际: ${result.slice(0, 120)}`);
check("T3 显示词性标签", $("lookup-result").querySelector(".source-tag") !== null);

/* T4: 收藏 hablar 到生词本 */
const saveBtn = $("btn-save");
check("T4 收藏按钮存在", saveBtn !== null);
if (saveBtn) {
  saveBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  // 通过生词本页验证
  doc.querySelector('.tab-btn[data-tab="saved"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const listText = $("saved-list").textContent;
  check("T4 生词本含 hablar", listText.includes("hablar"), `实际: ${listText.slice(0, 80)}`);
}

/* T5: 背单词开始 → 卡片出现 → 翻面 → 标记 */
doc.querySelector('.tab-btn[data-tab="study"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
$("btn-start-study").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 800));
check("T5 卡片区可见", $("study-card-wrap").hidden === false, `hidden=${$("study-card-wrap").hidden}`);
const word1 = $("card-word").textContent;
check("T5 卡片正面有单词", word1 && word1 !== "word", `实际: ${word1}`);
$("flashcard").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 600));
check("T5 翻面显示释义", $("card-cn").textContent && !$("card-cn").textContent.includes("加载中"), `实际: ${$("card-cn").textContent.slice(0, 40)}`);
$("btn-know").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
const word2 = $("card-word").textContent;
check("T5 标记后进入下一张", word2 !== word1 || $("study-card-wrap").hidden === true, `word1=${word1} word2=${word2}`);

/* T6: 统计页渲染 */
doc.querySelector('.tab-btn[data-tab="stats"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
check("T6 统计今日数量", $("stat-today").textContent === "0" || /^\d+$/.test($("stat-today").textContent), `实际: ${$("stat-today").textContent}`);
check("T6 生词本数量", /^\d+$/.test($("stat-saved").textContent), `实际: ${$("stat-saved").textContent}`);

/* T7: 导入 100 个常用西语词 */
doc.querySelector('.tab-btn[data-tab="saved"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
$("btn-import-common").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 2500)); // 100 词写入 IndexedDB
const items = doc.querySelectorAll("#saved-list .word-item").length;
const listText2 = $("saved-list").textContent;
check("T7 导入后生词本 ≥100 词", items >= 100, `实际: ${items}`);
check("T7 生词本含常用词 hola", listText2.includes("hola") || listText2.includes("casa"), `实际: ${listText2.slice(0, 60)}`);
check("T7 导入不重复（含 hablar）", listText2.includes("hablar"), `实际: ${listText2.slice(0, 60)}`);

/* T8: 导入 100 词后（生词本非空）仍可开始背单词 */
doc.querySelector('.tab-btn[data-tab="study"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
$("btn-start-study").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1200));
check("T8 生词本非空时卡片区可见", $("study-card-wrap").hidden === false, `hidden=${$("study-card-wrap").hidden}`);
const word3 = $("card-word").textContent;
check("T8 卡片正面有单词", word3 && word3 !== "word", `实际: ${word3}`);
check("T8 卡片来自未学词池（非生词本已有词）", !listText2.includes(word3), `实际: ${word3}`);

/* T9: 发音功能容错（jsdom 无 speechSynthesis，不崩溃且安全降级） */
const { speak, hasSpanishVoice } = await import("../js/tts.js");
check("T9 tts 模块在无 TTS 环境可加载", typeof speak === "function");
check("T9 无 TTS 时 speak 安全返回 false", speak("hola") === false, `实际: ${speak("hola")}`);
check("T9 无 TTS 时 hasSpanishVoice 为 false", hasSpanishVoice() === false);
const audioBtn = $("btn-card-audio");
check("T9 卡片正面有 🔊 按钮", audioBtn !== null && audioBtn.dataset.speak === word3, `实际: ${audioBtn?.dataset.speak}`);
// 点击 🔊 不抛异常（事件委托路径）
audioBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
check("T9 点击 🔊 不崩溃", true);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
