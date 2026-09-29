"""منشئ خطة النشاط الطلابي — الخادم (Flask).

الخادم عديم الحالة: الخطط تُحفظ في متصفح المستخدم، وكل طلب يرسل الخطة كاملة
في جسمه. لذلك يعمل كما هو محليًا وعلى الخوادم السحابية (مثل Vercel) حيث نظام
الملفات للقراءة فقط وقد يخدم كل طلب نسخةٌ مختلفة من الخادم.

التشغيل المحلي:
    pip install -r requirements.txt
    python app.py          ثم افتح http://127.0.0.1:5000
"""
from __future__ import annotations

import io
import json
import os
import tempfile

from flask import Flask, jsonify, request, send_file, send_from_directory

from engine import exporter, hijri, importer, model, pdf, service
from engine.pdf import PdfError
from engine.seed import plan_from_template
from engine.template_map import SLOT_LABELS
from engine.verify import report_html, verify

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
REPO_ROOT = os.path.dirname(ROOT)

app = Flask(__name__, static_folder=None)
app.json.sort_keys = False  # الإبقاء على ترتيب الحصص والمراحل كما هو
# Vercel يحد جسم الطلب بـ 4.5MB؛ نرفض ما هو أكبر برسالة واضحة
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_UPLOAD_MB", "4")) * 1024 * 1024


def _err(msg, code=400, **extra):
    return jsonify({"error": msg, **extra}), code


def _plan_from_request():
    """الخطة المرسلة من المتصفح (JSON أو حقل plan في نموذج رفع ملف)."""
    if request.is_json:
        body = request.get_json(silent=True) or {}
        plan = body.get("plan", body)
    else:
        plan = json.loads(request.form.get("plan") or "{}")
    if not isinstance(plan, dict) or not plan:
        raise ValueError("لم تُرسل بيانات الخطة")
    return model.normalize_plan(plan)


def _body():
    return request.get_json(silent=True) or {}


def _payload(plan, **extra):
    return {"plan": plan, "derived": service.enrich(plan), **extra}


@app.errorhandler(ValueError)
def _value_error(e):
    return _err(str(e))


@app.errorhandler(413)
def _too_large(_e):
    return _err("الملف أكبر من الحد المسموح (4MB).", 413)


def _send_bytes(data: bytes, name: str, mimetype: str):
    return send_file(io.BytesIO(data), mimetype=mimetype, as_attachment=True, download_name=name)


# ---------------------------------------------------------------------------
# الواجهة
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/static/<path:name>")
def static_files(name):
    return send_from_directory(STATIC, name)


@app.get("/legacy")
def legacy():
    """التطبيق السابق الموجود في المستودع (index.html) — للرجوع إليه."""
    return send_from_directory(REPO_ROOT, "index.html")


@app.get("/samples/<path:name>")
def samples(name):
    return send_from_directory(os.path.join(ROOT, "samples"), name, as_attachment=True)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "pdf": pdf.available()})


@app.get("/api/meta")
def meta():
    with open(os.path.join(ROOT, "data", "library", "programs.json"), encoding="utf-8") as f:
        library = json.load(f)
    return jsonify({
        "structure": service.structure(),
        "stages": model.STAGES,
        "semesters": model.SEMESTERS,
        "domains": model.ALL_DOMAINS,
        "template_domains": model.TEMPLATE_DOMAINS,
        "slots": SLOT_LABELS,
        "slot_order": list(SLOT_LABELS),
        "class_slots": model.CLASS_SLOTS,
        "library": library,
        "quota_rate": model.QUOTA_RATE,
        "capabilities": {"pdf": pdf.available(), "storage": "browser"},
    })


@app.get("/api/hijri")
def hijri_info():
    try:
        h = hijri.parse(request.args.get("d", ""))
        return jsonify({"date": hijri.fmt(h, suffix=False), "day": hijri.day_name(h),
                        "long": hijri.long_text(h), "weekday": hijri.weekday_index(h)})
    except hijri.DateError as e:
        return _err(str(e))


# ---------------------------------------------------------------------------
# إنشاء الخطط وحساباتها
# ---------------------------------------------------------------------------
@app.post("/api/plans/new")
def plans_new():
    body = _body()
    if body.get("demo"):
        with open(os.path.join(ROOT, "data", "plans", "demo_abubakr.json"), encoding="utf-8") as f:
            plan = model.normalize_plan(json.load(f))
        plan["id"] = model.new_id("plan")
    elif body.get("from_template", True):
        plan = plan_from_template(service.TEMPLATE, service.structure())
    else:
        plan = model.default_plan()
    if body.get("name"):
        plan["name"] = body["name"]
    if not body.get("demo"):
        plan["schedule"] = model.auto_schedule(plan, service.structure())["schedule"]
    return jsonify(_payload(plan))


@app.post("/api/derive")
def derive():
    return jsonify({"derived": service.enrich(_plan_from_request())})


@app.post("/api/autoschedule")
def autoschedule():
    plan = _plan_from_request()
    if request.args.get("keep_manual", "1") == "0":
        plan["schedule"] = []
    res = model.auto_schedule(plan, service.structure())
    plan["schedule"] = res["schedule"]
    return jsonify(_payload(plan, unplaced=res["unplaced"]))


# ---------------------------------------------------------------------------
# استيراد البرامج: القراءة أولًا (لعرض التعارضات)، ثم التطبيق بعد الموافقة
# ---------------------------------------------------------------------------
@app.post("/api/import")
def import_parse():
    plan = _plan_from_request()
    f = request.files.get("file")
    if not f:
        return _err("لم يُرفع ملف")
    try:
        res = importer.parse_programs(f.filename, f.read(), plan, service.structure())
    except Exception as e:  # noqa: BLE001
        return _err(f"تعذرت قراءة الملف: {e}")
    return jsonify(res)


@app.post("/api/import/apply")
def import_apply():
    body = _body()
    plan = model.normalize_plan(body.get("plan") or {})
    programs = [p for p in (body.get("programs") or []) if isinstance(p, dict) and p.get("name")]
    plan = importer.apply_import(plan, programs, body.get("mode", "merge"))
    if body.get("schedule", True):
        plan["schedule"] = model.auto_schedule(plan, service.structure())["schedule"]
    return jsonify(_payload(plan))


# ---------------------------------------------------------------------------
# التصدير والمعاينة والتحقق
# ---------------------------------------------------------------------------
def _generate(plan, tmp, force=False):
    v = model.validate(plan, service.structure())
    if v["errors"] and not force:
        return None, v
    return service.generate_docx(plan, tmp), v


@app.post("/api/export/docx")
def export_docx():
    plan = _plan_from_request()
    with tempfile.TemporaryDirectory() as tmp:
        res, v = _generate(plan, tmp)
        if res is None:
            return _err("لا يمكن التصدير قبل تصحيح الأخطاء", errors=v["errors"])
        with open(res["docx"], "rb") as f:
            data = f.read()
        name = os.path.basename(res["docx"])
    return _send_bytes(data, name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.post("/api/export/pdf")
def export_pdf():
    if not pdf.available():
        return _err("تحويل PDF غير متاح على هذا الخادم. صدّر ملف Word ثم احفظه PDF من Microsoft Word "
                    "(ملف ← حفظ باسم ← PDF) للحصول على نسخة مطابقة تمامًا.", 501)
    plan = _plan_from_request()
    with tempfile.TemporaryDirectory() as tmp:
        res, v = _generate(plan, tmp)
        if res is None:
            return _err("لا يمكن التصدير قبل تصحيح الأخطاء", errors=v["errors"])
        try:
            out = service.generate_pdf(res["docx"])
        except PdfError as e:
            return _err(str(e), 500)
        with open(out["pdf"], "rb") as f:
            data = f.read()
        name = os.path.basename(out["pdf"])
    return _send_bytes(data, name, "application/pdf")


@app.post("/api/preview")
def preview():
    if not pdf.available():
        return _err("المعاينة تتطلب تحويل PDF، وهو غير متاح على هذا الخادم. صدّر ملف Word وافتحه للمعاينة.", 501)
    plan = _plan_from_request()
    with tempfile.TemporaryDirectory() as tmp:
        res, v = _generate(plan, tmp, force=True)
        try:
            out = service.generate_pdf(res["docx"])
        except PdfError as e:
            return _err(str(e), 500)
        pages = pdf.render_pages_inline(out["pdf"], dpi=int(request.args.get("dpi", 72)), quality=72)
    return jsonify({"pages": pages, "report": res["report"], "validation": v, "engine": out["engine"]})


@app.post("/api/verify")
def verify_plan():
    plan = _plan_from_request()
    with tempfile.TemporaryDirectory() as tmp:
        res, _v = _generate(plan, tmp, force=True)
        vdir = os.path.join(tmp, "verification")
        tpdf = opdf = None
        if pdf.available() and request.args.get("pdf", "1") == "1":
            try:
                tpdf = service.generate_pdf(service.TEMPLATE, os.path.join(tmp, "master.pdf"))["pdf"]
                opdf = service.generate_pdf(res["docx"])["pdf"]
            except PdfError:
                tpdf = opdf = None
        rep = verify(service.TEMPLATE, res["docx"], tpdf, opdf, vdir)
        html = report_html(rep, vdir, embed_images=True)
    return jsonify({"passed": rep["passed"], "checks": rep["checks"], "visual": bool(tpdf),
                    "violations": rep.get("xml_violations", []), "report_html": html})


@app.post("/api/export/database.xlsx")
def export_db():
    plan = _plan_from_request()
    name = f"قاعدة بيانات البرامج والمعلمين - {plan['school'].get('name') or plan['name']}.xlsx"
    return _send_bytes(exporter.to_xlsx(plan), name,
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/export/programs.csv")
def export_programs_csv():
    return _send_bytes(exporter.programs_csv(_plan_from_request()), "البرامج.csv", "text/csv")


@app.post("/api/export/teachers.csv")
def export_teachers_csv():
    return _send_bytes(exporter.teachers_csv(_plan_from_request()), "المعلمون.csv", "text/csv")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"منشئ خطة النشاط الطلابي يعمل على: http://127.0.0.1:{port}")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=False)
