"""أدوات منخفضة المستوى للتعامل مع XML الخاص بملف Word (OOXML).

المبدأ: لا ننشئ مستندًا جديدًا أبدًا. نفتح أجزاء ملف القالب كما هي، ونعدّل
نصوص عقد <w:t> المحددة فقط، ونعيد كتابة الأجزاء المعدّلة مع الإبقاء على
إعلان XML الأصلي حرفيًا، وتُنسخ بقية أجزاء الحزمة (الصور، الأنماط، السمة،
الترويسة...) بايتًا ببايت.
"""
from __future__ import annotations

import copy
import re
import unicodedata
import zipfile
from typing import Iterable

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
V = "urn:schemas-microsoft-com:vml"
XML_NS = "http://www.w3.org/XML/1998/namespace"

NS = {"w": W, "mc": MC, "wp": WP, "wps": WPS, "a": A, "v": V}


def q(tag: str) -> str:
    """'w:t' -> '{namespace}t'"""
    prefix, local = tag.split(":")
    return "{%s}%s" % (NS[prefix], local)


def wattr(el, name: str):
    return el.get(q("w:" + name))


def norm(s: str) -> str:
    """توحيد النص للمقارنة: يحوّل أشكال العرض العربية (U+FExx) إلى الحروف
    الأساسية، ويزيل المسافات وعلامات الاتجاه."""
    s = unicodedata.normalize("NFKC", s or "")
    return re.sub(r"[\s‏‎​ ]+", "", s)


# --------------------------------------------------------------------------
# قراءة النصوص
# --------------------------------------------------------------------------
_SKIP_CONTAINERS = {q("w:txbxContent"), q("mc:Fallback")}


def own_text_nodes(p) -> list:
    """عقد <w:t> التابعة للفقرة نفسها فقط (دون نصوص مربعات النص المضمّنة فيها)."""
    out = []
    for t in p.iter(q("w:t")):
        anc = t.getparent()
        skip = False
        while anc is not None and anc is not p:
            if anc.tag in _SKIP_CONTAINERS:
                skip = True
                break
            anc = anc.getparent()
        if not skip:
            out.append(t)
    return out


def para_text(p) -> str:
    return "".join(t.text or "" for t in own_text_nodes(p))


def cell_text(tc) -> str:
    return "\n".join(para_text(p) for p in tc.findall(q("w:p")))


def set_t(t, text: str):
    t.text = text
    if text != text.strip() or "  " in text:
        t.set("{%s}space" % XML_NS, "preserve")


# --------------------------------------------------------------------------
# الاستبدال مع الحفاظ على تنسيق المقاطع (Runs)
# --------------------------------------------------------------------------
def replace_in_paragraph(p, pattern: str, repl) -> int:
    """استبدال نمط regex داخل فقرة موزعة على عدة Runs مع الحفاظ على التنسيق.

    النص البديل يوضع في أول عقدة <w:t> يبدأ فيها التطابق، وتُفرغ بقية الأجزاء
    المطابقة. `repl` دالة تستقبل كائن match وتعيد النص البديل.
    يعيد عدد الاستبدالات التي غيّرت النص فعلًا.
    """
    nodes = own_text_nodes(p)
    if not nodes:
        return 0
    texts = [n.text or "" for n in nodes]
    full = "".join(texts)
    matches = list(re.finditer(pattern, full))
    if not matches:
        return 0
    # حدود كل عقدة
    bounds = []
    pos = 0
    for tx in texts:
        bounds.append((pos, pos + len(tx)))
        pos += len(tx)
    changed = 0
    news = [repl(m) for m in matches]  # بترتيب ظهورها في النص
    for m, new in reversed(list(zip(matches, news))):
        if new == m.group(0):
            continue
        changed += 1
        s, e = m.span()
        first = True
        for i, (bs, be) in enumerate(bounds):
            if be <= s or bs >= e:
                if bs == be == s and first and s == e:
                    pass
                continue
            ls, le = max(s, bs) - bs, min(e, be) - bs
            cur = texts[i]
            if first:
                texts[i] = cur[:ls] + new + cur[le:]
                first = False
            else:
                texts[i] = cur[:ls] + cur[le:]
        # إعادة حساب الحدود بعد التعديل
        bounds = []
        pos = 0
        for tx in texts:
            bounds.append((pos, pos + len(tx)))
            pos += len(tx)
    for n, tx in zip(nodes, texts):
        if (n.text or "") != tx:
            set_t(n, tx)
    return changed


# --------------------------------------------------------------------------
# كتابة قيمة في خلية/فقرة
# --------------------------------------------------------------------------
def text_runs(p) -> list:
    """Runs المباشرة للفقرة التي تحمل نصًا."""
    return [r for r in p.findall(q("w:r")) if r.find(q("w:t")) is not None]


def set_paragraph_value(p, value: str, ref_ppr=None, ref_rpr=None) -> bool:
    """يضع `value` في الفقرة p دون حذف أي عنصر من القالب.

    - إن وُجدت Runs نصية: يُكتب النص في أول عقدة <w:t> (بتنسيقها الأصلي) وتُفرغ
      نصوص بقية العقد فقط (تبقى العناصر نفسها في مكانها).
    - إن كانت الفقرة فارغة تمامًا: تُضاف Run واحدة بخصائص الفقرة والمقطع
      المأخوذة من خلية بيانات معبأة في القالب نفسه.
    يعيد True إن تغيّر شيء.
    """
    nodes = own_text_nodes(p)
    current = "".join(t.text or "" for t in nodes)
    if current == value:
        return False
    if nodes:
        set_t(nodes[0], value)
        for t in nodes[1:]:
            if t.text:
                t.text = ""
        return True
    if value == "":
        return False
    if p.find(q("w:pPr")) is None and ref_ppr is not None:
        p.insert(0, copy.deepcopy(ref_ppr))
    r = etree.SubElement(p, q("w:r"))
    if ref_rpr is not None:
        r.append(copy.deepcopy(ref_rpr))
    t = etree.SubElement(r, q("w:t"))
    set_t(t, value)
    return True


def set_after_anchor(p, anchor_norm: str, value: str) -> bool:
    """يضع القيمة بعد نص ثابت (مثل «بمنطقة») في نفس الفقرة.

    القيمة تُكتب في أول عقدة نصية تحتوي على حرف غير فراغ بعد النص الثابت
    (أي في Run القيمة الأصلية بتنسيقها)، وتُفرغ العقد التي بعدها.
    """
    nodes = own_text_nodes(p)
    texts = [n.text or "" for n in nodes]
    # موضع نهاية النص الثابت بحسب النص الموحّد
    acc = ""
    end_node, end_off = None, None
    for i, tx in enumerate(texts):
        for j in range(len(tx)):
            acc += tx[j]
            if norm(acc).endswith(anchor_norm) and end_node is None:
                end_node, end_off = i, j + 1
        if end_node is not None:
            break
    if end_node is None:
        return False
    target = None
    for i in range(end_node, len(texts)):
        start = end_off if i == end_node else 0
        seg = texts[i][start:]
        k = len(seg) - len(seg.lstrip())
        if seg.strip():
            target = (i, start + k)
            break
    if target is None:
        new = texts[end_node][:end_off] + " " + value
        if new == texts[end_node]:
            return False
        set_t(nodes[end_node], new + texts[end_node][end_off:].strip())
        return True
    i, off = target
    changed = False
    new_i = texts[i][:off] + value
    if texts[i] != new_i:
        set_t(nodes[i], new_i)
        changed = True
    for n in nodes[i + 1:]:
        if n.text:
            n.text = ""
            changed = True
    return changed


def set_run_size(run, half_points: int):
    rpr = run.find(q("w:rPr"))
    if rpr is None:
        rpr = etree.Element(q("w:rPr"))
        run.insert(0, rpr)
    for tag in ("w:sz", "w:szCs"):
        el = rpr.find(q(tag))
        if el is None:
            el = etree.Element(q(tag))
            _insert_rpr_child(rpr, el)
        el.set(q("w:val"), str(half_points))


# ترتيب عناصر rPr حسب مخطط OOXML (لإبقاء الملف صالحًا في Word)
_RPR_ORDER = [
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
    "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
    "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
    "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
    "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
]


def _insert_rpr_child(rpr, el):
    name = etree.QName(el).localname
    idx = _RPR_ORDER.index(name)
    for i, child in enumerate(rpr):
        cname = etree.QName(child).localname
        if cname in _RPR_ORDER and _RPR_ORDER.index(cname) > idx:
            rpr.insert(i, el)
            return
    rpr.append(el)


def run_size(run, default=22, complex_script=True) -> int:
    """حجم الخط الفعلي بنصف نقطة.

    النص العربي (Complex Script) يأخذ حجمه من w:szCs وليس من w:sz؛ فإن غاب
    w:szCs يُطبق الحجم الافتراضي للمستند (22 = 11pt) كما يفعل Word.
    """
    rpr = run.find(q("w:rPr"))
    tags = ("w:szCs",) if complex_script else ("w:sz",)
    if rpr is not None:
        for tag in tags:
            el = rpr.find(q(tag))
            if el is not None:
                return int(el.get(q("w:val")))
    return default


def has_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06ff\ufb50-\ufeff]", text or ""))


def set_run_scale(run, pct: int):
    rpr = run.find(q("w:rPr"))
    if rpr is None:
        rpr = etree.Element(q("w:rPr"))
        run.insert(0, rpr)
    el = rpr.find(q("w:w"))
    if el is None:
        el = etree.Element(q("w:w"))
        _insert_rpr_child(rpr, el)
    el.set(q("w:val"), str(pct))


def run_scale(run) -> float:
    rpr = run.find(q("w:rPr"))
    if rpr is not None:
        el = rpr.find(q("w:w"))
        if el is not None:
            return int(el.get(q("w:val"))) / 100.0
    return 1.0


# --------------------------------------------------------------------------
# الجداول وشبكة الأعمدة
# --------------------------------------------------------------------------
def grid_cells(tr) -> list:
    """قائمة (grid_start, span, tc) لكل خلية في الصف."""
    out = []
    g = 0
    trpr = tr.find(q("w:trPr"))
    if trpr is not None:
        gb = trpr.find(q("w:gridBefore"))
        if gb is not None:
            g += int(wattr(gb, "val"))
    for tc in tr.findall(q("w:tc")):
        span = 1
        sp = tc.find("w:tcPr/w:gridSpan", NS)
        if sp is not None:
            span = int(wattr(sp, "val"))
        out.append((g, span, tc))
        g += span
    return out


def vmerge(tc):
    vm = tc.find("w:tcPr/w:vMerge", NS)
    if vm is None:
        return None
    return wattr(vm, "val") or "continue"


def tc_width(tc) -> int:
    w = tc.find("w:tcPr/w:tcW", NS)
    return int(wattr(w, "w")) if w is not None and wattr(w, "w") else 0


def tr_height(tr) -> int:
    h = tr.find("w:trPr/w:trHeight", NS)
    return int(wattr(h, "val")) if h is not None else 0


# --------------------------------------------------------------------------
# حزمة DOCX
# --------------------------------------------------------------------------
class DocxPackage:
    """قراءة/كتابة حزمة DOCX مع نسخ الأجزاء غير المعدلة بايتًا ببايت."""

    def __init__(self, path):
        self.path = path
        with zipfile.ZipFile(path) as z:
            self.infos = z.infolist()
            self.raw = {i.filename: z.read(i.filename) for i in self.infos}
        self.trees = {}

    def xml(self, name):
        if name not in self.trees:
            self.trees[name] = etree.fromstring(self.raw[name])
        return self.trees[name]

    def parts(self, prefix="word/", suffix=".xml") -> Iterable[str]:
        return [n for n in self.raw if n.startswith(prefix) and n.endswith(suffix)]

    def serialize(self, name) -> bytes:
        original = self.raw[name]
        root = self.trees[name]
        body = etree.tostring(root, encoding="UTF-8")
        # الإبقاء على نفس صيغة ترميز المحارف الخاصة كما في القالب
        for dec, hexa in ((b"&#10;", b"&#xA;"), (b"&#13;", b"&#xD;"), (b"&#9;", b"&#x9;")):
            if hexa in original and dec not in original:
                body = body.replace(dec, hexa)
        m = re.match(rb"<\?xml[^>]*\?>\s*", original)
        decl = m.group(0) if m else b""
        return decl + body

    def save(self, out_path):
        with zipfile.ZipFile(out_path, "w") as z:
            for info in self.infos:
                data = self.raw[info.filename]
                if info.filename in self.trees:
                    data = self.serialize(info.filename)
                ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                ni.compress_type = info.compress_type
                ni.external_attr = info.external_attr
                ni.create_system = info.create_system
                z.writestr(ni, data)
