"""حفظ الخطط (أكثر من خطة) كملفات JSON في data/plans/."""
from __future__ import annotations

import datetime as _dt
import json
import os
import re

from .model import normalize_plan

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS_DIR = os.path.join(ROOT, "data", "plans")


def _path(plan_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", plan_id or ""):
        raise ValueError("معرّف خطة غير صالح")
    return os.path.join(PLANS_DIR, f"{plan_id}.json")


def list_plans() -> list[dict]:
    os.makedirs(PLANS_DIR, exist_ok=True)
    out = []
    for fn in sorted(os.listdir(PLANS_DIR)):
        if fn.endswith(".json"):
            try:
                with open(os.path.join(PLANS_DIR, fn), encoding="utf-8") as f:
                    p = json.load(f)
                out.append({"id": p["id"], "name": p.get("name", ""), "school": p.get("school", {}).get("name", ""),
                            "updated": p.get("updated", "")})
            except Exception:  # noqa: BLE001
                continue
    out.sort(key=lambda x: x["updated"], reverse=True)
    return out


def load(plan_id: str) -> dict:
    with open(_path(plan_id), encoding="utf-8") as f:
        return normalize_plan(json.load(f))


def save(plan: dict) -> dict:
    os.makedirs(PLANS_DIR, exist_ok=True)
    plan = normalize_plan(plan)
    plan["updated"] = _dt.datetime.now().isoformat(timespec="seconds")
    tmp = _path(plan["id"]) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _path(plan["id"]))
    return plan


def delete(plan_id: str):
    p = _path(plan_id)
    if os.path.exists(p):
        os.remove(p)
