"""Deterministic synthetic customer histories with legitimate drift and account-takeover families.

All data is synthetic. Labels/families live on the session record for EVALUATION ONLY; feature code
never sees them. Splits are chronological: train days [0,60), validation [60,75), test [75,90).

ATO families:
  A  credential + SIM-swap: new device, distant/foreign city, add payee then drain within minutes
  B  real-time OTP relay: new device, nearby city, odd hour, add payee then large transfer quickly
  C  mid-session hijack: login looks normal (recognised browser, home city) then payee + large transfer
  D  low-and-slow mule (HELD OUT: test split only)
  E  remote-access takeover on the victim's own device
v2 details and rationale: docs/evaluation/EVALUATION_PROTOCOL.md
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np

from app.risk.features import LOCAL_TZ

EPOCH = datetime(2026, 8, 1, tzinfo=LOCAL_TZ)  # persona hours are local (IST)
HOME_CITIES = ["Bengaluru", "Mysuru", "Chikkamagaluru", "Mangaluru", "Chennai", "Hyderabad", "Mumbai", "Pune"]
TRAVEL_CITIES = ["Delhi", "Kolkata", "Kochi", "Goa", "Mumbai", "Hyderabad", "Dubai", "Singapore", "London"]
FOREIGN = ["Lagos", "Moscow", "London", "Dubai", "Singapore"]

# persona: (login hour centres, hour sd, sessions/day, median transfer ₹, p(transfer|session), p(trip per day))
PERSONAS = {
    "salaried":       ([8, 20], 1.5, 1.2, 3000, 0.35, 0.010),
    "student":        ([13, 23], 2.5, 1.5, 600, 0.30, 0.008),
    "traveller":      ([7, 21], 2.0, 1.4, 6000, 0.40, 0.060),
    "business_owner": ([11, 16], 2.0, 2.0, 40000, 0.60, 0.020),
    "retiree":        ([10], 1.5, 0.5, 5000, 0.30, 0.005),
    "night_shift":    ([2, 23], 1.5, 1.1, 2500, 0.35, 0.010),
    "family_sender":  ([9, 19], 2.0, 0.7, 15000, 0.25, 0.010),
}
SPLITS = (("train", 0, 60), ("val", 60, 75), ("test", 75, 90))


@dataclass
class Dataset:
    users: list[dict]
    sessions: list[dict] = field(default_factory=list)


def split_of(day: int) -> str:
    for name, lo, hi in SPLITS:
        if lo <= day < hi:
            return name
    return "test"


def generate(seed: int = 2026, n_customers: int = 240, days: int = 90) -> Dataset:
    rng = np.random.default_rng(seed)
    personas = list(PERSONAS)
    users = []
    for i in range(n_customers):
        p = personas[i % len(personas)]
        users.append({"user_id": i + 1, "persona": p, "home_city": HOME_CITIES[int(rng.integers(len(HOME_CITIES)))]})
    ds = Dataset(users=users)
    for u in users:
        ds.sessions.extend(_customer(rng, u, days))
    ds.sessions.sort(key=lambda s: (s["login_ts"], s["session_ref"]))
    return ds


def _hour(rng, centres, sd):
    return int(round(rng.choice(centres) + rng.normal(0, sd))) % 24


def _amount(rng, median_rupees, scale=1.0):
    return int(max(100, rng.lognormal(np.log(median_rupees * scale), 0.6)) * 100)  # paise


def _customer(rng, u, days):
    """Legitimate behaviour v2 (see docs/evaluation/EVALUATION_PROTOCOL.md): overlapping, drifting, sometimes messy."""
    centres, sd, rate, med, p_tx, p_trip = PERSONAS[u["persona"]]
    centres = list(centres)
    uid = u["user_id"]
    devices = [f"u{uid}-d1"]
    family_laptop = f"u{uid}-fam"
    bens = [f"u{uid}-b{k}" for k in range(int(rng.integers(3, 7)))]
    phone_change_day = int(rng.integers(15, days)) if rng.random() < 0.30 else None
    grows = rng.random() < 0.30
    shift_day = int(rng.integers(20, days)) if (u["persona"] in ("night_shift", "salaried") and rng.random() < 0.10) else None
    trip = None
    sessions, n = [], 0
    for day in range(days):
        if phone_change_day == day:
            devices = [f"u{uid}-d2"]
        if shift_day == day:
            centres = [(c + 6) % 24 for c in centres]
        if trip is None and rng.random() < p_trip:
            pool = TRAVEL_CITIES if rng.random() < 0.6 else [c for c in HOME_CITIES if c != u["home_city"]]
            trip = (pool[int(rng.integers(len(pool)))], day + int(rng.integers(2, 7)))
        if trip and day > trip[1]:
            trip = None
        city = trip[0] if trip else u["home_city"]
        day_med = med * (1.01 ** (day / 7) if grows else 1.0)
        for _ in range(int(rng.poisson(rate))):
            ts = EPOCH + timedelta(days=day, hours=_hour(rng, centres, sd), minutes=int(rng.integers(60)))
            n += 1
            dev = family_laptop if rng.random() < 0.05 else devices[0]
            failed = int(rng.integers(1, 3)) if rng.random() < 0.03 else 0
            ev = [{"type": "login", "ts": ts, "device": dev, "city": city, "failed_auth_24h": failed}]
            t = ts
            if rng.random() < p_tx:
                if rng.random() < 0.04:  # legitimate new payee
                    nb = f"u{uid}-b{len(bens)}"
                    t = t + timedelta(minutes=int(rng.integers(1, 30)))
                    ev.append({"type": "beneficiary_add", "ts": t, "device": dev, "city": city, "beneficiary": nb})
                    bens.append(nb)
                    gap = int(rng.integers(1, 9)) if rng.random() < 0.30 else int(rng.integers(5, 240))
                    t = t + timedelta(minutes=gap)
                    ev.append({"type": "transfer", "ts": t, "device": dev, "city": city, "beneficiary": nb,
                               "amount": _amount(rng, day_med), "beneficiary_added_at": ev[-1]["ts"]})
                else:
                    scale = rng.choice([1.0, 6.0, 15.0], p=[0.96, 0.03, 0.01])
                    t = t + timedelta(minutes=int(rng.integers(1, 20)))
                    ev.append({"type": "transfer", "ts": t, "device": dev, "city": city,
                               "beneficiary": bens[int(rng.integers(len(bens)))], "amount": _amount(rng, day_med, scale)})
            if trip:
                kind = "traveller"
            elif dev not in (devices[0],) or (phone_change_day is not None and phone_change_day <= day < phone_change_day + 3):
                kind = "new_device"
            else:
                kind = "normal"
            sessions.append(_session(uid, n, ts, ev, "legit", None, split_of(day), kind))
    for split, lo, hi in SPLITS[1:]:
        fams = ["A", "B", "C", "E"] + (["D"] if split == "test" else [])
        for fam in fams:
            if rng.random() < 0.30:
                day = int(rng.integers(lo, hi))
                n += 1
                sessions.extend(_attack(rng, u, uid, n, day, fam, med, devices, bens, split, centres))
    return sessions


def _session(uid, n, ts, events, label, family, split, kind):
    ref = f"u{uid}-s{n}"
    t0 = events[0]["ts"]
    for e in events:
        e["session"] = ref
        e["secs_since_login"] = (e["ts"] - t0).total_seconds()
    return {"session_ref": ref, "user_id": uid, "login_ts": ts, "events": events, "label": label,
            "attack_family": family, "split": split, "kind": kind}


def _attack(rng, u, uid, n, day, fam, med, devices, bens, split, centres):
    """Attack families v2 (see docs/evaluation/EVALUATION_PROTOCOL.md)."""
    victim_hour = lambda: _hour(rng, centres, PERSONAS[u["persona"]][1])
    new_dev = f"atk-{uid}-{n}"
    mule = f"mule-{uid}-{n}"
    pay_existing = False
    failed = 0
    if fam == "A":
        city = FOREIGN[int(rng.integers(len(FOREIGN)))] if rng.random() < 0.5 else \
            [c for c in HOME_CITIES if c != u["home_city"]][int(rng.integers(len(HOME_CITIES) - 1))]
        dev, hour = new_dev, int(rng.integers(24))
        gap1, gap2, scale = rng.integers(20, 120), rng.integers(10, 90), rng.uniform(8, 25)
        failed = int(rng.integers(0, 4))
    elif fam == "B":
        city = u["home_city"] if rng.random() < 0.5 else HOME_CITIES[int(rng.integers(len(HOME_CITIES)))]
        dev = new_dev
        hour = victim_hour() if rng.random() < 0.6 else int(rng.integers(24))
        gap1, gap2, scale = rng.integers(15, 90), rng.integers(10, 60), rng.uniform(3, 10)
    elif fam == "C":
        city, dev, hour = u["home_city"], devices[0], victim_hour()
        gap1, gap2, scale = rng.integers(300, 1800), rng.integers(20, 120), rng.uniform(3, 8)
        pay_existing = rng.random() < 0.5
    elif fam == "E":
        city, dev, hour = u["home_city"], devices[0], victim_hour()
        gap1, gap2, scale = rng.integers(60, 600), rng.integers(1800, 10800), rng.uniform(1, 4)
    else:  # D low-and-slow, held out of validation
        city = u["home_city"]
        dev = devices[0] if rng.random() < 0.5 else new_dev
        hour = victim_hour()
        gap1, gap2, scale = rng.integers(120, 900), rng.integers(1200, 7200), rng.uniform(0.5, 1.5)
    ts = EPOCH + timedelta(days=day, hours=hour, minutes=int(rng.integers(60)))
    t1 = ts + timedelta(seconds=int(gap1))
    t2 = t1 + timedelta(seconds=int(gap2))
    amt = _amount(rng, med, scale)
    ev = [{"type": "login", "ts": ts, "device": dev, "city": city, "failed_auth_24h": failed}]
    if pay_existing:
        ev.append({"type": "transfer", "ts": t2, "device": dev, "city": city,
                   "beneficiary": bens[int(rng.integers(len(bens)))], "amount": amt})
    else:
        ev += [{"type": "beneficiary_add", "ts": t1, "device": dev, "city": city, "beneficiary": mule},
               {"type": "transfer", "ts": t2, "device": dev, "city": city, "beneficiary": mule, "amount": amt,
                "beneficiary_added_at": t1}]
    return [_session(uid, n, ts, ev, "ato", fam, split, f"ato_{fam}")]
