"""Serving-side model bundle: Isolation Forest + validation calibration + tuned weight/thresholds."""
from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import IsolationForest


@dataclass
class Model:
    iforest: IsolationForest
    val_legit_raw: np.ndarray | None = None
    w_ml: float = 0.6
    t_step: float = 50.0
    t_block: float = 80.0
    version: str = "untuned"

    def raw(self, X: np.ndarray) -> np.ndarray:
        """Higher = more anomalous (negated sklearn score_samples)."""
        return -self.iforest.score_samples(X)

    def index(self, raw: np.ndarray) -> np.ndarray:
        """Rarity percentile vs legitimate VALIDATION events (0–100). Not a probability."""
        ref = self.val_legit_raw
        return 100.0 * np.searchsorted(ref, raw, side="right") / len(ref)
