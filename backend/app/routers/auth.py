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
    # A contained (ghost) session is shown as an ordinary one: the backend enforces containment on every route, and
    # telling the session holder would defeat it. Analyst views read the real mode from the admin API.
    return schemas.SessionInfo(
        username=u.username, display_name=u.display_name, role=u.role, mode="normal" if s.mode == "ghost" else s.mode,
        expires_at=s.expires_at,
        simulated_context=schemas.SimContext(city=s.city, device_recognised=bool(s.context.get("device_recognised"))))


def challenge_ref(c: models.Challenge | None):
    if c is None:
        return None
    return schemas.ChallengeRef(id=c.id, operation=c.operation, number_match=c.number_match, expires_at=c.expires_at)


@router.post("/login", response_model=schemas.LoginResponse)
def login(body: schemas.LoginRequest, request: Request, response: Response,
          db=Depends(get_db), st: AppState = Depends(get_state)):
    from app.evidence.netinfo import client_ip
    ip, _ = client_ip(request, st.settings.trusted_proxies)
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
    from app.evidence.netinfo import client_ip
    obs_ip, ip_how = client_ip(request, st.settings.trusted_proxies)
    s.ip = obs_ip
    s.context = {**(s.context or {}), "device_recognised": recognised,
                 "ua": request.headers.get("user-agent", "")[:300], "ip_how": ip_how, "auth_at": clock.now().isoformat()}
    lab = sessions.lab_context(request)
    if lab is not None:
        from app.risk.features import CITY_COORDS
        if lab.get("city") in CITY_COORDS:
            s.city = lab["city"]
        s.context = {**s.context, "failed_auth_24h": int(lab.get("failed_auth_24h", 0))}
        if lab.get("ip"):  # Scenario Lab: a simulated address, always labelled synthetic in evidence
            s.context = {**s.context, "sim_ip": str(lab["ip"])[:45]}
        if lab.get("ua"):
            s.context = {**s.context, "ua": str(lab["ua"])[:300]}
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
    if s.mode == "ghost":  # BLOCK with Ghost Banking on: answer like an ordinary sign-in (decision is in the audit log)
        return schemas.TotpResponse(decision="ALLOW", session=session_info(s, user), challenge=None,
                                    customer_message="Welcome back.")
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
    if s.mode == "ghost":
        s.last_seen = clock.now()
        db.commit()
        return {"incident": None, "session_mode": "normal", "next_step": "continue"}
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


@router.get("/security-check")
def security_check(ctx=Depends(require("normal", "step_up", "ghost"))):
    """A pending bank security check (analyst-requested trusted-device verification) for this session, if any:
    the number the customer must pick on their registered device. Generic wording, works in any active mode."""
    s, _, db = ctx
    c = db.scalar(select(models.Challenge).where(models.Challenge.session_id == s.id,
                                                 models.Challenge.operation == "incident_verify",
                                                 models.Challenge.status == "pending")
                  .order_by(models.Challenge.created_at.desc()).limit(1))
    if c is None or clock.now() >= sessions._aware(c.expires_at):
        return {"check": None}
    return {"check": {"number_match": c.number_match, "expires_at": c.expires_at}}


# ---------------------------------------------------------------- consented verification photograph (customer side)
def _blocked_transfer_incident(db, s):
    from app.services.incidents import open_incident_for

    inc = open_incident_for(db, s.user_id, bool(s.is_lab))
    if inc is None or s.id not in (inc.session_ids or []):
        return None
    blocked = db.scalar(select(models.Transaction.id).where(
        models.Transaction.session_id == s.id, models.Transaction.status == "restricted").limit(1))
    return inc if blocked is not None else None


@router.get("/photo-request")
def my_photo_request(ctx=Depends(require("normal", "step_up", "restricted", "ghost")), st: AppState = Depends(get_state)):
    from app.evidence.models import PhotoRequest
    from app.routers.investigation import photo_request_closed

    s, _, db = ctx
    with st.EvidenceSessionLocal() as edb:
        p = edb.scalar(select(PhotoRequest).where(PhotoRequest.session_id == s.id, PhotoRequest.status == "pending",
                                                   PhotoRequest.expires_at > clock.now())
                       .order_by(PhotoRequest.created_at.desc()).limit(1))
        if p is None:
            inc = _blocked_transfer_incident(db, s)
            available = inc is not None and not photo_request_closed(edb, inc.ref, s.id)
            return {"request": None, "can_start": available}
        return {"request": {"id": p.id, "reason": "You can share an optional photo for the security team's review.",
                            "expires_at": p.expires_at}, "can_start": False}


@router.post("/photo-request")
def start_my_photo_request(ctx=Depends(require("normal", "step_up", "restricted", "ghost", roles=("customer",))),
                           st: AppState = Depends(get_state)):
    from app.routers.investigation import create_photo_request

    s, _, db = ctx
    inc = _blocked_transfer_incident(db, s)
    if inc is None:
        raise ApiError(409, "SESSION_NOT_ELIGIBLE", "Photo verification is unavailable for this sign-in.")
    return create_photo_request(st, db, inc, s.id, "session_holder", "Offered after a blocked transfer", self_started=True)


class PhotoSubmit(schemas.BaseModel):
    consent: bool
    image_base64: str = schemas.Field(min_length=100, max_length=4_200_000)
    mime: str = schemas.Field(pattern=r"^image/(jpeg|png)$")
    captured_at: str | None = schemas.Field(default=None, max_length=40)


def _own_pending(st, s, request_id):
    from app.evidence.models import PhotoRequest
    with st.EvidenceSessionLocal() as edb:
        p = edb.get(PhotoRequest, request_id)
    if p is None or p.session_id != s.id:  # another session's request is invisible
        raise ApiError(404, "NOT_FOUND", "Request not found.")
    if p.status != "pending" or clock.now() >= p.expires_at:
        raise ApiError(409, "REQUEST_CLOSED", "This verification request is no longer open.")
    return p


@router.post("/photo-request/{request_id}/submit")
def submit_photo(request_id: str, body: PhotoSubmit, ctx=Depends(require("normal", "step_up", "restricted", "ghost")),
                 st: AppState = Depends(get_state)):
    from app.routers.investigation import accept_photo, decode_image
    s, user, db = ctx
    if body.consent is not True:
        raise ApiError(422, "CONSENT_REQUIRED", "A photograph is only accepted with your explicit consent.")
    p = _own_pending(st, s, request_id)
    data = decode_image(body.image_base64, body.mime, st.settings.evidence_max_upload_bytes)
    item = accept_photo(st, db, p, data, body.mime, body.captured_at, "session_holder")
    return {"status": "submitted", "received_at": item.collected_at}


@router.post("/photo-request/{request_id}/decline")
def decline_photo(request_id: str, ctx=Depends(require("normal", "step_up", "restricted", "ghost")),
                  st: AppState = Depends(get_state)):
    from app.evidence import vault
    from app.evidence.models import PhotoRequest
    s, _, db = ctx
    p = _own_pending(st, s, request_id)
    with st.EvidenceSessionLocal() as edb:
        pr = edb.get(PhotoRequest, p.id)
        pr.status, pr.responded_at, pr.consent = "declined", clock.now(), False
        edb.commit()
        vault.append(edb, chain=vault.chain_for(pr.is_lab), event_type="photo_declined", actor="session_holder",
                     incident_ref=pr.incident_ref, meta={"request_id": pr.id})
    audit.log(db, "session_holder", "incident.photo_declined", s.user_id, s.id)
    db.commit()
    return {"status": "declined"}
