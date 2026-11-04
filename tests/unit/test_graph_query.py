"""Unit tests for the read-only Cypher guard, the generator prompt and
ask_graph(): pure domain code, no Memgraph or Claude."""

import pytest

from vigilia.domain.graph.query import (
    MAX_CYPHER_CHARS,
    CypherRejected,
    GeneratedQuery,
    GraphSchema,
    QueryResult,
    ask_graph,
    build_cypher_prompt,
    validate_read_only,
)

SCHEMA = GraphSchema(
    labels={"Transaction": 203769},
    edge_types={"SENT_TO": 234355},
    property_keys=["txId", "class", "local_1"],
    class_counts={"unknown": 157205, "licit": 42019, "illicit": 4545},
)


@pytest.mark.parametrize(
    "cypher",
    [
        "MATCH (t:Transaction) RETURN t",
        "match (t) return t",
        "OPTIONAL MATCH (t) RETURN t",
        "WITH 1 AS x RETURN x",
        "UNWIND [1, 2] AS x RETURN x",
        "RETURN 1",
    ],
)
def test_allowed_starts_get_a_limit_appended(cypher):
    assert validate_read_only(cypher, 50) == f"{cypher}\nLIMIT 50"


@pytest.mark.parametrize(
    "keyword",
    [
        "CREATE", "MERGE", "SET", "DELETE", "DETACH", "REMOVE", "DROP", "LOAD", "FOREACH", "CALL",
        "ALTER", "GRANT", "REVOKE", "DENY", "TRUNCATE", "ANALYZE", "FREE", "STORAGE", "INDEX",
        "CONSTRAINT", "TRIGGER", "STREAM", "BEGIN", "COMMIT", "ROLLBACK", "DUMP", "SHOW", "SNAPSHOT",
        "LOCK", "UNLOCK", "REPLICA", "REGISTER", "USING", "UNION", "EXPLAIN", "PROFILE",
    ],
)
def test_every_write_or_admin_keyword_is_rejected(keyword):
    with pytest.raises(CypherRejected, match=f"{keyword} is not allowed"):
        validate_read_only(f"MATCH (t) {keyword.lower()} t RETURN t")


def test_write_keyword_is_whole_word_only():
    # "offset", "settled", "created_at" contain forbidden words as substrings.
    cypher = "MATCH (t) WHERE t.offset > 0 AND t.settled AND t.created_at > 1 RETURN t"
    assert validate_read_only(cypher).startswith(cypher)


def test_keywords_inside_strings_and_comments_are_ignored():
    cypher = "MATCH (t {note: 'DELETE me; now'}) // CREATE (x)\nWHERE t.`SET` = \"CALL\" RETURN t"
    assert validate_read_only(cypher, 10) == cypher + "\nLIMIT 10"


def test_block_comment_is_ignored():
    assert validate_read_only("MATCH (t) /* DROP */ RETURN t", 5).endswith("LIMIT 5")


def test_multiple_statements_are_rejected():
    with pytest.raises(CypherRejected, match="one statement"):
        validate_read_only("MATCH (t) RETURN t; MATCH (n) DETACH DELETE n")


def test_semicolon_hidden_after_a_string_still_counts():
    with pytest.raises(CypherRejected, match="one statement"):
        validate_read_only("MATCH (t {a: 'x'}); RETURN 1")


def test_trailing_semicolon_and_comment_are_dropped_before_the_limit():
    # Appending LIMIT after a trailing // comment would comment the LIMIT out.
    assert validate_read_only("MATCH (t) RETURN t; // done", 7) == "MATCH (t) RETURN t\nLIMIT 7"


@pytest.mark.parametrize("cypher", ["MATCH (t {a: 'x}) RETURN t", "MATCH (t) RETURN t /* x", "RETURN `a"])
def test_unterminated_opaque_spans_are_rejected(cypher):
    with pytest.raises(CypherRejected, match="unterminated"):
        validate_read_only(cypher)


@pytest.mark.parametrize("cypher", ["", "   ", "\n"])
def test_empty_is_rejected(cypher):
    with pytest.raises(CypherRejected, match="empty"):
        validate_read_only(cypher)


def test_too_long_is_rejected():
    with pytest.raises(CypherRejected, match=str(MAX_CYPHER_CHARS)):
        validate_read_only("RETURN 1" + " " * MAX_CYPHER_CHARS + "+1")
    with pytest.raises(CypherRejected, match=str(MAX_CYPHER_CHARS)):
        validate_read_only("RETURN 1" + " " * (MAX_CYPHER_CHARS - 9) + "+1")


def test_exactly_max_length_is_allowed():
    cypher = "RETURN 1" + " " * (MAX_CYPHER_CHARS - 10) + "+1"
    assert len(cypher) == MAX_CYPHER_CHARS
    assert validate_read_only(cypher, 3).endswith("LIMIT 3")


def test_must_start_with_a_read_clause():
    with pytest.raises(CypherRejected, match="must start with"):
        validate_read_only("x MATCH (t) RETURN t")


def test_must_return():
    with pytest.raises(CypherRejected, match="RETURN"):
        validate_read_only("MATCH (t) WITH t")


def test_limit_within_cap_is_kept():
    assert validate_read_only("MATCH (t) RETURN t LIMIT 20", 20) == "MATCH (t) RETURN t LIMIT 20"


def test_limit_over_cap_is_clamped_in_place():
    assert validate_read_only("MATCH (t) RETURN t limit 5000 ;", 200) == "MATCH (t) RETURN t limit 200"


def test_inner_limit_still_gets_an_outer_cap():
    cypher = "MATCH (t) WITH t LIMIT 5 RETURN t"
    assert validate_read_only(cypher, 9) == cypher + "\nLIMIT 9"


def test_prompt_includes_live_schema_and_rules():
    prompt = build_cypher_prompt(SCHEMA, max_rows=150)
    for text in [
        "Transaction (203,769 nodes)",
        "SENT_TO (234,355 edges)",
        "illicit: 4,545",
        "txId, class, local_1",
        "LIMIT 150",
        "Read-only",
    ]:
        assert text in prompt


def test_prompt_handles_an_empty_graph():
    prompt = build_cypher_prompt(GraphSchema({}, {}, [], {}))
    assert prompt.count("none yet") == 4


class FakeGenerator:
    def __init__(self, cypher):
        self.cypher = cypher
        self.calls = []

    def generate(self, question, schema):
        self.calls.append((question, schema))
        return GeneratedQuery(cypher=self.cypher, explanation="why")


class FakeStore:
    def __init__(self):
        self.ran = []

    def schema(self):
        return SCHEMA

    def run_read(self, cypher):
        self.ran.append(cypher)
        return QueryResult(columns=["t"], rows=[["Transaction 1"]])


def test_ask_graph_generates_guards_and_runs():
    gen, store = FakeGenerator("MATCH (t) RETURN t LIMIT 999"), FakeStore()
    generated, cypher, result = ask_graph("show me", gen, store, max_rows=10)
    assert gen.calls == [("show me", SCHEMA)]
    assert generated.explanation == "why"
    assert cypher == "MATCH (t) RETURN t LIMIT 10"
    assert store.ran == [cypher]
    assert result.rows == [["Transaction 1"]]


def test_ask_graph_never_runs_a_rejected_query():
    store = FakeStore()
    with pytest.raises(CypherRejected):
        ask_graph("wipe it", FakeGenerator("MATCH (n) DETACH DELETE n"), store)
    assert store.ran == []
