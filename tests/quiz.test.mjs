/* 题型引擎测试：出题结构、干扰项、判题（jsdom 环境，真实词典数据）
 * 依赖：/tmp/vocab-jsdom（jsdom + fake-indexeddb）；需本地服务器 8000
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/tmp/vocab-jsdom/package.json");
const { JSDOM } = require("jsdom");
const { indexedDB: fakeIndexedDB } = require("fake-indexeddb");

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

console.log("题型引擎测试");

const { makeQuestion, judge } = await import("../js/quiz.js");
const { lookup } = await import("../js/dict.js");

const entry = await lookup("hablar");

/* 选择题（词→义） */
const q1 = await makeQuestion(entry, 0);
check("choice 题有 4 个选项", q1.options.length === 4, `实际: ${q1.options.length}`);
check("choice 题恰有 1 个正确项", q1.options.filter((o) => o.correct).length === 1);
check("choice 题干扰项释义非空", q1.options.every((o) => o.text.length > 0));
check("choice 判题正确", judge(q1, q1.options.find((o) => o.correct)) === true);
check("choice 判题错误", judge(q1, "wrong-answer") === false);

/* 听力题 */
const q2 = await makeQuestion(entry, 1);
check("listen 题不显示原词", !q2.prompt.includes("hablar"), `实际: ${q2.prompt}`);
check("listen 题含提示语", q2.prompt.length > 0);
check("listen 题含发音文本", q2.audioText === "hablar");
check("listen 题判题", judge(q2, "hablar") === true);

/* 拼写题 */
const q3 = await makeQuestion(entry, 2);
check("spell 题字母数=词长", q3.letters.length === entry.word.length, `实际: ${q3.letters.length} vs ${entry.word.length}`);
check("spell 题字母集合正确", [...q3.letters].sort().join("") === entry.word.split("").sort().join(""));
check("spell 判题正确（大小写不敏感）", judge(q3, "HABLAR") === true);
check("spell 判题错误", judge(q3, "habla") === false);

/* 反向选择题（义→词） */
const q4 = await makeQuestion(entry, 3);
check("choice-rev 题 prompt 为英文释义", typeof q4.prompt === "string" && q4.prompt.length > 0);
check("choice-rev 判题", judge(q4, "hablar") === true);

/* 题型轮换 */
check("四题轮换覆盖 4 种题型", [q1, q2, q3, q4].map((q) => q.type).join(",") === "choice,listen,spell,choice-rev");

/* 干扰项互不相同 */
check("选项互不重复", new Set(q1.options.map((o) => o.text)).size === 4);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
