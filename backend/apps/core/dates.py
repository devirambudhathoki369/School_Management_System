"""Bikram Sambat <-> Gregorian helpers (the platform's operational calendar)."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import nepali_datetime

NEPAL_TZ = ZoneInfo("Asia/Kathmandu")


def today_bs() -> str:
    """Today's Bikram Sambat date as 'YYYY-MM-DD'."""
    return str(nepali_datetime.date.today())


def bs_to_ad(bs_date: str) -> date:
    """'2081-03-15' (BS) -> Gregorian date."""
    year, month, day = map(int, bs_date.split("-"))
    return nepali_datetime.date(year, month, day).to_datetime_date()


def ad_to_bs(ad_date: date) -> str:
    return str(nepali_datetime.date.from_datetime_date(ad_date))


def bs_day_utc_range(bs_date: str) -> tuple[datetime, datetime]:
    """UTC [start, end) datetimes covering one BS calendar day in Nepal."""
    ad = bs_to_ad(bs_date)
    start = datetime(ad.year, ad.month, ad.day, tzinfo=NEPAL_TZ)
    return start, start + timedelta(days=1)
