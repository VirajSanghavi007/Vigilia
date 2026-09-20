"""Model registry factory.

Default backend is local (MODEL_REGISTRY_BACKEND=local, or unset) — no AWS
credentials required for dev/CI. Set MODEL_REGISTRY_BACKEND=s3 plus
MODEL_REGISTRY_BUCKET (and optionally MODEL_REGISTRY_PREFIX) to switch to
S3Registry once a bucket exists. Nothing else in the codebase should
hardcode LocalRegistry or S3Registry directly — call get_registry().
"""

from __future__ import annotations

import os
from functools import lru_cache

from .base import ModelArtifact, ModelMetadata, ModelNotFoundError, ModelRegistry, make_version
from .local_registry import LocalRegistry

__all__ = [
    "ModelArtifact",
    "ModelMetadata",
    "ModelNotFoundError",
    "ModelRegistry",
    "make_version",
    "LocalRegistry",
    "get_registry",
]


@lru_cache
def get_registry() -> ModelRegistry:
    backend = os.getenv("MODEL_REGISTRY_BACKEND", "local").lower()

    if backend == "local":
        return LocalRegistry()

    if backend == "s3":
        from .s3_registry import S3Registry

        bucket = os.environ.get("MODEL_REGISTRY_BUCKET")
        if not bucket:
            raise RuntimeError("MODEL_REGISTRY_BACKEND=s3 requires MODEL_REGISTRY_BUCKET to be set")
        prefix = os.getenv("MODEL_REGISTRY_PREFIX", "models")
        return S3Registry(bucket=bucket, prefix=prefix)

    raise ValueError(f"Unknown MODEL_REGISTRY_BACKEND: {backend!r} (expected 'local' or 's3')")
