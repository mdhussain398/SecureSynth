"""Audit log with an explicit allow-list of detail keys: secrets can never be logged by accident."""
from app import models
from app.services import clock

ALLOWED_KEYS = {
    "reason", "decision", "risk_score", "checkpoint", "mode", "city", "device_recognised",
    "amount_paise", "beneficiary_id", "transaction_id", "challenge_id", "operation", "status",
    "version", "to_version", "scenario", "count", "username", "ip", "role", "feature",
    "incident_id", "action", "previous_state", "resulting_state", "severity", "trigger", "session_ids",
    "previous_session_mode", "resulting_session_mode", "verification", "reviewed_attempts",
}


def log(db, actor: str, event_type: str, user_id=None, session_id=None, **details) -> None:
    safe = {k: v for k, v in details.items() if k in ALLOWED_KEYS}
    db.add(models.AuditEvent(ts=clock.now(), actor=actor, user_id=user_id, session_id=session_id,
                             event_type=event_type, details=safe))
