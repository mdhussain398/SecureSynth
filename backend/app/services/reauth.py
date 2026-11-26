"""Fresh analyst authentication for sensitive actions: a current TOTP code, replay-protected and rate-limited."""
from app import models
from app.errors import ApiError
from app.security import totp as totp_mod
from app.services import audit


def require_fresh_totp(db, st, user: models.User, code: str | None, action: str, **audit_details) -> None:
    key = f"totp:{user.id}"
    if not st.totp_limiter.allowed(key):
        raise ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.")
    if not code:
        raise ApiError(403, "REAUTH_REQUIRED", "Enter a current code from your authenticator to confirm.")
    step = totp_mod.verify(st.box.decrypt(user.totp_secret_enc), code, last_step=user.totp_last_step)
    if step is None:
        st.totp_limiter.record_failure(key)
        audit.log(db, user.username, "reauth.failed", user.id, None, action=action, **audit_details)
        db.commit()
        raise ApiError(403, "REAUTH_FAILED", "That code is not valid, or was already used. Wait for the next one.")
    user.totp_last_step = step
    db.flush()
