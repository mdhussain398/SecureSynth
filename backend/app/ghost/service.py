"""Ghost ledger operations. Every function takes a ghost-database session and plain ids; none of them can reach the
protected database. Balances and histories are generated, never copied: nothing here is derived from a real account."""
import secrets
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.errors import ApiError
from app.ghost.models import GhostAccount, GhostBeneficiary, GhostEvent, GhostTransaction
from app.services import clock

# Synthetic backdrop: plausible retail counterparties, none of them taken from any customer's real payees.
_PAYEES = ["Sunrise Rentals", "Metro Grocers", "City Power Board", "Kaveri Water Works", "Orbit Broadband",
           "Lakeside Pharmacy", "Greenleaf Tutors", "Harbor Insurance"]
_CREDITS = ["Salary credit", "Interest credit", "Refund"]


def _rng():
    return secrets.SystemRandom()


def _event(gdb, acct: GhostAccount, kind: str, **details) -> None:
    gdb.add(GhostEvent(ghost_account_id=acct.id, ts=clock.now(), kind=kind, details=details))


def account_for(gdb, session_id: str) -> GhostAccount | None:
    return gdb.scalar(select(GhostAccount).where(GhostAccount.session_id == session_id))


def ensure_account(gdb, session_id: str, user_id: int, reason: str = "") -> GhostAccount:
    """Create the session's synthetic account on first use (idempotent, race-safe on the unique session_id)."""
    acct = account_for(gdb, session_id)
    if acct is not None:
        return acct
    r = _rng()
    now = clock.now()
    opening = r.randrange(48_000, 3_60_000) * 100
    acct = GhostAccount(session_id=session_id, user_id=user_id, account_ref=f"SYN-{r.randrange(6000, 7999):04d}",
                        opening_balance_paise=opening, balance_paise=opening, reason=reason[:300], created_at=now)
    gdb.add(acct)
    try:
        gdb.flush()
    except IntegrityError:  # a concurrent request created it first
        gdb.rollback()
        return account_for(gdb, session_id)
    names = r.sample(_PAYEES, 3)
    for i, n in enumerate(names[:2]):
        gdb.add(GhostBeneficiary(ghost_account_id=acct.id, name=n, account_ref=f"SYN-{r.randrange(8100, 8999):04d}",
                                 trust="trusted", origin="seeded", created_at=now - timedelta(days=90 + 40 * i)))
    for d in range(28, 0, -4):  # four weeks of ordinary-looking history
        n = r.choice(names)
        gdb.add(GhostTransaction(ghost_account_id=acct.id, amount_paise=r.randrange(400, 9_000) * 100, direction="debit",
                                 counterparty=n, description=f"Payment to {n}", status="completed", origin="seeded",
                                 created_at=now - timedelta(days=d, hours=r.randrange(0, 10))))
    gdb.add(GhostTransaction(ghost_account_id=acct.id, amount_paise=r.randrange(35_000, 90_000) * 100, direction="credit",
                             counterparty=r.choice(_CREDITS), description="Monthly credit", status="completed",
                             origin="seeded", created_at=now - timedelta(days=26)))
    _event(gdb, acct, "entered", reason=reason[:200])
    gdb.commit()
    return acct


def _txn(t: GhostTransaction) -> dict:
    return {"id": t.id, "created_at": t.created_at, "amount_paise": t.amount_paise, "direction": t.direction,
            "counterparty": t.counterparty, "status": t.status, "description": t.description}


def _ben(b: GhostBeneficiary) -> dict:
    return {"id": b.id, "name": b.name, "account_ref": b.account_ref, "created_at": b.created_at, "trust": b.trust}


def _require(gdb, session_id: str) -> GhostAccount:
    acct = account_for(gdb, session_id)
    if acct is None:
        raise ApiError(404, "NOT_FOUND", "Not found.")
    return acct


def transactions(gdb, session_id: str, limit: int = 50, log: bool = True) -> list[dict]:
    acct = _require(gdb, session_id)
    rows = gdb.scalars(select(GhostTransaction).where(GhostTransaction.ghost_account_id == acct.id)
                       .order_by(GhostTransaction.created_at.desc(), GhostTransaction.id.desc()).limit(limit)).all()
    if log:
        _event(gdb, acct, "viewed_transactions")
        gdb.commit()
    return [_txn(t) for t in rows]


def overview(gdb, session_id: str) -> dict:
    acct = _require(gdb, session_id)
    _event(gdb, acct, "viewed_overview", balance_paise=acct.balance_paise)
    gdb.commit()
    return {"account": {"account_ref": acct.account_ref, "balance_paise": acct.balance_paise},
            "recent": transactions(gdb, session_id, 5, log=False)}


def beneficiaries(gdb, session_id: str) -> list[dict]:
    acct = _require(gdb, session_id)
    rows = gdb.scalars(select(GhostBeneficiary).where(GhostBeneficiary.ghost_account_id == acct.id)
                       .order_by(GhostBeneficiary.id)).all()
    return [_ben(b) for b in rows]


def add_beneficiary(gdb, session_id: str, name: str, account_ref: str) -> dict:
    acct = _require(gdb, session_id)
    b = GhostBeneficiary(ghost_account_id=acct.id, name=name, account_ref=account_ref, trust="candidate",
                         origin="session", created_at=clock.now())
    gdb.add(b)
    gdb.flush()
    _event(gdb, acct, "beneficiary_added", beneficiary_id=b.id, name=name, account_ref=account_ref)
    gdb.commit()
    return _ben(b)


def transfer(gdb, session_id: str, beneficiary_id: int, amount_paise: int, key: str, note: str | None) -> tuple[dict, bool]:
    """Simulated transfer on the ghost ledger only. Returns (transaction, replayed). Idempotent per key; the debit is a
    single conditional UPDATE so concurrent requests cannot overdraw the synthetic balance."""
    acct = _require(gdb, session_id)
    prior = gdb.scalar(select(GhostTransaction).where(GhostTransaction.ghost_account_id == acct.id,
                                                      GhostTransaction.idempotency_key == key))
    if prior is not None:
        return _txn(prior), True
    ben = gdb.scalar(select(GhostBeneficiary).where(GhostBeneficiary.ghost_account_id == acct.id,
                                                    GhostBeneficiary.id == beneficiary_id))
    if ben is None:  # also covers ids of protected payees or of another ghost session's payees
        _event(gdb, acct, "transfer_rejected", reason="unknown_payee", beneficiary_id=beneficiary_id, amount_paise=amount_paise)
        gdb.commit()
        raise ApiError(404, "NOT_FOUND", "Payee not found.")
    res = gdb.execute(update(GhostAccount).where(GhostAccount.id == acct.id, GhostAccount.balance_paise >= amount_paise)
                      .values(balance_paise=GhostAccount.balance_paise - amount_paise))
    if res.rowcount != 1:
        gdb.rollback()
        _event(gdb, acct, "transfer_rejected", reason="insufficient_funds", beneficiary_id=ben.id, amount_paise=amount_paise)
        gdb.commit()
        raise ApiError(422, "INSUFFICIENT_FUNDS", "Insufficient balance for this transfer.")
    t = GhostTransaction(ghost_account_id=acct.id, beneficiary_id=ben.id, amount_paise=amount_paise, direction="debit",
                         counterparty=ben.name, description=(note or f"Transfer to {ben.name}")[:120], status="completed",
                         origin="session", idempotency_key=key, created_at=clock.now())
    gdb.add(t)
    try:
        gdb.flush()
    except IntegrityError:  # the same key raced in: undo this debit, return the winner
        gdb.rollback()
        return _txn(gdb.scalar(select(GhostTransaction).where(GhostTransaction.ghost_account_id == acct.id,
                                                              GhostTransaction.idempotency_key == key))), True
    _event(gdb, acct, "transfer_simulated", transaction_id=t.id, beneficiary_id=ben.id, payee=ben.name,
           amount_paise=amount_paise)
    gdb.commit()
    return _txn(t), False


def monitor(gdb, session_id: str) -> dict | None:
    """Everything the analyst needs about one contained session (ghost data only)."""
    acct = account_for(gdb, session_id)
    if acct is None:
        return None
    txns = gdb.scalars(select(GhostTransaction).where(GhostTransaction.ghost_account_id == acct.id)
                       .order_by(GhostTransaction.created_at.desc(), GhostTransaction.id.desc())).all()
    bens = gdb.scalars(select(GhostBeneficiary).where(GhostBeneficiary.ghost_account_id == acct.id)
                       .order_by(GhostBeneficiary.id)).all()
    events = gdb.scalars(select(GhostEvent).where(GhostEvent.ghost_account_id == acct.id).order_by(GhostEvent.id)).all()
    simulated = [t for t in txns if t.origin == "session"]
    rejected = [e for e in events if e.kind == "transfer_rejected"]
    return {
        "account": {"account_ref": acct.account_ref, "balance_paise": acct.balance_paise,
                    "opening_balance_paise": acct.opening_balance_paise, "created_at": acct.created_at, "reason": acct.reason},
        "transactions": [{**_txn(t), "origin": t.origin} for t in txns],
        "beneficiaries": [{**_ben(b), "origin": b.origin} for b in bens],
        "events": [{"id": e.id, "ts": e.ts, "kind": e.kind, "details": e.details} for e in events],
        "totals": {"simulated_transfers": len(simulated),
                   "simulated_value_paise": sum(t.amount_paise for t in simulated),
                   "rejected_attempts": len(rejected),
                   "attempted_value_paise": sum(t.amount_paise for t in simulated)
                   + sum(int(e.details.get("amount_paise") or 0) for e in rejected),
                   "payees_added": sum(1 for b in bens if b.origin == "session")},
    }


def count_accounts(gdb) -> int:
    return gdb.scalar(select(func.count()).select_from(GhostAccount)) or 0
