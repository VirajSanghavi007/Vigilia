"""Graph store factory.

MemgraphStore is the only backend right now. Nothing else in the codebase
should instantiate MemgraphStore directly — call get_graph_store(), so
swapping backends later is a change to this one function, not a hunt
through every call site (same pattern as ml/registry/get_registry()).
"""

from __future__ import annotations

import os
from functools import lru_cache

from .memgraph_client import MemgraphStore

__all__ = ["MemgraphStore", "get_graph_store"]


@lru_cache
def get_graph_store() -> MemgraphStore:
    uri = os.environ.get("MEMGRAPH_URI", "bolt://localhost:7687")
    return MemgraphStore(uri)
