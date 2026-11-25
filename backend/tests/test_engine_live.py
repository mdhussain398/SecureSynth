import re
import uuid

from tests.conftest import csrf, login


def _payee(client, name="New Person", ref="SYN-7777"):
    return client.post("/api/bank/beneficiaries", json={"name": name, "account_ref": ref}, headers=csrf(client))


def _established(app_ctx, user):
    from app import seed
    with app_ctx.state.ss.SessionLocal() as db:
        b = seed.established_payee(db, user.id)
        db.commit()
        return b.id


def test_live_engine_is_the_trained_model(client, users, app_ctx):
    r = login(client, users["asha"])
    assert r.status_code == 200
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        a = db.query(models.RiskAssessment).order_by(models.RiskAssessment.id.desc()).first()
        assert a.model_version.startswith("iforest-v1-")
        assert 0.0 <= a.ml_index <= 100.0


def test_established_customer_usual_login_is_allowed(client, users):
    r = login(client, users["asha"])
    assert r.json()["decision"] == "ALLOW", r.json()


def test_usual_transfer_to_established_payee_is_allowed(client, users, app_ctx):
    login(client, users["asha"])
    bid = _established(app_ctx, users["asha"])
    r = client.post("/api/bank/transfers", json={"beneficiary_id": bid, "amount_paise": 2_500_00,
                    "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code == 201, r.text


def test_continuous_risk_legit_login_then_takeover_behaviour_is_restricted(client, users):
    """A5: password+TOTP+recognised browser → ALLOW; then add payee and drain within a minute → intervention."""
    assert login(client, users["asha"]).json()["decision"] == "ALLOW"
    r = _payee(client)
    if r.status_code == 201:
        bid = r.json()["beneficiary"]["id"]
        r = client.post("/api/bank/transfers", json={"beneficiary_id": bid, "amount_paise": 45_000_00,
                        "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code in (202, 403), r.text
    # backend now refuses further sensitive operations from this session
    again = client.post("/api/bank/transfers", json={"beneficiary_id": 1, "amount_paise": 100,
                        "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert again.status_code == 403
    assert again.json()["error"]["code"] in ("STEP_UP_REQUIRED", "SESSION_RESTRICTED")


def test_unrecognised_browser_raises_login_risk(client, users, app_ctx):
    client.cookies.delete("ss_device", domain="127.0.0.1", path="/api")
    login(client, users["asha"])
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        a = db.query(models.RiskAssessment).order_by(models.RiskAssessment.id.desc()).first()
        assert any(p["rule"] == "new_device" for p in a.policy)


def test_customer_message_reveals_no_scores_or_feature_names(client, users):
    client.cookies.delete("ss_device", domain="127.0.0.1", path="/api")
    msg = login(client, users["asha"]).json()["customer_message"]
    assert not re.search(r"\d", msg)
    assert "hour_rarity" not in msg and "score" not in msg.lower()
