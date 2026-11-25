import shutil

from tests.conftest import csrf, login


def _admin(client, users):
    assert login(client, users["admin"]).status_code == 200


def test_lab_not_mounted_when_demo_mode_off(tmp_path, clock):
    from cryptography.fernet import Fernet
    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.main import create_app
    app = create_app(Settings(database_url=f"sqlite:///{tmp_path/'x.db'}", fernet_key=Fernet.generate_key().decode(),
                              demo_mode=False))
    with TestClient(app, base_url="http://127.0.0.1:8000") as c:
        assert c.get("/api/lab/scenarios").status_code == 404


def test_lab_requires_admin(client, users):
    login(client, users["asha"])
    assert client.get("/api/lab/scenarios").status_code == 403


def test_lab_rejects_non_loopback_client(app_ctx, users):
    from fastapi.testclient import TestClient
    with TestClient(app_ctx, base_url="http://127.0.0.1:8000", client=("10.0.0.9", 5000)) as c:
        from tests.conftest import TEST_DEVICE_RAW
        c.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
        login(c, users["admin"])
        assert c.get("/api/lab/scenarios").status_code == 403


def test_scenarios_listed_with_editable_params(client, users):
    _admin(client, users)
    sc = client.get("/api/lab/scenarios").json()
    ids = {s["id"] for s in sc}
    assert {"normal_customer", "takeover_despite_totp", "suspicious_after_login", "genuine_traveller"} <= ids


def test_normal_customer_scenario_runs_through_real_api(client, users, app_ctx):
    _admin(client, users)
    r = client.post("/api/lab/scenarios/normal_customer/run", json={"params": {"username": "asha"}}, headers=csrf(client))
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["steps"][0]["http"]["path"] == "/api/auth/login"
    assert run["final_decision"] == "ALLOW"


def test_takeover_scenario_never_moves_money(client, users):
    _admin(client, users)
    run = client.post("/api/lab/scenarios/takeover_despite_totp/run", json={"params": {"username": "asha"}},
                      headers=csrf(client)).json()
    assert run["final_decision"] in ("STEP_UP", "BLOCK")
    assert run["protected_balance_after_paise"] == run["protected_balance_before_paise"]


def test_suspicious_after_login_is_restricted_by_backend(client, users):
    _admin(client, users)
    run = client.post("/api/lab/scenarios/suspicious_after_login/run", json={"params": {"username": "asha"}},
                      headers=csrf(client)).json()
    assert run["steps"][1]["decision"] == "ALLOW"  # TOTP step on recognised browser
    assert run["final_decision"] in ("STEP_UP", "BLOCK")
    assert run["steps"][-1]["http"]["status"] == 403
    assert run["protected_balance_after_paise"] == run["protected_balance_before_paise"]


def test_genuine_traveller_recovers_via_trusted_device(client, users):
    _admin(client, users)
    run = client.post("/api/lab/scenarios/genuine_traveller/run", json={"params": {"username": "asha", "city": "Singapore"}},
                      headers=csrf(client)).json()
    actors = [s["actor"] for s in run["steps"]]
    assert "trusted_device" in actors
    assert run["steps"][-1]["http"]["status"] in (200, 201)


def test_reset_restores_snapshot_and_invalidates_sessions(client, users, app_ctx, tmp_path):
    st = app_ctx.state.ss
    db_file = st.settings.database_url.removeprefix("sqlite:///")
    st.engine.dispose()
    shutil.copyfile(db_file, st.settings.seed_snapshot)
    _admin(client, users)
    client.post("/api/lab/scenarios/normal_customer/run", json={"params": {"username": "asha"}}, headers=csrf(client))
    r = client.post("/api/lab/reset", headers=csrf(client))
    assert r.status_code == 200 and r.json()["ok"] is True
    assert client.get("/api/auth/me").status_code == 401  # old admin session gone with the reset
