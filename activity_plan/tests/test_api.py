"""اختبارات واجهة الخادم عديم الحالة (كما يعمل على Vercel: بلا تحويل PDF)."""
import io
import json
import os
import sys
import zipfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ["PDF_ENGINE"] = "none"

from app import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture(scope="module")
def demo(client):
    r = client.post("/api/plans/new", json={"demo": True})
    assert r.status_code == 200
    return r.get_json()["plan"]


def test_meta_reports_no_pdf(client):
    m = client.get("/api/meta").get_json()
    assert m["capabilities"] == {"pdf": False, "storage": "browser"}
    assert m["slot_order"][0] == "morning" and m["slot_order"][-1] == "prayer"
    assert len(m["structure"]["weeks"]) == 20


def test_new_plan_from_template(client):
    r = client.post("/api/plans/new", json={"name": "س", "from_template": True}).get_json()
    assert r["plan"]["name"] == "س" and r["plan"]["programs"] and r["plan"]["schedule"]
    assert "validation" in r["derived"]


def test_derive_and_autoschedule(client, demo):
    d = client.post("/api/derive", json={"plan": demo}).get_json()["derived"]
    assert d["validation"]["errors"] == []
    r = client.post("/api/autoschedule?keep_manual=0", json={"plan": demo}).get_json()
    assert len(r["plan"]["schedule"]) == len(demo["schedule"])


def test_export_docx_is_filled_template(client, demo):
    r = client.post("/api/export/docx", json={"plan": demo})
    assert r.status_code == 200
    assert "filename*=UTF-8''" in r.headers["Content-Disposition"]
    z = zipfile.ZipFile(io.BytesIO(r.data))
    doc = z.read("word/document.xml").decode("utf-8")
    assert "وليد أحمد" in doc and "مجمع أبو بكر الصديق التعليمي" in doc


def test_export_blocked_on_errors(client):
    plan = client.post("/api/plans/new", json={"from_template": False}).get_json()["plan"]
    r = client.post("/api/export/docx", json={"plan": plan})
    assert r.status_code == 400
    assert any("اسم المدرسة" in e for e in r.get_json()["errors"])


def test_pdf_and_preview_unavailable(client, demo):
    assert client.post("/api/export/pdf", json={"plan": demo}).status_code == 501
    assert client.post("/api/preview", json={"plan": demo}).status_code == 501


def test_verify_without_pdf(client, demo):
    r = client.post("/api/verify", json={"plan": demo}).get_json()
    assert r["passed"] and r["visual"] is False
    assert "<html" in r["report_html"]


def test_import_then_apply(client, demo):
    path = os.path.join(ROOT, "samples", "نموذج استيراد البرامج.xlsx")
    with open(path, "rb") as f:
        r = client.post("/api/import", data={"plan": json.dumps(demo), "file": (f, "p.xlsx")},
                        content_type="multipart/form-data")
    res = r.get_json()
    assert r.status_code == 200 and len(res["programs"]) == 15
    r = client.post("/api/import/apply", json={"plan": demo, "programs": res["programs"], "mode": "replace"})
    plan = r.get_json()["plan"]
    assert len(plan["programs"]) == 15 and plan["schedule"]


def test_database_exports(client, demo):
    for url in ("/api/export/database.xlsx", "/api/export/programs.csv", "/api/export/teachers.csv"):
        assert client.post(url, json={"plan": demo}).status_code == 200


def test_missing_plan_is_400(client):
    assert client.post("/api/derive", json={}).status_code == 400
