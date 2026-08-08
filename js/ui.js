/* ============================================================
 * ui.js — 通用 UI 工具：Toast、词条获取（词典→缓存→AI）、渲染
 * ============================================================ */

import { db, DEFAULT_SETTINGS } from "./db.js";
import * as dict from "./dict.js";
import { generateWords } from "./ai.js";

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- 词条获取 ---------- */

/**
 * 获取单词完整词条，优先级：IndexedDB 缓存 → 内置词典 → AI 生成（可选）。
 * 返回 {entry, source: "cache"|"dict"|"ai", missing: boolean}
 */
export async function getEntry(word, { useAI = true } = {}) {
  const w = word.toLowerCase().trim();

  const cached = await db.getWord(w);
  if (cached) return { entry: cached, source: cached.source === "ai" ? "ai" : "cache" };

  const dictEntry = await dict.lookup(w);
  if (dictEntry) return { entry: dictEntry, source: "dict" };

  if (useAI) {
    const settings = await db.getSettings();
    if (settings.aiEnabled) {
      try {
        const map = await generateWords([w], settings);
        const entry = map[w];
        if (entry) return { entry, source: "ai" };
      } catch (err) {
        return { entry: null, source: "ai-error", error: err.message };
      }
    }
  }
  return { entry: null, source: "missing" };
}

/**
 * 用 AI 为已有词条补充缺失内容（如例句），结果合并后写回缓存。
 * @returns {Promise<{merged, error?}>}
 */
export async function aiEnrich(entry) {
  const settings = await db.getSettings();
  if (!settings.aiEnabled) return { merged: entry, error: "AI 未启用" };
  if (!settings.apiKey) return { merged: entry, error: "未配置 API Key" };
  try {
    const map = await generateWords([entry.word], settings);
    const ai = map[entry.word];
    if (!ai) return { merged: entry, error: "AI 未返回内容" };
    const merged = {
      ...entry,
      phonetic: entry.phonetic || ai.phonetic,
      pos: entry.pos || ai.pos,
      cn: entry.cn || ai.cn,
      en: entry.en || ai.en,
      ex: entry.ex || ai.ex,
      ex_cn: entry.ex_cn || ai.ex_cn,
      source: entry.source || "ai",
      aiAt: Date.now(),
    };
    await db.putWord(merged);
    return { merged };
  } catch (err) {
    return { merged: entry, error: err.message };
  }
}

/* ---------- 词条 HTML 渲染 ---------- */

/** 渲染词条卡片 HTML（查词页 / 详情弹层共用） */
export function entryHTML(entry, { showWord = false } = {}) {
  const parts = [];
  if (showWord) {
    parts.push(`<button class="audio-btn small" data-speak="${esc(entry.word)}" aria-label="播放发音">🔊</button>`);
    parts.push(`<div class="lookup-word">${esc(entry.word)}</div>`);
  }
  if (entry.phonetic) parts.push(`<span class="lookup-phonetic">${esc(entry.phonetic)}</span>`);
  const pos = entry.pos ? `<div class="lookup-pos">${esc(entry.pos)}</div>` : "";
  const cn = entry.cn ? `<div class="lookup-cn">${esc(entry.cn)}</div>` : "";
  const en = entry.en ? `<div class="lookup-en">${esc(entry.en)}</div>` : "";
  const ex = entry.ex
    ? `<div class="lookup-example"><span class="ex-en">${esc(entry.ex)}</span>${entry.ex_cn ? `<span class="ex-cn">${esc(entry.ex_cn)}</span>` : ""}</div>`
    : "";
  const tag = entry.source === "ai"
    ? `<span class="source-tag ai">AI 生成</span>`
    : `<span class="source-tag dict">词典</span>`;
  return `<div class="lookup-word-row">${parts.join("")}${tag}</div>${pos}${cn}${en}${ex}`;
}

/** 详情弹层 HTML（含学习记录） */
export function detailHTML(saved, entry) {
  const h = [];
  h.push(`<div class="detail-word">${esc(saved.word)}<button class="audio-btn small" data-speak="${esc(saved.word)}" aria-label="播放发音">🔊</button></div>`);
  if (entry) {
    if (entry.phonetic) h.push(`<div class="detail-phonetic">${esc(entry.phonetic)}</div>`);
    if (entry.pos) h.push(`<div class="detail-pos">${esc(entry.pos)}</div>`);
    if (entry.cn) h.push(`<div class="detail-cn">${esc(entry.cn)}</div>`);
    if (entry.en) h.push(`<div class="detail-en">${esc(entry.en)}</div>`);
    if (entry.ex) {
      h.push(`<div class="detail-example"><span class="ex-en">${esc(entry.ex)}</span>${entry.ex_cn ? `<span class="ex-cn">${esc(entry.ex_cn)}</span>` : ""}</div>`);
    }
  } else {
    h.push(`<div class="hint">词典暂无该词条目（AI 生成功能可用于补充）</div>`);
  }
  const state = saved.status === "mastered" ? "已掌握" : "学习中";
  h.push(`<div class="detail-history">添加时间：${new Date(saved.addedAt).toLocaleDateString("zh-CN")}<br>状态：${state}</div>`);
  return h.join("");
}

/* ---------- 工具 ---------- */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export const $ = (id) => document.getElementById(id);
