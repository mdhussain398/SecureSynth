"""One chronological timeline per incident, merged from records that already exist. Nothing new is collected here:
no browsing activity, keystrokes, passwords or screen content."""
from datetime import timedelta

from sqlalchemy import or_, select

from app import models

LABEL = {
    "auth.login": "Sign-in completed", "session.restricted": "Session contained (BLOCK)", "ghost.entered": "Ghost Banking activated",
    "incident.opened": "Incident opened", "incident.updated": "Further restriction attached to incident",
    "incident.reviewed": "Analyst opened the incident", "incident.request_verification": "Identity verification requested",
    "incident.verification_approved": "Trusted device approved the check", "incident.verification_denied": "Trusted device denied the check",
    "incident.photo_requested": "Verification photograph requested", "incident.photo_submitted": "Consented photograph received",
    "incident.photo_declined": "Photograph request declined", "incident.note_added": "Investigation note added",
    "incident.unblock_session": "Session restored by analyst", "incident.clear_user": "Customer cleared for secure recovery",
    "incident.keep_restricted": "Restriction retained", "incident.revoke_session": "Session revoked",
    "ghost.beneficiary_added": "Payee added (simulated)", "ghost.transfer_simulated": "Transfer simulated",
    "ghost.compare_viewed": "Protected vs synthetic comparison viewed", "transfer.restricted": "Transfer attempt stopped",
    "beneficiary.restricted": "Payee add stopped", "challenge.created": "Trusted-device challenge sent",
    "challenge.approved": "Trusted-device challenge approved", "challenge.denied": "Trusted-device challenge denied",
    "auth.logout": "Signed out", "evidence.accessed": "Evidence file accessed", "evidence.integrity_alert": "Evidence integrity alert",
}


def build(db, st, inc: models.SecurityIncident, limit: int = 400) -> list[dict]:
    sids = list(inc.session_ids or [])
    since = inc.created_at - timedelta(hours=24)
    out: list[dict] = []
    u = db.get(models.User, inc.user_id)
    for la in db.scalars(select(models.LoginAttempt).where(models.LoginAttempt.username == u.username, models.LoginAttempt.ts >= since)
                         .order_by(models.LoginAttempt.ts).limit(100)).all():
        out.append({"ts": la.ts, "source": "authentication", "kind": "login_attempt", "synthetic": False,
                    "title": f"{'Successful' if la.success else 'Failed'} {la.stage} step", "detail": la.reason, "actor": "session holder"})
    for a in db.scalars(select(models.RiskAssessment).where(models.RiskAssessment.session_id.in_(sids)).order_by(models.RiskAssessment.id)).all():
        out.append({"ts": a.ts, "source": "risk engine", "kind": "risk_assessment", "synthetic": inc.is_lab,
                    "title": f"{a.checkpoint.replace('_', ' ').title()} assessed: {a.decision} ({a.risk_score:.1f})",
                    "detail": "; ".join(d["label"] for d in a.deviations) or "No individual deviation", "actor": "system",
                    "ref": f"assessment #{a.id}"})
    q = select(models.AuditEvent).where(models.AuditEvent.ts >= since, or_(
        models.AuditEvent.session_id.in_(sids), models.AuditEvent.user_id == inc.user_id)).order_by(models.AuditEvent.id).limit(400)
    for e in db.scalars(q).all():
        if e.event_type in ("baseline.updated",):
            continue
        d = e.details or {}
        if d.get("incident_id") not in (None, inc.id) and e.event_type.startswith("incident."):
            continue
        out.append({"ts": e.ts, "source": "audit", "kind": e.event_type, "synthetic": e.event_type.startswith("ghost.") or inc.is_lab,
                    "title": LABEL.get(e.event_type, e.event_type), "actor": e.actor,
                    "detail": " · ".join(f"{k}: {v}" for k, v in d.items() if k in ("reason", "decision", "amount_paise", "resulting_state", "status"))})
    if st.GhostSessionLocal is not None and inc.ghost:
        from app.ghost import service as ghost
        with st.GhostSessionLocal() as gdb:
            for sid in sids:
                g = ghost.monitor(gdb, sid)
                for ev in (g or {}).get("events", []):
                    out.append({"ts": ev["ts"], "source": "ghost banking", "kind": f"ghost_{ev['kind']}", "synthetic": True,
                                "title": "Synthetic: " + ev["kind"].replace("_", " "), "actor": "contained session",
                                "detail": " · ".join(f"{k}: {v}" for k, v in (ev["details"] or {}).items() if k in ("payee", "name", "amount_paise", "reason"))})
    if st.EvidenceSessionLocal is not None and inc.ref:
        from app.evidence.models import CyberReport, LedgerEntry
        with st.EvidenceSessionLocal() as edb:
            for le in edb.scalars(select(LedgerEntry).where(LedgerEntry.incident_ref == inc.ref).order_by(LedgerEntry.seq)).all():
                out.append({"ts": le.ts, "source": "evidence vault", "kind": f"evidence_{le.event_type}", "synthetic": le.chain == "lab",
                            "title": f"Evidence {le.event_type.replace('_', ' ')}" + (f" ({(le.meta or {}).get('kind')})" if (le.meta or {}).get("kind") else ""),
                            "actor": le.actor, "detail": le.evidence_id or "", "ref": f"ledger {le.chain}#{le.seq}"})
            for r in edb.scalars(select(CyberReport).where(CyberReport.incident_ref == inc.ref)).all():
                for h in r.history or []:
                    out.append({"ts": h["at"], "source": "reporting", "kind": f"report_{h['event']}", "synthetic": r.is_lab or r.destination == "dummy",
                                "title": f"Report {r.id}: {h['event'].replace('_', ' ')}", "actor": h.get("by", ""), "detail": h.get("detail", "")})
    from datetime import datetime, timezone
    for x in out:  # one comparable representation: ISO-8601 UTC
        t = x["ts"]
        if isinstance(t, str):
            t = datetime.fromisoformat(t)
        x["ts"] = (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    out.sort(key=lambda x: x["ts"])
    return out[-limit:]
