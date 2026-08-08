/* ============================================================
 * quiz.js — 互动答题引擎（Duolingo 风格，无游戏化）
 * 题型轮换：选择题（词→义）→ 听力题 → 拼写题 → 选择题（义→词）→ …
 * 答错显示正确答案，结果由调用方映射到复习系统。
 * ============================================================ */

import { randomEntriesFromShard } from "./dict.js";

export const QUIZ_TYPES = ["choice", "spell", "choice-rev"];

/** 生成 n 个互不重复且与正确项不同的干扰项 */
async function pickDistractors(entry, n, correctText) {
  const candidates = await randomEntriesFromShard(entry.word, n * 3);
  const seen = new Set([correctText]);
  const out = [];
  for (const c of candidates) {
    const t = c.cn || c.word;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * 为词条生成一道题目。
 * @param {object} entry 词条 {word, cn, en, ex, ...}
 * @param {number} round 当前第几题（用于题型轮换）
 * @returns {Promise<object>} 题目对象：
 *   {type, prompt, promptLang, options?: [{text, correct}], letters?: [char], target}
 */
export async function makeQuestion(entry, round) {
  const type = QUIZ_TYPES[round % QUIZ_TYPES.length];

  if (type === "spell") {
    // 拼写题：看释义拼单词（字母块点选）
    const letters = entry.word.split("").sort(() => Math.random() - 0.5);
    return {
      type: "spell",
      prompt: entry.cn || entry.en || entry.word,
      promptLang: "en",
      letters,
      target: entry.word,
      hint: entry.pos || "",
    };
  }

  // 选择题：词→义（choice）或 义→词（choice-rev）
  const distractors = await pickDistractors(entry, 3, entry.cn || entry.word);
  if (type === "choice") {
    const options = [entry, ...distractors]
      .sort(() => Math.random() - 0.5)
      .map((e) => ({ text: e.cn || e.word, correct: e.word === entry.word }));
    return {
      type: "choice",
      prompt: entry.word,
      promptLang: "es",
      options,
      target: entry.word,
    };
  }
  const options = [entry, ...distractors]
    .sort(() => Math.random() - 0.5)
    .map((e) => ({ text: e.word, correct: e.word === entry.word }));
  return {
    type: "choice-rev",
    prompt: entry.cn || entry.word,
    promptLang: "en",
    options,
    target: entry.word,
  };
}

/**
 * 判题。
 * @param {object} q 题目对象
 * @param {string|object} answer 用户答案：选项对象（选择题/听力题）或拼写的词（拼写题）
 * @returns {boolean} 是否正确
 */
export function judge(q, answer) {
  if (!q || answer == null) return false;
  if (typeof answer === "object") return !!answer.correct; // 选项对象直接取 correct 标志
  if (q.type === "spell") {
    return String(answer).trim().toLowerCase() === String(q.target).trim().toLowerCase();
  }
  // 选项文本与目标词比较（listen/choice-rev 选项文本=单词）
  return String(answer).trim().toLowerCase() === String(q.target).trim().toLowerCase();
}

/**
 * 拼写题的字母块列表（用于渲染按钮）。
 * @returns {[char]} 打乱的字母数组
 */
export function spellLetters(q) {
  return q.letters || [];
}
