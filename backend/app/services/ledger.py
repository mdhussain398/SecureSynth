"""Atomic ledger operations. Balance debit is a single conditional UPDATE (no read-modify-write race)."""
from sqlalchemy import select, update

from app import models
from app.errors import ApiError
from app.services import clock


def find_by_idempotency(db, account_id: int, key: str):
    return db.scalar(select(models.Transaction).where(models.Transaction.account_id == account_id,
                                                      models.Transaction.idempotency_key == key))


def add_beneficiary(db, user_id: int, name: str, account_ref: str) -> models.Beneficiary:
    b = models.Beneficiary(user_id=user_id, name=name, account_ref=account_ref, created_at=clock.now(),
                           trust="candidate")
    db.add(b)
    db.flush()
    return b


def record(db, account_id, ben, amount_paise, status, session_id, assessment_id, key, note=None):
    t = models.Transaction(account_id=account_id, beneficiary_id=ben.id, amount_paise=amount_paise,
                           direction="debit", counterparty=ben.name, description=(note or f"Transfer to {ben.name}"),
                           status=status, session_id=session_id, assessment_id=assessment_id,
                           idempotency_key=key, created_at=clock.now())
    db.add(t)
    db.flush()
    return t


def debit(db, account_id: int, amount_paise: int) -> None:
    res = db.execute(update(models.Account)
                     .where(models.Account.id == account_id, models.Account.balance_paise >= amount_paise)
                     .values(balance_paise=models.Account.balance_paise - amount_paise))
    if res.rowcount != 1:  # nothing was changed; leave the caller's transaction intact
        raise ApiError(422, "INSUFFICIENT_FUNDS", "Insufficient balance for this transfer.")


def transfer(db, account_id, ben, amount_paise, session_id, assessment_id, key, note=None) -> models.Transaction:
    debit(db, account_id, amount_paise)
    return record(db, account_id, ben, amount_paise, "completed", session_id, assessment_id, key, note)
