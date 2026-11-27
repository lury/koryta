-- /api/nodes/[id]/url: the public page an id names without its capitals
-- and with punctuation on its end (`mangledIdKey`, shared/slugs.ts), by
-- index. It read every sitemap file, every person, place and article, to
-- compare ids in Node: 43 s at x50.
CREATE INDEX nodes_mangled_id ON nodes ((lower(regexp_replace(id, '[^A-Za-z0-9]+$', ''))))
  WHERE type IN ('person', 'place', 'article') AND is_approved;
