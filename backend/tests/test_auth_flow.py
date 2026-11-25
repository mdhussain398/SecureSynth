import pyotp

from tests.conftest import csrf, login


def test_wrong_password_is_401(client, users):
    r = client.post("/api/auth/login", json={"username": "asha", "password": "nope"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_unknown_user_gets_same_error_as_wrong_password(client, users):
    r = client.post("/api/auth/login", json={"username": "ghosty", "password": "nope"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_rate_limited_after_five_failures(client, users):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "asha", "password": "bad"})
    r = client.post("/api/auth/login", json={"username": "asha", "password": users["asha"].password})
    assert r.status_code == 429


def test_password_then_totp_gives_normal_session(client, users):
    r = login(client, users["asha"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] in ("ALLOW", "STEP_UP", "BLOCK")
    me = client.get("/api/auth/me").json()
    assert me["username"] == "asha" and me["role"] == "customer"


def test_pre_otp_session_cannot_read_bank(client, users):
    client.post("/api/auth/login", json={"username": "asha", "password": users["asha"].password})
    r = client.get("/api/bank/overview")
    assert r.status_code == 401


def test_session_token_rotated_after_totp(client, users):
    client.post("/api/auth/login", json={"username": "asha", "password": users["asha"].password})
    pre = client.cookies.get("ss_session")
    client.post("/api/auth/totp", json={"code": pyotp.TOTP(users["asha"].totp_secret).now()}, headers=csrf(client))
    assert client.cookies.get("ss_session") != pre


def test_totp_replay_rejected(client, users):
    code = pyotp.TOTP(users["asha"].totp_secret).now()
    assert login(client, users["asha"], code).status_code == 200
    client.post("/api/auth/logout", headers=csrf(client))
    r = login(client, users["asha"], code)
    assert r.status_code == 401
    assert r.json()["error"]["code"] in ("TOTP_REPLAY", "INVALID_TOTP")


def test_totp_without_csrf_header_rejected(client, users):
    client.post("/api/auth/login", json={"username": "asha", "password": users["asha"].password})
    r = client.post("/api/auth/totp", json={"code": pyotp.TOTP(users["asha"].totp_secret).now()})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "CSRF_FAILED"


def test_foreign_origin_rejected_on_mutation(client, users):
    r = client.post("/api/auth/login", json={"username": "asha", "password": users["asha"].password},
                    headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "ORIGIN_REJECTED"


def test_customer_cannot_access_admin(client, users):
    login(client, users["asha"])
    assert client.get("/api/admin/sessions").status_code == 403


def test_logout_invalidates_session(client, users):
    login(client, users["asha"])
    assert client.post("/api/auth/logout", headers=csrf(client)).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_session_expires_after_idle_timeout(client, users, clock):
    login(client, users["asha"])
    clock.advance(minutes=16)
    assert client.get("/api/auth/me").status_code == 401
