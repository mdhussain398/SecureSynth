"""Opaque server-side sessions, CSRF double-submit, device-recognition cookie, simulated location."""
import secrets
from datetime import timedelta

from fastapi import Depends, Request, Response
from sqlalchemy import select

from app import models
from app.errors import ApiError
from app.security import tokens
from app.services import clock
from app.state import AppState, get_db, get_state

SESSION_COOKIE, CSRF_COOKIE, DEVICE_COOKIE = "ss_session", "ss_csrf", "ss_device"
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# Synthetic IP → city table. Loopback resolves to the customer's home city.
SIM_IP_CITY = {"127.0.0.1": None, "::1": None, "testclient": None}


def set_auth_cookies(response: Response, raw_token: str, csrf_raw: str, max_age_s: int) -> None:
    response.set_cookie(SESSION_COOKIE, raw_token, httponly=True, samesite="strict", path="/api", max_age=max_age_s)
    response.set_cookie(CSRF_COOKIE, csrf_raw, httponly=False, samesite="strict", path="/", max_age=max_age_s)


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/api")
    response.delete_cookie(CSRF_COOKIE, path="/")


def new_session(db, user: models.User, *, mode: str, ip: str, city: str, device_id, minutes: int,
                is_lab=False, context=None):
    raw, digest = tokens.new_token()
    csrf_raw, csrf_digest = tokens.new_token()
    now = clock.now()
    s = models.Session(id=secrets.token_hex(8), token_hash=digest, csrf_hash=csrf_digest, user_id=user.id,
                       device_id=device_id, ip=ip, city=city, mode=mode, created_at=now, last_seen=now,
                       expires_at=now + timedelta(minutes=minutes), is_lab=is_lab, context=context or {})
    db.add(s)
    return s, raw, csrf_raw


def rotate(db, s: models.Session, minutes: int):
    raw, digest = tokens.new_token()
    csrf_raw, csrf_digest = tokens.new_token()
    s.token_hash, s.csrf_hash = digest, csrf_digest
    s.expires_at = clock.now() + timedelta(minutes=minutes)
    return raw, csrf_raw


def check_csrf(request: Request, s: models.Session) -> None:
    header = request.headers.get("x-csrf-token", "")
    if not header or not secrets.compare_digest(tokens.hash_token(header), s.csrf_hash):
        raise ApiError(403, "CSRF_FAILED", "Missing or invalid CSRF token.")


def require(*modes: str, roles: tuple[str, ...] = ("customer", "admin")):
    """Dependency factory: authenticated session in one of `modes`, with expiry + CSRF enforcement."""

    def dep(request: Request, db=Depends(get_db), st: AppState = Depends(get_state)):
        raw = request.cookies.get(SESSION_COOKIE)
        if not raw:
            raise ApiError(401, "UNAUTHENTICATED", "Sign in required.")
        s = db.scalar(select(models.Session).where(models.Session.token_hash == tokens.hash_token(raw)))
        now = clock.now()
        if s is None or s.mode == "revoked":
            raise ApiError(401, "UNAUTHENTICATED", "Sign in required.")
        idle = timedelta(minutes=st.settings.session_idle_min)
        if now >= _aware(s.expires_at) or now - _aware(s.last_seen) > idle:
            s.mode = "revoked"
            db.commit()
            raise ApiError(401, "UNAUTHENTICATED", "Session expired.")
        if s.mode == "step_up" and _step_up_expired(db, s, now):
            s.mode = "restricted"  # spec §8: an unresolved step-up ends in restriction, never in silent access
            db.commit()
        user = db.get(models.User, s.user_id)
        if user.role not in roles:
            raise ApiError(403, "FORBIDDEN", "Not permitted.")
        if s.mode not in modes:
            if s.mode == "restricted":
                raise ApiError(403, "SESSION_RESTRICTED", "This session is restricted for your protection.")
            if s.mode == "step_up":
                raise ApiError(403, "STEP_UP_REQUIRED", "Approve the pending request on your trusted device.")
            raise ApiError(401, "UNAUTHENTICATED", "Sign in required.")
        if request.method in MUTATING:
            check_csrf(request, s)
        s.last_seen = now
        db.commit()
        return s, user, db

    return dep


def _aware(dt):
    from datetime import timezone
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def resolve_device(db, request: Request, response: Response, user: models.User):
    """Return (device, recognised). Issues a fresh random cookie for unknown browsers (A1: signal only)."""
    raw = request.cookies.get(DEVICE_COOKIE)
    now = clock.now()
    if raw:
        d = db.scalar(select(models.Device).where(models.Device.user_id == user.id,
                                                  models.Device.token_hash == tokens.hash_token(raw)))
        if d:
            d.last_seen = now
            return d, d.trust == "trusted"
    if not raw:
        raw = secrets.token_urlsafe(24)
        response.set_cookie(DEVICE_COOKIE, raw, httponly=True, samesite="strict", path="/api",
                            max_age=60 * 60 * 24 * 365)
    d = models.Device(user_id=user.id, token_hash=tokens.hash_token(raw), first_seen=now, last_seen=now,
                      trust="candidate")
    db.add(d)
    db.flush()
    return d, False


def resolve_city(request: Request, user: models.User) -> str:
    ip = request.client.host if request.client else ""
    return SIM_IP_CITY.get(ip) or user.home_city


LOOPBACK = {"127.0.0.1", "::1", "testclient"}


def lab_context(request: Request) -> dict | None:
    """Simulated context (city, failed sign-ins) — accepted ONLY in demo mode with the in-process lab token,
    which never leaves the server, so browsers cannot spoof location."""
    import json
    st = request.app.state.ss
    token = request.headers.get("x-lab-token")
    if not (st.settings.demo_mode and token and secrets.compare_digest(token, st.lab_token)):
        return None
    try:
        ctx = json.loads(request.headers.get("x-sim-context", "{}"))
    except ValueError:
        return None
    return {k: ctx[k] for k in ("city", "failed_auth_24h", "ip", "ua") if k in ctx}


def _step_up_expired(db, s, now) -> bool:
    c = db.scalar(select(models.Challenge).where(models.Challenge.session_id == s.id)
                  .order_by(models.Challenge.created_at.desc()).limit(1))
    if c is None or c.status != "pending" or now < _aware(c.expires_at):
        return False
    c.status = "expired"
    return True


def require_verified_reader():
    """Account reads: allowed while a later transfer/payee step-up is pending, but NOT while the login
    itself awaits independent verification (password + TOTP alone must not grant access)."""
    base = require("normal", "step_up", "ghost")

    def dep(ctx=Depends(base)):
        s = ctx[0]
        if s.mode == "step_up" and (s.context or {}).get("step_up_op") == "login":
            raise ApiError(403, "STEP_UP_REQUIRED", "Approve this sign-in on your trusted device first.")
        return ctx

    return dep
