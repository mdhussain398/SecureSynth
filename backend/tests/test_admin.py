from tests.conftest import csrf, login


def _admin(client, users):
    r = login(client, users["admin"])
    assert r.status_code == 200
    return r


def _asha_session_id(app_ctx, users):
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        return db.query(models.Session).filter_by(user_id=users["asha"].id).order_by(models.Session.created_at.desc()).first().id


def test_session_detail_separates_ml_deviation_policy_and_decision(client, users, app_ctx):
    login(client, users["asha"])
    client.cookies.clear()
    from tests.conftest import TEST_DEVICE_RAW
    client.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
    _admin(client, users)
    sid = _asha_session_id(app_ctx, users)
    d = client.get(f"/api/admin/sessions/{sid}").json()
    a = d["assessments"][0]
    assert d["session"]["user_id"] == users["asha"].id
    assert {"ml", "deviations", "policy", "decision", "thresholds", "features", "ml_weight"} <= set(a)
    assert 0 <= a["ml"]["index"] <= 100


def test_counterfactual_recomputes_real_engine_and_is_labelled_hypothetical(client, users, app_ctx):
    client.cookies.delete("ss_device", domain="127.0.0.1", path="/api")
    login(client, users["asha"])  # unrecognised browser
    client.cookies.clear()
    from tests.conftest import TEST_DEVICE_RAW
    client.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
    _admin(client, users)
    sid = _asha_session_id(app_ctx, users)
    aid = client.get(f"/api/admin/sessions/{sid}").json()["assessments"][0]["id"]
    r = client.post(f"/api/admin/assessments/{aid}/counterfactual",
                    json={"changes": [{"feature": "device_recognised", "value": 1}]}, headers=csrf(client)).json()
    assert r["hypothetical"] is True
    assert r["result"]["score"] <= r["original"]["score"]
    assert all(p["rule"] != "new_device" for p in r["result"]["policy"])


def test_counterfactual_rejects_unknown_feature(client, users, app_ctx):
    _admin(client, users)
    sid = _asha_session_id(app_ctx, users) if False else None
    from app import models
    with app_ctx.state.ss.SessionLocal() as db:
        aid = db.query(models.RiskAssessment).first().id
    r = client.post(f"/api/admin/assessments/{aid}/counterfactual",
                    json={"changes": [{"feature": "__class__", "value": 1}]}, headers=csrf(client))
    assert r.status_code == 422


def test_admin_can_revoke_customer_session(client, users, app_ctx):
    login(client, users["asha"])
    asha_cookies = dict(client.cookies.items())
    client.cookies.clear()
    from tests.conftest import TEST_DEVICE_RAW
    client.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
    _admin(client, users)
    sid = _asha_session_id(app_ctx, users)
    assert client.post(f"/api/admin/sessions/{sid}/revoke", headers=csrf(client)).json()["mode"] == "revoked"


def test_users_and_baseline_views(client, users):
    _admin(client, users)
    rows = client.get("/api/admin/users").json()
    asha = next(u for u in rows if u["username"] == "asha")
    b = client.get(f"/api/admin/users/{asha['id']}/baseline").json()
    assert len(b["trusted"]["hour_profile"]) == 24 and b["version"] == 1


def test_ghost_compare_disabled_by_default(client, users):
    _admin(client, users)
    r = client.get("/api/admin/ghost/abc")
    assert r.status_code == 404 and r.json()["error"]["code"] == "FEATURE_DISABLED"


def test_evaluation_endpoint_serves_report(client, users):
    _admin(client, users)
    r = client.get("/api/admin/evaluation")
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert {a["name"] for a in r.json()["approaches"]} == {"password_totp", "static_rules", "securesynth"}


def test_decision_filter_is_applied_before_limit(client, users, app_ctx):
    from app import models
    from app.services import clock as clk
    _admin(client, users)
    with app_ctx.state.ss.SessionLocal() as db:
        for i in range(5):  # newer ALLOW sessions crowd out an older BLOCK one
            db.add(models.Session(id=f"allow{i}", token_hash=f"t{i}", csrf_hash="c", user_id=users["asha"].id, mode="normal",
                                  created_at=clk.now(), last_seen=clk.now(), expires_at=clk.now()))
            db.add(models.RiskAssessment(session_id=f"allow{i}", user_id=users["asha"].id, checkpoint="login", features={},
                                         deviations=[], ml_raw=0, ml_index=0, ml_weight=0, policy=[], risk_score=1,
                                         decision="ALLOW", thresholds={}, model_version="t", latency_ms=1,
                                         customer_message="", ts=clk.now()))
        from datetime import timedelta
        old = clk.now() - timedelta(hours=2)
        db.add(models.Session(id="blocked1", token_hash="tb", csrf_hash="c", user_id=users["asha"].id, mode="restricted",
                              created_at=old, last_seen=old, expires_at=old))
        db.add(models.RiskAssessment(session_id="blocked1", user_id=users["asha"].id, checkpoint="transfer", features={},
                                     deviations=[], ml_raw=0, ml_index=0, ml_weight=0, policy=[], risk_score=99,
                                     decision="BLOCK", thresholds={}, model_version="t", latency_ms=1,
                                     customer_message="", ts=old))
        db.commit()
    rows = client.get("/api/admin/sessions?decision=BLOCK&limit=3").json()
    assert [r["id"] for r in rows] == ["blocked1"]
