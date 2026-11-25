import uuid

from tests.conftest import csrf, login


def _step_up_transfer(client, users, app_ctx):
    """Login (ALLOW), add a new payee, then a large quick transfer → STEP_UP or BLOCK."""
    login(client, users["asha"])
    r = client.post("/api/bank/beneficiaries", json={"name": "New Person", "account_ref": "SYN-7777"},
                    headers=csrf(client))
    return r


def _pending(client, key):
    return client.get("/api/device/pending", headers={"X-Device-Key": key})


def _make_challenge(client, users):
    """Unrecognised browser login → engine STEP_UP for login (challenge bound to login)."""
    client.cookies.delete("ss_device", domain="127.0.0.1", path="/api")
    r = login(client, users["asha"]).json()
    return r


def test_device_endpoints_ignore_banking_session_cookie(client, users):
    login(client, users["asha"])
    r = client.get("/api/device/pending")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "DEVICE_UNAUTHENTICATED"


def test_device_key_lists_only_own_pending_challenges(client, users, app_ctx):
    from app.services import challenges
    from app import models
    login(client, users["asha"])
    with app_ctx.state.ss.SessionLocal() as db:
        s = db.query(models.Session).filter_by(user_id=users["asha"].id, mode="normal").one()
        c = challenges.create(db, app_ctx.state.ss, s, "login", {"login": True}, "Sign-in test", None)
        db.commit()
    mine = _pending(client, users["asha"].device_key).json()
    theirs = _pending(client, users["ravi"].device_key).json()
    assert [x["id"] for x in mine] == [c.id] and theirs == []
    assert c.number_match in mine[0]["options"] and "number_match" not in mine[0]


def _create(app_ctx, users, operation="login", payload=None):
    from app.services import challenges
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        s = db.query(models.Session).filter_by(user_id=users["asha"].id).order_by(models.Session.created_at.desc()).first()
        s.mode = "step_up"
        c = challenges.create(db, app_ctx.state.ss, s, operation, payload or {"login": True}, "test", None)
        db.commit()
        return c


def _respond(client, key, cid, number, approve=True):
    return client.post("/api/device/respond", json={"challenge_id": cid, "selected_number": number, "approve": approve},
                       headers={"X-Device-Key": key})


def test_wrong_number_denies_and_session_restricted(client, users, app_ctx):
    login(client, users["asha"])
    c = _create(app_ctx, users)
    wrong = next(o for o in c.options if o != c.number_match)
    assert _respond(client, users["asha"].device_key, c.id, wrong).json()["status"] == "denied"
    assert client.get("/api/auth/me").json()["mode"] == "restricted"


def test_correct_number_approves_login_once_and_cannot_be_reused(client, users, app_ctx):
    login(client, users["asha"])
    c = _create(app_ctx, users)
    assert _respond(client, users["asha"].device_key, c.id, c.number_match).json()["status"] == "approved"
    assert client.get("/api/auth/me").json()["mode"] == "normal"
    r = _respond(client, users["asha"].device_key, c.id, c.number_match)
    assert r.status_code == 400 and r.json()["error"]["code"] == "CHALLENGE_INVALID"


def test_expired_challenge_cannot_be_approved(client, users, app_ctx, clock):
    login(client, users["asha"])
    c = _create(app_ctx, users)
    clock.advance(seconds=121)
    r = _respond(client, users["asha"].device_key, c.id, c.number_match)
    assert r.status_code == 400


def test_other_users_device_cannot_approve(client, users, app_ctx):
    login(client, users["asha"])
    c = _create(app_ctx, users)
    r = _respond(client, users["ravi"].device_key, c.id, c.number_match)
    assert r.status_code == 400


def test_approved_transfer_executes_exactly_the_bound_payload_once(client, users, app_ctx):
    from app import models, seed
    login(client, users["asha"])
    with app_ctx.state.ss.SessionLocal() as db:
        ben = seed.established_payee(db, users["asha"].id)
        acct = db.query(models.Account).filter_by(user_id=users["asha"].id).one()
        before = acct.balance_paise
        t = models.Transaction(account_id=acct.id, beneficiary_id=ben.id, amount_paise=12_345_00, direction="debit",
                               counterparty=ben.name, status="pending_verification", idempotency_key=str(uuid.uuid4()),
                               created_at=acct and __import__("app.services.clock", fromlist=["now"]).now())
        db.add(t)
        db.commit()
        payload = {"beneficiary_id": ben.id, "amount_paise": 12_345_00, "idempotency_key": t.idempotency_key,
                   "transaction_id": t.id}
    c = _create(app_ctx, users, "transfer", payload)
    assert _respond(client, users["asha"].device_key, c.id, c.number_match).json()["status"] == "approved"
    _respond(client, users["asha"].device_key, c.id, c.number_match)
    with app_ctx.state.ss.SessionLocal() as db:
        assert db.get(models.Account, acct.id).balance_paise == before - 12_345_00
        assert db.get(models.Transaction, t.id).status == "completed"


def test_tampered_payload_is_not_executed(client, users, app_ctx):
    from app import models
    login(client, users["asha"])
    c = _create(app_ctx, users, "transfer", {"beneficiary_id": 1, "amount_paise": 100, "idempotency_key": "k" * 10,
                                             "transaction_id": 999})
    with app_ctx.state.ss.SessionLocal() as db:
        row = db.get(models.Challenge, c.id)
        row.payload = {**row.payload, "amount_paise": 99_999_00}
        db.commit()
    r = _respond(client, users["asha"].device_key, c.id, c.number_match)
    assert r.status_code == 400


def _login_step_up(client, users):
    client.cookies.delete("ss_device", domain="127.0.0.1", path="/api")
    r = login(client, users["asha"]).json()
    assert r["decision"] == "STEP_UP", r
    return r


def test_unverified_login_step_up_cannot_read_account_data(client, users):
    _login_step_up(client, users)
    for path in ("/api/bank/overview", "/api/bank/transactions", "/api/bank/beneficiaries"):
        r = client.get(path)
        assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED", path
    assert client.get("/api/auth/me").status_code == 200  # can still see it is waiting


def test_expired_step_up_restricts_session(client, users, clock):
    _login_step_up(client, users)
    clock.advance(seconds=121)
    assert client.get("/api/auth/me").json()["mode"] == "restricted"


def test_login_step_up_approval_unlocks_reads(client, users, app_ctx):
    from app import models
    r = _login_step_up(client, users)
    with app_ctx.state.ss.SessionLocal() as db:
        n = db.get(models.Challenge, r["challenge"]["id"]).number_match
    _respond(client, users["asha"].device_key, r["challenge"]["id"], n)
    assert client.get("/api/bank/overview").status_code == 200


def test_denied_challenge_voids_that_sessions_baseline_contributions(client, users, app_ctx):
    from app import models
    from app.services import baseline as B
    login(client, users["asha"])
    c = _create(app_ctx, users)
    with app_ctx.state.ss.SessionLocal() as db:
        s = db.get(models.Session, c.session_id)
        dref = "dev-candidate-77"  # a verified-but-unpromoted device used earlier in this session
        B.record_verified(db, users["asha"].id, "device", dref, "earlier", s.id)
        B.observe_session(db, users["asha"].id, s.id, device_ref=dref, city="Bengaluru", clean=True)
        db.commit()
    wrong = next(o for o in c.options if o != c.number_match)
    _respond(client, users["asha"].device_key, c.id, wrong)
    with app_ctx.state.ss.SessionLocal() as db:
        item = next(i for i in db.get(models.Baseline, users["asha"].id).candidate if i["value"] == dref)
        assert item["status"] == "rejected"


def test_approval_with_insufficient_funds_fails_cleanly_and_is_recorded(client, users, app_ctx):
    from app import models, seed
    from app.services import clock as clk
    login(client, users["asha"])
    with app_ctx.state.ss.SessionLocal() as db:
        ben = seed.established_payee(db, users["asha"].id)
        acct = db.query(models.Account).filter_by(user_id=users["asha"].id).one()
        t = models.Transaction(account_id=acct.id, beneficiary_id=ben.id, amount_paise=acct.balance_paise + 1,
                               direction="debit", counterparty=ben.name, status="pending_verification",
                               idempotency_key=str(uuid.uuid4()), created_at=clk.now())
        db.add(t)
        db.commit()
        payload = {"beneficiary_id": ben.id, "amount_paise": t.amount_paise, "idempotency_key": t.idempotency_key,
                   "transaction_id": t.id}
    c = _create(app_ctx, users, "transfer", payload)
    r = _respond(client, users["asha"].device_key, c.id, c.number_match)
    assert r.status_code == 422
    with app_ctx.state.ss.SessionLocal() as db:
        assert db.get(models.Challenge, c.id).status == "denied"
        assert db.get(models.Transaction, t.id).status == "restricted"
