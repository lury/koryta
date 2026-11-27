-- The Firestore-shaped document store is gone, and with it its two
-- write functions. docstore_rank and docstore_num stay: queries sort and
-- typed columns read by them.
DROP FUNCTION docstore_patch(jsonb, jsonb);
DROP FUNCTION docstore_set(jsonb, text[], jsonb);
