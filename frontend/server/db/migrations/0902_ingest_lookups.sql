-- The lookups of the ingest endpoints (server/db/ingestWrites.ts,
-- personIngest.ts): the stored edges of a (source, target, type), removed
-- ones too; a node by its TERYT code whatever its type; a person by name,
-- by register entry and by birth date.
CREATE INDEX edges_pair ON edges (source, target, type);
CREATE INDEX nodes_teryt_any ON nodes ((jsonb_text(data -> 'teryt')))
  WHERE data ? 'teryt';
CREATE INDEX nodes_person_name ON nodes ((jsonb_text(data -> 'name')))
  WHERE type = 'person';
CREATE INDEX nodes_rejestr_io ON nodes ((jsonb_text(data -> 'rejestrIo')));
CREATE INDEX nodes_birth_date ON nodes ((jsonb_text(data -> 'birthDate')));
