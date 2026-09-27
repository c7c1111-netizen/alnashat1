"""إنشاء الخطة التجريبية المطلوبة في الاختبار النهائي وتصدير Word و PDF.

    python tools/build_demo.py

البيانات التجريبية:
- المدرسة: مجمع أبو بكر الصديق التعليمي — المرحلة المتوسطة
- رائد النشاط: وليد أحمد — مدير المدرسة: أحمد سالم (بيانات تجريبية)
- البرامج اليومية (الاصطفاف الصباحي وصلاة الظهر) مقروءة كما هي من القالب.
- برامج الحصص: أسماؤها وأعداد حصصها من مكتبة البرامج الموجودة في المستودع
  (index.html — الدليل التفسيري 1448هـ)، والمعلمون بيانات تجريبية.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from engine import hijri, model, service, store  # noqa: E402
from engine.seed import plan_from_template  # noqa: E402

TEACHERS = [  # (الاسم، المادة، عدد حصص المادة في الفصل، الصفوف)
    ("أحمد محمد", "الرياضيات", 90, "الأول والثاني المتوسط"),
    ("خالد عبدالله", "العلوم", 90, "الثاني والثالث المتوسط"),
    ("سعد علي", "لغتي الخالدة", 120, "الأول المتوسط"),
    ("فهد ناصر", "التربية البدنية", 60, "جميع الصفوف"),
    ("ماجد حسن", "الدراسات الاجتماعية", 60, "الثالث المتوسط"),
    ("عبدالرحمن سالم", "التربية الفنية", 40, "جميع الصفوف"),
    ("يوسف إبراهيم", "المهارات الرقمية", 60, "الثاني المتوسط"),
    ("تركي سعيد", "الدراسات الإسلامية", 80, "الأول والثالث المتوسط"),
]

# (البرنامج، المجال، عدد الحصص، المعلم، تاريخ البداية ميلادي داخليًا، الحصة، الصف)
PROGRAMS = [
    ("يوم المعلم العالمي", "الأيام والمناسبات", 2, "سعد علي", dt.date(2026, 10, 5), "p6", "الأول المتوسط"),
    ("اليوم العالمي للطفل", "الأيام والمناسبات", 2, "ماجد حسن", dt.date(2026, 11, 16), "p5", "الثالث المتوسط"),
    ("يوم اللغة العربية العالمي", "الأيام والمناسبات", 2, "سعد علي", dt.date(2026, 12, 13), "p6", "الأول المتوسط"),
    ("وطني في قلبي", "النشاط الكشفي", 3, "ماجد حسن", dt.date(2026, 9, 20), "p7", "الثالث المتوسط"),
    ("صافرة واصطفاف", "النشاط الكشفي", 2, "فهد ناصر", dt.date(2026, 9, 6), "p4", "الأول المتوسط"),
    ("الأمن السيبراني", "العلوم والتقنية", 4, "يوسف إبراهيم", dt.date(2026, 10, 18), "p5", "الثاني المتوسط"),
    ("الاستدامة وجودة الحياة", "العلوم والتقنية", 4, "خالد عبدالله", dt.date(2026, 9, 27), "p6", "الثاني المتوسط"),
    ("حوكمة البيانات", "العلوم والتقنية", 3, "أحمد محمد", dt.date(2026, 11, 1), "p7", "الثاني المتوسط"),
    ("الإسعافات الأولية", "الرياضة والصحة", 4, "فهد ناصر", dt.date(2026, 10, 25), "p3", "الثالث المتوسط"),
    ("الخط العربي", "الثقافة والفنون", 4, "عبدالرحمن سالم", dt.date(2026, 11, 8), "p4", "الأول المتوسط"),
    ("الكتابة الإبداعية والأدبية", "الثقافة والفنون", 5, "سعد علي", dt.date(2026, 11, 29), "p5", "الأول المتوسط"),
    ("التطوع الطلابي", "المواطنة والحياة", 4, "تركي سعيد", dt.date(2026, 9, 13), "p7", "الثالث المتوسط"),
    ("إرث وطموح", "المواطنة والحياة", 4, "تركي سعيد", dt.date(2026, 11, 22), "p6", "الأول المتوسط"),
    ("ريادة الأعمال", "المواطنة والحياة", 4, "أحمد محمد", dt.date(2026, 11, 15), "p7", "الثاني المتوسط"),
    ("البحث العلمي", "العلوم والتقنية", 4, "خالد عبدالله", dt.date(2026, 12, 6), "p4", "الثالث المتوسط"),
]


def build_plan() -> dict:
    st = service.structure()
    plan = plan_from_template(service.TEMPLATE, st)  # البرامج اليومية كما في القالب
    plan["id"] = "demo_abubakr"
    plan["name"] = "خطة تجريبية - مجمع أبو بكر الصديق"
    plan["school"].update({"name": "مجمع أبو بكر الصديق التعليمي", "stage": "intermediate",
                           "region": "عسير", "year_start": 1448, "year_end": 1449, "semester": 1})
    plan["officials"] = {"leader": "وليد أحمد", "manager": "أحمد سالم"}
    ids = {}
    for name, subject, periods, grades in TEACHERS:
        t = {"id": model.new_id("tch"), "name": name, "subject": subject, "stage": "intermediate",
             "grades": grades, "subject_periods": periods, "notes": "بيانات تجريبية"}
        ids[name] = t["id"]
        plan["teachers"].append(t)
    for name, domain, sessions, teacher, gdate, slot, grade in PROGRAMS:
        start = hijri.from_gregorian(gdate)
        # يبدأ من أول يوم أحد في الأسبوع الدراسي الذي يقع فيه التاريخ
        plan["programs"].append({
            "id": model.new_id("prg"), "name": name, "domain": domain, "mode": "sessions",
            "sessions": sessions, "teacher_id": ids[teacher], "slot": slot, "grades": grade,
            "start": hijri.fmt(start, suffix=False), "end": "", "goal": "", "description": "",
            "target": "طلاب " + grade, "time": "", "notes": "بيانات تجريبية",
            "weekdays": [0, 1, 2, 3, 4], "date_required": True, "source": "مكتبة البرامج",
        })
    res = model.auto_schedule(plan, st)
    plan["schedule"] = res["schedule"]
    if res["unplaced"]:
        print("تنبيه: برامج لم تُوزع بالكامل:", res["unplaced"])
    return plan


def main():
    plan = build_plan()
    v = model.validate(plan, service.structure())
    print("أخطاء:", v["errors"])
    print("تنبيهات:", len(v["warnings"]))
    store.save(plan)
    out = service.generate_docx(plan)
    print(json.dumps(out["report"], ensure_ascii=False, indent=1)[:2000])
    pdf = service.generate_pdf(out["docx"])
    print(out["docx"], pdf)


if __name__ == "__main__":
    main()
