"""Cybercrime report preparation, double confirmation, dummy submission and official manual handoff.

Destinations
  dummy     DEFAULT. Local simulated service (app.dummy_ccr). Never contacts any government system.
            Acknowledgements look like DEMO-CCR-YYYY-NNNNNN and are labelled as demonstration only.
  official  Manual handoff to the National Cyber Crime Reporting Portal (https://cybercrime.gov.in/, helpline 1930,
            operated by I4C, Ministry of Home Affairs). There is no public complaint-submission API, so SecureSynth
            never submits: it prepares the complaint and evidence package, the authorised complainant files it on the
            portal themselves (login, OTP, CAPTCHA, uploads), and an analyst records the genuine acknowledgement.
            Disabled by default (SS_OFFICIAL_REPORTING_ENABLED=false). Scenario Lab incidents are always refused.

Confirmations are bound to (report version, manifest hash, destination, analyst), expire after 10 minutes, and are
single-use. Any edit bumps the version, which invalidates them. Nothing is ever submitted because of a BLOCK."""
import io
import json
import secrets
import zipfile
from datetime import timedelta, timezone

from sqlalchemy import select, update

from app import models
from app.errors import ApiError
from app.evidence import vault
from app.evidence.models import CyberReport, EvidenceItem, ReportConfirmation
from app.services import clock

IST = timezone(timedelta(hours=5, minutes=30))
PORTAL = "https://cybercrime.gov.in/"
HELPLINE = "1930"
CONFIRM_TTL = timedelta(minutes=10)
PHRASE = {"dummy": "SUBMIT DEMO", "official": "CONFIRM REAL REPORT"}
CHECKLIST = ["reviewed_incident", "evidence_accurate", "synthetic_identified", "amounts_classified",
             "no_unverified_accusations", "destination_correct", "authorised"]
STATUS_LABEL = {"draft": "Draft", "awaiting_review": "Awaiting Review", "awaiting_final_confirmation": "Awaiting Final Confirmation",
                "approved": "Approved", "ready_for_official_submission": "Ready for Official Submission",
                "official_submission_unverified": "Official Submission Unverified", "submitted_demo": "Submitted — Demo",
                "submitted_official_confirmed": "Submitted — Officially Confirmed", "failed": "Failed", "cancelled": "Cancelled"}
EDITABLE = ("draft", "awaiting_review", "awaiting_final_confirmation")
REQUIRED = [("complaint", "category"), ("complaint", "incident_datetime_ist"), ("complaint", "institution"),
            ("complainant", "name"), ("complainant", "role"), ("description", None)]


def _hist(r: CyberReport, event: str, by: str, detail: str = "") -> None:
    r.history = list(r.history or []) + [{"at": clock.now().isoformat(), "event": event, "by": by, "detail": detail[:300]}]


def _rupees(p) -> str:
    return f"₹{(p or 0) / 100:,.2f}"


def manifest_hash(r: CyberReport, edb) -> str:
    atts = []
    for eid in r.attachments or []:
        it = edb.get(EvidenceItem, eid)
        atts.append([eid, it.content_sha256 if it else "missing"])
    return vault.sha256(vault.canonical({"report": r.id, "version": r.version, "destination": r.destination,
                                         "fields": r.fields, "attachments": atts}))


def draft_fields(db, st, inc: models.SecurityIncident, analyst: models.User, summary_text: str | None) -> tuple[dict, list[str]]:
    from app.evidence.models import EvidenceItem as E
    from app.intel import correlation
    u = db.get(models.User, inc.user_id)
    acct = db.scalar(select(models.Account).where(models.Account.user_id == inc.user_id))
    a = db.get(models.RiskAssessment, inc.assessment_id) if inc.assessment_id else None
    attempts = db.scalars(select(models.Transaction).where(models.Transaction.session_id.in_(inc.session_ids or []),
                                                           models.Transaction.status == "restricted")).all()
    with st.EvidenceSessionLocal() as edb:
        items = edb.scalars(select(E).where(E.incident_ref == inc.ref, E.deleted_at.is_(None)).order_by(E.collected_at)).all()
    net = next((i for i in items if i.kind == "network_observation"), None)
    dev = next((i for i in items if i.kind == "device_observation"), None)
    ghost = next((i for i in reversed(items) if i.kind == "ghost_activity"), None)
    g = None
    if inc.ghost and st.GhostSessionLocal is not None:
        from app.ghost import service as gs
        with st.GhostSessionLocal() as gdb:
            g = gs.monitor(gdb, inc.session_id)
    graph = correlation.build(db, st, hours=24 * 90, include_lab=inc.is_lab)
    related = [e["explanation"] for e in graph["edges"] if e["kind"] == "derived" and f"incident:{inc.ref}" in (e["source"], e["target"])]
    when = inc.created_at.astimezone(IST)
    total = sum(t.amount_paise for t in attempts)
    first = attempts[0] if attempts else None
    lines = [
        f"On {when:%d %b %Y at %H:%M} IST the reporting institution's fraud-detection system flagged a session on the account of "
        f"customer reference C{u.id:04d} (incident {inc.ref}).",
        "The session completed password and one-time-code sign-in. " + (
            f"It then attempted a transfer of {_rupees(first.amount_paise)} to payee reference "
            f"{(db.get(models.Beneficiary, first.beneficiary_id).account_ref if first and first.beneficiary_id else 'n/a')}."
            if first else "Suspicious activity was detected at sign-in."),
        (f"The behavioural risk engine scored the activity {a.risk_score:.1f} (block threshold {a.thresholds.get('block')}): "
         + ("; ".join(d["label"] for d in a.deviations) or "a rare combination of signals") + ". The risk index is not a probability.") if a else "",
        ("The suspicious transaction attempt(s) were stopped before execution. " if attempts else "")
        + ("The flagged session was then contained in an isolated synthetic banking environment (Ghost Banking); activity there "
           "was simulated and moved no real money." if inc.ghost else "The flagged session was restricted."),
        (f"While contained, the flagged session made {g['totals']['simulated_transfers']} simulated transfer(s) worth "
         f"{_rupees(g['totals']['simulated_value_paise'])} (SYNTHETIC — not real funds)." if g else ""),
        f"Analyst investigation status: {inc.status.replace('_', ' ')}; trusted-device verification: {inc.verification or 'not requested'}.",
        ("Unverified associations with other flagged activity: " + " / ".join(related[:3]) + ".") if related else "",
        "This report describes suspected unauthorised activity by a flagged session; it does not identify any person as an offender.",
    ]
    fields = {
        "complaint": {"incident_ref": inc.ref, "created_on": clock.now().astimezone(IST).strftime("%d %b %Y"),
                      "category": "Online financial fraud — suspected unauthorised access to a bank account",
                      "incident_datetime_ist": when.strftime("%d %b %Y, %H:%M IST"),
                      "institution": st.settings.reporting_institution},
        "affected_customer": {"reference": f"C{u.id:04d}", "name": None, "account_ref_masked": (acct.account_ref[:4] + "**" + acct.account_ref[-2:]) if acct else None,
                              "note": "Customer name withheld by default; include only with authorisation."},
        "complainant": {"name": analyst.display_name, "role": "Security analyst (authorised complainant on behalf of the institution)",
                        "contact": "fraud-desk@securesynth.invalid (synthetic)"},
        "description": "\n\n".join(x for x in lines if x),
        "financial": {"attempted_amount": _rupees(total), "transaction_datetime_ist": first.created_at.astimezone(IST).strftime("%d %b %Y, %H:%M IST") if first else None,
                      "transaction_references": [f"TXN-{t.id}" for t in attempts], "blocked_amount": _rupees(total),
                      "confirmed_actual_loss": _rupees(0), "prevented_exposure": _rupees(total),
                      "protected_account_integrity": "No protected funds left the account as a result of this session.",
                      "synthetic_activity": (f"SYNTHETIC (Ghost Banking, not real money): {g['totals']['simulated_transfers']} simulated transfer(s), "
                                             f"{_rupees(g['totals']['simulated_value_paise'])}") if g else "None"},
        "digital_evidence": {"observed_ip": (net.content or {}).get("ip") if net else None,
                             "ip_classification": f"{(net.content or {}).get('version')} {(net.content or {}).get('scope')}" if net else None,
                             "ip_source": (net.content or {}).get("source") if net else None,
                             "registered_device_id": (dev.content or {}).get("registered_device_id") if dev else None,
                             "browser_os": f"{(dev.content or {}).get('browser')} {(dev.content or {}).get('browser_version')} / {(dev.content or {}).get('os')} {(dev.content or {}).get('os_version')}" if dev else None,
                             "mac_address": "Unavailable — not accessible through a web browser",
                             "risk_summary": f"Risk index {a.risk_score:.1f}; ML anomaly index {a.ml_index:.1f}" if a else None,
                             "correlations": related[:5], "investigation_summary": summary_text,
                             "network_caveat": "An IP address identifies a network endpoint, not a person."},
        "disclosure": {"include_customer_name": False, "include_ip": True, "include_photo": False},
        "is_lab": bool(inc.is_lab),
    }
    attachments = [i.id for i in items if i.kind not in ("verification_photo",)]
    return fields, attachments


def validate(fields: dict) -> list[str]:
    missing = []
    for sec, key in REQUIRED:
        v = fields.get(sec) if key is None else (fields.get(sec) or {}).get(key)
        if not str(v or "").strip():
            missing.append(f"{sec}.{key}" if key else sec)
    return missing


def apply_disclosure(st, r: CyberReport, db) -> dict:
    """The fields as they would be disclosed, after the analyst's redaction choices."""
    f = json.loads(json.dumps(r.fields))
    d = f.get("disclosure", {})
    if not d.get("include_ip"):
        f["digital_evidence"]["observed_ip"] = "[withheld]"
    if d.get("include_customer_name"):
        inc = db.scalar(select(models.SecurityIncident).where(models.SecurityIncident.ref == r.incident_ref))
        f["affected_customer"]["name"] = db.get(models.User, inc.user_id).display_name if inc else None
    return f


def report_out(r: CyberReport, edb, db=None, st=None) -> dict:
    confs = edb.scalars(select(ReportConfirmation).where(ReportConfirmation.report_id == r.id).order_by(ReportConfirmation.created_at.desc())).all()
    current_hash = manifest_hash(r, edb)
    atts = []
    for eid in r.attachments or []:
        it = edb.get(EvidenceItem, eid)
        atts.append({"id": eid, "kind": it.kind if it else None, "classification": it.classification if it else None,
                     "sha256": it.content_sha256 if it else None, "missing": it is None or it.deleted_at is not None})
    now = clock.now()
    return {"id": r.id, "incident_ref": r.incident_ref, "destination": r.destination, "status": r.status,
            "status_label": STATUS_LABEL[r.status], "version": r.version, "fields": r.fields,
            "disclosed_fields": apply_disclosure(st, r, db) if db is not None else None,
            "attachments": atts, "manifest_hash": current_hash, "manifest_matches": current_hash == r.manifest_hash,
            "summary_id": r.summary_id, "created_by": r.created_by, "created_at": r.created_at, "updated_at": r.updated_at,
            "approved_by": r.approved_by, "approved_at": r.approved_at, "submitted_at": r.submitted_at,
            "ack_number": r.ack_number, "ack_evidence_id": r.ack_evidence_id, "is_lab": r.is_lab, "history": r.history,
            "missing_fields": validate(r.fields), "phrase": PHRASE[r.destination], "checklist": CHECKLIST,
            "warning": ("DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED." if r.destination == "dummy" else
                        "OFFICIAL DESTINATION: SecureSynth will NOT submit this. The authorised complainant files it on the "
                        f"National Cyber Crime Reporting Portal ({PORTAL}) themselves; for fresh financial fraud also call {HELPLINE}."),
            "portal": PORTAL if r.destination == "official" else None, "helpline": HELPLINE,
            "confirmations": [{"id": c.id, "stage": c.stage, "version": c.version, "destination": c.destination, "analyst": c.analyst,
                               "expires_at": c.expires_at, "consumed": c.consumed,
                               "valid": (not c.consumed and c.expires_at > now and c.version == r.version
                                         and c.manifest_hash == current_hash and c.destination == r.destination)} for c in confs]}


def create(db, st, inc: models.SecurityIncident, analyst: models.User, destination: str) -> CyberReport:
    if destination not in PHRASE:
        raise ApiError(422, "VALIDATION_ERROR", "Unknown destination.")
    guard_official(st, inc, destination)
    from app.evidence.models import SummaryVersion
    with st.EvidenceSessionLocal() as edb:
        sv = edb.scalar(select(SummaryVersion).where(SummaryVersion.incident_ref == inc.ref, SummaryVersion.status == "approved")
                        .order_by(SummaryVersion.version.desc()).limit(1))
    stext = " ".join(s["text"] for s in sv.sections if s["key"] == "executive") if sv else None
    fields, atts = draft_fields(db, st, inc, analyst, stext)
    now = clock.now()
    with st.EvidenceSessionLocal() as edb:
        r = CyberReport(id="RPT-" + secrets.token_hex(4).upper(), incident_ref=inc.ref, destination=destination, status="draft", version=1,
                        fields=json.loads(vault.canonical(fields)), attachments=atts, manifest_hash="", summary_id=sv.id if sv else None,
                        created_by=analyst.username, created_at=now, updated_at=now, is_lab=bool(inc.is_lab), history=[])
        r.manifest_hash = manifest_hash(r, edb)
        _hist(r, "draft_created", analyst.username, f"destination {destination}")
        edb.add(r)
        edb.commit()
        vault.append(edb, chain=vault.chain_for(r.is_lab), event_type="report_prepared", actor=analyst.username,
                     incident_ref=inc.ref, meta={"report_id": r.id, "destination": destination})
        return r


def guard_official(st, inc_or_report, destination: str) -> None:
    if destination != "official":
        return
    if getattr(inc_or_report, "is_lab", False):
        raise ApiError(403, "LAB_REPORTING_FORBIDDEN", "Scenario Lab incidents can never enter the official reporting workflow.")
    if not st.settings.official_reporting_enabled:
        raise ApiError(403, "FEATURE_DISABLED", "Official reporting is disabled (SS_OFFICIAL_REPORTING_ENABLED=false).")


def update_fields(edb, st, r: CyberReport, analyst: str, fields: dict | None, destination: str | None,
                  attachments: list[str] | None, expected_version: int) -> CyberReport:
    if r.status not in EDITABLE:
        raise ApiError(409, "REPORT_LOCKED", f"A report in status '{STATUS_LABEL[r.status]}' can no longer be edited.")
    if expected_version != r.version:
        raise ApiError(409, "REPORT_CONFLICT", "The report changed since you loaded it. Reload and review again.")
    if destination:
        guard_official(st, r, destination)
        r.destination = destination
    if fields is not None:
        fields = json.loads(vault.canonical(fields))
        fields["is_lab"] = r.is_lab  # never editable
        if len(vault.canonical(fields)) > 200_000:
            raise ApiError(413, "VALIDATION_ERROR", "Report too large.")
        r.fields = fields
    if attachments is not None:
        for eid in attachments:
            it = edb.get(EvidenceItem, eid)
            if it is None or it.incident_ref != r.incident_ref or it.deleted_at is not None:
                raise ApiError(422, "VALIDATION_ERROR", f"Attachment {eid[:20]} is not evidence of this incident.")
        r.attachments = list(dict.fromkeys(attachments))
    res = edb.execute(update(CyberReport).where(CyberReport.id == r.id, CyberReport.version == expected_version)
                      .values(version=expected_version + 1))
    if res.rowcount != 1:
        edb.rollback()
        raise ApiError(409, "REPORT_CONFLICT", "The report changed since you loaded it. Reload and review again.")
    r.version = expected_version + 1
    r.status, r.updated_at = "draft", clock.now()  # any change needs a fresh review and fresh confirmations
    r.manifest_hash = manifest_hash(r, edb)
    _hist(r, "edited", analyst, f"version {r.version}" + (f", destination {destination}" if destination else ""))
    edb.commit()
    return r


def submit_for_review(edb, r: CyberReport, analyst: str) -> CyberReport:
    if r.status not in ("draft", "awaiting_review"):
        raise ApiError(409, "REPORT_LOCKED", "Only a draft can be submitted for review.")
    missing = validate(r.fields)
    if missing:
        raise ApiError(422, "VALIDATION_ERROR", "Complete the required fields: " + ", ".join(missing))
    r.status, r.updated_at = "awaiting_review", clock.now()
    _hist(r, "submitted_for_review", analyst)
    edb.commit()
    return r


def _check_binding(edb, r: CyberReport, version: int, mhash: str, destination: str) -> None:
    if version != r.version or destination != r.destination or mhash != manifest_hash(r, edb) or mhash != r.manifest_hash:
        raise ApiError(409, "CONFIRMATION_STALE", "The report, its evidence or its destination changed. Review it again.")


def confirm_first(edb, st, r: CyberReport, analyst: str, version: int, mhash: str, destination: str, checklist: dict) -> ReportConfirmation:
    if r.status != "awaiting_review":
        raise ApiError(409, "REPORT_LOCKED", "Submit the report for review first.")
    guard_official(st, r, destination)
    _check_binding(edb, r, version, mhash, destination)
    if not all(checklist.get(k) is True for k in CHECKLIST):
        raise ApiError(422, "CONFIRMATION_INCOMPLETE", "Every confirmation statement must be ticked.")
    now = clock.now()
    c = ReportConfirmation(id="CF-" + secrets.token_hex(8), report_id=r.id, stage="first", version=r.version, manifest_hash=mhash,
                           destination=destination, analyst=analyst, created_at=now, expires_at=now + CONFIRM_TTL, checklist=checklist)
    edb.add(c)
    r.status, r.updated_at = "awaiting_final_confirmation", now
    _hist(r, "first_confirmation", analyst, f"version {r.version}")
    edb.commit()
    return c


def confirm_final(db, edb, st, r: CyberReport, analyst: models.User, first_id: str, version: int, mhash: str, destination: str,
                  phrase: str, reason: str) -> dict:
    """Consumes the first confirmation exactly once, then executes ONLY the destination's workflow."""
    guard_official(st, r, destination)
    if r.status != "awaiting_final_confirmation":
        if r.status in ("submitted_demo", "ready_for_official_submission") and r.version == version:
            return {"idempotent": True, "status": r.status, "ack_number": r.ack_number}
        raise ApiError(409, "REPORT_LOCKED", "The report is not awaiting final confirmation.")
    _check_binding(edb, r, version, mhash, destination)
    if phrase != PHRASE[destination]:
        raise ApiError(422, "CONFIRMATION_PHRASE", f"Type the confirmation phrase exactly: {PHRASE[destination]}")
    first = edb.get(ReportConfirmation, first_id)
    now = clock.now()
    if (first is None or first.report_id != r.id or first.stage != "first" or first.version != version or first.destination != destination
            or first.manifest_hash != mhash or first.expires_at <= now):
        raise ApiError(409, "CONFIRMATION_STALE", "The first confirmation is missing, expired or for a different version.")
    consumed = edb.execute(update(ReportConfirmation).where(ReportConfirmation.id == first_id, ReportConfirmation.consumed.is_(False))
                           .values(consumed=True))
    locked = edb.execute(update(CyberReport).where(CyberReport.id == r.id, CyberReport.status == "awaiting_final_confirmation",
                                                   CyberReport.version == version).values(status="approved"))
    if consumed.rowcount != 1 or locked.rowcount != 1:  # replay or concurrent double submission
        edb.rollback()
        raise ApiError(409, "DUPLICATE_SUBMISSION", "This confirmation was already used; the report is being or has been submitted.")
    edb.add(ReportConfirmation(id="CF-" + secrets.token_hex(8), report_id=r.id, stage="final", version=version, manifest_hash=mhash,
                               destination=destination, analyst=analyst.username, created_at=now, expires_at=now, consumed=True,
                               reason=reason))
    edb.commit()
    edb.refresh(r)
    r.approved_by, r.approved_at = analyst.username, now
    _hist(r, "final_confirmation", analyst.username, reason)
    if destination == "dummy":
        from app.dummy_ccr import service as ccr
        payload = {**apply_disclosure(st, r, db)["complaint"], "description": r.fields.get("description"),
                   "complainant": json.dumps(r.fields.get("complainant")), "financial": r.fields.get("financial"),
                   "report_id": r.id, "version": r.version, "manifest_sha256": mhash}
        try:
            with st.CCRSessionLocal() as cdb:
                c, created = ccr.submit(cdb, r.id, payload, len(r.attachments or []), r.is_lab)
                ack, status = c.ack_ref, c.status
        except ApiError as e:
            r.status = "failed"
            _hist(r, "submission_failed", "demo service", e.message)
            edb.commit()
            raise
        r.status, r.submitted_at, r.ack_number = "submitted_demo", now, ack
        _hist(r, "submitted_demo", "demo service", f"acknowledgement {ack} (synthetic)")
        edb.commit()
        vault.append(edb, chain=vault.chain_for(r.is_lab), event_type="report_submitted_demo", actor=analyst.username,
                     incident_ref=r.incident_ref, meta={"report_id": r.id, "ack": ack, "manifest_sha256": mhash})
        return {"idempotent": not created, "status": r.status, "ack_number": ack, "demo_status": status,
                "warning": "DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED."}
    r.status = "ready_for_official_submission"
    _hist(r, "ready_for_official_submission", analyst.username, "Manual filing by the authorised complainant required")
    edb.commit()
    vault.append(edb, chain="genuine", event_type="report_handoff_prepared", actor=analyst.username, incident_ref=r.incident_ref,
                 meta={"report_id": r.id, "manifest_sha256": mhash})
    return {"idempotent": False, "status": r.status, "portal": PORTAL, "helpline": HELPLINE,
            "note": "Nothing has been filed. Open the portal, sign in as the authorised complainant, complete OTP and uploads, "
                    "submit there, then record the acknowledgement here."}


def export(db, edb, st, r: CyberReport, fmt: str, analyst: str) -> tuple[bytes, str, str]:
    from app.intel import timeline
    inc = db.scalar(select(models.SecurityIncident).where(models.SecurityIncident.ref == r.incident_ref))
    f = apply_disclosure(st, r, db)
    custody = vault.custody(edb, r.incident_ref)
    man = vault.manifest(edb, r.incident_ref)
    integrity = vault.verify(edb, st, analyst, r.incident_ref)
    struct = {"format": "securesynth.incident-report.v1", "generated_at": clock.now().isoformat(), "report_id": r.id, "version": r.version,
              "destination": r.destination, "status": STATUS_LABEL[r.status], "is_lab": r.is_lab, "fields": f,
              "attachments": [a for a in report_out(r, edb)["attachments"]], "manifest_hash": manifest_hash(r, edb),
              "integrity": {"status": integrity["status"], "checked_at": integrity["checked_at"].isoformat(),
                            "problems": integrity["problems"]},
              "approval": {"approved_by": r.approved_by, "approved_at": r.approved_at.isoformat() if r.approved_at else None},
              "notice": ("DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED." if r.destination == "dummy" else
                         "Prepared for manual filing on the National Cyber Crime Reporting Portal; SecureSynth does not submit."),
              "limitations": ["Synthetic prototype data", "Risk index is not a probability", "IP address does not identify a person",
                              "MAC address unavailable through a web browser", "Correlations are leads, not proof",
                              "Integrity hashing is tamper-evident, not immutable"]}
    if fmt == "json":
        data, mime, name = vault.canonical(struct), "application/json", f"{r.id}-v{r.version}.json"
    else:
        blocks = [("warn", struct["notice"]),
                  ("small", f"Report {r.id} v{r.version} - incident {r.incident_ref} - status {STATUS_LABEL[r.status]} - generated {struct['generated_at']}"),
                  ("h2", "Executive summary"), ("p", f["digital_evidence"].get("investigation_summary") or "No approved investigation summary attached."),
                  ("h2", "Complaint details"), ("p", "\n".join(f"{k.replace('_', ' ').title()}: {v}" for k, v in f["complaint"].items())),
                  ("p", "Complainant: " + ", ".join(str(v) for v in f["complainant"].values())),
                  ("h2", "Incident description"), ("p", f["description"]),
                  ("h2", "Financial details"), ("p", "\n".join(f"{k.replace('_', ' ').title()}: {', '.join(v) if isinstance(v, list) else v}" for k, v in f["financial"].items())),
                  ("h2", "Digital evidence"), ("p", "\n".join(f"{k.replace('_', ' ').title()}: {', '.join(map(str, v)) if isinstance(v, list) else v}"
                                                              for k, v in f["digital_evidence"].items() if k != "investigation_summary")),
                  ("h2", "Evidence integrity"), ("p", f"Status: {integrity['status']} ({len(integrity['problems'])} problem(s)). Manifest SHA-256: {man['manifest_sha256']}"),
                  ("mono", "\n".join(f"{i['evidence_id']}  {i['kind']:<22} {i['classification']:<10} {i['sha256']}" for i in man["items"])),
                  ("h2", "Chronological timeline"), ("small", "\n".join(f"{e['ts'][:19]}  {e['title']}" for e in timeline.build(db, st, inc)[-60:]) if inc else ""),
                  ("h2", "Chain of custody"), ("mono", "\n".join(f"{c['chain']}#{c['seq']} {str(c['ts'])[:19]} {c['event_type']:<24} {c['actor']:<16} {c['entry_hash'][:16]}" for c in custody[-60:])),
                  ("h2", "Limitations"), ("p", "\n".join("- " + x for x in struct["limitations"])),
                  ("h2", "Approval"), ("p", f"Approved by: {r.approved_by or 'not yet approved'} at {struct['approval']['approved_at'] or '-'}")]
        pdf = __import__("app.intel.pdf", fromlist=["render"]).render(f"Incident report {r.incident_ref}", blocks,
                                                                      f"SecureSynth - {r.id} v{r.version} - {'DEMO' if r.destination == 'dummy' else 'for manual filing'}")
        if fmt == "pdf":
            data, mime, name = pdf, "application/pdf", f"{r.id}-v{r.version}.pdf"
        else:
            files = {"report.pdf": pdf, "incident.json": vault.canonical(struct),
                     "transactions.json": vault.canonical([i for i in (edb.get(EvidenceItem, a).content if edb.get(EvidenceItem, a) else None
                                                                      for a in r.attachments or []) if i and "transaction_id" in i]),
                     "timeline.json": vault.canonical(timeline.build(db, st, inc) if inc else []),
                     "custody.json": vault.canonical(custody),
                     "notes.json": vault.canonical([i.content for i in vault.items_for(edb, r.incident_ref) if i.kind == "investigation_note"]),
                     "correlations.json": vault.canonical(f["digital_evidence"].get("correlations") or []),
                     "README.txt": (struct["notice"] + "\nVerify every file against manifest.json (SHA-256). Contains no passwords, OTP secrets, "
                                    "session tokens or keys.\n").encode()}
            if f["disclosure"].get("include_photo"):
                for it in vault.items_for(edb, r.incident_ref):
                    if it.kind == "verification_photo" and it.id in (r.attachments or []):
                        files[f"photo-{it.id}.{'png' if it.mime == 'image/png' else 'jpg'}"] = vault.read_blob(st, it)
                        vault.record_access(edb, it, analyst, "exported", {"report_id": r.id})
            manifest = {name_: vault.sha256(b) for name_, b in files.items()}
            files["manifest.json"] = vault.canonical({"algorithm": "SHA-256", "files": manifest, "report_manifest_hash": struct["manifest_hash"]})
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for n, b in files.items():
                    z.writestr(n, b)
            data, mime, name = buf.getvalue(), "application/zip", f"{r.id}-v{r.version}-evidence.zip"
    vault.append(edb, chain=vault.chain_for(r.is_lab), event_type=f"report_exported_{fmt}", actor=analyst, incident_ref=r.incident_ref,
                 content_hash=vault.sha256(data), meta={"report_id": r.id, "version": r.version, "file": name})
    _hist(r, f"exported_{fmt}", analyst, name)
    edb.commit()
    return data, mime, name
