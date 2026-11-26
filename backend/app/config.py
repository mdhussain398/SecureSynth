from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SS_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./securesynth.db"
    ghost_database_url: str = "sqlite:///./ghost.db"
    secret_key: str = ""
    fernet_key: str = ""  # required; `make setup` writes one into backend/.env
    demo_mode: bool = False
    # Ghost Banking has two keys. This deployment gate (A6) says the feature MAY run here; it stays false until mentor
    # approval. Inside the gate, analysts switch it on/off at runtime (persisted, default OFF, audited).
    ghost_banking_enabled: bool = False
    ghost_banking_approval_ref: str = ""   # mentor approval reference; empty = not approved (demo mode may still run it locally)
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    session_idle_min: int = 15
    session_abs_min: int = 60
    pre_otp_min: int = 5
    challenge_ttl_s: int = 120
    artifacts_dir: str = "./artifacts"
    seed_snapshot: str = "./seed.db"
    demo_credentials: str = "./artifacts/demo_credentials.json"

    # SecureSynth 3.0 investigation stores. None = a sibling of the protected database file (keeps tests isolated).
    evidence_database_url: str | None = None
    evidence_store_dir: str | None = None
    demo_ccr_database_url: str | None = None
    evidence_retention_days: int = 365
    evidence_max_upload_bytes: int = 3_000_000
    # Forwarded-IP headers are honoured ONLY when the direct peer is one of these proxies (never by default).
    trusted_proxies: list[str] = []
    # Official cybercrime reporting: manual handoff to cybercrime.gov.in only; disabled by default.
    official_reporting_enabled: bool = False
    reporting_institution: str = "SecureSynth Demo Bank (synthetic institution)"
    # Optional LLM for investigation summaries. "none" = deterministic summaries only (the default).
    ai_provider: str = "none"
    ai_api_key: str = ""
    ai_model: str = ""
    ai_external_approved: bool = False
