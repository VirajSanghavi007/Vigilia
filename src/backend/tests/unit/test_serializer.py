"""Pure-function tests for core.serializer — no DB, no torch."""
from backend.core.serializer import serialize_alerts, PATTERN_CAMEL, PATTERN_NAME, _fmt_amount


def _raw_alert(**overrides) -> dict:
    base = {
        "pattern_type": "FAN_OUT",
        "alert_id": "UBI-0001",
        "nodes_list": [
            {"node_id": "A1", "sev": "low", "role": "source", "bank": "1", "vol": 1000.0, "txn": 2},
            {"node_id": "A2", "sev": "low", "role": "destination", "bank": "2", "vol": 500.0, "txn": 1},
            {"node_id": "A3", "sev": "low", "role": "destination", "bank": "3", "vol": 500.0, "txn": 1},
        ],
        "edges_list": [
            {"txIdx": 0, "source": "A1", "target": "A2", "amount_paid": 500.0, "importance": 0.9},
            {"txIdx": 1, "source": "A1", "target": "A3", "amount_paid": 500.0, "importance": 0.8},
        ],
        "transactions_list": [
            {"Account": "A1", "Account.1": "A2", "Amount Paid": 500.0, "Amount Received": 500.0,
             "Payment Currency": "US Dollar", "Receiving Currency": "US Dollar",
             "From Bank": "1", "To Bank": "2", "Payment Format": "Wire", "Timestamp": None},
            {"Account": "A1", "Account.1": "A3", "Amount Paid": 500.0, "Amount Received": 500.0,
             "Payment Currency": "US Dollar", "Receiving Currency": "US Dollar",
             "From Bank": "1", "To Bank": "3", "Payment Format": "Wire", "Timestamp": None},
        ],
        "sub": "Single account distributes funds to many recipients",
        "severity": "high",
        "confidence": 0.85,
        "ml_score": 0.85,
        "ml_score_rf": None,
        "ml_score_gnn": 0.85,
        "risk_flagged": True,
        "time_span": "2025-01-01 00:00",
        "hops": 2,
        "total_moved": 1000.0,
        "route_nodes": ["A1", "A2", "A3"],
        "description": "FAN_OUT — Multi-GNN flagged 2 transaction(s) across 3 accounts.",
        "source": "labelled",
        "signals_triggered": ["Multi-GNN edge classification"],
        "risk_indicators": ["Some evidence line"],
    }
    base.update(overrides)
    return base


def test_serialize_alerts_basic_shape():
    out = serialize_alerts([_raw_alert()])
    assert len(out) == 1
    a = out[0]
    assert a["id"] == "UBI-0001"
    assert a["patternType"] == "fanOut"
    assert a["name"] == "Fan-Out"
    assert len(a["nodes"]) == 3
    assert len(a["edges"]) == 2
    assert len(a["transactions"]) == 2
    assert a["totalMoved"] == "$1,000"


def test_serialize_alerts_unknown_pattern_falls_back_to_lowercase():
    out = serialize_alerts([_raw_alert(pattern_type="SOMETHING_NEW")])
    assert out[0]["patternType"] == "something_new"


def test_fmt_amount_thousands_separator():
    assert _fmt_amount(1234567) == "$1,234,567"


def test_pattern_maps_cover_all_known_patterns():
    known = {"FAN_OUT", "FAN_IN", "CYCLE", "SCATTER_GATHER", "GATHER_SCATTER", "BIPARTITE", "RANDOM"}
    assert known.issubset(PATTERN_CAMEL.keys())
    assert known.issubset(PATTERN_NAME.keys())
