-- PKW's candidate lists as published, one row of a list per table row.
--
-- The shape is the ADR's (docs/postgres/README.md): an id and a jsonb
-- document. The 75 workbooks and CSVs have some forty different headers
-- between them, so a typed table per layout would be forty tables for the
-- same three dozen fields; the document keeps each row as the list wrote it,
-- header to cell, and `pkw.candidacy` reads the fields out of it.
--
-- Everything here is written by `koryta_pkw_postgres` and nothing else.

CREATE SCHEMA IF NOT EXISTS pkw_raw;

-- A list as read from one downloaded file: the first round's, or a run-off's.
CREATE TABLE IF NOT EXISTS pkw_raw.source (
  source        text COLLATE "C" PRIMARY KEY,   -- file name, ::inner file of a zip
  ordinal       int NOT NULL,                   -- order of `scrapers.pkw.sources`
  runoff_of     text COLLATE "C" REFERENCES pkw_raw.source (source),
  election_year text NOT NULL,
  election_type text NOT NULL,                  -- str(ElectionType): "samorządu"...
  name_format   text NOT NULL,                  -- PkwFormat member name
  url           text NOT NULL,
  sha256        text NOT NULL,                  -- of the downloaded file
  reader        text NOT NULL,                  -- how the file was read
  headers       text[] NOT NULL,                -- the list's columns, in order
  rows          int NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pkw_raw.row (
  source  text COLLATE "C" NOT NULL REFERENCES pkw_raw.source (source) ON DELETE CASCADE,
  row_no  int NOT NULL,                         -- 1 is the first row under the header
  data    jsonb NOT NULL,                       -- {header: cell}, a NaN cell as null
  PRIMARY KEY (source, row_no)
);

-- What each column of each list means: `CSV_HEADERS` with the list's own
-- `headers` laid over it, the processor named. Rewritten on every load, as it
-- is code, not data.
CREATE TABLE IF NOT EXISTS pkw_raw.header_rule (
  source     text COLLATE "C" NOT NULL REFERENCES pkw_raw.source (source) ON DELETE CASCADE,
  ordinal    int NOT NULL,                      -- position in `headers`, from 1
  header     text NOT NULL,
  field      text,                              -- null: the column is ignored
  rule       text,                              -- identity, const, sex, yes_no, mandate,
                                                -- runoff_mandate, district_teryt, city_teryt
  arg        text,                              -- const's value
  PRIMARY KEY (source, ordinal)
);

-- The lookups the header rules make, exported from the code that holds them.
CREATE TABLE IF NOT EXISTS pkw_raw.district_teryt (  -- headers.lookup_teryt
  election_year text NOT NULL,
  election_type text NOT NULL,
  district      text NOT NULL,                  -- as int(cell) prints it
  teryt         text NOT NULL,
  PRIMARY KEY (election_year, election_type, district)
);
CREATE TABLE IF NOT EXISTS pkw_raw.city_teryt (      -- Teryt.cities_to_teryt
  city  text PRIMARY KEY,
  teryt text NOT NULL
);
CREATE TABLE IF NOT EXISTS pkw_raw.gmina_kind (      -- Teryt.gmina_kinds
  teryt text PRIMARY KEY,
  kind  text NOT NULL
);

-- One line per source and load: what was done with it and why.
CREATE TABLE IF NOT EXISTS pkw_raw.load_log (
  id       bigserial PRIMARY KEY,
  run      text NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  source   text NOT NULL,
  sha256   text,
  action   text NOT NULL CHECK (action IN ('loaded', 'unchanged', 'failed')),
  rows     int,
  seconds  numeric,
  detail   text
);
