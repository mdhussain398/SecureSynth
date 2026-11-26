from fastapi import APIRouter, Depends, Response
from sqlalchemy import select

from app import models, schemas
from app.errors import ApiError
from app.risk import engine
from app.routers.auth import challenge_ref, session_info
from app.services import audit, enforcement, ledger
from app.services.sessions import require, require_verified_reader
from app.state import AppState, get_state

router = APIRouter(prefix="/bank", tags=["bank"])
READ = require_verified_reader()
WRITE = require("normal", "ghost")


def _ghost(st: AppState, s) -> bool:
    """Backend enforcement of Ghost Banking: a ghost session is served ONLY from the isolated ghost ledger, on every
    route. If the feature has since been disabled, the session is refused rather than shown protected data."""
    if s.mode != "ghost":
        return False
    if st.GhostSessionLocal is None:
        raise ApiError(403, "SESSION_RESTRICTED", "This session is restricted for your protection.")
    return True


def _gdb(st: AppState):
    return st.GhostSessionLocal()


def _audit_ghost(db, s, event: str, **details) -> None:
    audit.log(db, "ghost_session", event, s.user_id, s.id, **details)
    db.commit()


def txn_out(t: models.Transaction) -> schemas.Transaction:
    return schemas.Transaction(id=t.id, created_at=t.created_at, amount_paise=t.amount_paise, direction=t.direction,
                               counterparty=t.counterparty, status=t.status, description=t.description)


def ben_out(b: models.Beneficiary) -> schemas.Beneficiary:
    return schemas.Beneficiary(id=b.id, name=b.name, account_ref=b.account_ref, created_at=b.created_at, trust=b.trust)


def _account(db, user_id) -> models.Account:
    return db.scalar(select(models.Account).where(models.Account.user_id == user_id))


@router.get("/overview", response_model=schemas.OverviewResponse)
def overview(ctx=Depends(READ), st: AppState = Depends(get_state)):
    s, user, db = ctx
    if _ghost(st, s):
        with _gdb(st) as gdb:
            from app.ghost import service as ghost
            o = ghost.overview(gdb, s.id)
        return schemas.OverviewResponse(account=schemas.AccountSummary(**o["account"]),
                                        recent=[schemas.Transaction(**t) for t in o["recent"]], session=session_info(s, user))
    acct = _account(db, user.id)
    recent = db.scalars(select(models.Transaction).where(models.Transaction.account_id == acct.id)
                        .order_by(models.Transaction.id.desc()).limit(5)).all()
    return schemas.OverviewResponse(
        account=schemas.AccountSummary(account_ref=acct.account_ref, balance_paise=acct.balance_paise),
        recent=[txn_out(t) for t in recent], session=session_info(s, user))


@router.get("/transactions", response_model=list[schemas.Transaction])
def transactions(limit: int = 50, ctx=Depends(READ), st: AppState = Depends(get_state)):
    s, user, db = ctx
    if _ghost(st, s):
        with _gdb(st) as gdb:
            from app.ghost import service as ghost
            return [schemas.Transaction(**t) for t in ghost.transactions(gdb, s.id, max(1, min(limit, 200)))]
    acct = _account(db, user.id)
    rows = db.scalars(select(models.Transaction).where(models.Transaction.account_id == acct.id)
                      .order_by(models.Transaction.id.desc()).limit(max(1, min(limit, 200)))).all()
    return [txn_out(t) for t in rows]


@router.get("/beneficiaries", response_model=list[schemas.Beneficiary])
def beneficiaries(ctx=Depends(READ), st: AppState = Depends(get_state)):
    s, user, db = ctx
    if _ghost(st, s):
        with _gdb(st) as gdb:
            from app.ghost import service as ghost
            return [schemas.Beneficiary(**b) for b in ghost.beneficiaries(gdb, s.id)]
    rows = db.scalars(select(models.Beneficiary).where(models.Beneficiary.user_id == user.id,
                                                       models.Beneficiary.trust != "blocked")).all()
    return [ben_out(b) for b in rows]


@router.post("/beneficiaries", response_model=schemas.SensitiveActionResponse, status_code=201)
def add_beneficiary(body: schemas.AddBeneficiaryRequest, response: Response, ctx=Depends(WRITE),
                    st: AppState = Depends(get_state)):
    s, user, db = ctx
    if _ghost(st, s):  # simulated on the ghost ledger; never risk-assessed, so the baseline cannot be poisoned
        with _gdb(st) as gdb:
            from app.ghost import service as ghost
            b = ghost.add_beneficiary(gdb, s.id, body.name, body.account_ref)
        _audit_ghost(db, s, "ghost.beneficiary_added", beneficiary_id=b["id"])
        return schemas.SensitiveActionResponse(result="completed", decision="ALLOW", customer_message="Payee added.",
                                               beneficiary=schemas.Beneficiary(**b))
    payload = {"name": body.name, "account_ref": body.account_ref}
    a = engine.assess(db, st, s, user, "beneficiary_add", payload)
    if a.decision == "BLOCK":
        enforcement.on_block(db, st, s, a)
        audit.log(db, "system", "beneficiary.restricted", user.id, s.id, decision="BLOCK")
        db.commit()
        raise ApiError(403, "RISK_BLOCKED", a.customer_message)
    if a.decision == "STEP_UP":
        c = enforcement.on_step_up(db, st, s, "beneficiary_add", payload,
                                   f"Add payee {body.name} · {s.city} (simulated)", a.id)
        db.commit()
        response.status_code = 202
        return schemas.SensitiveActionResponse(result="pending_verification", decision="STEP_UP",
                                               customer_message=a.customer_message,
                                               challenge=challenge_ref(c))
    b = ledger.add_beneficiary(db, user.id, body.name, body.account_ref)
    audit.log(db, user.username, "beneficiary.added", user.id, s.id, beneficiary_id=b.id, decision="ALLOW")
    db.commit()
    return schemas.SensitiveActionResponse(result="completed", decision="ALLOW", customer_message="Payee added.",
                                           beneficiary=ben_out(b))


@router.post("/transfers", response_model=schemas.SensitiveActionResponse, status_code=201)
def transfer(body: schemas.TransferRequest, response: Response, ctx=Depends(WRITE),
             st: AppState = Depends(get_state)):
    s, user, db = ctx
    if _ghost(st, s):  # simulated on the ghost ledger only: no protected read, debit, record or history event
        with _gdb(st) as gdb:
            from app.ghost import service as ghost
            t, replayed = ghost.transfer(gdb, s.id, body.beneficiary_id, body.amount_paise, body.idempotency_key, body.note)
        if not replayed:
            _audit_ghost(db, s, "ghost.transfer_simulated", transaction_id=t["id"], amount_paise=t["amount_paise"])
        return schemas.SensitiveActionResponse(result="completed", decision="ALLOW",
                                               customer_message="Already processed." if replayed else "Transfer complete.",
                                               transaction=schemas.Transaction(**t))
    acct = _account(db, user.id)
    existing = ledger.find_by_idempotency(db, acct.id, body.idempotency_key)
    if existing is not None:
        if existing.status == "restricted":
            raise ApiError(403, "RISK_BLOCKED", "This transfer was stopped for your protection.")
        response.status_code = 201 if existing.status == "completed" else 202
        return schemas.SensitiveActionResponse(result="completed" if existing.status == "completed" else
                                               "pending_verification", decision="ALLOW",
                                               customer_message="Already processed.", transaction=txn_out(existing))
    ben = db.get(models.Beneficiary, body.beneficiary_id)
    if ben is None or ben.user_id != user.id or ben.trust == "blocked":
        raise ApiError(404, "NOT_FOUND", "Payee not found.")
    if body.amount_paise > acct.balance_paise:  # clear UX; the debit itself is still an atomic conditional UPDATE
        raise ApiError(422, "INSUFFICIENT_FUNDS", "Insufficient balance for this transfer.")
    payload = {"beneficiary_id": ben.id, "amount_paise": body.amount_paise, "idempotency_key": body.idempotency_key}
    a = engine.assess(db, st, s, user, "transfer", payload)
    if a.decision == "BLOCK":
        t = ledger.record(db, acct.id, ben, body.amount_paise, "restricted", s.id, a.id, body.idempotency_key, body.note)
        enforcement.on_block(db, st, s, a, t)
        audit.log(db, "system", "transfer.restricted", user.id, s.id, transaction_id=t.id,
                  amount_paise=body.amount_paise, decision="BLOCK")
        db.commit()
        raise ApiError(403, "RISK_BLOCKED", a.customer_message)
    if a.decision == "STEP_UP":
        t = ledger.record(db, acct.id, ben, body.amount_paise, "pending_verification", s.id, a.id,
                          body.idempotency_key, body.note)
        c = enforcement.on_step_up(db, st, s, "transfer", {**payload, "transaction_id": t.id},
                                   f"Transfer to {ben.name} · {s.city} (simulated)", a.id)
        db.commit()
        response.status_code = 202
        return schemas.SensitiveActionResponse(result="pending_verification", decision="STEP_UP",
                                               customer_message=a.customer_message,
                                               transaction=txn_out(t), challenge=challenge_ref(c))
    t = ledger.transfer(db, acct.id, ben, body.amount_paise, s.id, a.id, body.idempotency_key, body.note)
    audit.log(db, user.username, "transfer.completed", user.id, s.id, transaction_id=t.id,
              amount_paise=body.amount_paise, decision="ALLOW")
    db.commit()
    return schemas.SensitiveActionResponse(result="completed", decision="ALLOW", customer_message="Transfer complete.",
                                           transaction=txn_out(t))
