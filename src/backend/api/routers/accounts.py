from fastapi import APIRouter, Query, Request

from .. import state
from ..auth_deps import limiter

router = APIRouter()

# ── Account-level analysis (node drill-down) ────────────────────────────────
# The model scores edges (transactions). These endpoints roll those edge scores
# up to the ACCOUNT level so an analyst can click a node and see (a) every
# flagged transaction it touches and (b) its aggregate risk = the strongest
# laundering signal on any edge incident to it.


def _money_to_float(s) -> float:
    try:
        return float(str(s).replace("$", "").replace(",", "")) or 0.0
    except (TypeError, ValueError):
        return 0.0


def _account_risk_table() -> dict:
    """Aggregate, per account, across every in-memory alert:
       max/mean edge-importance, txn count, total moved, and the alerts it appears in."""
    table: dict[str, dict] = {}
    with state.ALERTS_LOCK:
        alerts = list(state.ALERTS.values())
    for a in alerts:
        imp_by_node: dict[str, list] = {}
        for e in a.get("edges", []):
            imp = float(e.get("importance", 0.0) or 0.0)
            imp_by_node.setdefault(str(e.get("source")), []).append(imp)
            imp_by_node.setdefault(str(e.get("target")), []).append(imp)
        for t in a.get("transactions", []):
            paid = _money_to_float(t.get("paid"))
            for acct, key in ((str(t.get("from")), "sent"), (str(t.get("to")), "recv")):
                row = table.setdefault(acct, {
                    "account_id": acct, "sent": 0.0, "recv": 0.0, "txn_count": 0,
                    "alerts": set(), "banks": set(), "max_importance": 0.0,
                })
                row[key] += paid
                row["txn_count"] += 1
                row["alerts"].add(a["id"])
        # fold in edge importances
        for acct, imps in imp_by_node.items():
            row = table.setdefault(acct, {
                "account_id": acct, "sent": 0.0, "recv": 0.0, "txn_count": 0,
                "alerts": set(), "banks": set(), "max_importance": 0.0,
            })
            row["max_importance"] = max(row["max_importance"], max(imps) if imps else 0.0)
        for n in a.get("nodes", []):
            row = table.get(str(n.get("id")))
            if row and n.get("bank"):
                row["banks"].add(str(n["bank"]))
    return table


@router.get("/accounts/risky")
@limiter.limit("60/minute")
def top_risky_accounts(request: Request, limit: int = Query(default=8, ge=1, le=50)):
    """Top accounts ranked by their strongest laundering-edge score (node-level risk)."""
    table = _account_risk_table()
    rows = sorted(
        table.values(),
        key=lambda r: (r["max_importance"], r["sent"] + r["recv"]),
        reverse=True,
    )[:limit]
    return [{
        "account_id": r["account_id"],
        "risk_score": round(r["max_importance"], 3),
        "total_moved": r["sent"] + r["recv"],
        "txn_count": r["txn_count"],
        "alert_count": len(r["alerts"]),
        "banks": sorted(r["banks"])[:3],
    } for r in rows]


def _build_global_tx_graph() -> dict[str, list[dict]]:
    """Adjacency list over EVERY flagged transaction across all in-memory
    alerts (not just one alert's subgraph) — the basis for multi-hop
    account-network search."""
    adj: dict[str, list[dict]] = {}
    with state.ALERTS_LOCK:
        alerts = list(state.ALERTS.values())
    for a in alerts:
        for t in a.get("transactions", []):
            frm, to = str(t.get("from")), str(t.get("to"))
            if not frm or not to:
                continue
            edge_out = {"counterparty": to, "direction": "out", "amount": t.get("paid"),
                        "alert_id": a["id"], "timestamp": t.get("ts")}
            edge_in = {"counterparty": frm, "direction": "in", "amount": t.get("paid"),
                       "alert_id": a["id"], "timestamp": t.get("ts")}
            adj.setdefault(frm, []).append(edge_out)
            adj.setdefault(to, []).append(edge_in)
    return adj


@router.get("/account/{account_id}/network")
@limiter.limit("60/minute")
def account_network(request: Request, account_id: str, hops: int = Query(default=2, ge=1, le=2)):
    """BFS out from one account across the flagged-transaction graph, up to `hops` hops.
    Powers the account-search graphical neighborhood view."""
    account_id = str(account_id)
    adj = _build_global_tx_graph()
    risk_table = _account_risk_table()

    if account_id not in adj:
        return {"account_id": account_id, "found": False, "nodes": [], "edges": []}

    visited = {account_id: 0}
    frontier = [account_id]
    edges_seen = set()
    edges = []

    for hop in range(1, hops + 1):
        next_frontier = []
        for node in frontier:
            for e in adj.get(node, []):
                cp = e["counterparty"]
                src, dst = (node, cp) if e["direction"] == "out" else (cp, node)
                ekey = (src, dst, e["alert_id"], e.get("timestamp"))
                if ekey not in edges_seen:
                    edges_seen.add(ekey)
                    edges.append({"source": src, "target": dst, "amount": e["amount"], "alert_id": e["alert_id"]})
                if cp not in visited:
                    visited[cp] = hop
                    next_frontier.append(cp)
        frontier = next_frontier
        if not frontier:
            break

    nodes = []
    for acct, hop in visited.items():
        r = risk_table.get(acct, {})
        nodes.append({
            "id": acct, "hop": hop,
            "risk_score": round(r.get("max_importance", 0.0), 3),
            "alert_count": len(r.get("alerts", [])),
        })

    return {"account_id": account_id, "found": True, "nodes": nodes, "edges": edges}


@router.get("/account/{account_id}/history")
@limiter.limit("100/minute")
def account_history(request: Request, account_id: str):
    """Every flagged transaction involving this account, plus its aggregate risk."""
    account_id = str(account_id)
    txns = []
    with state.ALERTS_LOCK:
        alerts = list(state.ALERTS.values())
    for a in alerts:
        for t in a.get("transactions", []):
            frm, to = str(t.get("from")), str(t.get("to"))
            if account_id not in (frm, to):
                continue
            txns.append({
                "alert_id": a["id"],
                "pattern": a.get("patternType"),
                "severity": a.get("severity"),
                "direction": "out" if frm == account_id else "in",
                "counterparty": to if frm == account_id else frm,
                "amount": t.get("paid"),
                "currency": t.get("pCur"),
                "format": t.get("fmt"),
                "from_bank": t.get("fromBank"),
                "to_bank": t.get("toBank"),
                "timestamp": t.get("ts"),
            })
    table = _account_risk_table()
    agg = table.get(account_id)
    txns.sort(key=lambda x: x.get("timestamp") or "")
    return {
        "account_id": account_id,
        "found": agg is not None,
        "risk_score": round(agg["max_importance"], 3) if agg else 0.0,
        "sent_total": agg["sent"] if agg else 0.0,
        "recv_total": agg["recv"] if agg else 0.0,
        "txn_count": len(txns),
        "alert_count": len(agg["alerts"]) if agg else 0,
        "banks": sorted(agg["banks"]) if agg else [],
        "transactions": txns,
    }
