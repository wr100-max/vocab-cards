/* ============================================================
 * stats.js — 统计与设置：数据看板 / 学习设置 / AI 配置 / 数据管理
 * ============================================================ */

import { db, DEFAULT_SETTINGS } from "./db.js";
import { todayStr, weekStart, calcStreak } from "./core.js";
import { hasSpanishVoice } from "./tts.js";
import { toast, $ } from "./ui.js";

let settings = { ...DEFAULT_SETTINGS };

export async function initStats() {
  settings = await db.getSettings();
  // 填充表单
  $("set-daily").value = settings.dailyCount;
  $("set-custom-first").checked = !!settings.customFirst;
  $("set-ai-enabled").checked = settings.aiEnabled !== false;
  $("set-api-key").value = settings.apiKey || "";
  $("set-api-base").value = settings.apiBase || DEFAULT_SETTINGS.apiBase;
  $("set-model").value = settings.model || DEFAULT_SETTINGS.model;
  $("set-auto-speak").checked = !!settings.autoSpeak;
  $("set-rate").value = String(settings.rate ?? 1);
  bindEvents();
  renderAIStatus();
  renderVoiceStatus();
}

function bindEvents() {
  const save = async (key, value) => {
    settings[key] = value;
    await db.setSettings({ [key]: value });
  };
  $("set-daily").addEventListener("change", (e) => {
    let v = Math.min(50, Math.max(5, parseInt(e.target.value, 10) || 20));
    $("set-daily").value = v;
    save("dailyCount", v);
    toast(`每日新词数已设为 ${v}`);
  });
  $("set-custom-first").addEventListener("change", (e) => save("customFirst", e.target.checked));
  $("set-ai-enabled").addEventListener("change", (e) => {
    save("aiEnabled", e.target.checked);
    renderAIStatus();
  });
  $("set-api-key").addEventListener("change", (e) => {
    save("apiKey", e.target.value.trim());
    renderAIStatus();
  });
  // 输入即保存（iOS 软键盘场景不依赖失焦）
  $("set-api-key").addEventListener("input", debounce((e) => {
    save("apiKey", e.target.value.trim());
    renderAIStatus();
  }, 500));
  $("set-api-base").addEventListener("change", (e) => {
    save("apiBase", e.target.value.trim() || DEFAULT_SETTINGS.apiBase);
    renderAIStatus();
  });
  $("set-model").addEventListener("change", (e) => save("model", e.target.value));
  $("set-auto-speak").addEventListener("change", (e) => {
    save("autoSpeak", e.target.checked);
    toast(e.target.checked ? "已开启翻面自动朗读" : "已关闭自动朗读");
  });
  $("set-rate").addEventListener("change", (e) => save("rate", parseFloat(e.target.value)));

  $("btn-export-backup").addEventListener("click", exportBackup);
  $("btn-clear-data").addEventListener("click", clearData);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function renderAIStatus() {
  const key = settings.apiKey || "";
  const enabled = settings.aiEnabled !== false;
  const el = $("ai-status");
  if (!enabled) { el.textContent = "AI 兜底已关闭：查不到的单词将只显示词典结果"; return; }
  if (!key) {
    el.innerHTML = "未填写 API Key。<a href='https://platform.deepseek.com/' target='_blank' rel='noopener'>DeepSeek 开放平台</a> 注册后创建，仅保存在本机浏览器。";
    return;
  }
  el.textContent = `AI 已启用（${settings.model || "deepseek-chat"}）· Key ${key.slice(0, 6)}…${key.slice(-4)}`;
}

function renderVoiceStatus() {
  const el = $("voice-status");
  el.textContent = hasSpanishVoice()
    ? "已检测到西语语音 ✓（系统 TTS，离线可用）"
    : "未检测到西语语音：iPhone 可在 设置 → 辅助功能 → 朗读内容 → 语音 中下载「西班牙语」；期间将使用默认语音兜底";
}

/* ---------- 统计刷新 ---------- */

export async function renderStats() {
  settings = await db.getSettings();
  const [studies, saved] = await Promise.all([db.getAllStudy(), db.getAllSaved()]);
  const today = todayStr();
  const wk = weekStart(today);

  let total = 0, week = 0, todayCount = 0;
  for (const s of studies) {
    const n = (s.learned || []).length;
    total += n;
    if (s.date >= wk) week += n;
    if (s.date === today) todayCount = n;
  }
  const streak = calcStreak(studies.filter((s) => s.done).map((s) => s.date));

  $("stat-today").textContent = todayCount;
  $("stat-streak").textContent = streak;
  $("stat-week").textContent = week;
  $("stat-total").textContent = total;
  $("stat-saved").textContent = saved.length;
  $("stat-mastered").textContent = saved.filter((s) => s.status === "mastered").length;

  // 存储用量
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const used = (est.usage || 0) / 1024 / 1024;
      $("storage-hint").textContent = `已使用存储 ${used.toFixed(1)} MB（含内置词典）`;
    }
  } catch { /* ignore */ }
}

/* ---------- 数据管理 ---------- */

async function exportBackup() {
  const [saved, studies, queue] = await Promise.all([db.getAllSaved(), db.getAllStudy(), db.getQueue()]);
  const backup = {
    app: "vocab-cards",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    savedWords: saved,
    study: studies,
    reviewQueue: queue,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `单词卡备份-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("备份已下载");
}

async function clearData() {
  const sure = confirm("将清空全部学习记录与复习队列（生词本保留）。\n确定继续吗？");
  if (!sure) return;
  const sure2 = confirm("再次确认：学习打卡记录将被清空，无法恢复！");
  if (!sure2) return;
  await db.clear("study");
  await db.clear("reviewQueue");
  toast("学习数据已清空");
  renderStats();
}
