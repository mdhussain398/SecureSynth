import ast
import pathlib

import numpy as np
import pytest

from ml import generate, train

APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def test_generator_is_deterministic():
    a = generate.generate(seed=7, n_customers=6, days=30)
    b = generate.generate(seed=7, n_customers=6, days=30)
    assert [s["session_ref"] for s in a.sessions] == [s["session_ref"] for s in b.sessions]


def test_labels_kept_out_of_inference_features():
    data = generate.generate(seed=7, n_customers=6, days=30)
    rows = train.feature_rows(data)
    assert "label" not in rows.feature_columns and "attack_family" not in rows.feature_columns


def test_tuning_refuses_test_split():
    data = generate.generate(seed=7, n_customers=8, days=90)
    rows = train.feature_rows(data)
    with pytest.raises(ValueError):
        train.tune(None, rows.subset(["val", "test"]))


def test_training_is_deterministic():
    data = generate.generate(seed=7, n_customers=8, days=90)
    rows = train.feature_rows(data)
    m1, m2 = train.fit(rows), train.fit(rows)
    x = rows.subset(["val"]).X[:20]
    assert np.allclose(m1.raw(x), m2.raw(x))


def test_inference_code_never_reads_scenario_labels():
    for path in list((APP / "risk").rglob("*.py")) + list((APP / "services").rglob("*.py")):
        tree = ast.parse(path.read_text())
        names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} | \
                {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        assert "ScenarioLabel" not in names, f"{path} references ScenarioLabel"


def test_final_evaluation_refuses_when_frozen_files_change(monkeypatch, tmp_path):
    import json
    from ml import evaluate
    (tmp_path / "frozen_manifest.json").write_text(json.dumps({"files": {"app/risk/policy.py": "0" * 64}}))
    monkeypatch.setattr(train, "ARTIFACTS", tmp_path)
    with pytest.raises(SystemExit):
        evaluate.verify_frozen()


def test_final_test_population_is_separate_from_development():
    from ml import evaluate
    assert evaluate.FINAL_SEED != train.SEED
