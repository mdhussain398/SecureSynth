from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app import models, schemas
from app.risk import engine
from app.services.sessions import require
from app.state import AppState, get_state

router = APIRouter(prefix="/admin", tags=["admin"])
ADMIN = require("normal", roles=("admin",))


@router.get("/config", response_model=schemas.AppConfig)
def config(ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.services import ghost_control
    return schemas.AppConfig(ghost_banking_enabled=ghost_control.is_active(ctx[2], st),
                             demo_mode=st.settings.demo_mode, model_version=engine.MODEL_VERSION)


@router.get("/sessions")
def list_sessions(decision: str | None = None, limit: int = 50, ctx=Depends(ADMIN)):
    _, _, db = ctx
    q = select(models.Session).where(models.Session.mode != "pre_otp")
    if decision:  # filter in SQL on each session's latest assessment, before LIMIT
        latest = (select(models.RiskAssessment.session_id, func.max(models.RiskAssessment.id).label("mid"))
                  .group_by(models.RiskAssessment.session_id).subquery())
        q = (q.join(latest, latest.c.session_id == models.Session.id)
             .join(models.RiskAssessment, models.RiskAssessment.id == latest.c.mid)
             .where(models.RiskAssessment.decision == decision))
    rows = db.scalars(q.order_by(models.Session.created_at.desc()).limit(max(1, min(limit, 200)))).all()
    out = []
    for s in rows:
        r = _row(db, s)
        if decision and r["latest_decision"] != decision:
            continue
        out.append(r)
    return out


import json
from pathlib import Path

from pydantic import BaseModel, Field

from app.errors import ApiError
from app.risk import features as F
from app.risk import policy
from app.services import audit


def _row(db, s: models.Session) -> dict:
    u = db.get(models.User, s.user_id)
    latest = db.scalar(select(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id)
                       .order_by(models.RiskAssessment.id.desc()).limit(1))
    n = db.scalar(select(func.count()).select_from(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id))
    return {"id": s.id, "user_id": u.id, "username": u.username, "display_name": u.display_name, "mode": s.mode,
            "created_at": s.created_at, "last_seen": s.last_seen, "city": s.city,
            "device_recognised": bool((s.context or {}).get("device_recognised")),
            "latest_score": latest.risk_score if latest else None,
            "latest_decision": latest.decision if latest else None, "assessments_count": n, "is_lab": s.is_lab}


def assessment_out(a: models.RiskAssessment) -> dict:
    return {"id": a.id, "ts": a.ts, "checkpoint": a.checkpoint, "risk_score": a.risk_score, "decision": a.decision,
            "ml": {"raw": a.ml_raw, "index": a.ml_index}, "deviations": a.deviations, "policy": a.policy,
            "ml_weight": a.ml_weight, "thresholds": a.thresholds, "model_version": a.model_version,
            "latency_ms": a.latency_ms, "customer_message": a.customer_message, "features": a.features}


@router.get("/sessions/{session_id}")
def session_detail(session_id: str, ctx=Depends(ADMIN)):
    _, _, db = ctx
    s = db.get(models.Session, session_id)
    if s is None:
        raise ApiError(404, "NOT_FOUND", "Session not found.")
    assessments = db.scalars(select(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id)
                             .order_by(models.RiskAssessment.id)).all()
    audit_rows = db.scalars(select(models.AuditEvent).where(models.AuditEvent.session_id == s.id)
                            .order_by(models.AuditEvent.id)).all()
    return {"session": _row(db, s), "assessments": [assessment_out(a) for a in assessments],
            "audit": [{"id": e.id, "ts": e.ts, "actor": e.actor, "event_type": e.event_type, "details": e.details}
                      for e in audit_rows]}


@router.post("/sessions/{session_id}/revoke")
def revoke(session_id: str, ctx=Depends(ADMIN)):
    admin_s, admin, db = ctx
    s = db.get(models.Session, session_id)
    if s is None:
        raise ApiError(404, "NOT_FOUND", "Session not found.")
    s.mode = "revoked"
    audit.log(db, admin.username, "session.revoked", s.user_id, s.id, mode="revoked")
    db.commit()
    return {"mode": "revoked"}


class Change(BaseModel):
    feature: str
    value: float = Field(ge=-10, le=10000)


class CounterfactualBody(BaseModel):
    changes: list[Change] = Field(min_length=1, max_length=6)


@router.post("/assessments/{assessment_id}/counterfactual")
def counterfactual(assessment_id: int, body: CounterfactualBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Re-run the real scoring path with edited features. Hypothetical, admin-only, never persisted."""
    _, _, db = ctx
    a = db.get(models.RiskAssessment, assessment_id)
    if a is None:
        raise ApiError(404, "NOT_FOUND", "Assessment not found.")
    f = dict(a.features)
    for ch in body.changes:
        if ch.feature not in F.FEATURES:
            raise ApiError(422, "VALIDATION_ERROR", f"Unknown feature: {ch.feature[:40]}")
        f[ch.feature] = float(ch.value)
    _, idx, contribs, score, decision = engine.score_features(st.model, f)
    return {"hypothetical": True, "original": {"score": a.risk_score, "decision": a.decision},
            "result": {"score": round(score, 2), "decision": decision, "ml_index": round(idx, 2), "policy": contribs}}


@router.get("/users")
def users(ctx=Depends(ADMIN)):
    _, _, db = ctx
    out = []
    for u in db.scalars(select(models.User).order_by(models.User.id)).all():
        b = db.get(models.Baseline, u.id)
        out.append({"id": u.id, "username": u.username, "display_name": u.display_name, "persona": u.persona,
                    "home_city": u.home_city, "role": u.role, "baseline_version": b.version if b else 0})
    return out


def baseline_view(db, user_id: int) -> dict:
    b = db.get(models.Baseline, user_id)
    if b is None:
        raise ApiError(404, "NOT_FOUND", "No baseline for this user.")
    t = b.trusted
    versions = db.scalars(select(models.BaselineVersion).where(models.BaselineVersion.user_id == user_id)
                          .order_by(models.BaselineVersion.version)).all()
    import math
    return {"user_id": user_id, "version": b.version,
            "trusted": {"devices": t["devices"], "cities": t["cities"], "travel_windows": t.get("travel_windows", []),
                        "hour_profile": t["hour_profile"],
                        "amount_median_paise": int(math.exp(t["amount_log_median"])),
                        "amount_mad_paise": int(math.exp(t["amount_log_median"]) * (math.exp(t["amount_log_mad"]) - 1)),
                        "beneficiaries": t["beneficiaries"]},
            "candidate": b.candidate or [], "rejected_count": b.rejected_count,
            "versions": [{"version": v.version, "ts": v.ts, "reason": v.reason, "diff": v.diff, "rolled_back": v.rolled_back}
                         for v in versions]}


@router.get("/users/{user_id}/baseline")
def get_baseline(user_id: int, ctx=Depends(ADMIN)):
    return baseline_view(ctx[2], user_id)


@router.get("/evaluation")
def evaluation(ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    path = Path(__file__).resolve().parents[2] / "artifacts" / "eval_report.json"
    if not path.exists():
        raise ApiError(404, "NOT_FOUND", "Evaluation not run yet — run `make eval`.")
    return json.loads(path.read_text())


@router.get("/ghost/{session_id}")
def ghost_monitor(session_id: str, compare: bool = False, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Ghost Banking monitor for one contained session (admin only).

    Always: the incident, the triggering assessment, and the session's synthetic activity from the ghost database.
    Protected state is limited to integrity facts (protected writes by this session since containment) unless the
    analyst explicitly asks for the side-by-side comparison (`compare=true`), which is audited."""
    if st.GhostSessionLocal is None:  # the gate is off: no ghost database exists at all
        raise ApiError(404, "FEATURE_DISABLED", "Ghost Banking is disabled pending mentor approval.")
    _, admin, db = ctx
    s = db.get(models.Session, session_id)
    if s is None:
        raise ApiError(404, "NOT_FOUND", "Session not found.")
    from app.ghost import service as ghost
    with st.GhostSessionLocal() as gdb:
        g = ghost.monitor(gdb, s.id)
    if g is None:
        raise ApiError(404, "NOT_FOUND", "This session was never contained in Ghost Banking.")
    from app.services import incidents
    inc = next((i for i in db.scalars(select(models.SecurityIncident).where(models.SecurityIncident.user_id == s.user_id)
                                      .order_by(models.SecurityIncident.id.desc())).all() if s.id in (i.session_ids or [])), None)
    if inc is not None:
        incidents.refresh_verification(db, inc)
    entered = db.scalar(select(models.AuditEvent).where(models.AuditEvent.session_id == s.id,
                                                        models.AuditEvent.event_type == "ghost.entered")
                        .order_by(models.AuditEvent.id).limit(1))
    acct = db.scalar(select(models.Account).where(models.Account.user_id == s.user_id))
    since = entered.ts if entered else g["account"]["created_at"]
    writes = db.scalar(select(func.count()).select_from(models.Transaction).where(
        models.Transaction.session_id == s.id, models.Transaction.status == "completed",
        models.Transaction.created_at >= since)) or 0
    bens = db.scalar(select(func.count()).select_from(models.Beneficiary).where(
        models.Beneficiary.user_id == s.user_id, models.Beneficiary.created_at >= since)) or 0
    at_entry = (entered.details or {}).get("protected_balance_paise") if entered else None
    out = {"session": _row(db, s), "incident": incidents.summary_row(db, inc) if inc else None,
           "trigger_assessment": assessment_out(db.get(models.RiskAssessment, inc.assessment_id))
           if inc and inc.assessment_id else None,
           "ghost": {**g, "label": "SYNTHETIC · Ghost Banking"},
           "protected_status": {"completed_transfers_by_session_since_entry": writes,
                                "payees_added_since_entry": bens,
                                "balance_unchanged_since_entry": (acct.balance_paise == at_entry) if (acct and at_entry is not None) else None,
                                "entered_at": since},
           "comparison": None}
    if compare:
        recent = db.scalars(select(models.Transaction).where(models.Transaction.account_id == acct.id)
                            .order_by(models.Transaction.id.desc()).limit(8)).all() if acct else []
        out["comparison"] = {
            "protected": {"label": "PROTECTED · real ledger", "account_ref": acct.account_ref if acct else None,
                          "balance_paise": acct.balance_paise if acct else None, "balance_at_entry_paise": at_entry,
                          "transactions": [{"id": t.id, "created_at": t.created_at, "amount_paise": t.amount_paise,
                                            "direction": t.direction, "counterparty": t.counterparty, "status": t.status,
                                            "description": t.description} for t in recent]},
            "ghost": {"label": "SYNTHETIC · Ghost Banking", "account_ref": g["account"]["account_ref"],
                      "balance_paise": g["account"]["balance_paise"], "opening_balance_paise": g["account"]["opening_balance_paise"],
                      "transactions": g["transactions"][:8]}}
        audit.log(db, admin.username, "ghost.compare_viewed", s.user_id, s.id,
                  incident_id=inc.id if inc else None, role="admin")
        db.commit()
    return out


class RollbackBody(BaseModel):
    to_version: int = Field(ge=1)


@router.post("/users/{user_id}/baseline/rollback")
def rollback_baseline(user_id: int, body: RollbackBody, ctx=Depends(ADMIN)):
    from app.services import baseline
    _, admin, db = ctx
    try:
        baseline.rollback(db, user_id, body.to_version, actor=admin.username)
    except ValueError:
        raise ApiError(422, "VALIDATION_ERROR", "Invalid version for rollback.")
    db.commit()
    return baseline_view(db, user_id)


# ---------------------------------------------------------------- security incidents (analyst recovery)
from typing import Literal

from app.security import totp as totp_mod
from app.services import clock, incidents


class IncidentAction(BaseModel):
    action: Literal["unblock_session", "clear_user", "keep_restricted", "revoke_session", "request_verification"]
    reason: str = Field(min_length=8, max_length=300)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    session_id: str | None = Field(default=None, max_length=32)


def _incident(db, incident_id: int) -> models.SecurityIncident:
    inc = db.get(models.SecurityIncident, incident_id)
    if inc is None:
        raise ApiError(404, "NOT_FOUND", "Incident not found.")
    incidents.refresh_verification(db, inc)
    return inc


@router.get("/incidents/summary")
def incidents_summary(ctx=Depends(ADMIN)):
    """Polled by the analyst console for the notification bell (near-real-time, no page refresh)."""
    _, _, db = ctx
    open_n = db.scalar(select(func.count()).select_from(models.SecurityIncident)
                       .where(models.SecurityIncident.status.in_(incidents.OPEN)))
    unread = db.scalar(select(func.count()).select_from(models.SecurityIncident)
                       .where(models.SecurityIncident.analyst_read_at.is_(None)))
    latest = db.scalars(select(models.SecurityIncident).order_by(models.SecurityIncident.last_activity_at.desc())
                        .limit(6)).all()
    return {"open": open_n, "unread": unread, "latest": [incidents.summary_row(db, i) for i in latest]}


@router.get("/incidents")
def list_incidents(status: Literal["open", "resolved", "all"] = "open", limit: int = 100, ctx=Depends(ADMIN)):
    _, _, db = ctx
    q = select(models.SecurityIncident)
    if status == "open":
        q = q.where(models.SecurityIncident.status.in_(incidents.OPEN))
    elif status == "resolved":
        q = q.where(models.SecurityIncident.status.in_(incidents.CLOSED))
    rows = db.scalars(q.order_by(models.SecurityIncident.last_activity_at.desc()).limit(max(1, min(limit, 200)))).all()
    return [incidents.summary_row(db, i) for i in rows]


@router.get("/incidents/{incident_id}")
def incident_detail(incident_id: int, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    _, _, db = ctx
    inc = _incident(db, incident_id)
    trigger = db.get(models.RiskAssessment, inc.assessment_id) if inc.assessment_id else None
    latest = db.get(models.RiskAssessment, inc.last_assessment_id) if inc.last_assessment_id else None
    sessions_out = []
    for sid in inc.session_ids or []:
        s = db.get(models.Session, sid)
        if s is None:
            continue
        ok, why = incidents.session_eligibility(db, st, s)
        sessions_out.append({**_row(db, s), "expires_at": s.expires_at, "login_verified": incidents.login_verified(db, s),
                             "unblock_eligible": ok, "eligibility": why,
                             "assessments": [assessment_out(a) for a in db.scalars(
                                 select(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id)
                                 .order_by(models.RiskAssessment.id)).all()]})
    acct = db.scalar(select(models.Account).where(models.Account.user_id == inc.user_id))
    txns = db.scalars(select(models.Transaction).where(models.Transaction.account_id == acct.id)
                      .order_by(models.Transaction.id.desc()).limit(12)).all() if acct else []
    attempts = db.scalars(select(models.HistoryEvent).where(
        models.HistoryEvent.user_id == inc.user_id, models.HistoryEvent.session_ref.in_(inc.session_ids or []),
        models.HistoryEvent.event_type == "transfer").order_by(models.HistoryEvent.id)).all()
    recent_sessions = db.scalars(select(models.Session).where(models.Session.user_id == inc.user_id,
                                                              models.Session.mode != "pre_otp")
                                 .order_by(models.Session.created_at.desc()).limit(8)).all()
    timeline = db.scalars(select(models.AuditEvent).where(models.AuditEvent.user_id == inc.user_id,
                                                          func.json_extract(models.AuditEvent.details, "$.incident_id") == inc.id)
                          .order_by(models.AuditEvent.id)).all()
    return {"incident": incidents.summary_row(db, inc),
            "trigger_assessment": assessment_out(trigger) if trigger else None,
            "latest_assessment": assessment_out(latest) if latest else None,
            "sessions": sessions_out,
            "balance_paise": acct.balance_paise if acct else None,
            "transactions": [{"id": t.id, "created_at": t.created_at, "amount_paise": t.amount_paise,
                              "counterparty": t.counterparty, "status": t.status, "session_id": t.session_id,
                              "in_incident": t.session_id in (inc.session_ids or [])} for t in txns],
            "attempts": [{"ts": h.ts, "amount_paise": h.amount_paise, "outcome": h.outcome, "session_id": h.session_ref,
                          "assessment_id": h.assessment_id} for h in attempts],
            "recent_sessions": [_row(db, s) for s in recent_sessions],
            "timeline": [{"id": e.id, "ts": e.ts, "actor": e.actor, "event_type": e.event_type, "details": e.details}
                         for e in timeline]}


@router.post("/incidents/{incident_id}/read")
def incident_read(incident_id: int, ctx=Depends(ADMIN)):
    admin_s, admin, db = ctx
    inc = _incident(db, incident_id)
    if inc.analyst_read_at is None:
        inc.analyst_read_at = clock.now()
        audit.log(db, admin.username, "incident.reviewed", inc.user_id, inc.session_id, incident_id=inc.id,
                  status=inc.status)
        db.commit()
    return {"id": inc.id, "unread": False}


@router.post("/incidents/read-all")
def incidents_read_all(ctx=Depends(ADMIN)):
    _, admin, db = ctx
    rows = db.scalars(select(models.SecurityIncident).where(models.SecurityIncident.analyst_read_at.is_(None))).all()
    for inc in rows:
        inc.analyst_read_at = clock.now()
    audit.log(db, admin.username, "incident.read_all", None, None, count=len(rows))
    db.commit()
    return {"marked": len(rows)}


@router.post("/incidents/{incident_id}/actions")
def incident_action(incident_id: int, body: IncidentAction, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Analyst decision. Lifting a restriction (unblock_session, clear_user) needs a fresh analyst TOTP code,
    so a stolen analyst cookie alone cannot release a customer."""
    _, admin, db = ctx
    inc = _incident(db, incident_id)
    reason = " ".join(body.reason.split())
    if len(reason) < 8:
        raise ApiError(422, "VALIDATION_ERROR", "Give a reason of at least 8 characters.")
    if body.action in incidents.CLEARANCES:
        from app.services.reauth import require_fresh_totp
        require_fresh_totp(db, st, admin, body.totp_code, body.action, incident_id=inc.id)
    return incidents.act(db, st, inc, admin, body.action, reason, body.session_id)


# ---------------------------------------------------------------- Ghost Banking runtime control
class GhostConfigBody(BaseModel):
    enabled: bool
    reason: str = Field(min_length=8, max_length=300)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    expected_version: int = Field(ge=0)


@router.get("/ghost-config")
def ghost_config(ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.services import ghost_control
    return ghost_control.status(ctx[2], st)


@router.put("/ghost-config")
def set_ghost_config(body: GhostConfigBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Switch Ghost Banking on/off at runtime. Needs a reason and a fresh analyst TOTP code; refused outside the gate."""
    from app.services import ghost_control
    from app.services.reauth import require_fresh_totp
    _, admin, db = ctx
    reason = " ".join(body.reason.split())
    require_fresh_totp(db, st, admin, body.totp_code, "ghost_config")
    return ghost_control.set_runtime(db, st, admin, body.enabled, reason, body.expected_version)
