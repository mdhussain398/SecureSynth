"""Simulated complaint intake. In-process only (no network); idempotent per report reference."""
import hashlib
import json
from datetime import datetime

from sqlalchemy import Boolean, Integer, JSON, String, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models import UTCDateTime
from app.services import clock

WARNING = "DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED."
STATUSES = ["received", "under_review", "forwarded_to_demo_bank", "closed"]
REQUIRED = ["incident_ref", "category", "incident_datetime_ist", "description", "complainant", "institution"]


class DemoCCRBase(DeclarativeBase):
    pass


class DemoComplaint(DemoCCRBase):
    __tablename__ = "demo_complaints"
    id: Mapped[int] = mapped_column(primary_key=True)
    ack_ref: Mapped[str] = mapped_column(String(30), unique=True)
    report_ref: Mapped[str] = mapped_column(String(20), unique=True)  # one complaint per report: duplicates are idempotent
    payload_sha256: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    attachments: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30))
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)


def validate(payload: dict) -> list[str]:
    return [k for k in REQUIRED if not str(payload.get(k) or "").strip()]


def submit(cdb, report_ref: str, payload: dict, attachments: int, is_lab: bool) -> tuple[DemoComplaint, bool]:
    """Returns (complaint, created). A second submission of the same report returns the first acknowledgement."""
    existing = cdb.scalar(select(DemoComplaint).where(DemoComplaint.report_ref == report_ref))
    if existing is not None:
        return existing, False
    missing = validate(payload)
    if missing:
        from app.errors import ApiError
        raise ApiError(422, "VALIDATION_ERROR", f"Demo service rejected the complaint: missing {', '.join(missing)}.")
    now = clock.now()
    n = (cdb.scalar(select(func.count()).select_from(DemoComplaint)) or 0) + 1
    c = DemoComplaint(ack_ref=f"DEMO-CCR-{now.year}-{n:06d}", report_ref=report_ref,
                      payload_sha256=hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest(),
                      payload=payload, attachments=attachments, status="received", submitted_at=now, updated_at=now, is_lab=is_lab)
    cdb.add(c)
    try:
        cdb.commit()
    except IntegrityError:  # concurrent double submission: the first one wins
        cdb.rollback()
        return cdb.scalar(select(DemoComplaint).where(DemoComplaint.report_ref == report_ref)), False
    return c, True


def advance(cdb, ack_ref: str) -> DemoComplaint | None:
    """Simulated authority status update (demo only)."""
    c = cdb.scalar(select(DemoComplaint).where(DemoComplaint.ack_ref == ack_ref))
    if c is None:
        return None
    i = STATUSES.index(c.status)
    if i < len(STATUSES) - 1:
        c.status, c.updated_at = STATUSES[i + 1], clock.now()
        cdb.commit()
    return c


def get(cdb, ack_ref: str) -> DemoComplaint | None:
    return cdb.scalar(select(DemoComplaint).where(DemoComplaint.ack_ref == ack_ref))
