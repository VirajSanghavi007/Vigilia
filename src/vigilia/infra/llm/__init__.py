"""LLM-backed implementations of domain interfaces.

get_cypher_generator() is the only way to obtain a generator, so the
provider/model choice lives in one place (same pattern as
infra/graph/get_graph_store()).
"""

from __future__ import annotations

from functools import lru_cache

from .anthropic_cypher import AnthropicCypherGenerator

__all__ = ["AnthropicCypherGenerator", "get_cypher_generator"]


@lru_cache
def get_cypher_generator() -> AnthropicCypherGenerator:
    return AnthropicCypherGenerator()
