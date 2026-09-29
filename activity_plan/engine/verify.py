"""اختبار التطابق الآلي بين MASTER TEMPLATE والملف الناتج.

المستويات:
1. الحزمة: كل أجزاء الملف (الصور، الأنماط، السمة، التذييل، الإعدادات،
   الخطوط...) يجب أن تكون متطابقة بايتًا ببايت، عدا document.xml و header.
2. XML: مقارنة شجرة المستند عنصرًا بعنصر. أي اختلاف خارج «المناطق
   الديناميكية» يُعد فشلًا. داخل المناطق الديناميكية يُسمح فقط بتغيير النص
   وحجم الخط، وبإضافة مقطع نصي في خلية كانت فارغة.
3. المقاييس: الأقسام، حجم الصفحة، الهوامش، الجداول، عرض الأعمدة، ارتفاع
   الصفوف، الخطوط، الألوان، الصور، الأشكال، فواصل الصفحات.
4. بصريًا (PDF): عدد الصفحات، مقاسها، وكل الرسوميات المتجهة (حدود الجداول،
   الخلفيات، الأشكال) ومواقع الصور صفحةً صفحة، ونسبة البكسلات المتغيرة خارج
   مواضع النص.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import zipfile

from lxml import etree

from .ooxml import NS, DocxPackage, own_text_nodes, q
from .template_map import build_map

DYNAMIC_XML_PARTS = ("word/document.xml",)
_MASKS = [(re.compile(r"1\d{3}"), "####"),
          (re.compile(r"الأول|الثاني|الثالث"), "<ORD>")]


def _mask(s):
    for rx, rep in _MASKS:
        s = rx.sub(rep, s or "")
    return s


# ----------------------------------------------------------------------------
# المناطق الديناميكية (تُحدد من خريطة القالب الأصلي)
# ----------------------------------------------------------------------------
def dynamic_paths(pkg) -> dict:
    """{part: {xpath: kind}} للفقرات التي يُسمح بتغيير نصها."""
    tmap = build_map(pkg)
    doc = pkg.xml("word/document.xml")
    dtree = doc.getroottree()
    paths = {"word/document.xml": {}}

    def add(el, kind, part="word/document.xml", tree=dtree):
        paths.setdefault(part, {})[tree.getpath(el)] = kind

    for w in tmap.weeks:
        for d in w.days:
            if d.date_par is not None:
                add(d.date_par, "date")
            for role in d.cells.values():
                for tc, tr in role.values():
                    for p in tc.findall(q("w:p")):
                        add(p, "cell")
    if tmap.domain_table:
        for tr, by_grid in tmap.domain_table["rows"]:
            for tc in by_grid.values():
                for p in tc.findall(q("w:p")):
                    add(p, "cell")
    if tmap.teacher_table:
        for tr, by_grid in tmap.teacher_table["rows"]:
            for tc in by_grid.values():
                for p in tc.findall(q("w:p")):
                    add(p, "cell")
    for el, kind in ((tmap.cover_region, "text"), (tmap.cover_school, "text"), (tmap.stage_par, "text")):
        if el is not None:
            add(el, kind)
    for slot in tmap.textboxes.values():
        for p in slot.paragraphs:
            add(p, "text")
    for name in pkg.parts("word/header"):
        root = pkg.xml(name)
        tree = root.getroottree()
        for p in tmap.header_regions:
            if p.getroottree() is tree:
                add(p, "text", name, tree)
    return paths


# ----------------------------------------------------------------------------
# المقارنة البنيوية
# ----------------------------------------------------------------------------
def _strip_size(rpr):
    if rpr is None:
        return None
    c = etree.fromstring(etree.tostring(rpr))
    for tag in ("w:sz", "w:szCs", "w:w"):
        for el in c.findall(q(tag)):
            c.remove(el)
    return etree.tostring(c, method="c14n")


def _canon(el):
    return etree.tostring(el, method="c14n")


class XmlDiff:
    def __init__(self):
        self.violations = []  # اختلافات غير مسموحة
        self.text_changes = 0  # تغييرات نصية مسموحة
        self.size_changes = 0
        self.added_runs = 0

    def bad(self, path, msg):
        if len(self.violations) < 200:
            self.violations.append({"path": path, "issue": msg})


def _compare_dynamic_paragraph(tp, op, path, diff: XmlDiff, ref_styles):
    t_children = list(tp)
    o_children = list(op)
    t_runs = [c for c in t_children if c.tag == q("w:r")]
    t_other = [c for c in t_children if c.tag not in (q("w:r"), q("w:pPr"))]
    o_other = [c for c in o_children if c.tag not in (q("w:r"), q("w:pPr"))]
    if [_canon(c) for c in t_other] != [_canon(c) for c in o_other]:
        diff.bad(path, "عناصر غير نصية داخل الفقرة تغيّرت")
    t_ppr, o_ppr = tp.find(q("w:pPr")), op.find(q("w:pPr"))
    if t_ppr is not None and (o_ppr is None or _canon(t_ppr) != _canon(o_ppr)):
        diff.bad(path, "خصائص الفقرة تغيّرت")
    if t_ppr is None and o_ppr is not None and _canon(o_ppr) not in ref_styles["ppr"]:
        diff.bad(path, "أضيفت خصائص فقرة غير مأخوذة من القالب")
    o_runs = [c for c in o_children if c.tag == q("w:r")]
    allowed_rpr = {_strip_size(r.find(q("w:rPr"))) for r in t_runs} | ref_styles["rpr"]
    if len(o_runs) != len(t_runs):
        if t_runs and any(t.text for r in t_runs for t in r.iter(q("w:t"))):
            diff.bad(path, "تغيّر عدد المقاطع في فقرة كانت تحتوي نصًا")
        else:
            diff.added_runs += len(o_runs) - len(t_runs)
    for i, orun in enumerate(o_runs):
        rs = _strip_size(orun.find(q("w:rPr")))
        if rs not in allowed_rpr:
            diff.bad(path, "تنسيق مقطع (خط/لون/وزن) غير موجود في القالب")
        if i < len(t_runs):
            ts = t_runs[i].find(q("w:rPr"))
            os_ = orun.find(q("w:rPr"))
            a = _canon(ts) if ts is not None else None
            b = _canon(os_) if os_ is not None else None
            if a != b:
                diff.size_changes += 1
            # أي محتوى غير نصي داخل المقطع (رسم، مربع نص، فاصل) يجب أن يبقى كما هو
            skip = (q("w:rPr"), q("w:t"))
            if [_canon(c) for c in t_runs[i] if c.tag not in skip] != [_canon(c) for c in orun if c.tag not in skip]:
                diff.bad(path, "محتوى غير نصي داخل مقطع تغيّر")
    t_text = "".join(t.text or "" for t in own_text_nodes(tp))
    o_text = "".join(t.text or "" for t in own_text_nodes(op))
    if t_text != o_text:
        diff.text_changes += 1


def _walk(t, o, path, dyn, diff, tree_t, ref_styles):
    p = tree_t.getpath(t)
    if p in dyn:
        if t.tag != o.tag:
            diff.bad(p, "نوع العنصر تغيّر")
            return
        _compare_dynamic_paragraph(t, o, p, diff, ref_styles)
        # مربعات النص داخل الفقرة (إن وجدت) تُقارن كالمعتاد
        return
    if t.tag != o.tag:
        diff.bad(p, f"عنصر مختلف: {etree.QName(t).localname} ≠ {etree.QName(o).localname}")
        return
    if dict(t.attrib) != dict(o.attrib):
        diff.bad(p, f"سمات العنصر {etree.QName(t).localname} تغيّرت")
    if t.tag == q("w:t"):
        if (t.text or "") != (o.text or ""):
            if _mask(t.text) == _mask(o.text):
                diff.text_changes += 1  # العام الدراسي/الفصل
            else:
                diff.bad(p, f"نص ثابت تغيّر: «{t.text}» ← «{o.text}»")
    elif (t.text or "").strip() != (o.text or "").strip():
        diff.bad(p, "محتوى عنصر تغيّر")
    tc, oc = list(t), list(o)
    if len(tc) != len(oc):
        diff.bad(p, f"عدد العناصر الفرعية تغيّر ({len(tc)} ← {len(oc)})")
        return
    for a, b in zip(tc, oc):
        _walk(a, b, path, dyn, diff, tree_t, ref_styles)


def _ref_styles(pkg):
    tmap = build_map(pkg)
    ppr, rpr = set(), set()
    for w in tmap.weeks:
        if w.ref_ppr is not None:
            ppr.add(_canon(w.ref_ppr))
        if w.ref_rpr is not None:
            rpr.add(_strip_size(w.ref_rpr))
    return {"ppr": ppr, "rpr": rpr}


# ----------------------------------------------------------------------------
# المقاييس
# ----------------------------------------------------------------------------
def metrics(path) -> dict:
    pkg = DocxPackage(path)
    doc = pkg.xml("word/document.xml")
    W = NS["w"]
    sects = doc.findall(".//w:sectPr", NS)
    tbls = doc.findall(".//w:tbl", NS)

    def attrs(el):
        return {etree.QName(k).localname: v for k, v in el.attrib.items()} if el is not None else {}

    fonts, colors, fills = set(), set(), set()
    for root in [doc] + [pkg.xml(n) for n in pkg.parts("word/header")]:
        for f in root.iter(q("w:rFonts")):
            for k, v in f.attrib.items():
                if etree.QName(k).localname in ("ascii", "hAnsi", "cs", "eastAsia"):
                    fonts.add(v)
        colors |= {e.get(q("w:val")) for e in root.iter(q("w:color"))}
        fills |= {e.get(q("w:fill")) for e in root.iter(q("w:shd"))}
        colors |= {e.get("val") for e in root.iter("{%s}srgbClr" % NS["a"])}
    media = {n: hashlib.sha256(d).hexdigest()[:16] for n, d in pkg.raw.items() if n.startswith("word/media/")}
    return {
        "sections": len(sects),
        "page_size": [attrs(s.find("w:pgSz", NS)) for s in sects],
        "margins": [attrs(s.find("w:pgMar", NS)) for s in sects],
        "tables": len(tbls),
        "grid_columns": [[g.get(q("w:w")) for g in t.findall("w:tblGrid/w:gridCol", NS)] for t in tbls],
        "row_heights": [[(tr.find("w:trPr/w:trHeight", NS).get(q("w:val")) if tr.find("w:trPr/w:trHeight", NS) is not None else None)
                         for tr in t.findall("w:tr", NS)] for t in tbls],
        "cell_widths": [[tc.find("w:tcPr/w:tcW", NS).get(q("w:w")) for tc in t.iter(q("w:tc")) if tc.find("w:tcPr/w:tcW", NS) is not None] for t in tbls],
        "merged_cells": sum(1 for _ in doc.iter(q("w:gridSpan"))) + sum(1 for _ in doc.iter(q("w:vMerge"))),
        "page_breaks": len(doc.xpath(".//w:br[@w:type='page']", namespaces=NS)),
        "drawings": len(doc.findall(".//w:drawing", NS)),
        "textboxes": len(doc.findall(".//w:txbxContent", NS)),
        "vml_shapes": len(doc.findall(".//w:pict", NS)),
        "images": media,
        "fonts": sorted(f for f in fonts if f),
        "colors": sorted(c for c in colors if c),
        "fills": sorted(c for c in fills if c),
        "paragraphs": len(doc.findall(".//w:p", NS)),
    }


# ----------------------------------------------------------------------------
# المقارنة البصرية (PDF)
# ----------------------------------------------------------------------------
def compare_pdfs(pdf_a, pdf_b, out_dir=None, dpi=60) -> dict:
    import numpy as np
    import pymupdf

    a, b = pymupdf.open(pdf_a), pymupdf.open(pdf_b)
    res = {"pages_template": a.page_count, "pages_output": b.page_count, "pages": []}
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    for i in range(min(a.page_count, b.page_count)):
        pa, pb = a[i], b[i]
        info = {"page": i + 1, "size_equal": tuple(round(x, 1) for x in pa.rect) == tuple(round(x, 1) for x in pb.rect)}

        def vec(page):
            out = []
            for d in page.get_drawings():
                r = d["rect"]
                out.append((round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1),
                            str(d.get("fill")), str(d.get("color"))))
            return sorted(out)

        va, vb = vec(pa), vec(pb)
        info["vector_items"] = len(va)
        info["vectors_equal"] = va == vb
        if not info["vectors_equal"]:
            sa, sb = set(va), set(vb)
            info["vectors_diff"] = len(sa ^ sb)
        ia = sorted((round(x["bbox"][0]), round(x["bbox"][1]), round(x["bbox"][2]), round(x["bbox"][3])) for x in pa.get_image_info())
        ib = sorted((round(x["bbox"][0]), round(x["bbox"][1]), round(x["bbox"][2]), round(x["bbox"][3])) for x in pb.get_image_info())
        info["images_equal"] = ia == ib
        # البكسلات المتغيرة خارج مواضع النص
        xa = pa.get_pixmap(dpi=dpi)
        xb = pb.get_pixmap(dpi=dpi)
        A = np.frombuffer(xa.samples, dtype=np.uint8).reshape(xa.height, xa.width, xa.n)[:, :, :3].astype(int)
        B = np.frombuffer(xb.samples, dtype=np.uint8).reshape(xb.height, xb.width, xb.n)[:, :, :3].astype(int)
        if A.shape != B.shape:
            info["pixel_diff_pct"] = 100.0
            res["pages"].append(info)
            continue
        changed = np.abs(A - B).sum(axis=2) > 60
        mask = np.zeros(changed.shape, bool)
        s = dpi / 72.0
        for page in (pa, pb):
            for blk in page.get_text("dict")["blocks"]:
                for line in blk.get("lines", []):
                    for span in line["spans"]:
                        x0, y0, x1, y1 = span["bbox"]
                        mask[max(0, int((y0 - 2) * s)):int((y1 + 2) * s) + 1,
                             max(0, int((x0 - 2) * s)):int((x1 + 2) * s) + 1] = True
        info["pixel_diff_pct"] = round(100.0 * changed.mean(), 3)
        info["non_text_diff_pct"] = round(100.0 * (changed & ~mask).mean(), 3)
        if out_dir:
            from PIL import Image
            ta = Image.fromarray(A.astype("uint8"))
            tb = Image.fromarray(B.astype("uint8"))
            hl = B.copy()
            hl[changed] = [230, 0, 0]
            th = Image.fromarray(hl.astype("uint8"))
            w, h = ta.size
            sheet = Image.new("RGB", (w * 3 + 20, h), "white")
            sheet.paste(ta, (0, 0))
            sheet.paste(tb, (w + 10, 0))
            sheet.paste(th, (2 * w + 20, 0))
            name = f"page-{i + 1:02d}.png"
            sheet.save(os.path.join(out_dir, name))
            info["image"] = name
        res["pages"].append(info)
    return res


# ----------------------------------------------------------------------------
# التقرير الكامل
# ----------------------------------------------------------------------------
def verify(template_path, output_path, template_pdf=None, output_pdf=None, out_dir=None) -> dict:
    report = {"template": os.path.basename(template_path), "output": os.path.basename(output_path), "checks": []}

    def check(name, ok, detail=""):
        report["checks"].append({"name": name, "ok": bool(ok), "detail": detail})

    za, zb = zipfile.ZipFile(template_path), zipfile.ZipFile(output_path)
    na, nb = za.namelist(), zb.namelist()
    check("نفس أجزاء الحزمة وبنفس الترتيب", na == nb, f"{len(na)} جزءًا")
    dynamic_parts = {"word/document.xml"} | {n for n in na if n.startswith("word/header")}
    diff_parts = [n for n in na if n in nb and n not in dynamic_parts and za.read(n) != zb.read(n)]
    check("الأجزاء الثابتة متطابقة بايتًا ببايت (الصور، الأنماط، السمة، التذييل، الإعدادات، الخطوط)",
          not diff_parts, ", ".join(diff_parts) or f"{len(na) - len(dynamic_parts)} جزءًا متطابقًا")

    pa, pb = DocxPackage(template_path), DocxPackage(output_path)
    dyn = dynamic_paths(pa)
    refs = _ref_styles(pa)
    total = XmlDiff()
    for part in sorted(dynamic_parts):
        ta, tb = pa.xml(part), pb.xml(part)
        _walk(ta, tb, "", dyn.get(part, {}), total, ta.getroottree(), refs)
    check("لا يوجد أي تغيير في XML خارج مواضع البيانات الديناميكية", not total.violations,
          f"تغييرات نصية مسموحة: {total.text_changes} — تصغير خط: {total.size_changes} — مقاطع مضافة في خلايا فارغة: {total.added_runs}")
    report["xml_violations"] = total.violations

    ma, mb = metrics(template_path), metrics(output_path)
    labels = {
        "sections": "عدد الأقسام", "page_size": "حجم الصفحة واتجاهها", "margins": "الهوامش",
        "tables": "عدد الجداول", "grid_columns": "عرض الأعمدة", "row_heights": "ارتفاع الصفوف",
        "cell_widths": "عرض الخلايا", "merged_cells": "الخلايا المدمجة", "page_breaks": "فواصل الصفحات",
        "drawings": "الرسومات (DrawingML)", "textboxes": "مربعات النص", "vml_shapes": "أشكال VML",
        "images": "الصور", "paragraphs": "عدد الفقرات",
    }
    for k, lab in labels.items():
        check(lab, ma[k] == mb[k], _short(ma[k]))
    check("الخطوط: لم يُضف أي خط جديد", set(mb["fonts"]) <= set(ma["fonts"]), "، ".join(ma["fonts"]))
    check("الألوان: لم يُضف أي لون جديد", set(mb["colors"]) <= set(ma["colors"]) and set(mb["fills"]) <= set(ma["fills"]),
          "، ".join(ma["colors"]))
    report["metrics"] = {"template": ma, "output": mb}

    if template_pdf and output_pdf:
        vis = compare_pdfs(template_pdf, output_pdf, out_dir and os.path.join(out_dir, "pages"))
        report["visual"] = vis
        check("PDF: نفس عدد الصفحات", vis["pages_template"] == vis["pages_output"],
              f"{vis['pages_template']} ← {vis['pages_output']}")
        check("PDF: نفس مقاس كل صفحة", all(p["size_equal"] for p in vis["pages"]))
        bad_vec = [p["page"] for p in vis["pages"] if not p["vectors_equal"]]
        check("PDF: حدود الجداول والخلفيات والأشكال في نفس المواضع صفحةً صفحة", not bad_vec,
              ("صفحات مختلفة: " + ", ".join(map(str, bad_vec))) if bad_vec else
              f"{sum(p['vector_items'] for p in vis['pages'])} عنصرًا متجهًا متطابقًا")
        bad_img = [p["page"] for p in vis["pages"] if not p["images_equal"]]
        check("PDF: الصور في نفس المواضع", not bad_img, ", ".join(map(str, bad_img)))
        worst = max((p.get("non_text_diff_pct", 0) for p in vis["pages"]), default=0)
        check("PDF: لا تغيّر في البكسلات خارج مواضع النص", worst < 0.05, f"أعلى نسبة: {worst}%")
    report["passed"] = all(c["ok"] for c in report["checks"])
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
        with open(os.path.join(out_dir, "report.html"), "w", encoding="utf-8") as f:
            f.write(_html(report))
    return report


def _short(v):
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) < 140 else s[:137] + "..."


def report_html(rep, out_dir=None, embed_images=False) -> str:
    """HTML التقرير؛ مع embed_images تُضمَّن صور الصفحات داخل الملف نفسه
    (لإرساله كاملًا من خادم عديم الحالة)."""
    return _html(rep, os.path.join(out_dir, "pages") if (embed_images and out_dir) else None)


def _html(rep, embed_dir=None) -> str:
    rows = "".join(
        f"<tr class={'ok' if c['ok'] else 'bad'}><td>{'✔' if c['ok'] else '✘'}</td><td>{c['name']}</td>"
        f"<td class=d>{_esc(c['detail'])}</td></tr>" for c in rep["checks"])
    pages = ""
    for p in rep.get("visual", {}).get("pages", []):
        if p.get("image"):
            src = f"pages/{p['image']}"
            if embed_dir:
                import base64
                with open(os.path.join(embed_dir, p["image"]), "rb") as f:
                    src = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
            pages += (f"<figure><figcaption>صفحة {p['page']} — تغير البكسلات: {p.get('pixel_diff_pct')}% "
                      f"(خارج النص: {p.get('non_text_diff_pct')}%) — المتجهات {'متطابقة' if p['vectors_equal'] else 'مختلفة'}"
                      f"</figcaption><img src='{src}' loading=lazy></figure>")
    viol = "".join(f"<li>{_esc(v['issue'])} <code>{_esc(v['path'])}</code></li>" for v in rep.get("xml_violations", []))
    status = "ناجح ✔ — التصميم لم يتغير" if rep["passed"] else "يوجد اختلافات ✘"
    return f"""<!doctype html><html lang=ar dir=rtl><meta charset=utf-8>
<title>تقرير اختبار التطابق</title>
<style>body{{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#1b2b30;background:#f6f8f8}}
h1{{color:#0F4C5C}}table{{border-collapse:collapse;width:100%;background:#fff}}td{{border:1px solid #cfdcde;padding:6px 8px;vertical-align:top}}
tr.ok td:first-child{{color:#1e7a4c;font-weight:bold}}tr.bad td:first-child{{color:#c00000;font-weight:bold}}td.d{{font-size:12px;color:#4b6066;direction:ltr;text-align:left}}
.st{{font-size:20px;padding:10px 14px;border-radius:6px;display:inline-block;background:{'#dff3e8' if rep['passed'] else '#fde2e2'}}}
figure{{margin:18px 0;background:#fff;padding:8px;border:1px solid #cfdcde}}img{{max-width:100%}}figcaption{{font-size:13px;margin-bottom:6px}}</style>
<h1>تقرير اختبار التطابق مع القالب الأصلي</h1>
<p>القالب: <b>{_esc(rep['template'])}</b><br>الناتج: <b>{_esc(rep['output'])}</b></p>
<p class=st>{status}</p>
<table>{rows}</table>
{'<h2>اختلافات XML</h2><ul>' + viol + '</ul>' if viol else ''}
<h2>المقارنة البصرية صفحةً صفحة</h2><p>في كل صورة: القالب الأصلي ← الملف الناتج ← الاختلافات باللون الأحمر.</p>{pages}
</html>"""


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
