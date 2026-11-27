-- The batch fields of /api/stats/computeNodes that SQL can compute: a
-- person's `stats.queueTier` (shared/queueTiers.ts) and every node's
-- `revisions` summary (computeRevisionsObj, shared/revisions.ts). They stay
-- in the document (docs/postgres/README.md), so these functions write them
-- there, only where the value changed. `nodeGroupSize` and `searchLine` are
-- the TypeScript half of the job (server/db/batch.ts).

-- `hasText` (queueTiers.ts): a string with something besides the whitespace
-- JavaScript's `trim` drops.
CREATE FUNCTION js_has_text(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(jsonb_typeof(value) = 'string'
    AND (value #>> '{}') ~ '[^\s   -     　﻿]', false)
$$;

-- `isoYearsAgo` (queueTiers.ts): `setFullYear(year - n)` and the day of the
-- ISO string, in UTC. A 29 February lands on 1 March, as in V8.
CREATE FUNCTION js_years_ago(years int, at timestamptz DEFAULT now()) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT to_char(make_date(extract(year FROM at AT TIME ZONE 'UTC')::int - years,
                           extract(month FROM at AT TIME ZONE 'UTC')::int, 1)
                 + (extract(day FROM at AT TIME ZONE 'UTC')::int - 1), 'YYYY-MM-DD')
$$;

-- `queueTier` of every person, or of the nodes `ids` names, as of `at`. computeNodes hands a node every
-- edge with it at either end, deleted and unpublished ones included, and a
-- place counts as public when `isPublic` is true whether or not it is deleted.
CREATE FUNCTION queue_tiers(at timestamptz DEFAULT now(), ids text[] DEFAULT NULL)
RETURNS TABLE (id text, tier int) LANGUAGE sql STABLE AS $$
  WITH public_place AS (
    SELECT n.id FROM public.nodes n
    WHERE n.type = 'place' AND public.jsonb_is_true(n.data -> 'isPublic')
  ), person_edge AS (
    SELECT p.id AS person_id, e.type, e.target, e.data
    FROM public.nodes p JOIN public.edges e ON e.source = p.id
    WHERE p.type = 'person' AND (ids IS NULL OR p.id = ANY(ids))
    UNION ALL
    SELECT p.id, e.type, e.target, e.data
    FROM public.nodes p JOIN public.edges e ON e.target = p.id
    WHERE p.type = 'person' AND e.source IS DISTINCT FROM p.id AND (ids IS NULL OR p.id = ANY(ids))
  ), flags AS (
    SELECT pe.person_id,
      bool_or(pe.type = 'election' AND public.jsonb_is_true(pe.data -> 'elected')
              AND public.js_has_text(pe.data -> 'start_date')
              AND (pe.data ->> 'start_date') COLLATE "C" >= public.js_years_ago(10, at))
        AS won_recently,
      bool_or(pp.id IS NOT NULL AND (NOT public.js_has_text(pe.data -> 'end_date')
              OR (pe.data ->> 'end_date') COLLATE "C" >= public.js_years_ago(5, at)))
        AS recent_public_post,
      bool_or(pp.id IS NOT NULL) AS public_post,
      bool_or(pe.type = 'election') AS ran
    FROM person_edge pe
    LEFT JOIN public_place pp ON pe.type = 'employed' AND pp.id = pe.target
    GROUP BY pe.person_id
  ), checkable AS (
    SELECT DISTINCT x.person_node_id AS person_id FROM public.extractions x
    WHERE x.person_node_id IS NOT NULL AND (ids IS NULL OR x.person_node_id = ANY(ids))
      AND public.jsonb_text(x.data -> 'fact_type') IN
        ('party_membership', 'personal_relation', 'affair_involvement', 'employment')
  )
  SELECT p.id,
    CASE
      WHEN public.js_has_text(p.data -> 'wikipedia') AND public.js_has_text(p.data -> 'rejestrIo') THEN 1
      WHEN coalesce(f.won_recently AND f.recent_public_post, false) THEN 2
      WHEN coalesce(f.public_post OR f.ran, false) AND c.person_id IS NOT NULL THEN 3
      ELSE 0
    END
  FROM public.nodes p
  LEFT JOIN flags f ON f.person_id = p.id
  LEFT JOIN checkable c ON c.person_id = p.id
  WHERE p.type = 'person' AND (ids IS NULL OR p.id = ANY(ids))
$$;

-- `stats` with `key` set to `value`, or dropped when `value` is null.
CREATE FUNCTION stats_with(data jsonb, key text, value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_set(data, '{stats}',
    (CASE WHEN jsonb_typeof(data -> 'stats') = 'object' THEN data -> 'stats' ELSE '{}' END - key)
    || CASE WHEN value IS NULL THEN '{}' ELSE jsonb_build_object(key, value) END)
$$;

-- Writes `stats.queueTier` onto every person, and takes it off anything
-- else (computeNodes writes `stats` whole). Returns the rows it changed.
-- `ids` limits it to those nodes, for a write that changed them.
CREATE FUNCTION refresh_queue_tiers(at timestamptz DEFAULT now(), ids text[] DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE changed bigint;
BEGIN
  WITH wanted AS (
    SELECT n.id, to_jsonb(q.tier) AS tier
    FROM public.nodes n LEFT JOIN public.queue_tiers(at, ids) q ON q.id = n.id
    WHERE ids IS NULL OR n.id = ANY(ids)
  )
  UPDATE public.nodes n SET data = public.stats_with(n.data, 'queueTier', w.tier), updated_at = now()
  FROM wanted w
  WHERE w.id = n.id AND n.data -> 'stats' -> 'queueTier' IS DISTINCT FROM w.tier;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

-- computeRevisionsObj for every node: the newest revision by `update_time`
-- (ties to the lower id, the order Firestore streams them in), how many there
-- are, and whether the newest is other than the approved one `revision_id`
-- names. Null for a node with no revision, as computeNodes writes it.
CREATE FUNCTION node_revisions(ids text[] DEFAULT NULL) RETURNS TABLE (id text, revisions jsonb)
LANGUAGE sql STABLE AS $$
  WITH rev AS (
    -- `node_id || nodeId`: an empty `node_id` falls through to `nodeId`.
    SELECT r.id,
      coalesce(nullif(public.jsonb_text(r.data -> 'node_id'), ''),
               nullif(public.jsonb_text(r.data -> 'nodeId'), '')) AS node_id,
      public.jsonb_text(r.data -> 'update_time') AS update_time
    FROM public.revisions r
    WHERE ids IS NULL OR r.node_id = ANY(ids) OR public.jsonb_text(r.data -> 'nodeId') = ANY(ids)
  ), ranked AS (
    SELECT rev.*, count(*) OVER (PARTITION BY node_id) AS total,
      row_number() OVER (PARTITION BY node_id ORDER BY
        coalesce(public.js_date(update_time), 'epoch'::timestamptz) DESC, rev.id) AS rn
    FROM rev WHERE node_id IS NOT NULL
  )
  SELECT n.id,
    CASE WHEN r.id IS NOT NULL THEN jsonb_build_object(
      'latest_id', r.id,
      'latest_time', nullif(r.update_time, ''),
      'total', r.total,
      'has_unapproved', coalesce(
        nullif(public.jsonb_text(n.data -> 'revision_id'), '') IS NULL
        OR regexp_replace(public.jsonb_text(n.data -> 'revision_id'), '^.*/', '') <> r.id, true))
    END
  FROM public.nodes n LEFT JOIN ranked r ON r.node_id = n.id AND r.rn = 1
  WHERE ids IS NULL OR n.id = ANY(ids)
$$;

-- Every node, or the nodes `ids` names: what a revision write calls in its
-- own transaction in place of the onRevisionWritten trigger.
CREATE FUNCTION refresh_node_revisions(ids text[] DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE changed bigint;
BEGIN
  UPDATE public.nodes n
  SET data = jsonb_set(n.data, '{revisions}', coalesce(w.revisions, 'null'::jsonb)), updated_at = now()
  FROM public.node_revisions(ids) w
  WHERE w.id = n.id AND n.data -> 'revisions' IS DISTINCT FROM coalesce(w.revisions, 'null'::jsonb);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;
