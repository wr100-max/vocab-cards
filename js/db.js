/* ============================================================
 * db.js — IndexedDB 封装
 * stores:
 *   words        keyPath: word   词典词条缓存（dict 或 AI 生成）
 *   savedWords   keyPath: word   生词本
 *   study        keyPath: date   每日学习记录
 *   reviewQueue  keyPath: word   间隔复习队列
 *   settings     keyPath: key    设置
 * ============================================================ */

const DB_NAME = "vocab-cards";
const DB_VERSION = 2; // v2：数据源切换为西班牙语词典，旧数据自动清空

const STORES = {
  words: { keyPath: "word", indexes: [{ name: "source", keyPath: "source" }] },
  savedWords: { keyPath: "word", indexes: [{ name: "addedAt", keyPath: "addedAt" }] },
  study: { keyPath: "date" },
  reviewQueue: { keyPath: "word" },
  settings: { keyPath: "key" },
};

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // 数据源或结构变更时清空旧数据（如 v1 英语词典缓存 → v2 西语词典）
      // 注意：objectStoreNames 是 live 集合，须先复制再迭代删除
      if (e.oldVersion > 0) {
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      }
      for (const [name, def] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: def.keyPath });
          for (const idx of def.indexes || []) {
            store.createIndex(idx.name, idx.keyPath);
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  /* ---------- 通用 ---------- */
  async put(store, value) {
    return promisify((await tx(store, "readwrite")).put(value));
  },
  async get(store, key) {
    const storeObj = await tx(store, "readonly");
    return promisify(storeObj.get(key));
  },
  async getAll(store) {
    return promisify((await tx(store, "readonly")).getAll());
  },
  async delete(store, key) {
    return promisify((await tx(store, "readwrite")).delete(key));
  },
  async clear(store) {
    return promisify((await tx(store, "readwrite")).clear());
  },
  async bulkPut(store, values) {
    const t = await tx(store, "readwrite");
    for (const v of values) t.put(v);
    return new Promise((resolve, reject) => {
      t.transaction.oncomplete = resolve;
      t.transaction.onerror = () => reject(t.transaction.error);
    });
  },

  /* ---------- 词条缓存 ---------- */
  getWord: (word) => db.get("words", word.toLowerCase()),
  putWord: (entry) => db.put("words", entry),
  bulkPutWords: (entries) => db.bulkPut("words", entries),

  /* ---------- 生词本 ---------- */
  getSaved: (word) => db.get("savedWords", word.toLowerCase()),
  getAllSaved: () => db.getAll("savedWords"),
  saveWord: (entry) => db.put("savedWords", entry),
  deleteSaved: (word) => db.delete("savedWords", word.toLowerCase()),
  clearSaved: () => db.clear("savedWords"),

  /* ---------- 学习记录 ---------- */
  getStudy: (date) => db.get("study", date),
  getAllStudy: () => db.getAll("study"),
  putStudy: (rec) => db.put("study", rec),

  /* ---------- 复习队列 ---------- */
  getQueue: () => db.getAll("reviewQueue"),
  putQueue: (item) => db.put("reviewQueue", item),
  deleteQueue: (word) => db.delete("reviewQueue", word.toLowerCase()),
  clearQueue: () => db.clear("reviewQueue"),

  /* ---------- 设置 ---------- */
  async getSettings() {
    const all = await db.getAll("settings");
    const map = {};
    for (const { key, value } of all) map[key] = value;
    const merged = { ...DEFAULT_SETTINGS, ...map };
    _settingsMirror = merged;
    mirrorSync();
    return merged;
  },
  async setSettings(patch) {
    for (const [key, value] of Object.entries(patch)) {
      await db.put("settings", { key, value });
    }
    _settingsMirror = { ...(_settingsMirror || DEFAULT_SETTINGS), ...patch };
    mirrorSync();
  },
  async clearSettings() {
    await db.clear("settings");
  },
};

// 设置的内存 + localStorage 镜像：供手势同步上下文（iOS TTS 要求）读取
let _settingsMirror = null;

function mirrorSync() {
  try {
    localStorage.setItem("vocab-settings", JSON.stringify(_settingsMirror || {}));
  } catch { /* ignore */ }
}

/** 同步读取设置（无异步，供 iOS 手势内同步调用 TTS 使用） */
export function getSettingsSync() {
  if (_settingsMirror) return _settingsMirror;
  try {
    const raw = localStorage.getItem("vocab-settings");
    if (raw) {
      _settingsMirror = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      return _settingsMirror;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export const DEFAULT_SETTINGS = {
  dailyCount: 20,          // 每日新词数
  customFirst: false,      // 自定义词表优先
  quizMode: true,          // 互动答题模式（默认开启，可切回经典翻卡）
  aiEnabled: true,         // AI 兜底开关
  apiKey: "",              // DeepSeek API key（仅存本地）
  apiBase: "https://api.deepseek.com", // API 地址
  model: "deepseek-chat",  // 模型
  autoSpeak: false,        // 翻面自动朗读
  rate: 1,                 // 语速（0.75 慢 / 1 正常 / 1.25 快）
};
