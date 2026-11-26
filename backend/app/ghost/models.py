"""Ghost ledger tables. A separate DeclarativeBase on a separate engine/file from the protected domain."""
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models import UTCDateTime  # a column *type* only; no protected table is referenced


class GhostBase(DeclarativeBase):
    pass


class GhostAccount(GhostBase):
    """One synthetic account per ghost session: state is consistent within a session and never shared."""
    __tablename__ = "ghost_accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)  # analyst lookup only; not a foreign key
    account_ref: Mapped[str] = mapped_column(String(20))
    opening_balance_paise: Mapped[int] = mapped_column(Integer)
    balance_paise: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    __table_args__ = (CheckConstraint("balance_paise >= 0"),)


class GhostBeneficiary(GhostBase):
    __tablename__ = "ghost_beneficiaries"
    id: Mapped[int] = mapped_column(primary_key=True)
    ghost_account_id: Mapped[int] = mapped_column(ForeignKey("ghost_accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    account_ref: Mapped[str] = mapped_column(String(20))
    trust: Mapped[str] = mapped_column(String(10))
    origin: Mapped[str] = mapped_column(String(8))  # seeded (synthetic backdrop) | session (added by the session)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class GhostTransaction(GhostBase):
    __tablename__ = "ghost_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    ghost_account_id: Mapped[int] = mapped_column(ForeignKey("ghost_accounts.id"), index=True)
    beneficiary_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    direction: Mapped[str] = mapped_column(String(6))
    counterparty: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(12))
    origin: Mapped[str] = mapped_column(String(8))
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    __table_args__ = (UniqueConstraint("ghost_account_id", "idempotency_key"), CheckConstraint("amount_paise > 0"))


class GhostEvent(GhostBase):
    """Activity timeline for the analyst: everything the contained session did, in order."""
    __tablename__ = "ghost_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    ghost_account_id: Mapped[int] = mapped_column(ForeignKey("ghost_accounts.id"), index=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime())
    kind: Mapped[str] = mapped_column(String(32))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
