-- The revisions of a page under either spelling (revisionRowsOfNodePg:
-- `node_id = $1 OR data -> 'nodeId' = $1`, for /api/revisions/node,
-- byNode and the revision pages). The second spelling had no index, so the
-- OR read every revision: 0.4-0.7 s and 100 thousand blocks a request at
-- x50. With this one the two conditions are a BitmapOr of two indexes.
CREATE INDEX revisions_legacy_node ON revisions ((data -> 'nodeId'));
