import uuid

from tests.conftest import csrf, login


def _add_payee(client, name="R Kumar", ref="SYN-9911"):
    return client.post("/api/bank/beneficiaries", json={"name": name, "account_ref": ref}, headers=csrf(client))


def _established_payee(app_ctx, user):
    """The payee in the customer's seeded history and trusted baseline."""
    from app import seed
    with app_ctx.state.ss.SessionLocal() as db:
        return {"id": seed.established_payee(db, user.id).id}


def _balance(client):
    return client.get("/api/bank/overview").json()["account"]["balance_paise"]


def test_overview_shows_synthetic_account(client, users, app_ctx):
    login(client, users["asha"])
    acct = client.get("/api/bank/overview").json()["account"]
    assert acct["account_ref"].startswith("SYN-") and acct["simulated"] is True


def test_transfer_is_idempotent(client, users, app_ctx):
    login(client, users["asha"])
    payee = _established_payee(app_ctx, users["asha"])
    before = _balance(client)
    key = str(uuid.uuid4())
    body = {"beneficiary_id": payee["id"], "amount_paise": 3_000_00, "idempotency_key": key}
    r1 = client.post("/api/bank/transfers", json=body, headers=csrf(client))
    r2 = client.post("/api/bank/transfers", json=body, headers=csrf(client))
    assert r1.status_code == 201, r1.text
    assert r2.json()["transaction"]["id"] == r1.json()["transaction"]["id"]
    assert _balance(client) == before - 3_000_00


def test_insufficient_funds_leaves_balance_unchanged(client, users, app_ctx):
    login(client, users["asha"])
    payee = _established_payee(app_ctx, users["asha"])
    before = _balance(client)
    r = client.post("/api/bank/transfers", json={"beneficiary_id": payee["id"], "amount_paise": before + 1,
                    "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
    assert _balance(client) == before


def test_non_positive_amount_rejected(client, users, app_ctx):
    login(client, users["asha"])
    r = client.post("/api/bank/transfers", json={"beneficiary_id": 1, "amount_paise": 0,
                    "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code == 422


def test_cannot_transfer_to_other_users_beneficiary(client, users, app_ctx):
    login(client, users["ravi"])
    ravis = _established_payee(app_ctx, users["ravi"])
    client.post("/api/auth/logout", headers=csrf(client))
    login(client, users["asha"])
    r = client.post("/api/bank/transfers", json={"beneficiary_id": ravis["id"], "amount_paise": 100,
                    "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code == 404


def test_atomic_debit_refuses_overdraft_at_service_level(app_ctx, users):
    import pytest
    from app import models
    from app.errors import ApiError
    from app.services import ledger
    with app_ctx.state.ss.SessionLocal() as db:
        acct = db.query(models.Account).filter_by(user_id=users["asha"].id).one()
        before = acct.balance_paise
        with pytest.raises(ApiError):
            ledger.debit(db, acct.id, before + 1)
        db.expire_all()
        assert db.get(models.Account, acct.id).balance_paise == before
