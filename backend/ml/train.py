"""Train the shared Isolation Forest and tune weights/thresholds on the VALIDATION split only (A3).

Run: python -m ml.train  (writes artifacts/model.joblib)
"""
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from app.risk import features as F
from app.risk import policy
from app.risk.model import Model
from ml import generate

SEED = 2026
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"


@dataclass
class Rows:
    X: np.ndarray
    meta: list[dict]
    feature_columns: list[str]

    def subset(self, splits) -> "Rows":
        idx = [i for i, m in enumerate(self.meta) if m["split"] in splits]
        return Rows(self.X[idx], [self.meta[i] for i in idx], self.feature_columns)


def feature_rows(ds: generate.Dataset) -> Rows:
    """One row per checkpoint event. Baseline = prior sessions that would pass verification (legit),
    `recent` = all prior raw events of the account. Only events before the checkpoint are used."""
    users = {u["user_id"]: u for u in ds.users}
    trusted_hist: dict[int, list] = {uid: [] for uid in users}
    raw_hist: dict[int, list] = {uid: [] for uid in users}
    X, meta = [], []
    for s in ds.sessions:  # chronological
        uid = s["user_id"]
        base = F.build_baseline(trusted_hist[uid], users[uid]["home_city"])
        recent = raw_hist[uid][-60:]
        sess_events = []
        for e in s["events"]:
            f = F.compute(base, recent + sess_events, e)
            X.append([f[c] for c in F.FEATURES])
            meta.append({"session_ref": s["session_ref"], "split": s["split"], "label": s["label"],
                         "family": s["attack_family"], "kind": s["kind"], "type": e["type"],
                         "amount": e.get("amount", 0), "user_id": uid})
            sess_events.append(e)
        raw_hist[uid].extend(s["events"])
        if s["label"] == "legit":  # simulation assumption: genuine customers pass trusted-device verification
            trusted_hist[uid].extend(s["events"])
    return Rows(np.array(X, dtype=float), meta, list(F.FEATURES))


def fit(rows: Rows) -> Model:
    train = rows.subset(["train"])
    iforest = IsolationForest(n_estimators=300, max_samples=512, random_state=SEED, n_jobs=1)
    iforest.fit(train.X)
    return Model(iforest=iforest)


def session_decisions(model: Model, rows: Rows, w_ml: float, t_step: float, t_block: float):
    idx = model.index(model.raw(rows.X))
    out: dict[str, str] = {}
    for i, m in enumerate(rows.meta):
        f = dict(zip(rows.feature_columns, rows.X[i]))
        c = policy.contributions(f)
        d = policy.decide(policy.score(idx[i], w_ml, c), t_step, t_block, policy.hard_block(f))
        prev = out.get(m["session_ref"], "ALLOW")
        out[m["session_ref"]] = d if policy.RANK[d] > policy.RANK[prev] else prev
    return out


def _session_scores(model, rows, w_ml):
    idx = model.index(model.raw(rows.X))
    best: dict[str, float] = {}
    for i, m in enumerate(rows.meta):
        f = dict(zip(rows.feature_columns, rows.X[i]))
        sc = policy.score(idx[i], w_ml, policy.contributions(f))
        best[m["session_ref"]] = max(best.get(m["session_ref"], 0.0), sc)
    return best


def tune(model: Model, val: Rows, max_fpr: float = 0.05, max_block_fpr: float = 0.005) -> Model:
    if any(m["split"] != "val" for m in val.meta):
        raise ValueError("tune() accepts validation rows only — test split must never be used for tuning")
    labels = {m["session_ref"]: m["label"] for m in val.meta}
    legit_rows = val.X[[i for i, m in enumerate(val.meta) if m["label"] == "legit"]]
    model.val_legit_raw = np.sort(model.raw(legit_rows))
    best = None
    for w in (0.4, 0.5, 0.6, 0.7, 0.8):
        scores = _session_scores(model, val, w)
        legit = np.array([v for k, v in scores.items() if labels[k] == "legit"])
        t_step = float(np.quantile(legit, 1 - max_fpr))
        t_block = float(max(np.quantile(legit, 1 - max_block_fpr), t_step + 10))
        dec = session_decisions(model, val, w, t_step, t_block)
        atk = [k for k in dec if labels[k] == "ato"]
        rec_int = np.mean([dec[k] != "ALLOW" for k in atk])
        rec_blk = np.mean([dec[k] == "BLOCK" for k in atk])
        cand = (rec_int + rec_blk, -w, w, t_step, t_block)
        if best is None or cand > best:
            best = cand
    _, _, model.w_ml, model.t_step, model.t_block = best
    model.t_step, model.t_block = round(model.t_step, 2), round(model.t_block, 2)
    return model


def main() -> None:
    ds = generate.generate(seed=SEED)
    rows = feature_rows(ds)
    model = tune(fit(rows), rows.subset(["val"]))
    digest = hashlib.sha256(model.val_legit_raw.tobytes() + json.dumps(
        [model.w_ml, model.t_step, model.t_block]).encode()).hexdigest()[:8]
    model.version = f"iforest-v1-{digest}"
    ARTIFACTS.mkdir(exist_ok=True)
    joblib.dump(model, ARTIFACTS / "model.joblib")
    print(json.dumps({"version": model.version, "w_ml": model.w_ml, "t_step": model.t_step,
                      "t_block": model.t_block, "train_rows": int(len(rows.subset(['train']).X)),
                      "val_rows": int(len(rows.subset(['val']).X))}, indent=2))


if __name__ == "__main__":
    main()
