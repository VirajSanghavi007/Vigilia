"""Model registry interface.

A "version" is never a filename. It's a record: an opaque version id, the
URI of the weights, and metadata (metrics, git SHA, training-data hash,
timestamp, feature schema) — plus, separately, which version each
deployment *stage* (e.g. "production") currently points at. Filenames like
`model_final_v3.pkl` encode none of that and can't tell you what produced
the file or whether it's actually the one serving traffic.

LocalRegistry (filesystem-backed) is the only implementation right now —
see local_registry.py. The `uri` a version stores is deliberately backend-
agnostic (a path today, could be an s3:// URI later) so a future remote
backend is a new ModelRegistry implementation, not a format change.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

_VERSION_RE = re.compile(r"^\d{8}-[0-9a-f]{7,40}-[A-Za-z0-9_.-]+$")


def make_version(git_sha: str, run_id: str, *, when: datetime | None = None) -> str:
    """Build a version id: `{YYYYMMDD}-{git_sha}-{run_id}`.

    - date makes versions sortable/skimmable without opening metadata
    - git_sha ties a version to the exact code that produced it
    - run_id disambiguates same-day/same-commit reruns (e.g. a training
      job's own run identifier — never a hand-incremented counter)
    """
    when = when or datetime.now(UTC)
    short_sha = git_sha[:7]
    version = f"{when:%Y%m%d}-{short_sha}-{run_id}"
    if not _VERSION_RE.match(version):
        raise ValueError(f"run_id produced an invalid version string: {version!r}")
    return version


@dataclass(frozen=True)
class ModelMetadata:
    git_sha: str
    run_id: str
    created_at: str  # ISO-8601 UTC
    metrics: dict[str, float] = field(default_factory=dict)
    training_data_hash: str | None = None
    feature_schema: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelArtifact:
    """A single registered model version: where its weights live + its metadata."""

    name: str
    version: str
    uri: str  # e.g. s3://bucket/models/multignn/<version>/model.pt or a local path
    metadata: ModelMetadata


class ModelNotFoundError(LookupError):
    pass


class ModelRegistry(Protocol):
    """Backend-agnostic model registry. Implementations: LocalRegistry, S3Registry."""

    def register(self, name: str, version: str, weights_path: str, metadata: ModelMetadata) -> ModelArtifact:
        """Publish a version's weights + metadata. Does not affect any stage pointer."""
        ...

    def get(self, name: str, version: str) -> ModelArtifact:
        """Fetch one specific version's artifact record. Raises ModelNotFoundError."""
        ...

    def list_versions(self, name: str) -> list[ModelArtifact]:
        """All registered versions for `name`, newest first."""
        ...

    def promote(self, name: str, version: str, stage: str) -> None:
        """Point `stage` (e.g. "production", "staging") at `version`."""
        ...

    def get_stage(self, name: str, stage: str) -> ModelArtifact:
        """Resolve a stage pointer to the artifact it currently points at.
        Raises ModelNotFoundError if the stage has never been promoted."""
        ...

    def resolve_weights(self, artifact: ModelArtifact) -> str:
        """Return a local filesystem path to the artifact's weights, fetching
        from remote storage first if needed (S3Registry downloads+caches;
        LocalRegistry just returns the path already on disk)."""
        ...
