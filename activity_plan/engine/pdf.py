"""تحويل ملف Word الناتج إلى PDF.

الأولوية لأعلى دقة ممكنة:
1. Microsoft Word نفسه (ويندوز/ماك مع docx2pdf) ← مطابقة 100% لأن Word هو
   من يرسم الملف وبخطوطه الأصلية (Sakkal Majalla / Arial).
2. LibreOffice (headless) ← متاح على الخوادم ولينكس. يُستخدم ملف إعداد خطوط
   خاص (fonts/fonts.conf) يوجّه الخطوط غير المتوفرة إلى أقرب بدائل قياسًا.
   لأفضل نتيجة ضع ملفات خطوط Word الأصلية (مثل majalla.ttf و arial.ttf)
   في مجلد fonts/ بالمشروع وستُستخدم تلقائيًا.

يمكن فرض المحرك بمتغير البيئة PDF_ENGINE=word أو PDF_ENGINE=libreoffice.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(ROOT, "fonts")


class PdfError(RuntimeError):
    pass


def _soffice():
    for name in ("soffice", "libreoffice"):
        p = shutil.which(name)
        if p:
            return p
    for p in (r"C:\Program Files\LibreOffice\program\soffice.exe",
              "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if os.path.exists(p):
            return p
    return None


def _generated_dir():
    """مجلد الخط البديل المولَّد: داخل المشروع إن كان قابلًا للكتابة، وإلا مجلد مؤقت
    (أنظمة الملفات للقراءة فقط كما في الخوادم السحابية)."""
    d = os.path.join(FONTS_DIR, "generated")
    try:
        os.makedirs(d, exist_ok=True)
        if os.access(d, os.W_OK):
            return d
    except OSError:
        pass
    d = os.path.join(tempfile.gettempdir(), "activity-plan-fonts")
    os.makedirs(d, exist_ok=True)
    return d


def available() -> bool:
    """هل يمكن تحويل PDF في هذه البيئة؟ (غير متاح مثلًا على Vercel)."""
    if os.environ.get("PDF_ENGINE", "").lower() == "none":
        return False
    if os.name == "nt":
        try:
            import docx2pdf  # noqa: F401
            return True
        except ImportError:
            pass
    return _soffice() is not None


def _fontconfig_file(tmpdir):
    """ملف fontconfig يضم مجلد خطوط المشروع + جدول البدائل."""
    src = os.path.join(FONTS_DIR, "fonts.conf")
    with open(src, encoding="utf-8") as f:
        conf = (f.read().replace("@FONTS_DIR@", FONTS_DIR).replace("@GEN_DIR@", _generated_dir())
                .replace("@CACHE_DIR@", os.path.join(tmpdir, "fc-cache")))
    path = os.path.join(tmpdir, "fonts.conf")
    with open(path, "w", encoding="utf-8") as f:
        f.write(conf)
    return path


def convert_with_libreoffice(docx_path, pdf_path, timeout=240):
    soffice = _soffice()
    if not soffice:
        raise PdfError("LibreOffice غير مثبت. ثبّته أو استخدم Microsoft Word للتحويل.")
    try:
        from .fallback_fonts import ensure
        ensure(_generated_dir())
    except Exception:  # الخط البديل تحسين اختياري
        pass
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ)
        if os.name != "nt":
            env["FONTCONFIG_FILE"] = _fontconfig_file(tmp)
        profile = "file://" + os.path.join(tmp, "profile").replace("\\", "/")
        src = os.path.join(tmp, "input.docx")
        shutil.copyfile(docx_path, src)
        cmd = [soffice, f"-env:UserInstallation={profile}", "--headless", "--norestore",
               "--convert-to", "pdf:writer_pdf_Export", "--outdir", tmp, src]
        r = subprocess.run(cmd, env=env, capture_output=True, timeout=timeout)
        out = os.path.join(tmp, "input.pdf")
        if not os.path.exists(out):
            raise PdfError("فشل التحويل إلى PDF: " + (r.stderr or r.stdout or b"").decode("utf-8", "ignore")[-400:])
        shutil.move(out, pdf_path)
    return "libreoffice"


def convert_with_word(docx_path, pdf_path):
    try:
        from docx2pdf import convert  # يتطلب Microsoft Word
    except ImportError as e:
        raise PdfError("docx2pdf غير مثبت") from e
    convert(os.path.abspath(docx_path), os.path.abspath(pdf_path))
    if not os.path.exists(pdf_path):
        raise PdfError("فشل التحويل عبر Microsoft Word")
    return "word"


def to_pdf(docx_path, pdf_path) -> str:
    engine = os.environ.get("PDF_ENGINE", "auto").lower()
    if engine == "none":
        raise PdfError("تحويل PDF غير متاح في هذه البيئة.")
    if engine in ("word", "auto") and os.name == "nt" or engine == "word":
        try:
            return convert_with_word(docx_path, pdf_path)
        except Exception:
            if engine == "word":
                raise
    return convert_with_libreoffice(docx_path, pdf_path)


def render_pages(pdf_path, out_dir, dpi=80, prefix="page"):
    """صور PNG لصفحات PDF (للمعاينة والمقارنة البصرية)."""
    import pymupdf

    os.makedirs(out_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    paths = []
    for i, page in enumerate(doc):
        p = os.path.join(out_dir, f"{prefix}-{i + 1:02d}.png")
        page.get_pixmap(dpi=dpi).save(p)
        paths.append(p)
    return paths


def render_pages_inline(pdf_path, dpi=80, quality=80) -> list[str]:
    """صور الصفحات كـ data URLs (JPEG) لإرسالها مباشرة في الاستجابة دون حفظ ملفات
    على الخادم (مناسب للخوادم عديمة الحالة)."""
    import base64

    import pymupdf

    out = []
    for page in pymupdf.open(pdf_path):
        data = page.get_pixmap(dpi=dpi).tobytes("jpg", jpg_quality=quality)
        out.append("data:image/jpeg;base64," + base64.b64encode(data).decode("ascii"))
    return out
