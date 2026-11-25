"""Analyst notification and analyst-assisted recovery for restricted customers (security incidents)."""
import json
import time
import uuid
from datetime import timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tests.conftest import TEST_DEVICE_RAW, csrf, login

BIG = 45_000_00  # far above the seeded ₹3,000 habit; the engine BLOCKs it (asserted, not assumed)


# ---------------------------------------------------------------- helpers

@pytest.fixture()
def analyst(app_ctx, users):
    """A second browser for the analyst, signed in on its own cookie jar."""
    with TestClient(app_ctx, base_url="http://127.0.0.1:8000") as c:
        c.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
        assert login(c, users["admin"]).json()["decision"] == "ALLOW"
        yield c


def fresh_code(app_ctx, user) -> str:
    """Next TOTP code the server has not accepted yet (replay protection is per time-step)."""
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        last = db.get(models.User, user.id).totp_last_step
    now = int(time.time()) // 30
    step = now if last is None or last < now else last + 1
    if step > now + 1:
        time.sleep(31 - time.time() % 30)
        return fresh_code(app_ctx, user)
    return pyotp.TOTP(user.totp_secret).generate_otp(step)


def signin(client, app_ctx, user):
    """Password + a TOTP code from a time-step the server has not seen (tests sign in several times)."""
    client.post("/api/auth/login", json={"username": user.username, "password": user.password}).raise_for_status()
    return client.post("/api/auth/totp", json={"code": fresh_code(app_ctx, user)}, headers=csrf(client))


def new_payee(client, users) -> int:
    """Add a payee (STEP_UP) and approve it on the trusted device; returns its id."""
    r = client.post("/api/bank/beneficiaries", json={"name": "Quick Cash", "account_ref": "SYN-4242"}, headers=csrf(client))
    assert r.status_code == 202, r.text
    key = users["asha"].device_key
    pend = client.get("/api/device/pending", headers={"X-Device-Key": key}).json()
    client.post("/api/device/respond", json={"challenge_id": pend[0]["id"], "selected_number": r.json()["challenge"]["number_match"],
                                             "approve": True}, headers={"X-Device-Key": key}).raise_for_status()
    return [b for b in client.get("/api/bank/beneficiaries").json() if b["name"] == "Quick Cash"][0]["id"]


def block_transfer(client, users, amount=BIG, payee=None, key=None, app_ctx=None):
    """Takeover pattern: payee added minutes ago, then a large transfer straight after sign-in → BLOCK."""
    app_ctx = app_ctx or client.app
    assert signin(client, app_ctx, users["asha"]).json()["decision"] == "ALLOW"
    payee = payee or new_payee(client, users)
    r = client.post("/api/bank/transfers", json={"beneficiary_id": payee, "amount_paise": amount,
                                                 "idempotency_key": key or str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code == 403 and r.json()["error"]["code"] == "RISK_BLOCKED", r.text
    return payee


def balance(app_ctx, user_id):
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        return db.scalar(select(models.Account.balance_paise).where(models.Account.user_id == user_id))


def the_incident(analyst, status="open"):
    rows = analyst.get(f"/api/admin/incidents?status={status}").json()
    assert len(rows) == 1, rows
    return rows[0]


def act(analyst, app_ctx, users, iid, action, reason="Customer confirmed by phone call-back", totp=True, **extra):
    body = {"action": action, "reason": reason, **extra}
    if totp:
        body["totp_code"] = fresh_code(app_ctx, users["admin"])
    return analyst.post(f"/api/admin/incidents/{iid}/actions", json=body, headers=csrf(analyst))


def login_block(client, users, app_ctx, clock):
    """Sign-in itself BLOCKed: unrecognised browser, 03:00, simulated Lagos."""
    client.cookies.clear()
    clock.set_offset(clock._offset + timedelta(hours=18))
    client.post("/api/auth/login", json={"username": "ravi", "password": users["ravi"].password}).raise_for_status()
    h = {**csrf(client), "X-Lab-Token": app_ctx.state.ss.lab_token, "X-Sim-Context": json.dumps({"city": "Lagos"})}
    r = client.post("/api/auth/totp", json={"code": fresh_code(app_ctx, users["ravi"])}, headers=h)
    assert r.json()["decision"] == "BLOCK", r.json()
    return r


# ---------------------------------------------------------------- notification

def test_block_opens_incident_with_full_context_and_unread_alert(client, analyst, users, app_ctx):
    before = balance(app_ctx, users["asha"].id)
    block_transfer(client, users)
    s = analyst.get("/api/admin/incidents/summary").json()
    assert s["open"] == 1 and s["unread"] == 1
    inc = s["latest"][0]
    assert inc["username"] == "asha" and inc["display_name"] == "Asha"
    assert inc["status"] == "pending_review" and inc["unread"] and inc["trigger"] == "risk_block"
    assert inc["amount_paise"] == BIG and inc["risk_score"] >= 89 and inc["severity"] in ("high", "critical")
    assert inc["session_id"] and inc["city"] == "Bengaluru" and inc["checkpoint"] == "transfer"
    assert inc["device_recognised"] is True and inc["reason"].startswith("Risk index")
    d = analyst.get(f"/api/admin/incidents/{inc['id']}").json()
    ta = d["trigger_assessment"]
    assert ta["decision"] == "BLOCK" and "index" in ta["ml"] and isinstance(ta["policy"], list) and ta["deviations"]
    assert d["sessions"][0]["mode"] == "restricted" and d["sessions"][0]["unblock_eligible"] is True
    assert any(t["status"] == "restricted" and t["amount_paise"] == BIG for t in d["transactions"])
    assert d["attempts"][-1]["outcome"] == "blocked"
    assert any(e["event_type"] == "incident.opened" for e in d["timeline"])
    assert balance(app_ctx, users["asha"].id) == before


def test_repeated_blocks_attach_to_one_unresolved_incident(client, analyst, users, app_ctx):
    payee = block_transfer(client, users)
    client.cookies.delete("ss_session", domain="127.0.0.1", path="/api")
    block_transfer(client, users, payee=payee)
    rows = analyst.get("/api/admin/incidents?status=all").json()
    assert len(rows) == 1 and rows[0]["block_count"] == 2 and len(rows[0]["session_ids"]) == 2


def test_read_clears_unread_and_new_activity_marks_it_unread_again(client, analyst, users):
    payee = block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    assert analyst.post(f"/api/admin/incidents/{iid}/read", headers=csrf(analyst)).status_code == 200
    assert analyst.get("/api/admin/incidents/summary").json()["unread"] == 0
    client.cookies.delete("ss_session", domain="127.0.0.1", path="/api")
    block_transfer(client, users, payee=payee)
    assert analyst.get("/api/admin/incidents/summary").json()["unread"] == 1


# ---------------------------------------------------------------- authorisation and validation

def test_customer_cannot_list_or_resolve_incidents(client, analyst, users):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    for path in ("/api/admin/incidents", f"/api/admin/incidents/{iid}", "/api/admin/incidents/summary"):
        assert client.get(path).status_code == 403
    r = client.post(f"/api/admin/incidents/{iid}/actions", json={"action": "unblock_session", "reason": "let me in please"},
                    headers=csrf(client))
    assert r.status_code == 403
    assert the_incident(analyst)["status"] == "pending_review"


def test_clearance_requires_reason_and_fresh_analyst_totp(client, analyst, users, app_ctx):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    assert act(analyst, app_ctx, users, iid, "unblock_session", reason="").status_code == 422
    assert act(analyst, app_ctx, users, iid, "unblock_session", reason="ok").status_code == 422
    r = act(analyst, app_ctx, users, iid, "unblock_session", totp=False)
    assert r.status_code == 403 and r.json()["error"]["code"] == "REAUTH_REQUIRED"
    r = act(analyst, app_ctx, users, iid, "unblock_session", totp=False, totp_code="000000")
    assert r.status_code == 403 and r.json()["error"]["code"] == "REAUTH_FAILED"
    assert client.get("/api/bank/overview").status_code == 403  # still restricted
    assert the_incident(analyst)["status"] == "pending_review"


def test_mutation_without_csrf_is_rejected(client, analyst, users, app_ctx):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    r = analyst.post(f"/api/admin/incidents/{iid}/actions", json={"action": "keep_restricted", "reason": "Still suspicious"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CSRF_FAILED"


# ---------------------------------------------------------------- session-level clearance

def test_unblock_session_restores_access_without_executing_the_blocked_transfer(client, analyst, users, app_ctx):
    before = balance(app_ctx, users["asha"].id)
    block_transfer(client, users)
    assert client.get("/api/auth/incident").json()["incident"]["status"] == "pending_review"
    iid = the_incident(analyst)["id"]
    r = act(analyst, app_ctx, users, iid, "unblock_session")
    assert r.status_code == 200 and r.json()["status"] == "session_restored", r.text
    view = client.get("/api/auth/incident").json()
    assert view["incident"]["status"] == "access_restored" and view["next_step"] == "continue"
    assert client.get("/api/auth/me").json()["mode"] == "normal"
    ov = client.get("/api/bank/overview")
    assert ov.status_code == 200 and ov.json()["account"]["balance_paise"] == before
    txns = client.get("/api/bank/transactions").json()
    assert [t["status"] for t in txns if t["amount_paise"] == BIG] == ["restricted"]  # never executed
    d = analyst.get(f"/api/admin/incidents/{iid}").json()
    ev = [e for e in d["timeline"] if e["event_type"] == "incident.unblock_session"][0]
    assert ev["actor"] == "admin" and ev["details"]["reason"].startswith("Customer confirmed")
    assert ev["details"]["previous_state"] == "pending_review" and ev["details"]["resulting_state"] == "session_restored"
    assert ev["details"]["session_ids"][0]["from"] == "restricted" and ev["details"]["session_ids"][0]["to"] == "normal"
    assert d["attempts"][-1]["outcome"] == "reviewed"  # evidence kept, no longer velocity


def test_resolution_is_idempotent_and_conflicting_decisions_are_refused(client, analyst, users, app_ctx):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    assert act(analyst, app_ctx, users, iid, "keep_restricted", totp=False).json()["idempotent"] is False
    again = act(analyst, app_ctx, users, iid, "keep_restricted", totp=False)
    assert again.status_code == 200 and again.json()["idempotent"] is True
    r = act(analyst, app_ctx, users, iid, "unblock_session")
    assert r.status_code == 409 and r.json()["error"]["code"] == "INCIDENT_RESOLVED"


def test_concurrent_decisions_resolve_once(client, analyst, users, app_ctx):
    """Two analysts act on the same stale incident row: one wins, the other gets 409 or an idempotent echo."""
    from app import models
    from app.errors import ApiError
    from app.services import incidents
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    st = app_ctx.state.ss
    with st.SessionLocal() as db1, st.SessionLocal() as db2:
        inc1, inc2 = db1.get(models.SecurityIncident, iid), db2.get(models.SecurityIncident, iid)
        admin1, admin2 = db1.get(models.User, users["admin"].id), db2.get(models.User, users["admin"].id)
        assert incidents.act(db1, st, inc1, admin1, "revoke_session", "Account takeover confirmed")["status"] == "session_revoked"
        with pytest.raises(ApiError) as e:
            incidents.act(db2, st, inc2, admin2, "unblock_session", "Looks genuine to me")
        assert e.value.status == 409
    assert len(analyst.get("/api/admin/incidents?status=resolved").json()) == 1


def test_keep_restricted_retains_the_restriction(client, analyst, users, app_ctx):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    assert act(analyst, app_ctx, users, iid, "keep_restricted", reason="Mule account pattern", totp=False).status_code == 200
    assert client.get("/api/bank/overview").status_code == 403
    v = client.get("/api/auth/incident").json()
    assert v["incident"]["status"] == "restriction_retained" and v["next_step"] == "contact_bank"
    assert the_incident(analyst, "resolved")["resolution_reason"] == "Mule account pattern"


def test_revoke_session_terminates_it(client, analyst, users, app_ctx):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    assert act(analyst, app_ctx, users, iid, "revoke_session", reason="Takeover confirmed", totp=False).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/incident").json()["incident"]["status"] == "restriction_retained"
    assert client.get("/api/auth/incident").status_code == 401  # cookie cleared after the final status read


# ---------------------------------------------------------------- user-level clearance and token safety

def test_clear_user_revokes_old_token_and_allows_a_fresh_secure_sign_in(client, analyst, users, app_ctx):
    block_transfer(client, users)
    old_session = client.cookies.get("ss_session")
    iid = the_incident(analyst)["id"]
    r = act(analyst, app_ctx, users, iid, "clear_user", reason="Customer verified at branch with ID")
    assert r.status_code == 200 and r.json()["sessions"][0]["to"] == "revoked"
    assert client.get("/api/bank/overview").status_code == 401  # the old token is never reactivated
    v = client.get("/api/auth/incident").json()
    assert v["incident"]["status"] == "access_restored" and v["next_step"] == "sign_in_again"
    c2 = TestClient(app_ctx, base_url="http://127.0.0.1:8000")
    c2.cookies.set("ss_session", old_session, domain="127.0.0.1", path="/api")
    assert c2.get("/api/auth/me").status_code == 401 and c2.get("/api/bank/overview").status_code == 401
    assert signin(client, app_ctx, users["asha"]).json()["decision"] == "ALLOW"  # fresh session, re-assessed
    assert client.get("/api/bank/overview").status_code == 200


def test_expired_session_cannot_be_unblocked_but_user_can_be_cleared(client, analyst, users, app_ctx, clock):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    clock.set_offset(clock._offset + timedelta(minutes=70))
    analyst_s = analyst.cookies.get("ss_session")
    from app import models
    from app.security import tokens
    with app_ctx.state.ss.SessionLocal() as db:  # the analyst stays signed in across the jump
        s = db.scalar(select(models.Session).where(models.Session.token_hash == tokens.hash_token(analyst_s)))
        s.last_seen, s.expires_at = clock.now(), clock.now() + timedelta(minutes=60)
        db.commit()
    d = analyst.get(f"/api/admin/incidents/{iid}").json()
    assert d["sessions"][0]["unblock_eligible"] is False
    r = act(analyst, app_ctx, users, iid, "unblock_session")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SESSION_NOT_ELIGIBLE"
    assert act(analyst, app_ctx, users, iid, "clear_user").json()["status"] == "user_cleared"
    assert client.get("/api/bank/overview").status_code == 401


def test_session_whose_sign_in_was_blocked_is_never_restored(client, analyst, users, app_ctx, clock):
    login_block(client, users, app_ctx, clock)
    from app import models
    from app.security import tokens
    with app_ctx.state.ss.SessionLocal() as db:
        s = db.scalar(select(models.Session).where(models.Session.token_hash == tokens.hash_token(analyst.cookies.get("ss_session"))))
        s.last_seen, s.expires_at = clock.now(), clock.now() + timedelta(minutes=60)
        db.commit()
    iid = the_incident(analyst)["id"]
    assert the_incident(analyst)["checkpoint"] == "login"
    r = act(analyst, app_ctx, users, iid, "unblock_session")
    assert r.status_code == 409 and "never verified" in r.json()["error"]["message"]


def test_no_automatic_clearance_on_re_login(client, analyst, users):
    block_transfer(client, users)
    client.cookies.delete("ss_session", domain="127.0.0.1", path="/api")
    assert signin(client, client.app, users["asha"]).status_code == 200
    assert the_incident(analyst)["status"] == "pending_review"


# ---------------------------------------------------------------- behaviour after clearance

def test_new_suspicious_activity_after_clearance_opens_a_new_incident(client, analyst, users, app_ctx):
    payee = block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    act(analyst, app_ctx, users, iid, "unblock_session").raise_for_status()
    r = client.post("/api/bank/transfers", json={"beneficiary_id": payee, "amount_paise": BIG,
                                                 "idempotency_key": str(uuid.uuid4())}, headers=csrf(client))
    assert r.status_code == 403 and r.json()["error"]["code"] == "RISK_BLOCKED"  # clearance is not a whitelist
    new = the_incident(analyst)
    assert new["id"] != iid and new["status"] == "pending_review"
    assert client.get("/api/auth/incident").json()["incident"]["id"] == new["id"]


def test_reviewed_attempts_stop_counting_as_velocity_but_unreviewed_ones_still_count(client, analyst, users, app_ctx):
    from app import models
    payee = block_transfer(client, users)
    st = app_ctx.state.ss

    def login_velocity():
        client.cookies.delete("ss_session", domain="127.0.0.1", path="/api")
        signin(client, app_ctx, users["asha"])
        with st.SessionLocal() as db:
            a = db.scalar(select(models.RiskAssessment).where(models.RiskAssessment.checkpoint == "login")
                          .order_by(models.RiskAssessment.id.desc()).limit(1))
            return a.features["txn_velocity_ratio"]

    with_attempt = login_velocity()
    client.cookies.delete("ss_session", domain="127.0.0.1", path="/api")
    block_transfer(client, users, payee=payee)
    iid = the_incident(analyst)["id"]
    act(analyst, app_ctx, users, iid, "clear_user").raise_for_status()
    after = login_velocity()
    assert after < with_attempt  # adjudicated attempts no longer inflate behaviour
    with st.SessionLocal() as db:  # and the evidence is still there
        rows = db.scalars(select(models.HistoryEvent).where(models.HistoryEvent.event_type == "transfer",
                                                            models.HistoryEvent.outcome == "reviewed")).all()
        assert len(rows) == 2
        assert all(t.status == "restricted" for t in db.scalars(select(models.Transaction).where(
            models.Transaction.amount_paise == BIG)).all())


def test_replayed_blocked_transfer_is_not_reassessed_or_executed(client, analyst, users, app_ctx):
    from app import models
    key = str(uuid.uuid4())
    payee = block_transfer(client, users, key=key)
    act(analyst, app_ctx, users, the_incident(analyst)["id"], "unblock_session").raise_for_status()
    q = select(models.HistoryEvent).where(models.HistoryEvent.event_type == "transfer", models.HistoryEvent.outcome.is_not(None))
    with app_ctx.state.ss.SessionLocal() as db:
        n = len(db.scalars(q).all())
    r = client.post("/api/bank/transfers", json={"beneficiary_id": payee, "amount_paise": BIG, "idempotency_key": key},
                    headers=csrf(client))
    assert r.status_code == 403  # a retried blocked transfer stays blocked
    with app_ctx.state.ss.SessionLocal() as db:
        assert len(db.scalars(q).all()) == n  # and does not add a velocity event
    assert client.get("/api/bank/overview").status_code == 200  # nor re-restrict the restored session


# ---------------------------------------------------------------- trusted-device verification request

def test_request_verification_shows_number_and_records_evidence_without_unlocking(client, analyst, users, app_ctx):
    block_transfer(client, users)
    iid = the_incident(analyst)["id"]
    r = act(analyst, app_ctx, users, iid, "request_verification", reason="Ask customer to confirm on phone", totp=False)
    assert r.json()["status"] == "verification_requested"
    v = client.get("/api/auth/incident").json()
    assert v["incident"]["status"] == "verification_required" and v["next_step"] == "verify"
    number = v["incident"]["verification"]["number_match"]
    key = users["asha"].device_key
    p = client.get("/api/device/pending", headers={"X-Device-Key": key}).json()
    assert p and p[0]["operation"] == "incident_verify"
    ok = client.post("/api/device/respond", json={"challenge_id": p[0]["id"], "selected_number": number, "approve": True},
                     headers={"X-Device-Key": key})
    assert ok.json()["status"] == "approved"
    inc = the_incident(analyst)
    assert inc["status"] == "pending_review" and inc["verification"] == "approved" and inc["unread"]
    assert client.get("/api/bank/overview").status_code == 403  # evidence only; the analyst still decides


# ---------------------------------------------------------------- Scenario Lab

def test_lab_incidents_are_flagged_and_reset_clears_them(client, users, app_ctx, tmp_path):
    import shutil
    st = app_ctx.state.ss
    with st.SessionLocal() as db:
        from app.services import clock
        _ = clock.now()
    db_file = st.settings.database_url.removeprefix("sqlite:///")
    st.engine.dispose()
    shutil.copyfile(db_file, st.settings.seed_snapshot)  # snapshot before any incident exists
    assert login(client, users["admin"]).status_code == 200
    run = client.post("/api/lab/scenarios/takeover_despite_totp/run", json={"params": {"username": "ravi"}},
                      headers=csrf(client)).json()
    assert run["final_decision"] == "BLOCK"
    rows = client.get("/api/admin/incidents?status=all").json()
    assert len(rows) == 1 and rows[0]["is_lab"] is True and rows[0]["username"] == "ravi"
    assert client.post("/api/lab/reset", headers=csrf(client)).status_code == 200
    assert client.get("/api/admin/incidents?status=all").json() == []
    assert client.get("/api/admin/incidents/summary").json()["unread"] == 0
