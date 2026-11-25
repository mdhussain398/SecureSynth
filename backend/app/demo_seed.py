"""Build the demo database (synthetic customers with established histories) and a pristine snapshot for reset.

Run: python -m app.demo_seed   → securesynth.db, seed.db (snapshot), artifacts/demo_credentials.json (gitignored)
"""
import json
import secrets
import shutil
from pathlib import Path

import pyotp

from app import seed
from app.config import Settings
from app.state import AppState

ROOT = Path(__file__).resolve().parents[1]
CUSTOMERS = [  # (username, display, persona, home city, usual login hour, usual transfer paise, balance paise)
    ("asha", "Asha Rao", "salaried", "Bengaluru", 9, 3_000_00, 1_84_500_00),
    ("ravi", "Ravi Shetty", "night_shift", "Mysuru", 2, 2_500_00, 96_200_00),
    ("meera", "Meera Iyer", "traveller", "Chennai", 8, 6_000_00, 3_12_000_00),
    ("farhan", "Farhan Ali", "business_owner", "Hyderabad", 13, 40_000_00, 12_75_000_00),
]


def _password() -> str:
    return "-".join(secrets.choice(["Teal", "Maple", "Comet", "Harbor", "Lotus", "Quartz", "Ember", "Willow"])
                    for _ in range(2)) + f"-{secrets.randbelow(90) + 10}"


def build(settings: Settings | None = None) -> dict:
    settings = settings or Settings()
    db_path = Path(settings.database_url.removeprefix("sqlite:///"))
    if not db_path.is_absolute():
        db_path = ROOT / db_path
    for suffix in ("", "-wal", "-shm"):
        Path(f"{db_path}{suffix}").unlink(missing_ok=True)
    st = AppState.build(settings)
    creds = {}
    with st.SessionLocal() as db:
        u, totp_secret, dkey = seed.create_user(db, st.box, username="analyst", password=(pw := _password()),
                                                role="admin", display_name="Security Analyst", persona="staff",
                                                home_city="Bengaluru", balance_paise=0)
        browser = secrets.token_urlsafe(24)
        seed.seed_history(db, u, device_raw=browser, days=45, login_hour=10, amount_paise=100_00)
        creds["analyst"] = {"password": pw, "totp_uri": pyotp.TOTP(totp_secret).provisioning_uri(
            name="analyst", issuer_name="SecureSynth Demo"), "trusted_device_key": dkey, "home_browser_cookie": browser}
        for uname, display, persona, city, hour, amount, balance in CUSTOMERS:
            pw = _password()
            u, totp_secret, dkey = seed.create_user(db, st.box, username=uname, password=pw, role="customer",
                                                    display_name=display, persona=persona, home_city=city,
                                                    balance_paise=balance)
            browser = secrets.token_urlsafe(24)
            seed.seed_history(db, u, device_raw=browser, days=45, login_hour=hour, amount_paise=amount)
            creds[uname] = {"password": pw, "persona": persona, "home_city": city,
                            "totp_uri": pyotp.TOTP(totp_secret).provisioning_uri(name=uname, issuer_name="SecureSynth Demo"),
                            "trusted_device_key": dkey, "home_browser_cookie": browser}
        db.commit()
    st.engine.dispose()
    shutil.copyfile(db_path, ROOT / "seed.db")
    out = ROOT / "artifacts" / "demo_credentials.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(creds, indent=2))
    out.chmod(0o600)
    return {"db": str(db_path), "snapshot": str(ROOT / "seed.db"), "credentials": str(out), "users": list(creds)}


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
