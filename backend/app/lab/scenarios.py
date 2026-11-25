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
    saved = clock._offset
    local = clock.now().astimezone(F.LOCAL_TZ)
    delta = (hour - local.hour) % 24
    clock.set_offset(saved + timedelta(hours=delta - 24 if delta > 12 else delta))
    try:
        yield
    finally:
        clock.set_offset(saved)


class Runner:
    def __init__(self, app, st, db, username: str):
        self.app, self.st, self.db = app, st, db
        self.user = db.scalar(select(models.User).where(models.User.username == username))
        if self.user is None or self.user.role != "customer":
            raise ValueError("unknown customer")
        creds = json.loads(Path(st.settings.demo_credentials).read_text())[username]
        self.password, self.device_key, self.home_cookie = creds["password"], creds["trusted_device_key"], creds["home_browser_cookie"]
        self.steps: list[dict] = []
        self.client = TestClient(app, base_url="http://127.0.0.1:8000")
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


def run(app, st, db, scenario_id: str, params: dict) -> dict:
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
                  "protected_balance_before_paise": before, "protected_balance_after_paise": rn.balance()}
    return result
