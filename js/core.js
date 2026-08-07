/* ============================================================
 * core.js — 纯逻辑核心（无 DOM 依赖，可在 Node 中单测）
 * 包含：日期工具、复习调度、打卡计算、卡片队列组装
 * ============================================================ */

/** 返回本地时区的 YYYY-MM-DD */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD -> 本地 Date（当天零点） */
export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 日期偏移（天） */
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** 一周起始（周一）的日期字符串 */
export function weekStart(s) {
  const d = parseDate(s);
  const wd = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - wd);
  return todayStr(d);
}

/* ---------- 复习调度 ---------- */

/** 复习间隔（天），按阶段递进 */
export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];

/**
 * 计算单词下一次复习日期。
 * @param stage 当前复习阶段（0 = 首次学错进入队列）
 * @returns {stage: number, due: string}
 */
export function nextReview(stage = 0) {
  const nextStage = Math.min(stage + 1, REVIEW_INTERVALS.length);
  const days = REVIEW_INTERVALS[nextStage - 1];
  return { stage: nextStage, due: addDays(todayStr(), days) };
}

/**
 * 学习标记 -> 是否需要复习
 * @param mark "know" | "fuzzy" | "forgot"
 */
export function needsReview(mark) {
  return mark === "fuzzy" || mark === "forgot";
}

/* ---------- 打卡 / 连续天数 ---------- */

/**
 * 计算连续打卡天数（截至今天）。
 * @param doneDates 已打卡日期数组（YYYY-MM-DD）
 */
export function calcStreak(doneDates, today = todayStr()) {
  const set = new Set(doneDates);
  if (!set.has(today)) {
    // 今天还没打卡：从昨天往前数
    let d = addDays(today, -1);
    let n = 0;
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  let d = today;
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- 随机工具 ---------- */

/** Fisher-Yates 原地洗牌（背单词卡片初始随机化） */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- 每日卡片队列组装 ---------- */

/**
 * 组装今日学习队列：复习优先，再补新词。
 * @param opts {newCount, reviewItems, newItems, customFirst}
 *   reviewItems: [{word, stage}] 到期待复习项
 *   newItems: [{word}] 候选新词（已去重、未学过）
 * @returns {reviews: [{word, stage}], news: [{word}], total}
 */
export function buildDailyQueue(opts) {
  const { newCount = 20, reviewItems = [], newItems = [], customFirst = false } = opts;
  const reviews = reviewItems.slice(0, newCount); // 复习最多占用当日配额
  const slot = Math.max(0, newCount - reviews.length);
  let news = newItems.slice(0, slot);
  if (customFirst) {
    // 自定义词表优先：news 已按优先级排序（调用方保证），此处无需再排
  }
  return { reviews, news, total: reviews.length + news.length };
}
