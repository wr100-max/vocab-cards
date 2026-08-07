/* core.js 纯逻辑单元测试 */
import assert from "node:assert/strict";
import {
  todayStr, addDays, weekStart, nextReview, needsReview,
  calcStreak, buildDailyQueue, shuffle, REVIEW_INTERVALS,
} from "../js/core.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("core.js 测试");

/* ---- 日期工具 ---- */
ok("todayStr 返回 YYYY-MM-DD", () => {
  assert.match(todayStr(new Date(2026, 7, 7)), /^\d{4}-\d{2}-\d{2}$/);
});
ok("addDays 跨月偏移", () => {
  assert.equal(addDays("2026-08-07", 1), "2026-08-08");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});
ok("weekStart 周一为一周起点", () => {
  assert.equal(weekStart("2026-08-05"), "2026-08-03"); // 周三 → 周一
  assert.equal(weekStart("2026-08-03"), "2026-08-03"); // 周一 → 自己
});

/* ---- 复习调度 ---- */
ok("nextReview 阶段递进 1/2/4/7 天", () => {
  assert.equal(nextReview(0).stage, 1);
  assert.equal(nextReview(0).due, addDays(todayStr(), 1));
  assert.equal(nextReview(1).due, addDays(todayStr(), 2));
  assert.equal(nextReview(2).due, addDays(todayStr(), 4));
  assert.equal(nextReview(3).due, addDays(todayStr(), 7));
});
ok("nextReview 阶段封顶", () => {
  const top = nextReview(REVIEW_INTERVALS.length - 1);
  assert.equal(top.stage, REVIEW_INTERVALS.length); // 封顶在最大间隔阶段
  assert.equal(top.due, addDays(todayStr(), 30));
});
ok("needsReview 判定", () => {
  assert.equal(needsReview("know"), false);
  assert.equal(needsReview("fuzzy"), true);
  assert.equal(needsReview("forgot"), true);
});

/* ---- 连续打卡 ---- */
ok("calcStreak 连续打卡计数", () => {
  const dates = ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
  assert.equal(calcStreak(dates, "2026-08-07"), 4);
});
ok("calcStreak 今天未打卡时从昨天数", () => {
  const dates = ["2026-08-05", "2026-08-06"];
  assert.equal(calcStreak(dates, "2026-08-07"), 2);
});
ok("calcStreak 中断后从新连续段计数", () => {
  const dates = ["2026-08-01", "2026-08-02", "2026-08-05", "2026-08-06"];
  assert.equal(calcStreak(dates, "2026-08-06"), 2);
});
ok("calcStreak 无记录为 0", () => {
  assert.equal(calcStreak([], "2026-08-07"), 0);
});

/* ---- 每日队列 ---- */
ok("buildDailyQueue 复习优先占满配额", () => {
  const news = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const q = buildDailyQueue({ newCount: 10, reviewItems: [{ word: "a" }, { word: "b" }], newItems: news });
  assert.equal(q.reviews.length, 2);
  assert.equal(q.news.length, 8); // 10 - 2
  assert.equal(q.total, 10);
});
ok("buildDailyQueue 复习数超配额时截断", () => {
  const reviews = Array.from({ length: 15 }, (_, i) => ({ word: `w${i}` }));
  const q = buildDailyQueue({ newCount: 10, reviewItems: reviews, newItems: ["x"] });
  assert.equal(q.reviews.length, 10);
  assert.equal(q.news.length, 0);
  assert.equal(q.total, 10);
});
ok("buildDailyQueue 无复习时全为新词", () => {
  const q = buildDailyQueue({ newCount: 5, reviewItems: [], newItems: ["a", "b", "c"] });
  assert.equal(q.news.length, 3);
  assert.equal(q.total, 3);
});

/* ---- 随机洗牌 ---- */
ok("shuffle 保留全部元素（排列变换）", () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = [...arr];
  shuffle(arr);
  assert.deepEqual([...arr].sort((a, b) => a - b), copy);
});
ok("shuffle 结果随机（多次洗牌不总相同）", () => {
  const sigs = new Set();
  for (let i = 0; i < 20; i++) {
    const arr = [1, 2, 3, 4, 5, 6];
    shuffle(arr);
    sigs.add(arr.join(","));
  }
  assert.ok(sigs.size > 1, "20 次洗牌应有多种排列");
});
ok("shuffle 空数组与单元素安全", () => {
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle([42]), [42]);
});

console.log(`\n全部通过：${passed} 项`);
