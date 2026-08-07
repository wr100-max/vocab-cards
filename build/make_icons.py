#!/usr/bin/env python3
"""生成 PWA 图标：深蓝紫渐变圆角方块 + 白色卡片 + "Aa" 字样。

输出 icons/icon-192.png、icons/icon-512.png、icons/apple-touch-icon.png(180)。
用项目 .venv 中的 Pillow 运行：.venv/bin/python3 build/make_icons.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "icons")
os.makedirs(OUT_DIR, exist_ok=True)


def _font(size):
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    from PIL import _fonts  # Pillow 自带 DejaVuSans-Bold.ttf 兜底

    pkg = os.path.dirname(_fonts.__file__)
    for f in ("DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        p = os.path.join(pkg, f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    raise SystemExit("未找到可用字体")


def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def make_icon(size):
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景：圆角方块 + 蓝紫垂直渐变
    top, bottom = (91, 108, 255), (138, 91, 255)  # #5B6CFF -> #8A5BFF
    grad = Image.new("RGBA", (1, s))
    for y in range(s):
        grad.putpixel((0, y), lerp(top, bottom, y / s))
    grad = grad.resize((s, s))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # 白色圆角卡片（居中，占 60%）
    pad = int(s * 0.20)
    card = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle((pad, pad, s - pad, s - pad), radius=int(s * 0.10), fill=(255, 255, 255, 255))
    card = card.filter(ImageFilter.GaussianBlur(2))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((pad, pad, s - pad, s - pad), radius=int(s * 0.10), fill=(255, 255, 255, 255))

    # 卡片上的 "Aa"
    font = _font(int(s * 0.34))
    d.text((s / 2, s * 0.44), "Aa", font=font, fill=(74, 85, 201, 255), anchor="mm")

    # 卡片下方小圆点装饰（模拟卡片进度点）
    dot_y = int(s * 0.72)
    dot_r = int(s * 0.025)
    for i, c in enumerate(((74, 85, 201), (138, 91, 255), (220, 224, 255))):
        x = s / 2 - dot_r * 4 + i * dot_r * 4
        d.ellipse((x - dot_r, dot_y - dot_r, x + dot_r, dot_y + dot_r), fill=c + (255,))

    return img


def main():
    make_icon(192).save(os.path.join(OUT_DIR, "icon-192.png"))
    make_icon(512).save(os.path.join(OUT_DIR, "icon-512.png"))
    make_icon(180).save(os.path.join(OUT_DIR, "apple-touch-icon.png"))
    print("图标已生成:", ", ".join(os.listdir(OUT_DIR)))


if __name__ == "__main__":
    sys.exit(main())
