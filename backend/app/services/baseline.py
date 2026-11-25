"""Poison-resistant baseline adaptation (spec §10 + A7).

Scoring reads only `Baseline.trusted`. New behaviour lands in `Baseline.candidate` and is promoted only when:
  * it was the attribute bound to an approved trusted-device challenge (verified_by), AND
  * it has >= MIN_CLEAN_SESSIONS distinct clean sessions, AND
  * >= MIN_AGE_H hours have passed since it was first verified.
Verified travel becomes a time-boxed window, never a permanent city. Blocked sessions void contributions.
Every change writes a BaselineVersion snapshot so it can be rolled back exactly.
"""
import copy
from datetime import timedelta

from sqlalchemy.orm.attributes import flag_modified

from app import models
from app.services import audit, clock

MIN_CLEAN_SESSIONS = 2
MIN_AGE_H = 24
TRAVEL_WINDOW_DAYS = 7
LIST_FOR = {"device": "devices", "beneficiary": "beneficiaries"}


def _aware(dt):
    from datetime import timezone
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _get(db, user_id) -> models.Baseline:
    b = db.get(models.Baseline, user_id)
    if b is None:
        raise ValueError("no baseline")
    b.candidate = list(b.candidate or [])
    return b


def _save(db, b: models.Baseline, new_trusted: dict, diff: dict, reason: str, actor="system") -> None:
    b.version += 1
    b.trusted = new_trusted
    b.updated_at = clock.now()
    flag_modified(b, "trusted")
    db.add(models.BaselineVersion(user_id=b.user_id, version=b.version, snapshot=copy.deepcopy(new_trusted),
                                  diff=diff, reason=reason[:120], ts=clock.now()))
    audit.log(db, actor, "baseline.updated", b.user_id, None, version=b.version, reason=reason[:60])


def _item(b, kind, value):
    return next((c for c in b.candidate if c["kind"] == kind and c["value"] == value), None)


def record_verified(db, user_id: int, kind: str, value: str, challenge_id: str, session_id: str) -> None:
    """Called on an APPROVED trusted-device challenge, for the single attribute that challenge was about."""
    b = _get(db, user_id)
    now = clock.now()
    if kind == "city":
        if value in b.trusted["cities"]:
            return
        t = copy.deepcopy(b.trusted)
        t["travel_windows"] = [w for w in t.get("travel_windows", []) if w["city"] != value] + [
            {"city": value, "until": (now + timedelta(days=TRAVEL_WINDOW_DAYS)).isoformat()}]
        _save(db, b, t, {"travel_window": value}, f"Verified travel to {value} ({TRAVEL_WINDOW_DAYS}-day window)")
        b.candidate.append({"kind": "city", "value": value, "verified_by": challenge_id, "clean_sessions": 0,
                            "sessions": [], "first_seen": now.isoformat(), "status": "travel_window",
                            "reason": "Verified on trusted device; time-boxed, not permanent"})
    else:
        if value in b.trusted.get(LIST_FOR[kind], []):
            return
        item = _item(b, kind, value)
        if item is None:
            item = {"kind": kind, "value": value, "sessions": [], "clean_sessions": 0, "first_seen": now.isoformat()}
            b.candidate.append(item)
        item.update(verified_by=challenge_id, verified_at=now.isoformat(), status="pending",
                    reason=f"Verified; needs {MIN_CLEAN_SESSIONS} clean sessions and {MIN_AGE_H} h")
    flag_modified(b, "candidate")
    db.flush()


def observe_session(db, user_id: int, session_id: str, *, device_ref: str, city: str, clean: bool) -> list[str]:
    """Called after each assessment. Only clean (ALLOW-only) sessions count; unverified novelty is never learned."""
    b = _get(db, user_id)
    promoted = []
    if device_ref not in b.trusted["devices"]:
        item = _item(b, "device", device_ref)
        if item is None or not item.get("verified_by"):
            if item is None:
                item = {"kind": "device", "value": device_ref, "verified_by": None, "sessions": [],
                        "clean_sessions": 0, "first_seen": clock.now().isoformat(), "status": "pending",
                        "reason": "Not verified on trusted device — will not be learned"}
                b.candidate.append(item)
            refused = item.setdefault("refused_sessions", [])
            if session_id not in refused:  # count each refused session once, not each checkpoint
                refused.append(session_id)
                b.rejected_count = (b.rejected_count or 0) + 1
        elif item["status"] == "pending" and clean and session_id not in item["sessions"]:
            item["sessions"].append(session_id)
            item["clean_sessions"] = len(item["sessions"])
            age_h = (clock.now() - _aware_iso(item["verified_at"])).total_seconds() / 3600
            if item["clean_sessions"] >= MIN_CLEAN_SESSIONS and age_h >= MIN_AGE_H:
                t = copy.deepcopy(b.trusted)
                t["devices"] = sorted(set(t["devices"]) | {device_ref})
                _save(db, b, t, {"device_added": device_ref}, "Verified device promoted after clean use")
                item["status"], item["reason"] = "promoted", f"Promoted in version {b.version}"
                promoted.append(device_ref)
    flag_modified(b, "candidate")
    db.flush()
    return promoted


def reject_session(db, user_id: int, session_id: str, device_ref: str | None = None) -> None:
    """A session hit BLOCK: void candidates it touched; auto-rollback if it used a recently promoted device."""
    b = _get(db, user_id)
    for item in b.candidate:
        if session_id in item.get("sessions", []) or (device_ref and item["value"] == device_ref and item["status"] == "pending"):
            item["status"], item["reason"] = "rejected", "Involved in a blocked session"
        elif device_ref and item["value"] == device_ref and item["status"] == "promoted":
            item["status"], item["reason"] = "rejected", "Promoted device later involved in a blocked session"
            t = copy.deepcopy(b.trusted)
            t["devices"] = [d for d in t["devices"] if d != device_ref]
            _save(db, b, t, {"device_removed": device_ref}, "Auto-rollback: promoted device involved in BLOCK")
    flag_modified(b, "candidate")
    db.flush()


def rollback(db, user_id: int, to_version: int, actor: str) -> None:
    b = _get(db, user_id)
    snap = db.query(models.BaselineVersion).filter_by(user_id=user_id, version=to_version).one_or_none()
    if snap is None or to_version >= b.version:
        raise ValueError("invalid version")
    for v in db.query(models.BaselineVersion).filter(models.BaselineVersion.user_id == user_id,
                                                     models.BaselineVersion.version > to_version).all():
        v.rolled_back = True
    _save(db, b, copy.deepcopy(snap.snapshot), {"rollback_to": to_version}, f"Rolled back to version {to_version}", actor)
    db.flush()


def _aware_iso(s: str):
    from datetime import datetime
    return _aware(datetime.fromisoformat(s))
