"""خريطة القالب: تحديد مواضع البيانات الديناميكية داخل XML ملف Word.

التحديد يتم بالمحتوى (نصوص العناوين الثابتة) وليس بأرقام ثابتة، لذلك يقرأ
كل جدول فعليًا ولا يفترض أن الأسابيع متطابقة البنية.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .ooxml import (NS, cell_text, grid_cells, norm, own_text_nodes, para_text, q,
                    tc_width, tr_height, vmerge)

DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]

# خانات اليوم الدراسي كما في الجدول الأسبوعي (بالترتيب الزمني)
SLOTS = [
    ("morning", "الحضور والاصطفاف الصباحي", "الحضور"),
    ("p1", "الأولى", "الأولى"),
    ("p2", "الثانية", "الثانية"),
    ("routine", "الروتين اليومي", "الروتين"),
    ("p3", "الثالثة", "الثالثة"),
    ("p4", "الرابعة", "الرابعة"),
    ("p5", "الخامسة", "الخامسة"),
    ("p6", "السادسة", "السادسة"),
    ("p7", "السابعة", "السابعة"),
    ("prayer", "صلاة الظهر والمناوبة", "صلاة"),
]
SLOT_KEYS = [s[0] for s in SLOTS]
SLOT_LABELS = {s[0]: s[1] for s in SLOTS}
ROLE_LABELS = {"البرنامج": "program", "الصف": "grade", "اسمالمعلم": "teacher"}

# مجالات النشاط كما وردت حرفيًا في القالب
TEMPLATE_DOMAINS = ["المواطنة والحياة", "الثقافة والفنون", "الرياضة والصحة",
                    "العلوم والتقنية", "النشاط الكشفي", "الأيام والمناسبات"]

TEACHER_COLS = {
    "name": "اسمالمعلم",
    "subject": "مادةالتدريس",
    "allowed": "عددالحصص",
    "program": "اسمالبرنامج",
    "sessions": "عددحصصالبرنامج",
    "start": "تاريخبداية",
    "remaining": "المتبقي",
}


@dataclass
class DayMap:
    week: int
    day: int
    name: str
    date_par: object
    date_text: str
    blocked: bool
    cells: dict = field(default_factory=dict)  # role -> slot -> (tc, tr)


@dataclass
class WeekMap:
    index: int
    label: str
    table: object
    days: list
    ref_ppr: object = None
    ref_rpr: object = None


@dataclass
class TextboxSlot:
    key: str
    paragraphs: list  # فقرة القيمة في Choice وفي Fallback
    width_pt: float


@dataclass
class TemplateMap:
    weeks: list
    domain_table: dict | None
    teacher_table: dict | None
    cover_region: object | None
    cover_school: object | None
    header_regions: list
    textboxes: dict
    stage_par: object | None


def _day_index(text: str):
    t = norm(text)
    for i, d in enumerate(DAY_NAMES):
        if t.startswith(norm(d)):
            return i
    return None


def _week_label(table):
    """رقم الأسبوع من مربع النص المرافق للجدول (قبله مباشرة)."""
    prev = table.getprevious()
    hops = 0
    while prev is not None and hops < 4:
        for tb in prev.iter(q("w:txbxContent")):
            txt = "".join(t.text or "" for t in tb.iter(q("w:t"))).strip()
            if txt:
                return txt
        prev = prev.getprevious()
        hops += 1
    return ""


def _map_week(table, index, fallback_ref):
    rows = table.findall(q("w:tr"))
    header_i, slot_grid, label_g, day_g = None, {}, None, None
    for i, tr in enumerate(rows):
        cells = grid_cells(tr)
        texts = [norm(cell_text(tc)) for _, _, tc in cells]
        if any(t.startswith("الأولى") for t in texts):
            header_i = i
            for (g, span, tc), t in zip(cells, texts):
                for key, _, probe in SLOTS:
                    if t.startswith(norm(probe)):
                        slot_grid[key] = g
                if t.startswith("اليوم"):
                    # خلية «اليوم / الحصة» تغطي عمود التسمية وعمود اليوم
                    label_g, day_g = (g, g + span - 1) if span > 1 else (g - 1, g)
            break
    if header_i is None:
        return None
    ref_ppr = ref_rpr = None
    days = []
    cur = None
    for tr in rows[header_i + 1:]:
        cells = grid_cells(tr)
        if not cells:
            continue
        by_grid = {g: (span, tc) for g, span, tc in cells}
        if day_g not in by_grid:
            continue
        day_tc = by_grid[day_g][1]
        vm = vmerge(day_tc)
        di = _day_index(cell_text(day_tc)) if vm != "continue" else None
        if di is not None:
            date_par, date_text = None, ""
            for p in day_tc.findall(q("w:p")):
                if re.search(r"\d+/\d+/\d+", para_text(p)):
                    date_par, date_text = p, para_text(p)
            cur = DayMap(index, di, DAY_NAMES[di], date_par, date_text, False)
            days.append(cur)
        if cur is None:
            continue
        label_tc = by_grid[label_g][1] if label_g in by_grid else None
        role = ROLE_LABELS.get(norm(cell_text(label_tc))) if label_tc is not None else None
        if role is None:
            cur.blocked = True  # يوم بلا تسميات (إجازة/حدث مدمج)
            continue
        covered = set()
        for g, span, tc in cells:
            if g >= label_g:
                continue
            if span > 1 or vmerge(tc) is not None:
                covered.update(range(g, g + span))
        slots = {}
        for key, g in slot_grid.items():
            if g in covered or g not in by_grid:
                cur.blocked = True
                continue
            span, tc = by_grid[g]
            slots[key] = (tc, tr)
            if ref_rpr is None and role == "program" and cell_text(tc).strip():
                p = tc.find(q("w:p"))
                r = p.find(q("w:r")) if p is not None else None
                if r is not None and r.find(q("w:rPr")) is not None:
                    ref_ppr = p.find(q("w:pPr"))
                    ref_rpr = r.find(q("w:rPr"))
        cur.cells[role] = slots
    if ref_rpr is None and fallback_ref:
        ref_ppr, ref_rpr = fallback_ref
    return WeekMap(index, _week_label(table), table, days, ref_ppr, ref_rpr)


def _map_domain_table(table):
    rows = table.findall(q("w:tr"))
    for i, tr in enumerate(rows):
        cells = grid_cells(tr)
        texts = [norm(cell_text(tc)) for _, _, tc in cells]
        if "المجال" in texts and any(t == "عددالحصص" for t in texts):
            domains = []
            for (g, span, tc), t in zip(cells, texts):
                for d in TEMPLATE_DOMAINS:
                    if t == norm(d):
                        domains.append({"domain": d, "name_grid": g, "count_grid": g - 1})
            data_rows = []
            for tr2 in rows[i + 1:]:
                by_grid = {g: tc for g, span, tc in grid_cells(tr2)}
                data_rows.append((tr2, by_grid))
            stage_par = None
            for tr0 in rows[:i]:
                for tc in tr0.findall(q("w:tc")):
                    for p in tc.findall(q("w:p")):
                        if "المرحلة" in norm(para_text(p)):
                            stage_par = p
            return {"table": table, "domains": domains, "rows": data_rows, "stage_par": stage_par}
    return None


def _map_teacher_table(table):
    rows = table.findall(q("w:tr"))
    for i, tr in enumerate(rows):
        cells = grid_cells(tr)
        texts = [norm(cell_text(tc)) for _, _, tc in cells]
        if "اسمالمعلم" in texts and "مادةالتدريس" in texts:
            cols = {}
            for (g, span, tc), t in zip(cells, texts):
                for key, probe in TEACHER_COLS.items():
                    if key in cols:
                        continue
                    if key == "sessions" and t.startswith(probe):
                        cols[key] = g
                    elif key == "allowed" and t.startswith(probe) and "برنامج" not in t:
                        cols[key] = g
                    elif key not in ("sessions", "allowed") and t.startswith(probe):
                        cols[key] = g
            data_rows = [(tr2, {g: tc for g, span, tc in grid_cells(tr2)}) for tr2 in rows[i + 1:]]
            return {"table": table, "cols": cols, "rows": data_rows}
    return None


def _textbox_width(p):
    """عرض مربع النص بالنقاط من wp:extent (DrawingML)."""
    anc = p.getparent()
    while anc is not None:
        if anc.tag in (q("wp:anchor"), q("wp:inline")):
            ext = anc.find(q("wp:extent"))
            if ext is not None:
                return int(ext.get("cx")) / 12700.0 - 14.4
        anc = anc.getparent()
    return None


def _map_textboxes(root):
    """يبحث في مربعات النص عن تسمية ثابتة ثم فقرة القيمة التي تليها."""
    labels = {"مديرالمدرسة": "manager", "رائدالنشاطالطلابي": "leader", "الفصل": "semester_no"}
    found = {}
    for tb in root.iter(q("w:txbxContent")):
        paras = tb.findall(q("w:p"))
        for i, p in enumerate(paras[:-1]):
            key = labels.get(norm(para_text(p)))
            if key:
                val_p = paras[i + 1]
                slot = found.setdefault(key, TextboxSlot(key, [], 0.0))
                slot.paragraphs.append(val_p)
                w = _textbox_width(val_p)
                if w and (not slot.width_pt or w < slot.width_pt):
                    slot.width_pt = w
    return found


def build_map(pkg) -> TemplateMap:
    doc = pkg.xml("word/document.xml")
    body = doc.find(q("w:body"))
    tables = body.findall(q("w:tbl"))
    weeks, domain_table, teacher_table = [], None, None
    fallback = None
    for t in tables:
        txt = norm("".join(x.text or "" for x in t.iter(q("w:t"))))
        if "الحصصالدراسية" in txt:
            wm = _map_week(t, len(weeks), fallback)
            if wm:
                weeks.append(wm)
                if fallback is None and wm.ref_rpr is not None:
                    fallback = (wm.ref_ppr, wm.ref_rpr)
        elif domain_table is None and "المجال" in txt and "عددالحصص" in txt:
            domain_table = _map_domain_table(t)
        elif teacher_table is None and "اسمالمعلم" in txt and "مادةالتدريس" in txt:
            teacher_table = _map_teacher_table(t)

    # الغلاف: الفقرات قبل أول جدول
    cover_region = cover_school = None
    for el in body:
        if el.tag == q("w:tbl"):
            break
        if el.tag != q("w:p"):
            continue
        t = norm(para_text(el))
        if cover_region is None and "بمنطقة" in t:
            cover_region = el
        elif cover_region is not None and cover_school is None and t:
            cover_school = el

    header_regions = []
    for name in pkg.parts("word/header"):
        root = pkg.xml(name)
        for p in root.iter(q("w:p")):
            if "بمنطقة" in norm(para_text(p)):
                header_regions.append(p)

    textboxes = _map_textboxes(doc)
    return TemplateMap(weeks, domain_table, teacher_table, cover_region, cover_school,
                       header_regions, textboxes,
                       domain_table["stage_par"] if domain_table else None)


def structure_summary(tmap: TemplateMap) -> dict:
    """ملخص بنية القالب لواجهة المستخدم (الأسابيع والأيام المتاحة والسعات)."""
    return {
        "weeks": [
            {
                "index": w.index,
                "label": w.label,
                "days": [
                    {"day": d.day, "name": d.name, "date": d.date_text.replace("هـ", "").strip(),
                     "blocked": d.blocked,
                     "slots": sorted(d.cells.get("program", {}).keys(), key=SLOT_KEYS.index)}
                    for d in w.days
                ],
            }
            for w in tmap.weeks
        ],
        "domain_rows": len(tmap.domain_table["rows"]) if tmap.domain_table else 0,
        "teacher_rows": len(tmap.teacher_table["rows"]) if tmap.teacher_table else 0,
        "slots": [{"key": k, "label": SLOT_LABELS[k]} for k in SLOT_KEYS],
        "domains": TEMPLATE_DOMAINS,
    }
