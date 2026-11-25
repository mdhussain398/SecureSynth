"""TOTP verification with replay protection (RFC 6238, 30 s steps, ±1 step drift)."""
from datetime import datetime, timezone

import pyotp

STEP_SECONDS = 30
DRIFT_STEPS = 1


def verify(secret: str, code: str, last_step: int | None, now: datetime | None = None) -> int | None:
    """Return the matched time-step if `code` is valid and newer than `last_step`, else None.

    `now` defaults to REAL wall-clock time (not the simulated clock).
    """
    if not (isinstance(code, str) and len(code) == 6 and code.isdigit()):
        return None
    now = now or datetime.now(timezone.utc)
    totp = pyotp.TOTP(secret)
    current = int(now.timestamp()) // STEP_SECONDS
    for step in range(current - DRIFT_STEPS, current + DRIFT_STEPS + 1):
        if last_step is not None and step <= last_step:
            continue
        if pyotp.utils.strings_equal(totp.generate_otp(step), code):
            return step
    return None
