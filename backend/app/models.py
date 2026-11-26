"""Protected-domain ORM models (securesynth.db). Ghost models live in app/ghost and use a separate Base."""
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String,
                        UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """SQLite drops tzinfo; store UTC and always return timezone-aware UTC so APIs emit an explicit offset."""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None else None


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(10))
    password_hash: Mapped[str] = mapped_column(String(200))
    totp_secret_enc: Mapped[str] = mapped_column(String(300))
    totp_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    device_key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)  # A2 separate credential
    persona: Mapped[str] = mapped_column(String(30))
    home_city: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(10), default="active")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    __table_args__ = (CheckConstraint("role in ('customer','admin')"),)


class Device(Base):
    """A server-issued cookie seen for a user. Recognition signal only, not proof of identity (A1)."""
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(60), default="Browser")
    first_seen: Mapped[datetime] = mapped_column(UTCDateTime())
    last_seen: Mapped[datetime] = mapped_column(UTCDateTime())
    trust: Mapped[str] = mapped_column(String(10), default="candidate")
    __table_args__ = (UniqueConstraint("user_id", "token_hash"),)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"), nullable=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    city: Mapped[str] = mapped_column(String(40), default="")
    mode: Mapped[str] = mapped_column(String(12))
    risk_current: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    last_seen: Mapped[datetime] = mapped_column(UTCDateTime())
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (CheckConstraint(
        "mode in ('pre_otp','normal','step_up','restricted','ghost','revoked')"),)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(40), index=True)
    ip: Mapped[str] = mapped_column(String(64))
    stage: Mapped[str] = mapped_column(String(10))
    success: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str] = mapped_column(String(40))
    ts: Mapped[datetime] = mapped_column(UTCDateTime())


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    account_ref: Mapped[str] = mapped_column(String(20), unique=True)
    balance_paise: Mapped[int] = mapped_column(Integer)
    __table_args__ = (CheckConstraint("balance_paise >= 0"),)


class Beneficiary(Base):
    __tablename__ = "beneficiaries"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    account_ref: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    trust: Mapped[str] = mapped_column(String(10), default="candidate")


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    beneficiary_id: Mapped[int | None] = mapped_column(ForeignKey("beneficiaries.id"), nullable=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    direction: Mapped[str] = mapped_column(String(6))
    counterparty: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(24))
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    assessment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    __table_args__ = (
        UniqueConstraint("account_id", "idempotency_key"),
        CheckConstraint("amount_paise > 0"),
        CheckConstraint("status in ('attempted','pending_verification','restricted','completed')"),
    )


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    checkpoint: Mapped[str] = mapped_column(String(20))
    features: Mapped[dict] = mapped_column(JSON)
    deviations: Mapped[list] = mapped_column(JSON)
    ml_raw: Mapped[float] = mapped_column(Float)
    ml_index: Mapped[float] = mapped_column(Float)
    ml_weight: Mapped[float] = mapped_column(Float)
    policy: Mapped[list] = mapped_column(JSON)
    risk_score: Mapped[float] = mapped_column(Float)
    decision: Mapped[str] = mapped_column(String(8))
    thresholds: Mapped[dict] = mapped_column(JSON)
    model_version: Mapped[str] = mapped_column(String(40))
    latency_ms: Mapped[float] = mapped_column(Float)
    customer_message: Mapped[str] = mapped_column(String(200))
    ts: Mapped[datetime] = mapped_column(UTCDateTime())


class Challenge(Base):
    """Trusted-device challenge: single-use, short-lived, bound to session + operation + payload hash (A2)."""
    __tablename__ = "challenges"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    assessment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operation: Mapped[str] = mapped_column(String(20))
    operation_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    context_summary: Mapped[str] = mapped_column(String(160))
    number_match: Mapped[int] = mapped_column(Integer)
    options: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())


class Baseline(Base):
    __tablename__ = "baselines"
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    trusted: Mapped[dict] = mapped_column(JSON)
    candidate: Mapped[list] = mapped_column(JSON, default=list)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())


class BaselineVersion(Base):
    __tablename__ = "baseline_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    diff: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(120))
    source_assessment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime())
    rolled_back: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime())
    actor: Mapped[str] = mapped_column(String(40))
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict] = mapped_column(JSON)


class HistoryEvent(Base):
    """Synthetic historical activity used to build baselines and train the model."""
    __tablename__ = "history_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    session_ref: Mapped[str] = mapped_column(String(40), index=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    event_type: Mapped[str] = mapped_column(String(20))
    device_ref: Mapped[str] = mapped_column(String(40))
    city: Mapped[str] = mapped_column(String(40))
    amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    beneficiary_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)
    seconds_since_login: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Live events only (NULL for seeded history). For transfers: completed | pending | blocked | denied | reviewed.
    # "reviewed" = an attempt that never executed and was adjudicated by an analyst; the row is kept as evidence.
    outcome: Mapped[str | None] = mapped_column(String(12), nullable=True)
    assessment_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)


class SecurityIncident(Base):
    """One unresolved security incident per customer: opened by a BLOCK (or a denied trusted-device check),
    later BLOCKs attach to it instead of raising duplicate alerts. Resolution is an explicit analyst decision."""
    __tablename__ = "security_incidents"
    id: Mapped[int] = mapped_column(primary_key=True)
    # Stable reference used by evidence, reports and summaries (ids restart after a demo reset; refs never repeat).
    ref: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(String(32), index=True)   # primary (latest) restricted session
    session_ids: Mapped[list] = mapped_column(JSON, default=list)     # every session restricted under it
    assessment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)       # triggering assessment
    last_assessment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transaction_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trigger: Mapped[str] = mapped_column(String(24))                  # risk_block | verification_denied
    checkpoint: Mapped[str] = mapped_column(String(20))
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[str] = mapped_column(String(10))
    amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    city: Mapped[str] = mapped_column(String(40), default="")
    device_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)
    device_recognised: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str] = mapped_column(String(300))
    block_count: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), index=True)
    verification: Mapped[str | None] = mapped_column(String(12), nullable=True)
    verification_challenge_id: Mapped[str | None] = mapped_column(String(24), nullable=True)
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)
    ghost: Mapped[bool] = mapped_column(Boolean, default=False)  # the session was contained in Ghost Banking
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime())
    analyst_read_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    resolution_action: Mapped[str | None] = mapped_column(String(24), nullable=True)
    resolution_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    __table_args__ = (CheckConstraint(
        "status in ('pending_review','verification_requested','session_restored','user_cleared',"
        "'restriction_retained','session_revoked')"),)


class RuntimeSetting(Base):
    """Persistent operational settings changed by analysts at runtime (e.g. Ghost Banking on/off)."""
    __tablename__ = "runtime_settings"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
    reason: Mapped[str] = mapped_column(String(300))


class ConfigChange(Base):
    """Append-only history of runtime setting changes."""
    __tablename__ = "config_changes"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), index=True)
    old_value: Mapped[str] = mapped_column(String(40))
    new_value: Mapped[str] = mapped_column(String(40))
    actor: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(String(300))
    effect: Mapped[dict] = mapped_column(JSON, default=dict)
    ts: Mapped[datetime] = mapped_column(UTCDateTime())


class ScenarioLabel(Base):
    """Evaluation-only labels. Inference code must never read this table (test-enforced)."""
    __tablename__ = "scenario_labels"
    session_ref: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(String(6))
    attack_family: Mapped[str | None] = mapped_column(String(20), nullable=True)
    split: Mapped[str] = mapped_column(String(10))
