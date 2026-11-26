"""SecureSynth 3.0 investigation API (admin only): evidence vault, photographs, notes, integrity, custody, timeline,
fraud intelligence, SOC metrics, summaries and cybercrime reporting. Every route requires an admin session in normal
mode; mutations also need CSRF (the shared dependency) and, where state changes matter, a fresh TOTP code."""
import base64
import json
import binascii
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from app import models
from app.errors import ApiError
from app.evidence import vault
from app.evidence.models import EvidenceItem, IntegrityAlert, PhotoRequest
from app.services import audit, clock
from app.services.sessions import require
from app.state import AppState, get_state

router = APIRouter(prefix="/admin", tags=["investigation (3.0)"])
ADMIN = require("normal", roles=("admin",))
PHOTO_TTL_MIN = 15


def incident_or_404(db, incident_id: int) -> models.SecurityIncident:
    inc = db.get(models.SecurityIncident, incident_id)
    if inc is None:
        raise ApiError(404, "NOT_FOUND", "Incident not found.")
    return inc


def item_out(i: EvidenceItem, with_content: bool = True) -> dict:
    return {"id": i.id, "incident_ref": i.incident_ref, "session_id": i.session_id, "kind": i.kind,
            "classification": i.classification, "source": i.source, "provenance": i.provenance,
            "content": i.content if with_content else None, "has_file": bool(i.blob_path), "mime": i.mime,
            "size_bytes": i.size_bytes, "sha256": i.content_sha256, "collected_at": i.collected_at, "collected_by": i.collected_by,
            "retention_until": i.retention_until, "is_lab": i.is_lab, "deleted_at": i.deleted_at, "meta": i.meta}


# ---------------------------------------------------------------- evidence vault
@router.get("/incidents/{incident_id}/evidence")
def incident_evidence(incident_id: int, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    _, admin, db = ctx
    inc = incident_or_404(db, incident_id)
    with st.EvidenceSessionLocal() as edb:
        items = vault.items_for(edb, inc.ref, include_deleted=True)
        photos = edb.scalars(select(PhotoRequest).where(PhotoRequest.incident_ref == inc.ref).order_by(PhotoRequest.created_at.desc())).all()
        man = vault.manifest(edb, inc.ref)
        alerts = edb.scalars(select(IntegrityAlert).where(IntegrityAlert.incident_ref == inc.ref).order_by(IntegrityAlert.id.desc()).limit(20)).all()
        vault.append(edb, chain=vault.chain_for(inc.is_lab), event_type="accessed", actor=admin.username, incident_ref=inc.ref,
                     meta={"view": "evidence list", "items": len(items)})
    return {"incident_ref": inc.ref, "items": [item_out(i) for i in items], "manifest": man,
            "photo_requests": [{"id": p.id, "session_id": p.session_id, "status": p.status, "requested_by": p.requested_by,
                                "reason": p.reason, "created_at": p.created_at, "expires_at": p.expires_at, "responded_at": p.responded_at,
                                "consent": p.consent, "evidence_id": p.evidence_id} for p in photos],
            "alerts": [{"id": a.id, "ts": a.ts, "problem": a.problem, "detail": a.detail, "evidence_id": a.evidence_id} for a in alerts]}


@router.get("/evidence/{evidence_id}/content")
def evidence_content(evidence_id: str, download: bool = False, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Decrypted evidence file for authorised analysts only. Every access is a chain-of-custody event."""
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        item = edb.get(EvidenceItem, evidence_id)
        if item is None or item.deleted_at is not None:
            raise ApiError(404, "NOT_FOUND", "Evidence not found.")
        data = vault.read_blob(st, item)
        vault.record_access(edb, item, admin.username, "downloaded" if download else "accessed")
    audit.log(db, admin.username, "evidence.accessed", None, item.session_id, status="download" if download else "view")
    db.commit()
    ext = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf", "application/zip": "zip"}.get(item.mime or "", "bin")
    return Response(content=data, media_type=item.mime or "application/octet-stream", headers={
        "Content-Disposition": f'{"attachment" if download else "inline"}; filename="{item.id}.{ext}"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


class VerifyBody(BaseModel):
    incident_id: int | None = None


@router.post("/evidence/verify")
def verify_integrity(body: VerifyBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    _, admin, db = ctx
    ref = incident_or_404(db, body.incident_id).ref if body.incident_id else None
    with st.EvidenceSessionLocal() as edb:
        r = vault.verify(edb, st, admin.username, ref)
    if r["problems"]:
        audit.log(db, "system", "evidence.integrity_alert", None, None, count=len(r["problems"]), status=r["status"])
        if body.incident_id:  # notify: the incident becomes unread again
            inc = db.get(models.SecurityIncident, body.incident_id)
            inc.analyst_read_at = None
            inc.last_activity_at = clock.now()
        db.commit()
    return r


@router.get("/incidents/{incident_id}/custody")
def chain_of_custody(incident_id: int, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    inc = incident_or_404(ctx[2], incident_id)
    with st.EvidenceSessionLocal() as edb:
        return {"incident_ref": inc.ref, "events": vault.custody(edb, inc.ref)}


@router.get("/integrity/alerts")
def integrity_alerts(include_lab: bool = True, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    with st.EvidenceSessionLocal() as edb:
        q = select(IntegrityAlert).order_by(IntegrityAlert.id.desc()).limit(100)
        if not include_lab:
            q = q.where(IntegrityAlert.is_lab.is_(False))
        return [{"id": a.id, "ts": a.ts, "incident_ref": a.incident_ref, "evidence_id": a.evidence_id, "problem": a.problem,
                 "detail": a.detail, "is_lab": a.is_lab} for a in edb.scalars(q).all()]


class DeleteBody(BaseModel):
    reason: str = Field(min_length=8, max_length=300)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")


@router.post("/evidence/{evidence_id}/delete")
def delete_evidence(evidence_id: str, body: DeleteBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Authorised deletion under the retention policy (or of Scenario Lab fixtures). Fresh TOTP required."""
    from app.services.reauth import require_fresh_totp
    _, admin, db = ctx
    require_fresh_totp(db, st, admin, body.totp_code, "evidence_delete")
    with st.EvidenceSessionLocal() as edb:
        item = edb.get(EvidenceItem, evidence_id)
        if item is None or item.deleted_at is not None:
            raise ApiError(404, "NOT_FOUND", "Evidence not found.")
        vault.delete_item(edb, st, item, admin.username, body.reason)
    audit.log(db, admin.username, "evidence.deleted", None, item.session_id, reason=body.reason[:120])
    db.commit()
    return {"deleted": evidence_id}


class NoteBody(BaseModel):
    text: str = Field(min_length=3, max_length=4000)


@router.post("/incidents/{incident_id}/notes")
def add_note(incident_id: int, body: NoteBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Investigation notes are evidence: hashed and chained. Stored as untrusted text (never executed or obeyed)."""
    _, admin, db = ctx
    inc = incident_or_404(db, incident_id)
    from app.evidence import collect
    item = collect.record(st, inc, "investigation_note", {"text": body.text, "author": admin.username, "at": clock.now()},
                          admin.username, provenance="Analyst note")
    audit.log(db, admin.username, "incident.note_added", inc.user_id, inc.session_id, incident_id=inc.id)
    db.commit()
    return item_out(item)


# ---------------------------------------------------------------- consented verification photographs
class PhotoRequestBody(BaseModel):
    reason: str = Field(min_length=8, max_length=300)
    session_id: str | None = Field(default=None, max_length=32)


@router.post("/incidents/{incident_id}/photo-request")
def request_photo(incident_id: int, body: PhotoRequestBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    _, admin, db = ctx
    inc = incident_or_404(db, incident_id)
    sid = body.session_id or inc.session_id
    if sid not in (inc.session_ids or []):
        raise ApiError(422, "VALIDATION_ERROR", "That session is not part of this incident.")
    s = db.get(models.Session, sid)
    if s is None or s.mode in ("revoked", "pre_otp"):
        raise ApiError(409, "SESSION_NOT_ELIGIBLE", "The session has ended, so there is no screen to ask for a photograph.")
    return create_photo_request(st, db, inc, sid, admin.username, body.reason)


def photo_request_closed(edb, ref, sid):
    return edb.scalar(select(PhotoRequest.id).where(
        PhotoRequest.incident_ref == ref, PhotoRequest.session_id == sid,
        PhotoRequest.status.in_(("submitted", "declined"))).limit(1)) is not None


def create_photo_request(st, db, inc, sid, actor, reason, *, self_started=False):
    with st.EvidenceSessionLocal() as edb:
        edb.execute(text("BEGIN IMMEDIATE"))
        now = clock.now()
        existing = edb.scalar(select(PhotoRequest).where(
            PhotoRequest.session_id == sid, PhotoRequest.status == "pending", PhotoRequest.expires_at > now)
            .order_by(PhotoRequest.created_at.desc()).limit(1))
        if existing is not None:
            return {"id": existing.id, "status": existing.status, "expires_at": existing.expires_at, "idempotent": True}
        if self_started and photo_request_closed(edb, inc.ref, sid):
            raise ApiError(409, "REQUEST_CLOSED", "Photo verification has already been answered for this sign-in.")
        p = PhotoRequest(id="PR-" + secrets.token_hex(6).upper(), incident_ref=inc.ref, session_id=sid, status="pending",
                         requested_by=actor, reason=" ".join(reason.split()), created_at=now,
                         expires_at=now + timedelta(minutes=PHOTO_TTL_MIN), is_lab=inc.is_lab)
        edb.add(p)
        edb.commit()
        vault.append(edb, chain=vault.chain_for(inc.is_lab), event_type="photo_requested", actor=actor,
                     incident_ref=inc.ref, meta={"request_id": p.id, "session_id": sid})
    audit.log(db, actor, "incident.photo_requested", inc.user_id, sid, incident_id=inc.id, reason=reason[:120])
    db.commit()
    return {"id": p.id, "status": "pending", "expires_at": p.expires_at, "idempotent": False}


@router.post("/photo-requests/{request_id}/cancel")
def cancel_photo(request_id: str, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    _, admin, _ = ctx
    with st.EvidenceSessionLocal() as edb:
        p = edb.get(PhotoRequest, request_id)
        if p is None:
            raise ApiError(404, "NOT_FOUND", "Request not found.")
        if p.status == "pending":
            p.status, p.responded_at = "cancelled", clock.now()
            edb.commit()
            vault.append(edb, chain=vault.chain_for(p.is_lab), event_type="photo_cancelled", actor=admin.username,
                         incident_ref=p.incident_ref, meta={"request_id": p.id})
        return {"id": p.id, "status": p.status}


# shared by the customer endpoint (auth router) and the Scenario Lab fixture
JPEG, PNG = b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n"


def decode_image(b64: str, mime: str, max_bytes: int) -> bytes:
    if mime not in ("image/jpeg", "image/png"):
        raise ApiError(422, "VALIDATION_ERROR", "Only JPEG or PNG photographs are accepted.")
    if len(b64) > max_bytes * 4 // 3 + 16:
        raise ApiError(413, "VALIDATION_ERROR", "The photograph is too large.")
    try:
        data = base64.b64decode(b64.split(",", 1)[-1], validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "VALIDATION_ERROR", "The photograph could not be read.")
    if len(data) > max_bytes or len(data) < 64:
        raise ApiError(413, "VALIDATION_ERROR", "The photograph is too large or empty.")
    if not data.startswith(JPEG if mime == "image/jpeg" else PNG):
        raise ApiError(422, "VALIDATION_ERROR", "The file content does not match an image of the stated type.")
    return data


def accept_photo(st, db, p: PhotoRequest, data: bytes, mime: str, captured_at, actor: str, classification: str = "observed",
                 source: str = "customer browser camera (explicit consent)"):
    inc = db.scalar(select(models.SecurityIncident).where(models.SecurityIncident.ref == p.incident_ref))
    with st.EvidenceSessionLocal() as edb:
        pr = edb.get(PhotoRequest, p.id)
        if pr.status != "pending" or clock.now() >= pr.expires_at:
            raise ApiError(409, "REQUEST_CLOSED", "This verification request is no longer open.")
        item = vault.add_item(edb, st, kind="verification_photo", classification="synthetic" if pr.is_lab else classification,
                              source=source, provenance=f"Submitted by the session holder after explicit consent (request {pr.id})",
                              actor=actor, is_lab=pr.is_lab, incident_ref=pr.incident_ref, session_id=pr.session_id, blob=data,
                              mime=mime, meta={"request_id": pr.id, "consent": True, "captured_at": captured_at,
                                               "received_at": clock.now(), "note": "A verification photograph is not proof of identity."})
        pr.status, pr.responded_at, pr.consent, pr.evidence_id = "submitted", clock.now(), True, item.id
        edb.commit()
    if inc is not None:
        inc.analyst_read_at, inc.last_activity_at = None, clock.now()
        audit.log(db, actor, "incident.photo_submitted", inc.user_id, pr.session_id, incident_id=inc.id)
        db.commit()
    return item


# ---------------------------------------------------------------- unified timeline, fraud intelligence, SOC
@router.get("/incidents/{incident_id}/timeline")
def incident_timeline(incident_id: int, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import timeline
    inc = incident_or_404(ctx[2], incident_id)
    return {"incident_ref": inc.ref, "events": timeline.build(ctx[2], st, inc)}


@router.get("/intel/graph")
def intel_graph(hours: int = 720, include_lab: bool = True, min_strength: str = "weak", severity: str | None = None,
                reveal: bool = False, focus: str | None = None, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Correlation graph from investigation records. Identifiers are masked unless `reveal=true` (audited)."""
    from app.intel import correlation
    _, admin, db = ctx
    if min_strength not in correlation.LEVEL or (severity and severity not in ("high", "critical")):
        raise ApiError(422, "VALIDATION_ERROR", "Unknown filter value.")
    g = correlation.build(db, st, hours=hours, include_lab=include_lab, min_strength=min_strength, severity=severity,
                          reveal=reveal, focus=focus)
    if reveal:
        audit.log(db, admin.username, "intel.identifiers_revealed", None, None, count=len(g["nodes"]), role="admin")
        db.commit()
    return g


@router.get("/soc/metrics")
def soc_metrics(range: str = "24h", include_lab: bool = True, start: str | None = None, end: str | None = None,
                ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import soc
    if range not in ("1h", "24h", "7d", "30d", "custom"):
        raise ApiError(422, "VALIDATION_ERROR", "Unknown range.")
    try:
        return soc.metrics(ctx[2], st, range, include_lab, start, end)
    except ValueError:
        raise ApiError(422, "VALIDATION_ERROR", "Invalid custom date range.")


# ---------------------------------------------------------------- investigation summaries (decision support only)
class SummaryGen(BaseModel):
    use_llm: bool = False


class SummaryEdit(BaseModel):
    sections: list[dict] = Field(min_length=1, max_length=30)


def _summary_rows(edb, ref):
    from app.evidence.models import SummaryVersion
    return edb.scalars(select(SummaryVersion).where(SummaryVersion.incident_ref == ref).order_by(SummaryVersion.version.desc())).all()


@router.get("/incidents/{incident_id}/summary")
def get_summary(incident_id: int, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import summary
    db = ctx[2]
    inc = incident_or_404(db, incident_id)
    ok, why = summary.llm_available(st)
    with st.EvidenceSessionLocal() as edb:
        rows = _summary_rows(edb, inc.ref)
        return {"latest": summary.out(db, st, inc, rows[0]) if rows else None, "versions": len(rows),
                "llm": {"available": ok, "detail": why}, "missing_evidence": summary.missing_evidence(st, inc)}


@router.post("/incidents/{incident_id}/summary")
def generate_summary(incident_id: int, body: SummaryGen, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.evidence.models import SummaryVersion
    from app.intel import summary
    _, admin, db = ctx
    inc = incident_or_404(db, incident_id)
    key = f"summary:{admin.id}"
    if not st.summary_limiter.allowed(key):
        raise ApiError(429, "RATE_LIMITED", "Too many summary requests. Wait a moment.")
    st.summary_limiter.record_failure(key)  # the limiter counts every generation
    sections, method, note = summary.generate(db, st, inc, body.use_llm)
    ev = summary.evidence_version(db, st, inc)
    with st.EvidenceSessionLocal() as edb:
        prev = _summary_rows(edb, inc.ref)
        sv = SummaryVersion(incident_ref=inc.ref, version=(prev[0].version + 1) if prev else 1, method=method, evidence_version=ev,
                            sections=json.loads(vault.canonical(sections)), created_by=admin.username, created_at=clock.now(), is_lab=inc.is_lab)
        edb.add(sv)
        edb.commit()
        vault.append(edb, chain=vault.chain_for(inc.is_lab), event_type="summary_generated", actor=admin.username, incident_ref=inc.ref,
                     content_hash=vault.sha256(vault.canonical(sv.sections)), meta={"version": sv.version, "method": method})
        return {**summary.out(db, st, inc, sv), "note": note}


@router.put("/summaries/{summary_id}")
def edit_summary(summary_id: int, body: SummaryEdit, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.evidence.models import SummaryVersion
    from app.intel import summary
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        sv = edb.get(SummaryVersion, summary_id)
        if sv is None:
            raise ApiError(404, "NOT_FOUND", "Summary not found.")
        by = {s["key"]: s for s in sv.sections}
        new = []
        for s in body.sections:
            k, t = str(s.get("key", "")), str(s.get("text", ""))
            if k not in by or not (0 < len(t) <= 4000):
                raise ApiError(422, "VALIDATION_ERROR", "Sections can be edited, not added or removed.")
            new.append({**by[k], "text": t})
        sv.sections, sv.edited, sv.status, sv.approved_by, sv.approved_at = new, True, "draft", None, None
        edb.commit()
        vault.append(edb, chain=vault.chain_for(sv.is_lab), event_type="summary_edited", actor=admin.username, incident_ref=sv.incident_ref,
                     content_hash=vault.sha256(vault.canonical(new)), meta={"version": sv.version})
        inc = db.scalar(select(models.SecurityIncident).where(models.SecurityIncident.ref == sv.incident_ref))
        return summary.out(db, st, inc, sv)


@router.post("/summaries/{summary_id}/approve")
def approve_summary(summary_id: int, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.evidence.models import SummaryVersion
    from app.intel import summary
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        sv = edb.get(SummaryVersion, summary_id)
        if sv is None:
            raise ApiError(404, "NOT_FOUND", "Summary not found.")
        inc = db.scalar(select(models.SecurityIncident).where(models.SecurityIncident.ref == sv.incident_ref))
        if summary.evidence_version(db, st, inc) != sv.evidence_version:
            raise ApiError(409, "SUMMARY_STALE", "The evidence changed since this summary was generated. Regenerate it first.")
        sv.status, sv.approved_by, sv.approved_at = "approved", admin.username, clock.now()
        edb.commit()
        vault.append(edb, chain=vault.chain_for(sv.is_lab), event_type="summary_approved", actor=admin.username, incident_ref=sv.incident_ref,
                     content_hash=vault.sha256(vault.canonical(sv.sections)), meta={"version": sv.version})
        audit.log(db, admin.username, "summary.approved", inc.user_id if inc else None, None, incident_id=inc.id if inc else None)
        db.commit()
        return summary.out(db, st, inc, sv)


# ---------------------------------------------------------------- cybercrime reports
class ReportCreate(BaseModel):
    destination: str = Field(default="dummy", pattern=r"^(dummy|official)$")


class ReportUpdate(BaseModel):
    expected_version: int
    fields: dict | None = None
    destination: str | None = Field(default=None, pattern=r"^(dummy|official)$")
    attachments: list[str] | None = Field(default=None, max_length=100)


class FirstConfirm(BaseModel):
    version: int
    manifest_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    destination: str = Field(pattern=r"^(dummy|official)$")
    checklist: dict[str, bool]


class FinalConfirm(BaseModel):
    confirmation_id: str = Field(max_length=24)
    version: int
    manifest_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    destination: str = Field(pattern=r"^(dummy|official)$")
    phrase: str = Field(max_length=40)
    reason: str = Field(min_length=8, max_length=300)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")


class OfficialAck(BaseModel):
    ack_number: str = Field(min_length=4, max_length=60, pattern=r"^[A-Za-z0-9/\-_. ]+$")
    reason: str = Field(min_length=8, max_length=300)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")
    document_base64: str | None = Field(default=None, max_length=4_200_000)
    document_mime: str | None = Field(default=None, pattern=r"^(application/pdf|image/png|image/jpeg)$")


class CancelBody(BaseModel):
    reason: str = Field(min_length=8, max_length=300)


def _report(edb, rid):
    from app.evidence.models import CyberReport
    r = edb.get(CyberReport, rid)
    if r is None:
        raise ApiError(404, "NOT_FOUND", "Report not found.")
    return r


@router.post("/incidents/{incident_id}/reports")
def create_report(incident_id: int, body: ReportCreate, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    _, admin, db = ctx
    inc = incident_or_404(db, incident_id)
    r = reports.create(db, st, inc, admin, body.destination)
    audit.log(db, admin.username, "report.prepared", inc.user_id, inc.session_id, incident_id=inc.id, status=body.destination)
    db.commit()
    with st.EvidenceSessionLocal() as edb:
        return reports.report_out(edb.get(type(r), r.id), edb, db, st)


@router.get("/reports")
def list_reports(status: str | None = None, destination: str | None = None, q: str | None = None, since: str | None = None,
                 ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from datetime import datetime as _dt

    from app.evidence.models import CyberReport
    from app.intel import reports
    with st.EvidenceSessionLocal() as edb:
        query = select(CyberReport).order_by(CyberReport.created_at.desc()).limit(200)
        if status:
            query = query.where(CyberReport.status == status)
        if destination:
            query = query.where(CyberReport.destination == destination)
        if since:
            try:
                query = query.where(CyberReport.created_at >= _dt.fromisoformat(since))
            except ValueError:
                raise ApiError(422, "VALIDATION_ERROR", "Invalid date.")
        rows = edb.scalars(query).all()
        if q:
            ql = q.lower()
            rows = [r for r in rows if ql in r.id.lower() or ql in r.incident_ref.lower() or ql in (r.ack_number or "").lower()]
        out = []
        for r in rows:
            o = reports.report_out(r, edb)
            out.append({k: o[k] for k in ("id", "incident_ref", "destination", "status", "status_label", "version", "created_by",
                                          "created_at", "approved_at", "submitted_at", "ack_number", "is_lab", "manifest_matches")}
                       | {"attachments": len(o["attachments"]), "responsible": r.approved_by or r.created_by})
        return out


@router.get("/reports/{report_id}")
def get_report(report_id: str, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        o = reports.report_out(r, edb, ctx[2], st)
        inc = ctx[2].scalar(select(models.SecurityIncident).where(models.SecurityIncident.ref == r.incident_ref))
        o["incident_id"] = inc.id if inc else None
        if r.ack_number and r.destination == "dummy":
            from app.dummy_ccr import service as ccr
            with st.CCRSessionLocal() as cdb:
                c = ccr.get(cdb, r.ack_number)
                o["demo_complaint"] = {"ack": c.ack_ref, "status": c.status, "updated_at": c.updated_at} if c else None
        return o


@router.put("/reports/{report_id}")
def update_report(report_id: str, body: ReportUpdate, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        r = reports.update_fields(edb, st, _report(edb, report_id), admin.username, body.fields, body.destination, body.attachments,
                                  body.expected_version)
        return reports.report_out(r, edb, db, st)


@router.post("/reports/{report_id}/review")
def review_report(report_id: str, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    with st.EvidenceSessionLocal() as edb:
        return reports.report_out(reports.submit_for_review(edb, _report(edb, report_id), ctx[1].username), edb, ctx[2], st)


@router.post("/reports/{report_id}/confirm-first")
def first_confirmation(report_id: str, body: FirstConfirm, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        c = reports.confirm_first(edb, st, r, ctx[1].username, body.version, body.manifest_hash, body.destination, body.checklist)
        return {"confirmation_id": c.id, "expires_at": c.expires_at, "report": reports.report_out(r, edb, ctx[2], st)}


@router.post("/reports/{report_id}/confirm-final")
def final_confirmation(report_id: str, body: FinalConfirm, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Final confirmation: typed phrase + reason + fresh TOTP, bound to version/manifest/destination; single use."""
    from app.intel import reports
    from app.services.reauth import require_fresh_totp
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        reports.guard_official(st, r, body.destination)
        require_fresh_totp(db, st, admin, body.totp_code, "report_final_confirmation")
        result = reports.confirm_final(db, edb, st, r, admin, body.confirmation_id, body.version, body.manifest_hash, body.destination,
                                       body.phrase, " ".join(body.reason.split()))
        audit.log(db, admin.username, "report.final_confirmation", None, None, status=result["status"], reason=body.reason[:120])
        db.commit()
        return {**result, "report": reports.report_out(edb.get(type(r), r.id), edb, db, st)}


@router.post("/reports/{report_id}/official-ack")
def record_official_ack(report_id: str, body: OfficialAck, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Record a GENUINE acknowledgement after the complainant filed on the official portal. Without the acknowledgement
    document it stays 'Official Submission Unverified'; with it, the document is stored as evidence."""
    from app.intel import reports
    from app.services.reauth import require_fresh_totp
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        reports.guard_official(st, r, r.destination)
        if r.destination != "official" or r.status not in ("ready_for_official_submission", "official_submission_unverified"):
            raise ApiError(409, "REPORT_LOCKED", "Only a report handed off for official filing can record an acknowledgement.")
        require_fresh_totp(db, st, admin, body.totp_code, "official_ack")
        doc_id = None
        if body.document_base64:
            import base64 as _b64
            try:
                doc = _b64.b64decode(body.document_base64.split(",", 1)[-1], validate=True)
            except (binascii.Error, ValueError):
                raise ApiError(422, "VALIDATION_ERROR", "The acknowledgement document could not be read.")
            sig = {"application/pdf": b"%PDF", "image/png": PNG, "image/jpeg": JPEG}[body.document_mime or "application/pdf"]
            if not doc.startswith(sig) or len(doc) > st.settings.evidence_max_upload_bytes:
                raise ApiError(422, "VALIDATION_ERROR", "The document is not a valid PDF/PNG/JPEG within the size limit.")
            item = vault.add_item(edb, st, kind="official_acknowledgement", classification="observed", source="uploaded by analyst",
                                  provenance="Acknowledgement issued by the official portal, uploaded by the analyst", actor=admin.username,
                                  is_lab=False, incident_ref=r.incident_ref, blob=doc, mime=body.document_mime or "application/pdf",
                                  meta={"ack_number": body.ack_number, "report_id": r.id})
            doc_id = item.id
        r.ack_number, r.submitted_at = body.ack_number.strip(), clock.now()
        r.ack_evidence_id = doc_id or r.ack_evidence_id
        r.status = "submitted_official_confirmed" if r.ack_evidence_id else "official_submission_unverified"
        reports._hist(r, "official_ack_recorded", admin.username, f"{body.ack_number} ({'document attached' if doc_id else 'no document'})")
        edb.commit()
        audit.log(db, admin.username, "report.official_ack", None, None, status=r.status, reason=body.reason[:120])
        db.commit()
        return reports.report_out(r, edb, db, st)


@router.post("/reports/{report_id}/cancel")
def cancel_report(report_id: str, body: CancelBody, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        if r.status in ("submitted_demo", "submitted_official_confirmed", "official_submission_unverified"):
            raise ApiError(409, "REPORT_LOCKED", "A submitted report cannot be cancelled.")
        r.status = "cancelled"
        reports._hist(r, "cancelled", ctx[1].username, body.reason)
        edb.commit()
        return reports.report_out(r, edb, ctx[2], st)


@router.post("/reports/{report_id}/demo-status")
def advance_demo_status(report_id: str, ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    """Demo only: ask the simulated service for its next status update."""
    from app.dummy_ccr import service as ccr
    from app.intel import reports
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        if r.destination != "dummy" or not r.ack_number:
            raise ApiError(409, "REPORT_LOCKED", "Only submitted demo reports have simulated status updates.")
        with st.CCRSessionLocal() as cdb:
            c = ccr.advance(cdb, r.ack_number)
        reports._hist(r, "demo_status_update", "demo service", c.status)
        edb.commit()
        return {"ack": c.ack_ref, "status": c.status, "updated_at": c.updated_at, "warning": ccr.WARNING}


@router.get("/reports/{report_id}/export")
def export_report(report_id: str, format: str = "pdf", ctx=Depends(ADMIN), st: AppState = Depends(get_state)):
    from app.intel import reports
    if format not in ("pdf", "json", "zip"):
        raise ApiError(422, "VALIDATION_ERROR", "format must be pdf, json or zip.")
    _, admin, db = ctx
    with st.EvidenceSessionLocal() as edb:
        r = _report(edb, report_id)
        data, mime, name = reports.export(db, edb, st, r, format, admin.username)
    audit.log(db, admin.username, "report.exported", None, None, status=format)
    db.commit()
    return Response(content=data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})
