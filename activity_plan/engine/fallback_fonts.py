"""توليد خط عربي بديل بقياسات Arial الرأسية (لتحويل PDF عبر LibreOffice فقط).

عند عدم توفر خطوط Word الأصلية على الخادم، أقرب بديل للحروف العربية هو
Noto Naskh Arabic UI، لكن ارتفاع سطره (1.36em) أكبر من Arial (≈1.15em)
فتتمدد صفوف الجداول في PDF. هنا نولد نسخة معاد تسميتها (حسب رخصة OFL)
بارتفاع سطر Arial نفسه، لتبقى الصفحات مطابقة لتقسيم Word قدر الإمكان.

لا يؤثر هذا على ملف Word إطلاقًا؛ ملف DOCX يبقى بخطوطه الأصلية.
"""
from __future__ import annotations

import glob
import os

FAMILY = "Plan Arabic Fallback"
_SOURCES = {
    "Regular": ["NotoNaskhArabicUI-Regular.ttf", "NotoNaskhArabic-Regular.ttf"],
    "Bold": ["NotoNaskhArabicUI-Bold.ttf", "NotoNaskhArabic-Bold.ttf"],
}
# قياسات Arial (من ملف arial.ttf في ويندوز) نسبة إلى em
ARIAL_WIN_ASC, ARIAL_WIN_DESC = 0.9052734375, 0.2119140625


def _find(names):
    for n in names:
        hits = glob.glob(f"/usr/share/fonts/**/{n}", recursive=True)
        if hits:
            return hits[0]
    return None


def ensure(out_dir) -> list[str]:
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return []
    made = []
    for style, names in _SOURCES.items():
        dst = os.path.join(out_dir, f"PlanArabicFallback-{style}.ttf")
        if os.path.exists(dst):
            made.append(dst)
            continue
        src = _find(names)
        if not src:
            continue
        f = TTFont(src)
        upm = f["head"].unitsPerEm
        asc, desc = round(ARIAL_WIN_ASC * upm), round(ARIAL_WIN_DESC * upm)
        os2, hhea = f["OS/2"], f["hhea"]
        os2.usWinAscent, os2.usWinDescent = asc, desc
        os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = asc, -desc, 0
        hhea.ascent, hhea.descent, hhea.lineGap = asc, -desc, 0
        name = f["name"]
        full = f"{FAMILY} {style}" if style != "Regular" else FAMILY
        ps = f"PlanArabicFallback-{style}"
        for rec in list(name.names):
            if rec.nameID in (1, 16):
                rec.string = FAMILY
            elif rec.nameID in (2, 17):
                rec.string = style
            elif rec.nameID == 4:
                rec.string = full
            elif rec.nameID == 6:
                rec.string = ps
            elif rec.nameID == 3:
                rec.string = f"{ps};derived-from-noto"
        f.save(dst)
        made.append(dst)
    return made
