-- The count of a published list (/api/nodes for a visitor, `total`): the
-- nodes of a type that are published and not removed, from the index alone.
-- nodes_type_approved has `is_approved` as its predicate, which does not
-- tell the planner the node is not removed, so the count fetched every row;
-- at x10 46 ms by a scan of nodes, 9 ms from this index.
CREATE INDEX nodes_type_published ON nodes (type, id) WHERE is_approved AND NOT deleted;
