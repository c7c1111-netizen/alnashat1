"""واجهة موحدة للنظام: البنية، التوزيع، التحقق، إنشاء Word و PDF."""
from __future__ import annotations

import functools
import os
import re

from . import model
from .filler import fill_docx
from .ooxml import DocxPackage
from .pdf import to_pdf
from .template_map import build_map, structure_summary

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.environ.get("PLAN_TEMPLATE", os.path.join(ROOT, "templates", "master.docx"))
OUTPUT_DIR = os.path.join(ROOT, "output")


@functools.lru_cache(maxsize=1)
def structure() -> dict:
    return structure_summary(build_map(DocxPackage(TEMPLATE)))


def output_basename(plan) -> str:
    school = (plan["school"].get("name") or "").strip() or "بدون اسم"
    school = re.sub(r'[\\/:*?"<>|]+', " ", school).strip()
    return f"خطة برامج النشاط الطلابي - {school}"


def enrich(plan) -> dict:
    """حسابات مشتقة تعرضها الواجهة (المعلمون، التقويم، التحقق)."""
    st = structure()
    ts = model.teacher_summary(plan)
    return {
        "teachers": [{"id": t["teacher"]["id"], "allowed": t["allowed"], "used": t["used"],
                      "remaining": t["remaining"], "rows": t["rows"]} for t in ts],
        "calendar": model.calendar_days(plan, st) if _calendar_ok(plan) else [],
        "validation": model.validate(plan, st),
    }


def _calendar_ok(plan):
    from . import hijri
    return hijri.try_parse(plan["calendar"].get("week1_start")) is not None


def generate_docx(plan, out_dir=OUTPUT_DIR, name=None) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    st = structure()
    values = model.fill_values(plan, st)
    path = os.path.join(out_dir, (name or output_basename(plan)) + ".docx")
    rep = fill_docx(TEMPLATE, path, values, fit_on=plan.get("settings", {}).get("fit_text", True))
    return {"docx": path, "report": rep.as_dict()}


def generate_pdf(docx_path, pdf_path=None) -> dict:
    pdf_path = pdf_path or os.path.splitext(docx_path)[0] + ".pdf"
    engine = to_pdf(docx_path, pdf_path)
    return {"pdf": pdf_path, "engine": engine}
