"""Personalised deviation features — ONE implementation shared by training (ml/) and live serving (app/).

Leakage rule (A3): callers pass only history strictly before the assessment time (`before()`).
Device recognition is a behavioural signal, not proof of identity (A1).
"""
import math
from datetime import datetime, timedelta, timezone

import numpy as np

CITY_COORDS = {  # synthetic geography (lat, lon)
    "Bengaluru": (12.97, 77.59), "Mysuru": (12.30, 76.64), "Chikkamagaluru": (13.32, 75.77),
    "Mangaluru": (12.91, 74.86), "Chennai": (13.08, 80.27), "Hyderabad": (17.39, 78.49),
    "Mumbai": (19.08, 72.88), "Pune": (18.52, 73.86), "Delhi": (28.61, 77.21), "Kolkata": (22.57, 88.36),
    "Kochi": (9.93, 76.27), "Goa": (15.30, 74.12), "Dubai": (25.20, 55.27), "Singapore": (1.35, 103.82),
    "London": (51.51, -0.13), "Lagos": (6.52, 3.38), "Moscow": (55.76, 37.62),
}

FEATURES = [
    "device_recognised", "hour_rarity", "city_known", "log_km_from_home", "travel_speed_kmh",
    "amount_robust_z", "txn_velocity_ratio", "beneficiary_new", "beneficiary_fresh",
    "log_secs_login_to_sensitive", "sensitive_seq", "failed_auth_24h", "is_transfer", "is_beneficiary_add",
    "travel_window_active",
]

LABELS = {
    "device_recognised": "Recognised browser", "hour_rarity": "Unusual time of day",
    "city_known": "Familiar location", "log_km_from_home": "Distance from home",
    "travel_speed_kmh": "Implied travel speed", "amount_robust_z": "Amount vs usual",
    "txn_velocity_ratio": "Transfer frequency vs usual", "beneficiary_new": "New payee",
    "beneficiary_fresh": "Payee added minutes ago", "log_secs_login_to_sensitive": "Speed from sign-in to action",
    "sensitive_seq": "Add-payee-then-transfer sequence", "failed_auth_24h": "Recent failed sign-ins",
    "travel_window_active": "Inside a verified travel window",
}

NEUTRAL_SECS = 900.0
LOCAL_TZ = timezone(timedelta(hours=5, minutes=30), "IST")  # behavioural hours are customer-local (India)


def local_hour(ts: datetime) -> int:
    return ts.astimezone(LOCAL_TZ).hour


def km(a: str, b: str) -> float:
    if a == b or a not in CITY_COORDS or b not in CITY_COORDS:
        return 0.0
    (la1, lo1), (la2, lo2) = CITY_COORDS[a], CITY_COORDS[b]
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2 - lo1)
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def before(events: list[dict], t: datetime) -> list[dict]:
    return [e for e in events if e["ts"] < t]


def build_baseline(history: list[dict], home_city: str, min_device_sessions: int = 2) -> dict:
    """Trusted behavioural baseline from (already-trusted) history. Pure function of its inputs."""
    hours = np.ones(24)  # Laplace smoothing
    device_sessions: dict[str, set] = {}
    cities = {home_city}
    amounts, bens = [], set()
    days = set()
    n_transfers = 0
    for e in history:
        days.add(e["ts"].date())
        if e["type"] == "login":
            hours[local_hour(e["ts"])] += 1
            device_sessions.setdefault(e["device"], set()).add(e.get("session"))
            cities.add(e["city"])
        elif e["type"] == "transfer":
            amounts.append(math.log(max(e["amount"], 100)))
            bens.add(e["beneficiary"])
            n_transfers += 1
        elif e["type"] == "beneficiary_add":
            bens.add(e["beneficiary"])
    med = float(np.median(amounts)) if amounts else math.log(250000)
    mad = float(np.median(np.abs(np.array(amounts) - med))) if amounts else 1.0
    return {
        "home_city": home_city,
        "devices": sorted(d for d, s in device_sessions.items() if len(s) >= min_device_sessions),
        "cities": sorted(cities),
        "travel_windows": [],
        "hour_profile": [round(float(x), 6) for x in hours / hours.sum()],
        "amount_log_median": round(med, 6),
        "amount_log_mad": round(mad, 6),
        "beneficiaries": sorted(bens),
        "daily_txn_rate": round(n_transfers / max(len(days), 1), 6),
    }


def _hour_rarity(profile: list[float], hour: int) -> float:
    p = profile[hour] + 0.5 * (profile[(hour - 1) % 24] + profile[(hour + 1) % 24])
    peak = max(profile[h] + 0.5 * (profile[(h - 1) % 24] + profile[(h + 1) % 24]) for h in range(24))
    return float(1.0 - min(p / peak, 1.0))


def compute(baseline: dict, recent: list[dict], event: dict) -> dict[str, float]:
    """Feature vector for `event` given the trusted baseline and recent raw events (all before event.ts)."""
    ts, etype = event["ts"], event["type"]
    city = event.get("city", baseline["home_city"])
    windows = {w["city"] for w in baseline.get("travel_windows", []) if w["until"] > ts.isoformat()}
    known_cities = set(baseline["cities"]) | windows
    last = max((e for e in recent if e["type"] == "login" and e["ts"] < ts), key=lambda e: e["ts"], default=None)
    speed = 0.0
    if last is not None and last.get("city") and city != last["city"]:
        hrs = max((ts - last["ts"]).total_seconds() / 3600, 1 / 60)
        speed = min(km(last["city"], city) / hrs, 5000.0)
    is_transfer = etype == "transfer"
    is_ben = etype == "beneficiary_add"
    amount_z = 0.0
    if is_transfer:
        z = (math.log(max(event["amount"], 100)) - baseline["amount_log_median"]) / (
            1.4826 * baseline["amount_log_mad"] + 0.25)
        amount_z = float(max(min(z, 12.0), -4.0))
    day_ago = [e for e in recent if e["type"] == "transfer" and 0 <= (ts - e["ts"]).total_seconds() < 86400]
    velocity = (len(day_ago) + (1 if is_transfer else 0)) / max(baseline["daily_txn_rate"], 0.3)
    ben = event.get("beneficiary")
    ben_new = float((is_transfer or is_ben) and ben is not None and ben not in baseline["beneficiaries"])
    added = event.get("beneficiary_added_at")
    ben_fresh = float(is_transfer and added is not None and (ts - added).total_seconds() < 3600)
    secs = event.get("secs_since_login")
    log_secs = math.log1p(secs if (secs is not None and (is_transfer or is_ben)) else NEUTRAL_SECS)
    seq = float(is_transfer and ben_fresh == 1.0 and secs is not None and secs < 600)
    return {
        "device_recognised": float(event.get("device") in baseline["devices"]),
        "hour_rarity": _hour_rarity(baseline["hour_profile"], local_hour(ts)),
        "city_known": float(city in known_cities),
        "log_km_from_home": math.log1p(km(baseline["home_city"], city)),
        "travel_speed_kmh": speed,
        "amount_robust_z": amount_z,
        "txn_velocity_ratio": float(min(velocity, 20.0)),
        "beneficiary_new": ben_new,
        "beneficiary_fresh": ben_fresh,
        "log_secs_login_to_sensitive": log_secs,
        "sensitive_seq": seq,
        "failed_auth_24h": float(min(event.get("failed_auth_24h", 0), 10)),
        "is_transfer": float(is_transfer),
        "is_beneficiary_add": float(is_ben),
        "travel_window_active": float(city in windows and city not in baseline["cities"]),
    }
