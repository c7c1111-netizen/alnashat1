"""منشئ خطة النشاط الطلابي — الخادم (Flask).

التشغيل:
    pip install -r requirements.txt
    python app.py          ثم افتح http://127.0.0.1:5000
"""
from __future__ import annotations

import copy
import io
import json
import os
import shutil
import tempfile
import time
import uuid

from flask import Flask, abort, jsonify, request, send_file, send_from_directory

from engine import exporter, hijri, importer, model, service, store
from engine.pdf import PdfError, render_pages
from engine.seed import plan_from_template
from engine.template_map import SLOT_LABELS
from engine.verify import verify

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
WORK = os.path.join(ROOT, "output", "work")

app = Flask(__name__, static_folder=None)
app.json.sort_keys = False  # الإبقاء على ترتيب الحصص والمراحل كما هو
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
_IMPORTS: dict[str, dict] = {}


def _err(msg, code=400, **extra):
    return jsonify({"error": msg, **extra}), code


def _payload(plan):
    return {"plan": plan, "derived": service.enrich(plan)}


def _plan_or_404(pid):
    try:
        return store.load(pid)
    except (FileNotFoundError, ValueError):
        abort(404)


# ---------------------------------------------------------------------------
# الواجهة
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/static/<path:name>")
def static_files(name):
    return send_from_directory(STATIC, name)


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
# الخطط
# ---------------------------------------------------------------------------
@app.get("/api/plans")
def plans_list():
    return jsonify(store.list_plans())


@app.post("/api/plans")
def plans_create():
    body = request.get_json(silent=True) or {}
    if body.get("from_template", True):
        plan = plan_from_template(service.TEMPLATE, service.structure())
    else:
        plan = model.default_plan()
    plan["name"] = body.get("name") or "خطة جديدة"
    plan["schedule"] = model.auto_schedule(plan, service.structure())["schedule"]
    plan = store.save(plan)
    return jsonify(_payload(plan))


@app.get("/api/plans/<pid>")
def plans_get(pid):
    return jsonify(_payload(_plan_or_404(pid)))


@app.put("/api/plans/<pid>")
def plans_put(pid):
    plan = request.get_json(force=True)
    if plan.get("id") != pid:
        return _err("معرّف الخطة غير متطابق")
    return jsonify(_payload(store.save(plan)))


@app.delete("/api/plans/<pid>")
def plans_delete(pid):
    store.delete(pid)
    return jsonify({"ok": True})


@app.post("/api/plans/<pid>/duplicate")
def plans_duplicate(pid):
    plan = copy.deepcopy(_plan_or_404(pid))
    plan["id"] = model.new_id("plan")
    plan["name"] = plan.get("name", "") + " (نسخة)"
    return jsonify(_payload(store.save(plan)))


@app.post("/api/plans/import-json")
def plans_import_json():
    f = request.files.get("file")
    if not f:
        return _err("لم يُرفع ملف")
    try:
        plan = json.loads(f.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return _err("ملف الخطة غير صالح")
    plan["id"] = model.new_id("plan")
    return jsonify(_payload(store.save(plan)))


@app.get("/api/plans/<pid>/backup.json")
def plans_backup(pid):
    plan = _plan_or_404(pid)
    data = json.dumps(plan, ensure_ascii=False, indent=1).encode("utf-8")
    return send_file(io.BytesIO(data), mimetype="application/json", as_attachment=True,
                     download_name=f"{plan.get('name', 'plan')}.json")


@app.post("/api/plans/<pid>/autoschedule")
def plans_autoschedule(pid):
    plan = request.get_json(silent=True) or _plan_or_404(pid)
    if request.args.get("keep_manual", "1") == "0":
        plan["schedule"] = []
    res = model.auto_schedule(plan, service.structure())
    plan["schedule"] = res["schedule"]
    plan = store.save(plan)
    return jsonify({**_payload(plan), "unplaced": res["unplaced"]})


# ---------------------------------------------------------------------------
# استيراد البرامج
# ---------------------------------------------------------------------------
@app.post("/api/plans/<pid>/import")
def import_parse(pid):
    plan = _plan_or_404(pid)
    f = request.files.get("file")
    if not f:
        return _err("لم يُرفع ملف")
    try:
        res = importer.parse_programs(f.filename, f.read(), plan, service.structure())
    except Exception as e:  # noqa: BLE001
        return _err(f"تعذرت قراءة الملف: {e}")
    token = uuid.uuid4().hex
    _IMPORTS[token] = {"plan": pid, "programs": res["programs"], "t": time.time()}
    return jsonify({**res, "token": token})


@app.post("/api/plans/<pid>/import/apply")
def import_apply(pid):
    body = request.get_json(force=True)
    job = _IMPORTS.pop(body.get("token", ""), None)
    if not job or job["plan"] != pid:
        return _err("انتهت صلاحية عملية الاستيراد، ارفع الملف مرة أخرى.")
    selected = set(body.get("selected") or [p["id"] for p in job["programs"]])
    programs = [p for p in job["programs"] if p["id"] in selected and p.get("name")]
    plan = importer.apply_import(_plan_or_404(pid), programs, body.get("mode", "merge"))
    if body.get("schedule", True):
        plan["schedule"] = model.auto_schedule(plan, service.structure())["schedule"]
    return jsonify(_payload(store.save(plan)))


# ---------------------------------------------------------------------------
# التصدير والمعاينة والتحقق
# ---------------------------------------------------------------------------
def _generate(plan, force=False):
    v = model.validate(plan, service.structure())
    if v["errors"] and not force:
        return None, v
    out_dir = os.path.join(WORK, plan["id"])
    os.makedirs(out_dir, exist_ok=True)
    return service.generate_docx(plan, out_dir), v


@app.get("/api/plans/<pid>/export/docx")
def export_docx(pid):
    plan = _plan_or_404(pid)
    res, v = _generate(plan)
    if res is None:
        return _err("لا يمكن التصدير قبل تصحيح الأخطاء", errors=v["errors"])
    return send_file(res["docx"], as_attachment=True, download_name=os.path.basename(res["docx"]))


@app.get("/api/plans/<pid>/export/pdf")
def export_pdf(pid):
    plan = _plan_or_404(pid)
    res, v = _generate(plan)
    if res is None:
        return _err("لا يمكن التصدير قبل تصحيح الأخطاء", errors=v["errors"])
    try:
        pdf = service.generate_pdf(res["docx"])
    except PdfError as e:
        return _err(str(e), 500)
    return send_file(pdf["pdf"], as_attachment=True, download_name=os.path.basename(pdf["pdf"]))


@app.post("/api/plans/<pid>/preview")
def preview(pid):
    plan = _plan_or_404(pid)
    res, v = _generate(plan, force=True)
    try:
        pdf = service.generate_pdf(res["docx"])
    except PdfError as e:
        return _err(str(e), 500)
    pdir = os.path.join(WORK, pid, "preview")
    shutil.rmtree(pdir, ignore_errors=True)
    pages = render_pages(pdf["pdf"], pdir, dpi=int(request.args.get("dpi", 90)))
    stamp = int(time.time())
    return jsonify({"pages": [f"/work/{pid}/preview/{os.path.basename(p)}?t={stamp}" for p in pages],
                    "report": res["report"], "validation": v, "engine": pdf["engine"]})


@app.get("/work/<pid>/preview/<name>")
def preview_file(pid, name):
    return send_from_directory(os.path.join(WORK, pid, "preview"), name)


@app.post("/api/plans/<pid>/verify")
def verify_plan(pid):
    plan = _plan_or_404(pid)
    res, v = _generate(plan, force=True)
    vdir = os.path.join(WORK, pid, "verification")
    shutil.rmtree(vdir, ignore_errors=True)
    os.makedirs(vdir, exist_ok=True)
    tpdf = opdf = None
    if request.args.get("pdf", "1") == "1":
        try:
            tpdf = os.path.join(WORK, "master-template.pdf")
            if not os.path.exists(tpdf) or os.path.getmtime(tpdf) < os.path.getmtime(service.TEMPLATE):
                service.generate_pdf(service.TEMPLATE, tpdf)
            opdf = service.generate_pdf(res["docx"])["pdf"]
        except PdfError:
            tpdf = opdf = None
    rep = verify(service.TEMPLATE, res["docx"], tpdf, opdf, vdir)
    return jsonify({"passed": rep["passed"], "checks": rep["checks"],
                    "violations": rep.get("xml_violations", []),
                    "report_url": f"/work/{pid}/verification/report.html"})


@app.get("/work/<pid>/verification/<path:name>")
def verification_file(pid, name):
    return send_from_directory(os.path.join(WORK, pid, "verification"), name)


@app.get("/api/plans/<pid>/export/database.xlsx")
def export_db(pid):
    plan = _plan_or_404(pid)
    return send_file(io.BytesIO(exporter.to_xlsx(plan)), as_attachment=True,
                     download_name=f"قاعدة بيانات البرامج والمعلمين - {plan['school'].get('name') or plan['name']}.xlsx")


@app.get("/api/plans/<pid>/export/programs.csv")
def export_programs_csv(pid):
    plan = _plan_or_404(pid)
    return send_file(io.BytesIO(exporter.programs_csv(plan)), mimetype="text/csv", as_attachment=True,
                     download_name="البرامج.csv")


@app.get("/api/plans/<pid>/export/teachers.csv")
def export_teachers_csv(pid):
    plan = _plan_or_404(pid)
    return send_file(io.BytesIO(exporter.teachers_csv(plan)), mimetype="text/csv", as_attachment=True,
                     download_name="المعلمون.csv")


@app.get("/samples/<path:name>")
def samples(name):
    return send_from_directory(os.path.join(ROOT, "samples"), name, as_attachment=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"منشئ خطة النشاط الطلابي يعمل على: http://127.0.0.1:{port}")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=False)
