from datetime import UTC, datetime

import pytest

from vigilia.ml.registry.base import ModelMetadata, ModelNotFoundError, make_version
from vigilia.ml.registry.local_registry import LocalRegistry


@pytest.fixture
def registry(tmp_path):
    return LocalRegistry(root=tmp_path / "registry")


@pytest.fixture
def weights_file(tmp_path):
    p = tmp_path / "trained.pt"
    p.write_bytes(b"fake-weights")
    return p


def _metadata(**overrides) -> ModelMetadata:
    base = dict(
        git_sha="abc1234",
        run_id="run-1",
        created_at=datetime.now(UTC).isoformat(),
        metrics={"auc": 0.91},
    )
    base.update(overrides)
    return ModelMetadata(**base)


def test_make_version_is_not_a_bare_filename():
    version = make_version("abcdef1234567890", "run-42", when=datetime(2026, 3, 5, tzinfo=UTC))
    assert version == "20260305-abcdef1-run-42"


def test_register_then_get_roundtrips_metadata(registry, weights_file):
    version = make_version("abc1234567", "run-1")
    registry.register("multignn", version, str(weights_file), _metadata())

    artifact = registry.get("multignn", version)

    assert artifact.version == version
    assert artifact.metadata.metrics == {"auc": 0.91}
    assert artifact.uri.endswith("model.pt")


def test_get_unknown_version_raises():
    registry = LocalRegistry(root="does-not-exist")
    with pytest.raises(ModelNotFoundError):
        registry.get("multignn", "nope")


def test_promote_then_get_stage_resolves_to_promoted_version(registry, weights_file):
    version = make_version("abc1234567", "run-1")
    registry.register("multignn", version, str(weights_file), _metadata())

    registry.promote("multignn", version, "production")
    resolved = registry.get_stage("multignn", "production")

    assert resolved.version == version


def test_get_stage_before_any_promotion_raises(registry):
    with pytest.raises(ModelNotFoundError):
        registry.get_stage("multignn", "production")


def test_promote_unknown_version_raises(registry):
    with pytest.raises(ModelNotFoundError):
        registry.promote("multignn", "does-not-exist", "production")


def test_list_versions_sorted_newest_first(registry, weights_file):
    v1 = make_version("abc1234567", "run-1", when=datetime(2026, 1, 1, tzinfo=UTC))
    v2 = make_version("abc1234567", "run-2", when=datetime(2026, 2, 1, tzinfo=UTC))
    registry.register("multignn", v1, str(weights_file), _metadata(created_at="2026-01-01T00:00:00+00:00"))
    registry.register("multignn", v2, str(weights_file), _metadata(created_at="2026-02-01T00:00:00+00:00"))

    versions = [a.version for a in registry.list_versions("multignn")]

    assert versions == [v2, v1]


def test_list_versions_for_unknown_model_is_empty(registry):
    assert registry.list_versions("nope") == []
