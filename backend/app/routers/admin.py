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
    return schemas.AppConfig(ghost_banking_enabled=st.settings.ghost_banking_enabled,
                             demo_mode=st.settings.demo_mode, model_version=engine.MODEL_VERSION)


@router.get("/sessions")
def list_sessions(decision: str | None = None, limit: int = 50, ctx=Depends(ADMIN)):
    _, _, db = ctx
    rows = db.scalars(select(models.Session).where(models.Session.mode != "pre_otp")
                      .order_by(models.Session.created_at.desc()).limit(max(1, min(limit, 200)))).all()
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
def ghost_compare(session_id: str, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    if not st.settings.ghost_banking_enabled:
        raise ApiError(404, "FEATURE_DISABLED", "Ghost Banking is disabled pending mentor approval.")
    raise ApiError(404, "NOT_FOUND", "Ghost module not implemented yet.")


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
