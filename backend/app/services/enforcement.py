"""Backend enforcement of ALLOW / STEP_UP / BLOCK (quarantine = restricted/ghost session mode)."""
from app import models
from app.services import audit, challenges

MESSAGES = {
    "STEP_UP": "We noticed something different about this request. Approve it on your registered trusted device.",
    "BLOCK": "For your protection this session has been restricted. Please verify using your registered trusted device or contact the bank.",
}


def on_block(db, st, s: models.Session, assessment: models.RiskAssessment | None = None,
             transaction: models.Transaction | None = None) -> models.SecurityIncident:
    """Restrict the session and raise (or update) the analyst's security incident for this customer."""
    from app.services import incidents
    s.mode = "ghost" if st.settings.ghost_banking_enabled else "restricted"
    audit.log(db, "system", "session.restricted", s.user_id, s.id, mode=s.mode)
    return incidents.on_restriction(db, s, trigger="risk_block", assessment=assessment, transaction=transaction)


def on_step_up(db, st, s: models.Session, operation: str, payload: dict, summary: str,
               assessment_id: int) -> models.Challenge:
    s.mode = "step_up"
    s.context = {**(s.context or {}), "step_up_op": operation}  # login step-up = identity not yet verified
    c = challenges.create(db, st, s, operation, payload, summary, assessment_id)
    audit.log(db, "system", "challenge.created", s.user_id, s.id, challenge_id=c.id, operation=operation)
    return c
