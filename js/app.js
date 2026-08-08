/* ============================================================
 * app.js — 入口：Service Worker 注册、Tab 路由、查词页
 * ============================================================ */

import { db, DEFAULT_SETTINGS, getSettingsSync } from "./db.js";
import * as dict from "./dict.js";
import * as study from "./study.js";
import * as savedPage from "./saved.js";
import * as statsPage from "./stats.js";
import { getEntry, entryHTML, toast, $, esc } from "./ui.js";
import { speak, hasSpanishVoice } from "./tts.js";

let voiceHintShown = false;

/* ---------- 启动 ---------- */

async function boot() {
  // Service Worker（PWA 离线）；?nosw=1 可跳过（开发调试用）
  if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("nosw")) {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* 本地 http 环境允许失败 */ });
  }

  bindTabs();
  bindModalClose();
  bindLookup();
  bindAudio();   // 🔊 全局委托最先绑定：即使后续绑定异常也不受影响
  bindStudy();

  try {
    await dict.loadIndex();
  } catch (err) {
    toast("内置词典加载失败，请检查网络（首次使用需要联网加载词典数据）", 4000);
  }

  // 词典分片缓存：后台并行执行（不阻塞主流程，按钮立即可用）；进度条实时显示，失败可重试
  cacheDictWithProgress();

  await Promise.all([study.initStudy(), savedPage.initSaved(), statsPage.initStats()]);

  // 词典规模展示在副标题
  try {
    const info = await dict.dictInfo();
    $("header-sub").textContent += ` · 内置词典 ${(info.count / 1000).toFixed(1)}k 词`;
  } catch { /* ignore */ }
}

/* ---------- Tab 路由 ---------- */

const TAB_TITLES = { study: "背单词", lookup: "查词", saved: "生词本", stats: "统计·设置" };

function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

async function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${name}`));
  $("header-title").textContent = TAB_TITLES[name];

  if (name === "study") await study.initStudy();
  if (name === "lookup") setTimeout(() => $("lookup-input").focus(), 60);
  if (name === "saved") await savedPage.reloadSaved();
  if (name === "stats") await statsPage.renderStats();
}

/* ---------- 词典缓存进度 ---------- */

async function cacheDictWithProgress() {
  const box = $("dict-progress");
  const fill = $("dict-progress-fill");
  const text = $("dict-progress-text");

  const run = async () => {
    box.classList.remove("error");
    box.hidden = false;
    fill.style.width = "0%";
    try {
      // 首次安装时等 SW 激活（最多 5 秒），确保有缓存容器可用
      if ("serviceWorker" in navigator) {
        await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise((r) => setTimeout(r, 5000)),
        ]);
      }
    } catch { /* ignore */ }
    const { total, failed } = await dict.ensureDictCached((done, total) => {
      fill.style.width = `${(done / total) * 100}%`;
      text.textContent = `词典缓存 ${done}/${total}`;
    });
    if (failed > 0) {
      box.classList.add("error");
      text.textContent = `词典缓存未完成（${failed} 个文件失败），点此重试`;
    } else {
      // 完成停留片刻，让用户看到"就绪"状态再隐藏
      text.textContent = `词典就绪 ${total}/${total} ✅`;
      setTimeout(() => { box.hidden = true; }, 800);
    }
  };
  box.addEventListener("click", run); // 失败时点击重试
  await run();
}

/* ---------- 发音事件（全局委托） ---------- */

function bindAudio() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-speak]");
    if (!btn || !btn.dataset.speak) return;
    e.stopPropagation(); // 不触发卡片翻面
    // 同步调用 speak（iOS 要求手势同步栈内发声），语速走内存镜像，无异步
    const ok = speak(btn.dataset.speak, { rate: getSettingsSync().rate || 1 });
    if (!ok) {
      toast("当前设备不支持发音");
    } else if (!hasSpanishVoice() && !voiceHintShown) {
      voiceHintShown = true;
      toast("未检测到西语语音包，发音可能不准；可在 iPhone 设置 → 辅助功能 → 朗读内容 → 语音 中下载", 4000);
    }
  });
}

/* ---------- 背单词事件 ---------- */

function bindStudy() {
  // 防御：元素缺失（新旧缓存混合期）时不中断后续绑定
  $("btn-start-study")?.addEventListener("click", () => study.startStudy());
  $("btn-study-more")?.addEventListener("click", () => study.studyMore());
  $("flashcard")?.addEventListener("click", () => study.flipCard());
  $("btn-know")?.addEventListener("click", () => study.markCard("know"));
  $("btn-fuzzy")?.addEventListener("click", () => study.markCard("fuzzy"));
  $("btn-forgot")?.addEventListener("click", () => study.markCard("forgot"));
  // 互动答题：拼写题控制
  $("btn-spell-skip")?.addEventListener("click", () => study.spellSkip());
  $("btn-spell-clear")?.addEventListener("click", () => study.resetSpell());
  $("btn-spell-confirm")?.addEventListener("click", () => study.spellConfirm());
}

/* ---------- 弹层关闭 ---------- */

function bindModalClose() {
  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => el.closest(".modal").hidden = true);
  });
}

/* ---------- 查词页 ---------- */

let lookupAbort = null;

function bindLookup() {
  const form = $("lookup-form");
  const input = $("lookup-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    doLookup(input.value);
  });

  // 输入建议（datalist，iOS 15.4+ 支持；不支持则无建议，不影响功能）
  const dl = document.createElement("datalist");
  dl.id = "word-suggest";
  input.setAttribute("list", "word-suggest");
  document.body.appendChild(dl);
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const v = input.value.trim();
    if (!/^[a-zA-Záéíóúüñ]{2,}$/.test(v)) { dl.innerHTML = ""; return; }
    t = setTimeout(async () => {
      try {
        const words = await dict.suggest(v, 6);
        dl.innerHTML = words.map((w) => `<option value="${esc(w)}">`).join("");
      } catch { /* ignore */ }
    }, 150);
  });
}

async function doLookup(raw) {
  const word = raw.trim().toLowerCase();
  if (!/^[a-záéíóúüñ][a-záéíóúüñ'-]*$/.test(word) || word.length < 2) {
    toast("请输入有效的西班牙语单词");
    return;
  }
  const box = $("lookup-result");
  $("lookup-empty").hidden = true;
  box.innerHTML = `<div class="card" style="text-align:center;color:var(--text-sub)">查询中…</div>`;

  const res = await getEntry(word, { useAI: true });

  if (res.source === "ai-error") {
    const fallback = await getEntry(word, { useAI: false });
    if (fallback.entry) return renderLookupResult(word, fallback.entry, res.error);
    box.innerHTML = `
      <div class="card">
        <div class="lookup-word-row"><div class="lookup-word">${esc(word)}</div></div>
        <div class="ai-note"><span class="err">AI 生成失败：${esc(res.error || "未知错误")}</span><br>可在「统计 → AI 生成」中检查 API Key 配置。</div>
        <div class="lookup-actions">
          <button id="btn-retry-ai" class="btn btn-primary">重试 AI 生成</button>
          <button id="btn-save-raw" class="btn">收藏到生词本</button>
        </div>
      </div>`;
    $("btn-retry-ai").onclick = () => doLookup(word);
    $("btn-save-raw").onclick = () => saveToBook(word, null);
    return;
  }

  if (!res.entry) {
    box.innerHTML = `
      <div class="card">
        <div class="lookup-word-row"><div class="lookup-word">${esc(word)}</div></div>
        <div class="ai-note">内置词典未收录「${esc(word)}」。启用 AI 后将自动生成释义，也可先收藏，背单词时会补充。</div>
        <div class="lookup-actions">
          <button id="btn-save-raw" class="btn btn-primary">收藏到生词本</button>
        </div>
      </div>`;
    $("btn-save-raw").onclick = () => saveToBook(word, null);
    return;
  }

  renderLookupResult(word, res.entry);
}

function renderLookupResult(word, entry, aiError) {
  const box = $("lookup-result");
  box.innerHTML = `
    <div class="card lookup-card">
      ${entryHTML(entry, { showWord: true })}
      ${aiError ? `<div class="ai-note"><span class="err">AI 补充失败：${esc(aiError)}</span></div>` : ""}
      <div class="lookup-actions">
        <button id="btn-save" class="btn btn-primary">收藏</button>
        <button id="btn-regenerate" class="btn">换 AI 例句</button>
      </div>
    </div>`;

  $("btn-save").onclick = async () => {
    const done = await saveToBook(word, entry);
    if (done) toast("已收藏到生词本 📚");
  };
  $("btn-regenerate").textContent = entry.ex ? "换 AI 例句" : "AI 生成例句";
  $("btn-regenerate").onclick = () => regenerateExample(word, entry);
}

/** 收藏到生词本；已存在时提示 */
async function saveToBook(word, entry) {
  const existing = await db.getSaved(word);
  if (existing) {
    toast("已在生词本中");
    return false;
  }
  await db.saveWord({
    word,
    addedAt: Date.now(),
    source: "lookup",
    status: "learning",
    cn: entry?.cn || "",
  });
  await savedPage.reloadSaved();
  return true;
}

/** 换 AI 例句：保留词典释义，仅重新生成例句 */
async function regenerateExample(word, entry) {
  const settings = await db.getSettings();
  if (!settings.aiEnabled || !settings.apiKey) {
    toast("需要先配置 DeepSeek API Key（统计 → AI 生成）");
    return;
  }
  const btn = $("btn-regenerate");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    const { generateWords } = await import("./ai.js");
    const map = await generateWords([word], settings);
    const aiEntry = map[word];
    if (aiEntry) {
      const merged = {
        ...entry,
        ex: aiEntry.ex || entry.ex,
        ex_cn: aiEntry.ex_cn || entry.ex_cn,
        source: entry.source,
      };
      await db.putWord(merged);
      renderLookupResult(word, merged);
      toast("已更新例句 ✨");
    } else {
      toast("AI 未返回结果");
    }
  } catch (err) {
    toast("AI 生成失败：" + err.message, 3500);
  } finally {
    btn.disabled = false;
    btn.textContent = "换 AI 例句";
  }
}

/* ---------- 启动 ---------- */

window.addEventListener("DOMContentLoaded", boot);
