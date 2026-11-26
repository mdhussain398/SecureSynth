"""Runtime Ghost Banking control (analyst toggle) inside the deployment approval gate.

  gate      = Settings.ghost_banking_enabled (deployment config; false until mentor approval)
  approval  = Settings.ghost_banking_approval_ref (mentor approval reference); without it the feature may run only
              in local demo mode, and the UI says so
  runtime   = persisted RuntimeSetting 'ghost_banking' ('on'/'off'), default OFF, changed by analysts with a reason
              and a fresh TOTP code; every change is in config_changes and the audit log.
Effective containment = gate AND (approval OR demo mode) AND runtime on.

Disable policy: every live ghost session becomes `restricted` (never protected banking); incidents stay open and
all ghost data and evidence are kept."""
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app import models
from app.errors import ApiError
from app.services import audit, clock

KEY = "ghost_banking"
POLICY = ("BLOCK → contain the session in Ghost Banking (isolated synthetic ledger). Disabling restricts every live "
          "ghost session; no session ever moves from ghost to protected banking; evidence is preserved.")


def _row(db):
    return db.get(models.RuntimeSetting, KEY)


def gate_ok(st) -> tuple[bool, str]:
    s = st.settings
    if not s.ghost_banking_enabled or st.GhostSessionLocal is None:
        return False, "Disabled by deployment configuration (GHOST_BANKING_ENABLED=false) pending mentor approval."
    if s.ghost_banking_approval_ref:
        return True, f"Mentor approval recorded: {s.ghost_banking_approval_ref}"
    if s.demo_mode:
        return True, "Pending mentor approval: allowed in the local demo environment only."
    return False, "Pending mentor approval: not allowed outside demo mode."


def is_active(db, st) -> bool:
    ok, _ = gate_ok(st)
    r = _row(db)
    return ok and r is not None and r.value == "on"


def status(db, st) -> dict:
    ok, why = gate_ok(st)
    r = _row(db)
    last = db.scalar(select(models.ConfigChange).where(models.ConfigChange.key == KEY).order_by(models.ConfigChange.id.desc()).limit(1))
    history = db.scalars(select(models.ConfigChange).where(models.ConfigChange.key == KEY).order_by(models.ConfigChange.id.desc()).limit(10)).all()
    return {
        "runtime": r.value if r else "off", "effective": is_active(db, st), "version": r.version if r else 0,
        "gate_enabled": bool(st.settings.ghost_banking_enabled), "can_enable": ok, "approval_status": why,
        "approval_ref": st.settings.ghost_banking_approval_ref or None, "demo_mode": st.settings.demo_mode,
        "last_change": {"by": last.actor, "at": last.ts, "reason": last.reason, "from": last.old_value, "to": last.new_value,
                        "effect": last.effect} if last else None,
        "active_ghost_sessions": db.scalar(select(func.count()).select_from(models.Session).where(models.Session.mode == "ghost")) or 0,
        "total_contained_sessions": db.scalar(select(func.count()).select_from(models.SecurityIncident).where(models.SecurityIncident.ghost.is_(True))) or 0,
        "policy": POLICY,
        "history": [{"at": h.ts, "by": h.actor, "from": h.old_value, "to": h.new_value, "reason": h.reason, "effect": h.effect} for h in history],
    }


def set_runtime(db, st, actor: models.User, enabled: bool, reason: str, expected_version: int) -> dict:
    new = "on" if enabled else "off"
    if enabled:
        ok, why = gate_ok(st)
        if not ok:
            raise ApiError(403, "FEATURE_DISABLED", why)
    r = _row(db)
    old = r.value if r else "off"
    current_version = r.version if r else 0
    if expected_version != current_version:
        raise ApiError(409, "CONFIG_CONFLICT", "The setting changed since you loaded it. Reload and try again.")
    if old == new:
        return {"changed": False, **status(db, st)}
    now = clock.now()
    if r is None:
        db.add(models.RuntimeSetting(key=KEY, value=new, version=1, updated_by=actor.username, updated_at=now, reason=reason))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise ApiError(409, "CONFIG_CONFLICT", "The setting changed since you loaded it. Reload and try again.")
    else:
        res = db.execute(update(models.RuntimeSetting).where(models.RuntimeSetting.key == KEY,
                                                             models.RuntimeSetting.version == current_version)
                         .values(value=new, version=current_version + 1, updated_by=actor.username, updated_at=now, reason=reason))
        if res.rowcount != 1:
            db.rollback()
            raise ApiError(409, "CONFIG_CONFLICT", "The setting changed since you loaded it. Reload and try again.")
    effect: dict = {}
    if not enabled:  # safe disable: contain → restrict, never → protected
        moved = db.scalars(select(models.Session).where(models.Session.mode == "ghost")).all()
        for s in moved:
            s.mode = "restricted"
            s.context = {**(s.context or {}), "ghost_disabled": True}
            audit.log(db, actor.username, "ghost.session_restricted_on_disable", s.user_id, s.id, mode="restricted")
        effect["sessions_restricted"] = len(moved)
    db.add(models.ConfigChange(key=KEY, old_value=old, new_value=new, actor=actor.username, reason=reason, effect=effect, ts=now))
    audit.log(db, actor.username, "config.ghost_banking", None, None, previous_state=old, resulting_state=new, reason=reason,
              count=effect.get("sessions_restricted"), role="admin")
    db.commit()
    return {"changed": True, **status(db, st)}
