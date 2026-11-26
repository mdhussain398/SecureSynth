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
    # investigation summaries: at most 20 generations per analyst per minute (protects an optional paid LLM)
    summary_limiter: RateLimiter = field(default_factory=lambda: RateLimiter(max_failures=20, window_s=60, lockout_s=60))
    model: object = None
    lab_token: str = field(default_factory=lambda: secrets.token_urlsafe(24))  # in-process only
    ghost_engine: object = None        # separate database; exists only when Ghost Banking is enabled
    GhostSessionLocal: object = None
    evidence_engine: object = None     # separate evidence vault database (+ encrypted file store)
    EvidenceSessionLocal: object = None
    evidence_store_dir: str = ""
    ccr_engine: object = None          # separate DEMO cybercrime reporting service database
    CCRSessionLocal: object = None

    @classmethod
    def build(cls, settings: Settings) -> "AppState":
        if not settings.fernet_key:
            raise RuntimeError("SS_FERNET_KEY missing — run `make setup` to create backend/.env")
        st = cls(settings=settings)
        st.engine = _sqlite_engine(settings.database_url)
        st.SessionLocal = sessionmaker(bind=st.engine, expire_on_commit=False)
        st.box = SecretBox(settings.fernet_key)
        ensure_schema(st.engine)
        if settings.ghost_banking_enabled:
            build_ghost(st)
        build_investigation(st)
        st.model = _load_model(settings)
        return st


def _sibling(settings, name: str) -> str:
    from pathlib import Path
    base = Path(settings.database_url.removeprefix("sqlite:///"))
    return str(base.parent / name)


def build_investigation(st: "AppState") -> None:
    """Evidence vault and demo reporting service: each its own SQLite file, engine and metadata."""
    from pathlib import Path
    from app.dummy_ccr.service import DemoCCRBase
    from app.evidence.models import EvidenceBase
    s = st.settings
    ev_url = s.evidence_database_url or "sqlite:///" + _sibling(s, "evidence.db")
    ccr_url = s.demo_ccr_database_url or "sqlite:///" + _sibling(s, "demo_ccr.db")
    if len({ev_url, ccr_url, s.database_url, s.ghost_database_url}) != 4:
        raise RuntimeError("Protected, ghost, evidence and demo-reporting stores must be separate databases")
    st.evidence_engine = _sqlite_engine(ev_url)
    EvidenceBase.metadata.create_all(st.evidence_engine)
    st.EvidenceSessionLocal = sessionmaker(bind=st.evidence_engine, expire_on_commit=False)
    st.ccr_engine = _sqlite_engine(ccr_url)
    DemoCCRBase.metadata.create_all(st.ccr_engine)
    st.CCRSessionLocal = sessionmaker(bind=st.ccr_engine, expire_on_commit=False)
    st.evidence_store_dir = s.evidence_store_dir or _sibling(s, "evidence_store")
    Path(st.evidence_store_dir).mkdir(parents=True, exist_ok=True)


def build_ghost(st: "AppState") -> None:
    """Open the isolated ghost database (its own file, engine and metadata). Never the protected database."""
    from app.ghost.models import GhostBase
    if st.settings.ghost_database_url == st.settings.database_url:
        raise RuntimeError("Ghost Banking must use a separate database from the protected ledger")
    st.ghost_engine = _sqlite_engine(st.settings.ghost_database_url)
    GhostBase.metadata.create_all(st.ghost_engine)
    st.GhostSessionLocal = sessionmaker(bind=st.ghost_engine, expire_on_commit=False)


def ensure_schema(engine) -> None:
    """Create missing tables and add the additive columns introduced after the first release. Idempotent, and
    needed because the demo reset restores a snapshot built with the older schema. Never drops or rewrites data."""
    from sqlalchemy import inspect, text

    Base.metadata.create_all(engine)
    have = {c["name"] for c in inspect(engine).get_columns("history_events")}
    with engine.begin() as conn:
        if "outcome" not in have:
            conn.execute(text("ALTER TABLE history_events ADD COLUMN outcome VARCHAR(12)"))
        if "assessment_id" not in have:
            conn.execute(text("ALTER TABLE history_events ADD COLUMN assessment_id INTEGER"))
        inc = {c["name"] for c in inspect(engine).get_columns("security_incidents")}
        if "ghost" not in inc:
            conn.execute(text("ALTER TABLE security_incidents ADD COLUMN ghost BOOLEAN NOT NULL DEFAULT 0"))
        if "ref" not in inc:
            conn.execute(text("ALTER TABLE security_incidents ADD COLUMN ref VARCHAR(20)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_security_incidents_ref ON security_incidents (ref)"))
        import secrets as _s
        for (iid,) in conn.execute(text("SELECT id FROM security_incidents WHERE ref IS NULL")).all():  # backfill
            conn.execute(text("UPDATE security_incidents SET ref = :r WHERE id = :i"), {"r": "INC-" + _s.token_hex(5).upper(), "i": iid})


def get_state(request: Request) -> AppState:
    return request.app.state.ss


def get_ghost_db(request: Request):
    st = request.app.state.ss
    if st.GhostSessionLocal is None:
        from app.errors import ApiError
        raise ApiError(404, "FEATURE_DISABLED", "Ghost Banking is disabled pending mentor approval.")
    db = st.GhostSessionLocal()
    try:
        yield db
    finally:
        db.close()


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
