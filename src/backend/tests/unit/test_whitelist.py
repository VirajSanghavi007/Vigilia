"""Pure-function tests for core.whitelist exemption rules — no DB connection.

is_exempt() / filter_alerts() accept an explicit `whitelist` dict, so these
tests never touch load_whitelist() (which requires a live Postgres connection).
"""
from backend.core.whitelist import is_exempt, filter_alerts, DEFAULT_WHITELIST


def _wl(**overrides):
    wl = {**DEFAULT_WHITELIST}
    wl.update(overrides)
    return wl


def test_explicit_account_is_exempt_regardless_of_pattern():
    wl = _wl(exempt_accounts=["A123"])
    assert is_exempt("A123", "Some Bank", "FAN_OUT", wl) is True


def test_unlisted_account_unknown_bank_not_exempt():
    # "Acme Retail" matches none of the business-name patterns (CORP/LTD/INC/
    # PLC/LLC/BANK) or exempt bank names, so it should not be exempted.
    wl = _wl(exempt_accounts=[])
    assert is_exempt("A999", "Acme Retail", "FAN_OUT", wl) is False


def test_exempt_bank_matches_rule_condition():
    wl = _wl(exempt_accounts=[])
    assert is_exempt("A1", "Federal Reserve", "BIPARTITE", wl) is True


def test_filter_alerts_suppresses_when_all_nodes_exempt():
    wl = _wl(exempt_accounts=["A1", "A2"])
    alerts = [{
        "id": "UBI-0001", "pattern_type": "FAN_OUT",
        "nodes": [{"id": "A1", "bank": "Bank-1"}, {"id": "A2", "bank": "Bank-2"}],
    }]
    kept, suppressed = filter_alerts(alerts, wl)
    assert kept == []
    assert len(suppressed) == 1
    assert suppressed[0]["suppressed"] is True


def test_filter_alerts_keeps_partial_exemption_tagged():
    wl = _wl(exempt_accounts=["A1"])
    alerts = [{
        "id": "UBI-0002", "pattern_type": "FAN_OUT",
        "nodes": [{"id": "A1", "bank": "Bank-1"}, {"id": "A2", "bank": "Bank-2"}],
    }]
    kept, suppressed = filter_alerts(alerts, wl)
    assert suppressed == []
    assert len(kept) == 1
    assert kept[0]["partial_exemption"] is True
    assert kept[0]["exempt_accounts"] == ["A1"]


def test_filter_alerts_passes_through_pattern_without_rule():
    wl = _wl(exempt_accounts=[])
    alerts = [{"id": "UBI-0003", "pattern_type": "UNKNOWN_PATTERN", "nodes": []}]
    kept, suppressed = filter_alerts(alerts, wl)
    assert kept == alerts
    assert suppressed == []
