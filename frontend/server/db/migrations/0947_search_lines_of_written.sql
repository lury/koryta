-- A write recounted the search line of everybody employed at either end of
-- every edge it wrote: unpublishing a person (and so their posts) recounted
-- every colleague at every company they worked at, 70 s at x10, and a seat
-- moved recounted everybody at every company seated in the region, 6 s.
-- A line reads the person's own ties, the documents at their far ends, the
-- seat and owners of the companies they work at, and first revisions. So
-- the far-end and seat rules now take only `docs`: the nodes whose document
-- was written, and the target of a written seat or owns edge
-- (writeEffects.ts, touchedBy). Without it (null) they take `touched`, as
-- before.
CREATE OR REPLACE FUNCTION refresh_node_derived_for(
  at timestamptz, touched text[], ends text[] DEFAULT '{}', changed text[] DEFAULT '{}',
  docs text[] DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE n bigint := 0;
BEGIN
  docs := coalesce(docs, touched);
  IF cardinality(ends) + cardinality(changed) > 0 THEN
    n := n + public.write_node_group_sizes(
      ARRAY(SELECT a.id FROM public.node_group_affected(ends, changed) a));
  END IF;
  IF cardinality(touched) > 0 THEN
    n := n + public.write_search_lines(at, ARRAY(
      SELECT p.id FROM public.nodes p WHERE p.id = ANY(touched) AND p.type = 'person'
      UNION
      SELECT e.source FROM public.edges e WHERE e.id = ANY(touched) AND e.source IS NOT NULL
      UNION
      SELECT e.source FROM public.edges e WHERE e.target = ANY(docs) AND e.source IS NOT NULL
      UNION
      SELECT w.source FROM public.edges s
      JOIN public.edges w ON w.target = s.target AND w.type = 'employed' AND w.source IS NOT NULL
      WHERE s.source = ANY(docs) AND s.type IN ('seat', 'owns')));
  END IF;
  RETURN n;
END $$;
DROP FUNCTION refresh_node_derived_for(timestamptz, text[], text[], text[]);
