"""التواريخ الهجرية (تقويم أم القرى).

كل التواريخ الظاهرة للمستخدم وفي المستند هجرية بصيغة 10/3/1448هـ.
التحويل إلى الميلادي يتم داخليًا فقط لحساب الأيام وأسماء الأيام.
"""
from __future__ import annotations

import datetime as _dt
import re

from hijridate import Gregorian, Hijri

DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
HIJRI_MONTHS = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
                "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"]

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


class DateError(ValueError):
    pass


def _clean(s: str) -> str:
    s = (s or "").translate(_AR_DIGITS)
    s = re.sub(r"[هـ‏‎]|هـ|ه\b|م\b", "", s)
    return s.strip()


def parse(s: str, assume: str = "auto") -> tuple[int, int, int]:
    """يحوّل نصًا إلى تاريخ هجري (يوم، شهر، سنة).

    يقبل: 10/3/1448 ، 10-3-1448 ، 1448/3/10 ، 10/3/1448هـ ، أرقامًا عربية،
    وتاريخًا ميلاديًا (سنة > 1900) يحوَّل داخليًا إلى هجري.
    """
    if isinstance(s, (_dt.date, _dt.datetime)):
        return from_gregorian(s)
    raw = _clean(str(s))
    nums = [int(x) for x in re.findall(r"\d+", raw)]
    if len(nums) != 3:
        raise DateError(f"تاريخ غير مفهوم: «{s}»")
    if nums[0] > 31:  # سنة/شهر/يوم
        y, m, d = nums
    else:
        d, m, y = nums
    if y > 1900 or assume == "gregorian":
        try:
            return from_gregorian(_dt.date(y, m, d))
        except Exception as e:  # noqa: BLE001
            raise DateError(f"تاريخ ميلادي غير صحيح: «{s}»") from e
    try:
        Hijri(y, m, d)  # يتحقق من صحة التاريخ في تقويم أم القرى
    except Exception as e:  # noqa: BLE001
        raise DateError(f"تاريخ هجري غير صحيح: «{s}»") from e
    return d, m, y


def fmt(h: tuple[int, int, int], suffix: bool = True) -> str:
    d, m, y = h
    return f"{d}/{m}/{y}" + ("هـ" if suffix else "")


def to_gregorian(h) -> _dt.date:
    d, m, y = h
    g = Hijri(y, m, d).to_gregorian()
    return _dt.date(g.year, g.month, g.day)


def from_gregorian(g) -> tuple[int, int, int]:
    h = Gregorian(g.year, g.month, g.day).to_hijri()
    return h.day, h.month, h.year


def add_days(h, n: int):
    return from_gregorian(to_gregorian(h) + _dt.timedelta(days=n))


def weekday_index(h) -> int:
    """0 = الأحد ... 6 = السبت"""
    return (to_gregorian(h).weekday() + 1) % 7


def day_name(h) -> str:
    return DAY_NAMES[weekday_index(h)]


def ordinal(h) -> int:
    return to_gregorian(h).toordinal()


def long_text(h) -> str:
    d, m, y = h
    return f"{day_name(h)} {d} {HIJRI_MONTHS[m - 1]} {y}هـ"


def try_parse(s):
    try:
        return parse(s) if s not in (None, "") else None
    except DateError:
        return None
