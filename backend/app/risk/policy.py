"""Transparent policy contributions (exact additive points) and the decision function."""

RULES = [
    # (rule id, customer-safe category, analyst label, predicate, points)
    ("new_device", "device", "Browser not recognised for this customer", lambda f: f["device_recognised"] == 0, 12),
    ("unfamiliar_location", "location", "Location outside trusted places / travel windows", lambda f: f["city_known"] == 0, 8),
    ("impossible_travel", "location", "Implied travel speed above 900 km/h", lambda f: f["travel_speed_kmh"] > 900, 30),
    ("new_beneficiary_fast_transfer", "payee", "Transfer to a payee added < 10 min ago", lambda f: f["sensitive_seq"] == 1, 20),
    ("amount_beyond_usual", "amount", "Amount far above this customer's usual range", lambda f: f["amount_robust_z"] > 3, 15),
    ("recent_auth_failures", "signin", "Multiple failed sign-ins in 24 h", lambda f: f["failed_auth_24h"] >= 2, 8),
    ("verified_travel_window", "travel", "Customer verified this trip on their trusted device",
     lambda f: f.get("travel_window_active", 0) == 1, -15),
]

CATEGORY_TEXT = {
    "device": "a browser we don't recognise", "location": "an unfamiliar location", "payee": "a newly added payee",
    "amount": "an unusually large amount", "signin": "recent failed sign-in attempts",
    "travel": "a verified trip",
}


def contributions(f: dict) -> list[dict]:
    return [{"rule": r, "label": lab, "points": float(p), "category": cat}
            for r, cat, lab, pred, p in RULES if pred(f)]


def hard_block(f: dict) -> bool:
    sensitive = f["is_transfer"] == 1 or f["is_beneficiary_add"] == 1
    return sensitive and f["travel_speed_kmh"] > 900 and f["device_recognised"] == 0


def score(ml_index: float, w_ml: float, contribs: list[dict]) -> float:
    return float(min(max(w_ml * ml_index + sum(c["points"] for c in contribs), 0.0), 100.0))


def decide(score_value: float, t_step: float, t_block: float, hard: bool) -> str:
    if hard or score_value >= t_block:
        return "BLOCK"
    if score_value >= t_step:
        return "STEP_UP"
    return "ALLOW"


RANK = {"ALLOW": 0, "STEP_UP": 1, "BLOCK": 2}


def customer_message(decision: str, contribs: list[dict]) -> str:
    if decision == "ALLOW":
        return "Welcome back."
    cats = []
    for c in contribs:
        if c["points"] > 0 and c["category"] not in cats:
            cats.append(c["category"])
    why = " and ".join(CATEGORY_TEXT[c] for c in cats[:2]) or "activity that differs from your usual pattern"
    if decision == "STEP_UP":
        return f"We noticed {why}. Please approve this on your registered trusted device."
    return f"We noticed {why}. For your protection this session is restricted; verify on your trusted device or contact the bank."
