"""Unit tests for AnthropicCypherGenerator with a mocked SDK client: no
network, no API key."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import anthropic
import httpx
import pytest

from vigilia.domain.graph.query import GeneratorRefused, GeneratorUnavailable, GraphSchema
from vigilia.infra.llm import anthropic_cypher
from vigilia.infra.llm.anthropic_cypher import AnthropicCypherGenerator

SCHEMA = GraphSchema({"Transaction": 3}, {"SENT_TO": 2}, ["txId"], {"licit": 3})


def _response(text, stop_reason="end_turn"):
    blocks = [SimpleNamespace(type="thinking", thinking="..."), SimpleNamespace(type="text", text=text)]
    return SimpleNamespace(stop_reason=stop_reason, content=blocks)


def _generator(response=None, error=None):
    client = MagicMock()
    if error is not None:
        client.messages.create.side_effect = error
    else:
        client.messages.create.return_value = response
    return AnthropicCypherGenerator(client=client, model="claude-test"), client


def test_returns_cypher_and_explanation():
    gen, _ = _generator(_response(json.dumps({"cypher": "MATCH (t) RETURN t", "explanation": "all"})))
    out = gen.generate("everything", SCHEMA)
    assert (out.cypher, out.explanation) == ("MATCH (t) RETURN t", "all")


def test_request_uses_schema_prompt_and_structured_output():
    gen, client = _generator(_response('{"cypher": "RETURN 1", "explanation": ""}'))
    gen.generate("q?", SCHEMA)
    kwargs = client.messages.create.call_args.kwargs
    assert kwargs["model"] == "claude-test"
    assert kwargs["messages"] == [{"role": "user", "content": "q?"}]
    assert "Transaction (3 nodes)" in kwargs["system"]
    fmt = kwargs["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert fmt["schema"]["required"] == ["cypher", "explanation"]
    assert fmt["schema"]["additionalProperties"] is False
    assert kwargs["output_config"]["effort"] == "low"


def test_model_defaults_to_opus_and_env_overrides(monkeypatch):
    monkeypatch.delenv("VIGILIA_CYPHER_MODEL", raising=False)
    assert AnthropicCypherGenerator(client=MagicMock())._model == "claude-opus-5-5"
    monkeypatch.setenv("VIGILIA_CYPHER_MODEL", "claude-sonnet-5-5")
    assert AnthropicCypherGenerator(client=MagicMock())._model == "claude-sonnet-5-5"


def test_default_client_is_built_with_timeout(monkeypatch):
    built = {}
    monkeypatch.setattr(anthropic_cypher.anthropic, "Anthropic", lambda **kw: built.update(kw) or "client")
    gen = AnthropicCypherGenerator(timeout_s=12.0)
    assert gen._client == "client" and built == {"timeout": 12.0, "max_retries": 2}


def test_refusal_is_generator_refused():
    gen, _ = _generator(_response("", stop_reason="refusal"))
    with pytest.raises(GeneratorRefused):
        gen.generate("q", SCHEMA)


def test_cut_off_answer_is_unavailable():
    gen, _ = _generator(_response('{"cypher": "MATCH', stop_reason="max_tokens"))
    with pytest.raises(GeneratorUnavailable, match="cut off"):
        gen.generate("q", SCHEMA)


@pytest.mark.parametrize("text", ["not json", '{"cypher": "RETURN 1"}', "[1]"])
def test_malformed_output_is_unavailable(text):
    gen, _ = _generator(_response(text))
    with pytest.raises(GeneratorUnavailable, match="expected JSON"):
        gen.generate("q", SCHEMA)


def test_no_text_block_is_unavailable():
    gen, _ = _generator(SimpleNamespace(stop_reason="end_turn", content=[]))
    with pytest.raises(GeneratorUnavailable, match="expected JSON"):
        gen.generate("q", SCHEMA)


def _status_error(cls, code):
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("boom", response=httpx.Response(code, request=req), body=None)


def test_bad_key_says_so():
    gen, _ = _generator(error=_status_error(anthropic.AuthenticationError, 401))
    with pytest.raises(GeneratorUnavailable, match="ANTHROPIC_API_KEY"):
        gen.generate("q", SCHEMA)


@pytest.mark.parametrize(
    "error",
    [
        _status_error(anthropic.RateLimitError, 429),
        _status_error(anthropic.InternalServerError, 500),
        anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com")),
    ],
)
def test_api_errors_are_unavailable(error):
    gen, _ = _generator(error=error)
    with pytest.raises(GeneratorUnavailable, match="request failed"):
        gen.generate("q", SCHEMA)


def test_missing_credentials_are_unavailable():
    gen, _ = _generator(error=TypeError("Could not resolve authentication method. Expected one of api_key"))
    with pytest.raises(GeneratorUnavailable, match="set ANTHROPIC_API_KEY"):
        gen.generate("q", SCHEMA)


def test_other_type_errors_propagate():
    gen, _ = _generator(error=TypeError("unexpected keyword"))
    with pytest.raises(TypeError, match="unexpected keyword"):
        gen.generate("q", SCHEMA)
