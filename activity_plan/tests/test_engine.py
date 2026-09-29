"""اختبارات النظام: python -m pytest -q tests"""
import copy
import io
import os
import sys
import zipfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from engine import hijri, importer, model, service  # noqa: E402
from engine.ooxml import DocxPackage, q  # noqa: E402
from engine.seed import plan_from_template  # noqa: E402
from engine.verify import verify  # noqa: E402

T = service.TEMPLATE


@pytest.fixture(scope="module")
def st():
    return service.structure()


@pytest.fixture(scope="module")
def demo():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from build_demo import build_plan
    return build_plan()


def _texts(path):
    pkg = DocxPackage(path)
    out = []
    for n in ["word/document.xml"] + pkg.parts("word/header"):
        out += [t.text or "" for t in pkg.xml(n).iter(q("w:t"))]
    return out


def test_roundtrip_is_byte_identical(tmp_path):
    pkg = DocxPackage(T)
    for n in ["word/document.xml", "word/header1.xml"]:
        pkg.xml(n)
    out = tmp_path / "rt.docx"
    pkg.save(out)
    a, b = zipfile.ZipFile(T), zipfile.ZipFile(out)
    assert a.namelist() == b.namelist()
    assert all(a.read(n) == b.read(n) for n in a.namelist())


def test_template_structure(st):
    assert len(st["weeks"]) == 20
    assert [w["label"] for w in st["weeks"]][12:15] == ["13", "00", "14"]
    assert st["teacher_rows"] == 17 and st["domain_rows"] == 9
    blocked = [(w["label"], d["name"]) for w in st["weeks"] for d in w["days"] if d["blocked"]]
    assert ("5", "الأربعاء") in blocked and ("5", "الخميس") in blocked
    assert all(d["blocked"] for w in st["weeks"] if w["label"] in ("00", "19") for d in w["days"])


def test_calendar_matches_template_dates(st):
    plan = model.default_plan()
    days = model.calendar_days(plan, st)
    tpl = [d["date"] for w in st["weeks"] for d in w["days"]]
    assert [d["date"] for d in days] == tpl
    assert hijri.day_name(hijri.parse("10/3/1448")) == "الأحد"


def test_seed_plan_reproduces_template_weekly_cells(st, tmp_path):
    plan = plan_from_template(T, st)
    plan["schedule"] = model.auto_schedule(plan, st)["schedule"]
    out = tmp_path / "seed.docx"
    from engine.filler import fill_docx
    fill_docx(T, out, model.fill_values(plan, st))
    a, b = _texts(T), _texts(out)
    diffs = [(x, y) for x, y in zip(a, b) if x != y]
    # الفرق الوحيد: المرحلة في جدول المجالات (القالب نفسه يكتب «الإبتدائية» بينما الغلاف «متوسطة»)
    # والمنطقة في الغلاف (نقاط في القالب) تُملأ من الترويسة
    assert len(a) == len(b)
    assert all(("المتوسطة" in y) or ("عسير" in y) or y == "" for _, y in diffs), diffs


def test_quota():
    assert model.quota(90) == 9
    assert model.quota(95) == 9  # لا يتجاوز الحد المسموح
    assert model.quota(120) == 12
    assert model.quota("") == 0


def test_demo_plan_valid_and_design_unchanged(demo, st, tmp_path):
    v = model.validate(demo, st)
    assert v["errors"] == []
    res = service.generate_docx(demo, str(tmp_path), "demo")
    rep = verify(T, res["docx"])
    bad = [c for c in rep["checks"] if not c["ok"]]
    assert rep["passed"], bad
    texts = "".join(_texts(res["docx"]))
    for must in ("وليد أحمد", "أحمد سالم", "متوسطة مجمع أبو بكر الصديق التعليمي", "المتوسطة", "حوكمة البيانات"):
        assert must in texts


def test_teacher_math(demo):
    ts = {t["teacher"]["name"]: t for t in model.teacher_summary(demo)}
    ahmad = ts["أحمد محمد"]
    assert ahmad["allowed"] == 9 and ahmad["used"] == 7 and ahmad["remaining"] == 2
    assert [r["remaining"] for r in ahmad["rows"]] == [6, 2]


@pytest.mark.parametrize("stage,sem,years,start", [
    ("primary", 2, (1449, 1450), None),
    ("secondary", 1, (1448, 1449), "17/3/1448"),
])
def test_other_stages_semesters_years(demo, st, tmp_path, stage, sem, years, start):
    plan = copy.deepcopy(demo)
    plan["school"].update({"stage": stage, "semester": sem, "year_start": years[0], "year_end": years[1]})
    if start:
        plan["calendar"]["week1_start"] = start
        plan["schedule"] = model.auto_schedule(plan, st)["schedule"]
    res = service.generate_docx(plan, str(tmp_path), "x")
    rep = verify(T, res["docx"])
    assert rep["passed"], [c for c in rep["checks"] if not c["ok"]]
    texts = "\n".join(_texts(res["docx"]))
    adj = model.STAGES[stage]["adj"]
    assert f"{adj} مجمع" in texts
    other = [s["adj"] for k, s in model.STAGES.items() if k != stage]
    assert not any(o + " مجمع" in texts for o in other)
    assert "متوسط" + "ة…" not in texts
    assert str(years[0]) in texts and str(years[1]) in texts
    if years[0] != 1448:
        assert "1448 " not in texts
    word = model.SEMESTERS[sem]
    assert f"الفصل الدراسي {word}" in texts


def test_validation_messages(st):
    plan = model.default_plan()
    plan["programs"].append({"id": "p1", "name": "", "mode": "sessions", "sessions": 3, "start": "1/1/1440"})
    plan["teachers"].append({"id": "t1", "name": "س", "subject_periods": 10})
    plan["programs"].append({"id": "p2", "name": "برنامج", "mode": "sessions", "sessions": 5, "teacher_id": "t1",
                             "start": "10/3/1448"})
    v = model.validate(plan, st)
    joined = "\n".join(v["errors"])
    for msg in ("اسم المدرسة فارغ", "اسم مدير المدرسة فارغ", "اسم رائد النشاط الطلابي فارغ",
                "برنامج بدون اسم", "بدون معلم", "خارج فترة الخطة", "تجاوز الحد المسموح"):
        assert msg in joined, msg


def test_import_csv_conflicts(demo, st):
    csv = ("اسم البرنامج,مجال النشاط,عدد الحصص,تاريخ البداية,المعلم المسؤول\n"
           "برنامج أ,العلوم والتقنية,3,17/3/1448,أحمد محمد\n"
           "برنامج أ,العلوم والتقنية,4,24/3/1448,أحمد محمد\n"
           "برنامج ب,مجال غريب,2,2026-09-06,معلم جديد\n").encode("utf-8")
    res = importer.parse_programs("p.csv", csv, demo, st)
    assert [p["name"] for p in res["programs"]] == ["برنامج أ", "برنامج أ", "برنامج ب"]
    levels = {i["level"] for i in res["issues"]}
    assert "conflict" in levels
    assert res["programs"][2]["start"] == hijri.fmt(hijri.from_gregorian(__import__("datetime").date(2026, 9, 6)), False)
    msgs = "\n".join(i["msg"] for i in res["issues"])
    assert "مجال غريب" in msgs and "معلم جديد" in msgs and "ميلادي" in msgs


def test_import_samples(demo, st):
    for f in ("نموذج استيراد البرامج.xlsx", "نموذج استيراد البرامج.csv", "نموذج استيراد البرامج.docx"):
        path = os.path.join(ROOT, "samples", f)
        res = importer.parse_programs(f, open(path, "rb").read(), demo, st)
        names = {p["name"] for p in res["programs"]}
        assert "حوكمة البيانات" in names and len(res["programs"]) == 15, f


def test_manual_cell_counts_toward_sessions(demo, st):
    plan = copy.deepcopy(demo)
    p = next(x for x in plan["programs"] if x["name"] == "الخط العربي")
    d = next(d for d in model.calendar_days(plan, st) if not d["blocked"])
    plan["schedule"] = [e for e in plan["schedule"] if e["program_id"] != p["id"]] + [
        {"week": d["week"], "day": d["day"], "slot": "p3", "program_id": p["id"], "grade": p["grades"],
         "teacher_id": p["teacher_id"], "manual": True}]
    res = model.auto_schedule(plan, st)
    mine = [e for e in res["schedule"] if e["program_id"] == p["id"]]
    assert len(mine) == p["sessions"]
    assert sum(1 for e in mine if e["manual"]) == 1
