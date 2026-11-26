"""Scenario Lab: each scenario drives the REAL HTTP API (auth, risk engine, enforcement, ledger) in-process.
Nothing here computes a score or decision itself; it only plays the customer / attacker / trusted device."""
import json
import uuid
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

import pyotp
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import models
from app.risk import features as F
from app.risk import policy
from app.security import tokens
from app.services import clock

SCENARIOS = {
    "normal_customer": {
        "title": "Normal customer", "expected": "ALLOW, no friction",
        "narrative": "Recognised browser, home city, usual hour; pays an established payee a usual amount.",
        "params": [{"key": "username", "label": "Customer", "type": "select", "value": "asha",
                    "options": ["asha", "ravi", "meera", "farhan"]}]},
    "takeover_despite_totp": {
        "title": "Takeover despite password + TOTP", "expected": "STEP_UP or BLOCK; protected balance unchanged",
        "narrative": "Attacker has the password and relays a valid OTP, from an unrecognised browser at an odd hour, "
                     "then tries to add a payee and move money.",
        "params": [{"key": "username", "label": "Victim", "type": "select", "value": "ravi",
                    "options": ["asha", "ravi", "meera", "farhan"]},
                   {"key": "city", "label": "Attacker city (simulated)", "type": "select", "value": "Pune",
                    "options": sorted(F.CITY_COORDS)},
                   {"key": "hour", "label": "Local hour", "type": "number", "value": 3, "min": 0, "max": 23}]},
    "suspicious_after_login": {
        "title": "Suspicious activity after a legitimate login", "expected": "Login ALLOW, then STEP_UP/BLOCK and backend restriction",
        "narrative": "Session starts normally, then a new payee is added and a large transfer is attempted within a minute.",
        "params": [{"key": "username", "label": "Customer", "type": "select", "value": "asha",
                    "options": ["asha", "ravi", "meera", "farhan"]},
                   {"key": "amount_rupees", "label": "Transfer (₹)", "type": "number", "value": 90000, "min": 100, "max": 500000}]},
    "genuine_traveller": {
        "title": "Genuine traveller", "expected": "STEP_UP, approved on trusted device, then completes",
        "narrative": "Real customer, recognised browser, signs in from another city and verifies on their trusted device.",
        "params": [{"key": "username", "label": "Customer", "type": "select", "value": "meera",
                    "options": ["asha", "ravi", "meera", "farhan"]},
                   {"key": "city", "label": "Travel city (simulated)", "type": "select", "value": "Singapore",
                    "options": sorted(F.CITY_COORDS)}]},
    "new_device": {
        "title": "Customer on a new device", "expected": "STEP_UP, approved, then ALLOW",
        "narrative": "Real customer bought a new laptop: unrecognised browser, home city, usual hour.",
        "params": [{"key": "username", "label": "Customer", "type": "select", "value": "ravi",
                    "options": ["asha", "ravi", "meera", "farhan"]}]},
    "ghost_banking": {
        "title": "Ghost Banking containment", "expected": "BLOCK → contained in Ghost Banking; simulated payee and transfer; protected balance unchanged",
        "narrative": "An attacker with the password and a relayed OTP is blocked at sign-in. With Ghost Banking enabled the session is "
                     "contained: it sees a synthetic account, adds a payee and 'sends' money, all on the isolated ghost ledger. "
                     "Requires GHOST_BANKING_ENABLED (off by default, pending mentor approval); otherwise the session is restricted.",
        "params": [{"key": "username", "label": "Victim", "type": "select", "value": "farhan",
                    "options": ["asha", "ravi", "meera", "farhan"]},
                   {"key": "city", "label": "Attacker city (simulated)", "type": "select", "value": "Lagos",
                    "options": sorted(F.CITY_COORDS)},
                   {"key": "hour", "label": "Local hour", "type": "number", "value": 3, "min": 0, "max": 23},
                   {"key": "amount_rupees", "label": "Transfer (₹)", "type": "number", "value": 40000, "min": 100, "max": 500000}]},
    "advanced_escalation": {
        "title": "Advanced Ghost Banking and cybercrime escalation",
        "expected": "BLOCK → contained; evidence + synthetic photo + approved summary; DEMO report submitted (DEMO-CCR); resolved; balance unchanged",
        "narrative": "A takeover is contained, evidence is collected, a consented verification photograph (synthetic fixture) is "
                     "received, a summary is approved and a demonstration complaint is filed with the simulated service — never a "
                     "real government system. Analyst steps use the service layer as the signed-in presenter.",
        "params": [{"key": "username", "label": "Victim", "type": "select", "value": "farhan", "options": ["asha", "ravi", "meera", "farhan"]},
                   {"key": "city", "label": "Attacker city (simulated)", "type": "select", "value": "Lagos", "options": sorted(F.CITY_COORDS)},
                   {"key": "hour", "label": "Local hour", "type": "number", "value": 3, "min": 0, "max": 23},
                   {"key": "amount_rupees", "label": "Transfer (₹)", "type": "number", "value": 60000, "min": 100, "max": 500000}]},
    "correlated_investigation": {
        "title": "Correlated fraud investigation",
        "expected": "Three flagged sessions share a synthetic IP, a browser cookie and a payee → correlated incidents with explanations",
        "narrative": "One attacker browser (synthetic address 203.0.113.77) targets three customers and adds the same payee. The "
                     "correlation graph links the incidents with explained, graded relationships — leads, not proof.",
        "params": [{"key": "username", "label": "First victim", "type": "select", "value": "asha", "options": ["asha", "ravi", "meera", "farhan"]}]},
    "evidence_tamper": {
        "title": "Evidence integrity and tamper detection",
        "expected": "Fixture verified → controlled modification of the synthetic fixture → mismatch detected and alerted",
        "narrative": "A synthetic evidence fixture is hashed and chained, verified, then deliberately modified on disk. Verification "
                     "reports the mismatch and records an alert. Only the isolated Lab fixture is touched; genuine evidence never is.",
        "params": [{"key": "username", "label": "Customer (context only)", "type": "select", "value": "asha", "options": ["asha", "ravi", "meera", "farhan"]}]},
    "live_soc": {
        "title": "Live SOC and intelligent investigation",
        "expected": "SOC metrics move with real events; a grounded summary with evidence references; a report draft",
        "narrative": "A normal payment, a new-device sign-in and a takeover run back to back. The SOC metrics are read before and after, "
                     "then a deterministic investigation summary and a demonstration complaint draft are prepared for the takeover.",
        "params": [{"key": "username", "label": "Takeover victim", "type": "select", "value": "meera", "options": ["asha", "ravi", "meera", "farhan"]}]},
    "unusual_legit_transfer": {
        "title": "Unusual but legitimate transfer", "expected": "Friction grows with the amount; vary it and watch the decision recompute",
        "narrative": "Established payee, recognised browser, but an amount far above the customer's usual range.",
        "params": [{"key": "username", "label": "Customer", "type": "select", "value": "farhan",
                    "options": ["asha", "ravi", "meera", "farhan"]},
                   {"key": "amount_rupees", "label": "Transfer (₹)", "type": "number", "value": 150000, "min": 100, "max": 900000}]},
}


def catalogue() -> list[dict]:
    return [{"id": k, **{f: v[f] for f in ("title", "narrative", "expected", "params")}} for k, v in SCENARIOS.items()]


@contextmanager
def at_local_hour(hour: int | None):
    """Temporarily move the simulated clock so the customer-local hour equals `hour`."""
    if hour is None:
        yield
        return
    saved = clock._lab_shift
    local = clock.now().astimezone(F.LOCAL_TZ)
    delta = (hour - local.hour) % 24
    clock.set_lab_shift(saved + timedelta(hours=delta - 24 if delta > 12 else delta))  # Lab-runner requests only
    try:
        yield
    finally:
        clock.set_lab_shift(saved)


class Runner:
    def __init__(self, app, st, db, username: str):
        self.app, self.st, self.db = app, st, db
        self.user = db.scalar(select(models.User).where(models.User.username == username))
        if self.user is None or self.user.role != "customer":
            raise ValueError("unknown customer")
        creds = json.loads(Path(st.settings.demo_credentials).read_text())[username]
        self.password, self.device_key, self.home_cookie = creds["password"], creds["trusted_device_key"], creds["home_browser_cookie"]
        self.steps: list[dict] = []
        # every Lab-runner request carries the in-process lab token, so the scenario's time shift applies to it alone
        self.client = TestClient(app, base_url="http://127.0.0.1:8000", headers={"X-Lab-Token": st.lab_token})
        self.ctx: dict = {}

    # ---- helpers
    def _headers(self):
        h = {"X-CSRF-Token": self.client.cookies.get("ss_csrf") or "", "X-Lab-Token": self.st.lab_token}
        if self.ctx:
            h["X-Sim-Context"] = json.dumps(self.ctx)
        return h

    def session(self):
        raw = self.client.cookies.get("ss_session")
        return self.db.scalar(select(models.Session).where(models.Session.token_hash == tokens.hash_token(raw or "")))

    def _latest(self):
        s = self.session()
        if s is None:
            return None
        self.db.expire_all()
        return self.db.scalar(select(models.RiskAssessment).where(models.RiskAssessment.session_id == s.id)
                              .order_by(models.RiskAssessment.id.desc()).limit(1))

    def _record(self, actor, action, method, path, r, assessed=False, note=""):
        a = self._latest() if assessed else None
        s = self.session()
        if s is not None and s.mode == "ghost" and not note:  # label contained activity for the presenter
            note = ("contained in Ghost Banking (the session is shown an ordinary sign-in)" if path == "/api/auth/totp"
                    else f"simulated in Ghost Banking: {_note(r) or r.status_code}")
        self.steps.append({"n": len(self.steps) + 1, "actor": actor, "action": action,
                           "http": {"method": method, "path": path, "status": r.status_code},
                           "decision": a.decision if a else None, "risk_score": a.risk_score if a else None,
                           "note": note or _note(r)})
        return r

    def balance(self) -> int:
        self.db.expire_all()
        return self.db.scalar(select(models.Account.balance_paise).where(models.Account.user_id == self.user.id))

    def established_payee(self) -> int:
        return self.db.scalar(select(models.Beneficiary.id).where(models.Beneficiary.user_id == self.user.id,
                                                                  models.Beneficiary.trust == "trusted"))

    def usual_hour(self) -> int:
        b = self.db.get(models.Baseline, self.user.id)
        prof = b.trusted["hour_profile"]
        return max(range(24), key=lambda h: prof[h])

    def _fresh_code(self) -> str:
        """Simulated relay/authenticator: a code the server has not seen yet (respects replay protection).
        Uses the next time-step inside the ±1 drift window, waiting only when that is exhausted."""
        import time
        secret = self.st.box.decrypt(self.user.totp_secret_enc)
        self.db.expire_all()
        last = self.db.get(models.User, self.user.id).totp_last_step
        while True:
            current = int(time.time()) // 30
            step = current if last is None or last < current else last + 1
            if step <= current + 1:
                return pyotp.TOTP(secret).generate_otp(step)
            time.sleep(1)

    # ---- actions
    def wait(self, seconds: int, actor: str):
        """Realistic dwell time on the simulated clock (customers browse for minutes; attackers act in seconds)."""
        clock.advance(seconds=seconds)
        self.steps.append({"n": len(self.steps) + 1, "actor": actor, "action": f"{seconds // 60} min {seconds % 60} s later",
                           "http": {"method": "-", "path": "(simulated time)", "status": 0}, "decision": None,
                           "risk_score": None, "note": "simulated clock"})

    def browser(self, recognised: bool):
        if recognised:
            self.client.cookies.set("ss_device", self.home_cookie, domain="127.0.0.1", path="/api")

    def login(self, actor):
        r = self.client.post("/api/auth/login", json={"username": self.user.username, "password": self.password},
                             headers=self._headers())
        self._record(actor, "Enter correct password", "POST", "/api/auth/login", r)
        r = self.client.post("/api/auth/totp", json={"code": self._fresh_code()}, headers=self._headers())
        return self._record(actor, "Enter valid TOTP code", "POST", "/api/auth/totp", r, assessed=True)

    def approve_on_device(self, number: int):
        r = self.client.get("/api/device/pending", headers={"X-Device-Key": self.device_key})
        self._record("trusted_device", "Trusted device receives request", "GET", "/api/device/pending", r)
        cid = r.json()[0]["id"] if r.status_code == 200 and r.json() else None
        r = self.client.post("/api/device/respond", json={"challenge_id": cid or "none", "selected_number": number,
                                                          "approve": True}, headers={"X-Device-Key": self.device_key})
        return self._record("trusted_device", f"Customer picks {number} and approves", "POST", "/api/device/respond", r)

    def add_payee(self, actor):
        r = self.client.post("/api/bank/beneficiaries", json={"name": "Quick Cash", "account_ref": "SYN-4242"},
                             headers=self._headers())
        return self._record(actor, "Add a new payee", "POST", "/api/bank/beneficiaries", r, assessed=True)

    def transfer(self, actor, ben_id, amount_paise, label):
        r = self.client.post("/api/bank/transfers", json={"beneficiary_id": ben_id, "amount_paise": amount_paise,
                                                          "idempotency_key": str(uuid.uuid4())}, headers=self._headers())
        return self._record(actor, label, "POST", "/api/bank/transfers", r, assessed=r.status_code != 403 or True)

    def overview(self, actor):
        r = self.client.get("/api/bank/overview")
        return self._record(actor, "Open account overview", "GET", "/api/bank/overview", r)

    def final_decision(self):
        s = self.session()
        if s is None:
            return None
        rows = self.db.scalars(select(models.RiskAssessment.decision).where(models.RiskAssessment.session_id == s.id)).all()
        return max(rows, key=lambda d: policy.RANK[d]) if rows else None


def _note(r) -> str:
    try:
        body = r.json()
    except ValueError:
        return ""
    if isinstance(body, dict) and "error" in body:
        return body["error"]["code"]
    if isinstance(body, dict):
        return body.get("result") or body.get("status") or body.get("decision") or ""
    return ""


def _number(r):
    try:
        ch = r.json().get("challenge")
        return ch["number_match"] if ch else None
    except (ValueError, AttributeError):
        return None


ATTACKER_COOKIE = "lab-attacker-browser-cookie-0001"  # one synthetic attacker browser shared across Lab victims
ATTACKER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def synthetic_png(w: int = 96, h: int = 72) -> bytes:
    """A generated gradient image, clearly a test fixture (not a photograph of anyone)."""
    import struct
    import zlib
    rows = b"".join(b"\x00" + bytes(v for x in range(w) for v in (40 + x, 90 + y, 200)) for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


from contextlib import nullcontext as _null


def _step(rn, actor, action, note, status=200, path="(service)"):
    rn.steps.append({"n": len(rn.steps) + 1, "actor": actor, "action": action, "http": {"method": "-", "path": path, "status": status},
                     "decision": None, "risk_score": None, "note": note[:300]})


def _incident_for(db, session_id):
    db.expire_all()
    return next((i for i in db.scalars(select(models.SecurityIncident).order_by(models.SecurityIncident.id.desc()).limit(30)).all()
                 if session_id in (i.session_ids or [])), None)


def _attack(rn, p, city="Lagos", ip="203.0.113.45", hour=3, amount=40_000_00, payee=("Quick Cash", "SYN-4242")):
    rn.ctx = {"city": city, "ip": ip, "ua": ATTACKER_UA}
    rn.client.cookies.set("ss_device", ATTACKER_COOKIE, domain="127.0.0.1", path="/api")
    with at_local_hour(hour):
        rn.login("attacker")
        rn.wait(30, "attacker")
        rn.overview("attacker")
        r = rn.client.post("/api/bank/beneficiaries", json={"name": payee[0], "account_ref": payee[1]}, headers=rn._headers())
        rn._record("attacker", f"Add payee {payee[1]}", "POST", "/api/bank/beneficiaries", r, assessed=True)
        bid = (r.json().get("beneficiary") or {}).get("id") if r.status_code in (200, 201) else None
        rn.transfer("attacker", bid or rn.established_payee(), amount, f"Send ₹{amount // 100:,}")


def _escalate(rn, st, db, analyst, p):
    from app.evidence.models import PhotoRequest
    from app.intel import reports
    from app.routers import investigation as inv
    from app.services import incidents
    s = rn.session()
    inc = _incident_for(db, s.id) if s else None
    if inc is None or analyst is None:
        _step(rn, "system", "No incident to escalate", "The session was not restricted, so there is nothing to investigate.", 409)
        return
    ctx = (None, analyst, db)
    _step(rn, "system", "Analyst notified automatically", f"Incident {inc.ref} opened ({'Ghost Banking' if inc.ghost else 'restricted'}), "
          f"risk {inc.risk_score:.1f}, severity {inc.severity}")
    ev = inv.incident_evidence(inc.id, ctx, st)
    _step(rn, "evidence vault", "Network and device evidence collected",
          ", ".join(sorted({i["kind"] for i in ev["items"]})) + " · IP " + next((str(i["content"].get("ip")) for i in ev["items"] if i["kind"] == "network_observation"), "n/a")
          + " (synthetic) · MAC address: unavailable through a web browser")
    pr = inv.request_photo(inc.id, inv.PhotoRequestBody(reason="Scenario Lab: verification photograph"), ctx, st)
    with st.EvidenceSessionLocal() as edb:
        preq = edb.get(PhotoRequest, pr["id"])
    item = inv.accept_photo(st, db, preq, synthetic_png(), "image/png", clock.now().isoformat(), "Scenario Lab fixture",
                            classification="synthetic", source="Scenario Lab synthetic image fixture (not a photograph of a person)")
    _step(rn, "session holder", "Consented verification photo received (synthetic fixture)", f"{item.id} · SHA-256 {item.content_sha256[:16]}…")
    sm = inv.generate_summary(inc.id, inv.SummaryGen(), ctx, st)
    sm = inv.approve_summary(sm["id"], ctx, st)
    _step(rn, "analyst", "Investigation summary generated and approved", f"v{sm['version']} · {sm['generated_by']} · {len(sm['sections'])} sections")
    rp = inv.create_report(inc.id, inv.ReportCreate(destination="dummy"), ctx, st)
    with st.EvidenceSessionLocal() as edb:
        r = edb.get(reports.CyberReport, rp["id"])
        reports.submit_for_review(edb, r, analyst.username)
        c = reports.confirm_first(edb, st, r, analyst.username, r.version, r.manifest_hash, "dummy", {k: True for k in reports.CHECKLIST})
        _step(rn, "analyst", "Complaint prepared, reviewed, first confirmation", f"{r.id} v{r.version} · manifest {r.manifest_hash[:12]}…")
        out = reports.confirm_final(db, edb, st, r, analyst, c.id, r.version, r.manifest_hash, "dummy", "SUBMIT DEMO",
                                    "Scenario Lab demonstration filing")
        _step(rn, "demo reporting service", "Final confirmation → DEMO submission", f"Acknowledgement {out['ack_number']} · {out['warning']}")
        dup = reports.confirm_final(db, edb, st, edb.get(reports.CyberReport, r.id), analyst, c.id, r.version, r.manifest_hash, "dummy",
                                    "SUBMIT DEMO", "duplicate attempt")
        _step(rn, "analyst", "Duplicate submission attempt", f"handled idempotently: {dup['ack_number']} (no second complaint)")
        data, _, name = reports.export(db, edb, st, edb.get(reports.CyberReport, r.id), "zip", analyst.username)
        _step(rn, "analyst", "Evidence package exported", f"{name} · {len(data):,} bytes · SHA-256 manifest included")
    adv = inv.advance_demo_status(rp["id"], ctx, st)
    _step(rn, "demo reporting service", "Complaint tracking update (simulated)", f"{adv['ack']} → {adv['status']}")
    db.expire_all()
    inc = db.get(models.SecurityIncident, inc.id)
    res = incidents.act(db, st, inc, analyst, "clear_user", "Scenario Lab: investigation complete; customer to re-authenticate")
    _step(rn, "analyst", "Incident resolved; secure recovery authorised", f"status {res['status']}; sessions ended")


def run(app, st, db, scenario_id: str, params: dict, analyst=None) -> dict:
    if scenario_id not in SCENARIOS:
        raise KeyError(scenario_id)
    defaults = {p["key"]: p["value"] for p in SCENARIOS[scenario_id]["params"]}
    p = {**defaults, **{k: v for k, v in params.items() if k in defaults}}
    rn = Runner(app, st, db, str(p["username"]))
    before = rn.balance()
    with rn.client:
        if scenario_id == "normal_customer":
            rn.browser(True)
            with at_local_hour(rn.usual_hour()):
                rn.login("customer")
                rn.wait(200, "customer")
                rn.transfer("customer", rn.established_payee(), 2_500_00, "Pay usual payee ₹2,500")
        elif scenario_id == "takeover_despite_totp":
            rn.ctx = {"city": p["city"]}
            with at_local_hour(int(p["hour"])):
                rn.login("attacker")
                rn.wait(40, "attacker")
                rn.add_payee("attacker")
                rn.transfer("attacker", rn.established_payee(), 90_000_00, "Try to move ₹90,000")
        elif scenario_id == "suspicious_after_login":
            rn.browser(True)
            with at_local_hour(rn.usual_hour()):
                rn.login("customer")
                rn.wait(40, "attacker")
                r = rn.add_payee("attacker")
                amount = int(float(p["amount_rupees"]) * 100)
                if r.status_code == 201:
                    r = rn.transfer("attacker", r.json()["beneficiary"]["id"], amount, f"Send ₹{amount // 100:,} to the new payee")
                rn.transfer("attacker", rn.established_payee(), amount, "Try another transfer")
        elif scenario_id in ("genuine_traveller", "new_device"):
            rn.browser(scenario_id == "genuine_traveller")
            if scenario_id == "genuine_traveller":
                rn.ctx = {"city": p["city"]}
            with at_local_hour(rn.usual_hour()):
                r = rn.login("customer")
                if _number(r) is not None:
                    rn.approve_on_device(_number(r))
                rn.wait(200, "customer")
                r = rn.transfer("customer", rn.established_payee(), 2_500_00, "Pay usual payee ₹2,500")
                if _number(r) is not None:
                    rn.approve_on_device(_number(r))
        elif scenario_id == "ghost_banking":
            rn.ctx = {"city": p["city"]}
            with at_local_hour(int(p["hour"])):
                rn.login("attacker")
                rn.wait(30, "attacker")
                rn.overview("attacker")
                r = rn.add_payee("attacker")
                amount = int(float(p["amount_rupees"]) * 100)
                if r.status_code in (200, 201) and r.json().get("beneficiary"):
                    rn.transfer("attacker", r.json()["beneficiary"]["id"], amount, f"Send ₹{amount // 100:,} to the new payee")
                rr = rn.client.get("/api/bank/transactions?limit=5")
                rn._record("attacker", "Check transaction history", "GET", "/api/bank/transactions", rr)
        elif scenario_id == "advanced_escalation":
            _attack(rn, p, city=p["city"], hour=int(p["hour"]), amount=int(float(p["amount_rupees"]) * 100))
            _escalate(rn, st, db, analyst, p)
        elif scenario_id == "correlated_investigation":
            from app.intel import correlation
            customers = [u.username for u in db.scalars(select(models.User).where(models.User.role == "customer").order_by(models.User.id)).all()]
            order = [p["username"]] + [u for u in customers if u != p["username"]]
            refs = []
            for i, uname in enumerate(order[:3]):
                v = rn if i == 0 else Runner(app, st, db, uname)
                v.steps = rn.steps
                with (v.client if i else _null()):
                    _attack(v, p, ip="203.0.113.77", payee=("Swift Movers", "SYN-7777"), amount=30_000_00)
                    sv = v.session()
                inc = _incident_for(db, sv.id) if sv else None
                if inc:
                    refs.append(inc.ref)
                    _step(rn, "system", f"Incident for {uname}", f"{inc.ref} · {'Ghost Banking' if inc.ghost else 'restricted'} · risk {inc.risk_score:.1f}")
            g = correlation.build(db, st, hours=6, include_lab=True)
            linked = [e for e in g["edges"] if e["kind"] == "derived" and {e["source"][9:], e["target"][9:]} <= set(refs)]
            for e in linked:
                _step(rn, "fraud intelligence", f"{e['strength'].title()} correlation {e['source'][9:]} ↔ {e['target'][9:]}", e["explanation"])
            _step(rn, "fraud intelligence", "Correlation limitations", correlation.CAVEAT)
        elif scenario_id == "evidence_tamper":
            import secrets as _sec
            from pathlib import Path as _P

            from app.evidence import vault
            ref = "LAB-FIX-" + _sec.token_hex(3).upper()
            with st.EvidenceSessionLocal() as edb:
                it = vault.add_item(edb, st, kind="fixture_document", classification="synthetic", source="Scenario Lab fixture",
                                    provenance="Isolated synthetic test fixture for tamper detection", actor="lab", is_lab=True,
                                    incident_ref=ref, blob=b"SYNTHETIC FIXTURE - SecureSynth tamper-detection demo\n" * 20, mime="text/plain")
                _step(rn, "evidence vault", "Fixture collected and hashed", f"{it.id} · SHA-256 {it.content_sha256[:20]}… · chained in the lab ledger")
                ok = vault.verify(edb, st, "lab", ref)
                _step(rn, "evidence vault", "Integrity verification", f"{ok['status']} ({len(ok['items'])} item, chains {ok['chains']})")
                path = _P(st.evidence_store_dir) / it.blob_path
                data = bytearray(path.read_bytes())
                data[len(data) // 2] ^= 0x01  # controlled one-bit modification of the isolated fixture only
                path.write_bytes(bytes(data))
                _step(rn, "lab", "Controlled modification of the synthetic fixture", "one bit flipped in the encrypted fixture file on disk")
                bad = vault.verify(edb, st, "lab", ref)
                _step(rn, "evidence vault", "Integrity verification after modification",
                      f"{bad['status'].upper()}: " + "; ".join(p_["detail"] for p_ in bad["problems"]) + " · alert recorded", 409)
                man = vault.manifest(edb, ref)
                _step(rn, "evidence vault", "Export validation", f"manifest {man['manifest_sha256'][:16]}… lists the recorded hash; the file no longer matches it")
        elif scenario_id == "live_soc":
            from app.intel import soc
            # Lab events are dated at the simulated customer hour (up to ±12 h from now), so measure a window that covers them
            _w0, _w1 = (clock.now() - timedelta(hours=13)).isoformat(), (clock.now() + timedelta(hours=13)).isoformat()
            m0 = soc.metrics(db, st, "custom", True, _w0, _w1)["kpis"]
            _step(rn, "SOC", "Metrics before", f"sessions {m0['monitored_sessions']}, suspicious {m0['suspicious_sessions']}, incidents pending {m0['pending_incidents']}")
            for uname, kind in (("asha", "normal"), ("ravi", "new_device"), (p["username"], "takeover")):
                v = Runner(app, st, db, uname)
                v.steps = rn.steps
                with v.client:
                    if kind == "normal":
                        v.browser(True)
                        with at_local_hour(v.usual_hour()):
                            v.login("customer")
                            v.wait(200, "customer")
                            v.transfer("customer", v.established_payee(), 2_500_00, "Pay usual payee ₹2,500")
                    elif kind == "new_device":
                        with at_local_hour(v.usual_hour()):
                            r = v.login("customer")
                            if _number(r) is not None:
                                v.approve_on_device(_number(r))
                    else:
                        _attack(v, p, ip="203.0.113.90")
                        last = v.session()
            m1 = soc.metrics(db, st, "custom", True, _w0, _w1)["kpis"]
            _step(rn, "SOC", "Metrics after (from records)", ", ".join(f"{k} {m0[k]}→{m1[k]}" for k in
                  ("monitored_sessions", "suspicious_sessions", "pending_incidents", "blocked_attempts", "prevented_exposure_paise", "active_ghost_sessions")))
            inc = _incident_for(db, last.id) if last else None
            if inc and analyst is not None:
                from app.routers import investigation as inv
                sm = inv.generate_summary(inc.id, inv.SummaryGen(), (None, analyst, db), st)
                refs = sorted({r for sec in sm["sections"] for r in sec["refs"]})
                _step(rn, "analyst", "Investigation summary generated", f"{sm['generated_by']} · {len(sm['sections'])} sections · evidence refs: {', '.join(refs[:6])}")
                rp = inv.create_report(inc.id, inv.ReportCreate(destination="dummy"), (None, analyst, db), st)
                _step(rn, "analyst", "Complaint draft prepared (not submitted)", f"{rp['id']} · {rp['status_label']} · {rp['warning']}")
        elif scenario_id == "unusual_legit_transfer":
            rn.browser(True)
            with at_local_hour(rn.usual_hour()):
                rn.login("customer")
                rn.wait(240, "customer")
                amount = int(float(p["amount_rupees"]) * 100)
                r = rn.transfer("customer", rn.established_payee(), amount, f"Pay usual payee ₹{amount // 100:,}")
                if _number(r) is not None:
                    rn.approve_on_device(_number(r))
        s = rn.session()
        result = {"scenario_id": scenario_id, "username": rn.user.username, "session_id": s.id if s else None,
                  "steps": rn.steps, "final_decision": rn.final_decision(),
                  "protected_balance_before_paise": before, "protected_balance_after_paise": rn.balance(),
                  "contained_in_ghost": bool(s is not None and s.mode == "ghost")}
    return result
