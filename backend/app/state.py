"""Per-app runtime state (engines, crypto box, limiters). Stored on app.state.ss."""
import secrets
from dataclasses import dataclass, field

from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.models import Base
from app.security.ratelimit import RateLimiter
from app.security.secrets_box import SecretBox


def _sqlite_engine(url: str):
    eng = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    return eng


@dataclass
class AppState:
    settings: Settings
    engine: object = None
    SessionLocal: object = None
    box: SecretBox = None
    login_limiter: RateLimiter = field(default_factory=RateLimiter)
    totp_limiter: RateLimiter = field(default_factory=RateLimiter)
    model: object = None
    lab_token: str = field(default_factory=lambda: secrets.token_urlsafe(24))  # in-process only

    @classmethod
    def build(cls, settings: Settings) -> "AppState":
        if not settings.fernet_key:
            raise RuntimeError("SS_FERNET_KEY missing — run `make setup` to create backend/.env")
        st = cls(settings=settings)
        st.engine = _sqlite_engine(settings.database_url)
        st.SessionLocal = sessionmaker(bind=st.engine, expire_on_commit=False)
        st.box = SecretBox(settings.fernet_key)
        Base.metadata.create_all(st.engine)
        st.model = _load_model(settings)
        return st


def get_state(request: Request) -> AppState:
    return request.app.state.ss


def get_db(request: Request):
    db = request.app.state.ss.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _load_model(settings: Settings):
    from pathlib import Path

    import joblib

    from app.risk import engine

    path = Path(settings.artifacts_dir) / "model.joblib"
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[1] / path
    if not path.exists():
        raise RuntimeError(f"Model artefact missing at {path} — run `make train`")
    model = joblib.load(path)
    engine.MODEL_VERSION = model.version
    return model
