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
from app.state import AppState, _sqlite_engine, get_state

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
        result = scenarios.run(request.app, st, db, scenario_id, body.params)
    except (ValueError, KeyError, FileNotFoundError) as e:
        raise ApiError(422, "VALIDATION_ERROR", f"Scenario could not run: {type(e).__name__}")
    audit.log(db, admin.username, "lab.scenario_run", None, result["session_id"], scenario=scenario_id)
    db.commit()
    return result


def _path(url: str) -> Path:
    return Path(url.removeprefix("sqlite:///")).resolve()


@router.post("/reset")
def reset(ctx=Depends(lab_guard), st: AppState = Depends(get_state)):
    _, _, db = ctx
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
    st.SessionLocal = sessionmaker(bind=st.engine, expire_on_commit=False)
    clock.reset()
    st.login_limiter.reset()
    st.totp_limiter.reset()
    return {"ok": True, "seed_hash": hashlib.sha256(snap.read_bytes()).hexdigest()[:16], "now": clock.now()}


@router.get("/clock")
def get_clock(ctx=Depends(lab_guard)):
    return {"now": clock.now()}


@router.post("/clock")
def advance_clock(body: ClockBody, ctx=Depends(lab_guard)):
    if not 0 < body.advance_hours <= 24 * 30:
        raise ApiError(422, "VALIDATION_ERROR", "advance_hours must be between 0 and 720.")
    return {"now": clock.advance(hours=body.advance_hours)}
