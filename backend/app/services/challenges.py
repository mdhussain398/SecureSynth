"""Trusted-device challenges (A2): separate credential, single-use, 120 s, bound to session+operation+payload."""
import hashlib
import json
import secrets
from datetime import timedelta

from app import models
from app.services import clock


def operation_hash(session_id: str, operation: str, payload: dict) -> str:
    canon = json.dumps({"s": session_id, "op": operation, "p": payload}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


def create(db, st, session: models.Session, operation: str, payload: dict, summary: str,
           assessment_id: int | None) -> models.Challenge:
    rng = secrets.SystemRandom()
    options = rng.sample(range(10, 100), 3)
    now = clock.now()
    c = models.Challenge(
        id=secrets.token_hex(6), session_id=session.id, user_id=session.user_id, assessment_id=assessment_id,
        operation=operation, operation_hash=operation_hash(session.id, operation, payload), payload=payload,
        context_summary=summary[:160], number_match=options[rng.randrange(3)], options=options,
        status="pending", created_at=now, expires_at=now + timedelta(seconds=st.settings.challenge_ttl_s))
    db.add(c)
    db.flush()
    return c


def _aware(dt):
    from datetime import timezone
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def device_user(db, device_key: str | None):
    """Authenticate the trusted device by its separately enrolled credential only (A2)."""
    from sqlalchemy import select

    from app.errors import ApiError
    from app.security import tokens

    if not device_key:
        raise ApiError(401, "DEVICE_UNAUTHENTICATED", "Trusted device credential required.")
    u = db.scalar(select(models.User).where(models.User.device_key_hash == tokens.hash_token(device_key)))
    if u is None:
        raise ApiError(401, "DEVICE_UNAUTHENTICATED", "Trusted device credential required.")
    return u


def pending_for(db, user) -> list[models.Challenge]:
    from sqlalchemy import select

    now = clock.now()
    rows = db.scalars(select(models.Challenge).where(models.Challenge.user_id == user.id,
                                                     models.Challenge.status == "pending")
                      .order_by(models.Challenge.created_at)).all()
    return [c for c in rows if _aware(c.expires_at) > now]


def respond(db, st, user, challenge_id: str, selected: int, approve: bool) -> str:
    """Single-use resolution. Approval executes exactly the bound operation payload; anything else is refused."""
    from app.errors import ApiError
    from app.services import audit, ledger

    c = db.get(models.Challenge, challenge_id)
    invalid = ApiError(400, "CHALLENGE_INVALID", "This request is no longer valid.")
    if c is None or c.user_id != user.id or c.status != "pending":
        raise invalid
    if clock.now() >= _aware(c.expires_at):
        c.status = "expired"
        db.commit()
        raise invalid
    s = db.get(models.Session, c.session_id)
    if s is None or s.mode != "step_up" or operation_hash(s.id, c.operation, c.payload) != c.operation_hash:
        c.status = "denied"
        db.commit()
        raise invalid
    if not approve or selected != c.number_match:
        c.status, s.mode = "denied", "restricted"
        if c.operation == "transfer":
            t = db.get(models.Transaction, c.payload.get("transaction_id"))
            if t is not None and t.status == "pending_verification":
                t.status = "restricted"
        audit.log(db, "trusted_device", "challenge.denied", user.id, s.id, challenge_id=c.id, operation=c.operation)
        db.commit()
        return "denied"
    c.status = "approved"
    if c.operation == "beneficiary_add":
        b = ledger.add_beneficiary(db, user.id, c.payload["name"], c.payload["account_ref"])
        audit.log(db, "trusted_device", "beneficiary.added", user.id, s.id, beneficiary_id=b.id)
    elif c.operation == "transfer":
        t = db.get(models.Transaction, c.payload["transaction_id"])
        if (t is None or t.status != "pending_verification" or t.amount_paise != c.payload["amount_paise"]
                or t.beneficiary_id != c.payload["beneficiary_id"]):
            c.status = "denied"
            db.commit()
            raise invalid
        ledger.debit(db, t.account_id, t.amount_paise)
        t.status = "completed"
        audit.log(db, "trusted_device", "transfer.completed", user.id, s.id, transaction_id=t.id,
                  amount_paise=t.amount_paise)
    _learn_verified(db, user, s, c)
    s.mode = "normal"
    s.context = {k: v for k, v in (s.context or {}).items() if k != "step_up_op"}
    audit.log(db, "trusted_device", "challenge.approved", user.id, s.id, challenge_id=c.id, operation=c.operation)
    db.commit()
    return "approved"


def _learn_verified(db, user, s, c) -> None:
    """A7: only the attribute this challenge was about becomes a verified candidate."""
    from app.services import baseline
    b = db.get(models.Baseline, user.id)
    if b is None:
        return
    if c.operation == "login":
        if s.device_id is not None:
            baseline.record_verified(db, user.id, "device", f"dev-{s.device_id}", c.id, s.id)
        if s.city and s.city not in b.trusted["cities"]:
            baseline.record_verified(db, user.id, "city", s.city, c.id, s.id)
