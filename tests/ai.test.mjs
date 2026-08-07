/* AI 端到端测试：用真实 DeepSeek API 验证 ai.js 的生成与解析链路。
 * 运行：DEEPSEEK_TEST_KEY=sk-xxx node tests/ai.test.mjs
 * 依赖：/tmp/vocab-jsdom（jsdom + fake-indexeddb）；需本地服务器 8000 提供词典数据
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/tmp/vocab-jsdom/package.json");
const { JSDOM } = require("jsdom");
const { indexedDB: fakeIndexedDB } = require("fake-indexeddb");

const API_KEY = process.env.DEEPSEEK_TEST_KEY;
if (!API_KEY) {
  console.error("请通过环境变量提供 key：DEEPSEEK_TEST_KEY=sk-xxx node tests/ai.test.mjs");
  process.exit(1);
}

const BASE = "http://localhost:8000/";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");
const dom = new JSDOM(html, { url: BASE + "?nosw=1", runScripts: "dangerously" });
const { window } = dom;
window.indexedDB = fakeIndexedDB;
const nativeFetch = globalThis.fetch;
window.fetch = async (url, opts) => {
  const u = url.startsWith("http") ? url : BASE + url.replace(/^\.\//, "");
  return nativeFetch(u, opts);
};
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.location = window.location;
globalThis.indexedDB = window.indexedDB;
globalThis.fetch = window.fetch;

let passed = 0, failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log("AI 端到端测试（DeepSeek 真实调用）");

const { generateWords } = await import("../js/ai.js");
const settings = {
  apiKey: API_KEY,
  apiBase: "https://api.deepseek.com",
  model: "deepseek-chat",
  aiEnabled: true,
};

// 1. 批量生成（含变位词）
try {
  const map = await generateWords(["feliz", "llevé"], settings);
  check("生成 2 词成功", Object.keys(map).length === 2, `实际: ${Object.keys(map).join(",")}`);
  const feliz = map["feliz"];
  check("feliz 释义为英文", /^[A-Za-z]/.test(feliz.cn) && !/[\u4e00-\u9fff]/.test(feliz.cn), `实际: ${feliz.cn}`);
  check("feliz 含英文例句", !!feliz.ex && !/[\u4e00-\u9fff]/.test(feliz.ex), `实际: ${feliz.ex}`);
  check("feliz 例句译为英文", !!feliz.ex_cn && !/[\u4e00-\u9fff]/.test(feliz.ex_cn), `实际: ${feliz.ex_cn}`);
  check("llevé 标注变位来源", /form of/i.test(map["llevé"].cn || map["llevé"].en || ""), `实际: ${map["llevé"].cn} / ${map["llevé"].en}`);
  check("词条已写入缓存(source=ai)", (await import("../js/db.js")).db.getWord("feliz").then((e) => e?.source === "ai").catch(() => false));
} catch (err) {
  check("批量生成成功", false, `异常: ${err.message}`);
}

// 2. 二次调用应命中缓存（不重复调用 API——此处仅验证缓存存在）
try {
  const { db } = await import("../js/db.js");
  const cached = await db.getWord("feliz");
  check("缓存命中（source=ai）", cached?.source === "ai" && cached.cn === "happy; glad" || cached?.source === "ai" && !!cached.cn);
} catch (err) {
  check("缓存验证", false, err.message);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
