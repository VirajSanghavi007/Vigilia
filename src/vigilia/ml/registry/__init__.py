"""Model registry factory.

LocalRegistry (filesystem-backed) is the only backend for now — no AWS
account/bucket exists yet. Nothing else in the codebase should instantiate
LocalRegistry directly — call get_registry(), so swapping in a remote
backend later (S3, etc.) is a change to this one function, not a hunt
through every call site.
"""

from __future__ import annotations

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
    return LocalRegistry()
