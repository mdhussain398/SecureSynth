"""FINAL held-out evaluation (protocol v2, docs/EVALUATION_PROTOCOL.md) — A8: three approaches, identical TEST sessions, one shared outcome function.

Run: python -m ml.evaluate  → artifacts/eval_report.json and ../docs/EVALUATION.md
The test split is read here and nowhere else; nothing in this file feeds back into tuning.
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

from app.risk import policy
from app.risk.features import local_hour
from ml import generate, train

DOCS = Path(__file__).resolve().parents[2] / "docs"


def static_rules(f: dict) -> str:
    """Fixed a-priori, global, non-personalised rules (not tuned on any data)."""
    if f["beneficiary_fresh"] == 1 and f["log_secs_login_to_sensitive"] < np.log1p(600) and f["is_transfer"] == 1:
        return "BLOCK"  # new payee + transfer within 10 min of sign-in
    if f["device_recognised"] == 0 or f["log_km_from_home"] > 0:
        return "STEP_UP"  # new device or not at home city
    return "ALLOW"


def static_with_amount(f: dict, amount: int, hour: int) -> str:
    d = static_rules(f)
    if d == "ALLOW" and ((f["is_transfer"] == 1 and amount > 50_000_00) or hour < 5):
        return "STEP_UP"  # > ₹50,000 or 00:00–05:00
    return d


def outcome(running_decision: str, label: str) -> str:
    """Shared by all approaches. Attackers fail independent verification; genuine customers pass it."""
    if running_decision == "ALLOW":
        return "completed"
    if running_decision == "STEP_UP":
        return "completed_after_verification" if label == "legit" else "restricted"
    return "restricted"


def metrics(y_true, y_pred) -> dict:
    y_true, y_pred = np.array(y_true, bool), np.array(y_pred, bool)
    tp, fp = int((y_true & y_pred).sum()), int((~y_true & y_pred).sum())
    fn, tn = int((y_true & ~y_pred).sum()), int((~y_true & ~y_pred).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0,
            "fpr": round(fp / (fp + tn), 4) if fp + tn else 0.0, "tp": tp, "fp": fp, "tn": tn, "fn": fn}


def run_approach(name, label, decide_fn, rows, sessions):
    by_session: dict[str, list[int]] = {}
    for i, m in enumerate(rows.meta):
        by_session.setdefault(m["session_ref"], []).append(i)
    final, lat = {}, []
    prev = dict(attempted=0, prevented=0, completed=0, legit_delayed=0,
                prevented_blocked=0, prevented_challenged=0, legit_blocked=0, legit_challenged=0)
    for ref, idxs in by_session.items():
        s = sessions[ref]
        running = "ALLOW"
        for i in idxs:
            t0 = time.perf_counter()
            d = decide_fn(i)
            lat.append((time.perf_counter() - t0) * 1000)
            running = d if policy.RANK[d] > policy.RANK[running] else running
            m = rows.meta[i]
            if m["type"] == "transfer":
                o = outcome(running, s["label"])
                if s["label"] == "ato":
                    prev["attempted"] += m["amount"]
                    prev["prevented" if o == "restricted" else "completed"] += m["amount"]
                    if running == "BLOCK":
                        prev["prevented_blocked"] += m["amount"]       # stopped outright by the engine
                    elif running == "STEP_UP":
                        prev["prevented_challenged"] += m["amount"]    # stopped only because the attacker fails verification
                elif o != "completed":
                    prev["legit_delayed"] += m["amount"]
                    prev["legit_blocked" if running == "BLOCK" else "legit_challenged"] += m["amount"]
        final[ref] = running
    refs = list(final)
    y = [sessions[r]["label"] == "ato" for r in refs]
    travellers = [r for r in refs if sessions[r]["kind"] == "traveller"]
    new_devs = [r for r in refs if sessions[r]["kind"] == "new_device"]
    legit = [r for r in refs if sessions[r]["label"] == "legit"]
    fams = sorted({sessions[r]["attack_family"] for r in refs if sessions[r]["label"] == "ato"})
    return {
        "name": name, "label": label,
        "intervention": metrics(y, [final[r] != "ALLOW" for r in refs]),
        "block_only": metrics(y, [final[r] == "BLOCK" for r in refs]),
        "traveller_restriction_rate": round(float(np.mean([final[r] != "ALLOW" for r in travellers])), 4) if travellers else 0.0,
        "new_device_restriction_rate": round(float(np.mean([final[r] != "ALLOW" for r in new_devs])), 4) if new_devs else 0.0,
        "legit_block_rate": round(float(np.mean([final[r] == "BLOCK" for r in legit])), 4),
        "prevention": {"attack_value_attempted_paise": prev["attempted"], "attack_value_prevented_paise": prev["prevented"],
                       "attack_value_completed_paise": prev["completed"], "legit_value_delayed_paise": prev["legit_delayed"],
                       "attack_value_prevented_by_block_paise": prev["prevented_blocked"],
                       "attack_value_prevented_by_challenge_paise": prev["prevented_challenged"],
                       "legit_value_blocked_paise": prev["legit_blocked"],
                       "legit_value_challenged_paise": prev["legit_challenged"]},
        "latency_ms": {"p50": round(float(np.percentile(lat, 50)), 4), "p95": round(float(np.percentile(lat, 95)), 4)},
        "per_family_recall": {f: round(float(np.mean([final[r] != "ALLOW" for r in refs
                                                      if sessions[r]["attack_family"] == f])), 4) for f in fams},
    }


FINAL_SEED = 9091  # fresh population, never used during development


def verify_frozen() -> dict:
    manifest = json.loads((train.ARTIFACTS / "frozen_manifest.json").read_text())
    current = train.file_hashes()
    changed = [f for f, h in manifest["files"].items() if current.get(f) != h]
    if changed:
        raise SystemExit(f"Refusing to evaluate: frozen files changed since training: {changed}. "
                         "Re-run `make train` (new protocol version) first.")
    return manifest


def main() -> dict:
    manifest = verify_frozen()
    model = joblib.load(train.ARTIFACTS / "model.joblib")
    ds = generate.generate(seed=FINAL_SEED)
    rows = train.feature_rows(ds).subset(["test"])
    sessions = {s["session_ref"]: s for s in ds.sessions if s["split"] == "test"}
    cols = rows.feature_columns
    hours = {}
    for s in sessions.values():
        for e in s["events"]:
            hours[(s["session_ref"], e["type"])] = local_hour(e["ts"])

    def ss(i):  # single-event path, timed per checkpoint like production
        f = dict(zip(cols, rows.X[i]))
        idx = float(model.index(model.raw(rows.X[i:i + 1]))[0])
        c = policy.contributions(f)
        return policy.decide(policy.score(idx, model.w_ml, c), model.t_step, model.t_block, policy.hard_block(f))

    def sr(i):
        m = rows.meta[i]
        return static_with_amount(dict(zip(cols, rows.X[i])), m["amount"], hours[(m["session_ref"], m["type"])])

    approaches = [
        run_approach("password_totp", "Password + TOTP only", lambda i: "ALLOW", rows, sessions),
        run_approach("static_rules", "Static global rules", sr, rows, sessions),
        run_approach("securesynth", "SecureSynth adaptive engine", ss, rows, sessions),
    ]
    n_atk = sum(1 for s in sessions.values() if s["label"] == "ato")
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "model_version": model.version,
        "dataset": {"customers": len(ds.users), "sessions_test": len(sessions), "attacks_test": n_atk,
                    "held_out_family": "D", "seed": FINAL_SEED, "protocol": "v2",
                    "frozen_manifest_files": manifest["files"]},
        "approaches": approaches,
        "assumptions": [
            "Unit of evaluation is a session; a session's decision is the strictest decision reached so far.",
            "Attackers cannot complete independent trusted-device verification; genuine customers can.",
            "Value prevented counts only attack transfers that ended restricted; legitimate value delayed is reported separately.",
            "Prevented value is split into 'blocked' (engine decision BLOCK, permanent) and 'challenged' (STEP_UP; prevented only under the assumption that the attacker cannot pass trusted-device verification).",
            "Legitimate value delayed is split into 'blocked' (restricted until the customer contacts the bank) and 'challenged' (completed after the customer approved on their trusted device).",
            "Thresholds and ML weight were selected on the development validation window (seed 2026, days 60–75) only.",
            "The final test population (seed 9091) was generated fresh and scored once with frozen model, features and thresholds.",
            "A device approved through independent verification counts as recognised afterwards (mirrors the product).",
        ],
        "limitations": [
            "All customers, devices, locations and attacks are synthetic and authored by the team.",
            "The risk index is a rarity percentile against legitimate validation events, not a fraud probability.",
            "Device recognition uses a server-issued cookie: a behavioural signal, not proof of device identity.",
            "Family D (low-and-slow) never appears in validation, so its recall estimates generalisation, not tuning.",
            "Latency is in-process scoring time on one laptop, excluding network and database time.",
        ],
    }
    train.ARTIFACTS.mkdir(exist_ok=True)
    (train.ARTIFACTS / "eval_report.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    r = main()
    for a in r["approaches"]:
        i, b, p = a["intervention"], a["block_only"], a["prevention"]
        print(f'{a["label"]:<28} P={i["precision"]:.3f} R={i["recall"]:.3f} F1={i["f1"]:.3f} FPR={i["fpr"]:.3f} '
              f'| block R={b["recall"]:.3f} FPR={b["fpr"]:.4f} | traveller={a["traveller_restriction_rate"]:.3f} '
              f'| prevented ₹{p["attack_value_prevented_paise"]/100:,.0f} of ₹{p["attack_value_attempted_paise"]/100:,.0f} '
              f'| delayed legit ₹{p["legit_value_delayed_paise"]/100:,.0f} | p95 {a["latency_ms"]["p95"]:.2f} ms '
              f'| fam {a["per_family_recall"]}')
