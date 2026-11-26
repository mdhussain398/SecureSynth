"""Scenario Lab router — mounted ONLY when DEMO_MODE=true (A4). Admin + loopback + Origin + CSRF enforced."""
import hashlib
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import sessionmaker

from app.errors import ApiError
from app.lab import scenarios
from app.services import audit, clock
from app.services.sessions import LOOPBACK, require
from app.state import AppState, _sqlite_engine, ensure_schema, get_state

router = APIRouter(prefix="/lab", tags=["scenario lab (demo only)"])
_ADMIN = require("normal", roles=("admin",))


def lab_guard(request: Request, ctx=Depends(_ADMIN)):
    if (request.client.host if request.client else "") not in LOOPBACK:
        raise ApiError(403, "FORBIDDEN", "Scenario Lab is available on this machine only.")
    return ctx


class RunBody(BaseModel):
    params: dict[str, str | int | float] = {}


class ClockBody(BaseModel):
    advance_hours: float


@router.get("/scenarios")
def list_scenarios(ctx=Depends(lab_guard)):
    return scenarios.catalogue()


@router.post("/scenarios/{scenario_id}/run")
def run_scenario(scenario_id: str, body: RunBody, request: Request, ctx=Depends(lab_guard),
                 st: AppState = Depends(get_state)):
    _, admin, db = ctx
    if scenario_id not in scenarios.SCENARIOS:
        raise ApiError(404, "NOT_FOUND", "Unknown scenario.")
    try:
        result = scenarios.run(request.app, st, db, scenario_id, body.params, analyst=admin)
    except (ValueError, KeyError, FileNotFoundError) as e:
        raise ApiError(422, "VALIDATION_ERROR", f"Scenario could not run: {type(e).__name__}")
    audit.log(db, admin.username, "lab.scenario_run", None, result["session_id"], scenario=scenario_id)
    db.commit()
    return result


def _path(url: str) -> Path:
    return Path(url.removeprefix("sqlite:///")).resolve()


@router.post("/reset")
def reset(ctx=Depends(lab_guard), st: AppState = Depends(get_state)):
    """Restore the pristine snapshot. Every session is invalidated except the presenter's own admin session,
    so a live demo does not need a fresh sign-in and device approval after each reset."""
    from app import models
    presenter, _, db = ctx
    keep = {c.name: getattr(presenter, c.name) for c in models.Session.__table__.columns}
    keep["device_id"] = None  # the browser-device row does not exist in the snapshot
    # Preserve what must outlive a demo reset: runtime configuration (and its history), and genuine (non-Lab) Ghost
    # Banking activity, which is copied into the evidence vault before the ghost ledger is emptied.
    from sqlalchemy import select as _select
    keep_cfg = [{c.name: getattr(r, c.name) for c in models.RuntimeSetting.__table__.columns}
                for r in db.scalars(_select(models.RuntimeSetting)).all()]
    keep_hist = [{c.name: getattr(r, c.name) for c in models.ConfigChange.__table__.columns}
                 for r in db.scalars(_select(models.ConfigChange)).all()]
    from app.evidence import collect
    for inc in db.scalars(_select(models.SecurityIncident).where(models.SecurityIncident.ghost.is_(True),
                                                                models.SecurityIncident.is_lab.is_(False))).all():
        for sid in inc.session_ids or []:
            collect.ghost_snapshot(st, inc, sid, "lab-reset (genuine evidence preserved)")
    db.close()
    snap = Path(st.settings.seed_snapshot).resolve()
    if not snap.exists():
        raise ApiError(404, "NOT_FOUND", "Seed snapshot missing — run `make seed`.")
    target = _path(st.settings.database_url)
    st.engine.dispose()
    for suffix in ("-wal", "-shm"):
        Path(f"{target}{suffix}").unlink(missing_ok=True)
    shutil.copyfile(snap, target)
    st.engine = _sqlite_engine(st.settings.database_url)
    ensure_schema(st.engine)  # the snapshot predates incidents: this recreates an empty incident table
    st.SessionLocal = sessionmaker(bind=st.engine, expire_on_commit=False)
    with st.SessionLocal() as fresh:
        fresh.add(models.Session(**keep))
        for r in keep_cfg:  # merge: the snapshot may already contain a row
            fresh.merge(models.RuntimeSetting(**r))
        for r in keep_hist:
            fresh.merge(models.ConfigChange(**r))
        audit.log(fresh, "lab", "lab.reset", keep["user_id"], keep["id"])
        fresh.commit()
    if st.ghost_engine is not None:  # Ghost Banking keeps its own database: reset it to empty as well
        from app.state import build_ghost
        st.ghost_engine.dispose()
        gpath = _path(st.settings.ghost_database_url)
        for suffix in ("", "-wal", "-shm"):
            Path(f"{gpath}{suffix}").unlink(missing_ok=True)
        build_ghost(st)
    purged = _purge_lab_investigation(st)
    clock.reset()
    st.login_limiter.reset()
    st.totp_limiter.reset()
    return {"ok": True, "seed_hash": hashlib.sha256(snap.read_bytes()).hexdigest()[:16], "now": clock.now(), "purged_lab": purged}


def _purge_lab_investigation(st) -> dict:
    """Remove ONLY Scenario Lab investigation data: lab evidence (and files), the lab ledger chain, lab photo requests,
    summaries, reports, confirmations, alerts and demo complaints. The genuine chain and genuine evidence are untouched."""
    from sqlalchemy import delete, select as _select

    from app.dummy_ccr.service import DemoComplaint
    from app.evidence import vault
    from app.evidence.models import (CyberReport, EvidenceItem, IntegrityAlert, LedgerEntry, PhotoRequest, ReportConfirmation,
                                     SummaryVersion)
    counts = {}
    with st.EvidenceSessionLocal() as edb:
        for it in edb.scalars(_select(EvidenceItem).where(EvidenceItem.is_lab.is_(True))).all():
            if it.blob_path and vault._SAFE.match(it.blob_path):
                (Path(st.evidence_store_dir) / it.blob_path).unlink(missing_ok=True)
        lab_reports = [r for (r,) in edb.execute(_select(CyberReport.id).where(CyberReport.is_lab.is_(True))).all()]
        counts["confirmations"] = edb.execute(delete(ReportConfirmation).where(ReportConfirmation.report_id.in_(lab_reports))).rowcount
        for model, cond in ((EvidenceItem, EvidenceItem.is_lab.is_(True)), (LedgerEntry, LedgerEntry.chain == "lab"),
                            (PhotoRequest, PhotoRequest.is_lab.is_(True)), (SummaryVersion, SummaryVersion.is_lab.is_(True)),
                            (CyberReport, CyberReport.is_lab.is_(True)), (IntegrityAlert, IntegrityAlert.is_lab.is_(True))):
            counts[model.__tablename__] = edb.execute(delete(model).where(cond)).rowcount
        edb.commit()
    with st.CCRSessionLocal() as cdb:
        counts["demo_complaints"] = cdb.execute(delete(DemoComplaint).where(DemoComplaint.is_lab.is_(True))).rowcount
        cdb.commit()
    return counts


@router.get("/clock")
def get_clock(ctx=Depends(lab_guard)):
    return {"now": clock.now()}


@router.post("/clock")
def advance_clock(body: ClockBody, ctx=Depends(lab_guard), st: AppState = Depends(get_state)):
    if not 0 < body.advance_hours <= 24 * 30:
        raise ApiError(422, "VALIDATION_ERROR", "advance_hours must be between 0 and 720.")
    presenter, _, db = ctx
    now = clock.advance(hours=body.advance_hours)
    from datetime import timedelta
    presenter.last_seen = now  # the presenter's own session travels with the simulated clock
    presenter.expires_at = now + timedelta(minutes=st.settings.session_abs_min)
    db.commit()
    return {"now": now}
