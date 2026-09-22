"""Smoke test for the local Ollama connection used by Memgraph Lab's
GraphChat (natural-language-to-Cypher) feature.

Local-only by design — not run in CI. Ollama isn't part of the deployed
detection pipeline (it backs a local dev-convenience UI, GraphChat), and
installing Ollama + pulling a multi-GB model on every CI push would add
real time/cost for a feature that isn't part of what actually ships. See
CLAUDE.md's CI/CD section for the same reasoning applied to Memgraph
integration tests.

Requires `ollama serve` running locally with MODEL pulled
(`ollama pull qwen2.5-coder:7b`). Fails loudly with an actionable message
if Ollama isn't reachable, rather than skipping — an unreachable Ollama
locally is almost always a forgotten `ollama serve`, not a permanent
fact about the environment.
"""

import httpx
import pytest

OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"


@pytest.fixture
def ollama_available():
    try:
        resp = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError:
        return None


@pytest.fixture
def require_ollama(ollama_available):
    if ollama_available is None:
        pytest.fail(
            f"Ollama not reachable at {OLLAMA_URL}. Start it with `ollama serve` "
            "before running smoke tests."
        )
    return ollama_available


def test_ollama_is_reachable(require_ollama):
    assert "models" in require_ollama


def test_model_is_pulled(require_ollama):
    names = [m["name"] for m in require_ollama["models"]]
    assert MODEL in names, (
        f"{MODEL} not found in `ollama list` ({names}). Pull it with `ollama pull {MODEL}`."
    )


def test_model_answers_a_query(require_ollama):
    resp = httpx.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": MODEL,
            "prompt": "Reply with exactly one word: OK",
            "stream": False,
        },
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()

    assert body.get("done") is True
    assert isinstance(body.get("response"), str)
    assert len(body["response"].strip()) > 0
