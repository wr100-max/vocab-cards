#!/usr/bin/env python3
"""从 doozan/spanish_data 构建西班牙语→英文释义词典数据（data/ 目录）。

数据源（CC BY-SA / CC BY 许可的开源数据）：
- es-en.data        Wiktionary 西语词条（英文释义 glosses）
- es_merged_50k.txt 西语高频词频率表（SubLex/语料统计）
- sentences.tsv     Tatoeba 西英双语例句

保留策略：高频前 15000 词，去掉纯标点/非常用词形；每条含
词头、词性、英文释义、西语例句（如有）+ 例句英文翻译。

输出：data/dict-index.json + data/dict-{letter}.json（非 a-z 首字母归 dict-0.json）
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = "/tmp"
OUT_DIR = os.path.join(BASE, "data")

WORD_RE = re.compile(r"^[a-záéíóúüñ]+(?:[-'][a-záéíóúüñ]+)*$", re.IGNORECASE)
TOKEN_RE = re.compile(r"[a-záéíóúüñ]+", re.IGNORECASE)

# Wiktionary pos -> 前端英文缩写标注
POS_MAP = {
    "n": "n.", "v": "v.", "adj": "adj.", "adv": "adv.", "interj": "interj.",
    "pron": "pron.", "conj": "conj.", "prep": "prep.", "art": "art.",
    "num": "num.", "prop": "prop.", "phrase": "phrase", "suffix": "suffix",
    "prefix": "prefix", "part": "part.", "det": "det.", "contraction": "contr.",
}
TARGET_COUNT = 15000


def parse_dict(path):
    """解析 es-en.data → {word: {"pos": [str], "glosses": [str]}}
    pos 收集全部词性段（Wiktionary 多词性词条首段不可靠，如 la 首段是 n.）。"""
    entries = {}
    with open(path, encoding="utf-8") as f:
        blocks = f.read().split("_____\n")
    for b in blocks:
        lines = b.split("\n")
        if not lines or not lines[0]:
            continue
        word = lines[0].strip().lower()
        if not WORD_RE.match(word):
            continue
        pos = []
        glosses = []
        for ln in lines[1:]:
            if ln.startswith("pos:"):
                pos.append(POS_MAP.get(ln[4:].strip(), ln[4:].strip() or ""))
            elif ln.startswith("  gloss:"):
                g = ln[8:].strip()
                # 只排除空与 Wiktionary 结构模板，其余（含 archaic/inflection 说明）均为有效英文释义
                if g and not g.startswith("{{"):
                    glosses.append(g)
        if not glosses:
            continue
        entries[word] = {"pos": pos, "glosses": glosses}
    return entries


def load_freq(path, n=TARGET_COUNT):
    """频率表 → 有序词列表（过滤无效词形）"""
    words = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            w = (parts[0] or "").strip().lower()
            if WORD_RE.match(w):
                words.append(w)
            if len(words) >= n:
                break
    return words


def load_lemma_map(path):
    """frequency.csv 的 usage 字段 → {表面形式: 词头}（动词变位/性数变化归一化）"""
    import csv as _csv
    form_lemma = {}
    with open(path, encoding="utf-8", newline="") as f:
        for row in _csv.DictReader(f):
            lemma = (row.get("spanish") or "").strip().lower()
            if not lemma:
                continue
            for item in (row.get("usage") or "").split("|"):
                parts = item.split(":")
                if len(parts) == 2 and parts[1]:
                    form = parts[1].strip().lower()
                    if WORD_RE.match(form) and form != lemma:
                        form_lemma.setdefault(form, lemma)
    return form_lemma


def build_examples(path, target_words):
    """sentences.tsv → {word: {"ex": 西语句, "ex_cn": 英语句}}
    每词取最短且包含该词的句对；仅处理目标词，控制内存。"""
    targets = set(target_words)
    found = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                continue
            en_s, es_s = parts[0].strip(), parts[1].strip()
            if not es_s or len(es_s) > 90 or not en_s:
                continue
            for tok in TOKEN_RE.findall(es_s):
                w = tok.lower()
                if w in targets and w not in found:
                    found[w] = {"ex": es_s, "ex_cn": en_s}
                    targets.discard(w)  # 每个词只需一个例句
                    break
            if not targets:
                break
    return found


def main():
    if not os.path.exists(os.path.join(SRC, "es-en.data")):
        raise SystemExit("缺少 /tmp/es-en.data")
    print("解析 Wiktionary 词条…")
    dict_data = parse_dict(os.path.join(SRC, "es-en.data"))
    print(f"  词条 {len(dict_data)}")

    print("加载高频词表…")
    freq = load_freq(os.path.join(SRC, "es_merged_50k.txt"))
    print("加载词形→词头映射（frequency.csv）…")
    form_lemma = load_lemma_map(os.path.join(SRC, "frequency.csv"))
    print(f"  映射 {len(form_lemma)} 个变位/变体形式")

    # 保留：频率靠前的词；词头直接命中，变体映射到词头后复用其释义
    chosen = []   # [(word, lemma|None)]
    for w in freq:
        if w in dict_data:
            chosen.append((w, None))
        elif w in form_lemma and form_lemma[w] in dict_data:
            chosen.append((w, form_lemma[w]))
        if len(chosen) >= TARGET_COUNT:
            break
    print(f"  选取 {len(chosen)} 词（词头 {sum(1 for _, l in chosen if l is None)} + 变体 {sum(1 for _, l in chosen if l)}）")

    examples = {}
    st = os.path.join(SRC, "sentences.tsv")
    if os.path.exists(st):
        print("匹配 Tatoeba 双语例句…")
        examples = build_examples(st, [w for w, _ in chosen])
        print(f"  配到例句 {len(examples)} 词")
    else:
        print("  跳过（无 sentences.tsv，例句由 AI 兜底）")

    # 组装词条并分片
    entries = {}
    for w, lemma in chosen:
        src = dict_data[lemma] if lemma else dict_data[w]
        e = {
            "word": w,
            "phonetic": "",
            "pos": src["pos"][0] if src["pos"] else "",
            "cn": "；".join(src["glosses"][:3]),   # 英文释义
            "en": "；".join(src["glosses"][3:6]),  # 更多义项（英文）
            "ex": "",
            "ex_cn": "",
        }
        if lemma:
            # 变位/变体词：标注来源词头
            e["en"] = (e["en"] + "；" if e["en"] else "") + f"(form of {lemma})"
            if not e["en"]:
                e["en"] = f"(form of {lemma})"
        if w in examples:
            e["ex"] = examples[w]["ex"]
            e["ex_cn"] = examples[w]["ex_cn"]
        if not e["en"]:
            del e["en"]
        entries[w] = e

    letters = {}
    for w in entries:
        ch = w[0]
        key = ch if re.match(r"[a-z]", ch) else "0"
        letters.setdefault(key, []).append(w)
    for k in letters:
        letters[k].sort()

    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for ch, words in sorted(letters.items()):
        shard = {w: entries[w] for w in words}
        with open(os.path.join(OUT_DIR, f"dict-{ch}.json"), "w", encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))
        total += len(words)
        print(f"  dict-{ch}.json: {len(words)} 词")
    with open(os.path.join(OUT_DIR, "dict-index.json"), "w", encoding="utf-8") as f:
        json.dump({"letters": letters, "count": total}, f, ensure_ascii=False, separators=(",", ":"))

    # 常用词推荐包：高频前 N 个实词（过滤虚词），供生词本一键导入
    build_common_words(entries, dict_data, freq)

    import random
    random.seed(3)
    for w in random.sample(sorted(entries), 5):
        e = entries[w]
        print(f"  抽查 {w}: [{e['pos']}] {e['cn'][:50]} | 例: {e.get('ex', '')[:50]}")
    print(f"完成：{total} 词")


def build_common_words(entries, raw_dict, freq, count=100):
    """生成 data/common-100.json：按频率取实词（raw_dict 中任一词性为虚词的过滤），
    供生词本一键导入。"""
    FUNCTION_POS = {"art.", "conj.", "prep.", "pron.", "num.", "letter", "contr.", "det.", "determiner"}
    picked = []
    for w in freq:
        if len(picked) >= count:
            break
        if w not in entries:
            continue
        raw = raw_dict.get(w)
        # 变体词（如 es 为 ser 的变位）无原始词条 → 保留；词头虚词 → 过滤
        if raw and any(p in FUNCTION_POS for p in raw.get("pos", [])):
            continue
        picked.append(w)
    # 输出精简：word + 释义（卡片导入用）
    out = []
    for w in picked:
        e = entries[w]
        out.append({
            "word": w,
            "pos": e.get("pos", ""),
            "cn": e.get("cn", ""),
        })
    with open(os.path.join(OUT_DIR, "common-100.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"  常用词包 {len(out)} 个: {', '.join(w for w in picked[:12])} …")


if __name__ == "__main__":
    sys.exit(main())
