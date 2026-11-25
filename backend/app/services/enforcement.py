"""Backend enforcement of ALLOW / STEP_UP / BLOCK (quarantine = restricted/ghost session mode)."""
from app import models
from app.services import audit, challenges

MESSAGES = {
    "STEP_UP": "We noticed something different about this request. Approve it on your registered trusted device.",
    "BLOCK": "For your protection this session has been restricted. Please verify using your registered trusted device or contact the bank.",
}


def on_block(db, st, s: models.Session) -> None:
    s.mode = "ghost" if st.settings.ghost_banking_enabled else "restricted"
    audit.log(db, "system", "session.restricted", s.user_id, s.id, mode=s.mode)


def on_step_up(db, st, s: models.Session, operation: str, payload: dict, summary: str,
               assessment_id: int) -> models.Challenge:
    s.mode = "step_up"
    c = challenges.create(db, st, s, operation, payload, summary, assessment_id)
    audit.log(db, "system", "challenge.created", s.user_id, s.id, challenge_id=c.id, operation=operation)
    return c
