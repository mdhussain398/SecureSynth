"""Ghost Banking: isolated synthetic banking for BLOCKed sessions (behind GHOST_BANKING_ENABLED)."""
import json
import pathlib
import threading
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select

from tests.conftest import TEST_DEVICE_RAW, csrf, login
from tests.test_incidents import fresh_code, signin


@pytest.fixture()
def app_ctx(tmp_path, clock):
    """Same as conftest's app, but with Ghost Banking enabled and its own ghost database file."""
    from cryptography.fernet import Fernet
    from app.config import Settings
    from app.main import create_app
    app = create_app(Settings(
        database_url=f"sqlite:///{tmp_path/'t.db'}", ghost_database_url=f"sqlite:///{tmp_path/'ghost.db'}",
        secret_key="test-secret", fernet_key=Fernet.generate_key().decode(), demo_mode=True, ghost_banking_enabled=True,
        seed_snapshot=str(tmp_path / "seed.db"), demo_credentials=str(tmp_path / "creds.json")))
    # Runtime containment is OFF by default even inside the gate; these tests run with it switched on.
    from app import models
    from app.services import clock as clk
    with app.state.ss.SessionLocal() as d:
        d.add(models.RuntimeSetting(key="ghost_banking", value="on", version=1, updated_by="test", updated_at=clk.now(), reason="test fixture"))
        d.commit()
    return app


@pytest.fixture()
def analyst(app_ctx, users):
    with TestClient(app_ctx, base_url="http://127.0.0.1:8000") as c:
        c.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
        assert login(c, users["admin"]).json()["decision"] == "ALLOW"
        yield c


def ghost_login(client, users, app_ctx, clock, who="ravi"):
    """Takeover at sign-in: unrecognised browser, 03:00, simulated Lagos → the engine BLOCKs."""
    client.cookies.clear()
    clock.set_offset(clock._offset + timedelta(hours=18))
    client.post("/api/auth/login", json={"username": who, "password": users[who].password}).raise_for_status()
    h = {**csrf(client), "X-Lab-Token": app_ctx.state.ss.lab_token, "X-Sim-Context": json.dumps({"city": "Lagos"})}
    r = client.post("/api/auth/totp", json={"code": fresh_code(app_ctx, users[who])}, headers=h)
    assert r.status_code == 200, r.text
    clock.set_offset(clock._offset - timedelta(hours=18))  # back to 09:xx for the rest of the test
    return r


def db(app_ctx):
    return app_ctx.state.ss.SessionLocal()


def session_of(app_ctx, client):
    from app import models
    from app.security import tokens
    with db(app_ctx) as d:
        return d.scalar(select(models.Session).where(models.Session.token_hash == tokens.hash_token(client.cookies.get("ss_session"))))


def protected_state(app_ctx, user_id):
    from app import models
    with db(app_ctx) as d:
        acct = d.scalar(select(models.Account).where(models.Account.user_id == user_id))
        return {"balance": acct.balance_paise,
                "txns": d.scalar(select(func.count()).select_from(models.Transaction).where(models.Transaction.account_id == acct.id)),
                "bens": d.scalar(select(func.count()).select_from(models.Beneficiary).where(models.Beneficiary.user_id == user_id)),
                "history": d.scalar(select(func.count()).select_from(models.HistoryEvent).where(models.HistoryEvent.user_id == user_id)),
                "baseline": (lambda b: (b.version, json.dumps(b.trusted, sort_keys=True), json.dumps(b.candidate, sort_keys=True)))(
                    d.get(models.Baseline, user_id))}


def ghost_payee_and_transfer(client, amount=20_000_00, key=None):
    r = client.post("/api/bank/beneficiaries", json={"name": "Quick Cash", "account_ref": "SYN-4242"}, headers=csrf(client))
    assert r.status_code == 201 and r.json()["result"] == "completed", r.text
    bid = r.json()["beneficiary"]["id"]
    t = client.post("/api/bank/transfers", json={"beneficiary_id": bid, "amount_paise": amount,
                                                 "idempotency_key": key or str(uuid.uuid4())}, headers=csrf(client))
    return bid, t


def the_incident(analyst):
    rows = analyst.get("/api/admin/incidents?status=all").json()
    assert len(rows) == 1, rows
    return rows[0]


# ---------------------------------------------------------------- feature flag

def test_flag_off_blocks_into_restricted_and_creates_no_ghost_database(tmp_path, clock):
    from cryptography.fernet import Fernet
    from app.config import Settings
    from app.main import create_app
    app = create_app(Settings(database_url=f"sqlite:///{tmp_path/'p.db'}", ghost_database_url=f"sqlite:///{tmp_path/'g.db'}",
                              fernet_key=Fernet.generate_key().decode(), demo_mode=True))
    assert app.state.ss.GhostSessionLocal is None and not (tmp_path / "g.db").exists()
    from app.config import Settings as S
    assert S.model_fields["ghost_banking_enabled"].default is False  # off unless explicitly enabled


def test_ghost_database_is_separate_from_the_protected_database(app_ctx):
    st = app_ctx.state.ss
    assert st.settings.ghost_database_url != st.settings.database_url
    assert str(st.ghost_engine.url) != str(st.engine.url)
    protected, ghost = set(inspect(st.engine).get_table_names()), set(inspect(st.ghost_engine).get_table_names())
    assert ghost == {"ghost_accounts", "ghost_beneficiaries", "ghost_transactions", "ghost_events"}
    assert not (protected & ghost) and "accounts" not in ghost


def test_ghost_package_cannot_reach_protected_banking_code():
    """Data-access boundary: the ghost package never imports protected tables or the protected ledger."""
    src = "\n".join(p.read_text() for p in pathlib.Path("app/ghost").glob("*.py"))
    for banned in ("models.Account", "models.Transaction", "models.Beneficiary", "services import ledger",
                   "services.ledger", "models.Baseline", "models.HistoryEvent", "SessionLocal()"):
        assert banned not in src, banned


# ---------------------------------------------------------------- entering ghost mode

def test_block_contains_the_session_and_notifies_the_analyst(client, analyst, users, app_ctx, clock):
    r = ghost_login(client, users, app_ctx, clock)
    assert r.json()["decision"] == "ALLOW" and r.json()["challenge"] is None  # containment is not revealed
    assert client.get("/api/auth/me").json()["mode"] == "normal"
    s = session_of(app_ctx, client)
    assert s.mode == "ghost"
    from app import models
    with db(app_ctx) as d:
        a = d.scalar(select(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id))
        assert a.decision == "BLOCK"  # the real decision is recorded for the analyst
        ev = d.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == "ghost.entered"))
        assert ev.details["protected_balance_paise"] == 50_000_00 and ev.session_id == s.id
    inc = the_incident(analyst)
    assert inc["ghost"] is True and inc["unread"] and inc["status"] == "pending_review" and inc["session_id"] == s.id
    assert analyst.get("/api/admin/incidents/summary").json()["unread"] == 1


def test_ghost_reads_are_synthetic_and_never_protected(client, users, app_ctx, clock):
    ghost_login(client, users, app_ctx, clock)
    ov = client.get("/api/bank/overview").json()
    assert ov["account"]["account_ref"] != "SYN-1002"  # ravi's protected account ref
    names = {t["counterparty"] for t in client.get("/api/bank/transactions").json()}
    assert names and "Landlord Synth" not in names  # the protected payee never appears
    bens = client.get("/api/bank/beneficiaries").json()
    assert bens and all(b["name"] != "Landlord Synth" for b in bens)
    # state is consistent across requests in the same session
    assert client.get("/api/bank/overview").json()["account"] == ov["account"]


# ---------------------------------------------------------------- simulated operations and integrity

def test_simulated_payee_and_transfer_never_touch_protected_state(client, users, app_ctx, clock):
    before = protected_state(app_ctx, users["ravi"].id)
    ghost_login(client, users, app_ctx, clock)
    after_login = protected_state(app_ctx, users["ravi"].id)  # the BLOCKed sign-in itself is protected evidence
    start = client.get("/api/bank/overview").json()["account"]["balance_paise"]
    _, t = ghost_payee_and_transfer(client, 20_000_00)
    assert t.status_code == 201 and t.json()["result"] == "completed"
    assert client.get("/api/bank/overview").json()["account"]["balance_paise"] == start - 20_000_00
    assert any(b["name"] == "Quick Cash" for b in client.get("/api/bank/beneficiaries").json())
    now = protected_state(app_ctx, users["ravi"].id)
    assert now == after_login  # no protected balance, transaction, payee, history or baseline change
    assert now["balance"] == before["balance"]


def test_ghost_activity_does_not_poison_the_baseline(client, users, app_ctx, clock):
    ghost_login(client, users, app_ctx, clock)
    base = protected_state(app_ctx, users["ravi"].id)["baseline"]
    for _ in range(3):
        ghost_payee_and_transfer(client, 1_000_00)
    assert protected_state(app_ctx, users["ravi"].id)["baseline"] == base


def test_protected_ids_and_api_bypass_are_refused(client, analyst, users, app_ctx, clock):
    from app import models
    ghost_login(client, users, app_ctx, clock)
    with db(app_ctx) as d:
        protected_payee = d.scalar(select(models.Beneficiary.id).where(models.Beneficiary.user_id == users["ravi"].id))
    before = protected_state(app_ctx, users["ravi"].id)
    r = client.post("/api/bank/transfers", json={"beneficiary_id": protected_payee, "amount_paise": 1_000_00,
                                                 "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    # Ids are per-database: the same number can only ever resolve to one of this session's synthetic payees,
    # never to the protected payee behind that id.
    assert r.status_code in (201, 404)
    if r.status_code == 201:
        assert r.json()["transaction"]["counterparty"] in {b["name"] for b in client.get("/api/bank/beneficiaries").json()}
        assert r.json()["transaction"]["counterparty"] != "Landlord Synth"
    assert client.post("/api/bank/transfers", json={"beneficiary_id": 987654, "amount_paise": 100,
                                                    "idempotency_key": str(uuid.uuid4())}, headers=csrf(client)).status_code == 404
    assert client.get(f"/api/admin/ghost/{session_of(app_ctx, client).id}").status_code == 403
    assert client.get("/api/admin/incidents").status_code == 403
    assert client.post("/api/bank/transfers", json={"beneficiary_id": 1, "amount_paise": 100, "idempotency_key": "x" * 10}).status_code == 403  # CSRF
    assert protected_state(app_ctx, users["ravi"].id) == before


def test_ghost_sessions_are_isolated_from_each_other(app_ctx, users, clock):
    with TestClient(app_ctx, base_url="http://127.0.0.1:8000") as a, TestClient(app_ctx, base_url="http://127.0.0.1:8000") as b:
        ghost_login(a, users, app_ctx, clock)
        bid_a, _ = ghost_payee_and_transfer(a, 1_000_00)
        ghost_login(b, users, app_ctx, clock)
        acct_a = a.get("/api/bank/overview").json()["account"]
        acct_b = b.get("/api/bank/overview").json()["account"]
        assert acct_a["account_ref"] != acct_b["account_ref"] or acct_a["balance_paise"] != acct_b["balance_paise"]
        assert all(x["name"] != "Quick Cash" for x in b.get("/api/bank/beneficiaries").json())
        r = b.post("/api/bank/transfers", json={"beneficiary_id": bid_a, "amount_paise": 100, "idempotency_key": str(uuid.uuid4())},
                   headers=csrf(b))
        assert r.status_code == 404  # another session's ghost payee is invisible


def test_duplicate_requests_are_idempotent(client, users, app_ctx, clock):
    ghost_login(client, users, app_ctx, clock)
    start = client.get("/api/bank/overview").json()["account"]["balance_paise"]
    key = str(uuid.uuid4())
    bid, t1 = ghost_payee_and_transfer(client, 5_000_00, key=key)
    t2 = client.post("/api/bank/transfers", json={"beneficiary_id": bid, "amount_paise": 5_000_00, "idempotency_key": key},
                     headers=csrf(client))
    assert t1.json()["transaction"]["id"] == t2.json()["transaction"]["id"] and t2.json()["customer_message"] == "Already processed."
    assert client.get("/api/bank/overview").json()["account"]["balance_paise"] == start - 5_000_00


def test_concurrent_transfers_cannot_overdraw_the_synthetic_balance(client, users, app_ctx, clock):
    from app.errors import ApiError
    from app.ghost import service as ghost
    ghost_login(client, users, app_ctx, clock)
    sid = session_of(app_ctx, client).id
    bid, _ = ghost_payee_and_transfer(client, 100)
    start = client.get("/api/bank/overview").json()["account"]["balance_paise"]
    chunk = start // 3 + 1  # at most two can succeed
    ok, refused = [], []

    def go():
        with app_ctx.state.ss.GhostSessionLocal() as g:
            try:
                ok.append(ghost.transfer(g, sid, bid, chunk, str(uuid.uuid4()), None))
            except ApiError as e:
                refused.append(e.code)
    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    end = client.get("/api/bank/overview").json()["account"]["balance_paise"]
    assert len(ok) == 2 and set(refused) <= {"INSUFFICIENT_FUNDS"} and len(refused) == 4
    assert end == start - 2 * chunk and end >= 0


# ---------------------------------------------------------------- analyst monitor and decisions

def test_analyst_monitor_shows_live_synthetic_activity_and_audited_comparison(client, analyst, users, app_ctx, clock):
    ghost_login(client, users, app_ctx, clock)
    sid = session_of(app_ctx, client).id
    ghost_payee_and_transfer(client, 12_000_00)
    client.post("/api/bank/transfers", json={"beneficiary_id": 999999, "amount_paise": 7_000_00,
                                             "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    m = analyst.get(f"/api/admin/ghost/{sid}").json()
    assert m["ghost"]["totals"]["simulated_transfers"] == 1 and m["ghost"]["totals"]["simulated_value_paise"] == 12_000_00
    assert m["ghost"]["totals"]["rejected_attempts"] == 1 and m["ghost"]["totals"]["payees_added"] == 1
    kinds = [e["kind"] for e in m["ghost"]["events"]]
    assert kinds[0] == "entered" and "beneficiary_added" in kinds and "transfer_simulated" in kinds
    assert m["protected_status"]["completed_transfers_by_session_since_entry"] == 0
    assert m["protected_status"]["balance_unchanged_since_entry"] is True
    assert m["incident"]["ghost"] and m["trigger_assessment"]["decision"] == "BLOCK" and m["comparison"] is None
    c = analyst.get(f"/api/admin/ghost/{sid}?compare=true").json()["comparison"]
    assert c["protected"]["balance_paise"] == 50_000_00 and c["ghost"]["label"].startswith("SYNTHETIC")
    with db(app_ctx) as d:
        from app import models
        assert d.scalar(select(models.AuditEvent).where(models.AuditEvent.event_type == "ghost.compare_viewed")).actor == "admin"


def test_ghost_session_is_never_restored_in_place(client, analyst, users, app_ctx, clock):
    from tests.test_incidents import act
    ghost_login(client, users, app_ctx, clock)
    r = act(analyst, app_ctx, users, the_incident(analyst)["id"], "unblock_session")
    assert r.status_code == 409 and "Ghost sessions are never restored" in r.json()["error"]["message"]


def test_clear_user_ends_ghost_session_keeps_evidence_and_requires_fresh_sign_in(client, analyst, users, app_ctx, clock):
    from tests.test_incidents import act
    before = protected_state(app_ctx, users["ravi"].id)["balance"]
    ghost_login(client, users, app_ctx, clock)
    sid = session_of(app_ctx, client).id
    ghost_payee_and_transfer(client, 9_000_00)
    iid = the_incident(analyst)["id"]
    assert act(analyst, app_ctx, users, iid, "clear_user", reason="Verified owner by call-back").json()["status"] == "user_cleared"
    assert client.get("/api/bank/overview").status_code == 401 and client.get("/api/auth/me").status_code == 401
    m = analyst.get(f"/api/admin/ghost/{sid}").json()  # evidence preserved
    assert m["ghost"]["totals"]["simulated_transfers"] == 1
    client.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
    assert signin(client, app_ctx, users["ravi"]).json()["decision"] == "ALLOW"  # fresh, normally assessed
    assert session_of(app_ctx, client).mode == "normal"
    ov = client.get("/api/bank/overview").json()
    assert ov["account"]["balance_paise"] == before  # the real balance; nothing migrated or executed
    assert all(b["name"] != "Quick Cash" for b in client.get("/api/bank/beneficiaries").json())
    assert all(t["amount_paise"] != 9_000_00 for t in client.get("/api/bank/transactions").json())


def test_new_suspicious_activity_after_recovery_opens_a_new_incident(client, analyst, users, app_ctx, clock):
    from tests.test_incidents import act
    ghost_login(client, users, app_ctx, clock)
    act(analyst, app_ctx, users, the_incident(analyst)["id"], "clear_user").raise_for_status()
    ghost_login(client, users, app_ctx, clock)
    rows = analyst.get("/api/admin/incidents?status=open").json()
    assert len(rows) == 1 and rows[0]["ghost"] and session_of(app_ctx, client).mode == "ghost"


def test_keep_and_revoke_and_verification_on_a_ghost_session(client, analyst, users, app_ctx, clock):
    from tests.test_incidents import act
    ghost_login(client, users, app_ctx, clock)
    iid = the_incident(analyst)["id"]
    assert act(analyst, app_ctx, users, iid, "request_verification", totp=False).json()["status"] == "verification_requested"
    check = client.get("/api/auth/security-check").json()["check"]
    key = users["ravi"].device_key
    pend = client.get("/api/device/pending", headers={"X-Device-Key": key}).json()
    assert check and pend[0]["operation"] == "incident_verify"
    client.post("/api/device/respond", json={"challenge_id": pend[0]["id"], "selected_number": check["number_match"],
                                             "approve": True}, headers={"X-Device-Key": key}).raise_for_status()
    assert the_incident(analyst)["verification"] == "approved" and session_of(app_ctx, client).mode == "ghost"
    assert act(analyst, app_ctx, users, iid, "keep_restricted", totp=False).status_code == 200
    assert session_of(app_ctx, client).mode == "ghost"  # still contained and monitored
    assert client.get("/api/bank/overview").status_code == 200


def test_ghost_session_refused_if_the_feature_is_later_disabled(client, users, app_ctx, clock):
    ghost_login(client, users, app_ctx, clock)
    st = app_ctx.state.ss
    saved, st.GhostSessionLocal = st.GhostSessionLocal, None
    try:
        r = client.get("/api/bank/overview")
        assert r.status_code == 403 and r.json()["error"]["code"] == "SESSION_RESTRICTED"  # never protected data
    finally:
        st.GhostSessionLocal = saved


# ---------------------------------------------------------------- Scenario Lab

def test_lab_ghost_scenario_and_reset(client, users, app_ctx):
    import shutil
    from app.ghost import service as ghost
    st = app_ctx.state.ss
    st.engine.dispose()
    shutil.copyfile(st.settings.database_url.removeprefix("sqlite:///"), st.settings.seed_snapshot)
    assert login(client, users["admin"]).status_code == 200
    run = client.post("/api/lab/scenarios/ghost_banking/run", json={"params": {"username": "ravi"}}, headers=csrf(client)).json()
    assert run["final_decision"] == "BLOCK" and run["contained_in_ghost"] is True
    assert run["protected_balance_before_paise"] == run["protected_balance_after_paise"]
    assert any("simulated in Ghost Banking" in s["note"] for s in run["steps"])
    with st.GhostSessionLocal() as g:
        assert ghost.count_accounts(g) == 1
    assert client.get("/api/admin/incidents?status=all").json()[0]["is_lab"] is True
    assert client.post("/api/lab/reset", headers=csrf(client)).status_code == 200
    with st.GhostSessionLocal() as g:
        assert ghost.count_accounts(g) == 0
    assert client.get("/api/admin/incidents?status=all").json() == []
