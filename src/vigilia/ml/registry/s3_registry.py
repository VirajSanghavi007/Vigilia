"""S3-backed model registry.

Same layout as LocalRegistry, keyed under an S3 prefix instead of a local
root:

    s3://<bucket>/<prefix>/<name>/<version>/model.pt
    s3://<bucket>/<prefix>/<name>/<version>/metadata.json
    s3://<bucket>/<prefix>/<name>/stages/<stage>.json

Not wired up as the active backend yet (LocalRegistry is the default — see
registry/__init__.py) but built now so promoting to S3 later is a config
change (MODEL_REGISTRY_BACKEND=s3), not a rewrite.

boto3 is an optional dependency (`ml/registry` extra) — imported lazily so
importing this module doesn't require it unless S3Registry is actually
instantiated.

Note: writes here are last-writer-wins (S3 has no atomic compare-and-swap
across the metadata + stage-pointer objects). Fine for a single training
pipeline promoting its own runs; if multiple writers promote concurrently,
put a DynamoDB-backed lock in front of `promote()` before relying on this.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import asdict
from pathlib import Path

from .base import ModelArtifact, ModelMetadata, ModelNotFoundError, ModelRegistry


class S3Registry(ModelRegistry):
    def __init__(self, bucket: str, prefix: str = "models", cache_dir: Path | str = ".cache/model_registry"):
        try:
            import boto3
        except ImportError as e:
            raise ImportError(
                "S3Registry requires boto3. Install with the 'registry-s3' extra: "
                "uv sync --extra registry-s3"
            ) from e

        self.bucket = bucket
        self.prefix = prefix.rstrip("/")
        self.cache_dir = Path(cache_dir)
        self._s3 = boto3.client("s3")

    def _key(self, *parts: str) -> str:
        return "/".join([self.prefix, *parts])

    def register(self, name: str, version: str, weights_path: str, metadata: ModelMetadata) -> ModelArtifact:
        weights_key = self._key(name, version, "model.pt")
        meta_key = self._key(name, version, "metadata.json")

        self._s3.upload_file(str(weights_path), self.bucket, weights_key)
        self._s3.put_object(
            Bucket=self.bucket, Key=meta_key,
            Body=json.dumps(asdict(metadata), indent=2).encode(),
            ContentType="application/json",
        )

        uri = f"s3://{self.bucket}/{weights_key}"
        return ModelArtifact(name=name, version=version, uri=uri, metadata=metadata)

    def get(self, name: str, version: str) -> ModelArtifact:
        meta_key = self._key(name, version, "metadata.json")
        weights_key = self._key(name, version, "model.pt")
        try:
            body = self._s3.get_object(Bucket=self.bucket, Key=meta_key)["Body"].read()
        except self._s3.exceptions.NoSuchKey as e:
            raise ModelNotFoundError(f"{name}:{version} not found in s3://{self.bucket}/{self.prefix}") from e
        metadata = ModelMetadata(**json.loads(body))
        uri = f"s3://{self.bucket}/{weights_key}"
        return ModelArtifact(name=name, version=version, uri=uri, metadata=metadata)

    def list_versions(self, name: str) -> list[ModelArtifact]:
        paginator = self._s3.get_paginator("list_objects_v2")
        prefix = self._key(name) + "/"
        versions: set[str] = set()
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix, Delimiter="/"):
            for cp in page.get("CommonPrefixes", []):
                version = cp["Prefix"].removeprefix(prefix).rstrip("/")
                if version != "stages":
                    versions.add(version)
        artifacts = [self.get(name, v) for v in versions]
        return sorted(artifacts, key=lambda a: a.metadata.created_at, reverse=True)

    def promote(self, name: str, version: str, stage: str) -> None:
        self.get(name, version)  # validate it exists
        stage_key = self._key(name, "stages", f"{stage}.json")
        self._s3.put_object(
            Bucket=self.bucket, Key=stage_key,
            Body=json.dumps({"version": version}).encode(),
            ContentType="application/json",
        )

    def get_stage(self, name: str, stage: str) -> ModelArtifact:
        stage_key = self._key(name, "stages", f"{stage}.json")
        try:
            body = self._s3.get_object(Bucket=self.bucket, Key=stage_key)["Body"].read()
        except self._s3.exceptions.NoSuchKey as e:
            raise ModelNotFoundError(f"stage {stage!r} of {name!r} has never been promoted") from e
        version = json.loads(body)["version"]
        return self.get(name, version)

    def resolve_weights(self, artifact: ModelArtifact) -> str:
        assert artifact.uri.startswith("s3://")
        key = artifact.uri.removeprefix(f"s3://{self.bucket}/")
        dest = self.cache_dir / artifact.name / artifact.version / "model.pt"
        if dest.exists():
            return str(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as tmp:
            self._s3.download_fileobj(self.bucket, key, tmp)
            tmp_path = Path(tmp.name)
        tmp_path.replace(dest)
        return str(dest)
