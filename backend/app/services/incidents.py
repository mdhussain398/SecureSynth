"""Security incidents: analyst notification and analyst-assisted recovery for restricted customers.

Design rules (see docs/INCIDENT_RECOVERY.md):
  * An incident is opened automatically by the backend whenever enforcement restricts a session (a risk-engine
    BLOCK, or a denied trusted-device check). Later restrictions for the same customer attach to the one
    unresolved incident, so the analyst gets one alert per incident, not one per request.
  * Only an analyst decision resolves an incident. There is no timer, no re-login side effect and no allow-list.
  * Clearance never touches scores, thresholds, the model or the trusted baseline. It (a) restores an eligible
    session or revokes it so the customer signs in afresh, and (b) marks the incident's never-executed transfer
    attempts as `reviewed`, so they stop counting as behavioural velocity. The rows themselves are kept as
    evidence, and blocked transactions stay `restricted` forever: nothing is ever executed on clearance.
  * Every state change is a conditional UPDATE on (id, version, open status): concurrent or repeated requests
    resolve once; a repeat of the same decision is answered idempotently.
"""
from datetime import timedelta

from sqlalchemy import func, select, update

from app import models
from app.errors import ApiError
from app.services import audit, clock

OPEN = ("pending_review", "verification_requested")
CLOSED = ("session_restored", "user_cleared", "restriction_retained", "session_revoked")
CUSTOMER_STATUS = {
    "pending_review": "pending_review", "verification_requested": "verification_required",
    "session_restored": "access_restored", "user_cleared": "access_restored",
    "restriction_retained": "restriction_retained", "session_revoked": "restriction_retained",
}
ACTIONS = {  # action -> resulting incident status
    "unblock_session": "session_restored", "clear_user": "user_cleared",
    "keep_restricted": "restriction_retained", "revoke_session": "session_revoked",
}
CLEARANCES = {"unblock_session", "clear_user"}  # these lift a restriction: fresh analyst TOTP required
UNEXECUTED = ("blocked", "pending", "denied")


def _aware(dt):
    from datetime import timezone
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def severity(score: float | None, trigger: str) -> str:
    if trigger == "verification_denied" or (score is not None and score >= 95):
        return "critical"
    return "high"


def open_incident_for(db, user_id: int) -> models.SecurityIncident | None:
    return db.scalar(select(models.SecurityIncident).where(models.SecurityIncident.user_id == user_id,
                                                           models.SecurityIncident.status.in_(OPEN))
                     .order_by(models.SecurityIncident.id.desc()).limit(1))


def on_restriction(db, s: models.Session, *, trigger: str, assessment: models.RiskAssessment | None = None,
                   transaction: models.Transaction | None = None) -> models.SecurityIncident:
    """Open an incident, or attach this restriction to the customer's unresolved one (no duplicate alert)."""
    now = clock.now()
    a = assessment
    reason = (a.customer_message if a is not None else "The customer's trusted device declined a verification request.")
    labels = [p["label"] for p in (a.policy if a is not None else []) if p["points"] > 0]
    if a is not None:
        reason = (f"Risk index {a.risk_score:.1f} at {a.checkpoint.replace('_', ' ')} "
                  f"(block threshold {a.thresholds.get('block')}). " + ("; ".join(labels) or "Behavioural anomaly")).strip()
    amount = transaction.amount_paise if transaction is not None else None
    inc = open_incident_for(db, s.user_id)
    if inc is not None:
        ids = list(inc.session_ids or [])
        if s.id not in ids:
            ids.append(s.id)
        db.execute(update(models.SecurityIncident).where(models.SecurityIncident.id == inc.id).values(
            session_ids=ids, session_id=s.id, block_count=models.SecurityIncident.block_count + 1,
            last_assessment_id=a.id if a is not None else inc.last_assessment_id,
            risk_score=max(inc.risk_score or 0, a.risk_score) if a is not None else inc.risk_score,
            severity="critical" if severity(a.risk_score if a else None, trigger) == "critical" else inc.severity,
            amount_paise=amount if amount is not None else inc.amount_paise,
            transaction_id=transaction.id if transaction is not None else inc.transaction_id,
            last_activity_at=now, analyst_read_at=None, version=models.SecurityIncident.version + 1))
        db.expire(inc)
        audit.log(db, "system", "incident.updated", s.user_id, s.id, incident_id=inc.id, trigger=trigger,
                  risk_score=a.risk_score if a is not None else None)
        return inc
    inc = models.SecurityIncident(
        user_id=s.user_id, session_id=s.id, session_ids=[s.id], assessment_id=a.id if a is not None else None,
        last_assessment_id=a.id if a is not None else None, transaction_id=transaction.id if transaction else None,
        trigger=trigger, checkpoint=a.checkpoint if a is not None else "verification",
        risk_score=a.risk_score if a is not None else None, severity=severity(a.risk_score if a else None, trigger),
        amount_paise=amount, city=s.city or "", device_ref=f"dev-{s.device_id}" if s.device_id else None,
        device_recognised=bool((s.context or {}).get("device_recognised")), reason=reason[:300],
        status="pending_review", is_lab=bool(s.is_lab), created_at=now, last_activity_at=now)
    db.add(inc)
    db.flush()
    audit.log(db, "system", "incident.opened", s.user_id, s.id, incident_id=inc.id, trigger=trigger,
              severity=inc.severity, risk_score=inc.risk_score, status="pending_review")
    return inc


def refresh_verification(db, inc: models.SecurityIncident) -> None:
    """An unanswered verification request expires with its challenge and returns to analyst review."""
    if inc.status != "verification_requested" or not inc.verification_challenge_id:
        return
    c = db.get(models.Challenge, inc.verification_challenge_id)
    if c is not None and c.status == "pending" and clock.now() < _aware(c.expires_at):
        return
    if c is not None and c.status == "pending":
        c.status = "expired"
    res = db.execute(update(models.SecurityIncident).where(
        models.SecurityIncident.id == inc.id, models.SecurityIncident.status == "verification_requested",
        models.SecurityIncident.version == inc.version).values(
        status="pending_review", verification="expired" if c is None or c.status == "expired" else inc.verification,
        analyst_read_at=None, last_activity_at=clock.now(), version=inc.version + 1))
    if res.rowcount:
        audit.log(db, "system", "incident.verification_expired", inc.user_id, inc.session_id, incident_id=inc.id)
    db.commit()
    db.refresh(inc)


def on_verification_result(db, challenge: models.Challenge, approved: bool) -> None:
    """Trusted-device answer to an analyst's verification request. Evidence for the analyst only:
    it never restores access by itself."""
    inc = db.get(models.SecurityIncident, (challenge.payload or {}).get("incident_id"))
    if inc is None or inc.status != "verification_requested" or inc.verification_challenge_id != challenge.id:
        return
    result = "approved" if approved else "denied"
    db.execute(update(models.SecurityIncident).where(models.SecurityIncident.id == inc.id,
                                                     models.SecurityIncident.version == inc.version).values(
        status="pending_review", verification=result, analyst_read_at=None, last_activity_at=clock.now(),
        version=inc.version + 1))
    audit.log(db, "trusted_device", "incident.verification_" + result, inc.user_id, inc.session_id,
              incident_id=inc.id, verification=result)


# ---------------------------------------------------------------- analyst actions

def _session_expired(st, s: models.Session) -> bool:
    now = clock.now()
    return now >= _aware(s.expires_at) or now - _aware(s.last_seen) > timedelta(minutes=st.settings.session_idle_min)


def login_verified(db, s: models.Session) -> bool:
    """Was this session's sign-in itself accepted (ALLOW, or STEP_UP approved on the trusted device)?
    A session whose sign-in was blocked or never verified must never be restored: that would turn
    password + TOTP alone into access."""
    login = db.scalar(select(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id,
                                                          models.RiskAssessment.checkpoint == "login")
                      .order_by(models.RiskAssessment.id).limit(1))
    if login is None or login.decision == "BLOCK":
        return False
    if login.decision == "ALLOW":
        return True
    return db.scalar(select(func.count()).select_from(models.Challenge).where(
        models.Challenge.session_id == s.id, models.Challenge.operation == "login",
        models.Challenge.status == "approved")) > 0


def session_eligibility(db, st, s: models.Session | None) -> tuple[bool, str]:
    if s is None:
        return False, "Session not found."
    if s.mode != "restricted":
        return False, f"Session is {s.mode.replace('_', '-')}, not restricted."
    if _session_expired(st, s):
        return False, "Session has expired. Its token cannot be reactivated; clear the customer instead so they sign in afresh."
    if not login_verified(db, s):
        return False, "This session's sign-in was never verified. Restoring it would grant access on password + TOTP alone; clear the customer instead."
    return True, "Eligible: sign-in was verified and the session is still within its lifetime."


def mark_attempts_reviewed(db, inc: models.SecurityIncident) -> int:
    """Never-executed transfer attempts in this incident's sessions stop counting as velocity. Kept as evidence."""
    res = db.execute(update(models.HistoryEvent).where(
        models.HistoryEvent.user_id == inc.user_id, models.HistoryEvent.session_ref.in_(inc.session_ids or []),
        models.HistoryEvent.event_type == "transfer", models.HistoryEvent.outcome.in_(UNEXECUTED)).values(outcome="reviewed"))
    return res.rowcount or 0


def act(db, st, inc: models.SecurityIncident, analyst: models.User, action: str, reason: str,
        session_id: str | None = None) -> dict:
    """Apply one analyst decision. Idempotent: repeating the decision that already resolved it returns it."""
    if inc.user_id == analyst.id:
        raise ApiError(403, "FORBIDDEN", "Analysts cannot resolve an incident on their own account.")
    refresh_verification(db, inc)
    if action == "request_verification":
        return _request_verification(db, st, inc, analyst, reason)
    target = ACTIONS[action]
    if inc.status not in OPEN:
        if inc.status == target and inc.resolution_action == action:
            return {"incident_id": inc.id, "status": inc.status, "idempotent": True}
        raise ApiError(409, "INCIDENT_RESOLVED", f"This incident was already resolved ({inc.status.replace('_', ' ')}).")
    sid = session_id or inc.session_id
    if sid not in (inc.session_ids or []):
        raise ApiError(422, "VALIDATION_ERROR", "That session is not part of this incident.")
    s = db.get(models.Session, sid)
    if action == "unblock_session":
        ok, why = session_eligibility(db, st, s)
        if not ok:
            raise ApiError(409, "SESSION_NOT_ELIGIBLE", why)
    previous = inc.status
    now = clock.now()
    res = db.execute(update(models.SecurityIncident).where(
        models.SecurityIncident.id == inc.id, models.SecurityIncident.version == inc.version,
        models.SecurityIncident.status.in_(OPEN)).values(
        status=target, resolution_action=action, resolution_reason=reason, resolved_by=analyst.username,
        resolved_at=now, last_activity_at=now, analyst_read_at=now, version=inc.version + 1))
    if res.rowcount == 0:  # lost a race with another analyst request: report what actually happened
        db.rollback()
        db.refresh(inc)
        if inc.status == target and inc.resolution_action == action:
            return {"incident_id": inc.id, "status": inc.status, "idempotent": True}
        raise ApiError(409, "INCIDENT_RESOLVED", f"This incident was already resolved ({inc.status.replace('_', ' ')}).")

    changed: list[dict] = []

    def set_mode(sess: models.Session, mode: str, note: str | None = None):
        changed.append({"session_id": sess.id, "from": sess.mode, "to": mode})
        sess.mode = mode
        ctx = {k: v for k, v in (sess.context or {}).items() if k != "step_up_op" or mode != "normal"}
        if note:
            ctx[note] = inc.id
        sess.context = ctx

    reviewed = 0
    if action == "unblock_session":
        set_mode(s, "normal", "cleared_by_incident")
        reviewed = mark_attempts_reviewed(db, inc)
    elif action == "clear_user":
        for other in db.scalars(select(models.Session).where(models.Session.id.in_(inc.session_ids or []))).all():
            if other.mode in ("restricted", "step_up", "normal", "ghost"):
                set_mode(other, "revoked", "closed_by_incident")  # tokens are never reactivated
        reviewed = mark_attempts_reviewed(db, inc)
    elif action == "revoke_session":
        for other in db.scalars(select(models.Session).where(models.Session.id.in_(inc.session_ids or []))).all():
            if other.mode != "revoked":
                set_mode(other, "revoked", "closed_by_incident")
    # keep_restricted: sessions stay exactly as they are
    for c in db.scalars(select(models.Challenge).where(models.Challenge.session_id.in_(inc.session_ids or []),
                                                       models.Challenge.status == "pending")).all():
        c.status = "denied" if action in ("revoke_session", "keep_restricted", "clear_user") else c.status
    audit.log(db, analyst.username, f"incident.{action}", inc.user_id, sid, incident_id=inc.id, action=action,
              reason=reason, previous_state=previous, resulting_state=target, session_ids=changed,
              reviewed_attempts=reviewed, role="admin")
    db.commit()
    db.refresh(inc)
    return {"incident_id": inc.id, "status": inc.status, "idempotent": False, "sessions": changed,
            "reviewed_attempts": reviewed}


def _request_verification(db, st, inc, analyst, reason) -> dict:
    from app.services import challenges
    if inc.status not in OPEN:
        raise ApiError(409, "INCIDENT_RESOLVED", "This incident is already resolved.")
    if inc.status == "verification_requested":
        return {"incident_id": inc.id, "status": inc.status, "idempotent": True}
    s = db.get(models.Session, inc.session_id)
    if s is None or s.mode != "restricted" or _session_expired(st, s):
        raise ApiError(409, "SESSION_NOT_ELIGIBLE",
                       "The customer's restricted session has ended, so there is no screen to show the number on. "
                       "Clear or retain the restriction instead.")
    u = db.get(models.User, inc.user_id)
    if not u.device_key_hash:
        raise ApiError(409, "SESSION_NOT_ELIGIBLE", "This customer has no registered trusted device.")
    c = challenges.create(db, st, s, "incident_verify", {"incident_id": inc.id},
                          f"Bank security check · incident #{inc.id}", inc.last_assessment_id)
    res = db.execute(update(models.SecurityIncident).where(
        models.SecurityIncident.id == inc.id, models.SecurityIncident.version == inc.version,
        models.SecurityIncident.status == "pending_review").values(
        status="verification_requested", verification="requested", verification_challenge_id=c.id,
        last_activity_at=clock.now(), version=inc.version + 1))
    if res.rowcount == 0:
        db.rollback()
        raise ApiError(409, "INCIDENT_RESOLVED", "The incident changed while you were acting. Reload and try again.")
    audit.log(db, analyst.username, "incident.request_verification", inc.user_id, s.id, incident_id=inc.id,
              action="request_verification", reason=reason, previous_state="pending_review",
              resulting_state="verification_requested", challenge_id=c.id, role="admin")
    db.commit()
    db.refresh(inc)
    return {"incident_id": inc.id, "status": inc.status, "idempotent": False}


# ---------------------------------------------------------------- views

def summary_row(db, inc: models.SecurityIncident) -> dict:
    u = db.get(models.User, inc.user_id)
    return {"id": inc.id, "user_id": inc.user_id, "username": u.username, "display_name": u.display_name,
            "session_id": inc.session_id, "session_ids": inc.session_ids or [], "assessment_id": inc.assessment_id,
            "trigger": inc.trigger, "checkpoint": inc.checkpoint, "risk_score": inc.risk_score,
            "severity": inc.severity, "amount_paise": inc.amount_paise, "city": inc.city,
            "device_ref": inc.device_ref, "device_recognised": inc.device_recognised, "reason": inc.reason,
            "block_count": inc.block_count, "status": inc.status, "open": inc.status in OPEN,
            "verification": inc.verification, "is_lab": inc.is_lab, "unread": inc.analyst_read_at is None,
            "created_at": inc.created_at, "last_activity_at": inc.last_activity_at, "resolved_at": inc.resolved_at,
            "resolved_by": inc.resolved_by, "resolution_action": inc.resolution_action,
            "resolution_reason": inc.resolution_reason}


def customer_view(db, inc: models.SecurityIncident | None, s: models.Session) -> dict:
    if inc is None:
        # restricted without an incident (e.g. a step-up that timed out): a fresh sign-in is re-assessed normally
        return {"incident": None, "session_mode": s.mode,
                "next_step": "continue" if s.mode == "normal" else "sign_in_again"}
    refresh_verification(db, inc)
    status = CUSTOMER_STATUS[inc.status]
    verify = None
    if inc.status == "verification_requested" and inc.verification_challenge_id:
        c = db.get(models.Challenge, inc.verification_challenge_id)
        if c is not None and c.status == "pending" and c.session_id == s.id:
            verify = {"number_match": c.number_match, "expires_at": c.expires_at}
    if s.mode == "normal":
        step = "continue"
    elif s.mode == "revoked":
        step = "sign_in_again" if status == "access_restored" else "contact_bank"
    elif status == "verification_required":
        step = "verify"
    elif status == "restriction_retained":
        step = "contact_bank"
    else:
        step = "wait"
    return {"incident": {"id": inc.id, "status": status, "updated_at": inc.last_activity_at,
                         "opened_at": inc.created_at, "verification": verify},
            "session_mode": s.mode, "next_step": step}
