/* ============================================================
 * dict.js — 内置词典：分片加载 + 查询 + 前缀建议
 * 数据由 build/build_spanish.py 生成（西班牙语 → 英文释义）：
 *   data/dict-index.json   { letters: {a: ["hablar", ...], ...}, count }
 *   data/dict-a.json …     { "hablar": {word, phonetic, pos, cn, en, ex, ex_cn}, ... }
 * 支持西语字符（含重音 áéíóúüñ）。
 * ============================================================ */

const INDEX_URL = "data/dict-index.json";
const shardCache = new Map(); // 字母 -> 词条 Map
let indexData = null;         // {letters, count}
let indexPromise = null;

/** 词头合法字符（西语 + 撇号连字符） */
const WORD_CHARS = "a-záéíóúüñ";
const WORD_RE = new RegExp(`^[${WORD_CHARS}]+(?:['-][${WORD_CHARS}]+)*$`, "i");
const PREFIX_RE = new RegExp(`^[${WORD_CHARS}]+$`, "i");

/** 去重音（用于无重音输入的容错匹配） */
function stripAccent(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** 词头 -> 分片字母（数字/符号/重音首字母开头归 "0"） */
function shardOf(word) {
  const ch = word[0];
  return /^[a-z]$/.test(ch) ? ch : "0";
}

export function loadIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = fetch(INDEX_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`词典索引加载失败 (${r.status})`);
      return r.json();
    })
    .then((data) => {
      indexData = data;
      return data;
    });
  return indexPromise;
}

/** 加载某个分片并返回该分片词条 Map */
async function loadShard(letter) {
  if (shardCache.has(letter)) return shardCache.get(letter);
  const resp = await fetch(`data/dict-${letter}.json`);
  if (!resp.ok) throw new Error(`词典分片加载失败: ${letter} (${resp.status})`);
  const obj = await resp.json();
  const map = new Map(Object.entries(obj));
  shardCache.set(letter, map);
  return map;
}

/** 判断词典中是否存在该词（不加载词条内容） */
export async function hasWord(word) {
  const w = word.toLowerCase();
  await loadIndex();
  const list = indexData.letters[shardOf(w)];
  return !!list && list.includes(w);
}

/** 精确查询一个单词的词典词条（未收录返回 null；无重音输入自动容错匹配） */
export async function lookup(word) {
  const w = word.toLowerCase().trim();
  if (!WORD_RE.test(w) || w.length < 2) return null;
  if (!(await hasWord(w))) return null;
  const map = await loadShard(shardOf(w));
  if (map.has(w)) return map.get(w);
  // 容错：用户漏打重音（está 打成 esta 时反向匹配）
  if (/[áéíóúüñ]/.test(w) === false) {
    for (const [k, v] of map) {
      if (k !== w && stripAccent(k) === w) return v;
    }
  }
  return null;
}

/** 前缀建议：返回最多 limit 个以 prefix 开头（或去重音匹配）的词头 */
export async function suggest(prefix, limit = 6) {
  const p = prefix.toLowerCase().trim();
  if (!p || !PREFIX_RE.test(p)) return [];
  await loadIndex();
  const list = indexData.letters[shardOf(p)] || [];
  const out = [];
  for (const w of list) {
    if (w.startsWith(p) || stripAccent(w).startsWith(p)) out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

/** 词典规模信息（显示用） */
export async function dictInfo() {
  await loadIndex();
  return { count: indexData.count };
}

/** 按词典频率顺序遍历词头（背单词新词池候选），步进式分批取 */
export async function *iterateWords(start = 0, batch = 500) {
  await loadIndex();
  const letters = "abcdefghijklmnopqrstuvwxyz0";
  let i = start;
  for (const letter of letters) {
    const list = indexData.letters[letter] || [];
    for (const w of list) {
      if (i-- > 0) continue;
      yield w;
      if (--batch <= 0) return;
    }
  }
}

/* ---------- 词典缓存（页面层主动缓存，带进度显示） ---------- */

/** 找到当前 Service Worker 版本的缓存（vocab-vN 中数字最大的） */
async function currentCache() {
  if (typeof caches === "undefined") return null;
  try {
    const keys = await caches.keys();
    const name = keys
      .filter((k) => /^vocab-v\d+$/.test(k))
      .sort((a, b) => parseInt(b.split("v")[1], 10) - parseInt(a.split("v")[1], 10))[0];
    return name ? await caches.open(name) : null;
  } catch {
    return null;
  }
}

/**
 * 确保全部词典分片已缓存（未缓存的分片逐个下载并写入 SW 缓存）。
 * @param onProgress (done, total) => void  每个文件完成后回调
 * @returns {Promise<{total: number, failed: number}>}
 */
export async function ensureDictCached(onProgress) {
  const info = await loadIndex();
  const files = [
    "data/dict-index.json",
    "data/common-100.json",
    ...Object.keys(info.letters).map((s) => `data/dict-${s}.json`),
  ];
  const total = files.length;
  const cache = await currentCache();
  let done = 0, failed = 0;

  // 无缓存容器（不支持 Cache API 或 SW 未安装）时跳过：词典按需加载即可
  if (!cache) {
    onProgress?.(total, total);
    return { total, failed: 0 };
  }

  for (const f of files) {
    const url = new URL(f, location.href).href;
    // 已缓存则跳过（秒过）
    if (cache) {
      try {
        if (await cache.match(url)) {
          done++;
          onProgress?.(done, total);
          continue;
        }
      } catch { /* 继续下载 */ }
    }
    try {
      // 单文件 10 秒超时：网络不稳时快速跳过，避免拖慢整体缓存
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok && cache) await cache.put(url, resp.clone());
      if (!resp.ok) failed++;
    } catch {
      failed++; // 单个失败不中断：按需加载会兜底
    }
    done++;
    onProgress?.(done, total);
  }
  return { total, failed };
}
