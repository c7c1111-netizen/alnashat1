"""تعبئة قالب Word الأصلي بالبيانات (Template-based DOCX generation).

الخطوات:
1. تُقرأ حزمة القالب الأصلي كما هي (لا يُنشأ مستند جديد).
2. تُحدد مواضع البيانات الديناميكية بخريطة القالب.
3. تُكتب القيم في عقد النص <w:t> فقط، ويُصغَّر حجم الخط عند الحاجة
   ليتسع النص في مساحته دون تغيير أبعاد الجدول.
4. تُحفظ الحزمة: الأجزاء المعدلة فقط تُعاد كتابتها، وكل ما عداها يُنسخ
   بايتًا ببايت (الصور، الأنماط، السمة، التذييل، الخطوط...).
"""
from __future__ import annotations

import re

from . import fit
from .ooxml import (DocxPackage, has_arabic, set_t, set_run_scale, norm, own_text_nodes, para_text, q, replace_in_paragraph,
                    run_scale, run_size, set_after_anchor, set_paragraph_value, set_run_size,
                    tc_width, tr_height, wattr)
from .template_map import TEMPLATE_DOMAINS, build_map

RLM = "\u200f"


class FillReport:
    def __init__(self):
        self.changes = 0
        self.fitted = []  # نصوص صُغّر خطها لتتسع
        self.overflow = []  # نصوص لم تتسع حتى بأصغر خط مسموح
        self.dynamic = []  # مواضع ديناميكية (للمقارنة الآلية)

    def as_dict(self):
        return {"changes": self.changes, "fitted": self.fitted, "overflow": self.overflow}


def _text_runs(p):
    return [r for r in p.findall(q("w:r")) if any((t.text or "") for t in r.findall(q("w:t")))]


def _fit_paragraph(p, width_pt, height_pt, report, where, max_lines=None, min_hp=12, enabled=True,
                   mode="size"):
    """mode="size": تصغير حجم الخط (داخل خلايا الجداول: لا يؤثر على ارتفاع الصف).
    mode="scale": تضييق عرض الحروف مع بقاء الحجم (للفقرات المتدفقة كسطور الغلاف،
    حتى لا يتغير ارتفاع السطر ولا يتحرك أي عنصر بعدها)."""
    if not enabled:
        return
    runs = _text_runs(p)
    text = para_text(p)
    if not runs or not text.strip():
        return
    cs = has_arabic(text)
    base = max(run_size(r, complex_script=cs) for r in runs)
    scale = max(run_scale(r) for r in runs)
    ind = p.find("w:pPr/w:ind", {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"})
    if ind is not None:
        for side in ("left", "right", "start", "end"):
            v = ind.get(q("w:" + side))
            if v and v.lstrip("-").isdigit():
                width_pt -= int(v) / 20.0
    if mode == "scale":
        pct, ok = fit.fit_scale(text, base / 2.0, width_pt, scale)
        if pct < round(scale * 100):
            for r in runs:
                set_run_scale(r, pct)
            report.fitted.append({"where": where, "text": text.strip(RLM + " "),
                                  "from_pt": base / 2, "to_pt": base / 2, "width_pct": pct})
        if not ok:
            report.overflow.append({"where": where, "text": text.strip(RLM + " ")})
        return
    size, ok = fit.fit_size(text, base, width_pt, height_pt, max_lines=max_lines,
                            min_half_pts=min(min_hp, base), scale=scale)
    if size < base:
        for r in runs:
            set_run_size(r, min(size, run_size(r, complex_script=cs)))
        report.fitted.append({"where": where, "text": text.strip(RLM + " "),
                              "from_pt": base / 2, "to_pt": size / 2})
    if not ok:
        report.overflow.append({"where": where, "text": text.strip(RLM + " ")})


def _set_cell(tc, tr, value, ref_ppr, ref_rpr, report, where, fit_on=True, prefix=RLM + " ",
              max_lines=None):
    p = tc.find(q("w:p"))
    if p is None:
        return
    shown = (prefix + value) if value else ""
    current = para_text(p)
    # إذا كانت القيمة مطابقة لما في القالب (مع/بدون علامة الاتجاه) لا نلمس الخلية
    if current.replace(RLM, "").strip() == (value or "").strip():
        return
    if set_paragraph_value(p, shown, ref_ppr, ref_rpr):
        report.changes += 1
        # فقرات إضافية في نفس الخلية تُفرغ نصوصها
        for extra in tc.findall(q("w:p"))[1:]:
            for t in own_text_nodes(extra):
                if t.text:
                    t.text = ""
        _fit_paragraph(p, tc_width(tc) / 20.0 - 2, tr_height(tr) / 20.0, report, where,
                       max_lines=max_lines, enabled=fit_on)


def fill_docx(template_path, out_path, values: dict, fit_on: bool = True) -> FillReport:
    pkg = DocxPackage(template_path)
    tmap = build_map(pkg)
    rep = FillReport()
    doc = pkg.xml("word/document.xml")

    # ---------------- المنطقة: الترويسة + الغلاف ----------------
    if values.get("region"):
        for p in tmap.header_regions:
            if set_after_anchor(p, "بمنطقة", values["region"]):
                rep.changes += 1
        if tmap.cover_region is not None:
            if set_after_anchor(tmap.cover_region, "بمنطقة", values["region"]):
                rep.changes += 1

    # ---------------- سطر المرحلة + اسم المدرسة في الغلاف ----------------
    if tmap.cover_school is not None and values.get("school_line"):
        p = tmap.cover_school
        if para_text(p) != values["school_line"]:
            set_paragraph_value(p, values["school_line"])
            rep.changes += 1
            sect_w = _section_text_width(doc)
            _fit_paragraph(p, sect_w, None, rep, "الغلاف: سطر المدرسة", max_lines=1, enabled=fit_on,
                           mode="scale")

    # ---------------- المرحلة في جدول مجالات النشاط ----------------
    if tmap.stage_par is not None and values.get("stage_table"):
        p = tmap.stage_par
        nodes = own_text_nodes(p)
        if len(nodes) >= 2:
            new = " " + values["stage_table"]
            if "".join(n.text or "" for n in nodes[1:]) != new and norm("".join(n.text or "" for n in nodes[1:])) != norm(values["stage_table"]):
                set_t(nodes[1], new)
                for n in nodes[2:]:
                    n.text = ""
                rep.changes += 1
                tc = p.getparent()
                tr = tc.getparent()
                _fit_paragraph(p, tc_width(tc) / 20.0, tr_height(tr) / 20.0, rep,
                               "جدول المجالات: المرحلة", max_lines=1, enabled=fit_on, mode="scale")

    # ---------------- مربعات النص: المدير، رائد النشاط، رقم الفصل ----------------
    for key, val in (("manager", values.get("manager")), ("leader", values.get("leader")),
                     ("semester_no", str(values.get("semester") or ""))):
        slot = tmap.textboxes.get(key)
        if not slot or not val:
            continue
        for p in slot.paragraphs:
            if para_text(p) != val:
                set_paragraph_value(p, val)
                rep.changes += 1
                if key != "semester_no":
                    _fit_paragraph(p, slot.width_pt or 120, None, rep, f"الغلاف: {key}",
                                   max_lines=1, enabled=fit_on, mode="scale")

    # ---------------- العام الدراسي والفصل (في كل الأجزاء) ----------------
    ys, ye, sem = values.get("year_start"), values.get("year_end"), values.get("semester_word")
    roots = [("word/document.xml", doc)] + [(n, pkg.xml(n)) for n in pkg.parts("word/header")]
    for name, root in roots:
        for p in root.iter(q("w:p")):
            t = para_text(p)
            if not t:
                continue
            n = 0
            if ys and ye and "العام الدراسي" in t and re.search(r"1\d{3}", t):
                counter = iter([ys, ye])
                n += replace_in_paragraph(p, r"1\d{3}", lambda m: next(counter, m.group(0)))
            if sem and "الفصل الدراسي" in t:
                n += replace_in_paragraph(p, r"(الفصل الدراسي\s+)(الأول|الثاني|الثالث)",
                                          lambda m: m.group(1) + sem)
            rep.changes += n

    # ---------------- الجداول الأسبوعية ----------------
    dates = values.get("dates", {})
    cells = values.get("cells", {})
    for w in tmap.weeks:
        for d in w.days:
            new_date = dates.get((w.index, d.day))
            if new_date and d.date_par is not None:
                if replace_in_paragraph(d.date_par, r"\d+/\d+/\d+", lambda m: new_date):
                    rep.changes += 1
            if d.blocked:
                continue
            for role in ("program", "grade", "teacher"):
                for slot, (tc, tr) in d.cells.get(role, {}).items():
                    val = cells.get((w.index, d.day, slot), {}).get(role, "")
                    # عدد الأسطر المسموح يُحسب من ارتفاع الصف الثابت في القالب
                    # (سطر واحد بحجم 11، وسطران عند الخطوط الصغيرة) فلا يتمدد الصف
                    _set_cell(tc, tr, val, w.ref_ppr, w.ref_rpr, rep,
                              f"الأسبوع {w.label} - {d.name} - {slot} - {role}", fit_on)

    ref_ppr = tmap.weeks[0].ref_ppr if tmap.weeks else None
    ref_rpr = tmap.weeks[0].ref_rpr if tmap.weeks else None

    # ---------------- جدول برامج النشاط حسب المجال ----------------
    dt = tmap.domain_table
    if dt:
        rows = values.get("domain_rows", {})
        for dom in dt["domains"]:
            progs = rows.get(dom["domain"], [])
            for i, (tr, by_grid) in enumerate(dt["rows"]):
                item = progs[i] if i < len(progs) else {"name": "", "sessions": ""}
                for key, g in (("name", dom["name_grid"]), ("sessions", dom["count_grid"])):
                    tc = by_grid.get(g)
                    if tc is not None:
                        _set_cell(tc, tr, item[key], ref_ppr, ref_rpr, rep,
                                  f"جدول المجالات - {dom['domain']} - {i + 1}", fit_on)

    # ---------------- جدول إسناد البرامج للمعلمين ----------------
    tt = tmap.teacher_table
    if tt:
        trows = values.get("teacher_rows", [])
        for i, (tr, by_grid) in enumerate(tt["rows"]):
            item = trows[i] if i < len(trows) else {}
            for key, g in tt["cols"].items():
                tc = by_grid.get(g)
                if tc is not None:
                    _set_cell(tc, tr, str(item.get(key, "") or ""), ref_ppr, ref_rpr, rep,
                              f"جدول الإسناد - صف {i + 1} - {key}", fit_on, max_lines=1)

    pkg.save(out_path)
    return rep


def _section_text_width(doc) -> float:
    """عرض النص للقسم الأول (الغلاف) بالنقاط."""
    sect = doc.find(".//w:sectPr", {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"})
    if sect is None:
        return 780.0
    pg = sect.find(q("w:pgSz"))
    mar = sect.find(q("w:pgMar"))
    w = int(wattr(pg, "w")) - int(wattr(mar, "left")) - int(wattr(mar, "right"))
    return w / 20.0


def extract_template_data(template_path) -> dict:
    """يقرأ البيانات النموذجية الموجودة في القالب (برامج الأسابيع) كبيانات بداية."""
    pkg = DocxPackage(template_path)
    tmap = build_map(pkg)
    cells = {}
    for w in tmap.weeks:
        for d in w.days:
            if d.blocked:
                continue
            for role in ("program", "grade", "teacher"):
                for slot, (tc, tr) in d.cells.get(role, {}).items():
                    t = para_text(tc.find(q("w:p"))).replace(RLM, "").strip() if tc.find(q("w:p")) is not None else ""
                    if t:
                        cells.setdefault((w.index, d.day, slot), {})[role] = t
    region = ""
    if tmap.header_regions:
        region = para_text(tmap.header_regions[0]).split("بمنطقة")[-1].strip()
    return {"cells": cells, "region": region}
