"""بيانات البداية: قراءة البرامج الموجودة فعليًا في القالب كنقطة انطلاق.

البرامج اليومية الموجودة في الجداول الأسبوعية للقالب (الاصطفاف الصباحي
وصلاة الظهر) تُقرأ كما هي دون أي تعديل في أسمائها أو تواريخها، وتُجمَّع
الأيام المتتالية لنفس البرنامج في نفس الخانة كبرنامج يومي بفترة (من - إلى).
"""
from __future__ import annotations

from . import hijri
from .filler import extract_template_data
from .model import ALL_GRADES, default_plan, new_id
from .template_map import SLOT_KEYS


def plan_from_template(template_path, structure) -> dict:
    data = extract_template_data(template_path)
    plan = default_plan()
    plan["name"] = "بيانات القالب الأصلي"
    plan["school"]["region"] = data["region"]
    start = hijri.parse(plan["calendar"]["week1_start"])
    order = []
    for w in structure["weeks"]:
        for d in w["days"]:
            order.append((w["index"], d["day"], hijri.add_days(start, 7 * w["index"] + d["day"])))
    programs = []
    for slot in SLOT_KEYS:
        cur = None
        for wk, dy, h in order:
            c = data["cells"].get((wk, dy, slot))
            name = c.get("program") if c else None
            if cur and name == cur["name"] and (c.get("grade") or ALL_GRADES) == cur["grades"]:
                cur["end"] = hijri.fmt(h, suffix=False)
                continue
            if name:
                cur = {"id": new_id("prg"), "name": name, "domain": "الفترات اللاصفية",
                       "mode": "daily", "slot": slot, "grades": c.get("grade") or ALL_GRADES,
                       "start": hijri.fmt(h, suffix=False), "end": hijri.fmt(h, suffix=False),
                       "sessions": "", "teacher_id": "", "goal": "", "description": "",
                       "target": "", "time": "", "notes": "", "source": "القالب الأصلي",
                       "weekdays": [0, 1, 2, 3, 4], "date_required": True}
                programs.append(cur)
            else:
                cur = None
    plan["programs"] = programs
    return plan
