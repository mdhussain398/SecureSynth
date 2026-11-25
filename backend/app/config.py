from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SS_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./securesynth.db"
    ghost_database_url: str = "sqlite:///./ghost.db"
    secret_key: str = ""
    fernet_key: str = ""  # required; `make setup` writes one into backend/.env
    demo_mode: bool = False
    ghost_banking_enabled: bool = False  # A6: off until mentor approval
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    session_idle_min: int = 15
    session_abs_min: int = 60
    pre_otp_min: int = 5
    challenge_ttl_s: int = 120
    artifacts_dir: str = "./artifacts"
    seed_snapshot: str = "./seed.db"
    demo_credentials: str = "./artifacts/demo_credentials.json"
