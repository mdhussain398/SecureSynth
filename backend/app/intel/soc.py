"""Live SOC metrics, computed from records on every request (no stored counters, so nothing can drift).

Money is kept in four separate buckets that are never added together:
  protected_completed  real money that left protected accounts (normal banking),
  prevented_exposure   protected transfer attempts that were stopped and never executed (each transaction row once,
                       so retries with the same idempotency key cannot double-count),
  confirmed_loss       completed protected transfers made by sessions an analyst judged suspicious
                       (incident retained or revoked): an analyst-confirmed figure, 0 until someone decides,
  synthetic_value      Ghost Banking transfers (fake money; never real).
Scenario Lab records are included only when include_lab=true and are always counted separately as well."""
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app import models
from app.services import clock

RANGES = {"1h": (timedelta(hours=1), timedelta(minutes=5)), "24h": (timedelta(hours=24), timedelta(hours=1)),
          "7d": (timedelta(days=7), timedelta(hours=12)), "30d": (timedelta(days=30), timedelta(days=1))}
DEFINITIONS = {
    "monitored_sessions": "Authenticated sessions created in the range (pre-OTP sign-in attempts excluded).",
    "active_sessions": "Sessions that are currently usable (not expired, not idle, not revoked).",
    "suspicious_sessions": "Sessions with at least one STEP_UP or BLOCK assessment in the range.",
    "active_ghost_sessions": "Live sessions currently contained in Ghost Banking.",
    "restricted_sessions": "Live sessions currently restricted.",
    "pending_incidents": "Incidents awaiting an analyst decision (pending review or verification requested).",
    "resolved_incidents": "Incidents created in the range that have an analyst decision.",
    "blocked_attempts": "Protected transfer attempts stopped by the engine or a denied check (each transaction once).",
    "prevented_exposure_paise": "Sum of those stopped attempts. Never executed, so never lost.",
    "confirmed_loss_paise": "Completed protected transfers by sessions in incidents an analyst retained or revoked.",
    "synthetic_value_paise": "Ghost Banking simulated transfers. Fake money, shown separately, never added to real figures.",
    "pending_verifications": "Open trusted-device checks plus open photograph requests.",
    "integrity_alerts": "Evidence integrity problems detected in the range.",
}


def _since(range_key: str, start: str | None, end: str | None):
    now = clock.now()
    if range_key == "custom" and start:
        s = datetime.fromisoformat(start)
        e = datetime.fromisoformat(end) if end else now
        s, e = (s if s.tzinfo else s.replace(tzinfo=timezone.utc)), (e if e.tzinfo else e.replace(tzinfo=timezone.utc))
        span = e - s
        step = timedelta(hours=1) if span <= timedelta(days=2) else timedelta(days=1)
        return s, e, step
    span, step = RANGES.get(range_key, RANGES["24h"])
    return now - span, now, step


def _ms(td) -> float:
    return round(td.total_seconds() * 1000, 1)


def metrics(db, st, range_key: str = "24h", include_lab: bool = True, start: str | None = None, end: str | None = None) -> dict:
    since, until, step = _since(range_key, start, end)
    now = clock.now()
    S, I, T, A = models.Session, models.SecurityIncident, models.Transaction, models.RiskAssessment

    def lab_ok(q, col):
        return q if include_lab else q.where(col.is_(False))

    sessions = db.scalars(lab_ok(select(S).where(S.mode != "pre_otp", S.created_at >= since, S.created_at <= until), S.is_lab)).all()
    sess_ids = {s.id for s in sessions}
    idle = timedelta(minutes=st.settings.session_idle_min)
    live = [s for s in db.scalars(lab_ok(select(S).where(S.mode.in_(("normal", "step_up", "restricted", "ghost"))), S.is_lab)).all()
            if s.expires_at > now and now - s.last_seen <= idle]
    assessments = db.scalars(select(A).where(A.ts >= since, A.ts <= until)).all()
    lab_sessions = {r for (r,) in db.execute(select(S.id).where(S.is_lab.is_(True))).all()}
    if not include_lab:
        assessments = [a for a in assessments if a.session_id not in lab_sessions]
    incidents = db.scalars(lab_ok(select(I).where(I.created_at >= since, I.created_at <= until), I.is_lab)).all()
    blocked = [t for t in db.scalars(select(T).where(T.status == "restricted", T.created_at >= since, T.created_at <= until)).all()
               if include_lab or t.session_id not in lab_sessions]
    judged = [i for i in db.scalars(lab_ok(select(I).where(I.status.in_(("restriction_retained", "session_revoked"))), I.is_lab)).all()]
    judged_sessions = {sid for i in judged for sid in (i.session_ids or [])}
    loss = sum(t.amount_paise for t in db.scalars(select(T).where(T.status == "completed", T.session_id.in_(judged_sessions),
                                                                  T.created_at >= since, T.created_at <= until)).all())
    protected_completed = sum(t.amount_paise for t in db.scalars(select(T).where(
        T.status == "completed", T.session_id.in_(sess_ids), T.created_at >= since, T.created_at <= until)).all())

    synthetic_value, ghost_events = 0, []
    if st.GhostSessionLocal is not None:
        from app.ghost.models import GhostAccount, GhostEvent, GhostTransaction
        with st.GhostSessionLocal() as gdb:
            acc = {a.id: a.session_id for a in gdb.scalars(select(GhostAccount)).all()}
            rows = gdb.scalars(select(GhostTransaction).where(GhostTransaction.origin == "session", GhostTransaction.created_at >= since,
                                                              GhostTransaction.created_at <= until)).all()
            synthetic_value = sum(t.amount_paise for t in rows if include_lab or acc.get(t.ghost_account_id) not in lab_sessions)
            ghost_events = [e for e in gdb.scalars(select(GhostEvent).where(GhostEvent.ts >= since, GhostEvent.ts <= until)).all()
                            if include_lab or acc.get(e.ghost_account_id) not in lab_sessions]

    alerts, reports, photos_pending = [], [], 0
    if st.EvidenceSessionLocal is not None:
        from app.evidence.models import CyberReport, IntegrityAlert, PhotoRequest
        with st.EvidenceSessionLocal() as edb:
            alerts = [a for a in edb.scalars(select(IntegrityAlert).where(IntegrityAlert.ts >= since, IntegrityAlert.ts <= until)).all()
                      if include_lab or not a.is_lab]
            reports = [r for r in edb.scalars(select(CyberReport).where(CyberReport.created_at >= since, CyberReport.created_at <= until)).all()
                       if include_lab or not r.is_lab]
            photos_pending = sum(1 for p in edb.scalars(select(PhotoRequest).where(PhotoRequest.status == "pending")).all()
                                 if p.expires_at > now and (include_lab or not p.is_lab))

    open_inc = db.scalars(lab_ok(select(I).where(I.status.in_(("pending_review", "verification_requested"))), I.is_lab)).all()
    kpis = {
        "monitored_sessions": len(sessions), "active_sessions": len(live),
        "suspicious_sessions": len({a.session_id for a in assessments if a.decision in ("STEP_UP", "BLOCK")}),
        "active_ghost_sessions": sum(1 for s in live if s.mode == "ghost"),
        "restricted_sessions": sum(1 for s in live if s.mode == "restricted"),
        "pending_incidents": len(open_inc), "resolved_incidents": sum(1 for i in incidents if i.resolved_at),
        "blocked_attempts": len(blocked), "prevented_exposure_paise": sum(t.amount_paise for t in blocked),
        "confirmed_loss_paise": loss, "protected_completed_paise": protected_completed, "synthetic_value_paise": synthetic_value,
        "pending_verifications": sum(1 for i in open_inc if i.status == "verification_requested") + photos_pending,
        "integrity_alerts": len(alerts), "reports_prepared": len(reports),
        "dummy_submitted": sum(1 for r in reports if r.status == "submitted_demo"),
        "official_confirmed": sum(1 for r in reports if r.status == "submitted_official_confirmed"),
        "lab_incidents_in_range": sum(1 for i in incidents if i.is_lab),
    }

    lat = [a.latency_ms for a in assessments]
    trig = {a.id: a for a in db.scalars(select(A).where(A.id.in_([i.assessment_id for i in incidents if i.assessment_id]))).all()}
    d2c = [_ms(i.created_at - trig[i.assessment_id].ts) for i in incidents if i.assessment_id in trig]
    reviewed = {}
    for e in db.scalars(select(models.AuditEvent).where(models.AuditEvent.event_type == "incident.reviewed", models.AuditEvent.ts >= since)).all():
        iid = (e.details or {}).get("incident_id")
        reviewed.setdefault(iid, e.ts)
    resp = [(reviewed[i.id] - i.created_at).total_seconds() for i in incidents if i.id in reviewed]
    reso = [(i.resolved_at - i.created_at).total_seconds() for i in incidents if i.resolved_at]

    def stat(xs, unit):
        return {"value": round(statistics.mean(xs), 2) if xs else None, "median": round(statistics.median(xs), 2) if xs else None,
                "n": len(xs), "unit": unit}
    performance = {
        "risk_assessment_latency_ms": stat(lat, "ms"), "detection_to_containment_ms": stat(d2c, "ms"),
        "analyst_response_s": stat(resp, "s"), "incident_resolution_s": stat(reso, "s"),
        "notification_delay": {"value": None, "unit": "s", "n": 0,
                               "note": "Not measurable server-side: the console polls every 4 s, so the delay is at most about 4 s."},
    }

    buckets = []
    t = since
    while t < until and len(buckets) < 200:
        buckets.append(t)
        t += step

    def bi(ts):
        return min(int((ts - since) / step), len(buckets) - 1) if buckets else 0

    series = [{"t": b.isoformat(), "ALLOW": 0, "STEP_UP": 0, "BLOCK": 0, "incidents": 0, "ghost": 0, "restricted": 0,
               "prevented_paise": 0, "resolved": 0, "ghost_events": 0} for b in buckets]
    if buckets:
        for a in assessments:
            series[bi(a.ts)][a.decision] += 1
        for i in incidents:
            row = series[bi(i.created_at)]
            row["incidents"] += 1
            row["ghost" if i.ghost else "restricted"] += 1
            if i.resolved_at and since <= i.resolved_at <= until:
                series[bi(i.resolved_at)]["resolved"] += 1
        for tr in blocked:
            series[bi(tr.created_at)]["prevented_paise"] += tr.amount_paise
        for e in ghost_events:
            series[bi(e.ts)]["ghost_events"] += 1

    feed = []
    for i in db.scalars(lab_ok(select(I).order_by(I.last_activity_at.desc()).limit(15), I.is_lab)).all():
        u = db.get(models.User, i.user_id)
        feed.append({"ts": i.last_activity_at, "kind": "incident", "title": f"{i.ref} · {u.display_name}: {i.status.replace('_', ' ')}",
                     "detail": f"{'Ghost Banking' if i.ghost else 'Restricted'} · risk {i.risk_score or 0:.1f} · {i.severity}",
                     "incident_id": i.id, "lab": i.is_lab, "severity": i.severity})
    for a in alerts[-10:]:
        feed.append({"ts": a.ts, "kind": "integrity", "title": "Evidence integrity alert", "detail": a.detail, "lab": a.is_lab,
                     "severity": "critical", "incident_id": None})
    for r in reports[-10:]:
        feed.append({"ts": r.updated_at, "kind": "report", "title": f"Report {r.id}: {r.status.replace('_', ' ')}",
                     "detail": "Demo destination" if r.destination == "dummy" else "Official handoff", "lab": r.is_lab,
                     "severity": "info", "incident_id": None})
    feed.sort(key=lambda x: x["ts"].isoformat() if hasattr(x["ts"], "isoformat") else str(x["ts"]), reverse=True)

    return {"range": {"key": range_key, "since": since, "until": until, "step_s": int(step.total_seconds())}, "include_lab": include_lab,
            "kpis": kpis, "definitions": DEFINITIONS, "performance": performance, "series": series,
            "severity": dict(Counter(i.severity for i in incidents)),
            "decisions": dict(Counter(a.decision for a in assessments)),
            "report_status": dict(Counter(r.status for r in reports)), "feed": feed[:30], "generated_at": now}
