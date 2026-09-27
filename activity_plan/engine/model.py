"""نموذج بيانات الخطة: المدرسة، المسؤولون، المعلمون، البرامج، الجدولة.

- الحسابات (نسبة 10%، المتبقي) والتوزيع التلقائي والتحقق كلها هنا.
- لا يوجد أي منطق تصميم هنا؛ التصميم مصدره ملف القالب فقط.
"""
from __future__ import annotations

import copy
import datetime as _dt
import math
import uuid

from . import hijri
from .template_map import SLOT_KEYS, SLOT_LABELS, TEMPLATE_DOMAINS

STAGES = {
    "primary": {"label": "المرحلة الابتدائية", "adj": "ابتدائية", "table": "الابتدائية"},
    "intermediate": {"label": "المرحلة المتوسطة", "adj": "متوسطة", "table": "المتوسطة"},
    "secondary": {"label": "المرحلة الثانوية", "adj": "ثانوية", "table": "الثانوية"},
}
SEMESTERS = {1: "الأول", 2: "الثاني", 3: "الثالث"}

# المجالات: الستة الموجودة في القالب + مجال للبرامج اليومية (الاصطفاف/الصلاة)
# لا يظهر في جدول المجالات لأنه غير موجود فيه.
EXTRA_DOMAINS = ["الفترات اللاصفية"]
ALL_DOMAINS = TEMPLATE_DOMAINS + EXTRA_DOMAINS

CLASS_SLOTS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]
QUOTA_RATE = 0.10
DOTS_NAME = ".........................................."
ALL_GRADES = "جميع الصفوف"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def default_plan() -> dict:
    return {
        "id": new_id("plan"),
        "name": "خطة جديدة",
        "updated": _dt.datetime.now().isoformat(timespec="seconds"),
        "school": {
            "country": "المملكة العربية السعودية",
            "ministry": "وزارة التعليم",
            "region": "",
            "name": "",
            "stage": "intermediate",
            "year_start": 1448,
            "year_end": 1449,
            "semester": 1,
            "prefix_stage": True,
        },
        "officials": {"leader": "", "manager": ""},
        "calendar": {"week1_start": "10/3/1448"},
        "teachers": [],
        "programs": [],
        "schedule": [],
        "settings": {"prevent_conflicts": True, "fit_text": True},
    }


def normalize_plan(plan: dict) -> dict:
    base = default_plan()
    out = copy.deepcopy(plan or {})
    for k, v in base.items():
        if k not in out:
            out[k] = v
        elif isinstance(v, dict):
            for kk, vv in v.items():
                out[k].setdefault(kk, vv)
    return out


# --------------------------------------------------------------------------
# التقويم
# --------------------------------------------------------------------------
def calendar_days(plan: dict, structure: dict) -> list[dict]:
    """كل أيام الخطة: الأسبوع، اليوم، التاريخ الهجري، هل هو محجوب في القالب."""
    start = hijri.parse(plan["calendar"]["week1_start"])
    out = []
    for w in structure["weeks"]:
        for d in w["days"]:
            h = hijri.add_days(start, 7 * w["index"] + d["day"])
            out.append({
                "week": w["index"], "week_label": w["label"], "day": d["day"],
                "day_name": d["name"], "date": hijri.fmt(h, suffix=False),
                "ord": hijri.ordinal(h), "blocked": d["blocked"], "slots": d["slots"],
            })
    return out


def semester_range(plan, structure):
    days = calendar_days(plan, structure)
    return days[0]["ord"], days[-1]["ord"]


# --------------------------------------------------------------------------
# المعلمون ونسبة 10%
# --------------------------------------------------------------------------
def quota(subject_periods) -> int:
    """عدد الحصص الممكن الاستفادة منها = عدد حصص المادة × 10% (تقريب لأسفل
    حتى لا يتجاوز الحد المسموح)."""
    try:
        n = float(subject_periods or 0)
    except (TypeError, ValueError):
        return 0
    return int(math.floor(n * QUOTA_RATE + 1e-9))


def program_counts(p: dict) -> bool:
    """هل تُحتسب حصص البرنامج من نسبة 10%؟ (برامج الحصص الدراسية نعم،
    برامج الاصطفاف/الصلاة اليومية لا) ويمكن للمستخدم تغيير ذلك."""
    if "counts_quota" in p and p["counts_quota"] is not None:
        return bool(p["counts_quota"])
    return p.get("mode", "sessions") == "sessions"


def _int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def teacher_summary(plan: dict) -> list[dict]:
    progs = plan["programs"]
    first_dates = first_scheduled_dates(plan)
    out = []
    for t in plan["teachers"]:
        allowed = quota(t.get("subject_periods"))
        mine = [p for p in progs if p.get("teacher_id") == t["id"]]
        mine.sort(key=lambda p: (first_dates.get(p["id"]) or _start_ord(p) or 10**9, p.get("name", "")))
        used = 0
        rows = []
        for p in mine:
            s = _int(p.get("sessions"))
            if program_counts(p):
                used += s
            start = first_dates.get(p["id"])
            start_txt = hijri.fmt(_from_ord(start)) if start else (
                hijri.fmt(hijri.parse(p["start"])) if hijri.try_parse(p.get("start")) else "")
            rows.append({"program_id": p["id"], "program": p.get("name", ""), "sessions": s,
                         "start": start_txt, "remaining": allowed - used,
                         "counts": program_counts(p)})
        out.append({"teacher": t, "allowed": allowed, "used": used,
                    "remaining": allowed - used, "rows": rows})
    return out


def _from_ord(o):
    return hijri.from_gregorian(_dt.date.fromordinal(o))


def _start_ord(p):
    h = hijri.try_parse(p.get("start"))
    return hijri.ordinal(h) if h else None


def first_scheduled_dates(plan) -> dict:
    res = {}
    for e in plan["schedule"]:
        if e.get("ord") and e.get("program_id"):
            res[e["program_id"]] = min(res.get(e["program_id"], 10**9), e["ord"])
    return res


# --------------------------------------------------------------------------
# التوزيع التلقائي على الأيام والحصص
# --------------------------------------------------------------------------
def auto_schedule(plan: dict, structure: dict) -> dict:
    """يوزع البرامج على الأيام والحصص.

    - المدخلات اليدوية (manual=True) تبقى كما هي.
    - برنامج «يومي» (mode=daily): يُكرر في خانته (الاصطفاف/الصلاة...) كل يوم
      دراسي بين تاريخ البداية والنهاية.
    - برنامج «حصص» (mode=sessions): يوضع عدد حصصه ابتداءً من تاريخ البداية
      في الحصة المفضلة (أو أول حصة متاحة) مع تجنب التضارب.
    يعيد {'schedule': [...], 'unplaced': [...]}.
    """
    days = [d for d in calendar_days(plan, structure) if not d["blocked"]]
    by_ord = {d["ord"]: d for d in days}
    manual = [dict(e) for e in plan["schedule"] if e.get("manual")]
    for e in manual:  # تحديث التاريخ حسب التقويم الحالي
        for d in days:
            if d["week"] == e["week"] and d["day"] == e["day"]:
                e["ord"], e["date"] = d["ord"], d["date"]
    taken = {(e["week"], e["day"], e["slot"]) for e in manual}
    teacher_busy = {(e["week"], e["day"], e["slot"], e.get("teacher_id")) for e in manual if e.get("teacher_id")}
    manual_ids = {e["program_id"] for e in manual}
    out = list(manual)
    unplaced = []
    teachers = {t["id"]: t for t in plan["teachers"]}

    def entry(p, d, slot):
        t = teachers.get(p.get("teacher_id"))
        return {"week": d["week"], "day": d["day"], "slot": slot, "program_id": p["id"],
                "grade": p.get("grades") or ALL_GRADES, "teacher_id": p.get("teacher_id") or "",
                "ord": d["ord"], "date": d["date"], "manual": False,
                "teacher_name": t["name"] if t else ""}

    def sort_key(p):
        return (_start_ord(p) or 0, 0 if p.get("mode") == "daily" else 1, p.get("name", ""))

    for p in sorted(plan["programs"], key=sort_key):
        if p["id"] in manual_ids or not p.get("name"):
            continue
        start = _start_ord(p)
        end_h = hijri.try_parse(p.get("end"))
        end = hijri.ordinal(end_h) if end_h else None
        weekdays = p.get("weekdays") or [0, 1, 2, 3, 4]
        pref = p.get("slot") or ""
        if p.get("mode") == "daily":
            slot = pref or "morning"
            if start is None:
                unplaced.append({"program": p["name"], "reason": "لا يوجد تاريخ بداية للبرنامج اليومي"})
                continue
            last = end if end is not None else start
            n = 0
            for o in sorted(by_ord):
                d = by_ord[o]
                if o < start or o > last or d["day"] not in weekdays or slot not in d["slots"]:
                    continue
                if (d["week"], d["day"], slot) in taken:
                    continue
                taken.add((d["week"], d["day"], slot))
                out.append(entry(p, d, slot))
                n += 1
            if n == 0:
                unplaced.append({"program": p["name"], "reason": "لا توجد أيام متاحة في الفترة المحددة"})
            continue
        need = _int(p.get("sessions"))
        if need <= 0:
            continue
        slots = [pref] if pref in CLASS_SLOTS or pref in SLOT_KEYS else CLASS_SLOTS
        placed = 0
        per_week = _int(p.get("per_week"), 1) or 1
        week_count = {}
        for o in sorted(by_ord):
            if placed >= need:
                break
            d = by_ord[o]
            if week_count.get(d["week"], 0) >= per_week:
                continue
            if start is not None and o < start:
                continue
            if end is not None and o > end:
                continue
            if d["day"] not in weekdays:
                continue
            for slot in slots:
                if slot not in d["slots"] or (d["week"], d["day"], slot) in taken:
                    continue
                tid = p.get("teacher_id")
                if tid and (d["week"], d["day"], slot, tid) in teacher_busy:
                    continue
                taken.add((d["week"], d["day"], slot))
                if tid:
                    teacher_busy.add((d["week"], d["day"], slot, tid))
                out.append(entry(p, d, slot))
                placed += 1
                week_count[d["week"]] = week_count.get(d["week"], 0) + 1
                break
        if placed < need:
            unplaced.append({"program": p["name"],
                             "reason": f"تم توزيع {placed} من {need} حصص فقط (لا توجد خانات متاحة كافية)"})
    out.sort(key=lambda e: (e.get("ord") or 0, SLOT_KEYS.index(e["slot"])))
    return {"schedule": out, "unplaced": unplaced}


# --------------------------------------------------------------------------
# التحقق قبل التصدير
# --------------------------------------------------------------------------
def validate(plan: dict, structure: dict) -> dict:
    errors, warnings = [], []
    s, o = plan["school"], plan["officials"]
    if not (s.get("name") or "").strip():
        errors.append("اسم المدرسة فارغ.")
    if s.get("stage") not in STAGES:
        errors.append("المرحلة الدراسية غير محددة.")
    if not (s.get("region") or "").strip():
        errors.append("اسم المنطقة (الإدارة العامة للتعليم بمنطقة ...) فارغ.")
    if not (o.get("manager") or "").strip():
        errors.append("اسم مدير المدرسة فارغ.")
    if not (o.get("leader") or "").strip():
        errors.append("اسم رائد النشاط الطلابي فارغ.")
    try:
        start = hijri.parse(plan["calendar"]["week1_start"])
        if hijri.weekday_index(start) != 0:
            errors.append(f"تاريخ بداية الأسبوع الأول ({hijri.fmt(start)}) ليس يوم أحد، "
                          f"بل يوم {hijri.day_name(start)}.")
    except hijri.DateError as e:
        errors.append(f"تاريخ بداية الأسبوع الأول: {e}")
        return {"errors": errors, "warnings": warnings}

    lo, hi = semester_range(plan, structure)
    teachers = {t["id"]: t for t in plan["teachers"]}
    for t in plan["teachers"]:
        if not (t.get("name") or "").strip():
            errors.append("يوجد معلم بدون اسم.")
    for p in plan["programs"]:
        nm = (p.get("name") or "").strip()
        label = f"البرنامج «{nm}»" if nm else "برنامج"
        if not nm:
            errors.append("يوجد برنامج بدون اسم.")
        if p.get("mode", "sessions") == "sessions" and not p.get("teacher_id"):
            errors.append(f"{label} بدون معلم مسؤول.")
        elif p.get("teacher_id") and p["teacher_id"] not in teachers:
            errors.append(f"{label} مسند لمعلم غير موجود في قائمة المعلمين.")
        if p.get("date_required", True) and not p.get("start"):
            errors.append(f"{label} بدون تاريخ تنفيذ.")
        for key, nm_ in (("start", "تاريخ البداية"), ("end", "تاريخ النهاية")):
            if p.get(key):
                h = hijri.try_parse(p[key])
                if not h:
                    errors.append(f"{label}: {nm_} «{p[key]}» غير صحيح.")
                elif not (lo <= hijri.ordinal(h) <= hi):
                    errors.append(f"{label}: {nm_} {hijri.fmt(h)} خارج فترة الخطة.")
        if p.get("start") and p.get("end"):
            a, b = hijri.try_parse(p["start"]), hijri.try_parse(p["end"])
            if a and b and hijri.ordinal(b) < hijri.ordinal(a):
                errors.append(f"{label}: تاريخ النهاية قبل تاريخ البداية.")
        if p.get("domain") and p["domain"] not in ALL_DOMAINS:
            warnings.append(f"{label}: المجال «{p['domain']}» غير موجود في القالب.")
        if p.get("mode", "sessions") == "sessions" and _int(p.get("sessions")) <= 0:
            errors.append(f"{label}: عدد الحصص يجب أن يكون رقمًا أكبر من صفر.")

    for ts in teacher_summary(plan):
        if ts["remaining"] < 0:
            errors.append(f"المعلم «{ts['teacher']['name']}» تجاوز الحد المسموح: "
                          f"المتاح {ts['allowed']} حصص والمسند {ts['used']} حصص.")

    # السعات الثابتة في القالب (لا نضيف صفوفًا للجداول)
    rows_needed = sum(max(1, len(ts["rows"])) for ts in teacher_summary(plan))
    if rows_needed > structure["teacher_rows"]:
        errors.append(f"جدول إسناد البرامج في القالب يتسع لـ {structure['teacher_rows']} صفًا فقط، "
                      f"والمطلوب {rows_needed} صفًا.")
    for d in TEMPLATE_DOMAINS:
        n = len({p["name"] for p in plan["programs"] if p.get("domain") == d and p.get("name")})
        if n > structure["domain_rows"]:
            errors.append(f"مجال «{d}» يحتوي {n} برامج، وجدول المجالات في القالب يتسع لـ "
                          f"{structure['domain_rows']} فقط.")

    # التضارب في الجدولة
    seen, tbusy = {}, {}
    days = {(d["week"], d["day"]): d for d in calendar_days(plan, structure)}
    prog_names = {p["id"]: p.get("name", "") for p in plan["programs"]}
    for e in plan["schedule"]:
        d = days.get((e["week"], e["day"]))
        where = f"{d['day_name']} {d['date']}هـ - {SLOT_LABELS.get(e['slot'], e['slot'])}" if d else "?"
        if d and d["blocked"]:
            errors.append(f"برنامج مجدول في يوم محجوب في القالب ({where}).")
        k = (e["week"], e["day"], e["slot"])
        if k in seen and plan["settings"].get("prevent_conflicts", True):
            errors.append(f"تضارب: «{prog_names.get(seen[k], '')}» و«{prog_names.get(e['program_id'], '')}» "
                          f"في نفس الحصة ({where}).")
        seen[k] = e["program_id"]
        tid = e.get("teacher_id")
        if tid:
            tk = k + (tid,)
            if tk in tbusy and tbusy[tk] != e["program_id"]:
                errors.append(f"تضارب: المعلم «{teachers.get(tid, {}).get('name', '')}» لديه برنامجان في "
                              f"نفس الحصة ({where}).")
            tbusy[tk] = e["program_id"]
        if e.get("program_id") and e["program_id"] not in prog_names and not e.get("text"):
            errors.append(f"خانة مجدولة لبرنامج محذوف ({where}).")
    counts = {}
    for e in plan["schedule"]:
        counts[e.get("program_id")] = counts.get(e.get("program_id"), 0) + 1
    for p in plan["programs"]:
        if not p.get("name"):
            continue
        n = counts.get(p["id"], 0)
        if n == 0:
            warnings.append(f"البرنامج «{p['name']}» غير موزع على الجدول الأسبوعي.")
        elif p.get("mode", "sessions") == "sessions" and n < _int(p.get("sessions")):
            warnings.append(f"البرنامج «{p['name']}»: وُزعت {n} من {_int(p.get('sessions'))} حصص فقط.")
    return {"errors": errors, "warnings": warnings}


# --------------------------------------------------------------------------
# تحويل الخطة إلى قيم تُكتب في القالب
# --------------------------------------------------------------------------
def fill_values(plan: dict, structure: dict) -> dict:
    s, o = plan["school"], plan["officials"]
    st = STAGES.get(s.get("stage"), STAGES["intermediate"])
    school = (s.get("name") or "").strip()
    if school:
        line = f"{st['adj']} {school}" if s.get("prefix_stage", True) and not school.startswith(st["adj"]) else school
    else:
        line = st["adj"] + "…………………."
    start = hijri.parse(plan["calendar"]["week1_start"])
    dates = {}
    for w in structure["weeks"]:
        for d in w["days"]:
            dates[(w["index"], d["day"])] = hijri.fmt(hijri.add_days(start, 7 * w["index"] + d["day"]), suffix=False)

    teachers = {t["id"]: t for t in plan["teachers"]}
    progs = {p["id"]: p for p in plan["programs"]}
    cells = {}
    for e in plan["schedule"]:
        p = progs.get(e.get("program_id"))
        name = e.get("text") or (p.get("name") if p else "")
        t = teachers.get(e.get("teacher_id") or (p or {}).get("teacher_id"))
        cells[(e["week"], e["day"], e["slot"])] = {
            "program": name or "",
            "grade": e.get("grade") or (p or {}).get("grades") or (ALL_GRADES if name else ""),
            "teacher": e.get("teacher_name") if e.get("text") else (t["name"] if t else ""),
        }

    domain_rows = {}
    for d in TEMPLATE_DOMAINS:
        seen, rows = set(), []
        for p in plan["programs"]:
            if p.get("domain") == d and p.get("name") and p["name"] not in seen:
                seen.add(p["name"])
                rows.append({"name": p["name"], "sessions": str(_int(p.get("sessions"))) if p.get("sessions") not in (None, "") else ""})
        domain_rows[d] = rows

    teacher_rows = []
    for ts in teacher_summary(plan):
        t = ts["teacher"]
        base = {"name": t.get("name", ""), "subject": t.get("subject", ""), "allowed": str(ts["allowed"])}
        if not ts["rows"]:
            teacher_rows.append({**base, "program": "", "sessions": "", "start": "", "remaining": str(ts["allowed"])})
        for r in ts["rows"]:
            teacher_rows.append({**base, "program": r["program"], "sessions": str(r["sessions"]),
                                 "start": r["start"], "remaining": str(r["remaining"])})

    return {
        "region": (s.get("region") or "").strip(),
        "school_line": line,
        "stage_table": st["table"],
        # قيمة فارغة = يبقى نص القالب (النقاط) كما هو
        "manager": (o.get("manager") or "").strip() or None,
        "leader": (o.get("leader") or "").strip() or None,
        "year_start": str(s.get("year_start") or 1448),
        "year_end": str(s.get("year_end") or 1449),
        "semester": int(s.get("semester") or 1),
        "semester_word": SEMESTERS.get(int(s.get("semester") or 1), "الأول"),
        "dates": dates,
        "cells": cells,
        "domain_rows": domain_rows,
        "teacher_rows": teacher_rows,
    }
