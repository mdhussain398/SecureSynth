"""Simulated clock for behavioural/risk time.

All risk, baseline, session and rate-limit logic reads `now()` so the Scenario Lab can
advance time deterministically. TOTP verification deliberately uses REAL time (see
app.security.totp) so codes from a real authenticator app keep working.
"""
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

_offset = timedelta(0)
# A Scenario Lab run may temporarily move the customer-local hour (at_local_hour). That shift applies ONLY to requests
# made by the Lab runner itself (marked by the in-process lab token), never to the presenter's or anyone else's
# concurrent requests, so their session idle/expiry checks are not disturbed.
_lab_shift = timedelta(0)
_in_lab_request: ContextVar[bool] = ContextVar("in_lab_request", default=False)


def real_now() -> datetime:
    return datetime.now(timezone.utc)


def now() -> datetime:
    return real_now() + _offset + (_lab_shift if _in_lab_request.get() else timedelta(0))


def set_lab_shift(shift: timedelta) -> None:
    global _lab_shift
    _lab_shift = shift


def mark_lab_request(on: bool):
    return _in_lab_request.set(on)


def unmark_lab_request(token) -> None:
    _in_lab_request.reset(token)


def advance(**kwargs) -> datetime:
    global _offset
    _offset += timedelta(**kwargs)
    return now()


def set_offset(offset: timedelta) -> None:
    global _offset
    _offset = offset


def reset() -> None:
    set_offset(timedelta(0))
    set_lab_shift(timedelta(0))
