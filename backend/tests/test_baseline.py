import copy
from datetime import timedelta

from app import models
from app.services import baseline as B


def _db(app_ctx):
    return app_ctx.state.ss.SessionLocal()


def _trusted(db, uid):
    db.expire_all()
    return copy.deepcopy(db.get(models.Baseline, uid).trusted), db.get(models.Baseline, uid).version


def test_unverified_new_device_is_never_promoted(app_ctx, users, clock):
    uid = users["asha"].id
    with _db(app_ctx) as db:
        for i in range(10):  # poisoning attempt: many quiet sessions from an attacker browser
            B.observe_session(db, uid, f"atk-{i}", device_ref="dev-999", city="Bengaluru", clean=True)
            clock.advance(hours=12)
        db.commit()
        t, v = _trusted(db, uid)
        assert "dev-999" not in t["devices"] and v == 1
        assert db.get(models.Baseline, uid).rejected_count >= 10


def test_verified_device_needs_clean_sessions_and_time_before_promotion(app_ctx, users, clock):
    uid = users["asha"].id
    with _db(app_ctx) as db:
        B.record_verified(db, uid, "device", "dev-500", challenge_id="c1", session_id="s0")
        B.observe_session(db, uid, "s0", device_ref="dev-500", city="Bengaluru", clean=True)
        assert "dev-500" not in _trusted(db, uid)[0]["devices"]  # not immediately trusted
        B.observe_session(db, uid, "s1", device_ref="dev-500", city="Bengaluru", clean=True)
        B.observe_session(db, uid, "s2", device_ref="dev-500", city="Bengaluru", clean=True)
        assert "dev-500" not in _trusted(db, uid)[0]["devices"]  # clean sessions alone are not enough
        clock.advance(hours=25)
        B.observe_session(db, uid, "s3", device_ref="dev-500", city="Bengaluru", clean=True)
        db.commit()
        t, v = _trusted(db, uid)
        assert "dev-500" in t["devices"] and v == 2


def test_blocked_session_never_contributes(app_ctx, users, clock):
    uid = users["asha"].id
    with _db(app_ctx) as db:
        B.record_verified(db, uid, "device", "dev-501", challenge_id="c2", session_id="s0")
        for i in range(3):
            B.observe_session(db, uid, f"s{i}", device_ref="dev-501", city="Bengaluru", clean=True)
        B.reject_session(db, uid, "s2", device_ref="dev-501")  # s2 later hit BLOCK
        clock.advance(hours=25)
        B.observe_session(db, uid, "s9", device_ref="dev-501", city="Bengaluru", clean=False)
        db.commit()
        assert "dev-501" not in _trusted(db, uid)[0]["devices"]
        item = next(c for c in db.get(models.Baseline, uid).candidate if c["value"] == "dev-501")
        assert item["status"] == "rejected"


def test_verified_travel_creates_time_boxed_window_not_permanent_city(app_ctx, users, clock):
    uid = users["asha"].id
    with _db(app_ctx) as db:
        B.record_verified(db, uid, "city", "Singapore", challenge_id="c3", session_id="s0")
        db.commit()
        t, _ = _trusted(db, uid)
        assert "Singapore" not in t["cities"]
        assert any(w["city"] == "Singapore" for w in t["travel_windows"])


def test_verification_promotes_only_the_bound_attribute(app_ctx, users, clock):
    uid = users["asha"].id
    with _db(app_ctx) as db:
        B.record_verified(db, uid, "device", "dev-600", challenge_id="c4", session_id="s0")
        B.observe_session(db, uid, "s0", device_ref="dev-600", city="Goa", clean=True)  # city NOT verified
        clock.advance(hours=48)
        for i in range(1, 4):
            B.observe_session(db, uid, f"s{i}", device_ref="dev-600", city="Goa", clean=True)
        db.commit()
        t, _ = _trusted(db, uid)
        assert "dev-600" in t["devices"] and "Goa" not in t["cities"]


def test_rollback_restores_exact_prior_baseline(app_ctx, users, clock):
    uid = users["asha"].id
    with _db(app_ctx) as db:
        before, _ = _trusted(db, uid)
        B.record_verified(db, uid, "device", "dev-700", challenge_id="c5", session_id="s0")
        clock.advance(hours=25)
        for i in range(3):
            B.observe_session(db, uid, f"s{i}", device_ref="dev-700", city="Bengaluru", clean=True)
        assert "dev-700" in _trusted(db, uid)[0]["devices"]
        B.rollback(db, uid, to_version=1, actor="analyst")
        db.commit()
        after, v = _trusted(db, uid)
        assert after == before and v == 3


def test_verified_travel_window_gives_transparent_credit():
    from app.risk import policy
    f = {"device_recognised": 1, "city_known": 1, "travel_speed_kmh": 0, "sensitive_seq": 0, "amount_robust_z": 0,
         "failed_auth_24h": 0, "travel_window_active": 1}
    assert any(c["rule"] == "verified_travel_window" and c["points"] == -15 for c in policy.contributions(f))


def test_verified_device_is_provisionally_recognised_but_not_trusted(app_ctx, users, clock):
    from app.risk import engine
    uid = users["asha"].id
    with _db(app_ctx) as db:
        B.record_verified(db, uid, "device", "dev-800", challenge_id="c8", session_id="s0")
        user = db.get(models.User, uid)
        scoring = engine._baseline(db, user)
        assert "dev-800" in scoring["devices"]
        assert "dev-800" not in _trusted(db, uid)[0]["devices"]


def test_rejected_device_is_not_recognised(app_ctx, users, clock):
    from app.risk import engine
    uid = users["asha"].id
    with _db(app_ctx) as db:
        B.record_verified(db, uid, "device", "dev-801", challenge_id="c9", session_id="s0")
        B.reject_session(db, uid, "s0", device_ref="dev-801")
        assert "dev-801" not in engine._baseline(db, db.get(models.User, uid))["devices"]


def test_seeded_history_is_realistic(app_ctx, users):
    with _db(app_ctx) as db:
        t, _ = _trusted(db, users["asha"].id)
        assert max(t["hour_profile"]) < 0.5  # spread across hours, not one fixed minute
        acct = db.query(models.Account).filter_by(user_id=users["asha"].id).one()
        assert db.query(models.Transaction).filter_by(account_id=acct.id, status="completed").count() >= 10
