/* Service Worker：缓存应用外壳，支持离线使用。
 * 词典数据（3.5MB）由页面层主动缓存并显示进度（js/dict.js ensureDictCached），
 * SW 只负责外壳，安装快、不易被 iOS 中断。 */
const VERSION = "vocab-v9"; // v9：修复残留学习记录导致开始按钮消失的死锁

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/dict.js",
  "./js/ai.js",
  "./js/study.js",
  "./js/ui.js",
  "./js/core.js",
  "./js/saved.js",
  "./js/stats.js",
  "./js/tts.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // 逐个顺序缓存并容错：iOS Safari 在切后台/锁屏时会中断长连接（BrokenPipe），
      // 单个文件失败不阻塞安装；未缓存的分片由运行时"缓存优先+网络补齐"策略兜底
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch {
          /* 忽略单个失败，继续后续 */
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 词典数据分片：缓存优先，后台更新
  if (url.pathname.includes("/data/dict-")) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        const fetched = fetch(e.request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(VERSION).then((c) => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => hit);
        return hit || fetched;
      })
    );
    return;
  }
  // 外壳：网络优先，失败回退缓存
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("./index.html"))
    );
    return;
  }
  // 静态资源：缓存优先
  if (e.request.method === "GET" && e.request.url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request))
    );
  }
});
