import os
import pytest

# Test settings are set before the app is imported.
os.environ.setdefault("SS_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("SS_FERNET_KEY", "")  # generated per test run
os.environ.setdefault("SS_DEMO_MODE", "true")
os.environ.setdefault("SS_GHOST_BANKING_ENABLED", "false")


@pytest.fixture()
def clock():
    from app.services import clock as clk
    clk.reset()
    yield clk
    clk.reset()


from dataclasses import dataclass

import pyotp
from cryptography.fernet import Fernet


TEST_DEVICE_RAW = "test-device-cookie-for-established-browser"


@dataclass
class DemoUser:
    id: int
    username: str
    password: str
    totp_secret: str
    device_key: str


@pytest.fixture(scope="session", autouse=True)
def trained_model():
    """The live engine needs artifacts/model.joblib; train it once if missing (deterministic, ~4 s)."""
    from ml import train
    if not (train.ARTIFACTS / "model.joblib").exists():
        train.main()


@pytest.fixture()
def app_ctx(tmp_path, clock):
    from app.config import Settings
    from app.main import create_app

    settings = Settings(
        database_url=f"sqlite:///{tmp_path/'t.db'}",
        ghost_database_url=f"sqlite:///{tmp_path/'g.db'}",
        secret_key="test-secret",
        fernet_key=Fernet.generate_key().decode(),
        demo_mode=True,
        ghost_banking_enabled=False,
        seed_snapshot=str(tmp_path / "seed.db"),
        demo_credentials=str(tmp_path / "creds.json"),
    )
    app = create_app(settings)
    return app


@pytest.fixture()
def client(app_ctx):
    from fastapi.testclient import TestClient

    with TestClient(app_ctx, base_url="http://127.0.0.1:8000") as c:
        c.cookies.set("ss_device", TEST_DEVICE_RAW, domain="127.0.0.1", path="/api")
        yield c


@pytest.fixture()
def users(app_ctx):
    from app import seed

    state = app_ctx.state.ss
    out = {}
    with state.SessionLocal() as db:
        for uname, role in (("asha", "customer"), ("ravi", "customer"), ("admin", "admin")):
            u, secret, dkey = seed.create_user(
                db, state.box, username=uname, password=f"{uname}-Pass-2026", role=role,
                display_name=uname.title(), persona="salaried", home_city="Bengaluru",
                balance_paise=50_000_00,
            )
            seed.seed_history(db, u, device_raw=TEST_DEVICE_RAW, days=45)
            out[uname] = DemoUser(u.id, uname, f"{uname}-Pass-2026", secret, dkey)
        db.commit()
    import json
    pathlib_creds = {n: {"password": d.password, "trusted_device_key": d.device_key,
                         "home_browser_cookie": TEST_DEVICE_RAW} for n, d in out.items()}
    open(state.settings.demo_credentials, "w").write(json.dumps(pathlib_creds))
    return out


def login(client, user, code=None):
    """Full password + TOTP login. Returns the /auth/totp response."""
    r = client.post("/api/auth/login", json={"username": user.username, "password": user.password})
    assert r.status_code == 200, r.text
    code = code or pyotp.TOTP(user.totp_secret).now()
    return client.post("/api/auth/totp", json={"code": code}, headers=csrf(client))


def csrf(client):
    return {"X-CSRF-Token": client.cookies.get("ss_csrf", "")}
