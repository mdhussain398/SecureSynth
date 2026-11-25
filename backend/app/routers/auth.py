from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select

from app import models, schemas
from app.errors import ApiError
from app.risk import engine
from app.security import passwords, totp
from app.services import audit, clock, enforcement, sessions
from app.services.sessions import require
from app.state import AppState, get_db, get_state

router = APIRouter(prefix="/auth", tags=["auth"])
_DUMMY_HASH = passwords.hash_password("timing-equaliser")


def session_info(s: models.Session, u: models.User) -> schemas.SessionInfo:
    return schemas.SessionInfo(
        username=u.username, display_name=u.display_name, role=u.role, mode=s.mode, expires_at=s.expires_at,
        simulated_context=schemas.SimContext(city=s.city, device_recognised=bool(s.context.get("device_recognised"))))


def challenge_ref(c: models.Challenge | None):
    if c is None:
        return None
    return schemas.ChallengeRef(id=c.id, operation=c.operation, number_match=c.number_match, expires_at=c.expires_at)


@router.post("/login", response_model=schemas.LoginResponse)
def login(body: schemas.LoginRequest, request: Request, response: Response,
          db=Depends(get_db), st: AppState = Depends(get_state)):
    ip = request.client.host if request.client else ""
    keys = (f"user:{body.username.lower()}", f"ip:{ip}")
    if not all(st.login_limiter.allowed(k) for k in keys):
        raise ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.")
    user = db.scalar(select(models.User).where(models.User.username == body.username.lower()))
    ok = passwords.verify_password(user.password_hash if user else _DUMMY_HASH, body.password)
    db.add(models.LoginAttempt(username=body.username.lower()[:40], ip=ip, stage="password", success=bool(user and ok),
                               reason="ok" if (user and ok) else "bad_credentials", ts=clock.now()))
    if not (user and ok) or user.status != "active":
        for k in keys:
            st.login_limiter.record_failure(k)
        db.commit()
        raise ApiError(401, "INVALID_CREDENTIALS", "Username or password is incorrect.")
    s, raw, csrf_raw = sessions.new_session(db, user, mode="pre_otp", ip=ip, city="", device_id=None,
                                            minutes=st.settings.pre_otp_min)
    db.commit()
    sessions.set_auth_cookies(response, raw, csrf_raw, st.settings.pre_otp_min * 60)
    return schemas.LoginResponse()


@router.post("/totp", response_model=schemas.TotpResponse)
def verify_totp(body: schemas.TotpRequest, request: Request, response: Response,
                ctx=Depends(require("pre_otp")), st: AppState = Depends(get_state)):
    s, user, db = ctx
    key = f"totp:{user.id}"
    if not st.totp_limiter.allowed(key):
        raise ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.")
    secret = st.box.decrypt(user.totp_secret_enc)
    step = totp.verify(secret, body.code, last_step=user.totp_last_step)
    if step is None:
        st.totp_limiter.record_failure(key)
        replay = totp.verify(secret, body.code, last_step=None) is not None
        db.add(models.LoginAttempt(username=user.username, ip=s.ip, stage="totp", success=False,
                                   reason="replay" if replay else "bad_code", ts=clock.now()))
        db.commit()
        raise ApiError(401, "TOTP_REPLAY" if replay else "INVALID_TOTP", "That code is not valid.")
    user.totp_last_step = step
    device, recognised = sessions.resolve_device(db, request, response, user)
    s.device_id, s.city = device.id, sessions.resolve_city(request, user)
    s.context = {**(s.context or {}), "device_recognised": recognised}
    lab = sessions.lab_context(request)
    if lab is not None:
        from app.risk.features import CITY_COORDS
        if lab.get("city") in CITY_COORDS:
            s.city = lab["city"]
        s.context = {**s.context, "failed_auth_24h": int(lab.get("failed_auth_24h", 0))}
        s.is_lab = True
    s.mode = "normal"
    raw, csrf_raw = sessions.rotate(db, s, st.settings.session_abs_min)  # no session fixation
    a = engine.assess(db, st, s, user, "login")
    challenge = None
    if a.decision == "STEP_UP":
        challenge = enforcement.on_step_up(db, st, s, "login", {"login": True},
                                           f"Sign-in · {s.city} (simulated)", a.id)
    elif a.decision == "BLOCK":
        enforcement.on_block(db, st, s, a)
    audit.log(db, user.username, "auth.login", user.id, s.id, decision=a.decision, city=s.city,
              device_recognised=recognised)
    db.commit()
    sessions.set_auth_cookies(response, raw, csrf_raw, st.settings.session_abs_min * 60)
    return schemas.TotpResponse(decision=a.decision, session=session_info(s, user), challenge=challenge_ref(challenge),
                                customer_message=a.customer_message)


@router.get("/me", response_model=schemas.SessionInfo)
def me(ctx=Depends(require("normal", "step_up", "restricted", "ghost"))):
    s, user, _ = ctx
    return session_info(s, user)


@router.get("/challenge/{challenge_id}", response_model=schemas.ChallengeStatusResponse)
def challenge_status(challenge_id: str, ctx=Depends(require("normal", "step_up", "restricted"))):
    s, _, db = ctx
    c = db.get(models.Challenge, challenge_id)
    if c is None or c.session_id != s.id:
        raise ApiError(404, "NOT_FOUND", "Challenge not found.")
    status = c.status
    if status == "pending" and clock.now() >= sessions._aware(c.expires_at):
        status = "expired"
    return schemas.ChallengeStatusResponse(id=c.id, operation=c.operation, status=status)


@router.post("/logout", status_code=204)
def logout(response: Response, ctx=Depends(require("normal", "step_up", "restricted", "ghost", "pre_otp"))):
    s, user, db = ctx
    s.mode = "revoked"
    audit.log(db, user.username, "auth.logout", user.id, s.id)
    db.commit()
    sessions.clear_auth_cookies(response)
    response.status_code = 204
    return response


@router.get("/incident")
def my_incident(request: Request, response: Response, db=Depends(get_db), st: AppState = Depends(get_state)):
    """Customer-side incident status, polled from the restricted screen. Read-only: there is no customer
    endpoint that changes an incident. Also answers for a session an analyst closed during recovery, so the
    customer learns to sign in again; such a token still grants nothing else (every other route rejects it)."""
    from app.security import tokens
    from app.services import incidents
    raw = request.cookies.get(sessions.SESSION_COOKIE)
    s = db.scalar(select(models.Session).where(models.Session.token_hash == tokens.hash_token(raw or "")))
    if s is None or s.mode == "pre_otp":
        raise ApiError(401, "UNAUTHENTICATED", "Sign in required.")
    closed = s.mode == "revoked" and (s.context or {}).get("closed_by_incident")
    if s.mode == "revoked" and not closed:
        raise ApiError(401, "UNAUTHENTICATED", "Sign in required.")
    if not closed:
        now = clock.now()
        idle = timedelta(minutes=st.settings.session_idle_min)
        if now >= sessions._aware(s.expires_at) or now - sessions._aware(s.last_seen) > idle:
            s.mode = "revoked"
            db.commit()
            raise ApiError(401, "UNAUTHENTICATED", "Session expired.")
        s.last_seen = now
        db.commit()
    inc = next((i for i in db.scalars(select(models.SecurityIncident).where(models.SecurityIncident.user_id == s.user_id)
                                      .order_by(models.SecurityIncident.id.desc()).limit(20)).all()
                if s.id in (i.session_ids or [])), None)  # the newest incident this session belongs to
    out = incidents.customer_view(db, inc, s)
    if closed:
        sessions.clear_auth_cookies(response)  # the old token is finished; the customer signs in afresh
    return out
