/* ============================================================
 * saved.js — 生词本：列表 / 搜索 / 筛选 / 详情 / 添加 / 导出
 * ============================================================ */

import { db } from "./db.js";
import { getEntry, detailHTML, toast, $, esc } from "./ui.js";

let list = [];
let filter = "all";
let query = "";

export async function initSaved() {
  list = await db.getAllSaved();
  list.sort((a, b) => b.addedAt - a.addedAt);
  bindEvents();
  render();
}

function bindEvents() {
  $("saved-search").addEventListener("input", (e) => {
    query = e.target.value.trim().toLowerCase();
    render();
  });
  document.querySelectorAll("#saved-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#saved-filters .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      filter = chip.dataset.filter;
      render();
    });
  });
  $("btn-add-word").addEventListener("click", () => {
    $("add-words-input").value = "";
    $("add-modal").hidden = false;
  });
  $("btn-add-confirm").addEventListener("click", addWords);
  $("btn-saved-export").addEventListener("click", exportData);
  $("btn-import-common").addEventListener("click", importCommonWords);
}

/** 导入 100 个最高频常用西语词（data/common-100.json），跳过已存在的 */
async function importCommonWords() {
  let words;
  try {
    const resp = await fetch("data/common-100.json");
    if (!resp.ok) throw new Error(resp.status);
    words = await resp.json();
  } catch {
    toast("常用词包加载失败，请检查网络");
    return;
  }
  const now = Date.now();
  let added = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const existing = await db.getSaved(w.word);
    if (existing) continue;
    await db.saveWord({
      word: w.word,
      addedAt: now + i,
      source: "import",
      status: "learning",
      cn: w.cn || "",
    });
    added++;
  }
  toast(added > 0 ? `已导入 ${added} 个常用词 📚` : "常用词都已在生词本中");
  await reloadSaved();
}

function visible() {
  return list.filter((s) => {
    if (filter === "learning" && s.status === "mastered") return false;
    if (filter === "mastered" && s.status !== "mastered") return false;
    if (query && !s.word.includes(query)) return false;
    return true;
  });
}

export function render() {
  const items = visible();
  const box = $("saved-list");
  $("saved-empty").hidden = items.length > 0;
  box.innerHTML = items.map((s) => `
    <div class="word-item" data-word="${esc(s.word)}">
      <div class="wi-main">
        <div class="wi-word">${esc(s.word)}</div>
        <div class="wi-cn">${esc((s.cn || "").slice(0, 40)) || "（暂无释义）"}</div>
      </div>
      <div class="wi-meta">
        <span class="wi-state ${s.status === "mastered" ? "mastered" : "learning"}">${s.status === "mastered" ? "已掌握" : "学习中"}</span>
        <div>${new Date(s.addedAt).toLocaleDateString("zh-CN")}</div>
      </div>
    </div>`).join("");

  box.querySelectorAll(".word-item").forEach((el) => {
    el.addEventListener("click", () => showDetail(el.dataset.word));
  });
}

async function showDetail(word) {
  const saved = list.find((s) => s.word === word);
  if (!saved) return;
  const res = await getEntry(word, { useAI: false });
  const entry = res.entry || {
    word, source: "dict",
    phonetic: "", pos: "", cn: saved.cn || "", en: "", ex: "", ex_cn: "",
  };
  $("detail-body").innerHTML = detailHTML(saved, entry);
  $("detail-modal").hidden = false;

  $("btn-detail-master").textContent = saved.status === "mastered" ? "标记为学习中" : "标记已掌握";
  $("btn-detail-master").onclick = async () => {
    saved.status = saved.status === "mastered" ? "learning" : "mastered";
    await db.saveWord(saved);
    toast(saved.status === "mastered" ? "已标记为掌握 🎉" : "已恢复为学习中");
    $("detail-modal").hidden = true;
    list = await db.getAllSaved();
    list.sort((a, b) => b.addedAt - a.addedAt);
    render();
  };
  $("btn-detail-delete").onclick = async () => {
    if (!confirm(`确定从生词本删除「${word}」？`)) return;
    await db.deleteSaved(word);
    toast("已删除");
    $("detail-modal").hidden = true;
    list = await db.getAllSaved();
    list.sort((a, b) => b.addedAt - a.addedAt);
    render();
  };
}

async function addWords() {
  const raw = $("add-words-input").value;
  const words = [...new Set(raw.split(/[\s,，;；]+/).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-záéíóúüñ][a-záéíóúüñ'-]*$/.test(w)))];
  if (words.length === 0) { toast("没有有效的单词输入"); return; }

  const now = Date.now();
  for (const w of words) {
    const existing = await db.getSaved(w);
    if (existing) continue;
    await db.saveWord({ word: w, addedAt: now + words.indexOf(w), source: "manual", status: "learning" });
  }
  toast(`已添加 ${words.length} 个生词`);
  $("add-modal").hidden = true;
  list = await db.getAllSaved();
  list.sort((a, b) => b.addedAt - a.addedAt);
  render();
}

/* ---------- 导出 ---------- */

async function exportData() {
  const saved = await db.getAllSaved();
  if (saved.length === 0) { toast("生词本为空"); return; }
  const lines = saved.map((s) => `${s.word}\t${s.cn || ""}\t${s.status}\t${new Date(s.addedAt).toLocaleDateString("zh-CN")}`);
  const text = "单词\t释义\t状态\t添加日期\n" + lines.join("\n");
  const picker = confirm("复制为文本？\n（确定 = 复制，取消 = 下载 CSV 文件）");
  if (picker) {
    await navigator.clipboard.writeText(text).catch(() => {});
    toast("已复制到剪贴板");
  } else {
    const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `生词本-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已下载 CSV");
  }
}

export async function reloadSaved() {
  list = await db.getAllSaved();
  list.sort((a, b) => b.addedAt - a.addedAt);
  render();
}
