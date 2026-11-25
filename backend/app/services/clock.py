"""Simulated clock for behavioural/risk time.

All risk, baseline, session and rate-limit logic reads `now()` so the Scenario Lab can
advance time deterministically. TOTP verification deliberately uses REAL time (see
app.security.totp) so codes from a real authenticator app keep working.
"""
from datetime import datetime, timedelta, timezone

_offset = timedelta(0)


def real_now() -> datetime:
    return datetime.now(timezone.utc)


def now() -> datetime:
    return real_now() + _offset


def advance(**kwargs) -> datetime:
    global _offset
    _offset += timedelta(**kwargs)
    return now()


def set_offset(offset: timedelta) -> None:
    global _offset
    _offset = offset


def reset() -> None:
    set_offset(timedelta(0))
