"""ضبط حجم الخط ليتسع النص داخل المساحة المتاحة دون توسيع الجدول.

لا نغيّر عرض الأعمدة ولا ارتفاع الصفوف أبدًا؛ إذا كان النص أطول من المساحة
المتاحة نصغّر حجم خط المقطع (w:sz / w:szCs) فقط وبالحد الأدنى اللازم.

قياس عرض النص يتم بتشكيل حقيقي للنص العربي (HarfBuzz) بخط مرفق بالمشروع
(fonts/measure)، فتكون النتيجة نفسها على أي خادم (محلي أو Vercel). إن غاب
HarfBuzz يُستخدم Pillow/Raqm، ثم تقدير متحفظ لمتوسط عرض الحرف.
"""
from __future__ import annotations

import functools
import math
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
_FONT_CANDIDATES = [
    # خط النص العربي في خلايا البيانات هو خط نمط Normal في القالب (Microsoft Sans Serif)
    os.path.join(_HERE, "..", "fonts", "micross.ttf"),
    "C:/Windows/Fonts/micross.ttf",
    # الخط المرفق: عربي بدون تذييل، أعرض قليلًا من خطوط Word ← قياس متحفظ
    os.path.join(_HERE, "..", "fonts", "measure", "NotoSansArabicUI-Regular.ttf"),
]

SAFETY = 1.03  # هامش أمان للقياس
LINE_FACTOR = 1.22  # ارتفاع السطر نسبة إلى حجم الخط (Arial ≈ 1.15 + هامش أمان)


def _font_path():
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


@functools.lru_cache(maxsize=1)
def _hb_font():
    try:
        import uharfbuzz as hb
    except ImportError:
        return None
    path = _font_path()
    if not path:
        return None
    with open(path, "rb") as f:
        blob = hb.Blob(f.read())
    face = hb.Face(blob)
    font = hb.Font(face)
    return hb, font, face.upem


@functools.lru_cache(maxsize=1)
def _pil_font():
    try:
        from PIL import ImageFont, features

        path = _font_path()
        if path and features.check("raqm"):
            return ImageFont.truetype(path, 200, layout_engine=ImageFont.Layout.RAQM)
    except Exception:  # pragma: no cover - بيئات بلا PIL
        return None
    return None


def _heuristic_em(text: str) -> float:
    em = 0.0
    for ch in text:
        if ch in "\u200f\u200e":
            continue
        if ch.isspace():
            em += 0.26
        elif ch.isdigit():
            em += 0.56
        elif "\u0600" <= ch <= "\u06ff" or "\ufb50" <= ch <= "\ufeff":
            em += 0.47
        else:
            em += 0.55
    return em


@functools.lru_cache(maxsize=4096)
def text_em(text: str) -> float:
    """عرض النص بوحدة em (نسبة إلى حجم الخط)."""
    text = text.replace("\u200f", "").replace("\u200e", "")
    if not text:
        return 0.0
    hbf = _hb_font()
    if hbf is not None:
        hb, font, upem = hbf
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(font, buf, {})
        return sum(p.x_advance for p in buf.glyph_positions) / upem
    f = _pil_font()
    if f is not None:
        try:
            return f.getlength(text, direction="rtl") / 200.0
        except Exception:
            pass
    return _heuristic_em(text)


def engine_name() -> str:
    if _hb_font() is not None:
        return "harfbuzz:" + os.path.basename(_font_path())
    if _pil_font() is not None:
        return "raqm:" + os.path.basename(_font_path())
    return "heuristic"


def lines_needed(text: str, size_pt: float, width_pt: float, scale: float = 1.0) -> int:
    """عدد الأسطر اللازمة عند الالتفاف على مستوى الكلمات."""
    if width_pt <= 0:
        return 99
    words = [w for w in re.split(r"\s+", text.replace("\u200f", " ").strip()) if w]
    if not words:
        return 1
    space = text_em(" ") or 0.26
    lines, cur = 1, 0.0
    for w in words:
        ww = text_em(w) * size_pt * scale * SAFETY
        if ww > width_pt:
            # كلمة أطول من السطر: تنكسر على عدة أسطر
            extra = math.ceil(ww / width_pt)
            if cur > 0:
                lines += 1
            lines += extra - 1
            cur = ww - (extra - 1) * width_pt
            continue
        add = ww if cur == 0 else ww + space * size_pt * scale
        if cur + add > width_pt:
            lines += 1
            cur = ww
        else:
            cur += add
    return lines


def fit_size(text: str, base_half_pts: int, width_pt: float, height_pt: float | None,
             max_lines: int | None = None, min_half_pts: int = 12, scale: float = 1.0):
    """يعيد (الحجم بنصف نقطة, هل اتسع النص).

    يبدأ من حجم القالب الأصلي وينزل نصف نقطة في كل خطوة حتى يتسع النص في
    عدد الأسطر المسموح (المحسوب من ارتفاع الصف إن لم يُحدد).
    """
    size = base_half_pts
    while size >= min_half_pts:
        pt = size / 2.0
        allowed = max_lines
        if allowed is None:
            allowed = max(1, int(height_pt // (pt * LINE_FACTOR))) if height_pt else 1
        if lines_needed(text, pt, width_pt, scale) <= allowed:
            return size, True
        size -= 1
    return min_half_pts, False


def fit_scale(text: str, size_pt: float, width_pt: float, base_scale: float = 1.0,
              min_scale: float = 0.5):
    """للفقرات المتدفقة (خارج الجداول): تضييق عرض الحروف (w:w) بدل تصغير
    الخط، حتى يبقى ارتفاع السطر كما هو تمامًا فلا يتحرك أي عنصر بعده.
    يعيد (نسبة العرض كنسبة مئوية صحيحة, هل اتسع)."""
    pct = int(round(base_scale * 100))
    while pct >= int(min_scale * 100):
        if lines_needed(text, size_pt, width_pt, pct / 100.0) <= 1:
            return pct, True
        pct -= 1
    return int(min_scale * 100), False
