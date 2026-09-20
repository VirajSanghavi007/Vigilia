"""Filesystem-backed model registry — the default backend until S3 is configured.

Layout under `root` (default: data/model_registry):

    <root>/<name>/<version>/model.pt
    <root>/<name>/<version>/metadata.json
    <root>/<name>/stages/<stage>.json      # {"version": "..."}

Same shape S3Registry uses (see s3_registry.py), just on local disk — moving
to S3 later is a backend swap, not a format change.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict
from pathlib import Path

from .base import ModelArtifact, ModelMetadata, ModelNotFoundError, ModelRegistry

DEFAULT_ROOT = Path("data/model_registry")


class LocalRegistry(ModelRegistry):
    def __init__(self, root: Path | str = DEFAULT_ROOT):
        self.root = Path(root)

    def _version_dir(self, name: str, version: str) -> Path:
        return self.root / name / version

    def _stage_file(self, name: str, stage: str) -> Path:
        return self.root / name / "stages" / f"{stage}.json"

    def register(self, name: str, version: str, weights_path: str, metadata: ModelMetadata) -> ModelArtifact:
        version_dir = self._version_dir(name, version)
        version_dir.mkdir(parents=True, exist_ok=True)

        dest = version_dir / "model.pt"
        src = Path(weights_path)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)

        (version_dir / "metadata.json").write_text(json.dumps(asdict(metadata), indent=2))

        return ModelArtifact(name=name, version=version, uri=str(dest), metadata=metadata)

    def get(self, name: str, version: str) -> ModelArtifact:
        version_dir = self._version_dir(name, version)
        meta_path = version_dir / "metadata.json"
        weights_path = version_dir / "model.pt"
        if not meta_path.exists() or not weights_path.exists():
            raise ModelNotFoundError(f"{name}:{version} not found under {self.root}")
        metadata = ModelMetadata(**json.loads(meta_path.read_text()))
        return ModelArtifact(name=name, version=version, uri=str(weights_path), metadata=metadata)

    def list_versions(self, name: str) -> list[ModelArtifact]:
        name_dir = self.root / name
        if not name_dir.exists():
            return []
        versions = [p.name for p in name_dir.iterdir() if p.is_dir() and p.name != "stages"]
        artifacts = [self.get(name, v) for v in versions]
        return sorted(artifacts, key=lambda a: a.metadata.created_at, reverse=True)

    def promote(self, name: str, version: str, stage: str) -> None:
        # Validate the version actually exists before pointing a stage at it.
        self.get(name, version)
        stage_file = self._stage_file(name, stage)
        stage_file.parent.mkdir(parents=True, exist_ok=True)
        stage_file.write_text(json.dumps({"version": version}))

    def get_stage(self, name: str, stage: str) -> ModelArtifact:
        stage_file = self._stage_file(name, stage)
        if not stage_file.exists():
            raise ModelNotFoundError(f"stage {stage!r} of {name!r} has never been promoted")
        version = json.loads(stage_file.read_text())["version"]
        return self.get(name, version)

    def resolve_weights(self, artifact: ModelArtifact) -> str:
        return artifact.uri
