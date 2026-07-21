#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PWA 아이콘 생성기 — 파인그린 배경 + 흰 텐트 + 앰버 깃발.
Pillow로 4배 슈퍼샘플링 후 축소(안티에일리어싱).

  python3 tools/make_icons.py
  → icons/{icon-192,icon-512,icon-maskable-512,apple-touch-180,favicon-32}.png
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

GREEN_TOP = (47, 106, 76)    # #2F6A4C
GREEN_BOT = (26, 58, 42)     # 더 진한 파인그린
WHITE     = (246, 248, 243)
RIDGE     = (210, 220, 210)
EMBER     = (213, 88, 31)    # #D5581F 브랜드 액센트


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size, maskable=False, flag=True):
    SS = 4
    S = size * SS
    img = Image.new("RGB", (S, S), GREEN_TOP)
    px = img.load()
    for y in range(S):                       # 세로 그라데이션
        c = lerp(GREEN_TOP, GREEN_BOT, y / S)
        for x in range(S):
            px[x, y] = c
    d = ImageDraw.Draw(img)

    cx, cy = S / 2, S / 2
    m = 0.66 if maskable else 0.92           # 마스커블은 안전영역 안으로

    def P(fx, fy):
        return (cx + (fx - 0.5) * S * m, cy + (fy - 0.5) * S * m)

    apex = P(0.5, 0.24)
    bl, br = P(0.14, 0.80), P(0.86, 0.80)
    # 텐트(흰 삼각형)
    d.polygon([apex, bl, br], fill=WHITE)
    # 능선(살짝 음영)
    d.line([apex, P(0.5, 0.80)], fill=RIDGE, width=max(2, int(S * 0.012)))
    # 문(그린 삼각형)
    d.polygon([P(0.5, 0.42), P(0.41, 0.80), P(0.59, 0.80)], fill=lerp(GREEN_TOP, GREEN_BOT, 0.5))
    # 바닥선
    d.line([P(0.08, 0.815), P(0.92, 0.815)], fill=WHITE, width=max(2, int(S * 0.022)))
    # 깃발
    if flag:
        pole_top = P(0.5, 0.11)
        d.line([apex, pole_top], fill=WHITE, width=max(2, int(S * 0.014)))
        d.polygon([pole_top, P(0.66, 0.145), P(0.5, 0.18)], fill=EMBER)

    return img.resize((size, size), Image.LANCZOS)


jobs = [
    ("icon-192.png", dict(size=192)),
    ("icon-512.png", dict(size=512)),
    ("icon-maskable-512.png", dict(size=512, maskable=True)),
    ("apple-touch-180.png", dict(size=180)),
    ("favicon-32.png", dict(size=32, flag=False)),
]
for name, kw in jobs:
    draw_icon(**kw).save(OUT / name)
    print("생성:", (OUT / name).name)
print("완료 →", OUT)
