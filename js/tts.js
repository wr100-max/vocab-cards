/* ============================================================
 * tts.js — 西语发音（Web Speech API / 系统 TTS）
 * - 自动选择西语语音（优先 es-ES，其次 es-MX/es-419，最后任意 es-*）
 * - 离线可用（系统语音包）；无 TTS 环境（测试/旧浏览器）自动容错
 * - iOS 注意：需用户手势触发（播放按钮天然满足）
 * ============================================================ */

let voices = [];

function loadVoices() {
  if (typeof speechSynthesis === "undefined") return;
  voices = speechSynthesis.getVoices() || [];
}

if (typeof speechSynthesis !== "undefined") {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

/** 选择西语语音；无西语语音时返回 null（调用方降级） */
export function pickSpanishVoice() {
  loadVoices();
  const es = voices.filter((v) => /^es[-_]/.test(v.lang || ""));
  if (es.length === 0) return null;
  return (
    es.find((v) => /es-ES/i.test(v.lang)) ||
    es.find((v) => /es-(MX|419|US)/i.test(v.lang)) ||
    es[0]
  );
}

/** 是否可用西语语音（用于设置页提示） */
export function hasSpanishVoice() {
  return pickSpanishVoice() !== null;
}

/**
 * 朗读文本。返回是否成功发起。
 * @param {string} text 要朗读的文本
 * @param {object} opts {rate: 语速, onEnd: 结束回调}
 */
export function speak(text, { rate = 1, onEnd } = {}) {
  if (typeof speechSynthesis === "undefined" || !text) return false;
  speechSynthesis.cancel(); // 打断上一个发音
  const u = new SpeechSynthesisUtterance(text);
  const v = pickSpanishVoice();
  if (v) u.voice = v;
  u.lang = (v && v.lang) || "es-ES";
  u.rate = rate;
  if (onEnd) u.onend = onEnd;
  speechSynthesis.speak(u);
  return true;
}

/** 停止朗读 */
export function stop() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
