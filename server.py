"""نقطة الدخول للنشر على Vercel (وأي خادم WSGI).

التطبيق نفسه في activity_plan/app.py؛ هذا الملف يضيف مجلده إلى مسار الاستيراد
ويعيد تصدير كائن Flask باسم app كما تتوقعه Vercel.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "activity_plan"))

from app import app  # noqa: E402,F401
