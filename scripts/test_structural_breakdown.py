import numpy as np

from structural_breakdown import (
    compute_component_size,
    compute_degree,
    compute_local_clustering,
    compute_neighbor_unlabeled_fraction,
)


def test_compute_degree_counts_both_directions():
    edge_index = np.array([[0, 1], [1, 2]])  # 0-1, 1-2
    deg = compute_degree(edge_index, n=3)
    assert deg.tolist() == [1.0, 2.0, 1.0]


def test_compute_neighbor_unlabeled_fraction_all_unlabeled_neighbors():
    # node 0's only neighbor (node 1) is unlabeled -> fraction should be 1.0
    edge_index = np.array([[0], [1]])
    is_unlabeled = np.array([False, True, False])
    frac = compute_neighbor_unlabeled_fraction(edge_index, n=3, is_unlabeled=is_unlabeled)
    assert frac[0] == 1.0
    assert frac[1] == 0.0  # node 1's only neighbor (0) is labeled


def test_compute_neighbor_unlabeled_fraction_isolated_node_is_zero():
    edge_index = np.array([[0], [1]])
    is_unlabeled = np.array([True, True, True])
    frac = compute_neighbor_unlabeled_fraction(edge_index, n=3, is_unlabeled=is_unlabeled)
    assert frac[2] == 0.0  # isolated node, degree 0, safe division


def test_compute_component_size_two_disjoint_components():
    # component A: 0-1-2 (size 3); component B: 3-4 (size 2)
    edge_index = np.array([[0, 1, 3], [1, 2, 4]])
    sizes, n_components = compute_component_size(edge_index, n=5)
    assert n_components == 2
    assert sorted(sizes.tolist()) == [2.0, 2.0, 3.0, 3.0, 3.0]


def test_compute_local_clustering_triangle_has_coefficient_one():
    # 0-1-2-0 is a closed triangle -> every node's clustering coefficient is 1.0
    edge_index = np.array([[0, 1, 2], [1, 2, 0]])
    clustering = compute_local_clustering(edge_index, n=3)
    assert np.allclose(clustering, 1.0)


def test_compute_local_clustering_star_graph_has_coefficient_zero():
    # node 0 connected to 1, 2, 3 with no edges among 1/2/3 -> leaf clustering undefined->0,
    # center node 0 has no triangles either
    edge_index = np.array([[0, 0, 0], [1, 2, 3]])
    clustering = compute_local_clustering(edge_index, n=4)
    assert clustering[0] == 0.0
