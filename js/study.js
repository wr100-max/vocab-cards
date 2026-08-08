/* ============================================================
 * study.js — 背单词引擎 + 卡片 UI
 * 流程：今日队列（到期复习优先 + 新词）→ 翻卡 → 认识/模糊/不认识
 *       → 模糊/不认识当天重学并进入间隔复习队列 → 全部完成打卡
 * ============================================================ */

import { db } from "./db.js";
import * as dict from "./dict.js";
import { todayStr, nextReview, needsReview, calcStreak, buildDailyQueue, shuffle } from "./core.js";
import { getEntry, aiEnrich, toast, $, esc } from "./ui.js";
import { speak } from "./tts.js";

const MAX_DAILY_REPEAT = 3; // 同一张卡当天最多重学次数

const state = {
  settings: null,
  studyRec: null,   // 今日学习记录
  queue: [],        // 复习队列全量
  learnedSet: new Set(), // 所有已学词
  cards: [],        // 今日卡片序列 [{word, kind, stage, times}]
  sessionTotal: 0,  // 会话初始卡片数（进度分母，重学不改变分母）
  index: -1,
  done: 0,
  curEntry: null,   // 当前卡片词条（翻面后）
  flipped: false,
};

/* ================= 初始化 ================= */

export async function initStudy() {
  state.settings = await db.getSettings();

  const [rec, queue, studies, saved] = await Promise.all([
    db.getStudy(todayStr()),
    db.getQueue(),
    db.getAllStudy(),
    db.getAllSaved(),
  ]);
  state.studyRec = rec || { date: todayStr(), learned: [], marks: {}, reviews: [], done: false };
  state.queue = queue;
  state.learnedSet = new Set();
  for (const s of studies) for (const w of s.learned || []) state.learnedSet.add(w);
  for (const q of queue) state.learnedSet.add(q.word);

  // 当日已标记过的词也算学过
  for (const w of state.studyRec.learned || []) state.learnedSet.add(w);

  state.savedLearning = saved.filter((s) => s.status !== "mastered").map((s) => s.word);
  state.savedAll = new Set(saved.map((s) => s.word));

  if (state.studyRec.done) {
    renderDone();
  } else {
    renderOverview();
  }
  await updateStreak();
  return state;
}

/* ================= 组装今日队列 ================= */

async function buildSession() {
  const { dailyCount, customFirst } = state.settings;
  const today = todayStr();
  const dueReviews = state.queue
    .filter((q) => q.due <= today)
    .map((q) => ({ word: q.word, stage: q.stage }));

  // 新词候选：自定义词表（生词本学习中）优先；词典池全量收集后随机抽取
  const candidates = [];
  if (customFirst) {
    for (const w of state.savedLearning) {
      if (!state.learnedSet.has(w) && !candidates.includes(w)) candidates.push(w);
    }
  }
  const dictPool = [];
  for await (const w of dict.iterateWords(0, 60000)) {
    if (!state.learnedSet.has(w) && !state.savedAll.has(w)) dictPool.push(w);
  }
  shuffle(dictPool); // 初始随机：每次会话抽取顺序不同
  candidates.push(...dictPool);

  const q = buildDailyQueue({ newCount: dailyCount, reviewItems: dueReviews, newItems: candidates });
  state.cards = [
    ...q.reviews.map((r) => ({ word: r.word, kind: "review", stage: r.stage ?? 0, times: 0 })),
    ...q.news.map((n) => ({ word: n, kind: "new", stage: 0, times: 0 })),
  ];
  shuffle(state.cards); // 复习与新词混合随机出卡
  state.sessionTotal = state.cards.length;
  return state.cards;
}

/* ================= 会话控制 ================= */

export async function startStudy() {
  await buildSession();
  if (state.cards.length === 0) {
    toast("太棒了！词库已全部学完 🎉");
    return;
  }
  state.index = -1;
  state.done = 0;
  $("btn-start-study").hidden = true;
  $("study-card-wrap").hidden = false;
  $("study-done").hidden = true;
  nextCard();
}

function nextCard() {
  state.index++;
  state.flipped = false;
  state.curEntry = null;

  if (state.index >= state.cards.length) {
    finishSession();
    return;
  }
  const card = state.cards[state.index];
  const el = $("flashcard");
  el.classList.remove("flipped");
  $("study-actions").hidden = true;

  $("study-counter").textContent =
    `第 ${state.index + 1} / ${state.cards.length} 张 · ${card.kind === "review" ? "复习" : "新词"}`;

  // 正面立即显示，背面内容异步加载
  const cached = card.word;
  $("card-word").textContent = cached;
  $("btn-card-audio").dataset.speak = cached; // 🔊 朗读当前单词
  $("btn-card-audio-back").dataset.speak = "";
  $("card-phonetic").textContent = "";
  $("card-pos").textContent = "";
  $("card-cn").textContent = "加载中…";
  $("card-en").textContent = "";
  $("card-example").innerHTML = "";

  // 预取词条（词典/缓存很快；AI 生成则在翻面时按需触发）
  getEntry(cached, { useAI: false }).then((res) => {
    if (state.index < 0 || state.cards[state.index]?.word !== cached) return; // 卡片已切换
    state.curEntry = res.entry;
    if (state.flipped) renderBack(cached);
    else if (res.entry?.phonetic) $("card-phonetic").textContent = res.entry.phonetic;
  });
}

export function flipCard() {
  if (state.flipped) return;
  state.flipped = true;
  $("flashcard").classList.add("flipped");
  const card = state.cards[state.index];
  if (state.curEntry) {
    renderBack(card.word);
    autoSpeak(card.word);
  } else {
    // 词典没有 → 按需 AI 生成
    $("card-cn").textContent = "AI 生成中…";
    $("study-actions").hidden = true;
    loadEntryWithAI(card.word);
  }
}

/** 设置开启"翻面自动朗读"时朗读当前内容 */
async function autoSpeak(word) {
  const settings = await db.getSettings();
  if (!settings.autoSpeak) return;
  const entry = state.curEntry;
  const text = entry?.ex ? `${word}. ${entry.ex}` : word;
  speak(text, { rate: settings.rate || 1 });
}

function renderBack(word) {
  const entry = state.curEntry;
  $("card-pos").textContent = entry?.pos || "";
  $("card-cn").textContent = entry?.cn || "（暂无释义）";
  $("card-en").textContent = entry?.en || "";
  $("card-example").innerHTML = entry?.ex
    ? `<span class="ex-en">${esc(entry.ex)}</span>${entry.ex_cn ? `<span class="ex-cn">${esc(entry.ex_cn)}</span>` : ""}`
    : "";
  // 🔊 背面按钮：朗读单词 + 例句
  $("btn-card-audio-back").dataset.speak = entry?.ex
    ? `${word}. ${entry.ex.replace(/[.!?;:]$/, "")}.`
    : word;
  $("study-actions").hidden = false;

  // 词典有释义但缺例句时，自动用 AI 补充（结果写缓存，不阻塞操作）
  if (entry?.cn && !entry.ex && !state.aiRefreshing?.has(word)) {
    state.aiRefreshing ??= new Set();
    state.aiRefreshing.add(word);
    aiEnrich(entry).then(({ merged, error }) => {
      state.aiRefreshing.delete(word);
      if (error) return;
      if (state.cards[state.index]?.word === word) {
        state.curEntry = merged;
        renderBack(word); // 例句已就绪，重新渲染
      }
    });
  }
}

async function loadEntryWithAI(word) {
  const settings = await db.getSettings();
  if (!settings.aiEnabled || !settings.apiKey) {
    $("card-cn").textContent = "（词典无此词，且未启用 AI）";
    $("study-actions").hidden = false;
    return;
  }
  try {
    const res = await getEntry(word, { useAI: true });
    if (state.cards[state.index]?.word !== word) return;
    state.curEntry = res.entry;
    renderBack(word);
    if (res.source === "ai-error") toast("AI 生成失败：" + (res.error || ""), 3000);
  } catch (err) {
    $("card-cn").textContent = "AI 生成失败";
    $("study-actions").hidden = false;
  }
}

/* ================= 标记 ================= */

export async function markCard(mark) {
  const card = state.cards[state.index];
  if (!card) return;
  const word = card.word;
  const rec = state.studyRec;

  // 记录到今日学习记录
  if (!rec.learned.includes(word)) rec.learned.push(word);
  rec.marks[word] = mark;
  if (!rec.reviews.includes(word) && card.kind === "review") rec.reviews.push(word);

  if (mark === "know") {
    if (card.kind === "review") {
      await db.deleteQueue(word);
      state.queue = state.queue.filter((q) => q.word !== word);
    }
  } else if (needsReview(mark)) {
    // 进入间隔复习队列
    const q = state.queue.find((x) => x.word === word);
    const curStage = card.kind === "review" ? (q?.stage ?? 0) : 0;
    const reset = mark === "forgot" && card.kind === "review";
    const nr = nextReview(reset ? 0 : curStage);
    const item = { word, stage: nr.stage, due: nr.due, lastMark: mark, updatedAt: Date.now() };
    if (q) {
      Object.assign(q, item);
      await db.putQueue(q);
    } else {
      state.queue.push(item);
      await db.putQueue(item);
    }
    // 当天重学（最多 3 次）
    if (card.times < MAX_DAILY_REPEAT) {
      card.times++;
      state.cards.push({ ...card, kind: card.kind, times: card.times });
    }
  }

  state.learnedSet.add(word);
  rec.updatedAt = Date.now();
  await db.putStudy(rec);
  state.done++;
  renderOverview();
  nextCard();
}

/* ================= 完成 / 渲染 ================= */

async function finishSession() {
  const rec = state.studyRec;
  rec.done = true;
  rec.finishedAt = Date.now();
  await db.putStudy(rec);
  renderDone();
  updateStreak();
  toast("今日打卡成功 🎉");
}

/* 「再学一轮」：打卡后继续学习新词 */
export async function studyMore() {
  const rec = state.studyRec;
  rec.done = false; // 允许继续追加
  await db.putStudy(rec);
  $("study-done").hidden = true;
  $("study-overview").hidden = false;
  await startStudy();
}

function renderOverview() {
  const total = state.studyRec.done ? state.studyRec.learned.length : Math.max(state.sessionTotal, state.studyRec.learned.length);
  const done = state.studyRec.done ? total : Math.min(state.done, total);
  $("study-progress-text").textContent = `今日 ${done} / ${total}`;
  $("study-progress-fill").style.width = total ? `${(done / total) * 100}%` : "0%";

  const due = state.queue.filter((q) => q.due <= todayStr()).length;
  $("study-review-info").textContent = due ? `📌 待复习 ${due} 个` : "📌 无待复习";
  $("study-new-info").textContent = `新词 ${state.settings.dailyCount}/天`;

  if (!state.studyRec.done && !state.cards.length && !state.studyRec.learned.length) {
    $("btn-start-study").hidden = false;
  }
  if (state.studyRec.done) {
    $("btn-start-study").hidden = true;
    $("study-card-wrap").hidden = true;
  }
}

async function renderDone() {
  $("study-overview").hidden = true;
  $("study-card-wrap").hidden = true;
  $("btn-start-study").hidden = true;
  const donePanel = $("study-done");
  donePanel.hidden = false;
  const total = (state.studyRec.learned || []).length;
  const counts = Object.values(state.studyRec.marks || {});
  const know = counts.filter((m) => m === "know").length;
  const fuzzy = counts.filter((m) => m === "fuzzy").length;
  const forgot = counts.filter((m) => m === "forgot").length;
  $("done-title").textContent = total > 0
    ? `今日学习完成！认识 ${know} · 模糊 ${fuzzy} · 不认识 ${forgot}`
    : "今日打卡完成！";
  $("done-count").textContent = total;
  const streak = calcStreak(await allDoneDates());
  $("done-streak").textContent = streak;
  $("done-total").textContent = (await db.getAllStudy()).reduce((n, s) => n + (s.learned?.length || 0), 0);
}

async function allDoneDates() {
  const studies = await db.getAllStudy();
  return studies.filter((s) => s.done).map((s) => s.date);
}

/* ================= 头部连续天数 ================= */

export async function updateStreak() {
  const streak = calcStreak(await allDoneDates());
  $("study-streak").textContent = `🔥 连续 ${streak} 天`;
  $("header-sub").textContent = streak > 0 ? `已连续打卡 ${streak} 天，坚持就是胜利！` : "开始今天的单词之旅吧";
}
