"""اختبار التطابق: يقارن الملف الناتج بالقالب الأصلي ويكتب تقريرًا في output/verification.

    python tools/verify_output.py "output/خطة ... .docx"
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from engine import service  # noqa: E402
from engine.pdf import to_pdf  # noqa: E402
from engine.verify import verify  # noqa: E402


def main(docx, out_dir=None, with_pdf=True):
    out_dir = out_dir or os.path.join(ROOT, "output", "verification")
    os.makedirs(out_dir, exist_ok=True)
    tpdf = opdf = None
    if with_pdf:
        tpdf = os.path.join(out_dir, "master-template.pdf")
        to_pdf(service.TEMPLATE, tpdf)
        opdf = os.path.splitext(docx)[0] + ".pdf"
        if not os.path.exists(opdf) or os.path.getmtime(opdf) < os.path.getmtime(docx):
            to_pdf(docx, opdf)
    rep = verify(service.TEMPLATE, docx, tpdf, opdf, out_dir)
    for c in rep["checks"]:
        print(("✔" if c["ok"] else "✘"), c["name"], "—", c["detail"])
    for v in rep.get("xml_violations", [])[:20]:
        print("   ✘", v["issue"], v["path"])
    print("النتيجة:", "ناجح" if rep["passed"] else "فشل")
    return rep


if __name__ == "__main__":
    main(sys.argv[1])
