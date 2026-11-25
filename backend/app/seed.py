"""Synthetic fixtures. Every identity, balance and account ref here is fictional (SYN- prefix)."""
import secrets
from datetime import timedelta

import pyotp

from app import models
from app.security import passwords, tokens
from app.services import clock


def create_user(db, box, *, username, password, role, display_name, persona, home_city, balance_paise):
    totp_secret = pyotp.random_base32()
    device_key = secrets.token_urlsafe(24)
    u = models.User(
        username=username, display_name=display_name, role=role,
        password_hash=passwords.hash_password(password), totp_secret_enc=box.encrypt(totp_secret),
        device_key_hash=tokens.hash_token(device_key), persona=persona, home_city=home_city,
        created_at=clock.now() - timedelta(days=400),
    )
    db.add(u)
    db.flush()
    db.add(models.Account(user_id=u.id, account_ref=f"SYN-{1000 + u.id:04d}", balance_paise=balance_paise))
    db.flush()
    return u, totp_secret, device_key


def add_beneficiary(db, user_id, name, account_ref, age_days=0, trust="trusted"):
    b = models.Beneficiary(user_id=user_id, name=name, account_ref=account_ref,
                           created_at=clock.now() - timedelta(days=age_days), trust=trust)
    db.add(b)
    db.flush()
    return b


def _device_ref(device_id: int) -> str:
    return f"dev-{device_id}"


def _ben_ref(ben_id: int) -> str:
    return f"ben-{ben_id}"


def seed_history(db, user, *, device_raw: str, days: int = 45, login_hour: int = 9, amount_paise: int = 3_000_00):
    """Give a customer an established, consistent history: one recognised browser, home city, a regular payee.
    Builds the trusted baseline from that history (the same build_baseline used in training)."""
    from app.risk import features as F
    from app.security import tokens

    now = clock.now()
    dev = models.Device(user_id=user.id, token_hash=tokens.hash_token(device_raw), label="Home laptop",
                        first_seen=now - timedelta(days=days + 1), last_seen=now - timedelta(days=1), trust="trusted")
    db.add(dev)
    db.flush()
    ben = add_beneficiary(db, user.id, "Landlord Synth", f"SYN-{8000 + user.id:04d}", age_days=days + 2)
    import numpy as np
    from ml.generate import PERSONAS
    rng = np.random.default_rng(1000 + user.id)  # deterministic per customer; same spread as ml/generate.py
    centres, sd = (PERSONAS[user.persona][:2] if user.persona in PERSONAS else ([login_hour], 1.5))
    events = []
    for d in range(days, 0, -1):
        hour = int(round(rng.choice(centres) + rng.normal(0, sd))) % 24  # persona spread, like ml/generate.py
        ts = (now - timedelta(days=d)).astimezone(F.LOCAL_TZ).replace(hour=hour, minute=int(rng.integers(60)),
                                                                       second=0, microsecond=0)
        ref = f"hist-{user.id}-{d}"
        events.append({"ts": ts, "type": "login", "device": _device_ref(dev.id), "city": user.home_city, "session": ref})
        if d % 2 == 0:
            events.append({"ts": ts + timedelta(minutes=4), "type": "transfer", "device": _device_ref(dev.id),
                           "city": user.home_city, "amount": int(amount_paise * float(np.exp(rng.normal(0, 0.6)))),
                           "beneficiary": _ben_ref(ben.id), "session": ref, "secs_since_login": 240.0})
    for e in events:
        db.add(models.HistoryEvent(user_id=user.id, session_ref=e["session"], ts=e["ts"], event_type=e["type"],
                                   device_ref=e["device"], city=e["city"], amount_paise=e.get("amount"),
                                   beneficiary_ref=e.get("beneficiary"), seconds_since_login=e.get("secs_since_login")))
    acct = db.scalar(__import__("sqlalchemy").select(models.Account).where(models.Account.user_id == user.id))
    for e in events:  # visible statement history matching the behavioural history
        if e["type"] == "transfer" and acct is not None:
            db.add(models.Transaction(account_id=acct.id, beneficiary_id=ben.id, amount_paise=e["amount"],
                                      direction="debit", counterparty=ben.name, description="Monthly rent share",
                                      status="completed", created_at=e["ts"]))
    trusted = F.build_baseline(events, home_city=user.home_city)
    db.merge(models.Baseline(user_id=user.id, version=1, trusted=trusted, candidate=[], rejected_count=0, updated_at=now))
    db.add(models.BaselineVersion(user_id=user.id, version=1, snapshot=trusted, diff={"init": "seeded history"},
                                  reason="Initial baseline from synthetic history", ts=now))
    db.flush()
    return dev, ben


def established_payee(db, user_id: int):
    from sqlalchemy import select
    return db.scalar(select(models.Beneficiary).where(models.Beneficiary.user_id == user_id,
                                                      models.Beneficiary.trust == "trusted"))
