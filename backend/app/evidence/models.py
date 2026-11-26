"""Evidence-domain tables (separate database: Settings.evidence_database_url)."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models import UTCDateTime


class EvidenceBase(DeclarativeBase):
    pass


class EvidenceItem(EvidenceBase):
    """One piece of evidence. `classification`: observed (seen by the server), derived (computed from observations),
    synthetic (Scenario Lab fixture or Ghost Banking data). Content is JSON or an encrypted blob, never both."""
    __tablename__ = "evidence_items"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    incident_ref: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    classification: Mapped[str] = mapped_column(String(10))
    source: Mapped[str] = mapped_column(String(80))
    provenance: Mapped[str] = mapped_column(String(300))
    content: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    blob_path: Mapped[str | None] = mapped_column(String(80), nullable=True)   # file name inside the store, never a path
    mime: Mapped[str | None] = mapped_column(String(40), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_sha256: Mapped[str] = mapped_column(String(64))
    collected_at: Mapped[datetime] = mapped_column(UTCDateTime())
    collected_by: Mapped[str] = mapped_column(String(40))
    retention_until: Mapped[datetime] = mapped_column(UTCDateTime())
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class LedgerEntry(EvidenceBase):
    """Append-only, hash-chained evidence event (chain of custody). Two chains: 'genuine' and 'lab'."""
    __tablename__ = "evidence_ledger"
    id: Mapped[int] = mapped_column(primary_key=True)
    chain: Mapped[str] = mapped_column(String(10), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    evidence_id: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    incident_ref: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    event_type: Mapped[str] = mapped_column(String(32))
    ts: Mapped[datetime] = mapped_column(UTCDateTime())
    actor: Mapped[str] = mapped_column(String(40))
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prev_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64))
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("chain", "seq"),)


class IntegrityAlert(EvidenceBase):
    __tablename__ = "integrity_alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime())
    incident_ref: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    evidence_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    problem: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str] = mapped_column(String(300))
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged_by: Mapped[str | None] = mapped_column(String(40), nullable=True)


class PhotoRequest(EvidenceBase):
    """Analyst request for a consented verification photograph from one session."""
    __tablename__ = "photo_requests"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    incident_ref: Mapped[str] = mapped_column(String(20), index=True)
    session_id: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(12))  # pending | submitted | declined | expired | cancelled
    requested_by: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    consent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    evidence_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)


class SummaryVersion(EvidenceBase):
    __tablename__ = "investigation_summaries"
    id: Mapped[int] = mapped_column(primary_key=True)
    incident_ref: Mapped[str] = mapped_column(String(20), index=True)
    version: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(60))
    evidence_version: Mapped[str] = mapped_column(String(64))
    sections: Mapped[list] = mapped_column(JSON)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft | approved
    created_by: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    approved_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("incident_ref", "version"),)


class CyberReport(EvidenceBase):
    __tablename__ = "cyber_reports"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    incident_ref: Mapped[str] = mapped_column(String(20), index=True)
    destination: Mapped[str] = mapped_column(String(10))  # dummy | official
    status: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer, default=1)
    fields: Mapped[dict] = mapped_column(JSON)
    attachments: Mapped[list] = mapped_column(JSON, default=list)   # evidence ids
    manifest_hash: Mapped[str] = mapped_column(String(64))
    summary_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
    approved_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    ack_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    ack_evidence_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False)
    history: Mapped[list] = mapped_column(JSON, default=list)


class ReportConfirmation(EvidenceBase):
    """A first/final confirmation bound to (report version, manifest hash, destination, analyst); single-use, expiring."""
    __tablename__ = "report_confirmations"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("cyber_reports.id"), index=True)
    stage: Mapped[str] = mapped_column(String(6))
    version: Mapped[int] = mapped_column(Integer)
    manifest_hash: Mapped[str] = mapped_column(String(64))
    destination: Mapped[str] = mapped_column(String(10))
    analyst: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    checklist: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
