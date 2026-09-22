"""Unit tests for the synthetic stream generator's core logic — feature
sampling (real-data-fitted clusters + outliers), edge recency, and the
Poisson-process rate walker — against a fake in-memory sink and a fake
feature model. No real Memgraph and no real feature_model.npz needed.
"""

import importlib.util
import sys
from collections import Counter, deque
from pathlib import Path

import numpy as np
import pytest

SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent.parent / "scripts" / "generate_synthetic_stream.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("generate_synthetic_stream", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_synthetic_stream"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def mod():
    return _load_module()


class FakeSink:
    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.edges: list[tuple[str, str]] = []

    def upsert_transaction(self, tx_id, tx_class, properties=None):
        self.nodes[tx_id] = {"class": tx_class, **(properties or {})}

    def upsert_edge(self, from_id, to_id):
        self.edges.append((from_id, to_id))


@pytest.fixture
def fake_model(mod):
    """A FeatureModel-shaped object with tiny, known distributions —
    avoids depending on the real fitted feature_model.npz in unit tests."""
    model = mod.FeatureModel.__new__(mod.FeatureModel)
    model.classes = ["illicit", "licit", "unknown"]
    model.n_features = 4
    model.means = {
        "illicit": np.array([100.0, 100.0, 100.0, 100.0]),
        "licit": np.array([-100.0, -100.0, -100.0, -100.0]),
        "unknown": np.array([0.0, 0.0, 0.0, 0.0]),
    }
    model.cholesky = {cls: np.eye(4) * 0.01 for cls in model.classes}
    return model


def test_random_class_distribution_roughly_matches_real_proportions(mod):
    counts = Counter(mod.random_class() for _ in range(20000))
    total = sum(counts.values())
    fractions = {cls: n / total for cls, n in counts.items()}

    assert fractions.get("unknown", 0) == pytest.approx(157205 / 203769, abs=0.03)
    assert fractions.get("licit", 0) == pytest.approx(42019 / 203769, abs=0.03)
    assert fractions.get("illicit", 0) == pytest.approx(4545 / 203769, abs=0.02)


def test_feature_model_sample_stays_near_class_cluster_without_outlier(mod, fake_model, monkeypatch):
    monkeypatch.setattr(mod.random, "random", lambda: 1.0)  # never trigger outlier branch
    sample = fake_model.sample("illicit")
    vec = np.array(list(sample.values()))
    assert np.allclose(vec, fake_model.means["illicit"], atol=1.0)


def test_feature_model_inflated_outlier_is_far_from_cluster(mod, fake_model, monkeypatch):
    # np.random.standard_normal isn't mocked (it's the actual signal being
    # scaled), so without a fixed seed this is flaky at low dimension —
    # small-norm draws occasionally land under the threshold by chance.
    np.random.seed(0)
    calls = iter([0.0, 0.0])  # < OUTLIER_PROB, then < 0.5 -> inflated-deviation branch
    monkeypatch.setattr(mod.random, "random", lambda: next(calls))
    monkeypatch.setattr(mod.random, "uniform", lambda a, b: b)  # max inflation
    sample = fake_model.sample("unknown")
    vec = np.array(list(sample.values()))
    assert np.linalg.norm(vec - fake_model.means["unknown"]) > 0.1


def test_feature_model_cross_class_outlier_lands_near_other_cluster(mod, fake_model, monkeypatch):
    calls = iter([0.0, 0.9])  # < OUTLIER_PROB, then >= 0.5 -> cross-class branch
    monkeypatch.setattr(mod.random, "random", lambda: next(calls))
    monkeypatch.setattr(mod.random, "choice", lambda seq: "licit")
    sample = fake_model.sample("illicit")
    vec = np.array(list(sample.values()))
    assert np.allclose(vec, fake_model.means["licit"], atol=1.0)


def test_generate_batch_writes_correct_node_count(mod, fake_model):
    sink = FakeSink()
    recent = deque()
    mod.generate_batch(sink, fake_model, "run1", 0, 50, recent)

    assert len(sink.nodes) == 50
    assert all(tx_id.startswith("syn-run1-") for tx_id in sink.nodes)


def test_generate_batch_edges_only_target_prior_nodes(mod, fake_model):
    sink = FakeSink()
    recent = deque()
    mod.generate_batch(sink, fake_model, "run1", 0, 30, recent)

    node_order = list(sink.nodes.keys())
    for from_id, to_id in sink.edges:
        assert node_order.index(to_id) <= node_order.index(from_id)


def test_generate_batch_respects_recency_window(mod, fake_model):
    sink = FakeSink()
    recent = deque()
    mod.generate_batch(sink, fake_model, "run1", 0, mod.RECENCY_WINDOW + 100, recent)

    assert len(recent) == mod.RECENCY_WINDOW


def test_generate_batch_ids_are_unique_across_calls(mod, fake_model):
    sink = FakeSink()
    recent = deque()
    mod.generate_batch(sink, fake_model, "run1", 0, 20, recent)
    mod.generate_batch(sink, fake_model, "run1", 20, 20, recent)

    assert len(sink.nodes) == 40


def test_api_sink_posts_transaction_to_correct_endpoint(mod, monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass

    class FakeClient:
        def __init__(self, timeout=None):
            pass

        def post(self, url, json):
            calls.append((url, json))
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr(mod.httpx, "Client", FakeClient)
    sink = mod.ApiSink("http://localhost:8000")
    sink.upsert_transaction("T1", "illicit", {"f0": 1.0})

    assert calls == [
        (
            "http://localhost:8000/v1/ingest/transaction",
            {"tx_id": "T1", "tx_class": "illicit", "properties": {"f0": 1.0}},
        )
    ]


def test_api_sink_posts_edge_to_correct_endpoint(mod, monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass

    class FakeClient:
        def __init__(self, timeout=None):
            pass

        def post(self, url, json):
            calls.append((url, json))
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr(mod.httpx, "Client", FakeClient)
    sink = mod.ApiSink("http://localhost:8000")
    sink.upsert_edge("T1", "T2")

    assert calls == [
        ("http://localhost:8000/v1/ingest/edge", {"from_id": "T1", "to_id": "T2"})
    ]


def test_api_sink_strips_trailing_slash_from_base_url(mod, monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            pass

    class FakeClient:
        def __init__(self, timeout=None):
            pass

        def post(self, url, json):
            assert url == "http://localhost:8000/v1/ingest/transaction"
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr(mod.httpx, "Client", FakeClient)
    sink = mod.ApiSink("http://localhost:8000/")
    sink.upsert_transaction("T1", "unknown")


def test_rate_walker_stays_within_bounds(mod):
    walker = mod.RateWalker(start_rate=50.0)
    for _ in range(500):
        rate = walker.step()
        assert mod.RATE_MIN <= rate <= mod.RATE_MAX


def test_rate_walker_produces_varying_batch_sizes(mod):
    """The whole point of the redesign: batch sizes must NOT be a fixed
    repeating cycle — this is a statistical check that successive windows
    actually differ, catching a regression back to deterministic profiles."""
    walker = mod.RateWalker(start_rate=200.0)
    counts = [walker.next_window()[0] for _ in range(30)]
    assert len(set(counts)) > 5, f"batch sizes look deterministic: {counts}"


def test_rate_walker_next_window_returns_positive_values(mod):
    walker = mod.RateWalker()
    count, window = walker.next_window()
    assert count >= 1
    assert mod.WINDOW_MIN_S <= window <= mod.WINDOW_MAX_S


def test_bucket_for_maps_rate_to_expected_range(mod):
    assert mod.bucket_for(5) == "1-10/s"
    assert mod.bucket_for(300) == "250-500/s"
    assert mod.bucket_for(10000) == ">=5000/s"


def test_feature_model_raises_clear_error_when_file_missing(mod, tmp_path):
    with pytest.raises(FileNotFoundError, match="fit_feature_model.py"):
        mod.FeatureModel(tmp_path / "does_not_exist.npz")
