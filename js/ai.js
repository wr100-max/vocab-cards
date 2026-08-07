/* ============================================================
 * ai.js — DeepSeek API 集成（OpenAI 兼容端点，浏览器直连）
 * - 批量生成单词的英文释义 / 中文释义 / 例句（含翻译）
 * - 结果校验后写入 IndexedDB 缓存（source: "ai"），重复查询不重复付费
 * - 失败降级：返回结构化的错误信息，由 UI 提示
 * ============================================================ */

import { db, DEFAULT_SETTINGS } from "./db.js";

/** 系统提示词：固定不变，便于用户侧缓存与稳定输出 */
const SYSTEM_PROMPT = [
  "You are an expert Spanish vocabulary tutor. The user gives you a list of Spanish words; for each word generate a study card.",
  "IMPORTANT: ALL definition and translation fields must be written in ENGLISH. Never use Chinese.",
  "Requirements:",
  "1. phonetic: IPA pronunciation in / /, or leave empty for regular Spanish words;",
  "2. pos: part of speech abbreviation, e.g. n. / v. / adj. / adv., use / to separate multiple;",
  "3. cn: concise ENGLISH definition(s) (1-3 senses, separated by ';'), written clearly for learners;",
  "4. en: additional ENGLISH definition senses or usage notes, if any;",
  "5. ex: ONE original Spanish example sentence (max 20 words) using the word's most common meaning;",
  "6. ex_cn: the ENGLISH translation of the example sentence.",
  "If the word is a verb inflection (e.g. 'llevé'), explain it as a form of the infinitive: definition in English plus note like '(form of llevar)'.",
  'Output STRICT JSON only, e.g. {"words": {"hablar": {"phonetic": "/aˈβlaɾ/", "pos": "v.", "cn": "to speak; to talk", "en": "", "ex": "Ella habla tres idiomas.", "ex_cn": "She speaks three languages."}}}',
  "No other text besides this JSON.",
].join("\n");

/** 批量生成上限 */
export const AI_BATCH_MAX = 10;

/**
 * 调用 DeepSeek 为一批单词生成卡片内容。
 * @param {string[]} words 单词列表（<= AI_BATCH_MAX）
 * @param {object} settings {apiKey, apiBase, model}
 * @returns {Promise<{[word]: entry}>} 成功返回词条 map；失败抛出带 message 的错误
 */
export async function generateWords(words, settings = DEFAULT_SETTINGS) {
  if (!settings.apiKey) {
    throw new Error("未配置 API Key，请在「统计 → AI 生成」中填写 DeepSeek API Key");
  }
  if (words.length === 0) return {};
  if (words.length > AI_BATCH_MAX) {
    words = words.slice(0, AI_BATCH_MAX);
  }

  const base = (settings.apiBase || DEFAULT_SETTINGS.apiBase).replace(/\/+$/, "");
  const model = settings.model || DEFAULT_SETTINGS.model;

  const payload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `请为以下单词生成卡片：\n${JSON.stringify(words)}` },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  };
  // deepseek-reasoner 不支持 response_format，靠提示词约束
  if (!model.includes("reasoner")) {
    payload.response_format = { type: "json_object" };
  }

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error("网络请求失败，请检查网络或 API 地址");
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const body = await resp.json();
      detail = body?.error?.message || "";
    } catch { /* ignore */ }
    const map = {
      401: "API Key 无效",
      402: "账户余额不足",
      429: "请求过于频繁（限流），请稍后重试",
    };
    throw new Error(`${map[resp.status] || `请求失败 (${resp.status})`}${detail ? `：${detail}` : ""}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 模型偶尔会包裹代码块，做一次兜底提取
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI 返回内容无法解析，请重试");
    parsed = JSON.parse(m[0]);
  }

  const result = {};
  const cardData = parsed?.words || parsed || {}; // 兼容 {"words": {...}} 与直接键值两种结构
  for (const word of words) {
    const raw = cardData[word] || {};
    const entry = normalizeEntry(word, raw);
    if (entry.cn || entry.en) {
      result[word] = entry;
      await db.putWord(entry); // 写入缓存
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error("AI 未返回有效内容，请重试");
  }
  return result;
}

/** 把 AI 输出规范化为词条结构（缺字段留空，UI 层兜底显示） */
function normalizeEntry(word, raw) {
  return {
    word,
    phonetic: str(raw.phonetic),
    pos: str(raw.pos),
    cn: str(raw.cn),
    en: str(raw.en),
    ex: str(raw.ex),
    ex_cn: str(raw.ex_cn),
    source: "ai",
    aiAt: Date.now(),
  };
}

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
