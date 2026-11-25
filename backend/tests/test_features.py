import math
from datetime import datetime, timedelta, timezone

from app.risk import features as F

T0 = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _hist(persona_hours, n=40, city="Bengaluru", device="d1", amount=300000):
    ev = []
    for i in range(n):
        ts = T0 + timedelta(days=i, hours=persona_hours[i % len(persona_hours)])
        ev.append({"ts": ts, "type": "login", "device": device, "city": city, "session": f"s{i}"})
        ev.append({"ts": ts + timedelta(minutes=3), "type": "transfer", "device": device, "city": city,
                   "amount": amount, "beneficiary": "b1", "session": f"s{i}"})
    return ev


def test_baseline_uses_only_events_before_assessment_time():
    hist = _hist([9])
    t = T0 + timedelta(days=20)
    base_a = F.build_baseline(F.before(hist, t), home_city="Bengaluru")
    future = hist + [{"ts": t + timedelta(days=1), "type": "login", "device": "evil", "city": "Dubai", "session": "x"}]
    base_b = F.build_baseline(F.before(future, t), home_city="Bengaluru")
    assert base_a == base_b


def test_cold_start_features_are_finite():
    base = F.build_baseline([], home_city="Bengaluru")
    ev = {"ts": T0, "type": "transfer", "device": "d9", "city": "Mumbai", "amount": 500000,
          "beneficiary": "b9", "beneficiary_added_at": None, "secs_since_login": 40}
    feats = F.compute(base, recent=[], event=ev)
    assert set(feats) == set(F.FEATURES)
    assert all(math.isfinite(v) for v in feats.values())


def test_same_login_hour_is_rare_for_day_worker_but_normal_for_night_worker():
    day = F.build_baseline(_hist([9, 10]), home_city="Bengaluru")
    night = F.build_baseline(_hist([1, 2]), home_city="Bengaluru")
    ev = {"ts": T0 + timedelta(days=60, hours=2), "type": "login", "device": "d1", "city": "Bengaluru"}
    assert F.compute(day, [], ev)["hour_rarity"] > F.compute(night, [], ev)["hour_rarity"] + 0.3


def test_impossible_travel_speed_detected():
    base = F.build_baseline(_hist([9]), home_city="Bengaluru")
    last = {"ts": T0 + timedelta(days=50), "type": "login", "device": "d1", "city": "Bengaluru"}
    ev = {"ts": last["ts"] + timedelta(minutes=30), "type": "login", "device": "dX", "city": "London"}
    assert F.compute(base, [last], ev)["travel_speed_kmh"] > 900


def test_transfer_amount_deviation_is_personalised():
    small = F.build_baseline(_hist([9], amount=100000), home_city="Bengaluru")
    large = F.build_baseline(_hist([9], amount=5000000), home_city="Bengaluru")
    ev = {"ts": T0 + timedelta(days=60), "type": "transfer", "device": "d1", "city": "Bengaluru",
          "amount": 4000000, "beneficiary": "b1", "secs_since_login": 200}
    assert F.compute(small, [], ev)["amount_robust_z"] > F.compute(large, [], ev)["amount_robust_z"] + 2
