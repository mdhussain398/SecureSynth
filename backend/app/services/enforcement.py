"""Backend enforcement of ALLOW / STEP_UP / BLOCK (quarantine = restricted/ghost session mode)."""
from app import models
from app.services import audit, challenges

MESSAGES = {
    "STEP_UP": "We noticed something different about this request. Approve it on your registered trusted device.",
    "BLOCK": "For your protection this session has been restricted. Please verify using your registered trusted device or contact the bank.",
}


def on_block(db, st, s: models.Session, assessment: models.RiskAssessment | None = None,
             transaction: models.Transaction | None = None) -> models.SecurityIncident:
    """Contain the session and raise (or update) the analyst's security incident for this customer.

    Ghost Banking off (default): the session becomes `restricted`.
    Ghost Banking on: the session becomes `ghost`; from now on every banking route serves the isolated ghost ledger.
    The protected balance at entry is written to the protected audit log as evidence (never to the ghost database)."""
    from app.services import ghost_control, incidents
    ghost = ghost_control.is_active(db, st)
    s.mode = "ghost" if ghost else "restricted"
    audit.log(db, "system", "session.restricted", s.user_id, s.id, mode=s.mode)
    inc = incidents.on_restriction(db, s, trigger="risk_block", assessment=assessment, transaction=transaction, ghost=ghost)
    db.flush()
    from app.evidence import collect
    collect.on_restriction(st, db, db.get(models.SecurityIncident, inc.id), s, assessment, transaction)
    if ghost:
        from sqlalchemy import select
        from app.ghost import service as ghost_service
        acct = db.scalar(select(models.Account).where(models.Account.user_id == s.user_id))
        with st.GhostSessionLocal() as gdb:
            g = ghost_service.ensure_account(gdb, s.id, s.user_id, reason=inc.reason)
            ref = g.account_ref
        audit.log(db, "system", "ghost.entered", s.user_id, s.id, incident_id=inc.id, ghost_account_ref=ref,
                  protected_balance_paise=acct.balance_paise if acct else None,
                  risk_score=assessment.risk_score if assessment is not None else None)
    return inc


def on_step_up(db, st, s: models.Session, operation: str, payload: dict, summary: str,
               assessment_id: int) -> models.Challenge:
    s.mode = "step_up"
    s.context = {**(s.context or {}), "step_up_op": operation}  # login step-up = identity not yet verified
    c = challenges.create(db, st, s, operation, payload, summary, assessment_id)
    audit.log(db, "system", "challenge.created", s.user_id, s.id, challenge_id=c.id, operation=operation)
    return c
