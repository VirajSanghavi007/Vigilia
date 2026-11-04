"""Claude-backed CypherGenerator.

Claude only writes the query; it never sees query results and never runs
anything. Its output goes through domain.graph.query.validate_read_only
before it reaches Memgraph, so a bad or adversarial generation fails the
guard instead of touching the graph.

Structured output (a JSON schema in output_config.format) is used instead
of parsing Cypher out of prose, so "the model wrapped the query in a code
fence" is not a failure mode this code has to handle.
"""

from __future__ import annotations

import json
import os
from typing import Any

import anthropic

from vigilia.domain.graph.query import (
    GeneratedQuery,
    GeneratorRefused,
    GeneratorUnavailable,
    GraphSchema,
    build_cypher_prompt,
)

DEFAULT_MODEL = "claude-opus-5-5"

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "cypher": {"type": "string", "description": "One read-only Memgraph Cypher statement."},
        "explanation": {"type": "string", "description": "What the query returns, in plain words."},
    },
    "required": ["cypher", "explanation"],
    "additionalProperties": False,
}


class AnthropicCypherGenerator:
    def __init__(self, client: Any | None = None, model: str | None = None, timeout_s: float = 60.0) -> None:
        # The SDK reads ANTHROPIC_API_KEY from the environment; the key is
        # never passed through or stored by this code.
        self._client = client or anthropic.Anthropic(timeout=timeout_s, max_retries=2)
        self._model = model or os.environ.get("VIGILIA_CYPHER_MODEL", DEFAULT_MODEL)

    def generate(self, question: str, schema: GraphSchema) -> GeneratedQuery:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=build_cypher_prompt(schema),
                messages=[{"role": "user", "content": question}],
                # Translating one question into one query is a bounded task;
                # low effort keeps the explorer responsive.
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}},
            )
        except anthropic.AuthenticationError as exc:
            raise GeneratorUnavailable("Claude rejected the API key. Check ANTHROPIC_API_KEY.") from exc
        except anthropic.APIError as exc:
            raise GeneratorUnavailable(f"Claude request failed: {exc}") from exc
        except TypeError as exc:
            # The SDK raises a bare TypeError at request time when no
            # credentials are configured (no ANTHROPIC_API_KEY); any other
            # TypeError is a programming error and propagates.
            if "authentication" not in str(exc):
                raise
            raise GeneratorUnavailable("Claude is not configured: set ANTHROPIC_API_KEY for the API.") from exc

        if response.stop_reason == "refusal":
            raise GeneratorRefused("Claude declined to answer this question.")
        if response.stop_reason == "max_tokens":
            raise GeneratorUnavailable("Claude's answer was cut off before the query was complete.")
        text = next((b.text for b in response.content if b.type == "text"), None)
        try:
            data = json.loads(text or "")
            return GeneratedQuery(cypher=str(data["cypher"]), explanation=str(data["explanation"]))
        except (ValueError, KeyError, TypeError) as exc:
            raise GeneratorUnavailable("Claude returned a response that is not the expected JSON.") from exc
