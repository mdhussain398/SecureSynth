"""Evidence collection hooks for the incident / Ghost Banking lifecycle. Only facts the server actually has are
recorded; anything unavailable is recorded as unavailable, never guessed."""
from sqlalchemy import select

from app import models
from app.evidence import netinfo, vault
from app.evidence.models import EvidenceItem


def _cls(s: models.Session, default: str = "observed") -> str:
    return "synthetic" if s.is_lab else default


def _have(edb, ref: str, session_id: str, kind: str) -> bool:
    return edb.scalar(select(EvidenceItem.id).where(EvidenceItem.incident_ref == ref, EvidenceItem.session_id == session_id,
                                                    EvidenceItem.kind == kind, EvidenceItem.deleted_at.is_(None))) is not None


def network_content(s: models.Session) -> dict:
    ctx = s.context or {}
    sim = ctx.get("sim_ip")
    ip = sim or s.ip or ""
    return {"ip": ip or None, **netinfo.classify(ip),
            "source": "Scenario Lab simulated address (synthetic)" if sim else
                      ("Server-observed TCP peer address" if ctx.get("ip_how", "peer") == "peer" else "X-Forwarded-For from a configured trusted proxy"),
            "first_observed": s.created_at, "last_observed": s.last_seen, "authenticated_at": ctx.get("auth_at"),
            "caveat": netinfo.IP_CAVEAT}


def device_content(db, s: models.Session) -> dict:
    d = db.get(models.Device, s.device_id) if s.device_id else None
    ua = (s.context or {}).get("ua", "")
    return {"registered_device_id": f"dev-{d.id}" if d else None, "device_label": d.label if d else None,
            "device_trust": d.trust if d else "none", "recognised_at_sign_in": bool((s.context or {}).get("device_recognised")),
            "device_first_seen": d.first_seen if d else None, "device_last_seen": d.last_seen if d else None,
            **netinfo.parse_ua(ua), "user_agent": ua[:300] or None,
            "mac_address": None, "mac_address_status": netinfo.MAC_UNAVAILABLE,
            "correlation_note": "The registered device identifier is a server-issued browser cookie (a recognition signal, "
                                "not proof of identity). Browsers do not expose hardware MAC addresses."}


def on_restriction(st, db, inc: models.SecurityIncident, s: models.Session, assessment=None, transaction=None) -> None:
    if st is None or st.EvidenceSessionLocal is None:
        return
    lab = bool(s.is_lab)
    with st.EvidenceSessionLocal() as edb:
        if not _have(edb, inc.ref, s.id, "network_observation"):
            vault.add_item(edb, st, kind="network_observation", classification=_cls(s), source="sign-in request",
                           provenance="Recorded by the SecureSynth server when the session authenticated",
                           actor="system", is_lab=lab, incident_ref=inc.ref, session_id=s.id, content=network_content(s))
        if not _have(edb, inc.ref, s.id, "device_observation"):
            vault.add_item(edb, st, kind="device_observation", classification=_cls(s), source="device registry + User-Agent header",
                           provenance="Server device registry; browser/OS parsed from the client-supplied User-Agent",
                           actor="system", is_lab=lab, incident_ref=inc.ref, session_id=s.id, content=device_content(db, s))
        if assessment is not None:
            from app.routers.admin import assessment_out
            vault.add_item(edb, st, kind="risk_assessment", classification=_cls(s, "derived"), source="risk engine",
                           provenance=f"Assessment #{assessment.id} by model {assessment.model_version}",
                           actor="system", is_lab=lab, incident_ref=inc.ref, session_id=s.id,
                           content=assessment_out(assessment))
        if transaction is not None:
            vault.add_item(edb, st, kind="transaction_attempt", classification=_cls(s), source="protected ledger",
                           provenance="Protected transaction record (never executed: status restricted)",
                           actor="system", is_lab=lab, incident_ref=inc.ref, session_id=s.id,
                           content={"transaction_id": transaction.id, "amount_paise": transaction.amount_paise,
                                    "counterparty": transaction.counterparty, "beneficiary_id": transaction.beneficiary_id,
                                    "beneficiary_account_ref": (db.get(models.Beneficiary, transaction.beneficiary_id).account_ref
                                                                if transaction.beneficiary_id else None),
                                    "status": transaction.status, "created_at": transaction.created_at,
                                    "idempotency_key_sha256": vault.sha256((transaction.idempotency_key or "").encode())})


def record(st, inc: models.SecurityIncident, kind: str, content: dict, actor: str, *, classification: str = "observed",
           source: str = "analyst console", provenance: str = "Recorded by SecureSynth", session_id: str | None = None,
           blob: bytes | None = None, mime: str | None = None):
    if st is None or st.EvidenceSessionLocal is None or inc is None or not inc.ref:
        return None
    with st.EvidenceSessionLocal() as edb:
        return vault.add_item(edb, st, kind=kind, classification="synthetic" if inc.is_lab and classification != "derived" else classification,
                              source=source, provenance=provenance, actor=actor, is_lab=bool(inc.is_lab), incident_ref=inc.ref,
                              session_id=session_id, content=None if blob is not None else content, blob=blob, mime=mime,
                              meta=content if blob is not None else None)


def ghost_snapshot(st, inc: models.SecurityIncident, session_id: str, actor: str):
    if st.GhostSessionLocal is None:
        return None
    from app.ghost import service as ghost
    with st.GhostSessionLocal() as gdb:
        g = ghost.monitor(gdb, session_id)
    if g is None:
        return None
    return record(st, inc, "ghost_activity", {"session_id": session_id, **g}, actor, classification="synthetic",
                  source="Ghost Banking ledger", provenance="Snapshot of the isolated synthetic ledger (no protected data)",
                  session_id=session_id)
