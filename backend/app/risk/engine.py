"""Live risk engine: personalised features → Isolation Forest index + transparent policy → decision.

Scoring uses the TRUSTED baseline only (never raw recent behaviour), so new behaviour cannot silently
re-train the customer's profile (poison resistance). Raw history is used only for velocity/travel context.
"""
import math
import time
from datetime import timezone

import numpy as np
from sqlalchemy import select

from app import models
from app.risk import features as F
from app.risk import policy
from app.services import clock

MODEL_VERSION = "not-loaded"


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _history(db, user_id: int, now, limit: int = 60) -> list[dict]:
    rows = db.scalars(select(models.HistoryEvent).where(models.HistoryEvent.user_id == user_id)
                      .order_by(models.HistoryEvent.ts.desc()).limit(limit)).all()
    out = []
    for r in reversed(rows):
        ts = _aware(r.ts)
        if ts < now:
            out.append({"ts": ts, "type": r.event_type, "device": r.device_ref, "city": r.city,
                        "amount": r.amount_paise, "beneficiary": r.beneficiary_ref, "session": r.session_ref})
    return out


def _baseline(db, user) -> dict:
    """Scoring view: the trusted baseline plus devices that passed independent trusted-device verification
    and have not been rejected. They count as recognised for scoring but are NOT in the trusted baseline
    until promotion (clean sessions + time), and are dropped if any session on them is blocked."""
    b = db.get(models.Baseline, user.id)
    if b is None:
        return F.build_baseline([], home_city=user.home_city)
    view = dict(b.trusted)
    verified = [c["value"] for c in (b.candidate or [])
                if c["kind"] == "device" and c.get("verified_by") and c.get("status") == "pending"]
    view["devices"] = sorted(set(b.trusted["devices"]) | set(verified))
    return view


def build_event(db, session: models.Session, checkpoint: str, pending_op: dict | None, now) -> dict:
    ev = {"ts": now, "type": "login" if checkpoint == "login" else checkpoint,
          "device": f"dev-{session.device_id}", "city": session.city or "",
          "secs_since_login": (now - _aware(session.created_at)).total_seconds(),
          "failed_auth_24h": int((session.context or {}).get("failed_auth_24h", 0))}
    if pending_op and checkpoint == "transfer":
        ben = db.get(models.Beneficiary, pending_op["beneficiary_id"])
        ev.update(amount=pending_op["amount_paise"], beneficiary=f"ben-{ben.id}",
                  beneficiary_added_at=_aware(ben.created_at))
    elif pending_op and checkpoint == "beneficiary_add":
        ev.update(beneficiary=f"new:{pending_op['account_ref']}")
    return ev


def explain(f: dict, base: dict, ev: dict) -> list[dict]:
    """Observed differences from the trusted baseline (descriptive; NOT Isolation Forest attributions)."""
    out = []

    def add(feature, observed, baseline, sev):
        out.append({"feature": feature, "label": F.LABELS.get(feature, feature), "observed": observed,
                    "baseline": baseline, "severity": sev})

    if f["device_recognised"] == 0:
        add("device_recognised", "Browser not seen before", f"{len(base['devices'])} recognised browser(s)", "high")
    if f["hour_rarity"] > 0.5:
        top = sorted(range(24), key=lambda h: -base["hour_profile"][h])[:2]
        add("hour_rarity", f"{F.local_hour(ev['ts']):02d}:00 IST", "usually " + " / ".join(f"{h:02d}:00" for h in sorted(top)),
            "high" if f["hour_rarity"] > 0.85 else "medium")
    if f["city_known"] == 0:
        add("city_known", ev["city"] or "unknown", "trusted: " + ", ".join(base["cities"][:3]), "medium")
    if f["travel_speed_kmh"] > 0:
        add("travel_speed_kmh", f"{f['travel_speed_kmh']:.0f} km/h", "≤ 900 km/h is physically plausible",
            "high" if f["travel_speed_kmh"] > 900 else "low")
    if f["amount_robust_z"] > 1.5:
        typical = math.exp(base["amount_log_median"]) / 100
        add("amount_robust_z", f"₹{ev['amount'] / 100:,.0f}", f"typical ₹{typical:,.0f}",
            "high" if f["amount_robust_z"] > 3 else "medium")
    if f["beneficiary_new"] == 1:
        add("beneficiary_new", "Payee not in trusted list", f"{len(base['beneficiaries'])} trusted payee(s)", "medium")
    if f["sensitive_seq"] == 1:
        add("sensitive_seq", f"Paid {math.expm1(f['log_secs_login_to_sensitive']):.0f} s after sign-in to a payee added minutes ago",
            "established payees, unhurried", "high")
    if f["txn_velocity_ratio"] > 3:
        add("txn_velocity_ratio", f"{f['txn_velocity_ratio']:.1f}× usual daily rate", "≈1×", "medium")
    return out


def score_features(model, f: dict) -> tuple[float, float, list[dict], float, str]:
    x = np.array([[f[c] for c in F.FEATURES]])
    raw = float(model.raw(x)[0])
    idx = float(model.index(np.array([raw]))[0])
    contribs = policy.contributions(f)
    s = policy.score(idx, model.w_ml, contribs)
    return raw, idx, contribs, s, policy.decide(s, model.t_step, model.t_block, policy.hard_block(f))


def assess(db, st, session: models.Session, user: models.User, checkpoint: str,
           pending_op: dict | None = None) -> models.RiskAssessment:
    t0 = time.perf_counter()
    now = clock.now()
    base = _baseline(db, user)
    ev = build_event(db, session, checkpoint, pending_op, now)
    f = F.compute(base, _history(db, user.id, now), ev)
    raw, idx, contribs, s, decision = score_features(st.model, f)
    a = models.RiskAssessment(
        session_id=session.id, user_id=user.id, checkpoint=checkpoint, features={k: round(v, 4) for k, v in f.items()},
        deviations=explain(f, base, ev), ml_raw=round(raw, 5), ml_index=round(idx, 2), ml_weight=st.model.w_ml,
        policy=contribs, risk_score=round(s, 2), decision=decision,
        thresholds={"step_up": st.model.t_step, "block": st.model.t_block}, model_version=st.model.version,
        latency_ms=round((time.perf_counter() - t0) * 1000, 3),
        customer_message=policy.customer_message(decision, contribs), ts=now)
    db.add(a)
    db.add(models.HistoryEvent(user_id=user.id, session_ref=session.id, ts=now, event_type=ev["type"],
                               device_ref=ev["device"], city=ev["city"], amount_paise=ev.get("amount"),
                               beneficiary_ref=ev.get("beneficiary"), seconds_since_login=ev["secs_since_login"]))
    db.flush()
    session.risk_current = a.risk_score
    if db.get(models.Baseline, user.id) is not None:
        from app.services import baseline
        if decision == "BLOCK":
            baseline.reject_session(db, user.id, session.id, device_ref=ev["device"])
        else:
            baseline.observe_session(db, user.id, session.id, device_ref=ev["device"], city=ev["city"],
                                     clean=decision == "ALLOW" and session.mode == "normal")
    return a
