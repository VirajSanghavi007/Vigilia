"""Structural (graph-topology + temporal) breakdown of labeled vs. unlabeled
Elliptic nodes -- independent of any trained model, so it can't inherit a
model's own biases. Complements consistency_check.py (which asks "do trained
models behave differently on unlabeled nodes") by asking "is the raw graph
structure around unlabeled nodes actually different."
"""
import os

import networkx as nx
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from data import get_dataset
from group_stats import compare_groups

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")


def compute_degree(edge_index, n):
    deg = np.zeros(n, dtype=np.float64)
    np.add.at(deg, edge_index[0], 1.0)
    np.add.at(deg, edge_index[1], 1.0)
    return deg


def compute_neighbor_unlabeled_fraction(edge_index, n, is_unlabeled):
    """For each node, the fraction of its 1-hop neighbors that are
    themselves unlabeled -- tests whether unlabeled nodes cluster together
    structurally rather than being scattered uniformly through the graph."""
    src, dst = edge_index
    deg = np.zeros(n, dtype=np.float64)
    unlabeled_neighbor_count = np.zeros(n, dtype=np.float64)
    np.add.at(deg, src, 1.0)
    np.add.at(deg, dst, 1.0)
    np.add.at(unlabeled_neighbor_count, src, is_unlabeled[dst].astype(np.float64))
    np.add.at(unlabeled_neighbor_count, dst, is_unlabeled[src].astype(np.float64))
    deg_safe = np.where(deg == 0, 1.0, deg)
    return unlabeled_neighbor_count / deg_safe


def compute_component_size(edge_index, n):
    src, dst = edge_index
    rows = np.concatenate([src, dst])
    cols = np.concatenate([dst, src])
    adj = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n))
    n_components, labels = connected_components(adj, directed=False)
    sizes = np.bincount(labels)
    return sizes[labels].astype(np.float64), n_components


def compute_local_clustering(edge_index, n, sample_size=None, seed=0):
    """Local clustering coefficient via networkx. Full 204k-node computation
    is feasible for this sparse a graph (mean degree ~2.3) but can be capped
    with sample_size for a quick run."""
    G = nx.Graph()
    G.add_nodes_from(range(n))
    G.add_edges_from(zip(edge_index[0].tolist(), edge_index[1].tolist()))
    if sample_size is not None and sample_size < n:
        rng = np.random.default_rng(seed)
        nodes = rng.choice(n, size=sample_size, replace=False)
        clustering = nx.clustering(G, nodes=nodes.tolist())
        result = np.full(n, np.nan)
        for node, c in clustering.items():
            result[node] = c
        return result
    clustering = nx.clustering(G)
    return np.array([clustering[i] for i in range(n)])


def run(clustering_sample_size=20000):
    df, X_xgb, X_gnn, y, edge_index, train_mask, test_mask = get_dataset()
    n = len(df)
    labeled_mask = train_mask | test_mask
    is_unlabeled = ~labeled_mask
    time_steps = df["time_step"].to_numpy()

    print(f"n={n}, labeled={labeled_mask.sum()} ({labeled_mask.mean():.1%}), "
          f"unlabeled={is_unlabeled.sum()} ({is_unlabeled.mean():.1%})")

    report = {}

    degree = compute_degree(edge_index, n)
    report["degree"] = compare_groups(degree, labeled_mask)
    print(f"[degree] labeled_mean={report['degree']['labeled_mean']:.3f} "
          f"unlabeled_mean={report['degree']['unlabeled_mean']:.3f} "
          f"p={report['degree']['p_value']:.2e}")

    neigh_unlabeled_frac = compute_neighbor_unlabeled_fraction(edge_index, n, is_unlabeled)
    report["neighbor_unlabeled_fraction"] = compare_groups(neigh_unlabeled_frac, labeled_mask)
    print(f"[neighbor_unlabeled_fraction] labeled_mean="
          f"{report['neighbor_unlabeled_fraction']['labeled_mean']:.3f} "
          f"unlabeled_mean={report['neighbor_unlabeled_fraction']['unlabeled_mean']:.3f} "
          f"p={report['neighbor_unlabeled_fraction']['p_value']:.2e}")

    comp_size, n_components = compute_component_size(edge_index, n)
    report["component_size"] = compare_groups(comp_size, labeled_mask)
    report["n_connected_components"] = int(n_components)
    print(f"[component_size] n_components={n_components} "
          f"labeled_mean={report['component_size']['labeled_mean']:.1f} "
          f"unlabeled_mean={report['component_size']['unlabeled_mean']:.1f} "
          f"p={report['component_size']['p_value']:.2e}")

    print(f"[clustering] computing on a {clustering_sample_size}-node sample "
          f"(full graph is expensive with networkx)...")
    clustering = compute_local_clustering(edge_index, n, sample_size=clustering_sample_size)
    sampled_mask = ~np.isnan(clustering)
    report["local_clustering"] = compare_groups(
        clustering[sampled_mask], labeled_mask[sampled_mask]
    )
    print(f"[local_clustering] labeled_mean={report['local_clustering']['labeled_mean']:.4f} "
          f"unlabeled_mean={report['local_clustering']['unlabeled_mean']:.4f} "
          f"p={report['local_clustering']['p_value']:.2e}")

    # time-step distribution: crosstab, not a Mann-Whitney metric
    ts_labeled_counts = np.bincount(time_steps[labeled_mask].astype(int))
    ts_unlabeled_counts = np.bincount(time_steps[is_unlabeled].astype(int))
    max_len = max(len(ts_labeled_counts), len(ts_unlabeled_counts))
    ts_labeled_counts = np.pad(ts_labeled_counts, (0, max_len - len(ts_labeled_counts)))
    ts_unlabeled_counts = np.pad(ts_unlabeled_counts, (0, max_len - len(ts_unlabeled_counts)))
    ts_unlabeled_share = np.divide(
        ts_unlabeled_counts, ts_labeled_counts + ts_unlabeled_counts,
        out=np.zeros(max_len, dtype=np.float64),
        where=(ts_labeled_counts + ts_unlabeled_counts) > 0,
    )
    report["unlabeled_share_by_time_step"] = {
        int(t): float(share) for t, share in enumerate(ts_unlabeled_share) if t > 0
    }
    worst_steps = sorted(report["unlabeled_share_by_time_step"].items(),
                          key=lambda kv: -kv[1])[:5]
    print(f"[time_step] time steps with highest unlabeled share: {worst_steps}")

    return report


if __name__ == "__main__":
    import json
    result = run()
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(os.path.join(RESULTS_DIR, "structural_breakdown.json"), "w") as f:
        json.dump(result, f, indent=2)
    print(f"[saved] {os.path.join(RESULTS_DIR, 'structural_breakdown.json')}")
